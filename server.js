const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { get, put } = require("@vercel/blob");
const YahooFinance = require("yahoo-finance2").default;

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const app = express();
app.set("trust proxy", 1);
const port = process.env.PORT || 3000;
const dataDirectory = path.join(__dirname, "data");
const usersFilePath = path.join(dataDirectory, "users.json");
const authSecretPath = path.join(dataDirectory, "auth-secret.txt");
const blobUsersPath = "auth/users.json";
const appStatePathPrefix = "app-state/users";
const sessionCookieName = "portfolio_pulse_session";
const oauthCookieName = "portfolio_pulse_oauth";
const sessionDurationMs = 1000 * 60 * 60 * 24 * 7;
const oauthStateDurationMs = 1000 * 60 * 10;
const googleAuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenEndpoint = "https://oauth2.googleapis.com/token";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

const hasBlobStorage = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const blobAccessModes = ["private", "public"];

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const allowedQuoteTypes = new Set([
  "EQUITY",
  "ETF",
  "MUTUALFUND",
  "INDEX",
  "MONEYMARKET",
]);

const fundLikeQuoteTypes = new Set(["ETF", "MUTUALFUND", "MONEYMARKET"]);

const marketOverviewSymbols = [
  {
    id: "sp500",
    label: "S&P 500",
    marketSymbol: "^GSPC",
    futureSymbol: "ES=F",
  },
  {
    id: "dow",
    label: "Dow Jones",
    marketSymbol: "^DJI",
    futureSymbol: "YM=F",
  },
  {
    id: "nasdaq",
    label: "Nasdaq",
    marketSymbol: "^IXIC",
    futureSymbol: "NQ=F",
  },
];

const defaultAppState = {
  selectedPortfolioId: "core",
  portfolios: [
    {
      id: "core",
      name: "Core Portfolio",
      holdings: [],
    },
  ],
};

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function normalizeYahooYield(value) {
  const numeric = toNumber(value);
  if (numeric == null) {
    return null;
  }

  return numeric > 1 ? numeric / 100 : numeric;
}

function getDisplayName(result) {
  return (
    result.shortName ||
    result.longName ||
    result.displayName ||
    result.name ||
    result.symbol
  );
}

function ensureDataStore() {
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true });
  }
}

function getLocalUserStatePath(userId) {
  return path.join(dataDirectory, "users", userId, "portfolio-state.json");
}

function getBlobUserStatePath(userId) {
  return `${appStatePathPrefix}/${userId}/portfolio-state.json`;
}

function slugifyUserId(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `user-${crypto.randomBytes(4).toString("hex")}`;
}

function sanitizeHolding(holding) {
  return {
    symbol: normalizeSymbol(holding?.symbol),
    quoteType: String(holding?.quoteType || "").trim().toUpperCase(),
    shares: toNumber(holding?.shares) ?? 0,
    costBasis: toNumber(holding?.costBasis) ?? 0,
    purchaseDate: String(holding?.purchaseDate || "").trim(),
    notes: String(holding?.notes || "").trim(),
  };
}

function sanitizePortfolio(portfolio, index) {
  const id = String(portfolio?.id || `portfolio-${index + 1}`).trim();
  const holdings = Array.isArray(portfolio?.holdings)
    ? portfolio.holdings
        .map(sanitizeHolding)
        .filter((holding) => Boolean(holding.symbol))
    : [];

  return {
    id,
    name:
      String(portfolio?.name || `Portfolio ${index + 1}`).trim() ||
      `Portfolio ${index + 1}`,
    holdings,
  };
}

function sanitizeAppState(state) {
  const portfolios = Array.isArray(state?.portfolios)
    ? state.portfolios
        .map(sanitizePortfolio)
        .filter((portfolio) => portfolio.id)
    : [];

  const safePortfolios =
    portfolios.length > 0 ? portfolios : structuredClone(defaultAppState.portfolios);
  const selectedPortfolioId = safePortfolios.some(
    (portfolio) => portfolio.id === state?.selectedPortfolioId
  )
    ? state.selectedPortfolioId
    : safePortfolios[0].id;

  return {
    selectedPortfolioId,
    portfolios: safePortfolios,
  };
}

