import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseImdbHtml } from "./imdb-parser.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withPageNumber(url, pageNumber) {
  const nextUrl = new URL(url);
  if (pageNumber <= 1) {
    nextUrl.searchParams.delete("page");
  } else {
    nextUrl.searchParams.set("page", String(pageNumber));
  }

  return nextUrl.toString();
}

async function fetchFixtureHtml(fixturesDir, fixtureName) {
  return readFile(path.join(fixturesDir, fixtureName), "utf8");
}

function finalizeCollection(feed, pages) {
  const seen = new Set();
  const rawItems = [];

  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.imdbId)) {
        continue;
      }

      seen.add(item.imdbId);
      rawItems.push(item);
    }
  }

  rawItems.sort((left, right) => left.position - right.position);

  const filteredItems = [];
  const skippedItems = [];

  for (const item of rawItems) {
    if (feed.allowedTitleTypes.includes(item.titleType)) {
      filteredItems.push(item);
    } else {
      skippedItems.push(item);
    }
  }

  return {
    mode: pages[0]?.mode ?? "unknown",
    listKind: pages[0]?.listKind ?? "list",
    sourceTitle: pages[0]?.sourceTitle || feed.label,
    authorName: pages[0]?.authorName || "",
    listId: pages[0]?.listId || "",
    lastModifiedAt: pages[0]?.lastModifiedAt || null,
    totalItems: pages[0]?.totalItems ?? rawItems.length,
    rawItems,
    items: filteredItems.slice(0, feed.maxItems),
    skippedItems,
  };
}

export async function createImdbFetcher({ fixturesDir, useSample = false }) {
  if (useSample) {
    return {
      async getCollection(feed) {
        if (!feed.sampleFixture) {
          throw new Error(`Feed "${feed.id}" is missing a sampleFixture for sample builds.`);
        }

        const html = await fetchFixtureHtml(fixturesDir, feed.sampleFixture);
        const parsed = parseImdbHtml(html);
        return finalizeCollection(feed, [parsed]);
      },
      async close() {},
    };
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
  });

  await context.route("**/*", async (route) => {
    const resourceType = route.request().resourceType();
    if (resourceType === "image" || resourceType === "font" || resourceType === "media") {
      await route.abort();
      return;
    }

    await route.continue();
  });

  const page = await context.newPage();

  async function fetchPageHtml(url) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    } catch {
      // IMDb often keeps working after the initial navigation promise times out.
    }

    await page.waitForSelector("body", { timeout: 20000 });
    await page.waitForTimeout(2500);
    return page.content();
  }

  return {
    async getCollection(feed) {
      const pages = [];
      const maxPages = 50;

      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
        const url = withPageNumber(feed.sourceUrl, pageNumber);
        const html = await fetchPageHtml(url);
        const parsed = parseImdbHtml(html);
        pages.push(parsed);

        if (!parsed.hasNextPage || parsed.items.length === 0 || pages.flatMap((entry) => entry.items).length >= feed.maxItems) {
          break;
        }

        await sleep(350);
      }

      return finalizeCollection(feed, pages);
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
