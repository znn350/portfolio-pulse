const defaultState = {
  selectedPortfolioId: "core",
  portfolios: [
    {
      id: "core",
      name: "Core Portfolio",
      holdings: [],
    },
  ],
};

const authErrorMessages = {
  google_not_configured:
    "Google sign-in is not configured yet. Add your Google OAuth environment variables on the server.",
  google_access_denied: "Google sign-in was canceled.",
  oauth_state_expired: "Your Google sign-in attempt expired. Try again.",
  oauth_state_mismatch: "The Google sign-in request could not be verified. Try again.",
  missing_auth_code: "Google sign-in did not return an authorization code.",
  not_registered:
    "This Google account is not registered for Portfolio Pulse. Ask an admin to add it to the server-side user list.",
  google_sign_in_failed:
    "Google sign-in failed on the server. Double-check your Google OAuth settings and redirect URI.",
};

const authSuccessMessages = {
  registered: "Your Google account is now registered as the first owner account.",
};

const themeStorageKey = "portfolio-pulse-theme";

const elements = {
  authShell: document.querySelector("#auth-shell"),
  authTitle: document.querySelector("#auth-title"),
  authSubtitle: document.querySelector("#auth-subtitle"),
  authStatus: document.querySelector("#auth-status"),
  googleLoginLink: document.querySelector("#google-login-link"),
  authNote: document.querySelector("#auth-note"),
  appShell: document.querySelector("#app-shell"),
  currentUserName: document.querySelector("#current-user-name"),
  currentUserMeta: document.querySelector("#current-user-meta"),
  toggleProfilePanelBtn: document.querySelector("#toggle-profile-panel-btn"),
  profilePanelBody: document.querySelector("#profile-panel-body"),
  themeToggleBtn: document.querySelector("#theme-toggle-btn"),
  logoutBtn: document.querySelector("#logout-btn"),
  adminPanel: document.querySelector("#admin-panel"),
  toggleAdminPanelBtn: document.querySelector("#toggle-admin-panel-btn"),
  adminPanelBody: document.querySelector("#admin-panel-body"),
  adminUserForm: document.querySelector("#admin-user-form"),
  adminEmailInput: document.querySelector("#admin-email-input"),
  adminNameInput: document.querySelector("#admin-name-input"),
  adminStatus: document.querySelector("#admin-status"),
  adminUsersList: document.querySelector("#admin-users-list"),
  portfolioList: document.querySelector("#portfolio-list"),
  portfolioName: document.querySelector("#portfolio-name"),
  portfolioMeta: document.querySelector("#portfolio-meta"),
  providerBanner: document.querySelector("#provider-banner"),
  storageBanner: document.querySelector("#storage-banner"),
  saveStatus: document.querySelector("#save-status"),
  marketOverview: document.querySelector("#market-overview"),
  marketRefreshedAt: document.querySelector("#market-refreshed-at"),
  holdingsTable: document.querySelector("#holdings-table"),
  refreshedAt: document.querySelector("#refreshed-at"),
  totalValue: document.querySelector("#total-value"),
  dayReturn: document.querySelector("#day-return"),
  totalReturn: document.querySelector("#total-return"),
  totalReturnCard: document.querySelector("#total-return-card"),
  annualDividend: document.querySelector("#annual-dividend"),
  toggleHeroPanelBtn: document.querySelector("#toggle-hero-panel-btn"),
  heroPanelBody: document.querySelector("#hero-panel-body"),
  holdingForm: document.querySelector("#holding-form"),
  holdingFormTitle: document.querySelector("#holding-form-title"),
  saveHoldingBtn: document.querySelector("#save-holding-btn"),
  cancelHoldingEditBtn: document.querySelector("#cancel-holding-edit-btn"),
  toggleHoldingFormBtn: document.querySelector("#toggle-holding-form-btn"),
  symbolInput: document.querySelector("#symbol-input"),
  symbolPreview: document.querySelector("#symbol-preview"),
  searchResults: document.querySelector("#search-results"),
  refreshBtn: document.querySelector("#refresh-btn"),
  newPortfolioBtn: document.querySelector("#new-portfolio-btn"),
  renamePortfolioBtn: document.querySelector("#rename-portfolio-btn"),
  deletePortfolioBtn: document.querySelector("#delete-portfolio-btn"),
  portfolioTemplate: document.querySelector("#portfolio-item-template"),
};

let currentUser = null;
let state = structuredClone(defaultState);
let lastSnapshot = {
  holdings: [],
  summary: {},
  dataProviders: [],
  refreshedAt: null,
};
let lastMarketSnapshot = {
  items: [],
  refreshedAt: null,
};
let portfolioPerformanceById = {};
let searchTimer = null;
let quotePreviewTimer = null;
let selectedSearchResult = null;
let saveTimer = null;
let isHydratingFromServer = false;
let storageMode = "";
let isHoldingFormOpen = false;
let isHeroPanelOpen = false;
let isProfilePanelOpen = false;
let isAdminPanelOpen = false;
let adminUsers = [];
let draggedHoldingSymbol = null;
let editingHoldingSymbol = null;
let currentTheme = "light";
let quotePreviewRequestId = 0;

