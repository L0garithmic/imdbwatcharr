import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicFeedPath, filterItemsForTarget, normalizeImdbUrl, parseFeedRoute, parseImdbHtml, summarizeItemsByTarget } from "../src/imdb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const listUrl = normalizeImdbUrl("https://www.imdb.com/list/ls008777572/?sort=list_order,asc");
assert(listUrl.canonicalUrl === "https://www.imdb.com/list/ls008777572/", "List URL normalization failed.");
assert(buildPublicFeedPath(listUrl) === "/radarr/l/ls008777572", "List feed path generation failed.");
assert(buildPublicFeedPath(listUrl, "sonarr") === "/sonarr/l/ls008777572", "List Sonarr path generation failed.");

const watchlistUrl = normalizeImdbUrl("https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist");
assert(watchlistUrl.canonicalUrl === "https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist/", "Watchlist URL normalization failed.");
assert(buildPublicFeedPath(watchlistUrl) === "/radarr/p/p.kdbeq6dtmzzpiin4k7t4fnunf4", "Watchlist feed path generation failed.");
assert(buildPublicFeedPath(watchlistUrl, "sonarr") === "/sonarr/p/p.kdbeq6dtmzzpiin4k7t4fnunf4", "Watchlist Sonarr path generation failed.");

const parsedListRoute = parseFeedRoute("/l/ls008777572");
assert(parsedListRoute?.canonicalUrl === listUrl.canonicalUrl, "Direct list route parsing failed.");

const parsedWatchlistRoute = parseFeedRoute("/p/p.kdbeq6dtmzzpiin4k7t4fnunf4");
assert(parsedWatchlistRoute?.canonicalUrl === watchlistUrl.canonicalUrl, "Direct watchlist route parsing failed.");
assert(parsedWatchlistRoute?.feedTarget === "radarr", "Default watchlist route should map to Radarr.");

const parsedSonarrListRoute = parseFeedRoute("/sonarr/l/ls008777572");
assert(parsedSonarrListRoute?.canonicalUrl === listUrl.canonicalUrl, "Direct Sonarr list route parsing failed.");
assert(parsedSonarrListRoute?.feedTarget === "sonarr", "Direct Sonarr list route should map to Sonarr.");

const parsedGenericRoute = parseFeedRoute("/f/ls008777572");
assert(parsedGenericRoute?.canonicalUrl === listUrl.canonicalUrl, "Generic feed route parsing failed for lists.");

const parsedSonarrGenericRoute = parseFeedRoute("/sonarr/f/ls008777572");
assert(parsedSonarrGenericRoute?.canonicalUrl === listUrl.canonicalUrl, "Generic Sonarr route parsing failed for lists.");
assert(parsedSonarrGenericRoute?.feedTarget === "sonarr", "Generic Sonarr route should map to Sonarr.");

const listFixture = await readFile(path.join(rootDir, "fixtures", "top-35-movies-for-public.html"), "utf8");
const parsedList = parseImdbHtml(listFixture);
assert(parsedList.parserMode === "next-data", "List fixture should parse through __NEXT_DATA__.");
assert(parsedList.items.length === 3, "List fixture should expose 3 raw items.");
assert(filterItemsForTarget(parsedList.items, "radarr").length === 2, "List fixture should expose 2 movie items for Radarr.");
assert(filterItemsForTarget(parsedList.items, "sonarr").length === 1, "List fixture should expose 1 series item for Sonarr.");
const listCounts = summarizeItemsByTarget(parsedList.items);
assert(listCounts.radarr === 2 && listCounts.sonarr === 1 && listCounts.total === 3, "List fixture count summary failed.");

const watchlistFixture = await readFile(path.join(rootDir, "fixtures", "imikedb-watchlist.html"), "utf8");
const parsedWatchlist = parseImdbHtml(watchlistFixture);
assert(parsedWatchlist.items.length === 3, "Watchlist fixture should expose 3 items.");
assert(filterItemsForTarget(parsedWatchlist.items, "radarr").length === 3, "Watchlist fixture should keep all sample items for Radarr.");
assert(filterItemsForTarget(parsedWatchlist.items, "sonarr").length === 0, "Watchlist fixture should expose no series items for Sonarr.");

console.log("Parser checks passed.");
