# IMDb Watchlist to Radarr RSS

This project builds static RSS feeds from public IMDb watchlists and public IMDb custom lists, then serves those feeds from GitHub Pages.

The design goal is reliability over cleverness:

- It fetches IMDb with a real browser context so AWS WAF bot checks can settle before parsing.
- It reads `#__NEXT_DATA__` first, which is much less brittle than scraping visible card markup.
- It keeps HTML and JSON-LD fallbacks in place so small IMDb layout shifts do not break the whole pipeline immediately.
- It publishes a status page that shows failed feeds instead of silently hiding them.

## What gets generated

- `dist/feeds/<feed-id>.xml`: Radarr-friendly RSS feeds
- `dist/data/feeds.json`: metadata for the GitHub Pages UI
- `dist/index.html`: a small dashboard for feed links and status

## Configure your own IMDb sources

Edit [config/lists.json](config/lists.json).

Each feed entry supports:

- `id`: lowercase slug used for the XML filename
- `label`: display name for the dashboard
- `sourceUrl`: a public IMDb custom list URL or public watchlist URL
- `allowedTitleTypes`: which IMDb title types make it into the RSS feed
- `maxItems`: hard cap on included items
- `sampleFixture`: local HTML fixture used by `npm run build:sample`

For Radarr, the safest default is to keep `allowedTitleTypes` set to `movie` and `tvMovie`.

## Local usage

```bash
npm install
npm run build:sample
npm run build
npm start
```

`build:sample` uses local fixtures only. `build` hits live IMDb pages.

## GitHub Pages deployment

1. Push this repository to GitHub.
2. In GitHub Pages settings, use **GitHub Actions** as the source.
3. The `Refresh Pages` workflow will build and deploy the site.
4. Copy the generated `feeds/<feed-id>.xml` URL into Radarr as an **RSS List** source.

## Notes

- Public watchlists can resolve to an `ls...` list behind the scenes. The parser supports both watchlist and custom list structures.
- IMDb can still hard-block particular runner IPs or change its internal data layout. When that happens, the dashboard will show the error instead of publishing an empty feed.
- If you want more control over what Radarr sees, tighten `allowedTitleTypes` further or add more feed entries with different filters.
