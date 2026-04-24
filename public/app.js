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
  holdingsTable: document.querySelector("#holdings-table"),
  refreshedAt: document.querySelector("#refreshed-at"),
  totalValue: document.querySelector("#total-value"),
  totalReturn: document.querySelector("#total-return"),
  totalReturnCard: document.querySelector("#total-return-card"),
  annualDividend: document.querySelector("#annual-dividend"),
  holdingForm: document.querySelector("#holding-form"),
  toggleHoldingFormBtn: document.querySelector("#toggle-holding-form-btn"),
  symbolInput: document.querySelector("#symbol-input"),
  searchResults: document.querySelector("#search-results"),
  refreshBtn: document.querySelector("#refresh-btn"),
  newPortfolioBtn: document.querySelector("#new-portfolio-btn"),
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
let searchTimer = null;
let selectedSearchResult = null;
let saveTimer = null;
let isHydratingFromServer = false;
let storageMode = "";
let isHoldingFormOpen = false;
let isAdminPanelOpen = false;
let adminUsers = [];

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
  const returnClass =
    (summary.totalReturn || 0) >= 0 ? "positive" : "negative";

  elements.totalValue.textContent = formatCurrency(summary.totalMarketValue || 0);
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

function setSaveStatus(message, isError = false) {
  elements.saveStatus.textContent = message;
  elements.saveStatus.className = isError ? "save-status negative" : "muted save-status";
}

function syncHoldingFormVisibility() {
  elements.holdingForm.classList.toggle("hidden", !isHoldingFormOpen);
  elements.toggleHoldingFormBtn.setAttribute("aria-expanded", String(isHoldingFormOpen));
  elements.toggleHoldingFormBtn.textContent = isHoldingFormOpen ? "Hide" : "Show";
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
        <tr>
          <td data-label="Holding">
            <div class="holding-symbol">${holding.symbol.toUpperCase()}</div>
            <div class="holding-name">${live?.name || holding.notes || "Waiting for live quote"}</div>
            <div class="chip">${live?.quoteType || "Holding"}</div>
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
  renderAdminUsers();
  syncAdminPanelVisibility();
  renderSummary();
  renderHoldings();
}

function setAdminStatus(message, isError = false) {
  elements.adminStatus.textContent = message;
  elements.adminStatus.className = isError ? "form-status negative" : "form-status";
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
  lastSnapshot = { holdings: [], summary: {}, dataProviders: [], refreshedAt: null };
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
  lastSnapshot = { holdings: [], summary: {}, dataProviders: [], refreshedAt: null };
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
  setHoldingFormOpen(false);
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
  if (!currentUser) {
    return;
  }

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
    const response = await authFetch("/api/portfolio-snapshot", {
      method: "POST",
      body: JSON.stringify({ holdings: portfolio.holdings }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Snapshot request failed"));
    }

    lastSnapshot = await response.json();
    render();
  } catch (error) {
    console.error(error);
    elements.refreshedAt.textContent = "Live refresh failed. Try again.";
  }
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
    refreshSnapshot();
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
      });
    });
  } catch (error) {
    console.error(error);
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

  upsertHolding({
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

  event.currentTarget.reset();
  selectedSearchResult = null;
  elements.searchResults.innerHTML = "";
  render();
  await refreshSnapshot();
});

elements.symbolInput.addEventListener("input", (event) => {
  if (
    !selectedSearchResult ||
    selectedSearchResult.symbol.toUpperCase() !==
      String(event.target.value || "").trim().toUpperCase()
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
elements.toggleHoldingFormBtn.addEventListener("click", toggleHoldingForm);

syncHoldingFormVisibility();
render();
initializeSession();