function getStoredTheme() {
  const savedTheme = localStorage.getItem(themeStorageKey);
  return savedTheme === "dark" ? "dark" : "light";
}

function syncThemeToggleLabel() {
  if (!elements.themeToggleBtn) {
    return;
  }

  elements.themeToggleBtn.textContent =
    currentTheme === "dark" ? "Light Mode" : "Dark Mode";
  elements.themeToggleBtn.setAttribute(
    "aria-pressed",
    String(currentTheme === "dark")
  );
}

function applyTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = currentTheme;
  localStorage.setItem(themeStorageKey, currentTheme);
  syncThemeToggleLabel();
}

function toggleTheme() {
  applyTheme(currentTheme === "dark" ? "light" : "dark");
}

function getUserStorageKey(user) {
  return user ? `portfolio-pulse-state:${user.id}` : "";
}

function consumeAuthFlash() {
  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get("auth_error");
  const successCode = params.get("auth_success");

  if (!errorCode && !successCode) {
    return null;
  }

  params.delete("auth_error");
  params.delete("auth_success");
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextUrl);

  if (errorCode) {
    return {
      message: authErrorMessages[errorCode] || "Sign-in failed.",
      isError: true,
    };
  }

  return {
    message: authSuccessMessages[successCode] || "",
    isError: false,
  };
}

function resetStateForSignedOutUser() {
  currentUser = null;
  state = structuredClone(defaultState);
  lastSnapshot = {
    holdings: [],
    summary: {},
    dataProviders: [],
    refreshedAt: null,
  };
  lastMarketSnapshot = {
    items: [],
    refreshedAt: null,
  };
  portfolioPerformanceById = {};
  storageMode = "";
  selectedSearchResult = null;
  isAdminPanelOpen = false;
  adminUsers = [];
  clearTimeout(saveTimer);
  clearTimeout(searchTimer);
}

function setAuthMode(needsSetup, googleAuthEnabled) {
  elements.authTitle.textContent = needsSetup
    ? "Register the first Google account"
    : "Sign in with Google";
  elements.authSubtitle.textContent = needsSetup
    ? "The first approved Google account becomes the owner. After that, only registered Google accounts can enter the app."
    : "Portfolio Pulse now uses Google as the identity provider, but access is still limited to Google accounts registered on the server.";
  elements.googleLoginLink.textContent = needsSetup
    ? "Continue With Google To Register"
    : "Continue With Google";
  elements.googleLoginLink.classList.toggle("disabled", !googleAuthEnabled);
  elements.googleLoginLink.setAttribute(
    "aria-disabled",
    String(!googleAuthEnabled)
  );
  elements.googleLoginLink.href = googleAuthEnabled ? "/api/auth/google" : "#";
  elements.authNote.textContent = googleAuthEnabled
    ? needsSetup
      ? "After the first account is created, additional users must already exist in the server-side allowlist to sign in."
      : "If a Google account is not already registered in the server-side user store, access will be denied."
    : "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, and make sure the Google redirect URI points to /api/auth/google/callback.";
}

function showAuthShell(message = "", isError = false, needsSetup = false, googleAuthEnabled = true) {
  setAuthMode(needsSetup, googleAuthEnabled);
  elements.authShell.classList.remove("hidden");
  elements.appShell.classList.add("hidden");
  elements.authStatus.textContent = message;
  elements.authStatus.className = isError ? "form-status negative" : "form-status";
}

function showAppShell(user) {
  currentUser = user;
  elements.currentUserName.textContent = user.name || user.email;
  elements.currentUserMeta.textContent =
    user.role === "owner" ? `${user.email} · Owner` : user.email;
  elements.authShell.classList.add("hidden");
  elements.appShell.classList.remove("hidden");
  elements.adminPanel.classList.toggle("hidden", user.role !== "owner");
  syncProfilePanelVisibility();
  syncAdminPanelVisibility();
}

function cacheStateLocally() {
  if (!currentUser) {
    return;
  }

  localStorage.setItem(getUserStorageKey(currentUser), JSON.stringify(state));
}

function tryHydrateFromLocalCache(user) {
  try {
    const saved = JSON.parse(localStorage.getItem(getUserStorageKey(user)));
    if (saved?.portfolios?.length) {
      state = saved;
      render();
    }
  } catch (error) {
    console.error("Unable to load cached profile state", error);
  }
}