function sanitizeUserRecord(user, index) {
  const email = String(user?.email || "")
    .trim()
    .toLowerCase();
  const googleSub = String(user?.googleSub || "").trim();

  if (!email) {
    return null;
  }

  return {
    id: slugifyUserId(user?.id || email || `user-${index + 1}`),
    provider: "google",
    email,
    googleSub,
    role:
      user?.role === "owner" || (!user?.role && index === 0) ? "owner" : "member",
    name: String(user?.name || email).trim() || email,
    picture: String(user?.picture || "").trim(),
    createdAt: user?.createdAt || new Date().toISOString(),
  };
}

function sanitizeUsersStore(store) {
  const users = Array.isArray(store?.users)
    ? store.users.map(sanitizeUserRecord).filter(Boolean)
    : [];

  return { users };
}

function toPublicUser(user) {
  return {
    id: user.id,
    provider: "google",
    email: user.email,
    role: user.role,
    name: user.name,
    picture: user.picture || "",
  };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function getAuthSecret() {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  ensureDataStore();

  if (fs.existsSync(authSecretPath)) {
    return fs.readFileSync(authSecretPath, "utf8");
  }

  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(authSecretPath, secret, "utf8");
  return secret;
}

const authSecret = getAuthSecret();

function signValue(value) {
  return crypto.createHmac("sha256", authSecret).update(value).digest("base64url");
}

function encodeSignedPayload(payload) {
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${value}.${signValue(value)}`;
}

function decodeSignedPayload(token) {
  const [value, signature] = String(token || "").split(".");
  if (!value || !signature) {
    return null;
  }

  const expectedSignature = signValue(value);
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);

  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
}

function createSessionToken(user) {
  return encodeSignedPayload({
    sub: user.id,
    email: user.email,
    name: user.name,
    exp: Date.now() + sessionDurationMs,
  });
}

function verifySessionToken(token) {
  const decoded = decodeSignedPayload(token);
  if (!decoded?.sub || !decoded?.exp || decoded.exp < Date.now()) {
    return null;
  }

  return decoded;
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) {
        return cookies;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());
      cookies[key] = value;
      return cookies;
    }, {});
}

function buildCookieOptions(maxAgeSeconds) {
  const isSecure =
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    isSecure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function setCookie(res, name, value, maxAgeSeconds) {
  res.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; ${buildCookieOptions(maxAgeSeconds)}`
  );
}

