import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeFeed(feed, index) {
  assert(isNonEmptyString(feed?.id), `Feed #${index + 1} is missing an id.`);
  assert(
    /^[a-z0-9-]+$/.test(feed.id),
    `Feed "${feed.id}" must only use lowercase letters, numbers, and dashes.`,
  );
  assert(
    isNonEmptyString(feed?.sourceUrl),
    `Feed "${feed.id}" is missing a sourceUrl.`,
  );

  const maxItems = Number.isInteger(feed.maxItems) && feed.maxItems > 0 ? feed.maxItems : 500;
  const allowedTitleTypes =
    Array.isArray(feed.allowedTitleTypes) && feed.allowedTitleTypes.length > 0
      ? [...new Set(feed.allowedTitleTypes.map((value) => String(value).trim()).filter(Boolean))]
      : ["movie", "tvMovie"];

  return {
    enabled: feed.enabled !== false,
    id: feed.id,
    label: isNonEmptyString(feed.label) ? feed.label.trim() : feed.id,
    sourceUrl: feed.sourceUrl.trim(),
    maxItems,
    allowedTitleTypes,
    sampleFixture: isNonEmptyString(feed.sampleFixture) ? feed.sampleFixture.trim() : null,
  };
}

export async function loadConfig(configPath) {
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  const feeds = Array.isArray(parsed?.feeds) ? parsed.feeds.map(normalizeFeed) : [];

  assert(feeds.length > 0, "config/lists.json must contain at least one feed.");

  const ids = new Set();
  for (const feed of feeds) {
    assert(!ids.has(feed.id), `Duplicate feed id "${feed.id}" found in config/lists.json.`);
    ids.add(feed.id);
  }

  return {
    site: {
      title: isNonEmptyString(parsed?.site?.title) ? parsed.site.title.trim() : "IMDb Watchlist to Radarr RSS",
      description: isNonEmptyString(parsed?.site?.description)
        ? parsed.site.description.trim()
        : "GitHub Pages-hosted RSS feeds generated from public IMDb watchlists and custom lists.",
      baseUrl: isNonEmptyString(parsed?.site?.baseUrl) ? parsed.site.baseUrl.trim().replace(/\/+$/, "") : "",
    },
    feeds,
  };
}
