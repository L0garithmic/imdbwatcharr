const feedGrid = document.querySelector("#feed-grid");
const template = document.querySelector("#feed-card-template");
const buildMode = document.querySelector("#build-mode");
const generatedAt = document.querySelector("#generated-at");

function formatDate(isoString) {
  if (!isoString) {
    return "Unknown";
  }

  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function resolveFeedUrl(feedPath) {
  return new URL(feedPath, window.location.href).toString();
}

function createStatRow(label, value) {
  const fragment = document.createDocumentFragment();
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  fragment.append(dt, dd);
  return fragment;
}

function createLink(label, href) {
  const anchor = document.createElement("a");
  anchor.className = "action-link";
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = label;
  return anchor;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt("Copy this URL", text);
  }
}

function renderFeed(feed) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.status = feed.status;

  node.querySelector(".feed-kind").textContent = `${feed.listKind || "list"} • ${feed.parserMode || "unknown parser"}`;
  node.querySelector(".feed-title").textContent = feed.label;
  node.querySelector(".feed-source-title").textContent = feed.sourceTitle || feed.sourceUrl;

  const badge = node.querySelector(".status-badge");
  badge.textContent = feed.status === "ok" ? "Ready" : "Issue";

  const stats = node.querySelector(".feed-stats");
  stats.append(
    createStatRow("Included", String(feed.totalIncluded)),
    createStatRow("Skipped", String(feed.totalSkipped)),
    createStatRow("Allowed", feed.allowedTitleTypes.join(", ")),
    createStatRow("Updated", formatDate(feed.lastModifiedAt)),
  );

  const links = node.querySelector(".feed-links");
  links.append(createLink("Source", feed.sourceUrl));

  if (feed.feedPath) {
    const feedUrl = resolveFeedUrl(feed.feedPath);
    links.append(createLink("XML Feed", feedUrl));

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-button";
    copyButton.textContent = "Copy Feed URL";
    copyButton.addEventListener("click", () => copyText(feedUrl));
    links.append(copyButton);
  }

  if (feed.status !== "ok") {
    const errorLine = node.querySelector(".feed-error");
    errorLine.hidden = false;
    errorLine.textContent = feed.error || "Unknown error";
  }

  return node;
}

async function loadFeeds() {
  const response = await fetch("./data/feeds.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load feed metadata (${response.status}).`);
  }

  return response.json();
}

try {
  const payload = await loadFeeds();
  buildMode.textContent = payload.mode === "sample" ? "Sample Build" : "Live IMDb Build";
  generatedAt.textContent = `Generated ${formatDate(payload.generatedAt)}`;

  if (!Array.isArray(payload.feeds) || payload.feeds.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No feeds are configured yet.";
    feedGrid.replaceChildren(empty);
  } else {
    feedGrid.replaceChildren(...payload.feeds.map(renderFeed));
  }
} catch (error) {
  buildMode.textContent = "Metadata Error";
  generatedAt.textContent = "Could not load feed metadata.";
  const message = document.createElement("p");
  message.className = "empty-state";
  message.textContent = error instanceof Error ? error.message : String(error);
  feedGrid.replaceChildren(message);
}
