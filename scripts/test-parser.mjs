import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicFeedPath, filterMovieItems, normalizeImdbUrl, parseFeedRoute, parseImdbHtml } from "../src/imdb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const listUrl = normalizeImdbUrl("https://www.imdb.com/list/ls008777572/?sort=list_order,asc");
assert(listUrl.canonicalUrl === "https://www.imdb.com/list/ls008777572/", "List URL normalization failed.");
assert(buildPublicFeedPath(listUrl) === "/l/ls008777572", "List feed path generation failed.");

const watchlistUrl = normalizeImdbUrl("https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist");
assert(watchlistUrl.canonicalUrl === "https://www.imdb.com/user/p.kdbeq6dtmzzpiin4k7t4fnunf4/watchlist/", "Watchlist URL normalization failed.");
assert(buildPublicFeedPath(watchlistUrl) === "/p/p.kdbeq6dtmzzpiin4k7t4fnunf4", "Watchlist feed path generation failed.");

const parsedListRoute = parseFeedRoute("/l/ls008777572");
assert(parsedListRoute?.canonicalUrl === listUrl.canonicalUrl, "Direct list route parsing failed.");

const parsedWatchlistRoute = parseFeedRoute("/p/p.kdbeq6dtmzzpiin4k7t4fnunf4");
assert(parsedWatchlistRoute?.canonicalUrl === watchlistUrl.canonicalUrl, "Direct watchlist route parsing failed.");

const parsedGenericRoute = parseFeedRoute("/f/ls008777572");
assert(parsedGenericRoute?.canonicalUrl === listUrl.canonicalUrl, "Generic feed route parsing failed for lists.");

const listFixture = await readFile(path.join(rootDir, "fixtures", "top-35-movies-for-public.html"), "utf8");
const parsedList = parseImdbHtml(listFixture);
assert(parsedList.parserMode === "next-data", "List fixture should parse through __NEXT_DATA__.");
assert(parsedList.items.length === 3, "List fixture should expose 3 raw items.");
assert(filterMovieItems(parsedList.items).length === 2, "List fixture should filter TV items out.");

const watchlistFixture = await readFile(path.join(rootDir, "fixtures", "imikedb-watchlist.html"), "utf8");
const parsedWatchlist = parseImdbHtml(watchlistFixture);
assert(parsedWatchlist.items.length === 3, "Watchlist fixture should expose 3 items.");
assert(filterMovieItems(parsedWatchlist.items).length === 3, "Watchlist fixture should keep all sample items.");

console.log("Parser checks passed.");
