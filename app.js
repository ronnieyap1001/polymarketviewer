const DATA_URL = "data/markets.json";
const COLUMN_COUNT = 11;
const EXPORT_MAX_ROWS = 2000; // hard cap regardless of what's typed into the export box
const MIN_PRICE = 0.001; // floor used in place of 0 so the hi/lo ratio can't blow up to Infinity
const MAX_RATIO = 1000; // display/sort cap for fully-resolved (near 100%/0%) markets
const TODAY_STR = new Date().toISOString().slice(0, 10);

const state = {
  markets: [],
  filtered: [],
  category: "",
  search: "",
  statusFilter: "",
  startFrom: "",
  startTo: "",
  endFrom: "",
  endTo: "",
  ratioMin: null,
  ratioMax: null,
  vol24hrMin: 0,
  volumeMin: 0,
  sortKey: "volume24hr",
  sortDir: "desc",
};

const els = {
  meta: document.getElementById("meta"),
  search: document.getElementById("search"),
  category: document.getElementById("category"),
  statusFilter: document.getElementById("statusFilter"),
  rowCount: document.getElementById("rowCount"),
  tbody: document.getElementById("table-body"),
  headers: document.querySelectorAll("#markets-table th[data-key]"),
  toggleFilters: document.getElementById("toggleFilters"),
  filtersPanel: document.getElementById("filtersPanel"),
  clearFilters: document.getElementById("clearFilters"),
  startFrom: document.getElementById("startFrom"),
  startTo: document.getElementById("startTo"),
  endFrom: document.getElementById("endFrom"),
  endTo: document.getElementById("endTo"),
  ratioMin: document.getElementById("ratioMin"),
  ratioMax: document.getElementById("ratioMax"),
  vol24hrMin: document.getElementById("vol24hrMin"),
  volumeMin: document.getElementById("volumeMin"),
  exportLimit: document.getElementById("exportLimit"),
  exportCsv: document.getElementById("exportCsv"),
  exportHint: document.getElementById("exportHint"),
};