function clearCookie(res, name) {
  const isSecure =
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

  res.append(
    "Set-Cookie",
    [
      `${name}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
      isSecure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ")
  );
}

function setSessionCookie(res, token) {
  setCookie(res, sessionCookieName, token, Math.floor(sessionDurationMs / 1000));
}

function setOauthCookie(res, token) {
  setCookie(res, oauthCookieName, token, Math.floor(oauthStateDurationMs / 1000));
}

function clearSessionCookie(res) {
  clearCookie(res, sessionCookieName);
}

function clearOauthCookie(res) {
  clearCookie(res, oauthCookieName);
}

function getBlobStorageMode(access) {
  return access === "private" ? "Vercel Blob (Private)" : "Vercel Blob (Public)";
}

function shouldTryAlternateBlobAccess(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("cannot use public access on a private store") ||
    message.includes("cannot use private access on a public store") ||
    message.includes("access")
  );
}

function readLocalJson(filePath, fallbackValue) {
  ensureDataStore();

  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallbackValue;
  }
}

function writeLocalJson(filePath, value) {
  ensureDataStore();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function readBlobJson(blobPath, fallbackValue) {
  let lastError = null;

  for (const access of blobAccessModes) {
    try {
      const result = await get(blobPath, { access });
      if (!result || result.statusCode === 404) {
        return {
          value: fallbackValue,
          savedAt: null,
          storageMode: getBlobStorageMode(access),
        };
      }

      if (result.statusCode !== 200 || !result.stream) {
        throw new Error(`Blob read failed with ${result.statusCode}`);
      }

      const raw = await new Response(result.stream).text();

      return {
        value: JSON.parse(raw),
        savedAt: result.blob?.uploadedAt
          ? new Date(result.blob.uploadedAt).toISOString()
          : null,
        storageMode: getBlobStorageMode(access),
      };
    } catch (error) {
      lastError = error;
      if (!shouldTryAlternateBlobAccess(error)) {
        break;
      }
    }
  }

  throw lastError ?? new Error("Blob storage is unavailable.");
}

async function writeBlobJson(blobPath, value) {
  let lastError = null;

  for (const access of blobAccessModes) {
    try {
      const blob = await put(blobPath, JSON.stringify(value, null, 2), {
        access,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });

      return {
        value,
        savedAt: blob.uploadedAt ? new Date(blob.uploadedAt).toISOString() : null,
        storageMode: getBlobStorageMode(access),
      };
    } catch (error) {
      lastError = error;
      if (!shouldTryAlternateBlobAccess(error)) {
        break;
      }
    }
  }

  throw lastError ?? new Error("Blob storage is unavailable.");
}

async function readUsersStore() {
  if (hasBlobStorage) {
    const payload = await readBlobJson(blobUsersPath, { users: [] });
    return sanitizeUsersStore(payload.value);
  }

  return sanitizeUsersStore(readLocalJson(usersFilePath, { users: [] }));
}

async function writeUsersStore(store) {
  const safeStore = sanitizeUsersStore(store);

  if (hasBlobStorage) {
    await writeBlobJson(blobUsersPath, safeStore);
    return safeStore;
  }

  writeLocalJson(usersFilePath, safeStore);
  return safeStore;
}

async function readAppStateForUser(userId) {
  if (hasBlobStorage) {
    const payload = await readBlobJson(getBlobUserStatePath(userId), defaultAppState);
    return {
      state: sanitizeAppState(payload.value),
      savedAt: payload.savedAt,
      storageMode: payload.storageMode,
    };
  }

  const stateFilePath = getLocalUserStatePath(userId);
  const state = sanitizeAppState(readLocalJson(stateFilePath, defaultAppState));
  return {
    state,
    savedAt: fs.existsSync(stateFilePath)
      ? fs.statSync(stateFilePath).mtime.toISOString()
      : null,
    storageMode: "Local File",
  };
}

async function writeAppStateForUser(userId, state) {
  const safeState = sanitizeAppState(state);

  if (hasBlobStorage) {
    const payload = await writeBlobJson(getBlobUserStatePath(userId), safeState);
    return {
      state: sanitizeAppState(payload.value),
      savedAt: payload.savedAt,
      storageMode: payload.storageMode,
    };
  }

  const stateFilePath = getLocalUserStatePath(userId);
  writeLocalJson(stateFilePath, safeState);
  return {
    state: safeState,
    savedAt: new Date().toISOString(),
    storageMode: "Local File",
  };
}

function getGoogleOAuthConfig(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

  return {
    configured: Boolean(clientId && clientSecret && redirectUri),
    clientId,
    clientSecret,
    redirectUri,
  };
}

function parseJwtPayload(token) {
  const [, payload] = String(token || "").split(".");
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
}

function buildAuthRedirect(errorCode) {
  return `/?auth_error=${encodeURIComponent(errorCode)}`;
}

async function exchangeGoogleAuthorizationCode(code, redirectUri, clientId, clientSecret) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch(googleTokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status})`);
  }

  return response.json();
}

function validateGoogleIdTokenClaims(idTokenClaims, oauthState, googleConfig) {
  if (!idTokenClaims) {
    throw new Error("Google did not return a readable ID token.");
  }

  const issuer = String(idTokenClaims.iss || "");
  if (issuer !== "https://accounts.google.com" && issuer !== "accounts.google.com") {
    throw new Error("Unexpected Google token issuer.");
  }

  if (idTokenClaims.aud !== googleConfig.clientId) {
    throw new Error("Google token audience did not match this app.");
  }

  if (!idTokenClaims.sub) {
    throw new Error("Google token did not include a subject.");
  }

  if (Number(idTokenClaims.exp || 0) * 1000 < Date.now()) {
    throw new Error("Google token has expired.");
  }

  if (idTokenClaims.nonce !== oauthState.nonce) {
    throw new Error("Google token nonce did not match the login request.");
  }

  if (!idTokenClaims.email || idTokenClaims.email_verified !== true) {
    throw new Error("Google account email is missing or unverified.");
  }
}

