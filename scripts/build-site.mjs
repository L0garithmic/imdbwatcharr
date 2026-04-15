import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/config.mjs";
import { createImdbFetcher } from "./lib/imdb-fetcher.mjs";
import { buildRssFeed } from "./lib/rss.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(rootDir, "config", "lists.json");
const fixturesDir = path.join(rootDir, "fixtures");
const siteSourceDir = path.join(rootDir, "site");
const distDir = path.join(rootDir, "dist");
const distDataDir = path.join(distDir, "data");
const distFeedsDir = path.join(distDir, "feeds");
const useSample = process.argv.includes("--use-sample");

function toPublicFeedUrl(baseUrl, feedId) {
  if (!baseUrl) {
    return "";
  }

  return `${baseUrl}/feeds/${feedId}.xml`;
}

function countByType(items) {
  return items.reduce((map, item) => {
    map[item.titleType] = (map[item.titleType] ?? 0) + 1;
    return map;
  }, {});
}

async function main() {
  const config = await loadConfig(configPath);
  const enabledFeeds = config.feeds.filter((feed) => feed.enabled);
  const buildDate = new Date();
  const results = [];
  let successCount = 0;

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDataDir, { recursive: true });
  await mkdir(distFeedsDir, { recursive: true });
  await cp(siteSourceDir, distDir, { recursive: true });
  await writeFile(path.join(distDir, ".nojekyll"), "");

  const fetcher = await createImdbFetcher({ fixturesDir, useSample });

  try {
    for (const feed of enabledFeeds) {
      try {
        const collection = await fetcher.getCollection(feed);
        const feedUrl = toPublicFeedUrl(config.site.baseUrl, feed.id);
        const xml = buildRssFeed({
          feed,
          collection,
          feedUrl,
          buildDate,
        });

        await writeFile(path.join(distFeedsDir, `${feed.id}.xml`), xml, "utf8");

        results.push({
          id: feed.id,
          label: feed.label,
          sourceUrl: feed.sourceUrl,
          sourceTitle: collection.sourceTitle,
          authorName: collection.authorName,
          listKind: collection.listKind,
          listId: collection.listId,
          parserMode: collection.mode,
          feedPath: `feeds/${feed.id}.xml`,
          totalDiscovered: collection.rawItems.length,
          totalIncluded: collection.items.length,
          totalSkipped: collection.skippedItems.length,
          skippedByType: countByType(collection.skippedItems),
          allowedTitleTypes: feed.allowedTitleTypes,
          lastModifiedAt: collection.lastModifiedAt,
          status: "ok",
          error: null,
        });

        successCount += 1;
      } catch (error) {
        results.push({
          id: feed.id,
          label: feed.label,
          sourceUrl: feed.sourceUrl,
          sourceTitle: "",
          authorName: "",
          listKind: "unknown",
          listId: "",
          parserMode: "",
          feedPath: null,
          totalDiscovered: 0,
          totalIncluded: 0,
          totalSkipped: 0,
          skippedByType: {},
          allowedTitleTypes: feed.allowedTitleTypes,
          lastModifiedAt: null,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await fetcher.close();
  }

  const payload = {
    site: config.site,
    generatedAt: buildDate.toISOString(),
    mode: useSample ? "sample" : "live",
    feeds: results,
  };

  await writeFile(path.join(distDataDir, "feeds.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  if (successCount === 0) {
    throw new Error("No feeds were generated successfully.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
