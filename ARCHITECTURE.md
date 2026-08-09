# ARCHITECTURE.md — Audited Runtime and Side-Effect Map

This map describes the current source as audited. Line numbers are approximate
navigation aids; module/function names are the durable references.

## 1. Processes and entry points

| Process | Entry | Runtime |
|---|---|---|
| Main daemon | `local-daemon/server.js` -> `local-daemon/src/bootstrap.js` | One HTTP server with WebSocket attached; default `PORT=1338` |
| Legacy auto-bot | import side effect from `bootstrap.js` | Connects to `ws://localhost:1338`, consumes `SCAN_RESULTS`, places main automated trades |
| Frontend | `index.html` -> `src/main.jsx` -> `src/app/AntiFragileTerminal.jsx` | React UI; can use daemon HTTP execution routes and write Supabase through feature modules |

There is no separate HTTP port 3001 in current source. `PORT` may override 1338,
but the legacy auto-bot WebSocket URL remains hard-coded to 1338.

## 2. Layering: implemented check versus intended design

Intended direction:

```text
presentation/app -> features/application -> domain
infrastructure ---------------------------> domain consumers
```

`npm run check:architecture` scans selected source roots and enforces only:

- new-layer files may not import specified legacy frontend paths;
- frontend domain may not import paths containing
  `infrastructure/features/app`;
- daemon domain may not import paths containing
  `application/infrastructure/presentation`.

It does not prove “zero external dependencies”, side-effect freedom, dependency
inversion, database ownership, or runtime concurrency safety.

## 3. Main daemon composition and cadence

`bootstrap.js` constructs:

- a process-wide Binance rate coordinator and read/trade gateway;
- Supabase client;
- market-data cache and Binance streams;
- HTTP routes and WebSocket hub;
- matrix scanner;
- ledger sync;
- protection/trailing;
- orphan cleanup;
- paper simulation and post-trade evaluation;
- runtime model/MVRV state.

After successful port binding, the scheduler starts:

| Service | Cadence |
|---|---|
| Matrix scanner | first call after 5s; next call 60s after the prior scan completes |
| Ledger sync | recursive 3s timeout after each completion |
| Main protection | recursive 5s timeout after each completion |
| Orphan cleanup | recursive 20s timeout after each completion |
| Paper trading | recursive 5m timeout |
| Lifecycle MFE/MAE enrichment + PEE | recursive 5m timeout |
| HUD | 10s interval |
| Binance clock sync | immediately, then 2m interval |
| MVRV sync | immediately, then 12h interval |
| Main optimization cycle | boot, then 1h interval when training data changed |

Post-trade evaluation is ledger-driven rather than scan-pool-driven: it queries
unanalysed resolved rows from `trade_logs` and fetches the stored symbol's
historical klines directly. A symbol leaving the dynamic scanner pool therefore
does not by itself remove that row from PEE processing. Its evaluation window
is `clamp(round(1.5 * planned_holding_cycles), 6, 24)` complete trade-timeframe
candles, beginning with the first complete candle after `close_time`; the
window, policy version, and analysis timestamp are persisted. Planned holding
cycles are captured at entry, while actual elapsed cycles are written at
resolution.

Before each optimization cycle, resolved rows with incomplete or process-local
lifecycle metrics are incrementally rebuilt from complete Binance 1-minute
candles. The optimizer computes a SHA-256 fingerprint of usable evidence,
skips unchanged epochs, and reloads only a newly saved model.

Evidence: `local-daemon/src/bootstrap.js`,
`local-daemon/src/application/runtime/daemonScheduler.js`,
`matrixScannerService.matrixScannerLoop()`.

## 4. Main automated execution flow

```text
Binance market streams / REST
        |
        v
matrixScannerService
  - calculates market state
  - routes strategies
  - calls TradeValidator
  - also mutates pending/open trades in invalidation/panic paths
        |
        v SCAN_RESULTS over daemon WebSocket
legacy autoBot
  - snapshots positions + standard open orders
  - filters/ranks/cooldown/capital checks
  - symbol-wide standard-order preflight cleanup
  - best-effort margin/leverage change
  - places entry
  - attempts initial SL then TP
  - inserts PENDING trade_logs row
        |
        +-----------------> Binance
        |
        +-----------------> Supabase
```

Important boundaries:

- Scanner validation and execution are separate. The auto-bot does not re-run
  hard gates.
- Exchange acceptance, protection creation, and database insert are not one
  transaction.
- Main auto-bot owns a gateway instance for signing/cache isolation, but that
  instance shares the daemon's process-wide Binance rate coordinator.
- Auto-bot cooldown and processing state are process-local.

## 5. Main lifecycle and protection flows

### Ledger reconciliation

```text
trade_logs(PENDING/OPEN/CLOSED) + Binance positionRisk
        |
        +-- PENDING + matching non-zero direction
        |      -> persist actual position entry and initial R -> OPEN
        |
        +-- PENDING + no position
        |      -> trade-specific algo cancellation
        |      -> standard-order cancellation
        |      -> expiry or gate-invalidation status
        |
        +-- OPEN/CLOSED + no matching direction
               -> cancel stored algo IDs
               -> cancel all standard symbol orders
               -> query recent symbol userTrades
               -> heuristic PnL/exit classification
               -> WIN or LOSS
```