async function provisionOrFindGoogleUser(idTokenClaims) {
  const email = String(idTokenClaims.email || "")
    .trim()
    .toLowerCase();
  const googleSub = String(idTokenClaims.sub || "").trim();
  const usersStore = await readUsersStore();

  let user =
    usersStore.users.find((item) => item.googleSub && item.googleSub === googleSub) ||
    usersStore.users.find((item) => item.email === email) ||
    null;

  if (!user && usersStore.users.length > 0) {
    return { user: null, created: false };
  }

  if (!user) {
    user = {
      id: slugifyUserId(email),
      provider: "google",
      email,
      googleSub,
      role: usersStore.users.length === 0 ? "owner" : "member",
      name: String(idTokenClaims.name || email).trim() || email,
      picture: String(idTokenClaims.picture || "").trim(),
      createdAt: new Date().toISOString(),
    };

    await writeUsersStore({ users: [...usersStore.users, user] });
    return { user, created: true };
  }

  const updatedUser = {
    ...user,
    provider: "google",
    googleSub: user.googleSub || googleSub,
    name: String(idTokenClaims.name || user.name || email).trim() || email,
    picture: String(idTokenClaims.picture || user.picture || "").trim(),
  };

  const changed =
    updatedUser.googleSub !== user.googleSub ||
    updatedUser.name !== user.name ||
    updatedUser.picture !== user.picture;

  if (changed) {
    const updatedUsers = usersStore.users.map((item) =>
      item.id === user.id ? updatedUser : item
    );
    await writeUsersStore({ users: updatedUsers });
  }

  return { user: updatedUser, created: false };
}

async function authenticateRequest(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[sessionCookieName];
    const session = verifySessionToken(token);

    if (!session) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Authentication required." });
    }

    const usersStore = await readUsersStore();
    const user = usersStore.users.find((item) => item.id === session.sub);

    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Session is no longer valid." });
    }

    req.user = toPublicUser(user);
    next();
  } catch (error) {
    res.status(500).json({
      error: "Unable to validate authentication.",
      details: error.message,
    });
  }
}

function requireOwner(req, res, next) {
  if (req.user?.role !== "owner") {
    return res.status(403).json({
      error: "Owner access required.",
    });
  }

  next();
}

async function searchSymbolsWithYahoo(query) {
  const search = await yahooFinance.search(query, {
    quotesCount: 10,
    newsCount: 0,
  });

  return (search.quotes || [])
    .filter((result) => allowedQuoteTypes.has(result.quoteType))
    .map((result) => ({
      symbol: result.symbol,
      name: getDisplayName(result),
      quoteType: result.quoteType,
      exchange: result.exchange || "",
    }));
}

async function getYahooQuoteSnapshot(symbol) {
  const quote = await yahooFinance.quote(symbol);
  return {
    symbol: quote.symbol || symbol,
    name: getDisplayName(quote),
    quoteType: quote.quoteType || "UNKNOWN",
    exchange: quote.fullExchangeName || quote.exchange || "",
    currency: quote.currency || "USD",
    price: toNumber(quote.regularMarketPrice) ?? toNumber(quote.navPrice) ?? 0,
    dayChange: toNumber(quote.regularMarketChange),
    dayChangePercent: toNumber(quote.regularMarketChangePercent),
    marketTime:
      quote.regularMarketTime instanceof Date
        ? quote.regularMarketTime.toISOString()
        : null,
    exDividendDate:
      quote.exDividendDate instanceof Date
        ? quote.exDividendDate.toISOString()
        : null,
    dividendRate:
      toNumber(quote.trailingAnnualDividendRate) ??
      toNumber(quote.dividendRate) ??
      0,
    dividendYield:
      normalizeYahooYield(quote.trailingAnnualDividendYield) ??
      normalizeYahooYield(quote.dividendYield) ??
      0,
  };
}

async function getYahooMarketQuote(symbol) {
  const quote = await yahooFinance.quote(symbol);
  return {
    symbol: quote.symbol || symbol,
    name: getDisplayName(quote),
    exchange: quote.fullExchangeName || quote.exchange || "",
    currency: quote.currency || "USD",
    price: toNumber(quote.regularMarketPrice) ?? toNumber(quote.navPrice) ?? 0,
    dayChange: toNumber(quote.regularMarketChange),
    dayChangePercent: toNumber(quote.regularMarketChangePercent),
    marketState: String(quote.marketState || "").trim().toUpperCase(),
    marketTime:
      quote.regularMarketTime instanceof Date
        ? quote.regularMarketTime.toISOString()
        : null,
  };
}

