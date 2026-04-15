# IMDb Watchlist to Radarr RSS Worker

This project is now a Cloudflare Worker app with one simple flow:

1. Open the site
2. Paste a public IMDb watchlist or list URL
3. Get back a stable RSS URL
4. Use that RSS URL in Radarr's `RSS List`

## Architecture

- Worker app serves the tiny frontend and API
- D1 stores feeds and feed items
- Browser Run / Browser Rendering fetches IMDb pages and lets the parser read `#__NEXT_DATA__`
- RSS is generated dynamically at `GET /f/<slug>.xml`

## Routes

- `GET /` simple input form
- `POST /api/create` create or refresh a feed from an IMDb URL
- `GET /api/feeds/:slug` metadata for a generated feed
- `GET /f/:slug.xml` Radarr-compatible RSS output

## Local files you need to finish

- Update `wrangler.toml` with the real `database_id` after creating the D1 database
- Provide valid Cloudflare credentials for `wrangler deploy`

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

Set these GitHub repo secrets before using the deploy workflow:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Important note

IMDb access is the tricky part of this whole project. The Worker is designed around Browser Run because direct fetches often hit IMDb bot protection. If Browser Run is not enabled on the account, or if Cloudflare still gets blocked by IMDb for a given request path, feed refreshes will fail and the feed endpoint will return the stored error until a later refresh succeeds.
