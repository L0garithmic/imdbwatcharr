function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(value) {
  return `<![CDATA[${String(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function formatTitleWithYear(item) {
  return item.year ? `${item.title} (${item.year})` : item.title;
}

export function buildRssFeed({ feed, collection, feedUrl, buildDate }) {
  const channelTitle = feed.label || collection.sourceTitle;
  const channelDescription = [
    `${collection.sourceTitle} on IMDb`,
    `${collection.items.length} included`,
    `${collection.skippedItems.length} skipped`,
  ].join(" | ");

  const itemsXml = collection.items
    .map((item) => {
      const title = formatTitleWithYear(item);
      const itemUrl = `https://www.imdb.com/title/${item.imdbId}/`;
      const description = [
        `IMDb ID: ${item.imdbId}`,
        `Type: ${item.titleType}`,
        `Source: ${collection.sourceTitle}`,
      ].join(" | ");

      const pubDate = item.addedAt ? `\n      <pubDate>${new Date(item.addedAt).toUTCString()}</pubDate>` : "";

      return `    <item>
      <title>${cdata(title)}</title>
      <guid isPermaLink="false">${escapeXml(item.imdbId)}</guid>
      <link>${escapeXml(itemUrl)}</link>
      <description>${cdata(description)}</description>${pubDate}
    </item>`;
    })
    .join("\n");

  const selfLink = feedUrl
    ? `\n    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${cdata(channelTitle)}</title>
    <description>${cdata(channelDescription)}</description>
    <link>${escapeXml(feed.sourceUrl)}</link>${selfLink}
    <lastBuildDate>${buildDate.toUTCString()}</lastBuildDate>
${itemsXml}
  </channel>
</rss>
`;
}