async function getMarketOverviewItem(config) {
  const marketQuote = await getYahooMarketQuote(config.marketSymbol);
  const useMarketQuote = marketQuote.marketState === "REGULAR";
  const selectedQuote = useMarketQuote
    ? marketQuote
    : await getYahooMarketQuote(config.futureSymbol);

  return {
    id: config.id,
    label: config.label,
    sourceType: useMarketQuote ? "market" : "future",
    displayMode: useMarketQuote ? "Real-time market" : "Futures",
    marketState: marketQuote.marketState || selectedQuote.marketState || "UNKNOWN",
    symbol: selectedQuote.symbol,
    name: selectedQuote.name,
    exchange: selectedQuote.exchange,
    currency: selectedQuote.currency,
    price: selectedQuote.price,
    dayChange: selectedQuote.dayChange,
    dayChangePercent: selectedQuote.dayChangePercent,
    marketTime: selectedQuote.marketTime,
  };
}

async function getYahooDividendSnapshot(symbol) {
  const quote = await yahooFinance.quote(symbol);
  const quoteType = String(quote.quoteType || "").trim().toUpperCase();
  const fallbackRate =
    toNumber(quote.trailingAnnualDividendRate) ??
    toNumber(quote.dividendRate) ??
    0;
  const fallbackYield =
    normalizeYahooYield(quote.trailingAnnualDividendYield) ??
    normalizeYahooYield(quote.dividendYield) ??
    0;
  const fallbackExDividendDate =
    quote.exDividendDate instanceof Date
      ? quote.exDividendDate.toISOString()
      : null;

  if (fundLikeQuoteTypes.has(quoteType) && fallbackYield > 0) {
    return {
      dividendRate: fallbackRate,
      dividendYield: fallbackYield,
      exDividendDate: fallbackExDividendDate,
    };
  }

  try {
    const period1 = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const events = await yahooFinance.historical(symbol, {
      period1,
      period2: new Date(),
      events: "dividends",
    });

    const dividendEvents = (events || [])
      .filter((event) => toNumber(event.dividends) != null)
      .map((event) => ({
        date: event.date instanceof Date ? event.date.toISOString() : event.date,
        amount: toNumber(event.dividends) ?? 0,
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (dividendEvents.length > 0) {
      const dividendRate = dividendEvents.reduce(
        (sum, event) => sum + event.amount,
        0
      );
      const price =
        toNumber(quote.regularMarketPrice) ??
        toNumber(quote.navPrice) ??
        0;

      return {
        dividendRate,
        dividendYield: price > 0 ? dividendRate / price : fallbackYield,
        exDividendDate: dividendEvents[0]?.date || fallbackExDividendDate,
      };
    }
  } catch (error) {
    // Fall back to quote-provided dividend fields if history is unavailable.
  }

  return {
    dividendRate: fallbackRate,
    dividendYield: fallbackYield,
    exDividendDate: fallbackExDividendDate,
  };
}

async function getHoldingMarketData(holding) {
  const symbol = normalizeSymbol(holding.symbol);
  const yahooData = await getYahooQuoteSnapshot(symbol);
  const yahooDividendData = await getYahooDividendSnapshot(symbol);
  return {
    ...yahooData,
    ...yahooDividendData,
    dataProvider: "Yahoo Finance",
  };
}

function buildHoldingSnapshot(holding, marketData) {
  const shares = toNumber(holding.shares) ?? 0;
  const costBasis = toNumber(holding.costBasis) ?? 0;
  const price = toNumber(marketData.price) ?? 0;
  const perShareDayChange = toNumber(marketData.dayChange);
  const dayChangePercent = toNumber(marketData.dayChangePercent);
  const dividendRate = toNumber(marketData.dividendRate) ?? 0;
  const dividendYield = toNumber(marketData.dividendYield) ?? 0;

  const marketValue = shares * price;
  const dayChange = perShareDayChange == null ? null : shares * perShareDayChange;
  const totalCost = shares * costBasis;
  const totalReturn = marketValue - totalCost;
  const totalReturnPercent = totalCost > 0 ? totalReturn / totalCost : null;
  const annualDividendIncome = shares * dividendRate;

  return {
    symbol: marketData.symbol || normalizeSymbol(holding.symbol),
    name: marketData.name || holding.symbol,
    dataProvider: marketData.dataProvider || null,
    quoteType: marketData.quoteType || holding.quoteType || "UNKNOWN",
    exchange: marketData.exchange || "",
    currency: marketData.currency || "USD",
    shares,
    costBasis,
    purchaseDate: holding.purchaseDate || "",
    notes: holding.notes || "",
    price,
    dayChange,
    dayChangePercent,
    marketValue,
    totalCost,
    totalReturn,
    totalReturnPercent,
    dividendRate,
    dividendYield,
    annualDividendIncome,
    exDividendDate: marketData.exDividendDate || null,
    marketTime: marketData.marketTime || null,
  };
}

app.get("/api/auth/session", async (req, res) => {
  try {
    const usersStore = await readUsersStore();
    const googleConfig = getGoogleOAuthConfig(req);
    const needsSetup = usersStore.users.length === 0;
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[sessionCookieName];
    const session = verifySessionToken(token);

    if (!session) {
      return res.json({
        authenticated: false,
        needsSetup,
        googleAuthEnabled: googleConfig.configured,
      });
    }

    const user = usersStore.users.find((item) => item.id === session.sub);
    if (!user) {
      clearSessionCookie(res);
      return res.json({
        authenticated: false,
        needsSetup,
        googleAuthEnabled: googleConfig.configured,
      });
    }

    res.json({
      authenticated: true,
      needsSetup,
      googleAuthEnabled: googleConfig.configured,
      user: toPublicUser(user),
    });
  } catch (error) {
    res.status(500).json({
      error: "Unable to load session.",
      details: error.message,
    });
  }
});

app.get("/api/auth/google", async (req, res) => {
  const googleConfig = getGoogleOAuthConfig(req);
  if (!googleConfig.configured) {
    return res.redirect(buildAuthRedirect("google_not_configured"));
  }

  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  const oauthState = {
    state,
    nonce,
    exp: Date.now() + oauthStateDurationMs,
  };

  setOauthCookie(res, encodeSignedPayload(oauthState));

  const authUrl = new URL(googleAuthorizationEndpoint);
  authUrl.searchParams.set("client_id", googleConfig.clientId);
  authUrl.searchParams.set("redirect_uri", googleConfig.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("prompt", "select_account");

  res.redirect(authUrl.toString());
});

app.get("/api/auth/google/callback", async (req, res) => {
  const googleConfig = getGoogleOAuthConfig(req);
  if (!googleConfig.configured) {
    return res.redirect(buildAuthRedirect("google_not_configured"));
  }

  if (req.query.error) {
    clearOauthCookie(res);
    return res.redirect(buildAuthRedirect("google_access_denied"));
  }

  try {
    const cookies = parseCookies(req.headers.cookie);
    const oauthToken = cookies[oauthCookieName];
    const oauthState = decodeSignedPayload(oauthToken);

    if (!oauthState || oauthState.exp < Date.now()) {
      clearOauthCookie(res);
      return res.redirect(buildAuthRedirect("oauth_state_expired"));
    }

    if (String(req.query.state || "") !== oauthState.state) {
      clearOauthCookie(res);
      return res.redirect(buildAuthRedirect("oauth_state_mismatch"));
    }

    const code = String(req.query.code || "");
    if (!code) {
      clearOauthCookie(res);
      return res.redirect(buildAuthRedirect("missing_auth_code"));
    }

    const tokenPayload = await exchangeGoogleAuthorizationCode(
      code,
      googleConfig.redirectUri,
      googleConfig.clientId,
      googleConfig.clientSecret
    );
    const idTokenClaims = parseJwtPayload(tokenPayload.id_token);
    validateGoogleIdTokenClaims(idTokenClaims, oauthState, googleConfig);

    const result = await provisionOrFindGoogleUser(idTokenClaims);
    if (!result.user) {
      clearOauthCookie(res);
      return res.redirect(buildAuthRedirect("not_registered"));
    }

    clearOauthCookie(res);
    setSessionCookie(res, createSessionToken(result.user));
    res.redirect(result.created ? "/?auth_success=registered" : "/");
  } catch (error) {
    clearOauthCookie(res);
    res.redirect(buildAuthRedirect("google_sign_in_failed"));
  }
});

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(res);
  clearOauthCookie(res);
  res.json({ ok: true });
});

app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/")) {
    return next();
  }

  return authenticateRequest(req, res, next);
});

