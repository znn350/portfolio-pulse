const assert = require("node:assert/strict");

const {
  buildHoldingSnapshot,
  buildPortfolioSummary,
  normalizeYahooYield,
  sanitizeAppState,
} = require("./server");

const tests = [
  {
    name: "normalizeYahooYield converts whole-number percentages to decimals",
    run() {
      assert.equal(normalizeYahooYield(4.2), 0.042);
      assert.equal(normalizeYahooYield(0.0375), 0.0375);
      assert.equal(normalizeYahooYield(null), null);
    },
  },
  {
    name: "buildHoldingSnapshot calculates annual dividend income from shares and dividend rate",
    run() {
      const snapshot = buildHoldingSnapshot(
        {
          symbol: "VTI",
          shares: 10,
          costBasis: 200,
          purchaseDate: "2025-01-01",
          notes: "Core",
        },
        {
          symbol: "VTI",
          name: "Vanguard Total Stock Market ETF",
          quoteType: "ETF",
          exchange: "NYSEArca",
          currency: "USD",
          price: 250,
          dayChange: 1.5,
          dayChangePercent: 0.6,
          dividendRate: 3.5,
          dividendYield: 0.014,
          expenseRatio: 0.0003,
          exDividendDate: "2026-06-20T00:00:00.000Z",
          marketTime: "2026-07-01T14:30:00.000Z",
          dataProvider: "Yahoo Finance",
        }
      );

      assert.equal(snapshot.marketValue, 2500);
      assert.equal(snapshot.annualDividendIncome, 35);
      assert.equal(snapshot.dividendYield, 0.014);
    },
  },
  {
    name: "buildPortfolioSummary produces a weighted dividend yield for the portfolio",
    run() {
      const summary = buildPortfolioSummary([
        {
          marketValue: 1000,
          totalCost: 800,
          dayChange: 25,
          annualDividendIncome: 40,
        },
        {
          marketValue: 4000,
          totalCost: 3500,
          dayChange: -20,
          annualDividendIncome: 80,
        },
      ]);

      assert.equal(summary.totalMarketValue, 5000);
      assert.equal(summary.annualDividendIncome, 120);
      assert.equal(summary.dividendYield, 0.024);
      assert.equal(summary.totalReturn, 700);
      assert.equal(summary.totalDayReturn, 5);
      assert.equal(summary.totalReturnPercent, 700 / 4300);
      assert.equal(summary.totalDayReturnPercent, 5 / 4995);
    },
  },
  {
    name: "buildPortfolioSummary returns null dividend yield when market value is zero",
    run() {
      const summary = buildPortfolioSummary([
        {
          marketValue: 0,
          totalCost: 0,
          dayChange: null,
          annualDividendIncome: 0,
        },
      ]);

      assert.equal(summary.dividendYield, null);
      assert.equal(summary.totalDayReturnPercent, null);
      assert.equal(summary.totalReturnPercent, null);
    },
  },
  {
    name: "sanitizeAppState migrates legacy portfolio holdings into a default account",
    run() {
      const state = sanitizeAppState({
        selectedPortfolioId: "legacy",
        portfolios: [
          {
            id: "legacy",
            name: "Legacy Portfolio",
            holdings: [
              {
                symbol: "VTI",
                shares: "10",
                costBasis: "200",
              },
            ],
          },
        ],
      });

      assert.equal(state.portfolios[0].selectedAccountId, "account-1");
      assert.equal(state.portfolios[0].accounts.length, 1);
      assert.equal(state.portfolios[0].accounts[0].name, "Main Account");
      assert.equal(state.portfolios[0].accounts[0].holdings[0].symbol, "VTI");
      assert.equal(state.portfolios[0].accounts[0].holdings[0].shares, 10);
    },
  },
  {
    name: "sanitizeAppState keeps a valid selected account and falls back when needed",
    run() {
      const state = sanitizeAppState({
        selectedPortfolioId: "core",
        portfolios: [
          {
            id: "core",
            name: "Core",
            selectedAccountId: "missing",
            accounts: [
              { id: "taxable", name: "Taxable", holdings: [] },
              { id: "ira", name: "IRA", holdings: [] },
            ],
          },
        ],
      });

      assert.equal(state.portfolios[0].selectedAccountId, "taxable");
      assert.equal(state.portfolios[0].accounts.length, 2);
    },
  },
];

let failed = 0;

tests.forEach((testCase) => {
  try {
    testCase.run();
    console.log(`PASS ${testCase.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${testCase.name}`);
    console.error(error);
  }
});

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log(`All ${tests.length} tests passed.`);
}