function formatMoney(n) {
  if (!n) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Normalizes any ISO date/datetime string to a plain YYYY-MM-DD string so it
// can be compared against <input type="date"> values.
function toDateStr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Outcomes sorted by implied probability, highest first.
function rankedOutcomes(market) {
  const { outcomes, outcomePrices } = market;
  if (!outcomes?.length || !outcomePrices?.length) return [];
  return outcomes
    .map((label, i) => ({ label, pct: outcomePrices[i] ?? null }))
    .filter((o) => o.pct !== null)
    .sort((a, b) => b.pct - a.pct);
}

function leadingOutcome(market) {
  const ranked = rankedOutcomes(market);
  return ranked[0] || { label: "—", pct: null };
}

// Up to 2 outcomes besides the leading one, e.g. for markets with 3+ options.
function otherOutcomes(market) {
  return rankedOutcomes(market).slice(1, 3);
}

// How lopsided the market is: highest implied probability divided by the
// lowest. A value near 1 means a close race; a large value means one
// outcome is heavily favored. Capped at MAX_RATIO (via the MIN_PRICE floor)
// so a fully-resolved 0%/100% market shows a finite number instead of
// Infinity.
function hiLoRatio(market) {
  const ranked = rankedOutcomes(market);
  if (ranked.length < 2) return null;
  const hi = ranked[0].pct;
  const lo = Math.max(ranked[ranked.length - 1].pct, MIN_PRICE);
  return Math.min(hi / lo, MAX_RATIO);
}

function formatRatio(ratio) {
  if (ratio === null) return "—";
  return ratio >= MAX_RATIO ? `${MAX_RATIO}x+` : `${ratio.toFixed(1)}x`;
}

// A market is "overdue" when Polymarket hasn't closed it yet but its
// scheduled end date has already passed (common while a real-world event
// is still being confirmed/resolved).
function isOverdue(market) {
  if (market.closed) return false;
  const endStr = toDateStr(market.endDate);
  return Boolean(endStr && endStr < TODAY_STR);
}

function statusInfo(market) {
  if (market.closed) return { kind: "closed", label: "Closed" };
  if (isOverdue(market)) return { kind: "overdue", label: "Overdue" };
  return { kind: "open", label: "Open" };
}

// Name of the outcome that won, once a market has closed. Null otherwise.
function winningEntity(market) {
  if (!market.closed) return null;
  const lead = leadingOutcome(market);
  return lead.pct != null ? lead.label : null;
}

function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADERS = [
  "Category", "Market", "Status", "Winning Entity", "Started", "Ends",
  "Leading Outcome", "Leading %", "Other Outcomes",
  "Hi/Lo Ratio", "24h Volume", "Total Volume", "URL",
];

function marketToCsvRow(m) {
  const lead = leadingOutcome(m);
  const others = otherOutcomes(m)
    .map((o) => `${o.label} ${(o.pct * 100).toFixed(0)}%`)
    .join("; ");
  const ratio = hiLoRatio(m);
  const status = statusInfo(m);

  return [
    m.category,
    m.question,
    status.label,
    winningEntity(m) || "",
    m.startDate ? toDateStr(m.startDate) : "",
    m.endDate ? toDateStr(m.endDate) : "",
    lead.label,
    lead.pct != null ? (lead.pct * 100).toFixed(0) : "",
    others,
    ratio === null ? "" : ratio.toFixed(2),
    m.volume24hr ?? 0,
    m.volume ?? 0,
    m.url,
  ];
}

function buildCsv(rows) {
  const lines = [CSV_HEADERS.map(csvField).join(",")];
  for (const m of rows) {
    lines.push(marketToCsvRow(m).map(csvField).join(","));
  }
  return lines.join("\r\n");
}

function exportCsvFile() {
  const requested = parseInt(els.exportLimit.value, 10);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, EXPORT_MAX_ROWS)
    : 100;
  els.exportLimit.value = limit;

  const rows = state.filtered.slice(0, limit);
  if (rows.length === 0) {
    els.exportHint.textContent = "Nothing to export — adjust your filters.";
    return;
  }

  const csv = buildCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);

  const a = document.createElement("a");
  a.href = url;
  a.download = `polymarket-markets-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  els.exportHint.textContent = `Exported ${rows.length} of ${state.filtered.length} row${state.filtered.length === 1 ? "" : "s"} in the current view.`;
}

function render() {
  const {
    search, category, statusFilter,
    startFrom, startTo, endFrom, endTo,
    ratioMin, ratioMax, vol24hrMin, volumeMin,
  } = state;
  const q = search.trim().toLowerCase();
  els.exportHint.textContent = "";

  state.filtered = state.markets.filter((m) => {
    if (category && m.category !== category) return false;
    if (statusFilter && statusInfo(m).kind !== statusFilter) return false;
    if (q && !m.question.toLowerCase().includes(q)) return false;

    const startStr = toDateStr(m.startDate);
    if (startFrom && (!startStr || startStr < startFrom)) return false;
    if (startTo && (!startStr || startStr > startTo)) return false;

    const endStr = toDateStr(m.endDate);
    if (endFrom && (!endStr || endStr < endFrom)) return false;
    if (endTo && (!endStr || endStr > endTo)) return false;

    if (ratioMin !== null || ratioMax !== null) {
      const ratio = hiLoRatio(m);
      if (ratioMin !== null && (ratio === null || ratio < ratioMin)) return false;
      if (ratioMax !== null && (ratio === null || ratio > ratioMax)) return false;
    }

    if (vol24hrMin && (m.volume24hr || 0) < vol24hrMin) return false;
    if (volumeMin && (m.volume || 0) < volumeMin) return false;

    return true;
  });

  state.filtered.sort((a, b) => {
    const { sortKey, sortDir } = state;
    let av, bv;
    if (sortKey === "leadOutcome") {
      av = leadingOutcome(a).pct ?? -1;
      bv = leadingOutcome(b).pct ?? -1;
    } else if (sortKey === "ratio") {
      av = hiLoRatio(a) ?? -1;
      bv = hiLoRatio(b) ?? -1;
    } else if (sortKey === "otherOutcomes") {
      av = otherOutcomes(a)[0]?.pct ?? -1;
      bv = otherOutcomes(b)[0]?.pct ?? -1;
    } else if (sortKey === "status") {
      const order = { open: 0, overdue: 1, closed: 2 };
      av = order[statusInfo(a).kind];
      bv = order[statusInfo(b).kind];
    } else if (sortKey === "winningEntity") {
      av = (winningEntity(a) || "").toLowerCase();
      bv = (winningEntity(b) || "").toLowerCase();
    } else if (sortKey === "endDate" || sortKey === "startDate") {
      av = a[sortKey] ? new Date(a[sortKey]).getTime() : 0;
      bv = b[sortKey] ? new Date(b[sortKey]).getTime() : 0;
    } else if (sortKey === "category" || sortKey === "question") {
      av = (a[sortKey] || "").toLowerCase();
      bv = (b[sortKey] || "").toLowerCase();
    } else {
      av = a[sortKey] ?? 0;
      bv = b[sortKey] ?? 0;
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  els.rowCount.textContent = `${state.filtered.length} market${state.filtered.length === 1 ? "" : "s"}`;

  if (state.filtered.length === 0) {
    els.tbody.innerHTML = `<tr><td colspan="${COLUMN_COUNT}" class="status-row">No markets match your filters.</td></tr>`;
    return;
  }

  els.tbody.innerHTML = state.filtered
    .map((m) => {
      const lead = leadingOutcome(m);
      const pct = lead.pct != null ? `<span class="pct">${(lead.pct * 100).toFixed(0)}%</span>` : "";

      const others = otherOutcomes(m);
      const othersText = others.length
        ? others.map((o) => `${escapeHtml(o.label)} ${(o.pct * 100).toFixed(0)}%`).join(", ")
        : "—";

      const ratio = hiLoRatio(m);
      const ratioText = formatRatio(ratio);

      const status = statusInfo(m);
      const statusHtml = `<span class="status-chip ${status.kind}">${status.label}</span>`;

      const winner = winningEntity(m);
      const winnerHtml = winner
        ? `<span class="winning-entity">${escapeHtml(winner)}</span>`
        : `<span class="winning-entity empty">—</span>`;

      return `
        <tr>
          <td><span class="category-chip">${escapeHtml(m.category)}</span></td>
          <td><a class="market-link" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${escapeHtml(m.question)}</a></td>
          <td>${statusHtml}</td>
          <td>${winnerHtml}</td>
          <td>${formatDate(m.startDate)}</td>
          <td>${formatDate(m.endDate)}</td>
          <td class="outcome">${escapeHtml(lead.label)} ${pct}</td>
          <td class="other-outcomes">${othersText}</td>
          <td class="num ratio">${ratioText}</td>
          <td class="num">${formatMoney(m.volume24hr)}</td>
          <td class="num">${formatMoney(m.volume)}</td>
        </tr>`;
    })
    .join("");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function updateSortIndicators() {
  els.headers.forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.key === state.sortKey) {
      th.classList.add(state.sortDir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

els.headers.forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      state.sortDir = key === "question" || key === "category" ? "asc" : "desc";
    }
    updateSortIndicators();
    render();
  });
});

els.search.addEventListener("input", (e) => {
  state.search = e.target.value;
  render();
});

els.category.addEventListener("change", (e) => {
  state.category = e.target.value;
  render();
});

els.statusFilter.addEventListener("change", (e) => {
  state.statusFilter = e.target.value;
  updateFiltersToggleState();
  render();
});

function updateFiltersToggleState() {
  const active =
    state.statusFilter ||
    state.startFrom || state.startTo || state.endFrom || state.endTo ||
    state.ratioMin !== null || state.ratioMax !== null ||
    state.vol24hrMin || state.volumeMin;
  els.toggleFilters.classList.toggle("has-active", Boolean(active));
}

function bindDateFilter(el, key) {
  el.addEventListener("change", (e) => {
    state[key] = e.target.value;
    updateFiltersToggleState();
    render();
  });
}

function bindNumberFilter(el, key) {
  el.addEventListener("input", (e) => {
    const v = e.target.value.trim();
    state[key] = v === "" ? null : Number(v);
    updateFiltersToggleState();
    render();
  });
}

function bindSelectFilter(el, key) {
  el.addEventListener("change", (e) => {
    state[key] = Number(e.target.value);
    updateFiltersToggleState();
    render();
  });
}

bindDateFilter(els.startFrom, "startFrom");
bindDateFilter(els.startTo, "startTo");
bindDateFilter(els.endFrom, "endFrom");
bindDateFilter(els.endTo, "endTo");
bindNumberFilter(els.ratioMin, "ratioMin");
bindNumberFilter(els.ratioMax, "ratioMax");
bindSelectFilter(els.vol24hrMin, "vol24hrMin");
bindSelectFilter(els.volumeMin, "volumeMin");

els.toggleFilters.addEventListener("click", () => {
  const expanded = els.toggleFilters.getAttribute("aria-expanded") === "true";
  els.toggleFilters.setAttribute("aria-expanded", String(!expanded));
  els.filtersPanel.hidden = expanded;
});

els.exportCsv.addEventListener("click", exportCsvFile);

els.exportLimit.addEventListener("change", () => {
  els.exportHint.textContent = "";
});

els.clearFilters.addEventListener("click", () => {
  Object.assign(state, {
    statusFilter: "",
    startFrom: "", startTo: "", endFrom: "", endTo: "",
    ratioMin: null, ratioMax: null, vol24hrMin: 0, volumeMin: 0,
  });
  els.statusFilter.value = "";
  els.startFrom.value = "";
  els.startTo.value = "";
  els.endFrom.value = "";
  els.endTo.value = "";
  els.ratioMin.value = "";
  els.ratioMax.value = "";
  els.vol24hrMin.value = "0";
  els.volumeMin.value = "0";
  updateFiltersToggleState();
  render();
});

async function init() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data (${res.status})`);
    const data = await res.json();

    state.markets = data.markets || [];
    data.categories?.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      els.category.appendChild(opt);
    });

    const collected = new Date(data.collectedAt);
    els.meta.textContent = `${data.count} markets · last collected ${collected.toLocaleString()}`;

    updateSortIndicators();
    render();
  } catch (err) {
    els.meta.textContent = "Could not load market data.";
    els.tbody.innerHTML = `<tr><td colspan="${COLUMN_COUNT}" class="status-row">${escapeHtml(err.message)}</td></tr>`;
  }
}

init();