function saveState() {
  cacheStateLocally();
  if (isHydratingFromServer || !currentUser) {
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

function formatMarketNumber(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatSignedMarketNumber(value) {
  if (typeof value !== "number") {
    return "-";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${formatMarketNumber(value)}`;
}

function formatPercent(value) {
  if (typeof value !== "number") {
    return "-";
  }

  return `${(value * 100).toFixed(2)}%`;
}

function formatSignedPercent(value) {
  if (typeof value !== "number") {
    return "-";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
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
    const performance = portfolioPerformanceById[portfolio.id];
    const performanceElement = fragment.querySelector(".portfolio-item-performance");
    button.classList.toggle("active", portfolio.id === selected.id);
    fragment.querySelector(".portfolio-item-name").textContent = portfolio.name;
    performanceElement.textContent =
      typeof performance?.totalDayReturnPercent === "number"
        ? formatSignedPercent(performance.totalDayReturnPercent)
        : "-";
    performanceElement.className = `portfolio-item-performance${
      typeof performance?.totalDayReturnPercent === "number"
        ? performance.totalDayReturnPercent >= 0
          ? " positive"
          : " negative"
        : ""
    }`;
    fragment.querySelector(".portfolio-item-count").textContent = `${portfolio.holdings.length} holdings`;
    button.addEventListener("click", () => {
      resetHoldingForm();
      setHoldingFormOpen(false);
      state.selectedPortfolioId = portfolio.id;
      saveState();
      render();
      refreshSnapshot();
    });
    elements.portfolioList.appendChild(fragment);
  });
}

function syncHeroPanelVisibility() {
  elements.heroPanelBody.classList.toggle("hidden", !isHeroPanelOpen);
  elements.toggleHeroPanelBtn.setAttribute(
    "aria-expanded",
    String(isHeroPanelOpen)
  );
  elements.toggleHeroPanelBtn.textContent = isHeroPanelOpen ? "Hide" : "Show";
}

function syncProfilePanelVisibility() {
  elements.profilePanelBody.classList.toggle("hidden", !isProfilePanelOpen);
  elements.toggleProfilePanelBtn.setAttribute(
    "aria-expanded",
    String(isProfilePanelOpen)
  );
  elements.toggleProfilePanelBtn.textContent = isProfilePanelOpen ? "Hide" : "Show";
}

function syncAdminPanelVisibility() {
  const shouldShowPanel = Boolean(currentUser && currentUser.role === "owner");
  elements.adminPanel.classList.toggle("hidden", !shouldShowPanel);
  elements.adminPanelBody.classList.toggle("hidden", !isAdminPanelOpen);
  elements.toggleAdminPanelBtn.setAttribute(
    "aria-expanded",
    String(isAdminPanelOpen)
  );
  elements.toggleAdminPanelBtn.textContent = isAdminPanelOpen ? "Hide" : "Show";
}

function toggleAdminPanel() {
  isAdminPanelOpen = !isAdminPanelOpen;
  syncAdminPanelVisibility();
}

function toggleProfilePanel() {
  isProfilePanelOpen = !isProfilePanelOpen;
  syncProfilePanelVisibility();
}

function toggleHeroPanel() {
  isHeroPanelOpen = !isHeroPanelOpen;
  syncHeroPanelVisibility();
}

function reorderHoldings(draggedSymbol, targetSymbol, insertAfter = false) {
  const portfolio = getSelectedPortfolio();
  const sourceIndex = portfolio.holdings.findIndex(
    (holding) => holding.symbol.toUpperCase() === draggedSymbol.toUpperCase()
  );
  const targetIndex = portfolio.holdings.findIndex(
    (holding) => holding.symbol.toUpperCase() === targetSymbol.toUpperCase()
  );

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return;
  }

  const [movedHolding] = portfolio.holdings.splice(sourceIndex, 1);
  let nextIndex = targetIndex;

  if (sourceIndex < targetIndex) {
    nextIndex -= 1;
  }

  if (insertAfter) {
    nextIndex += 1;
  }

  portfolio.holdings.splice(nextIndex, 0, movedHolding);
  saveState();
}

function renderAdminUsers() {
  if (!currentUser || currentUser.role !== "owner") {
    elements.adminUsersList.innerHTML = "";
    return;
  }

  if (!adminUsers.length) {
    elements.adminUsersList.innerHTML =
      '<p class="muted admin-empty">No registered users yet.</p>';
    return;
  }

  elements.adminUsersList.innerHTML = adminUsers
    .map(
      (user) => `
        <article class="admin-user-card">
          <strong>${user.name || user.email}</strong>
          <span>${user.email}</span>
          <span class="chip">${user.role === "owner" ? "Owner" : "Member"}</span>
        </article>
      `
    )
    .join("");
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
    elements.storageBanner.textContent = currentUser
      ? `Saving ${currentUser.email}'s data to ${storageMode}`
      : `Saving to ${storageMode}`;
  } else {
    elements.storageBanner.className = "storage-banner hidden";
    elements.storageBanner.textContent = "";
  }

  const summary = lastSnapshot.summary || {};
  const dayReturnClass =
    (summary.totalDayReturn || 0) >= 0 ? "positive" : "negative";
  const returnClass =
    (summary.totalReturn || 0) >= 0 ? "positive" : "negative";

  elements.totalValue.textContent = formatCurrency(summary.totalMarketValue || 0);
  elements.dayReturn.innerHTML = `
    <span class="metric-primary">${formatCurrency(summary.totalDayReturn || 0)}</span>
    <span class="metric-secondary">${formatPercent(summary.totalDayReturnPercent)}</span>
  `;
  elements.dayReturn.className = dayReturnClass;
  elements.totalReturn.innerHTML = `
    <span class="metric-primary">${formatCurrency(summary.totalReturn || 0)}</span>
    <span class="metric-secondary">${formatPercent(summary.totalReturnPercent)}</span>
  `;
  elements.totalReturn.className = returnClass;
  elements.totalReturnCard.className = "stat-card panel";
  elements.annualDividend.textContent = formatCurrency(summary.annualDividendIncome || 0);
  elements.refreshedAt.textContent = lastSnapshot.refreshedAt
    ? `Last refresh ${new Date(lastSnapshot.refreshedAt).toLocaleTimeString()}`
    : "Not refreshed yet";
}

function renderMarketOverview() {
  const items = lastMarketSnapshot.items || [];

  if (!items.length) {
    elements.marketOverview.innerHTML = `
      <article class="market-card loading">
        <span>S&P 500</span>
        <strong>-</strong>
        <small>Waiting for market data</small>
      </article>
      <article class="market-card loading">
        <span>Dow Jones</span>
        <strong>-</strong>
        <small>Waiting for market data</small>
      </article>
      <article class="market-card loading">
        <span>Nasdaq</span>
        <strong>-</strong>
        <small>Waiting for market data</small>
      </article>
    `;
    elements.marketRefreshedAt.textContent = "Loading market data...";
    return;
  }

  elements.marketOverview.innerHTML = items
    .map((item) => {
      const changeClass = (item.dayChange || 0) >= 0 ? "positive" : "negative";
      const modeClass = item.sourceType === "market" ? "live" : "future";

      return `
        <article class="market-card">
          <div class="market-card-top">
            <span>${item.label}</span>
            <span class="market-mode ${modeClass}">${item.displayMode}</span>
          </div>
          <strong>${formatMarketNumber(item.price)}</strong>
          <div class="market-change ${changeClass}">
            <span>${formatSignedMarketNumber(item.dayChange)}</span>
            <span>${item.dayChangePercent != null ? formatPercent((item.dayChangePercent || 0) / 100) : "-"}</span>
          </div>
          <small>${item.symbol}${item.marketTime ? ` updated ${new Date(item.marketTime).toLocaleTimeString()}` : ""}</small>
        </article>
      `;
    })
    .join("");

  elements.marketRefreshedAt.textContent = lastMarketSnapshot.refreshedAt
    ? `Last refresh ${new Date(lastMarketSnapshot.refreshedAt).toLocaleTimeString()}`
    : "Market data loaded";
}

function setSaveStatus(message, isError = false) {
  elements.saveStatus.textContent = message;
  elements.saveStatus.className = isError ? "save-status negative" : "muted save-status";
}

function setSymbolPreview(message, isError = false) {
  elements.symbolPreview.textContent = message;
  elements.symbolPreview.className = isError
    ? "form-status symbol-preview negative"
    : "form-status symbol-preview";
}

function renderSymbolPreview(quote) {
  const updatedText = quote.marketTime
    ? ` Updated ${new Date(quote.marketTime).toLocaleTimeString()}.`
    : "";
  const nameText =
    quote.name && quote.name !== quote.symbol ? ` ${quote.name}.` : "";
  const exchangeText = quote.exchange ? ` ${quote.exchange}.` : "";

  setSymbolPreview(
    `${quote.symbol}: ${formatCurrency(quote.price, quote.currency)} per share.${nameText}${exchangeText}${updatedText}`.trim()
  );
}

function syncHoldingFormVisibility() {
  elements.holdingForm.classList.toggle("hidden", !isHoldingFormOpen);
  elements.toggleHoldingFormBtn.setAttribute("aria-expanded", String(isHoldingFormOpen));
  elements.toggleHoldingFormBtn.textContent = isHoldingFormOpen ? "Hide" : "Show";
  elements.holdingFormTitle.textContent = editingHoldingSymbol
    ? "Edit Holding"
    : "Add Holding";
  elements.saveHoldingBtn.textContent = editingHoldingSymbol
    ? "Update Holding"
    : "Save Holding";
  elements.cancelHoldingEditBtn.classList.toggle("hidden", !editingHoldingSymbol);
}

function setHoldingFormOpen(nextOpen) {
  isHoldingFormOpen = nextOpen;
  syncHoldingFormVisibility();

  if (isHoldingFormOpen) {
    window.requestAnimationFrame(() => {
      elements.symbolInput.focus();
    });
  }
}

function toggleHoldingForm() {
  setHoldingFormOpen(!isHoldingFormOpen);
}

function resetHoldingForm() {
  editingHoldingSymbol = null;
  selectedSearchResult = null;
  quotePreviewRequestId += 1;
  clearTimeout(quotePreviewTimer);
  elements.holdingForm.reset();
  elements.searchResults.innerHTML = "";
  setSymbolPreview("Enter a symbol to see the current market price.");
  syncHoldingFormVisibility();
}

function startEditingHolding(symbol) {
  const portfolio = getSelectedPortfolio();
  const holding = portfolio.holdings.find(
    (item) => item.symbol.toUpperCase() === symbol.toUpperCase()
  );

  if (!holding) {
    return;
  }

  editingHoldingSymbol = holding.symbol.toUpperCase();
  selectedSearchResult = holding.quoteType
    ? {
        symbol: holding.symbol.toUpperCase(),
        quoteType: holding.quoteType,
        name: "",
      }
    : null;

  elements.holdingForm.elements.symbol.value = holding.symbol;
  elements.holdingForm.elements.shares.value = holding.shares;
  elements.holdingForm.elements.costBasis.value = holding.costBasis;
  elements.holdingForm.elements.purchaseDate.value = holding.purchaseDate || "";
  elements.holdingForm.elements.notes.value = holding.notes || "";
  setHoldingFormOpen(true);
  loadQuotePreview(holding.symbol);
}

async function readErrorMessage(response, fallbackMessage) {
  try {
    const payload = await response.json();
    return payload.details || payload.error || `${fallbackMessage} (${response.status})`;
  } catch (error) {
    return `${fallbackMessage} (${response.status})`;
  }
}

async function authFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    resetStateForSignedOutUser();
    render();
    showAuthShell("Your session expired. Sign in with Google again to continue.", true, false, true);
    throw new Error("Authentication required.");
  }

  return response;
}

function renderHoldings() {
  const selected = getSelectedPortfolio();
  const snapshotMap = new Map(
    (lastSnapshot.holdings || []).map((holding) => [holding.symbol, holding])
  );

  if (!selected.holdings.length) {
    elements.holdingsTable.innerHTML =
      '<tr><td colspan="11" class="empty-state">No holdings yet. Add a stock or mutual fund from the form on the left.</td></tr>';
    return;
  }

  elements.holdingsTable.innerHTML = selected.holdings
    .map((holding) => {
      const live = snapshotMap.get(holding.symbol.toUpperCase());
      const returnClass =
        (live?.totalReturn || 0) >= 0 ? "positive" : "negative";
      const yieldText = live ? formatPercent(live.dividendYield) : "-";

      return `
        <tr class="holding-row" data-holding-symbol="${holding.symbol.toUpperCase()}" draggable="true">
          <td data-label="Holding">
            <div class="holding-primary">
              <button class="drag-handle" type="button" tabindex="-1" aria-hidden="true" title="Drag to reorder">
                <span></span><span></span><span></span>
              </button>
              <div>
                <div class="holding-symbol">${holding.symbol.toUpperCase()}</div>
                <div class="holding-name">${live?.name || holding.notes || "Waiting for live quote"}</div>
                <div class="chip">${live?.quoteType || "Holding"}</div>
              </div>
            </div>
          </td>
          <td data-label="Price">
            <div>${live ? formatCurrency(live.price, live.currency) : "-"}</div>
            <div class="holding-name">${live?.exchange || "No exchange data"}</div>
          </td>
          <td data-label="Day Change" class="${live?.dayChange >= 0 ? "positive" : "negative"}">
            ${live?.dayChange != null ? formatCurrency(live.dayChange, live.currency) : "-"}
          </td>
          <td data-label="Day %" class="${live?.dayChange >= 0 ? "positive" : "negative"}">
            ${live?.dayChangePercent != null ? formatPercent((live.dayChangePercent || 0) / 100) : "-"}
          </td>
          <td data-label="Shares">${Number(holding.shares).toLocaleString()}</td>
          <td data-label="Market Value">${live ? formatCurrency(live.marketValue, live.currency) : "-"}</td>
          <td data-label="Total Return" class="${returnClass}">
            ${live ? formatCurrency(live.totalReturn, live.currency) : "-"}
          </td>
          <td data-label="Total Return %" class="${returnClass}">
            ${live ? formatPercent(live.totalReturnPercent) : "-"}
          </td>
          <td data-label="Yield">
            <div>${yieldText}</div>
            <div class="holding-name">${live?.exDividendDate ? `Ex-div ${formatDate(live.exDividendDate)}` : ""}</div>
          </td>
          <td data-label="Annual Income">${live ? formatCurrency(live.annualDividendIncome, live.currency) : "-"}</td>
          <td data-label="Actions">
            <div class="table-actions">
              <button class="table-action edit-action" type="button" data-edit-symbol="${holding.symbol.toUpperCase()}">Edit</button>
              <button class="table-action remove-action" type="button" data-remove-symbol="${holding.symbol.toUpperCase()}">Remove</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  elements.holdingsTable
    .querySelectorAll("[data-edit-symbol]")
    .forEach((button) => {
      button.addEventListener("click", () => startEditingHolding(button.dataset.editSymbol));
    });

  elements.holdingsTable
    .querySelectorAll("[data-remove-symbol]")
    .forEach((button) => {
      button.addEventListener("click", () => removeHolding(button.dataset.removeSymbol));
    });

  elements.holdingsTable.querySelectorAll(".holding-row").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      draggedHoldingSymbol = row.dataset.holdingSymbol;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedHoldingSymbol);
      }
      row.classList.add("dragging");
    });

    row.addEventListener("dragend", () => {
      draggedHoldingSymbol = null;
      elements.holdingsTable
        .querySelectorAll(".holding-row")
        .forEach((holdingRow) => {
          holdingRow.classList.remove("dragging", "drag-target-before", "drag-target-after");
        });
    });

    row.addEventListener("dragover", (event) => {
      if (!draggedHoldingSymbol || draggedHoldingSymbol === row.dataset.holdingSymbol) {
        return;
      }

      event.preventDefault();
      const bounds = row.getBoundingClientRect();
      const insertAfter = event.clientY > bounds.top + bounds.height / 2;

      elements.holdingsTable
        .querySelectorAll(".holding-row")
        .forEach((holdingRow) => {
          if (holdingRow !== row) {
            holdingRow.classList.remove("drag-target-before", "drag-target-after");
          }
        });

      row.classList.toggle("drag-target-before", !insertAfter);
      row.classList.toggle("drag-target-after", insertAfter);
    });

    row.addEventListener("dragleave", (event) => {
      if (!row.contains(event.relatedTarget)) {
        row.classList.remove("drag-target-before", "drag-target-after");
      }
    });

    row.addEventListener("drop", (event) => {
      if (!draggedHoldingSymbol || draggedHoldingSymbol === row.dataset.holdingSymbol) {
        return;
      }

      event.preventDefault();
      const bounds = row.getBoundingClientRect();
      const insertAfter = event.clientY > bounds.top + bounds.height / 2;
      reorderHoldings(draggedHoldingSymbol, row.dataset.holdingSymbol, insertAfter);
      render();
      refreshSnapshot();
    });
  });
}

function render() {
  if (editingHoldingSymbol) {
    const hasEditedHolding = getSelectedPortfolio().holdings.some(
      (holding) => holding.symbol.toUpperCase() === editingHoldingSymbol
    );

    if (!hasEditedHolding) {
      resetHoldingForm();
    } else {
      syncHoldingFormVisibility();
    }
  }

  renderPortfolios();
  renderAdminUsers();
  syncAdminPanelVisibility();
  renderMarketOverview();
  renderSummary();
  renderHoldings();
}

function setAdminStatus(message, isError = false) {
  elements.adminStatus.textContent = message;
  elements.adminStatus.className = isError ? "form-status negative" : "form-status";
}

function createEmptySnapshot() {
  return {
    holdings: [],
    summary: {
      totalMarketValue: 0,
      totalCost: 0,
      totalDayReturn: 0,
      totalDayReturnPercent: null,
      totalReturn: 0,
      totalReturnPercent: null,
      annualDividendIncome: 0,
    },
    dataProviders: [],
    refreshedAt: null,
  };
}

async function fetchPortfolioSnapshot(portfolio) {
  if (!portfolio?.holdings?.length) {
    return createEmptySnapshot();
  }

  const response = await authFetch("/api/portfolio-snapshot", {
    method: "POST",
    body: JSON.stringify({ holdings: portfolio.holdings }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Snapshot request failed"));
  }

  return response.json();
}

function cachePortfolioPerformance(portfolioId, snapshot) {
  portfolioPerformanceById[portfolioId] = {
    totalDayReturnPercent:
      typeof snapshot?.summary?.totalDayReturnPercent === "number"
        ? snapshot.summary.totalDayReturnPercent
        : null,
  };
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

  resetHoldingForm();
  setHoldingFormOpen(false);
  state.portfolios.push(portfolio);
  state.selectedPortfolioId = portfolio.id;
  portfolioPerformanceById[portfolio.id] = { totalDayReturnPercent: null };
  saveState();
  lastSnapshot = { holdings: [], summary: {}, dataProviders: [], refreshedAt: null };
  render();
}

function renameSelectedPortfolio() {
  const selected = getSelectedPortfolio();
  const nextName = window.prompt("Rename portfolio", selected.name);

  if (nextName === null) {
    return;
  }

  const trimmedName = nextName.trim();
  if (!trimmedName) {
    window.alert("Portfolio name cannot be empty.");
    return;
  }

  if (trimmedName === selected.name) {
    return;
  }

  selected.name = trimmedName;
  saveState();
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

  resetHoldingForm();
  setHoldingFormOpen(false);
  state.portfolios = state.portfolios.filter(
    (portfolio) => portfolio.id !== selected.id
  );
  delete portfolioPerformanceById[selected.id];
  state.selectedPortfolioId = state.portfolios[0].id;
  saveState();
  lastSnapshot = { holdings: [], summary: {}, dataProviders: [], refreshedAt: null };
  render();
  refreshSnapshot();
}

function upsertHolding(holding) {
  const portfolio = getSelectedPortfolio();
  const symbol = holding.symbol.toUpperCase();
  const originalSymbol = editingHoldingSymbol || symbol;
  const existingIndex = portfolio.holdings.findIndex(
    (item) => item.symbol.toUpperCase() === originalSymbol
  );
  const duplicateIndex = portfolio.holdings.findIndex(
    (item, index) =>
      index !== existingIndex && item.symbol.toUpperCase() === symbol
  );

  if (duplicateIndex >= 0) {
    window.alert(`A holding for ${symbol} already exists in this portfolio.`);
    return false;
  }

  if (existingIndex >= 0) {
    portfolio.holdings[existingIndex] = { ...holding, symbol };
  } else {
    portfolio.holdings.unshift({ ...holding, symbol });
  }

  saveState();
  resetHoldingForm();
  setHoldingFormOpen(false);
  return true;
}

function removeHolding(symbol) {
  const portfolio = getSelectedPortfolio();
  portfolio.holdings = portfolio.holdings.filter(
    (holding) => holding.symbol.toUpperCase() !== symbol.toUpperCase()
  );
  if (editingHoldingSymbol === symbol.toUpperCase()) {
    resetHoldingForm();
    setHoldingFormOpen(false);
  }
  saveState();
  render();
  refreshSnapshot();
}

async function refreshSnapshot() {
  if (!currentUser) {
    return;
  }

  const portfolio = getSelectedPortfolio();

  elements.refreshedAt.textContent = "Refreshing live prices...";

  try {
    lastSnapshot = await fetchPortfolioSnapshot(portfolio);
    cachePortfolioPerformance(portfolio.id, lastSnapshot);
    render();
  } catch (error) {
    console.error(error);
    elements.refreshedAt.textContent = "Live refresh failed. Try again.";
  }
}

async function refreshPortfolioPerformanceSummaries() {
  if (!currentUser) {
    return;
  }

  const selectedPortfolioId = getSelectedPortfolio()?.id;
  const snapshots = await Promise.all(
    state.portfolios.map(async (portfolio) => {
      try {
        const snapshot = await fetchPortfolioSnapshot(portfolio);
        return { portfolioId: portfolio.id, snapshot };
      } catch (error) {
        console.error(error);
        return { portfolioId: portfolio.id, error };
      }
    })
  );

  let selectedSnapshot = null;
  let didSelectedSnapshotFail = false;

  snapshots.forEach((entry) => {
    if (entry.error) {
      if (entry.portfolioId === selectedPortfolioId) {
        didSelectedSnapshotFail = true;
      }
      return;
    }

    cachePortfolioPerformance(entry.portfolioId, entry.snapshot);
    if (entry.portfolioId === selectedPortfolioId) {
      selectedSnapshot = entry.snapshot;
    }
  });

  if (selectedSnapshot) {
    lastSnapshot = selectedSnapshot;
  }

  render();

  if (didSelectedSnapshotFail) {
    elements.refreshedAt.textContent = "Live refresh failed. Try again.";
  }
}

async function refreshMarketOverview() {
  if (!currentUser) {
    return;
  }

  elements.marketRefreshedAt.textContent = "Refreshing market data...";

  try {
    const response = await authFetch("/api/market-overview");
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Market overview request failed"));
    }

    lastMarketSnapshot = await response.json();
    renderMarketOverview();
  } catch (error) {
    console.error(error);
    elements.marketRefreshedAt.textContent = "Market refresh failed. Try again.";
  }
}

async function refreshAllSnapshots() {
  elements.refreshedAt.textContent = "Refreshing live prices...";
  await Promise.all([refreshMarketOverview(), refreshPortfolioPerformanceSummaries()]);
}

async function pushStateToServer() {
  if (!currentUser) {
    return;
  }

  try {
    setSaveStatus("Saving portfolios...");
    const response = await authFetch("/api/app-state", {
      method: "PUT",
      body: JSON.stringify(state),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Save request failed"));
    }

    const payload = await response.json();
    state = payload.state;
    storageMode = payload.storageMode || storageMode;
    cacheStateLocally();
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
  if (!currentUser) {
    return;
  }

  try {
    const response = await authFetch("/api/app-state");
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Unable to load saved state"));
    }

    const payload = await response.json();
    isHydratingFromServer = true;
    state = payload.state;
    storageMode = payload.storageMode || "";
    cacheStateLocally();
    portfolioPerformanceById = {};
    lastSnapshot = {
      holdings: [],
      summary: {},
      dataProviders: [],
      refreshedAt: null,
    };
    render();
    setSaveStatus(
      payload.savedAt
        ? `Loaded ${currentUser.email}'s saved data from ${new Date(payload.savedAt).toLocaleString()}`
        : `Loaded ${currentUser.email}'s saved data`
    );
  } catch (error) {
    console.error(error);
    setSaveStatus(`Unable to load saved data. ${error.message}`, true);
  } finally {
    isHydratingFromServer = false;
    refreshAllSnapshots();
  }
}

async function loadAdminUsers() {
  if (!currentUser || currentUser.role !== "owner") {
    adminUsers = [];
    renderAdminUsers();
    return;
  }

  try {
    const response = await authFetch("/api/admin/users");
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Unable to load user access list"));
    }

    const payload = await response.json();
    adminUsers = payload.users || [];
    renderAdminUsers();
  } catch (error) {
    console.error(error);
    setAdminStatus(error.message, true);
  }
}

