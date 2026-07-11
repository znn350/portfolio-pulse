const defaultState = {
  selectedPortfolioId: "core",
  portfolios: [
    {
      id: "core",
      name: "Core Portfolio",
      selectedAccountId: "account-1",
      accounts: [
        {
          id: "account-1",
          name: "Main Account",
          holdings: [],
        },
      ],
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
  accountList: document.querySelector("#account-list"),
  portfolioName: document.querySelector("#portfolio-name"),
  portfolioMeta: document.querySelector("#portfolio-meta"),
  providerBanner: document.querySelector("#provider-banner"),
  storageBanner: document.querySelector("#storage-banner"),
  saveStatus: document.querySelector("#save-status"),
  toggleMarketOverviewBtn: document.querySelector("#toggle-market-overview-btn"),
  marketOverviewBody: document.querySelector("#market-overview-body"),
  marketOverview: document.querySelector("#market-overview"),
  marketRefreshedAt: document.querySelector("#market-refreshed-at"),
  accountsOverview: document.querySelector("#accounts-overview"),
  accountsOverviewMeta: document.querySelector("#accounts-overview-meta"),
  holdingsTable: document.querySelector("#holdings-table"),
  refreshedAt: document.querySelector("#refreshed-at"),
  totalValue: document.querySelector("#total-value"),
  dayReturn: document.querySelector("#day-return"),
  totalReturn: document.querySelector("#total-return"),
  totalReturnCard: document.querySelector("#total-return-card"),
  annualDividend: document.querySelector("#annual-dividend"),
  dividendYield: document.querySelector("#dividend-yield"),
  toggleHeroPanelBtn: document.querySelector("#toggle-hero-panel-btn"),
  heroPanelBody: document.querySelector("#hero-panel-body"),
  holdingForm: document.querySelector("#holding-form"),
  holdingFormTitle: document.querySelector("#holding-form-title"),
  saveHoldingBtn: document.querySelector("#save-holding-btn"),
  cancelHoldingEditBtn: document.querySelector("#cancel-holding-edit-btn"),
  toggleHoldingFormBtn: document.querySelector("#toggle-holding-form-btn"),
  symbolInput: document.querySelector("#symbol-input"),
  symbolPreview: document.querySelector("#symbol-preview"),
  sharesInput: document.querySelector("#shares-input"),
  shareCalculatorToggleBtn: document.querySelector("#share-calculator-toggle-btn"),
  shareCalculatorPanel: document.querySelector("#share-calculator-panel"),
  shareTotalAmountInput: document.querySelector("#share-total-amount-input"),
  shareCalculatorStatus: document.querySelector("#share-calculator-status"),
  searchResults: document.querySelector("#search-results"),
  refreshBtn: document.querySelector("#refresh-btn"),
  newPortfolioBtn: document.querySelector("#new-portfolio-btn"),
  newAccountBtn: document.querySelector("#new-account-btn"),
  renamePortfolioBtn: document.querySelector("#rename-portfolio-btn"),
  renameAccountBtn: document.querySelector("#rename-account-btn"),
  duplicatePortfolioBtn: document.querySelector("#duplicate-portfolio-btn"),
  deleteAccountBtn: document.querySelector("#delete-account-btn"),
  deletePortfolioBtn: document.querySelector("#delete-portfolio-btn"),
  portfolioTemplate: document.querySelector("#portfolio-item-template"),
  accountTemplate: document.querySelector("#account-item-template"),
};

let currentUser = null;
let state = structuredClone(defaultState);
let lastAccountSnapshot = createEmptySnapshot();
let lastPortfolioSnapshot = createEmptySnapshot();
let lastAccountSnapshotsById = {};
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
let isMarketOverviewOpen = false;
let adminUsers = [];
let draggedHoldingSymbol = null;
let draggedPortfolioId = null;
let editingHoldingSymbol = null;
let editingHoldingAccountId = null;
let currentTheme = "light";
let quotePreviewRequestId = 0;
let isShareCalculatorOpen = false;
let currentQuotePreview = null;

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

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function createDefaultAccount(overrides = {}) {
  return {
    id: overrides.id || makeId(),
    name: String(overrides.name || "Main Account").trim() || "Main Account",
    holdings: Array.isArray(overrides.holdings) ? overrides.holdings : [],
  };
}

function normalizeHolding(holding) {
  return {
    symbol: String(holding?.symbol || "").trim().toUpperCase(),
    quoteType: String(holding?.quoteType || "").trim().toUpperCase(),
    shares: toNumber(holding?.shares),
    costBasis: toNumber(holding?.costBasis),
    purchaseDate: String(holding?.purchaseDate || "").trim(),
    notes: String(holding?.notes || "").trim(),
  };
}

function normalizeAccount(account, index) {
  const id = String(account?.id || `account-${index + 1}`).trim();
  const holdings = Array.isArray(account?.holdings)
    ? account.holdings.map(normalizeHolding).filter((holding) => holding.symbol)
    : [];

  return {
    id,
    name: String(account?.name || `Account ${index + 1}`).trim() || `Account ${index + 1}`,
    holdings,
  };
}

function normalizePortfolio(portfolio, index) {
  const legacyHoldings = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
  const accounts = Array.isArray(portfolio?.accounts) && portfolio.accounts.length
    ? portfolio.accounts.map(normalizeAccount).filter((account) => account.id)
    : [normalizeAccount(createDefaultAccount({ id: "account-1", holdings: legacyHoldings }), 0)];
  const selectedAccountId = accounts.some(
    (account) => account.id === portfolio?.selectedAccountId
  )
    ? portfolio.selectedAccountId
    : accounts[0].id;

  return {
    id: String(portfolio?.id || `portfolio-${index + 1}`).trim(),
    name:
      String(portfolio?.name || `Portfolio ${index + 1}`).trim() ||
      `Portfolio ${index + 1}`,
    selectedAccountId,
    accounts,
  };
}

function normalizeState(nextState) {
  const portfolios = Array.isArray(nextState?.portfolios)
    ? nextState.portfolios.map(normalizePortfolio).filter((portfolio) => portfolio.id)
    : [];
  const safePortfolios =
    portfolios.length > 0 ? portfolios : structuredClone(defaultState.portfolios);
  const selectedPortfolioId = safePortfolios.some(
    (portfolio) => portfolio.id === nextState?.selectedPortfolioId
  )
    ? nextState.selectedPortfolioId
    : safePortfolios[0].id;

  return {
    selectedPortfolioId,
    portfolios: safePortfolios,
  };
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
  lastAccountSnapshot = createEmptySnapshot();
  lastPortfolioSnapshot = createEmptySnapshot();
  lastAccountSnapshotsById = {};
  lastMarketSnapshot = {
    items: [],
    refreshedAt: null,
  };
  portfolioPerformanceById = {};
  storageMode = "";
  selectedSearchResult = null;
  isAdminPanelOpen = false;
  adminUsers = [];
  editingHoldingSymbol = null;
  editingHoldingAccountId = null;
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

  localStorage.setItem(
    getUserStorageKey(currentUser),
    JSON.stringify(normalizeState(state))
  );
}

function tryHydrateFromLocalCache(user) {
  try {
    const saved = JSON.parse(localStorage.getItem(getUserStorageKey(user)));
    if (saved?.portfolios?.length) {
      state = normalizeState(saved);
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

function getSelectedAccount(portfolio = getSelectedPortfolio()) {
  if (!portfolio) {
    return null;
  }

  return (
    portfolio.accounts.find(
      (account) => account.id === portfolio.selectedAccountId
    ) || portfolio.accounts[0]
  );
}

function getAllPortfolioHoldings(portfolio = getSelectedPortfolio()) {
  if (!portfolio) {
    return [];
  }

  return portfolio.accounts.flatMap((account) => account.holdings);
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

function getUniquePortfolioName(baseName) {
  const trimmedBaseName = String(baseName || "").trim() || "Portfolio Copy";
  const existingNames = new Set(
    state.portfolios.map((portfolio) => portfolio.name.trim().toLowerCase())
  );

  if (!existingNames.has(trimmedBaseName.toLowerCase())) {
    return trimmedBaseName;
  }

  let copyIndex = 2;
  let candidateName = `${trimmedBaseName} ${copyIndex}`;

  while (existingNames.has(candidateName.toLowerCase())) {
    copyIndex += 1;
    candidateName = `${trimmedBaseName} ${copyIndex}`;
  }

  return candidateName;
}

function renderPortfolios() {
  const selected = getSelectedPortfolio();
  elements.portfolioList.innerHTML = "";

  state.portfolios.forEach((portfolio) => {
    const fragment = elements.portfolioTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".portfolio-item");
    const performance = portfolioPerformanceById[portfolio.id];
    const performanceElement = fragment.querySelector(".portfolio-item-performance");
    button.dataset.portfolioId = portfolio.id;
    button.draggable = true;
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
    const holdingCount = getAllPortfolioHoldings(portfolio).length;
    fragment.querySelector(".portfolio-item-count").textContent =
      `${portfolio.accounts.length} accounts - ${holdingCount} holdings`;
    button.addEventListener("click", () => {
      state.selectedPortfolioId = portfolio.id;
      resetHoldingForm();
      setHoldingFormOpen(false);
      resetPortfolioSnapshots();
      saveState();
      render();
      refreshSnapshot();
    });

    button.addEventListener("dragstart", (event) => {
      draggedPortfolioId = portfolio.id;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedPortfolioId);
      }
      button.classList.add("dragging");
    });

    button.addEventListener("dragend", () => {
      draggedPortfolioId = null;
      elements.portfolioList
        .querySelectorAll(".portfolio-item")
        .forEach((portfolioItem) => {
          portfolioItem.classList.remove(
            "dragging",
            "drag-target-before",
            "drag-target-after"
          );
        });
    });

    button.addEventListener("dragover", (event) => {
      if (!draggedPortfolioId || draggedPortfolioId === portfolio.id) {
        return;
      }

      event.preventDefault();
      const bounds = button.getBoundingClientRect();
      const insertAfter = event.clientY > bounds.top + bounds.height / 2;

      elements.portfolioList
        .querySelectorAll(".portfolio-item")
        .forEach((portfolioItem) => {
          if (portfolioItem !== button) {
            portfolioItem.classList.remove("drag-target-before", "drag-target-after");
          }
        });

      button.classList.toggle("drag-target-before", !insertAfter);
      button.classList.toggle("drag-target-after", insertAfter);
    });

    button.addEventListener("dragleave", (event) => {
      if (!button.contains(event.relatedTarget)) {
        button.classList.remove("drag-target-before", "drag-target-after");
      }
    });

    button.addEventListener("drop", (event) => {
      if (!draggedPortfolioId || draggedPortfolioId === portfolio.id) {
        return;
      }

      event.preventDefault();
      const bounds = button.getBoundingClientRect();
      const insertAfter = event.clientY > bounds.top + bounds.height / 2;
      reorderPortfolios(draggedPortfolioId, portfolio.id, insertAfter);
      render();
    });

    elements.portfolioList.appendChild(fragment);
  });
}

function renderAccounts() {
  const selectedPortfolio = getSelectedPortfolio();
  const selectedAccount = getSelectedAccount(selectedPortfolio);
  elements.accountList.innerHTML = "";

  selectedPortfolio.accounts.forEach((account) => {
    const fragment = elements.accountTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".account-item");
    button.dataset.accountId = account.id;
    button.classList.toggle("active", account.id === selectedAccount?.id);
    fragment.querySelector(".account-item-name").textContent = account.name;
    fragment.querySelector(".account-item-count").textContent = `${account.holdings.length} holdings`;
    button.addEventListener("click", () => {
      if (selectedPortfolio.selectedAccountId === account.id) {
        return;
      }

      selectedPortfolio.selectedAccountId = account.id;
      resetHoldingForm();
      lastAccountSnapshot = lastAccountSnapshotsById[account.id] || createEmptySnapshot();
      saveState();
      render();
      refreshSnapshot();
    });
    elements.accountList.appendChild(fragment);
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

function syncMarketOverviewVisibility() {
  elements.marketOverviewBody.classList.toggle("hidden", !isMarketOverviewOpen);
  elements.toggleMarketOverviewBtn.setAttribute(
    "aria-expanded",
    String(isMarketOverviewOpen)
  );
  elements.toggleMarketOverviewBtn.textContent = isMarketOverviewOpen ? "Hide" : "Show";
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

function toggleMarketOverview() {
  isMarketOverviewOpen = !isMarketOverviewOpen;
  syncMarketOverviewVisibility();
}

function reorderHoldings(draggedSymbol, targetSymbol, insertAfter = false) {
  const account = getSelectedAccount();
  const sourceIndex = account.holdings.findIndex(
    (holding) => holding.symbol.toUpperCase() === draggedSymbol.toUpperCase()
  );
  const targetIndex = account.holdings.findIndex(
    (holding) => holding.symbol.toUpperCase() === targetSymbol.toUpperCase()
  );

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return;
  }

  const [movedHolding] = account.holdings.splice(sourceIndex, 1);
  let nextIndex = targetIndex;

  if (sourceIndex < targetIndex) {
    nextIndex -= 1;
  }

  if (insertAfter) {
    nextIndex += 1;
  }

  account.holdings.splice(nextIndex, 0, movedHolding);
  saveState();
}

function reorderPortfolios(draggedPortfolioIdValue, targetPortfolioId, insertAfter = false) {
  const sourceIndex = state.portfolios.findIndex(
    (portfolio) => portfolio.id === draggedPortfolioIdValue
  );
  const targetIndex = state.portfolios.findIndex(
    (portfolio) => portfolio.id === targetPortfolioId
  );

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return;
  }

  const [movedPortfolio] = state.portfolios.splice(sourceIndex, 1);
  let nextIndex = targetIndex;

  if (sourceIndex < targetIndex) {
    nextIndex -= 1;
  }

  if (insertAfter) {
    nextIndex += 1;
  }

  state.portfolios.splice(nextIndex, 0, movedPortfolio);
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
  const selectedAccount = getSelectedAccount(selected);
  elements.portfolioName.textContent = selected.name;
  elements.portfolioMeta.textContent = `${selected.accounts.length} accounts - viewing ${selectedAccount.holdings.length} holdings in ${selectedAccount.name}`;

  const providers = lastPortfolioSnapshot.dataProviders || [];
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

  const summary = lastPortfolioSnapshot.summary || {};
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
  elements.dividendYield.textContent =
    typeof summary.dividendYield === "number"
      ? formatPercent(summary.dividendYield)
      : "-";
  elements.refreshedAt.textContent = lastAccountSnapshot.refreshedAt
    ? `Last refresh ${new Date(lastAccountSnapshot.refreshedAt).toLocaleTimeString()}`
    : "Not refreshed yet";
}

function renderAccountsOverview() {
  const portfolio = getSelectedPortfolio();
  const selectedAccount = getSelectedAccount(portfolio);
  const holdingsCount = getAllPortfolioHoldings(portfolio).length;

  elements.accountsOverviewMeta.textContent =
    `${portfolio.accounts.length} accounts across ${holdingsCount} holdings`;

  if (!portfolio.accounts.length) {
    elements.accountsOverview.innerHTML =
      '<p class="account-overview-empty">No accounts in this portfolio yet.</p>';
    return;
  }

  elements.accountsOverview.innerHTML = portfolio.accounts
    .map((account) => {
      const snapshot = lastAccountSnapshotsById[account.id] || createEmptySnapshot();
      const summary = snapshot.summary || {};
      const totalReturnClass =
        typeof summary.totalReturn === "number" && summary.totalReturn < 0
          ? "negative"
          : "positive";
      const dayReturnClass =
        typeof summary.totalDayReturn === "number" && summary.totalDayReturn < 0
          ? "negative"
          : "positive";

      return `
        <article class="account-overview-card${
          account.id === selectedAccount.id ? " active" : ""
        }">
          <div class="account-overview-header">
            <div>
              <div class="account-overview-name">${account.name}</div>
              <div class="holding-name">${account.holdings.length} holdings</div>
            </div>
            <div class="chip">${account.id === selectedAccount.id ? "Selected" : "Account"}</div>
          </div>
          <div class="account-overview-body">
            <div class="account-overview-row">
              <span>Total Value</span>
              <strong>${formatCurrency(summary.totalMarketValue || 0)}</strong>
            </div>
            <div class="account-overview-row ${dayReturnClass}">
              <span>Day Return</span>
              <strong>${formatCurrency(summary.totalDayReturn || 0)}</strong>
            </div>
            <div class="account-overview-row ${totalReturnClass}">
              <span>Total Return</span>
              <strong>${formatCurrency(summary.totalReturn || 0)}</strong>
            </div>
            <div class="account-overview-row">
              <span>Dividend Income</span>
              <strong>${formatCurrency(summary.annualDividendIncome || 0)}</strong>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
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

function setShareCalculatorStatus(message, isError = false) {
  elements.shareCalculatorStatus.textContent = message;
  elements.shareCalculatorStatus.className = isError
    ? "form-status share-calculator-status negative"
    : "form-status share-calculator-status";
}

function formatShareCount(value) {
  return Number(value.toFixed(4)).toString();
}

function syncShareCalculatorVisibility() {
  elements.shareCalculatorPanel.classList.toggle("hidden", !isShareCalculatorOpen);
  elements.shareCalculatorToggleBtn.setAttribute(
    "aria-expanded",
    String(isShareCalculatorOpen)
  );
}

function setShareCalculatorOpen(nextOpen) {
  isShareCalculatorOpen = nextOpen;
  syncShareCalculatorVisibility();
}

function getCurrentQuotePrice() {
  const price = Number(currentQuotePreview?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function syncSharesFromCalculatorTotal() {
  const totalAmount = Number(elements.shareTotalAmountInput.value);
  const currentPrice = getCurrentQuotePrice();

  if (!elements.shareTotalAmountInput.value) {
    setShareCalculatorStatus("Enter a total amount to calculate shares.");
    return;
  }

  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    setShareCalculatorStatus("Enter a valid total amount.", true);
    return;
  }

  if (!currentPrice) {
    setShareCalculatorStatus("Load a live symbol price before calculating shares.", true);
    return;
  }

  const calculatedShares = totalAmount / currentPrice;
  elements.sharesInput.value = formatShareCount(calculatedShares);
  setShareCalculatorStatus(
    `${formatCurrency(totalAmount, currentQuotePreview.currency)} at ${formatCurrency(
      currentPrice,
      currentQuotePreview.currency
    )} per share = ${formatShareCount(calculatedShares)} shares.`
  );
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
  syncSharesFromCalculatorTotal();
}

function buildAggregatedPortfolioHoldings(portfolio) {
  const baseHoldingsBySymbol = new Map();

  portfolio.accounts.forEach((account) => {
    account.holdings.forEach((holding) => {
      const symbol = holding.symbol.toUpperCase();
      const entry = baseHoldingsBySymbol.get(symbol) || {
        symbol,
        shares: 0,
        totalCost: 0,
        notes: [],
        accountNames: [],
      };

      entry.shares += Number(holding.shares) || 0;
      entry.totalCost += (Number(holding.shares) || 0) * (Number(holding.costBasis) || 0);
      if (holding.notes) {
        entry.notes.push(holding.notes);
      }
      entry.accountNames.push(account.name);
      baseHoldingsBySymbol.set(symbol, entry);
    });
  });

  const liveBySymbol = new Map();
  (lastPortfolioSnapshot.holdings || []).forEach((holding) => {
    const symbol = holding.symbol.toUpperCase();
    const entry = liveBySymbol.get(symbol) || {
      symbol,
      name: holding.name || symbol,
      quoteType: holding.quoteType || "Holding",
      exchange: holding.exchange || "",
      currency: holding.currency || "USD",
      price: holding.price || 0,
      dayChange: 0,
      dayChangePercentBase: 0,
      marketValue: 0,
      totalReturn: 0,
      annualDividendIncome: 0,
      weightedExpenseRatioValue: 0,
      weightedExpenseRatioMarketValue: 0,
      exDividendDate: holding.exDividendDate || "",
    };

    entry.dayChange += Number(holding.dayChange) || 0;
    entry.marketValue += Number(holding.marketValue) || 0;
    entry.totalReturn += Number(holding.totalReturn) || 0;
    entry.annualDividendIncome += Number(holding.annualDividendIncome) || 0;
    entry.dayChangePercentBase +=
      (Number(holding.marketValue) || 0) - (Number(holding.dayChange) || 0);

    if (holding.expenseRatio != null) {
      const marketValue = Number(holding.marketValue) || 0;
      entry.weightedExpenseRatioValue += holding.expenseRatio * marketValue;
      entry.weightedExpenseRatioMarketValue += marketValue;
    }

    if (!entry.exDividendDate && holding.exDividendDate) {
      entry.exDividendDate = holding.exDividendDate;
    }

    liveBySymbol.set(symbol, entry);
  });

  return Array.from(baseHoldingsBySymbol.values()).map((holding) => {
    const live = liveBySymbol.get(holding.symbol);
    const totalCost = holding.totalCost;
    const marketValue = live?.marketValue ?? 0;
    const totalReturn = live?.totalReturn ?? 0;
    const dayChange = live?.dayChange ?? 0;

    return {
      symbol: holding.symbol,
      shares: holding.shares,
      costBasis: holding.shares > 0 ? totalCost / holding.shares : 0,
      notes: holding.notes[0] || "",
      accountNames: holding.accountNames,
      accountCount: holding.accountNames.length,
      live: live
        ? {
            ...live,
            dayChangePercent:
              live.dayChangePercentBase > 0
                ? (dayChange / live.dayChangePercentBase) * 100
                : null,
            totalReturnPercent: totalCost > 0 ? totalReturn / totalCost : null,
            dividendYield:
              marketValue > 0 ? live.annualDividendIncome / marketValue : null,
            expenseRatio:
              live.weightedExpenseRatioMarketValue > 0
                ? live.weightedExpenseRatioValue / live.weightedExpenseRatioMarketValue
                : null,
          }
        : null,
    };
  });
}

function syncHoldingFormVisibility() {
  const account = getSelectedAccount();
  const accountName = account?.name || "Selected Account";
  elements.holdingForm.classList.toggle("hidden", !isHoldingFormOpen);
  elements.toggleHoldingFormBtn.setAttribute("aria-expanded", String(isHoldingFormOpen));
  elements.toggleHoldingFormBtn.textContent = isHoldingFormOpen ? "Hide" : "Show";
  elements.holdingFormTitle.textContent = editingHoldingSymbol
    ? `Edit Holding in ${accountName}`
    : `Add Holding to ${accountName}`;
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
  editingHoldingAccountId = null;
  selectedSearchResult = null;
  currentQuotePreview = null;
  quotePreviewRequestId += 1;
  clearTimeout(quotePreviewTimer);
  elements.holdingForm.reset();
  elements.searchResults.innerHTML = "";
  setSymbolPreview("Enter a symbol to see the current market price.");
  setShareCalculatorOpen(false);
  setShareCalculatorStatus("Load a symbol price to calculate shares automatically.");
  syncHoldingFormVisibility();
}

function startEditingHolding(symbol) {
  const account = getSelectedAccount();
  const holding = account.holdings.find(
    (item) => item.symbol.toUpperCase() === symbol.toUpperCase()
  );

  if (!holding) {
    return;
  }

  editingHoldingSymbol = holding.symbol.toUpperCase();
  editingHoldingAccountId = account.id;
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
  elements.shareTotalAmountInput.value = "";
  setShareCalculatorStatus("Load a symbol price to calculate shares automatically.");
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
  const portfolio = getSelectedPortfolio();
  const aggregatedHoldings = buildAggregatedPortfolioHoldings(portfolio);

  if (!aggregatedHoldings.length) {
    elements.holdingsTable.innerHTML =
      '<tr><td colspan="12" class="empty-state">No holdings yet in this portfolio. Add holdings from any account on the left.</td></tr>';
    return;
  }

  elements.holdingsTable.innerHTML = aggregatedHoldings
    .map((holding) => {
      const live = holding.live;
      const returnClass =
        (live?.totalReturn || 0) >= 0 ? "positive" : "negative";
      const yieldText = live ? formatPercent(live.dividendYield) : "-";
      const expenseRatioText =
        live?.expenseRatio != null ? formatPercent(live.expenseRatio) : "-";

      return `
        <tr class="holding-row" data-holding-symbol="${holding.symbol.toUpperCase()}">
          <td data-label="Holding">
            <div class="holding-primary">
              <div>
                <div class="holding-symbol">${holding.symbol.toUpperCase()}</div>
                <div class="holding-name">${live?.name || holding.notes || "Waiting for live quote"}</div>
                <div class="holding-name">Held in ${holding.accountCount} account${holding.accountCount === 1 ? "" : "s"}: ${holding.accountNames.join(", ")}</div>
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
          <td data-label="Expense Ratio">${expenseRatioText}</td>
          <td data-label="Annual Income">${live ? formatCurrency(live.annualDividendIncome, live.currency) : "-"}</td>
          <td data-label="Actions">
            <div class="holding-name">Manage within accounts</div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function render() {
  if (editingHoldingSymbol) {
    const selectedAccount = getSelectedAccount();
    const hasEditedHolding =
      editingHoldingAccountId === selectedAccount.id &&
      selectedAccount.holdings.some(
        (holding) => holding.symbol.toUpperCase() === editingHoldingSymbol
      );

    if (!hasEditedHolding) {
      resetHoldingForm();
    } else {
      syncHoldingFormVisibility();
    }
  }

  syncHoldingFormVisibility();

  renderPortfolios();
  renderAccounts();
  renderAccountsOverview();
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
      dividendYield: null,
    },
    dataProviders: [],
    refreshedAt: null,
  };
}

function resetPortfolioSnapshots() {
  lastAccountSnapshot = createEmptySnapshot();
  lastPortfolioSnapshot = createEmptySnapshot();
  lastAccountSnapshotsById = {};
}

async function fetchPortfolioSnapshot(holdings) {
  if (!holdings?.length) {
    return createEmptySnapshot();
  }

  const response = await authFetch("/api/portfolio-snapshot", {
    method: "POST",
    body: JSON.stringify({ holdings }),
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
    selectedAccountId: "account-1",
    accounts: [
      {
        id: "account-1",
        name: "Main Account",
        holdings: [],
      },
    ],
  };

  resetHoldingForm();
  setHoldingFormOpen(false);
  state.portfolios.push(portfolio);
  state.selectedPortfolioId = portfolio.id;
  portfolioPerformanceById[portfolio.id] = { totalDayReturnPercent: null };
  saveState();
  resetPortfolioSnapshots();
  render();
}

function addAccount() {
  const portfolio = getSelectedPortfolio();
  const name = window.prompt("Account name");
  if (!name) {
    return;
  }

  const account = createDefaultAccount({ name: name.trim() });
  portfolio.accounts.push(account);
  portfolio.selectedAccountId = account.id;
  resetHoldingForm();
  setHoldingFormOpen(false);
  saveState();
  resetPortfolioSnapshots();
  render();
}

function renameSelectedAccount() {
  const account = getSelectedAccount();
  const nextName = window.prompt("Rename account", account.name);

  if (nextName === null) {
    return;
  }

  const trimmedName = nextName.trim();
  if (!trimmedName) {
    window.alert("Account name cannot be empty.");
    return;
  }

  if (trimmedName === account.name) {
    return;
  }

  account.name = trimmedName;
  saveState();
  render();
}

function deleteSelectedAccount() {
  const portfolio = getSelectedPortfolio();
  const account = getSelectedAccount(portfolio);

  if (portfolio.accounts.length === 1) {
    window.alert("Keep at least one account in each portfolio.");
    return;
  }

  const confirmed = window.confirm(`Delete ${account.name}?`);
  if (!confirmed) {
    return;
  }

  portfolio.accounts = portfolio.accounts.filter((item) => item.id !== account.id);
  portfolio.selectedAccountId = portfolio.accounts[0].id;
  resetHoldingForm();
  setHoldingFormOpen(false);
  saveState();
  resetPortfolioSnapshots();
  render();
  refreshSnapshot();
}

function duplicateSelectedPortfolio() {
  const selected = getSelectedPortfolio();
  const duplicateName = getUniquePortfolioName(`${selected.name} Copy`);
  const selectedAccountIndex = selected.accounts.findIndex(
    (account) => account.id === selected.selectedAccountId
  );
  const duplicatePortfolio = {
    id: makeId(),
    name: duplicateName,
    accounts: selected.accounts.map((account) => ({
      id: makeId(),
      name: account.name,
      holdings: account.holdings.map((holding) => ({ ...holding })),
    })),
  };
  duplicatePortfolio.selectedAccountId =
    duplicatePortfolio.accounts[selectedAccountIndex >= 0 ? selectedAccountIndex : 0]?.id || "";

  resetHoldingForm();
  setHoldingFormOpen(false);
  state.portfolios.push(duplicatePortfolio);
  state.selectedPortfolioId = duplicatePortfolio.id;
  portfolioPerformanceById[duplicatePortfolio.id] = { totalDayReturnPercent: null };
  saveState();
  resetPortfolioSnapshots();
  render();
  refreshSnapshot();
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
  resetPortfolioSnapshots();
  render();
  refreshSnapshot();
}

function upsertHolding(holding) {
  const account = getSelectedAccount();
  const symbol = holding.symbol.toUpperCase();
  const originalSymbol = editingHoldingSymbol || symbol;
  const existingIndex = account.holdings.findIndex(
    (item) => item.symbol.toUpperCase() === originalSymbol
  );
  const duplicateIndex = account.holdings.findIndex(
    (item, index) =>
      index !== existingIndex && item.symbol.toUpperCase() === symbol
  );

  if (duplicateIndex >= 0) {
    window.alert(`A holding for ${symbol} already exists in ${account.name}.`);
    return false;
  }

  if (existingIndex >= 0) {
    account.holdings[existingIndex] = { ...holding, symbol };
  } else {
    account.holdings.unshift({ ...holding, symbol });
  }

  saveState();
  resetHoldingForm();
  setHoldingFormOpen(false);
  return true;
}

function removeHolding(symbol) {
  const account = getSelectedAccount();
  account.holdings = account.holdings.filter(
    (holding) => holding.symbol.toUpperCase() !== symbol.toUpperCase()
  );
  if (
    editingHoldingSymbol === symbol.toUpperCase() &&
    editingHoldingAccountId === account.id
  ) {
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
  const account = getSelectedAccount();

  elements.refreshedAt.textContent = "Refreshing live prices...";

  try {
    const accountEntries = await Promise.all(
      portfolio.accounts.map(async (portfolioAccount) => ({
        accountId: portfolioAccount.id,
        snapshot: await fetchPortfolioSnapshot(portfolioAccount.holdings),
      }))
    );

    lastAccountSnapshotsById = accountEntries.reduce((result, entry) => {
      result[entry.accountId] = entry.snapshot;
      return result;
    }, {});
    lastAccountSnapshot =
      lastAccountSnapshotsById[account.id] || createEmptySnapshot();
    lastPortfolioSnapshot = await fetchPortfolioSnapshot(
      getAllPortfolioHoldings(portfolio)
    );
    cachePortfolioPerformance(portfolio.id, lastPortfolioSnapshot);
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

  const snapshots = await Promise.all(
    state.portfolios.map(async (portfolio) => {
      try {
        const snapshot = await fetchPortfolioSnapshot(getAllPortfolioHoldings(portfolio));
        return { portfolioId: portfolio.id, snapshot };
      } catch (error) {
        console.error(error);
        return { portfolioId: portfolio.id, error };
      }
    })
  );

  let didSelectedSnapshotFail = false;
  const selectedPortfolioId = getSelectedPortfolio()?.id;

  snapshots.forEach((entry) => {
    if (entry.error) {
      if (entry.portfolioId === selectedPortfolioId) {
        didSelectedSnapshotFail = true;
      }
      return;
    }

    cachePortfolioPerformance(entry.portfolioId, entry.snapshot);
  });

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
  await Promise.all([
    refreshMarketOverview(),
    refreshPortfolioPerformanceSummaries(),
    refreshSnapshot(),
  ]);
}

async function pushStateToServer() {
  if (!currentUser) {
    return;
  }

  try {
    setSaveStatus("Saving portfolios...");
    const response = await authFetch("/api/app-state", {
      method: "PUT",
      body: JSON.stringify(normalizeState(state)),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Save request failed"));
    }

    const payload = await response.json();
    state = normalizeState(payload.state);
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
    state = normalizeState(payload.state);
    storageMode = payload.storageMode || "";
    cacheStateLocally();
    portfolioPerformanceById = {};
    resetPortfolioSnapshots();
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
    currentQuotePreview = null;
    setSymbolPreview("Enter a symbol to see the current market price.");
    syncSharesFromCalculatorTotal();
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
    currentQuotePreview = payload.quote;
    renderSymbolPreview(payload.quote);
  } catch (error) {
    if (requestId !== quotePreviewRequestId) {
      return;
    }

    console.error(error);
    currentQuotePreview = null;
    setSymbolPreview(error.message, true);
    syncSharesFromCalculatorTotal();
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

elements.shareCalculatorToggleBtn.addEventListener("click", () => {
  const nextOpen = !isShareCalculatorOpen;
  setShareCalculatorOpen(nextOpen);

  if (nextOpen) {
    if (!elements.shareTotalAmountInput.value && elements.sharesInput.value) {
      const currentPrice = getCurrentQuotePrice();
      const currentShares = Number(elements.sharesInput.value);

      if (currentPrice && Number.isFinite(currentShares) && currentShares > 0) {
        elements.shareTotalAmountInput.value = (currentPrice * currentShares).toFixed(2);
      }
    }

    syncSharesFromCalculatorTotal();
    window.requestAnimationFrame(() => {
      elements.shareTotalAmountInput.focus();
    });
  }
});

elements.shareTotalAmountInput.addEventListener("input", () => {
  syncSharesFromCalculatorTotal();
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
    currentQuotePreview = null;
    quotePreviewRequestId += 1;
    setSymbolPreview("Enter a symbol to see the current market price.");
    syncSharesFromCalculatorTotal();
  } else if (symbol.length < 2) {
    currentQuotePreview = null;
    quotePreviewRequestId += 1;
    setSymbolPreview("Keep typing to load a live market price.");
    syncSharesFromCalculatorTotal();
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
elements.newAccountBtn.addEventListener("click", addAccount);
elements.renamePortfolioBtn.addEventListener("click", renameSelectedPortfolio);
elements.renameAccountBtn.addEventListener("click", renameSelectedAccount);
elements.duplicatePortfolioBtn.addEventListener("click", duplicateSelectedPortfolio);
elements.deleteAccountBtn.addEventListener("click", deleteSelectedAccount);
elements.deletePortfolioBtn.addEventListener("click", deleteSelectedPortfolio);
elements.toggleMarketOverviewBtn.addEventListener("click", toggleMarketOverview);
elements.toggleHoldingFormBtn.addEventListener("click", toggleHoldingForm);
elements.cancelHoldingEditBtn.addEventListener("click", () => {
  resetHoldingForm();
  setHoldingFormOpen(false);
});

syncMarketOverviewVisibility();
syncShareCalculatorVisibility();
syncHoldingFormVisibility();
syncHeroPanelVisibility();
syncProfilePanelVisibility();
applyTheme(getStoredTheme());
render();
initializeSession();
