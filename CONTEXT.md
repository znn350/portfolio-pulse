# Portfolio Pulse Context

## Purpose

Portfolio Pulse is a small full-stack app for tracking stock, ETF, mutual fund, and money market holdings across multiple portfolios. It shows:

- Live quotes
- Market overview for major indexes
- Portfolio-level performance
- Dividend income
- Fund expense ratios
- Google-authenticated user access

The codebase is intentionally compact:

- `server.js`: Express API, auth, persistence, Yahoo Finance integration
- `public/index.html`: Single-page app markup
- `public/app.js`: All client-side state, rendering, and event handling
- `public/styles.css`: Complete visual system and responsive layout

## Runtime Model

- Server: Node + Express
- Frontend: vanilla HTML/CSS/JS, no framework, no bundler
- Data source: `yahoo-finance2`
- Persistence:
  - Local files under `data/` when `BLOB_READ_WRITE_TOKEN` is absent
  - Vercel Blob when `BLOB_READ_WRITE_TOKEN` is present
- Auth: Google OAuth + signed session cookies

`package.json` only exposes:

- `npm start`: run server normally
- `npm run dev`: run `node --watch server.js`

There is no test suite, build step, or lint setup in the repo right now.

## High-Level Flow

### 1. Authentication

The app boots in `public/app.js` by calling `/api/auth/session`.

- If unauthenticated, it shows the auth shell
- If authenticated, it:
  - shows the app shell
  - loads owner-only admin users if needed
  - loads saved app state from the server
  - refreshes live market data and portfolio snapshots

Google sign-in is allowlist-based:

- First Google user can self-register as owner
- Later users must already exist in the server-side user store
- Owner can add more users from the UI

### 2. Saved State

Each authenticated user has isolated saved state:

- `selectedPortfolioId`
- `portfolios[]`
- each portfolio has `id`, `name`, `holdings[]`

Client behavior:

- saves to `localStorage` immediately for fast hydration
- debounces server saves with `scheduleServerSave()`
- reloads canonical state from `/api/app-state`

### 3. Live Data

Live holding data is not persisted. The client posts current holdings to `/api/portfolio-snapshot`, and the server enriches them with Yahoo data:

- price
- day change
- day change percent
- market value
- total return
- dividend rate/yield
- annual dividend income
- expense ratio for funds

Market overview comes from `/api/market-overview`.

## Server Map

All server logic lives in `server.js`.

### Core responsibilities

- manual `.env` loading
- auth cookie signing and verification
- Google OAuth flow
- users store read/write
- per-user app state read/write
- Yahoo Finance search/quote/dividend/expense-ratio helpers
- API endpoints
- static file serving

### Main storage helpers

- `readUsersStore()` / `writeUsersStore()`
- `readAppStateForUser(userId)` / `writeAppStateForUser(userId, state)`
- local storage path helpers:
  - `data/users.json`
  - `data/users/<userId>/portfolio-state.json`
- blob storage path helpers:
  - `auth/users.json`
  - `app-state/users/<userId>/portfolio-state.json`

### Important normalization/sanitization helpers

- `toNumber()`
- `normalizeSymbol()`
- `normalizeYahooYield()`
- `normalizeYahooRatio()`
- `sanitizeHolding()`
- `sanitizePortfolio()`
- `sanitizeAppState()`
- `sanitizeUserRecord()`
- `sanitizeUsersStore()`

These are important because the app trusts saved JSON from disk/blob and also consumes inconsistent Yahoo payloads.

### Auth helpers

- `getGoogleOAuthConfig(req)`
- `exchangeGoogleAuthorizationCode(...)`
- `validateGoogleIdTokenClaims(...)`
- `provisionOrFindGoogleUser(...)`
- `authenticateRequest`
- `requireOwner`

### Market data helpers

- `searchSymbolsWithYahoo(query)`
- `getYahooQuoteSnapshot(symbol)`
- `getYahooDividendSnapshot(symbol)`
- `getYahooExpenseRatioSnapshot(symbol)`
- `getHoldingMarketData(holding)`
- `buildHoldingSnapshot(holding, marketData)`
- `getMarketOverviewItem(config)`

### API routes

Public auth routes:

- `GET /api/auth/session`
- `GET /api/auth/google`
- `GET /api/auth/google/callback`
- `POST /api/auth/logout`

Authenticated routes:

- `GET /api/app-state`
- `PUT /api/app-state`
- `GET /api/search?q=...`
- `GET /api/quote?symbol=...`
- `GET /api/market-overview`
- `POST /api/portfolio-snapshot`

Owner-only routes:

- `GET /api/admin/users`
- `POST /api/admin/users`

Fallback route:

- all non-API requests return `public/index.html`

## Client Map

All client behavior lives in `public/app.js`.

### State model

Key globals:

- `currentUser`
- `state`
- `lastSnapshot`
- `lastMarketSnapshot`
- `portfolioPerformanceById`
- UI toggles for panels/forms/theme
- edit/drag/search/quote-preview bookkeeping

This is a classic single-file SPA script with shared mutable state and explicit rerenders through `render()`.

### Rendering structure

Main render functions:

