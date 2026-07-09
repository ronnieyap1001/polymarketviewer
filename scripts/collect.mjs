#!/usr/bin/env node
// Collects active Polymarket markets from the public Gamma API and writes
// them to data/markets.json for the static site to render.
//
// Docs: https://docs.polymarket.com/api-reference/introduction
// Gamma API base: https://gamma-api.polymarket.com (no auth required)

import { writeFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const GAMMA_BASE = "https://gamma-api.polymarket.com";

// Top-level Polymarket categories, keyed by their Gamma API tag id.
// (Looked up via GET /tags/slug/<slug> for each nav category on polymarket.com)
const CATEGORY_TAG_IDS = {
  1: "Sports",
  2: "Politics",
  21: "Crypto",
  74: "Science",
  84: "Weather",
  107: "Business",
  144: "Elections",
  154: "Middle East",
  596: "Culture",
  1401: "Tech",
  100328: "Economy",
  101970: "World",
};

const PAGE_SIZE = 100;
const MAX_EVENTS = 1500; // safety cap on how many events we page through per run
const PER_CATEGORY_LIMIT = 50; // keep the site fast and the JSON small
const RECENT_CLOSED_SLOTS = 8; // reserved per-category slots for markets that just resolved
const RECENT_CLOSED_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // show resolved markets for 3 days

function categoryFor(event) {
  const tags = event.tags || [];
  for (const tag of tags) {
    const name = CATEGORY_TAG_IDS[Number(tag.id)];
    if (name) return name;
  }
  return "Other";
}

function safeParseArray(json) {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchEventsPage(offset) {
  const url = new URL(`${GAMMA_BASE}/events`);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("active", "true");
  url.searchParams.set("order", "volume24hr");
  url.searchParams.set("ascending", "false");

  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Gamma API request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function collect() {
  const markets = [];
  const seenMarketIds = new Set();
  let offset = 0;

  while (offset < MAX_EVENTS) {
    const page = await fetchEventsPage(offset);
    if (!Array.isArray(page) || page.length === 0) break;

    for (const event of page) {
      const category = categoryFor(event);
      for (const market of event.markets || []) {
        if (seenMarketIds.has(market.id)) continue;

        const closed = Boolean(market.closed);
        const closedTime = market.closedTime ? new Date(market.closedTime).toISOString() : null;
        if (closed && (!closedTime || Date.now() - new Date(closedTime).getTime() > RECENT_CLOSED_WINDOW_MS)) {
          // Drop markets that resolved too long ago to be worth showing.
          continue;
        }
        seenMarketIds.add(market.id);

        markets.push({
          id: market.id,
          question: market.question || event.title,
          category,
          eventTitle: event.title,
          eventSlug: event.slug,
          marketSlug: market.slug,
          outcomes: safeParseArray(market.outcomes),
          outcomePrices: safeParseArray(market.outcomePrices).map(Number),
          volume: Number(market.volumeNum ?? market.volume ?? 0),
          volume24hr: Number(market.volume24hr ?? 0),
          liquidity: Number(market.liquidityNum ?? market.liquidity ?? 0),
          startDate: market.startDateIso || market.startDate || null,
          endDate: market.endDateIso || market.endDate || null,
          closed,
          closedTime,
          url: `https://polymarket.com/event/${event.slug}`,
        });
      }
    }

    offset += PAGE_SIZE;
    if (page.length < PAGE_SIZE) break;
  }

  return trimByCategory(markets, PER_CATEGORY_LIMIT, RECENT_CLOSED_SLOTS);
}

// Keep only the top N markets per category so every category stays
// represented instead of being crowded out by whatever is trending
// hardest (e.g. a World Cup) on a given day. Most slots go to open
// markets ranked by 24h volume; a handful are reserved for markets
// that resolved in the last few days so their outcome stays visible.
function trimByCategory(markets, perCategoryLimit, recentClosedSlots) {
  const byCategory = new Map();
  for (const m of markets) {
    if (!byCategory.has(m.category)) byCategory.set(m.category, []);
    byCategory.get(m.category).push(m);
  }

  const trimmed = [];
  for (const group of byCategory.values()) {
    const open = group.filter((m) => !m.closed);
    const recentlyClosed = group.filter((m) => m.closed);

    open.sort((a, b) => b.volume24hr - a.volume24hr);
    recentlyClosed.sort((a, b) => b.volume - a.volume);

    const openSlots = perCategoryLimit - recentClosedSlots;
    trimmed.push(...open.slice(0, openSlots));
    trimmed.push(...recentlyClosed.slice(0, recentClosedSlots));
  }

  trimmed.sort((a, b) => b.volume24hr - a.volume24hr);
  return trimmed;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const collectedAt = new Date().toISOString();
  const markets = await collect();

  const byCategory = markets.reduce((acc, m) => {
    acc[m.category] = (acc[m.category] || 0) + 1;
    return acc;
  }, {});

  const snapshot = {
    collectedAt,
    count: markets.length,
    categories: Object.keys(byCategory).sort(),
    markets,
  };

  await writeFile(
    path.join(DATA_DIR, "markets.json"),
    JSON.stringify(snapshot, null, 2) + "\n"
  );

  const historyLine =
    JSON.stringify({
      date: collectedAt.slice(0, 10),
      collectedAt,
      count: markets.length,
      byCategory,
    }) + "\n";
  await appendFile(path.join(DATA_DIR, "history.jsonl"), historyLine);

  console.log(`Collected ${markets.length} markets across ${snapshot.categories.length} categories.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