app.get("/api/admin/users", requireOwner, async (req, res) => {
  try {
    const usersStore = await readUsersStore();
    res.json({
      users: usersStore.users
        .map(toPublicUser)
        .sort((left, right) => left.email.localeCompare(right.email)),
    });
  } catch (error) {
    res.status(500).json({
      error: "Unable to load registered users.",
      details: error.message,
    });
  }
});

app.post("/api/admin/users", requireOwner, async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const name = String(req.body?.name || "").trim();

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: "Enter a valid email address.",
      });
    }

    const usersStore = await readUsersStore();
    const existingUser = usersStore.users.find((user) => user.email === email);

    if (existingUser) {
      return res.status(409).json({
        error: "That email already has access.",
      });
    }

    const user = {
      id: slugifyUserId(email),
      provider: "google",
      email,
      googleSub: "",
      role: "member",
      name: name || email,
      picture: "",
      createdAt: new Date().toISOString(),
    };

    const updatedStore = await writeUsersStore({
      users: [...usersStore.users, user],
    });

    res.status(201).json({
      message: "User added.",
      user: toPublicUser(user),
      users: updatedStore.users
        .map(toPublicUser)
        .sort((left, right) => left.email.localeCompare(right.email)),
    });
  } catch (error) {
    res.status(500).json({
      error: "Unable to add user.",
      details: error.message,
    });
  }
});

