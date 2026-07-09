const DATA_URL = "data/markets.json";

const state = {
  markets: [],
  filtered: [],
  category: "",
  search: "",
  sortKey: "volume24hr",
  sortDir: "desc",
};

const els = {
  meta: document.getElementById("meta"),
  search: document.getElementById("search"),
  category: document.getElementById("category"),
  rowCount: document.getElementById("rowCount"),
  tbody: document.getElementById("table-body"),
  headers: document.querySelectorAll("#markets-table th[data-key]"),
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

function leadingOutcome(market) {
  const { outcomes, outcomePrices } = market;
  if (!outcomes?.length || !outcomePrices?.length) return { label: "—", pct: null };
  let best = 0;
  for (let i = 1; i < outcomePrices.length; i++) {
    if (outcomePrices[i] > outcomePrices[best]) best = i;
  }
  return { label: outcomes[best], pct: outcomePrices[best] };
}

function render() {
  const { search, category } = state;
  const q = search.trim().toLowerCase();

  state.filtered = state.markets.filter((m) => {
    if (category && m.category !== category) return false;
    if (q && !m.question.toLowerCase().includes(q)) return false;
    return true;
  });

  state.filtered.sort((a, b) => {
    const { sortKey, sortDir } = state;
    let av, bv;
    if (sortKey === "leadOutcome") {
      av = leadingOutcome(a).pct ?? -1;
      bv = leadingOutcome(b).pct ?? -1;
    } else if (sortKey === "endDate") {
      av = a.endDate ? new Date(a.endDate).getTime() : 0;
      bv = b.endDate ? new Date(b.endDate).getTime() : 0;
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
    els.tbody.innerHTML = `<tr><td colspan="6" class="status">No markets match your filters.</td></tr>`;
    return;
  }

  els.tbody.innerHTML = state.filtered
    .map((m) => {
      const lead = leadingOutcome(m);
      const pct = lead.pct != null ? `<span class="pct">${(lead.pct * 100).toFixed(0)}%</span>` : "";
      return `
        <tr>
          <td><span class="category-chip">${escapeHtml(m.category)}</span></td>
          <td><a class="market-link" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${escapeHtml(m.question)}</a></td>
          <td class="outcome">${escapeHtml(lead.label)} ${pct}</td>
          <td class="num">${formatMoney(m.volume24hr)}</td>
          <td class="num">${formatMoney(m.volume)}</td>
          <td>${formatDate(m.endDate)}</td>
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
    els.tbody.innerHTML = `<tr><td colspan="6" class="status">${escapeHtml(err.message)}</td></tr>`;
  }
}

init();
