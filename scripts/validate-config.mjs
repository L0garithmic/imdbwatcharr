import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

await loadConfig(path.join(rootDir, "config", "lists.json"));
console.log("config/lists.json is valid.");
