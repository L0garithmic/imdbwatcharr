import { launch } from "@cloudflare/playwright";
import {
  buildFeedXml,
  buildCachedFeedXmlTemplate,
  buildPublicFeedPath,
  buildSonarrCustomListPayload,
  createStableSlug,
  extractImdbFingerprintPayload,
  filterItemsForTarget,
  getNormalizedFromStoredFeed,
  hashText,
  injectPublicOrigin,
  normalizeImdbUrl,
  parseFeedRoute,
  parseImdbHtml,
  summarizeItemsByTarget,
} from "./imdb.js";

const STALE_AFTER_MS = 1000 * 60 * 60 * 6;
const BROWSER_ATTEMPTS = 3;
const DIRECT_FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
};
const TVMAZE_HEADERS = {
  accept: "application/json",
  "user-agent": "imdbwatcharr/1.0 (+https://imdbwatcharr.pages.dev)",
};

function json(data, init = {}) {
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function getPublicOrigin(request) {
  return request.headers.get("x-public-origin") || new URL(request.url).origin;
}

function buildFeedEtag(feed, feedTarget) {
  if (!feed?.source_fingerprint) {
    return null;
  }

  return `"${feed.source_fingerprint}-${feedTarget}"`;
}

function hasFreshEtag(request, etag) {
  if (!etag) {
    return false;
  }

  const ifNoneMatch = request.headers.get("if-none-match");
  if (!ifNoneMatch) {
    return false;
  }

  return ifNoneMatch
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag);
}