- `render()`
- `renderPortfolios()`
- `renderAdminUsers()`
- `renderSummary()`
- `renderMarketOverview()`
- `renderHoldings()`

If a future change affects visible data, it probably needs updates in one or more of those functions.

### Persistence and boot flow

- `initializeSession()`
- `handleAuthenticatedUser(user)`
- `loadStateFromServer()`
- `pushStateToServer()`
- `scheduleServerSave()`
- `cacheStateLocally()`
- `tryHydrateFromLocalCache(user)`

### Portfolio editing

- `addPortfolio()`
- `renameSelectedPortfolio()`
- `deleteSelectedPortfolio()`
- `upsertHolding(holding)`
- `removeHolding(symbol)`
- `startEditingHolding(symbol)`
- `reorderHoldings(...)`

### Live refresh

- `refreshSnapshot()`
- `refreshPortfolioPerformanceSummaries()`
- `refreshMarketOverview()`
- `refreshAllSnapshots()`

### Search and quote preview

- `searchSymbols(query)`
- `loadQuotePreview(symbol)`
- `renderSymbolPreview(quote)`
- share calculator logic is tied to quote preview state

## Markup Map

`public/index.html` has two top-level shells:

- `#auth-shell`: signed-out / setup UI
- `#app-shell`: authenticated application UI

Inside the app shell:

- sidebar
  - signed-in panel
  - portfolios panel
  - holding form panel
  - owner-only access panel
- main content
  - market overview strip
  - hero/live overview panel
  - stats grid
  - holdings table

Most JS queries elements once at startup through the `elements` object, so ID changes in HTML will usually require matching JS updates.

## Styling Map

`public/styles.css` is the full design system.

Important traits:

- CSS custom properties for theme tokens
- light/dark theme via `:root[data-theme="dark"]`
- responsive breakpoints at `1080px`, `720px`, and `420px`
- mobile table collapses into card-like stacked rows
- visual language is warm/editorial in light mode and cool/glassier in dark mode

If future work touches layout, check both desktop and mobile because the holdings table transforms heavily at smaller widths.

## Environment Variables

Used by the server:

- `PORT`
- `SESSION_SECRET`
- `BLOB_READ_WRITE_TOKEN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `NODE_ENV`
- `VERCEL`

Behavior notes:

- without Google OAuth env vars, sign-in UI stays visible but disabled
- without blob token, app falls back to local file storage
- without `SESSION_SECRET`, a secret is generated and stored at `data/auth-secret.txt`

## Data Shapes

### Holding input shape

```json
{
  "symbol": "AAPL",
  "quoteType": "EQUITY",
  "shares": 10,
  "costBasis": 180.5,
  "purchaseDate": "2026-01-15",
  "notes": "Taxable account"
}
```

### Saved app state shape

```json
{
  "selectedPortfolioId": "core",
  "portfolios": [
    {
      "id": "core",
      "name": "Core Portfolio",
      "holdings": []
    }
  ]
}
```

### Snapshot response shape

`/api/portfolio-snapshot` returns:

- `holdings[]` with computed market fields
- `summary`
- `dataProviders[]`
- `refreshedAt`

The server derives summary totals from the live snapshots, not from saved state.

## Good Entry Points For Future Changes

### Add a new holding-level metric

Touch:

- server snapshot builders in `server.js`
- holdings table rendering in `public/app.js`
- table headers and/or mobile labels in `public/index.html` if needed

### Add a new portfolio summary card

Touch:

- summary aggregation in `server.js`
- `renderSummary()` in `public/app.js`
- stats markup in `public/index.html`
- corresponding styles in `public/styles.css`

### Change auth or access behavior

Touch:

- server auth flow in `server.js`
- signed-out messaging in `public/index.html`
- client boot/auth presentation in `public/app.js`

### Change persistence

Touch:

- read/write helpers in `server.js`
- save/load messaging in `public/app.js`

## Watch-Outs

- `public/app.js` is large and stateful; small changes can have side effects across render, save, and refresh flows.
- Many UX flows assume a selected portfolio always exists. Keep at least one portfolio in state.
- Holdings are uniquely identified by `symbol` within a portfolio, including edit and drag logic.
- Server-side sanitizers are important. If the saved state shape changes, update sanitization first.
- Snapshot data is fetched repeatedly across portfolios to populate the sidebar performance values, so new expensive per-holding work can multiply quickly.
- Because there is no framework, there is no component isolation. Renaming IDs/classes can easily break behavior.
- There is no automated test coverage in the repo right now, so manual verification matters after edits.

## Recommended Manual Checks After Changes

- Sign in flow still works
- Saved portfolios load correctly after refresh
- Add, edit, delete, and reorder holdings still work
- Portfolio switching still updates summary and holdings
- Market overview still renders
- Mobile holdings layout still looks correct
- Owner-only access panel still works for owner accounts
- Dark mode still preserves readable contrast

## Suggested Next Improvements

If we keep developing this app, the highest leverage quality improvements would be:

- split `public/app.js` into smaller modules
- split `server.js` into auth, storage, and market-data modules
- add a lightweight test harness for pure helpers
- add a lint/format setup
- document a local dev + auth setup flow in `README.md`