async function searchSymbols(query) {
  if (!currentUser || query.trim().length < 2) {
    elements.searchResults.innerHTML = "";
    return;
  }

  try {
    const response = await authFetch(`/api/search?q=${encodeURIComponent(query)}`, {
      headers: {},
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Search request failed"));
    }

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
        loadQuotePreview(button.dataset.symbol);
      });
    });
  } catch (error) {
    console.error(error);
  }
}

async function loadQuotePreview(symbol) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const requestId = ++quotePreviewRequestId;

  if (!currentUser || !normalizedSymbol) {
    setSymbolPreview("Enter a symbol to see the current market price.");
    return;
  }

  setSymbolPreview(`Loading live price for ${normalizedSymbol}...`);

  try {
    const response = await authFetch(
      `/api/quote?symbol=${encodeURIComponent(normalizedSymbol)}`,
      {
        headers: {},
      }
    );

    if (requestId !== quotePreviewRequestId) {
      return;
    }

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Unable to load live quote"));
    }

    const payload = await response.json();
    renderSymbolPreview(payload.quote);
  } catch (error) {
    if (requestId !== quotePreviewRequestId) {
      return;
    }

    console.error(error);
    setSymbolPreview(error.message, true);
  }
}

async function handleAuthenticatedUser(user) {
  resetStateForSignedOutUser();
  showAppShell(user);
  tryHydrateFromLocalCache(user);
  setSaveStatus("Loading your saved portfolios...");
  render();
  await loadAdminUsers();
  await loadStateFromServer();
}