function getLegacyRedirectPath(pathname) {
  const directMatch = pathname.match(/^\/(p|l)\/([a-z0-9._-]+)\/?$/i);
  if (directMatch) {
    return `/radarr/${directMatch[1].toLowerCase()}/${directMatch[2]}`;
  }

  const genericMatch = pathname.match(/^\/f\/((?:ls\d+)|(?:p\.[a-z0-9._-]+)|(?:ur[a-z0-9._-]+))\/?$/i);
  if (genericMatch) {
    return `/radarr/f/${genericMatch[1]}`;
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStale(feed) {
  if (!feed?.last_synced_at) {
    return true;
  }

  return Date.now() - Date.parse(feed.last_synced_at) > STALE_AFTER_MS;
}

async function getFeedBySlug(db, slug) {
  const result = await db.prepare("SELECT * FROM feeds WHERE slug = ?").bind(slug).first();
  return result ?? null;
}

async function getFeedByUrl(db, url) {
  const result = await db.prepare("SELECT * FROM feeds WHERE source_url = ?").bind(url).first();
  return result ?? null;
}

async function getOrCreateFeed(db, normalized) {
  const existing = await getFeedByUrl(db, normalized.canonicalUrl);
  if (existing) {
    return existing;
  }

  return upsertFeed(db, normalized);
}

async function getFeedItems(db, feedId) {
  const result = await db
    .prepare("SELECT imdb_id, tvdb_id, position, title, year, title_type, added_at FROM feed_items WHERE feed_id = ? ORDER BY position ASC")
    .bind(feedId)
    .all();
  return result.results ?? [];
}

async function upsertFeed(db, normalized) {
  const slug = await createStableSlug(normalized.canonicalUrl);
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO feeds (slug, source_url, source_kind, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`
    )
    .bind(slug, normalized.canonicalUrl, normalized.sourceKind, timestamp, timestamp)
    .run();
  return getFeedBySlug(db, slug);
}

async function storeFeedSnapshot(db, feed, snapshot) {
  const timestamp = nowIso();
  const storedItems = snapshot.items;
  const statements = [db.prepare("DELETE FROM feed_items WHERE feed_id = ?").bind(feed.id)];

  for (const item of storedItems) {
    statements.push(
      db.prepare(
        `INSERT INTO feed_items (feed_id, imdb_id, tvdb_id, position, title, year, title_type, added_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(feed.id, item.imdbId, item.tvdbId ?? null, item.position, item.title, item.year, item.titleType, item.addedAt, timestamp)
    );
  }

  statements.push(
    db.prepare(
      `UPDATE feeds
       SET list_title = ?, list_author = ?, list_id = ?, status = 'ready', item_count = ?, last_error = NULL,
           last_synced_at = ?, last_source_modified_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      snapshot.listTitle || snapshot.sourceTitle,
      snapshot.listAuthor || "",
      snapshot.listId || "",
      storedItems.length,
      timestamp,
      snapshot.lastSourceModifiedAt,
      timestamp,
      feed.id,
    )
  );

  await db.batch(statements);
  return {
    ...feed,
    list_title: snapshot.listTitle || snapshot.sourceTitle,
    list_author: snapshot.listAuthor || "",
    list_id: snapshot.listId || "",
    status: "ready",
    item_count: storedItems.length,
    last_error: null,
    last_synced_at: timestamp,
    last_source_modified_at: snapshot.lastSourceModifiedAt,
    updated_at: timestamp,
  };
}

async function storeFeedCaches(db, feed, items, sourceFingerprint) {
  const timestamp = nowIso();
  const radarrItems = filterItemsForTarget(items, "radarr");
  const radarrCache = buildCachedFeedXmlTemplate(feed, radarrItems, "radarr");
  const sonarrCache = JSON.stringify(buildSonarrCustomListPayload(items));

  await db
    .prepare(
      `UPDATE feeds
       SET source_fingerprint = ?, radarr_cache = ?, sonarr_cache = ?, cache_updated_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(sourceFingerprint, radarrCache, sonarrCache, timestamp, timestamp, feed.id)
    .run();

  return {
    ...feed,
    source_fingerprint: sourceFingerprint,
    radarr_cache: radarrCache,
    sonarr_cache: sonarrCache,
    cache_updated_at: timestamp,
    updated_at: timestamp,
  };
}

async function markFeedFailure(db, feedId, error) {
  const timestamp = nowIso();
  await db
    .prepare("UPDATE feeds SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?")
    .bind(String(error?.message ?? error), timestamp, feedId)
    .run();
}

async function markFeedUnchanged(db, feed, sourceFingerprint) {
  const timestamp = nowIso();
  await db
    .prepare(
      `UPDATE feeds
       SET source_fingerprint = ?, status = 'ready', last_error = NULL, last_synced_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(sourceFingerprint, timestamp, timestamp, feed.id)
    .run();

  return {
    ...feed,
    source_fingerprint: sourceFingerprint,
    status: "ready",
    last_error: null,
    last_synced_at: timestamp,
    updated_at: timestamp,
  };
}

async function fetchImdbHtmlDirect(sourceUrl) {
  const response = await fetch(sourceUrl, {
    headers: DIRECT_FETCH_HEADERS,
    redirect: "follow",
  });

  return response.text();
}

async function lookupTvdbIdByImdb(imdbId) {
  const response = await fetch(`https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`, {
    headers: TVMAZE_HEADERS,
    redirect: "follow",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`TVMaze lookup failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const tvdbId = Number(payload?.externals?.thetvdb);
  return Number.isInteger(tvdbId) && tvdbId > 0 ? tvdbId : null;
}

async function enrichTvdbIdsForFeed(env, feed, items) {
  const seriesItems = filterItemsForTarget(items, "sonarr").filter((item) => !item.tvdb_id);
  if (!seriesItems.length) {
    return items;
  }

  const statements = [];

  for (const item of seriesItems) {
    try {
      const tvdbId = await lookupTvdbIdByImdb(item.imdb_id);
      if (tvdbId) {
        statements.push(
          env.DB.prepare("UPDATE feed_items SET tvdb_id = ? WHERE feed_id = ? AND imdb_id = ?").bind(tvdbId, feed.id, item.imdb_id),
        );
      }
    } catch {}
  }

  if (!statements.length) {
    return items;
  }

  await env.DB.batch(statements);
  return getFeedItems(env.DB, feed.id);
}

async function syncFeedFromHtml(env, feed, htmlText) {
  const sourceFingerprint = await hashText(extractImdbFingerprintPayload(htmlText), 32);

  if (sourceFingerprint === feed.source_fingerprint && feed.radarr_cache && feed.sonarr_cache) {
    return markFeedUnchanged(env.DB, feed, sourceFingerprint);
  }

  const parsed = parseImdbHtml(htmlText);
  let currentFeed = await storeFeedSnapshot(env.DB, feed, parsed);
  let items = await getFeedItems(env.DB, currentFeed.id);
  items = await enrichTvdbIdsForFeed(env, currentFeed, items);
  currentFeed = await storeFeedCaches(env.DB, currentFeed, items, sourceFingerprint);

  return currentFeed;
}

async function syncFeed(env, feed) {
  await env.DB.prepare("UPDATE feeds SET status = 'syncing', updated_at = ? WHERE id = ?").bind(nowIso(), feed.id).run();

  try {
    const htmlText = await fetchImdbHtmlDirect(feed.source_url);
    return await syncFeedFromHtml(env, feed, htmlText);
  } catch {}

  let lastError = null;
  for (let attempt = 1; attempt <= BROWSER_ATTEMPTS; attempt += 1) {
    let browser;
    try {
      browser = await launch(env.BROWSER);
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1440, height: 1800 });

      try {
        await page.goto(feed.source_url, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch {
        // IMDb may still complete after the initial timeout, so keep inspecting the page.
      }

      await page.waitForTimeout(3000);
      const htmlText = await page.content();
      await browser.close();
      return await syncFeedFromHtml(env, feed, htmlText);
    } catch (error) {
      lastError = error;
      try {
        await browser.close();
      } catch {}
      if (!/429|rate limit/i.test(String(error)) || attempt === BROWSER_ATTEMPTS) {
        break;
      }
      await sleep(attempt * 2000);
    }
  }

  await markFeedFailure(env.DB, feed.id, lastError);
  throw lastError;
}

async function ensureFeedIsFresh(env, feed) {
  if (feed.status === "syncing") {
    return { feed, message: "Feed is already syncing. Using the latest stored snapshot for now." };
  }

  const shouldSync = feed.status !== "ready" || isStale(feed);
  let currentFeed = feed;
  let message = "Feed is ready.";

  if (shouldSync) {
    try {
      currentFeed = await syncFeed(env, feed);
    } catch (error) {
      message = error.message;
      currentFeed = await getFeedByUrl(env.DB, feed.source_url);
    }
  }

  return { feed: currentFeed, message };
}

function renderHomePage(origin) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IMDb Watch to RSS</title>
  <style>
    :root {
      --bg: #f6f1e5;
      --panel: rgba(255,255,255,0.78);
      --text: #191510;
      --muted: #65584a;
      --line: rgba(25,21,16,0.12);
      --accent: #f3c646;
      --accent-ink: #6f4810;
      --shadow: 0 20px 45px rgba(92,72,28,0.14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", Arial, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(243,198,70,0.45), transparent 30%),
        linear-gradient(180deg, #f3e7ca 0%, var(--bg) 50%, #efe8d8 100%);
    }
    main {
      width: min(760px, calc(100vw - 1.5rem));
      margin: 0 auto;
      padding: 2rem 0 3rem;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 28px;
      box-shadow: var(--shadow);
      padding: 1.5rem;
      backdrop-filter: blur(8px);
    }
    h1 {
      margin: 0;
      font-family: Georgia, serif;
      font-size: clamp(2.4rem, 6vw, 4.2rem);
      line-height: 0.98;
      max-width: 10ch;
    }
    p { color: var(--muted); line-height: 1.6; }
    form { display: grid; gap: 0.9rem; margin-top: 1.25rem; }
    input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 1rem 1.1rem;
      font: inherit;
      background: rgba(255,255,255,0.9);
    }
    button {
      justify-self: start;
      border: 0;
      border-radius: 999px;
      padding: 0.8rem 1.2rem;
      background: var(--accent);
      color: var(--accent-ink);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .result, .error {
      margin-top: 1rem;
      padding: 1rem;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.72);
      display: none;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .error { color: #8a2c2c; }
    .url-block {
      margin-top: 0.9rem;
      padding-top: 0.9rem;
      border-top: 1px solid var(--line);
    }
    code {
      font-family: Consolas, monospace;
      background: rgba(25,21,16,0.06);
      padding: 0.15rem 0.35rem;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <p style="margin:0 0 0.7rem;color:var(--accent-ink);font-weight:700;text-transform:uppercase;letter-spacing:0.12em;font-size:0.78rem;">Paste IMDb URL, get list URLs</p>
      <h1>IMDb to Radarr and Sonarr lists.</h1>
      <p>Paste a public IMDb watchlist or list URL. The Worker derives deterministic list URLs from the IMDb identifier, fetches the data once, and then serves a Radarr RSS feed plus a Sonarr custom JSON list from the same source.</p>
      <form id="create-form">
        <input id="source-url" name="sourceUrl" placeholder="https://www.imdb.com/user/ur12345678/watchlist/" required>
        <button type="submit">Create Feed</button>
      </form>
      <div id="result" class="result"></div>
      <div id="error" class="error"></div>
      <p style="margin-top:1rem;">Radarr uses <code>${origin}/radarr/p/profile-id</code> or <code>${origin}/radarr/l/ls123456789</code>. Sonarr uses <code>${origin}/sonarr/p/profile-id</code> or <code>${origin}/sonarr/l/ls123456789</code>.</p>
      <p style="margin-top:0.6rem;font-size:0.95rem;">The <code>/sonarr</code> route returns Sonarr Custom List JSON with TVDB IDs when they can be resolved from IMDb via TVMaze.</p>
    </section>
  </main>
  <script>
    const form = document.getElementById("create-form");
    const result = document.getElementById("result");
    const errorBox = document.getElementById("error");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      result.style.display = "none";
      errorBox.style.display = "none";

      const sourceUrl = document.getElementById("source-url").value.trim();
      try {
        const response = await fetch("/api/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceUrl })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Request failed");

        result.style.display = "block";
        result.innerHTML =
          '<div class="url-block"><strong>Radarr Feed URL</strong><br>' +
          '<a href="' + payload.radarrFeedUrl + '" target="_blank" rel="noreferrer">' + payload.radarrFeedUrl + "</a></div>" +
          '<div class="url-block"><strong>Sonarr Custom List URL</strong><br>' +
          '<a href="' + payload.sonarrFeedUrl + '" target="_blank" rel="noreferrer">' + payload.sonarrFeedUrl + "</a></div><br>" +
          "<strong>Status</strong><br>" + payload.status +
          (payload.radarrCount != null ? "<br><br><strong>Radarr Items</strong><br>" + payload.radarrCount : "") +
          (payload.sonarrCount != null ? "<br><br><strong>Sonarr Importable Items</strong><br>" + payload.sonarrCount : "") +
          (payload.sonarrUnresolvedCount != null ? "<br><br><strong>Unresolved TV Items</strong><br>" + payload.sonarrUnresolvedCount : "") +
          (payload.totalCount != null ? "<br><br><strong>Total IMDb Items</strong><br>" + payload.totalCount : "") +
          (payload.message ? "<br><br><strong>Message</strong><br>" + payload.message : "");
      } catch (error) {
        errorBox.style.display = "block";
        errorBox.textContent = error.message;
      }
    });
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const publicOrigin = getPublicOrigin(request);

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
      return html(renderHomePage(publicOrigin));
    }

    if (request.method === "POST" && url.pathname === "/api/create") {
      try {
        const payload = await request.json();
        const normalized = normalizeImdbUrl(payload?.sourceUrl ?? "");
        const existing = await getOrCreateFeed(env.DB, normalized);
        const { feed, message } = await ensureFeedIsFresh(env, existing);
        const items = await getFeedItems(env.DB, feed.id);
        const enrichedItems = await enrichTvdbIdsForFeed(env, feed, items);
        const counts = summarizeItemsByTarget(enrichedItems);
        const sonarrPayload = buildSonarrCustomListPayload(enrichedItems);
        const sonarrUnresolvedCount = counts.sonarr - sonarrPayload.length;

        return json({
          slug: feed.slug,
          routePath: buildPublicFeedPath(normalized, "radarr"),
          feedUrl: `${publicOrigin}${buildPublicFeedPath(normalized, "radarr")}`,
          radarrRoutePath: buildPublicFeedPath(normalized, "radarr"),
          radarrFeedUrl: `${publicOrigin}${buildPublicFeedPath(normalized, "radarr")}`,
          sonarrRoutePath: buildPublicFeedPath(normalized, "sonarr"),
          sonarrFeedUrl: `${publicOrigin}${buildPublicFeedPath(normalized, "sonarr")}`,
          status: feed.status,
          itemCount: counts.radarr,
          radarrCount: counts.radarr,
          sonarrCount: sonarrPayload.length,
          sonarrUnresolvedCount,
          totalCount: counts.total,
          message,
        });
      } catch (error) {
        return json({ error: error.message }, { status: 400 });
      }
    }

    const legacyRedirectPath = getLegacyRedirectPath(url.pathname);
    if ((request.method === "GET" || request.method === "HEAD") && legacyRedirectPath) {
      return Response.redirect(`${publicOrigin}${legacyRedirectPath}`, 302);
    }

    const parsedRoute = parseFeedRoute(url.pathname);
    if ((request.method === "GET" || request.method === "HEAD") && parsedRoute) {
      const { feedTarget, ...normalizedRoute } = parsedRoute;
      let feed = await getOrCreateFeed(env.DB, normalizedRoute);

      if (feed.status !== "ready") {
        const result = await ensureFeedIsFresh(env, feed);
        feed = result.feed;
      } else if (isStale(feed) && feed.status !== "syncing") {
        ctx.waitUntil(syncFeed(env, feed).catch(() => {}));
      }

      const items = await getFeedItems(env.DB, feed.id);
      if (items.length === 0) {
        return new Response(feed.last_error || "Feed exists but has not synced successfully yet.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }

      const etag = buildFeedEtag(feed, feedTarget);
      const baseHeaders = {
        "cache-control": "public, max-age=300",
        ...(etag ? { etag } : {}),
      };

      if (hasFreshEtag(request, etag)) {
        return new Response(null, {
          status: 304,
          headers: baseHeaders,
        });
      }

      if (feedTarget === "sonarr") {
        if (feed.sonarr_cache) {
          return new Response(feed.sonarr_cache, {
            headers: {
              "content-type": "application/json; charset=utf-8",
              ...baseHeaders,
            },
          });
        }

        const enrichedItems = await enrichTvdbIdsForFeed(env, feed, items);
        const payload = buildSonarrCustomListPayload(enrichedItems);
        return json(payload, {
          headers: {
            ...baseHeaders,
          },
        });
      }

      if (feed.radarr_cache) {
        return new Response(injectPublicOrigin(feed.radarr_cache, publicOrigin), {
          headers: {
            "content-type": "application/rss+xml; charset=utf-8",
            ...baseHeaders,
          },
        });
      }

      const filteredItems = filterItemsForTarget(items, feedTarget);
      const xml = buildFeedXml(publicOrigin, feed, filteredItems, feedTarget);
      return new Response(xml, {
        headers: {
          "content-type": "application/rss+xml; charset=utf-8",
          ...baseHeaders,
        },
      });
    }

    const legacyFeedMatch = url.pathname.match(/^\/f\/([a-f0-9]{12})\.xml$/);
    if ((request.method === "GET" || request.method === "HEAD") && legacyFeedMatch) {
      const feed = await getFeedBySlug(env.DB, legacyFeedMatch[1]);
      if (!feed) {
        return new Response("Feed not found.", { status: 404 });
      }

      const redirectUrl = `${publicOrigin}${buildPublicFeedPath(getNormalizedFromStoredFeed(feed), "radarr")}`;
      return Response.redirect(redirectUrl, 302);
    }

    const metadataMatch = url.pathname.match(/^\/api\/feeds\/([a-f0-9]{12})$/);
    if (request.method === "GET" && metadataMatch) {
      const feed = await getFeedBySlug(env.DB, metadataMatch[1]);
      if (!feed) {
        return json({ error: "Feed not found." }, { status: 404 });
      }
      return json(feed);
    }

    return new Response("Not found.", { status: 404 });
  },
};
