const express = require("express");
const fs = require("fs");
const path = require("path");
const { head, put } = require("@vercel/blob");
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
const port = process.env.PORT || 3000;
const dataDirectory = path.join(__dirname, "data");
const stateFilePath = path.join(dataDirectory, "portfolio-state.json");
const blobStatePath = "app-state/portfolio-state.json";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

const hasBlobStorage = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const allowedQuoteTypes = new Set([
  "EQUITY",
  "ETF",
  "MUTUALFUND",
  "INDEX",
  "MONEYMARKET",
]);

const defaultAppState = {
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

  if (!fs.existsSync(stateFilePath)) {
    fs.writeFileSync(
      stateFilePath,
      JSON.stringify(defaultAppState, null, 2),
      "utf8"
    );
  }
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
    name: String(portfolio?.name || `Portfolio ${index + 1}`).trim() || `Portfolio ${index + 1}`,
    holdings,
  };
}

function sanitizeAppState(state) {
  const portfolios = Array.isArray(state?.portfolios)
    ? state.portfolios.map(sanitizePortfolio).filter((portfolio) => portfolio.id)
    : [];

  const safePortfolios = portfolios.length > 0 ? portfolios : defaultAppState.portfolios;
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

function readLocalAppState() {
  ensureDataStore();

  try {
    const raw = fs.readFileSync(stateFilePath, "utf8");
    return sanitizeAppState(JSON.parse(raw));
  } catch (error) {
    return structuredClone(defaultAppState);
  }
}

function writeLocalAppState(state) {
  ensureDataStore();
  const safeState = sanitizeAppState(state);
  fs.writeFileSync(stateFilePath, JSON.stringify(safeState, null, 2), "utf8");
  return safeState;
}

async function readBlobAppState() {
  try {
    const blob = await head(blobStatePath);
    const response = await fetch(blob.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Blob read failed with ${response.status}`);
    }

    const data = await response.json();
    return {
      state: sanitizeAppState(data),
      savedAt: blob.uploadedAt
        ? new Date(blob.uploadedAt).toISOString()
        : null,
    };
  } catch (error) {
    return {
      state: structuredClone(defaultAppState),
      savedAt: null,
    };
  }
}

async function writeBlobAppState(state) {
  const safeState = sanitizeAppState(state);
  const blob = await put(blobStatePath, JSON.stringify(safeState, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });

  return {
    state: safeState,
    savedAt: blob.uploadedAt ? new Date(blob.uploadedAt).toISOString() : null,
  };
}

async function readAppState() {
  if (hasBlobStorage) {
    const payload = await readBlobAppState();
    return {
      ...payload,
      storageMode: "Vercel Blob",
    };
  }

  return {
    state: readLocalAppState(),
    savedAt: fs.existsSync(stateFilePath)
      ? fs.statSync(stateFilePath).mtime.toISOString()
      : null,
    storageMode: "Local File",
  };
}

async function writeAppState(state) {
  if (hasBlobStorage) {
    const payload = await writeBlobAppState(state);
    return {
      ...payload,
      storageMode: "Vercel Blob",
    };
  }

  const savedState = writeLocalAppState(state);
  return {
    state: savedState,
    savedAt: new Date().toISOString(),
    storageMode: "Local File",
  };
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
      toNumber(quote.trailingAnnualDividendYield) ??
      toNumber(quote.dividendYield) ??
      0,
  };
}

async function getYahooDividendSnapshot(symbol) {
  const quote = await yahooFinance.quote(symbol);
  const fallbackRate =
    toNumber(quote.trailingAnnualDividendRate) ??
    toNumber(quote.dividendRate) ??
    0;
  const fallbackYield =
    toNumber(quote.trailingAnnualDividendYield) ??
    toNumber(quote.dividendYield) ??
    0;
  const fallbackExDividendDate =
    quote.exDividendDate instanceof Date
      ? quote.exDividendDate.toISOString()
      : null;

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
  const dayChange = toNumber(marketData.dayChange);
  const dayChangePercent = toNumber(marketData.dayChangePercent);
  const dividendRate = toNumber(marketData.dividendRate) ?? 0;
  const dividendYield = toNumber(marketData.dividendYield) ?? 0;

  const marketValue = shares * price;
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

app.get("/api/app-state", async (req, res) => {
  try {
    const payload = await readAppState();
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: "Unable to load application state.",
      details: error.message,
    });
  }
});

app.put("/api/app-state", async (req, res) => {
  try {
    const payload = await writeAppState(req.body);
    res.json(payload);
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

app.post("/api/portfolio-snapshot", async (req, res) => {
  const holdings = Array.isArray(req.body?.holdings) ? req.body.holdings : [];

  if (holdings.length === 0) {
    return res.json({
      holdings: [],
      summary: {
        totalMarketValue: 0,
        totalCost: 0,
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
    const dataProviders = [...new Set(filtered.map((holding) => holding.dataProvider).filter(Boolean))];
    const summary = filtered.reduce(
      (accumulator, holding) => {
        accumulator.totalMarketValue += holding.marketValue;
        accumulator.totalCost += holding.totalCost;
        accumulator.annualDividendIncome += holding.annualDividendIncome;
        return accumulator;
      },
      {
        totalMarketValue: 0,
        totalCost: 0,
        annualDividendIncome: 0,
      }
    );

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
