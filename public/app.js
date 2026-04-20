const storageKey = "portfolio-pulse-state-v1";

const defaultState = {
  selectedPortfolioId: "core",
  portfolios: [
    {
      id: "core",
      name: "Core Portfolio",
      holdings: [
        {
          symbol: "AAPL",
          quoteType: "EQUITY",
          shares: 15,
          costBasis: 190,
          purchaseDate: "2024-01-15",
          notes: "Example stock holding",
        },
        {
          symbol: "VTSAX",
          quoteType: "MUTUALFUND",
          shares: 22.5,
          costBasis: 119.5,
          purchaseDate: "2023-07-10",
          notes: "Example mutual fund holding",
        },
      ],
    },
  ],
};

const elements = {
  portfolioList: document.querySelector("#portfolio-list"),
  portfolioName: document.querySelector("#portfolio-name"),
  portfolioMeta: document.querySelector("#portfolio-meta"),
  providerBanner: document.querySelector("#provider-banner"),
  storageBanner: document.querySelector("#storage-banner"),
  saveStatus: document.querySelector("#save-status"),
  holdingsTable: document.querySelector("#holdings-table"),
  refreshedAt: document.querySelector("#refreshed-at"),
  totalValue: document.querySelector("#total-value"),
  totalReturn: document.querySelector("#total-return"),
  annualDividend: document.querySelector("#annual-dividend"),
  holdingForm: document.querySelector("#holding-form"),
  symbolInput: document.querySelector("#symbol-input"),
  searchResults: document.querySelector("#search-results"),
  refreshBtn: document.querySelector("#refresh-btn"),
  newPortfolioBtn: document.querySelector("#new-portfolio-btn"),
  deletePortfolioBtn: document.querySelector("#delete-portfolio-btn"),
  portfolioTemplate: document.querySelector("#portfolio-item-template"),
};

let state = loadState();
let lastSnapshot = {
  holdings: [],
  summary: {},
  dataProviders: [],
  refreshedAt: null,
};
let searchTimer = null;
let selectedSearchResult = null;
let saveTimer = null;
let isHydratingFromServer = false;
let storageMode = "";

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.portfolios?.length) {
      return saved;
    }
  } catch (error) {
    console.error("Unable to load saved state", error);
  }

  return structuredClone(defaultState);
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  if (isHydratingFromServer) {
    return;
  }
  scheduleServerSave();
}

function getSelectedPortfolio() {
  return (
    state.portfolios.find(
      (portfolio) => portfolio.id === state.selectedPortfolioId
    ) || state.portfolios[0]
  );
}