async function initializeSession() {
  const flash = consumeAuthFlash();

  try {
    const response = await fetch("/api/auth/session", { credentials: "same-origin" });
    const session = await response.json();

    if (session.authenticated && session.user) {
      await handleAuthenticatedUser(session.user);
      if (flash?.message) {
        setSaveStatus(flash.message, flash.isError);
      }
      return;
    }

    showAuthShell(
      flash?.message || "",
      flash?.isError || false,
      Boolean(session.needsSetup),
      Boolean(session.googleAuthEnabled)
    );
  } catch (error) {
    console.error(error);
    showAuthShell("Unable to contact the server right now.", true, false, false);
  }
}

elements.googleLoginLink.addEventListener("click", (event) => {
  if (elements.googleLoginLink.classList.contains("disabled")) {
    event.preventDefault();
  }
});

elements.logoutBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch (error) {
    console.error(error);
  } finally {
    resetStateForSignedOutUser();
    render();
    showAuthShell("Signed out.", false, false, true);
  }
});

elements.toggleHeroPanelBtn.addEventListener("click", toggleHeroPanel);
elements.toggleProfilePanelBtn.addEventListener("click", toggleProfilePanel);
elements.themeToggleBtn.addEventListener("click", toggleTheme);
elements.toggleAdminPanelBtn.addEventListener("click", toggleAdminPanel);