The join key is effectively symbol+direction, not an entry order/fill ID.

### Main trailing

```text
OPEN trade_logs + positionRisk + mark-price cache
        |
        +-- invalid initial R/filter/order state -> skip
        |
        +-- temporal limit -> market reduce position -> CLOSED
        |
        +-- trailing decision
               -> directional tick quantization
               -> process-local symbol lock
               -> read standard + algo orders
               -> reject foreign stop
               -> POST and verify tagged replacement
               -> cancel old replaceable stop(s)
               -> persist SL/stage/high water
```

The replacement order's algo ID is not persisted back to `sl_algo_id`.

### Scanner mutation paths

The scanner is not read-only:

- it re-evaluates `PENDING` logs and can delete all standard symbol orders and
  mark a row canceled;
- it can market-close an `OPEN` position on panic reversal, delete all standard
  symbol orders, and mark the row `CLOSED`.

These paths do not use `withSymbolOrderLock`.

## 6. Other execution paths

### HTTP batch bridge

`POST /api/execute-batch` in `registerRoutes.js` accepts a batch from the
frontend, validates rollout policy, best-effort sets Futures margin/leverage,
checks position mode, and posts each order. Conditional Futures orders receive
`qts-` client algo IDs. This route does not insert the main auto-bot
`trade_logs` row itself and does not run `TradeValidator`.

Other mutation routes include owned-orphan cleanup and symbol-wide cancel-all.

### Frontend persistence

`src/features/trading-workspace/application/tradeLedger.js` also inserts and
updates `trade_logs`. Reviews that treat `autoBot.js` and `ledgerSyncService.js`
as the only writers are incomplete.

## 7. State ownership and durability

| State | Location | Owner(s) | Restart behavior |
|---|---|---|---|
| Market candles/marks | RAM | market cache | Refilled from REST/WS |
| Main cooldowns | RAM | legacy auto-bot | Lost |
| Main symbol lock | RAM | protection service | Lost |
| Main lifecycle/risk geometry | Supabase `trade_logs` | auto-bot, scanner, ledger, protection, frontend actions | Queried after boot; missing rows are not reconstructed |
| Exchange positions/orders | Binance | every execution surface/manual actor | Survive daemon restart |
| Main optimizer models | Supabase `system_models` | optimizer writes; runtime/frontend read | Latest model loaded |
| Binance REST budget | Main-daemon RAM | shared coordinator | Lost/reset at daemon restart; response headers reconcile upward |

No single store has complete trade identity and lifecycle truth.

## 8. Exchange side-effect map

| Module | Side effects |
|---|---|
| `legacy/autoBot.js` | margin/leverage, entry, initial SL/TP, all-standard-order cleanup |
| `presentation/http/registerRoutes.js` | Futures/Spot batch orders, margin/leverage, owned cleanup, cancel-all |
| `scanner/matrixScannerService.js` | trade-ID algo cancellation, standard pending cancellation, and panic market close |
| `ledger/ledgerSyncService.js` | persisted-ID/deterministic-client-ID algo cancellation and all-standard-order cleanup |
| `trading/orderOwnershipService.js` | shared trade-specific SL/TP cancellation references |
| `trading/protectionService.js` | temporal market close and verified main trailing replacement |
| `trading/orphanCleanupService.js` | owned orphan/duplicate conditional-order deletion |

Any change to order ownership, hedge mode, or symbol locking must audit every
row in this table.

## 9. Persistence and optimizer data flow

Main optimizer at boot:

```text
last 90 days trade_logs WIN/LOSS
        +
last 90 days paper_trade_logs WIN/LOSS
        |
        v normalize + partitionUsableTrades
        |
        v strategy x asset-tier model
        |
        v system_models insert
```

The optimizer filters unresolved/discretionary/numerically inconsistent rows
and partitions live versus paper rollout modes. It does not independently
verify exchange fills or net PnL. Main ledger currently supplies gross
`realizedPnl` attribution without commission/funding.

The current strategy catalog has 13 `LIVE` strategies (11 named strategies plus
two adaptive fallbacks) and zero `PAPER_ONLY` strategies.

## 10. Recovery and failure boundaries

Main restart recovery is reconciliation, not reconstruction:

- active Supabase rows are compared with live positions;
- valid `OPEN` rows can resume trailing;
- missing rows, missing protection, and unknown live positions are not repaired;
- exchange orders without recognized ownership tags may remain;
- locks/cooldowns reset.

Critical non-atomic windows:

1. entry succeeds, initial SL/TP fails;
2. entry and protection succeed, DB insert fails;
3. market close succeeds, DB update fails;
4. replacement succeeds, old stop cancellation or DB update fails;
5. same-symbol activity occurs concurrently in another process/path;
6. recent `userTrades` includes fills unrelated to the ledger row.

These boundaries are the starting point for incident analysis and future safety
work. They must not be documented as already solved.
