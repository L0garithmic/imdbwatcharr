const LIST_URL_RE = /^https?:\/\/(?:www\.)?imdb\.com\/list\/(ls\d+)(?:\/)?(?:[?#].*)?$/i;
const WATCHLIST_URL_RE = /^https?:\/\/(?:www\.)?imdb\.com\/user\/([a-z0-9._-]+)\/watchlist(?:\/)?(?:[?#].*)?$/i;
const TITLE_URL_RE = /\/title\/(tt\d+)/i;
const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;
const TITLE_RE = /<title>([^<]+)<\/title>/i;
const H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;

export const MOVIE_TITLE_TYPES = new Set(["movie", "tvMovie"]);
export const SERIES_TITLE_TYPES = new Set(["tvSeries", "tvMiniSeries"]);

function htmlDecode(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return htmlDecode(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

export function normalizeImdbUrl(input) {
  const url = new URL(String(input).trim());
  const href = url.toString();
  const listMatch = href.match(LIST_URL_RE);
  if (listMatch) {
    return {
      canonicalUrl: `https://www.imdb.com/list/${listMatch[1]}/`,
      sourceKind: "list",
      sourceKey: listMatch[1],
    };
  }

  const watchlistMatch = href.match(WATCHLIST_URL_RE);
  if (watchlistMatch) {
    return {
      canonicalUrl: `https://www.imdb.com/user/${watchlistMatch[1]}/watchlist/`,
      sourceKind: "watchlist",
      sourceKey: watchlistMatch[1],
    };
  }

  throw new Error("Enter a public IMDb list URL or public watchlist URL.");
}

function buildSourceFeedPath(normalized) {
  if (normalized.sourceKind === "watchlist") {
    return `/p/${normalized.sourceKey}`;
  }

  if (normalized.sourceKind === "list") {
    return `/l/${normalized.sourceKey}`;
  }

  throw new Error("Unsupported IMDb source type.");
}

export function buildPublicFeedPath(normalized, feedTarget = "radarr") {
  const sourcePath = buildSourceFeedPath(normalized);
  if (feedTarget === "radarr") {
    return `/radarr${sourcePath}`;
  }

  if (feedTarget === "sonarr") {
    return `/sonarr${sourcePath}`;
  }

  throw new Error("Unsupported feed target.");
}

export function getNormalizedFromStoredFeed(feed) {
  return normalizeImdbUrl(feed.source_url);
}

export function parseFeedRoute(pathname) {
  const targetedRouteMatch = pathname.match(/^\/(radarr|sonarr)\/(p|l)\/([a-z0-9._-]+)\/?$/i);
  if (targetedRouteMatch) {
    const [, feedTarget, kind, sourceKey] = targetedRouteMatch;
    if (kind.toLowerCase() === "p") {
      return {
        feedTarget: feedTarget.toLowerCase(),
        canonicalUrl: `https://www.imdb.com/user/${sourceKey}/watchlist/`,
        sourceKind: "watchlist",
        sourceKey,
      };
    }

    return {
      feedTarget: feedTarget.toLowerCase(),
      canonicalUrl: `https://www.imdb.com/list/${sourceKey}/`,
      sourceKind: "list",
      sourceKey,
    };
  }

  const watchlistMatch = pathname.match(/^\/p\/([a-z0-9._-]+)\/?$/i);
  if (watchlistMatch) {
    return {
      feedTarget: "radarr",
      canonicalUrl: `https://www.imdb.com/user/${watchlistMatch[1]}/watchlist/`,
      sourceKind: "watchlist",
      sourceKey: watchlistMatch[1],
    };
  }

  const listMatch = pathname.match(/^\/l\/(ls\d+)\/?$/i);
  if (listMatch) {
    return {
      feedTarget: "radarr",
      canonicalUrl: `https://www.imdb.com/list/${listMatch[1]}/`,
      sourceKind: "list",
      sourceKey: listMatch[1],
    };
  }

  const targetedGenericMatch = pathname.match(/^\/(radarr|sonarr)\/f\/((?:ls\d+)|(?:p\.[a-z0-9._-]+)|(?:ur[a-z0-9._-]+))\/?$/i);
  if (targetedGenericMatch) {
    const [, feedTarget, value] = targetedGenericMatch;
    if (/^ls\d+$/i.test(value)) {
      return {
        feedTarget: feedTarget.toLowerCase(),
        canonicalUrl: `https://www.imdb.com/list/${value}/`,
        sourceKind: "list",
        sourceKey: value,
      };
    }

    return {
      feedTarget: feedTarget.toLowerCase(),
      canonicalUrl: `https://www.imdb.com/user/${value}/watchlist/`,
      sourceKind: "watchlist",
      sourceKey: value,
    };
  }

  const genericMatch = pathname.match(/^\/f\/((?:ls\d+)|(?:p\.[a-z0-9._-]+)|(?:ur[a-z0-9._-]+))\/?$/i);
  if (genericMatch) {
    const value = genericMatch[1];
    if (/^ls\d+$/i.test(value)) {
      return {
        feedTarget: "radarr",
        canonicalUrl: `https://www.imdb.com/list/${value}/`,
        sourceKind: "list",
        sourceKey: value,
      };
    }

    return {
      feedTarget: "radarr",
      canonicalUrl: `https://www.imdb.com/user/${value}/watchlist/`,
      sourceKind: "watchlist",
      sourceKey: value,
    };
  }

  return null;
}

function parseJsonLd(html) {
  const matches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  for (const [, rawJson] of matches) {
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    const itemList = candidates.find((entry) => entry?.["@type"] === "ItemList" && Array.isArray(entry?.itemListElement));
    if (!itemList) {
      continue;
    }

    return itemList.itemListElement
      .map((entry, index) => {
        const item = entry?.item ?? entry;
        const imdbId = item?.url?.match(TITLE_URL_RE)?.[1];
        if (!imdbId) {
          return null;
        }

        const typeName = String(item?.["@type"] ?? "Movie");
        const titleType = typeName === "TVMovie" ? "tvMovie" : typeName.startsWith("TV") ? "tvSeries" : "movie";
        const year = item?.datePublished ? Number(String(item.datePublished).slice(0, 4)) : null;

        return {
          imdbId,
          title: item?.name ?? item?.alternateName ?? imdbId,
          year: Number.isFinite(year) ? year : null,
          titleType,
          position: Number(entry?.position ?? index + 1),
          addedAt: null,
        };
      })
      .filter(Boolean);
  }

  return null;
}

export function parseImdbHtml(html) {
  const nextDataMatch = html.match(NEXT_DATA_RE);
  const title = stripTags(html.match(TITLE_RE)?.[1] ?? "");
  const h1 = stripTags(html.match(H1_RE)?.[1] ?? "");

  if (nextDataMatch) {
    const nextData = JSON.parse(nextDataMatch[1]);
    const pageProps = nextData?.props?.pageProps ?? {};
    const mainColumnData = pageProps?.mainColumnData ?? {};
    const listContainer = mainColumnData?.list?.titleListItemSearch ?? mainColumnData?.predefinedList?.titleListItemSearch;

    if (Array.isArray(listContainer?.edges)) {
      const above = pageProps?.aboveTheFoldData ?? {};
      const items = listContainer.edges
        .map((edge, index) => {
          const listItem = edge?.listItem ?? {};
          const imdbId = listItem?.id ?? listItem?.url?.match(TITLE_URL_RE)?.[1];
          if (!imdbId || !/^tt\d+$/.test(imdbId)) {
            return null;
          }

          const year = listItem?.releaseYear?.year ?? listItem?.releaseDate?.year ?? null;

          return {
            imdbId,
            title: listItem?.titleText?.text ?? listItem?.originalTitleText?.text ?? imdbId,
            year: Number.isFinite(year) ? year : null,
            titleType: listItem?.titleType?.id ?? "unknown",
            position: Number(edge?.node?.absolutePosition ?? index + 1),
            addedAt: edge?.node?.createdDate ?? null,
          };
        })
        .filter(Boolean);

      return {
        parserMode: "next-data",
        sourceTitle: h1 || title,
        listTitle: h1 || title,
        listAuthor: above?.authorName ?? "",
        listId: above?.listId ?? "",
        lastSourceModifiedAt: above?.lastModifiedDate ?? null,
        hasNextPage: Boolean(listContainer?.pageInfo?.hasNextPage),
        totalItems: Number(listContainer?.total ?? items.length),
        items,
      };
    }
  }

  const ldItems = parseJsonLd(html);
  if (ldItems?.length) {
    return {
      parserMode: "json-ld",
      sourceTitle: h1 || title,
      listTitle: h1 || title,
      listAuthor: "",
      listId: "",
      lastSourceModifiedAt: null,
      hasNextPage: false,
      totalItems: ldItems.length,
      items: ldItems,
    };
  }

  if (/403 forbidden|access denied|verify that you're not a robot|captcha/i.test(html)) {
    throw new Error("IMDb returned an access challenge instead of list data.");
  }

  throw new Error("Could not extract IMDb data from the fetched page.");
}

export function filterItemsForTarget(items, feedTarget = "radarr") {
  const getTitleType = (item) => item.titleType ?? item.title_type ?? "unknown";

  if (feedTarget === "radarr") {
    return items.filter((item) => MOVIE_TITLE_TYPES.has(getTitleType(item)));
  }

  if (feedTarget === "sonarr") {
    return items.filter((item) => SERIES_TITLE_TYPES.has(getTitleType(item)));
  }

  throw new Error("Unsupported feed target.");
}

export function summarizeItemsByTarget(items) {
  return {
    radarr: filterItemsForTarget(items, "radarr").length,
    sonarr: filterItemsForTarget(items, "sonarr").length,
    total: items.length,
  };
}

export async function createStableSlug(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 12);
}

export function buildFeedXml(origin, feed, items, feedTarget = "radarr") {
  const escapeXml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  const cdata = (value) => `<![CDATA[${String(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
  const feedUrl = `${origin}${buildPublicFeedPath(getNormalizedFromStoredFeed(feed), feedTarget)}`;
  const lastBuildDate = feed.last_synced_at ? new Date(feed.last_synced_at).toUTCString() : new Date().toUTCString();
  const sourceTitle = feed.list_title || "IMDb Feed";
  const libraryName = feedTarget === "sonarr" ? "Sonarr" : "Radarr";
  const feedTitle = `${sourceTitle} (${libraryName})`;
  const description = `${sourceTitle} on IMDb | ${items.length} included for ${libraryName}`;

  const itemXml = items
    .map((item) => {
      const titleWithYear = item.year ? `${item.title} (${item.year})` : item.title;
      const pubDate = item.added_at ? `\n      <pubDate>${new Date(item.added_at).toUTCString()}</pubDate>` : "";
      return `    <item>
      <title>${cdata(titleWithYear)}</title>
      <guid isPermaLink="false">${escapeXml(item.imdb_id)}</guid>
      <link>${escapeXml(`https://www.imdb.com/title/${item.imdb_id}/`)}</link>
      <description>${cdata(`IMDb ID: ${item.imdb_id} | Type: ${item.title_type} | Source: ${sourceTitle}`)}</description>${pubDate}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${cdata(feedTitle)}</title>
    <description>${cdata(description)}</description>
    <link>${escapeXml(feed.source_url)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
${itemXml}
  </channel>
</rss>
`;
}