elements.adminUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAdminStatus("Adding user...");

  try {
    const response = await authFetch("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: elements.adminEmailInput.value.trim(),
        name: elements.adminNameInput.value.trim(),
      }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Unable to add user"));
    }

    const payload = await response.json();
    adminUsers = payload.users || adminUsers;
    elements.adminUserForm.reset();
    renderAdminUsers();
    setAdminStatus(`Added ${payload.user.email}.`);
  } catch (error) {
    console.error(error);
    setAdminStatus(error.message, true);
  }
});

elements.holdingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  const didSave = upsertHolding({
    symbol: String(formData.get("symbol") || "").trim(),
    quoteType:
      selectedSearchResult &&
      selectedSearchResult.symbol.toUpperCase() ===
        String(formData.get("symbol") || "").trim().toUpperCase()
        ? selectedSearchResult.quoteType
        : "",
    shares: Number(formData.get("shares")),
    costBasis: Number(formData.get("costBasis")),
    purchaseDate: String(formData.get("purchaseDate") || ""),
    notes: String(formData.get("notes") || "").trim(),
  });

  if (!didSave) {
    return;
  }

  render();
  await refreshSnapshot();
});

elements.symbolInput.addEventListener("input", (event) => {
  const symbol = String(event.target.value || "").trim();

  if (
    !selectedSearchResult ||
    selectedSearchResult.symbol.toUpperCase() !==
      symbol.toUpperCase()
  ) {
    selectedSearchResult = null;
  }

  clearTimeout(searchTimer);
  clearTimeout(quotePreviewTimer);

  if (!symbol) {
    quotePreviewRequestId += 1;
    setSymbolPreview("Enter a symbol to see the current market price.");
  } else if (symbol.length < 2) {
    quotePreviewRequestId += 1;
    setSymbolPreview("Keep typing to load a live market price.");
  } else {
    quotePreviewTimer = setTimeout(() => {
      loadQuotePreview(symbol);
    }, 350);
  }

  searchTimer = setTimeout(() => {
    searchSymbols(symbol);
  }, 250);
});

elements.refreshBtn.addEventListener("click", refreshAllSnapshots);
elements.newPortfolioBtn.addEventListener("click", addPortfolio);
elements.renamePortfolioBtn.addEventListener("click", renameSelectedPortfolio);
elements.deletePortfolioBtn.addEventListener("click", deleteSelectedPortfolio);
elements.toggleHoldingFormBtn.addEventListener("click", toggleHoldingForm);
elements.cancelHoldingEditBtn.addEventListener("click", () => {
  resetHoldingForm();
  setHoldingFormOpen(false);
});

syncHoldingFormVisibility();
syncHeroPanelVisibility();
syncProfilePanelVisibility();
applyTheme(getStoredTheme());
render();
initializeSession();
