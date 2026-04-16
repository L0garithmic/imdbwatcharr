# IMDb Watchlist to Radarr RSS Worker

This project is a Cloudflare Worker plus Cloudflare Pages proxy that turns public IMDb lists and watchlists into Radarr-compatible RSS feeds.

Flow:

1. Open the site on `imdbwatcharr.pages.dev`
2. Paste a public IMDb watchlist or list URL
3. Get back deterministic movie and TV feed URLs derived from the IMDb identifier
4. Use the movie URL in Radarr's `RSS List` and the TV URL in Sonarr's `RSS List`

Examples:

- Radarr movie feed: `https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist/` becomes `https://imdbwatcharr.pages.dev/p/p.kdbeq6dtmzzpiin4k7t4fnunf4`
- Sonarr TV feed: `https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist/` becomes `https://imdbwatcharr.pages.dev/sonarr/p/p.kdbeq6dtmzzpiin4k7t4fnunf4`
- Radarr movie feed: `https://www.imdb.com/list/ls006123300/` becomes `https://imdbwatcharr.pages.dev/l/ls006123300`
- Sonarr TV feed: `https://www.imdb.com/list/ls006123300/` becomes `https://imdbwatcharr.pages.dev/sonarr/l/ls006123300`

## Architecture

- Cloudflare Worker serves the UI, API, and RSS generation logic
- Cloudflare Pages exposes the public `pages.dev` hostname and proxies requests to the Worker
- D1 stores feed metadata plus the last successful snapshot of all IMDb items
- Browser Rendering fetches IMDb pages and lets the parser extract data from stable page payloads such as `#__NEXT_DATA__`
- RSS is generated dynamically when a deterministic route is requested

## Routes

- `GET /` simple input form
- `POST /api/create` normalize an IMDb URL, create the feed record if needed, refresh it, and return both public RSS URLs
- `GET /p/:profileId` dynamically serve the Radarr movie feed for a watchlist
- `GET /l/:listId` dynamically serve the Radarr movie feed for a list
- `GET /sonarr/p/:profileId` dynamically serve the Sonarr TV feed for a watchlist
- `GET /sonarr/l/:listId` dynamically serve the Sonarr TV feed for a list
- `GET /f/:imdbKey` optional generic Radarr route that infers the source from values like `ls...`, `p....`, or `ur...`
- `GET /sonarr/f/:imdbKey` optional generic Sonarr route with the same inference rules
- `GET /f/:slug.xml` legacy slug route that redirects to the deterministic path
- `GET /api/feeds/:slug` internal metadata lookup for stored feed records

## Local development

```bash
npm install
npm run check
npm run dev
```

For remote D1 migrations after the database exists:

```bash
npm run db:migrate:remote
```

## Deployment

This repo includes:

- [ci.yml](.github/workflows/ci.yml) for fixture-based parser checks
- [deploy-worker.yml](.github/workflows/deploy-worker.yml) for Worker deployment
- [deploy-pages-proxy.yml](.github/workflows/deploy-pages-proxy.yml) for the public `pages.dev` proxy

Required GitHub repo secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Important note

IMDb access is the hardest part of the system. The Worker uses Cloudflare Browser Rendering because direct fetches often hit IMDb bot protection. If Browser Rendering is unavailable, or IMDb returns a challenge page, refreshes can fail temporarily and the feed endpoint will serve the last stored error or snapshot until a later refresh succeeds.