app.get("/api/app-state", async (req, res) => {
  try {
    const payload = await readAppStateForUser(req.user.id);
    res.json({
      ...payload,
      user: req.user,
    });
  } catch (error) {
    res.status(500).json({
      error: "Unable to load application state.",
      details: error.message,
    });
  }
});

app.put("/api/app-state", async (req, res) => {
  try {
    const payload = await writeAppStateForUser(req.user.id, req.body);
    res.json({
      ...payload,
      user: req.user,
    });
  } catch (error) {
    res.status(500).json({
      error: "Unable to save application state.",
      details: error.message,
    });
  }
});

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();

  if (query.length < 2) {
    return res.json({ results: [] });
  }

  try {
    const results = await searchSymbolsWithYahoo(query);
    res.json({ results });
  } catch (error) {
    res.status(500).json({
      error: "Unable to search symbols right now.",
      details: error.message,
    });
  }
});

app.get("/api/market-overview", async (req, res) => {
  try {
    const items = await Promise.all(
      marketOverviewSymbols.map((config) => getMarketOverviewItem(config))
    );

    res.json({
      items,
      dataProvider: "Yahoo Finance",
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: "Unable to load market overview.",
      details: error.message,
    });
  }
});

app.post("/api/portfolio-snapshot", async (req, res) => {
  const holdings = Array.isArray(req.body?.holdings) ? req.body.holdings : [];

  if (holdings.length === 0) {
    return res.json({
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
      refreshedAt: new Date().toISOString(),
    });
  }

  try {
    const snapshots = await Promise.all(
      holdings.map(async (holding) => {
        const symbol = normalizeSymbol(holding.symbol);
        if (!symbol) {
          return null;
        }

        const marketData = await getHoldingMarketData(holding);

        return buildHoldingSnapshot({ ...holding, symbol }, marketData);
      })
    );

    const filtered = snapshots.filter(Boolean);
    const dataProviders = [
      ...new Set(
        filtered.map((holding) => holding.dataProvider).filter(Boolean)
      ),
    ];
    const summary = filtered.reduce(
      (accumulator, holding) => {
        accumulator.totalMarketValue += holding.marketValue;
        accumulator.totalCost += holding.totalCost;
        accumulator.totalDayReturn += holding.dayChange || 0;
        accumulator.annualDividendIncome += holding.annualDividendIncome;
        return accumulator;
      },
      {
        totalMarketValue: 0,
        totalCost: 0,
        totalDayReturn: 0,
        annualDividendIncome: 0,
      }
    );

    const previousMarketValue = summary.totalMarketValue - summary.totalDayReturn;
    summary.totalDayReturnPercent =
      previousMarketValue > 0 ? summary.totalDayReturn / previousMarketValue : null;
    summary.totalReturn = summary.totalMarketValue - summary.totalCost;
    summary.totalReturnPercent =
      summary.totalCost > 0 ? summary.totalReturn / summary.totalCost : null;

    res.json({
      holdings: filtered,
      summary,
      dataProviders,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: "Unable to load portfolio snapshot.",
      details: error.message,
    });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Portfolio tracker running at http://localhost:${port}`);
});
