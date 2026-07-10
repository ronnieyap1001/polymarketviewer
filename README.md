# Polymarket Viewer

A simple website that tracks Polymarket markets, refreshed daily, grouped by category.

- **Data source**: Polymarket's public [Gamma API](https://docs.polymarket.com/api-reference/introduction) (`https://gamma-api.polymarket.com`) — no API key needed.
- **Collection**: `scripts/collect.mjs` pulls active markets plus anything that resolved in the last 3 days, tags each one with a top-level category (Politics, Sports, Crypto, Elections, World, Economy, Culture, Tech, Business, Science, Weather, Middle East, or Other), keeps the top 50 per category (mostly ranked by 24h volume, with a few reserved slots for recently-closed markets), and writes `data/markets.json`. It also appends a one-line daily summary to `data/history.jsonl`.
- **Automation**: `.github/workflows/collect-daily.yml` runs the collector every day via GitHub Actions and commits the updated `data/markets.json` back to the repo — no server to run or maintain.
- **Site**: `index.html` + `app.js` + `style.css` is a plain static page (no build step) that fetches `data/markets.json` and renders a sortable, filterable, searchable table with:
  - Category, market question, and a link to the market on Polymarket
  - **Status** — Open, Overdue, or Closed (see below)
  - **Winning Entity** — the name of the outcome that won, once a market is closed
  - **Started / Ends** — the market's start and end dates
  - **Leading Outcome** and **Other Outcomes** — up to 3 outcomes total with their implied probabilities
  - **Hi/Lo Ratio** — highest outcome probability divided by the lowest, as a quick read on how lopsided a market is (higher = more one-sided). Capped at 1000x (shown as `1000x+`) instead of showing Infinity for fully-resolved 0%/100% markets.
  - **24h Volume** and **Total Volume**

  **Status** has three states: **Open** (still trading), **Overdue** (Polymarket hasn't
  closed it yet even though its scheduled end date has passed — common while a
  real-world event's outcome is still being confirmed), and **Closed** (resolved, with
  the winner in the Winning Entity column).

  Besides the category dropdown and search box, a **Filters** panel (containing the
  status filter alongside the rest) adds range filters for start date, end date, Hi/Lo
  ratio, minimum 24h volume, and minimum total volume, with a "Clear filters" button to
  reset them all.

  An **Export CSV** button downloads the current view (respecting all active filters,
  search, and sort order) as a CSV file. The row count is capped by the adjacent "Export
  up to ___ rows" box, which itself is hard-limited to 2000 rows regardless of what's typed in.

## Running the collector locally

```sh
node scripts/collect.mjs
```

This overwrites `data/markets.json` and appends to `data/history.jsonl`.

## Viewing the site locally

Any static file server works, e.g.:

```sh
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed URL in a browser.

## Enabling GitHub Pages (one-time setup)

1. Go to the repo's **Settings → Pages**.
2. Under "Build and deployment", set **Source** to "Deploy from a branch".
3. Pick the `main` branch and `/ (root)` folder, then save.

GitHub will publish the site at `https://<owner>.github.io/<repo>/`. Once the daily
Action runs, the page will show that day's data automatically — no rebuild step needed
since the page fetches `data/markets.json` at load time.

## Notes

- The `workflow_dispatch` trigger lets you run the collector on demand from the
  Actions tab instead of waiting for the daily schedule.
- Prices shown are the leading outcome's implied probability (last traded price),
  not guaranteed payouts.