function formatCurrency(value, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatPercent(value) {
  if (typeof value !== "number") {
    return "-";
  }

  return `${(value * 100).toFixed(2)}%`;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function renderPortfolios() {
  const selected = getSelectedPortfolio();
  elements.portfolioList.innerHTML = "";

  state.portfolios.forEach((portfolio) => {
    const fragment = elements.portfolioTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".portfolio-item");
    button.classList.toggle("active", portfolio.id === selected.id);
    fragment.querySelector(".portfolio-item-name").textContent = portfolio.name;
    fragment.querySelector(".portfolio-item-count").textContent = `${portfolio.holdings.length} holdings`;
    button.addEventListener("click", () => {
      state.selectedPortfolioId = portfolio.id;
      saveState();
      render();
      refreshSnapshot();
    });
    elements.portfolioList.appendChild(fragment);
  });
}

function renderSummary() {
  const selected = getSelectedPortfolio();
  elements.portfolioName.textContent = selected.name;
  elements.portfolioMeta.textContent = `${selected.holdings.length} holdings across stocks and funds`;

  const providers = lastSnapshot.dataProviders || [];
  if (providers.length) {
    const isFallback = providers.some((provider) => provider.includes("Yahoo"));
    elements.providerBanner.className = `provider-banner${isFallback ? " fallback" : ""}`;
    elements.providerBanner.textContent =
      providers.length === 1
        ? `Data source: ${providers[0]}`
        : `Data sources: ${providers.join(" + ")}`;
  } else {
    elements.providerBanner.className = "provider-banner hidden";
    elements.providerBanner.textContent = "";
  }

  if (storageMode) {
    elements.storageBanner.className = "storage-banner";
    elements.storageBanner.textContent = `Saving to ${storageMode}`;
  } else {
    elements.storageBanner.className = "storage-banner hidden";
    elements.storageBanner.textContent = "";
  }

  const summary = lastSnapshot.summary || {};
  const returnClass =
    (summary.totalReturn || 0) >= 0 ? "positive" : "negative";

  elements.totalValue.textContent = formatCurrency(summary.totalMarketValue || 0);
  elements.totalReturn.innerHTML = `
    <span class="metric-primary ${returnClass}">${formatCurrency(summary.totalReturn || 0)}</span>
    <span class="metric-secondary">${formatPercent(summary.totalReturnPercent)}</span>
  `;
  elements.totalReturn.className = "";
  elements.annualDividend.textContent = formatCurrency(summary.annualDividendIncome || 0);
  elements.refreshedAt.textContent = lastSnapshot.refreshedAt
    ? `Last refresh ${new Date(lastSnapshot.refreshedAt).toLocaleTimeString()}`
    : "Not refreshed yet";
}

function setSaveStatus(message, isError = false) {
  elements.saveStatus.textContent = message;
  elements.saveStatus.className = isError ? "save-status negative" : "muted save-status";
}

async function readErrorMessage(response, fallbackMessage) {
  try {
    const payload = await response.json();
    return payload.details || payload.error || `${fallbackMessage} (${response.status})`;
  } catch (error) {
    return `${fallbackMessage} (${response.status})`;
  }
}

function renderHoldings() {
  const selected = getSelectedPortfolio();
  const snapshotMap = new Map(
    (lastSnapshot.holdings || []).map((holding) => [holding.symbol, holding])
  );

  if (!selected.holdings.length) {
    elements.holdingsTable.innerHTML = `<tr><td colspan="11" class="empty-state">No holdings yet. Add a stock or mutual fund from the form on the left.</td></tr>`;
    return;
  }

  elements.holdingsTable.innerHTML = selected.holdings
    .map((holding) => {
      const live = snapshotMap.get(holding.symbol.toUpperCase());
      const returnClass =
        (live?.totalReturn || 0) >= 0 ? "positive" : "negative";
      const yieldText = live ? formatPercent(live.dividendYield) : "-";
      const dividendMeta = live?.exDividendDate
        ? `<div class="holding-name">Ex-div ${formatDate(live.exDividendDate)}</div>`
        : `<div class="holding-name">No ex-dividend date available</div>`;

      return `
        <tr>
          <td>
            <div class="holding-symbol">${holding.symbol.toUpperCase()}</div>
            <div class="holding-name">${live?.name || holding.notes || "Waiting for live quote"}</div>
            <div class="chip">${live?.quoteType || "Holding"}</div>
          </td>
          <td>
            <div>${live ? formatCurrency(live.price, live.currency) : "-"}</div>
            <div class="holding-name">${live?.exchange || "No exchange data"}</div>
          </td>
          <td class="${live?.dayChange >= 0 ? "positive" : "negative"}">
            ${live?.dayChange != null ? formatCurrency(live.dayChange, live.currency) : "-"}
          </td>
          <td class="${live?.dayChange >= 0 ? "positive" : "negative"}">
            ${live?.dayChangePercent != null ? formatPercent((live.dayChangePercent || 0) / 100) : "-"}
          </td>
          <td>${Number(holding.shares).toLocaleString()}</td>
          <td>${live ? formatCurrency(live.marketValue, live.currency) : "-"}</td>
          <td class="${returnClass}">
            ${live ? formatCurrency(live.totalReturn, live.currency) : "-"}
          </td>
          <td class="${returnClass}">
            ${live ? formatPercent(live.totalReturnPercent) : "-"}
          </td>
          <td>
            <div>${yieldText}</div>
            ${dividendMeta}
          </td>
          <td>${live ? formatCurrency(live.annualDividendIncome, live.currency) : "-"}</td>
          <td>
            <button class="table-action" type="button" data-symbol="${holding.symbol.toUpperCase()}">Remove</button>
          </td>
        </tr>
      `;
    })
    .join("");

  elements.holdingsTable.querySelectorAll("[data-symbol]").forEach((button) => {
    button.addEventListener("click", () => removeHolding(button.dataset.symbol));
  });
}

function render() {
  renderPortfolios();
  renderSummary();
  renderHoldings();
}

function addPortfolio() {
  const name = window.prompt("Portfolio name");
  if (!name) {
    return;
  }

  const portfolio = {
    id: makeId(),
    name: name.trim(),
    holdings: [],
  };

  state.portfolios.push(portfolio);
  state.selectedPortfolioId = portfolio.id;
  saveState();
  lastSnapshot = { holdings: [], summary: {}, refreshedAt: null };
  render();
}

function deleteSelectedPortfolio() {
  if (state.portfolios.length === 1) {
    window.alert("Keep at least one portfolio available.");
    return;
  }

  const selected = getSelectedPortfolio();
  const confirmed = window.confirm(`Delete ${selected.name}?`);
  if (!confirmed) {
    return;
  }

  state.portfolios = state.portfolios.filter(
    (portfolio) => portfolio.id !== selected.id
  );
  state.selectedPortfolioId = state.portfolios[0].id;
  saveState();
  lastSnapshot = { holdings: [], summary: {}, refreshedAt: null };
  render();
  refreshSnapshot();
}

function upsertHolding(holding) {
  const portfolio = getSelectedPortfolio();
  const symbol = holding.symbol.toUpperCase();
  const existingIndex = portfolio.holdings.findIndex(
    (item) => item.symbol.toUpperCase() === symbol
  );

  if (existingIndex >= 0) {
    portfolio.holdings[existingIndex] = { ...holding, symbol };
  } else {
    portfolio.holdings.unshift({ ...holding, symbol });
  }

  saveState();
}

function removeHolding(symbol) {
  const portfolio = getSelectedPortfolio();
  portfolio.holdings = portfolio.holdings.filter(
    (holding) => holding.symbol.toUpperCase() !== symbol.toUpperCase()
  );
  saveState();
  render();
  refreshSnapshot();
}

async function refreshSnapshot() {
  const portfolio = getSelectedPortfolio();

  if (!portfolio?.holdings?.length) {
    lastSnapshot = {
      holdings: [],
      summary: {
        totalMarketValue: 0,
        totalCost: 0,
        totalReturn: 0,
        totalReturnPercent: null,
        annualDividendIncome: 0,
      },
      dataProviders: [],
      refreshedAt: null,
    };
    render();
    return;
  }

  elements.refreshedAt.textContent = "Refreshing live prices...";

  try {
    const response = await fetch("/api/portfolio-snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holdings: portfolio.holdings }),
    });

    if (!response.ok) {
      throw new Error("Snapshot request failed");
    }

    lastSnapshot = await response.json();
    render();
  } catch (error) {
    console.error(error);
    elements.refreshedAt.textContent = "Live refresh failed. Try again.";
  }
}

