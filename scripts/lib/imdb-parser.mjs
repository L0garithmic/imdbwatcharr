import { load } from "cheerio";

const NEXT_DATA_SELECTOR = "#__NEXT_DATA__";

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function dedupeByImdbId(items) {
  const seen = new Set();
  const deduped = [];

  for (const item of items) {
    if (!item.imdbId || seen.has(item.imdbId)) {
      continue;
    }

    seen.add(item.imdbId);
    deduped.push(item);
  }

  return deduped;
}

function parseJsonLd($, pageTitle) {
  const scripts = $('script[type="application/ld+json"]')
    .toArray()
    .map((element) => $(element).html())
    .filter(Boolean);

  for (const scriptText of scripts) {
    let parsed;

    try {
      parsed = JSON.parse(scriptText);
    } catch {
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    const itemList = candidates.find((candidate) => candidate?.["@type"] === "ItemList" && Array.isArray(candidate?.itemListElement));

    if (!itemList) {
      continue;
    }

    const items = itemList.itemListElement
      .map((entry, index) => {
        const item = entry?.item ?? entry;
        const url = item?.url ?? "";
        const imdbId = /\/title\/(tt\d+)/.exec(url)?.[1] ?? "";

        if (!imdbId) {
          return null;
        }

        const titleType = String(item?.["@type"] ?? "movie");
        const normalizedType = titleType === "TVSeries" || titleType === "TVEpisode" ? "tvSeries" : "movie";
        const year = item?.datePublished ? Number(String(item.datePublished).slice(0, 4)) : undefined;

        return {
          imdbId,
          title: firstText(item?.name, item?.alternateName),
          year: Number.isInteger(year) ? year : undefined,
          titleType: normalizedType,
          position: Number.isInteger(entry?.position) ? entry.position : index + 1,
          addedAt: null,
        };
      })
      .filter(Boolean);

    return {
      mode: "json-ld",
      listKind: "list",
      sourceTitle: firstText($("h1").first().text(), pageTitle),
      authorName: "",
      listId: "",
      totalItems: items.length,
      hasNextPage: false,
      items: dedupeByImdbId(items),
      lastModifiedAt: null,
    };
  }

  return null;
}

function parseNextData($, pageTitle) {
  const nextDataText = $(NEXT_DATA_SELECTOR).html();

  if (!nextDataText) {
    return null;
  }

  const nextData = JSON.parse(nextDataText);
  const pageProps = nextData?.props?.pageProps ?? {};
  const mainColumnData = pageProps?.mainColumnData ?? {};
  const listContainer = mainColumnData?.list?.titleListItemSearch ?? mainColumnData?.predefinedList?.titleListItemSearch;

  if (!listContainer || !Array.isArray(listContainer.edges)) {
    return null;
  }

  const isPredefinedList = Boolean(mainColumnData?.predefinedList?.titleListItemSearch);
  const aboveTheFoldData = pageProps?.aboveTheFoldData ?? {};

  const items = listContainer.edges
    .map((edge, index) => {
      const listItem = edge?.listItem ?? {};
      const imdbId = firstText(listItem?.id, /\/title\/(tt\d+)/.exec(firstText(listItem?.url))?.[1]);

      if (!/^tt\d+$/.test(imdbId)) {
        return null;
      }

      const year = listItem?.releaseYear?.year ?? listItem?.releaseDate?.year;

      return {
        imdbId,
        title: firstText(listItem?.titleText?.text, listItem?.originalTitleText?.text),
        year: Number.isInteger(year) ? year : undefined,
        titleType: firstText(listItem?.titleType?.id, "unknown"),
        position: edge?.node?.absolutePosition ?? index + 1,
        addedAt: edge?.node?.createdDate ?? null,
      };
    })
    .filter(Boolean);

  return {
    mode: "next-data",
    listKind: isPredefinedList ? "watchlist" : "list",
    sourceTitle: firstText($("h1").first().text(), pageTitle),
    authorName: firstText(aboveTheFoldData?.authorName),
    listId: firstText(aboveTheFoldData?.listId),
    totalItems: Number.isInteger(listContainer?.total) ? listContainer.total : items.length,
    hasNextPage: Boolean(listContainer?.pageInfo?.hasNextPage),
    items: dedupeByImdbId(items),
    lastModifiedAt: aboveTheFoldData?.lastModifiedDate ?? null,
  };
}

function parseHtmlFallback($, pageTitle) {
  const selectors = [
    "li.ipc-metadata-list-summary-item",
    "div.lister-item",
  ];

  for (const selector of selectors) {
    const nodes = $(selector).toArray();

    if (nodes.length === 0) {
      continue;
    }

    const items = nodes
      .map((element, index) => {
        const section = $(element);
        const href =
          section.find('a[href*="/title/"]').first().attr("href") ??
          section.find('a[href*="/title/"]').attr("href") ??
          "";
        const imdbId = /\/title\/(tt\d+)/.exec(href)?.[1] ?? "";

        if (!imdbId) {
          return null;
        }

        const title =
          firstText(
            section.find("h3").first().text().replace(/^\d+\.\s*/, ""),
            section.find(".lister-item-header a").first().text(),
            section.find('img[alt]').first().attr("alt"),
          );
        const yearMatch = /\b(19|20)\d{2}\b/.exec(section.text());

        return {
          imdbId,
          title,
          year: yearMatch ? Number(yearMatch[0]) : undefined,
          titleType: "unknown",
          position: index + 1,
          addedAt: null,
        };
      })
      .filter(Boolean);

    return {
      mode: "html-fallback",
      listKind: "list",
      sourceTitle: firstText($("h1").first().text(), pageTitle),
      authorName: "",
      listId: "",
      totalItems: items.length,
      hasNextPage: false,
      items: dedupeByImdbId(items),
      lastModifiedAt: null,
    };
  }

  return null;
}

export function parseImdbHtml(html) {
  const $ = load(html);
  const pageTitle = firstText($("title").text()).replace(/\s+-\s+IMDb.*$/i, "").trim();

  const parsed =
    parseNextData($, pageTitle) ??
    parseJsonLd($, pageTitle) ??
    parseHtmlFallback($, pageTitle);

  if (!parsed) {
    const bodyText = $("body").text();
    if (/verify that you're not a robot|403 forbidden|access denied/i.test(bodyText)) {
      throw new Error("IMDb returned a bot-check or access-denied page instead of list data.");
    }

    throw new Error("Could not find IMDb list data in the fetched HTML.");
  }

  return parsed;
}