async function pushStateToServer() {
  try {
    setSaveStatus("Saving portfolios...");
    const response = await fetch("/api/app-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Save request failed"));
    }

    const payload = await response.json();
    state = payload.state;
    storageMode = payload.storageMode || storageMode;
    localStorage.setItem(storageKey, JSON.stringify(state));
    setSaveStatus(
      payload.savedAt
        ? `Saved ${new Date(payload.savedAt).toLocaleTimeString()}`
        : "Saved"
    );
  } catch (error) {
    console.error(error);
    setSaveStatus(`Save failed. ${error.message}`, true);
  }
}

function scheduleServerSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    pushStateToServer();
  }, 250);
}

async function loadStateFromServer() {
  try {
    const response = await fetch("/api/app-state");
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Unable to load saved state"));
    }

    const payload = await response.json();
    isHydratingFromServer = true;
    state = payload.state;
    storageMode = payload.storageMode || "";
    localStorage.setItem(storageKey, JSON.stringify(state));
    lastSnapshot = {
      holdings: [],
      summary: {},
      dataProviders: [],
      refreshedAt: null,
    };
    render();
    setSaveStatus(
      payload.savedAt
        ? `Loaded shared save from ${new Date(payload.savedAt).toLocaleString()}`
        : "Loaded shared save"
    );
  } catch (error) {
    console.error(error);
    setSaveStatus(`Using browser-only data. ${error.message}`, true);
  } finally {
    isHydratingFromServer = false;
    refreshSnapshot();
  }
}

async function searchSymbols(query) {
  if (query.trim().length < 2) {
    elements.searchResults.innerHTML = "";
    return;
  }

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();

    elements.searchResults.innerHTML = (data.results || [])
      .slice(0, 5)
      .map(
        (result) => `
          <button class="search-result" type="button" data-symbol="${result.symbol}" data-quote-type="${result.quoteType || ""}" data-name="${result.name || ""}">
            <strong>${result.symbol}</strong>
            <span>${result.name}</span>
            <span class="holding-name">${result.quoteType} ${result.exchange ? `- ${result.exchange}` : ""}</span>
          </button>
        `
      )
      .join("");

    elements.searchResults.querySelectorAll("[data-symbol]").forEach((button) => {
      button.addEventListener("click", () => {
        elements.symbolInput.value = button.dataset.symbol;
        selectedSearchResult = {
          symbol: button.dataset.symbol,
          quoteType: button.dataset.quoteType || "",
          name: button.dataset.name || "",
        };
        elements.searchResults.innerHTML = "";
      });
    });
  } catch (error) {
    console.error(error);
  }
}

elements.holdingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  upsertHolding({
    symbol: String(formData.get("symbol") || "").trim(),
    quoteType:
      selectedSearchResult &&
      selectedSearchResult.symbol.toUpperCase() === String(formData.get("symbol") || "").trim().toUpperCase()
        ? selectedSearchResult.quoteType
        : "",
    shares: Number(formData.get("shares")),
    costBasis: Number(formData.get("costBasis")),
    purchaseDate: String(formData.get("purchaseDate") || ""),
    notes: String(formData.get("notes") || "").trim(),
  });

  event.currentTarget.reset();
  selectedSearchResult = null;
  elements.searchResults.innerHTML = "";
  render();
  await refreshSnapshot();
});

elements.symbolInput.addEventListener("input", (event) => {
  if (
    !selectedSearchResult ||
    selectedSearchResult.symbol.toUpperCase() !== String(event.target.value || "").trim().toUpperCase()
  ) {
    selectedSearchResult = null;
  }
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchSymbols(event.target.value);
  }, 250);
});

elements.refreshBtn.addEventListener("click", refreshSnapshot);
elements.newPortfolioBtn.addEventListener("click", addPortfolio);
elements.deletePortfolioBtn.addEventListener("click", deleteSelectedPortfolio);

render();
loadStateFromServer();
