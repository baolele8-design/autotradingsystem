# SYSTEM_RULES.md — Audited Safety Properties and Gaps

This document records what the current source actually enforces. It is not a
wish list presented as fact.

Status legend:

- **ENFORCED** — the named path checks the property before proceeding.
- **PARTIAL** — enforced only on some paths or with a known race/failure window.
- **REQUIRED / GAP** — a safety property the system should have, but current
  source does not enforce end-to-end.
- **OBSERVED** — runtime behavior, not necessarily a safety guarantee.

## 1. Main auto-bot risk and position sizing

### 1.1 Capital refill and notional budget — PARTIAL

`autoBot.processSignals()` reads Binance positions and standard open orders,
estimates occupied **notional**, refuses a new batch when occupied notional is
over `$500`, and limits selected targets to the remaining space under `$700`.
It checks `availableBalance >= $55` once before the batch.

Evidence: `local-daemon/src/legacy/autoBot.js:91-205`.

Limits:

- `$55` is used as target notional (`qty = $55 / entry`), not demonstrably as
  margin. Documentation must not call it both.
- The available-balance check is not repeated after each order in a batch.
- The snapshot and in-memory `isProcessing` flag do not lock against the
  separate scalp process, frontend execution, manual activity, or another
  daemon process.
- Conditional orders are not included in occupied notional.

### 1.2 Symbol exclusivity — PARTIAL

The main auto-bot excludes symbols having a non-zero Binance position or a
non-reduce-only standard open order, and selects at most one setup per symbol
within a batch.

Evidence: `autoBot.js:91-113`,
`local-daemon/src/domain/execution/setupSelection.js:20-81`.

This is snapshot-based, not an exchange-wide atomic invariant. Main, scalp,
frontend, and manual paths have no shared cross-process symbol lock.

### 1.3 Risk-at-stop downsizing — PARTIAL

Before quantization, main entry downsizes target notional when:

```text
$55 * abs(requestedEntry - requestedSL) / requestedEntry
    > totalMarginBalance * 1%
```

Evidence: `autoBot.js:216-233`.

The claim “no trade ever risks more than 1%” is unsupported because the code
does not recheck risk after rounding, actual fill/slippage, fees, or protection
placement. It also does not validate minimum quantity/notional or leverage
brackets in the execution function.

### 1.4 Quantity and price formatting — PARTIAL

Main entry rounds quantity and prices to the nearest step/tick and aborts only
when formatted quantity is non-positive.

Evidence: `autoBot.js:68-77`, `autoBot.js:235-247`.

This is not complete Binance filter validation. Rounding to nearest can increase
quantity; `minQty`, `maxQty`, and notional filters are not enforced here.

### 1.5 Isolated margin and leverage — REQUIRED / GAP

Main entry attempts `marginType=ISOLATED` and leverage changes, but catches and
ignores either failure before placing the entry.

Evidence: `autoBot.js:260-268`.

Therefore isolated mode is not guaranteed. The computed leverage is
`ceil(positionNotional / (totalMarginBalance * 0.9))`, usually 1 for the default
main size, and is not validated against the symbol leverage bracket in this
path.

## 2. Validation and execution surfaces

### 2.1 Scanner-generated setups — ENFORCED at generation, not at execution

`matrixScannerService` calls `TradeValidator.evaluateGates()` and broadcasts
only approved candidates. Hard gates include spread/SL distance, EV-or-RR,
liquidation margin, volume, structure, VPIN, regime, liquidation freshness,
flow, VWAP, CVD, and Hurst policies.

Evidence: `src/domain/trading/TradeValidator.js:145-272`,
`local-daemon/src/application/scanner/matrixScannerService.js:720-900`.

`autoBot.js` does not re-run those gates. It trusts the received WebSocket
payload and applies only execution-mode, interval, score, trade type, occupancy,
and cooldown filters. HTTP `/api/execute-batch` uses a separate rollout-policy
validator, not `TradeValidator`.

### 2.2 Entry/protection/persistence sequence — OBSERVED with critical gaps

Main auto-bot sequence:

```text
symbol-wide standard-order cleanup
-> best-effort margin/leverage configuration
-> entry accepted by Binance
-> attempt SL
-> attempt TP
-> insert PENDING trade_logs row
```

Evidence: `autoBot.js:255-400`.

Required but not enforced:

- If initial SL or TP placement fails, the entry is not rolled back or
  market-closed; execution continues to persistence.
- Initial SL/TP are not verified after creation.
- The main auto-bot assigns the SL algo ID immediately after SL creation, before
  attempting TP creation, so a later TP error does not erase an observed SL ID.
- If the database insert fails after entry, no compensation or durable recovery
  record is created.
- Entry `orderId`/client ID and filled quantity are not persisted, so later
  reconciliation is based on symbol and direction rather than trade identity.
- Auto-bot does not query or populate `positionSide`; its entry path assumes
  compatible account position mode.

These are dangerous failure windows, not invariants.

## 3. Position lifecycle and partial fills

### 3.1 Main lifecycle — OBSERVED

The main ledger queries `PENDING`, `OPEN`, and `CLOSED` Futures rows every three
seconds. Any matching non-zero position by symbol and direction causes the
newest matching `PENDING` row to become `OPEN`; other matching pending rows are
marked canceled. When the matching position is absent/opposite, an `OPEN` or
`CLOSED` row is resolved to `WIN` or `LOSS`.

Evidence: `local-daemon/src/application/ledger/ledgerSyncService.js:50-166`,
`ledgerSyncService.js:238-425`.

The actual state graph is:

```text
PENDING -> OPEN -> WIN | LOSS
              \-> CLOSED -> WIN | LOSS
PENDING -> CANCELED | CANCELLED_EXPIRED | CANCELLED_INVALIDATED
```

`CLOSED` is written by temporal/panic paths; it is not a mandatory transition.

### 3.2 Partial fills and ownership — REQUIRED / GAP

Any non-zero same-direction position opens the row. There is no persisted entry
order ID, target-versus-filled quantity reconciliation, partial-fill state, or
per-fill protection resizing in the main ledger. A manual or other-engine
same-direction position can be mistaken for the logged trade.

### 3.3 Initial R baseline — PARTIAL

On `PENDING -> OPEN`, main ledger computes
`abs(Binance position.entryPrice - initial_sl)`, requires it to be finite and
positive, and persists it. Main trailing skips rows with invalid initial R.

Evidence: `ledgerSyncService.js:99-151`,
`local-daemon/src/application/trading/protectionService.js:188-207`.

This is enforced for successfully reconciled rows, but it does not prove the
position is the intended fill. Scalp instead persists initial R from its
requested prices before fill and uses an in-memory fallback of 1% if invalid.

## 4. Stop loss, take profit, and order ownership

### 4.1 Main trailing replacement — ENFORCED for this path

For a replaceable main trailing stop, the service:

1. reads standard and algo orders,
2. rejects foreign stops,
3. creates and verifies a new engine-tagged stop,
4. then attempts to cancel old replaceable stops,
5. then persists trailing state.

Evidence: `local-daemon/src/application/trading/protectionService.js:372-537`,
`local-daemon/src/domain/orders/trailingOrders.js:145-208`.

Cancellation failures are logged and tolerated, so duplicate stops can remain.
The new `algoId` is not written back to `sl_algo_id`; that column can remain
stale after replacement.

### 4.2 Strictly better stop — ENFORCED with corrected threshold

Main trailing quantizes directionally, then requires an improvement of at least
`tickSize / 2` in `isStrictlyBetterStop()`. On a common tick lattice this
normally means the next tick, but the implementation is not literally an
“at least one tick” comparison.

Evidence: `trailingOrders.js:82-143`,
`protectionService.js:353-370`.

### 4.3 Stage monotonicity — PARTIAL

`calculateTrailingDecision()` never chooses a stage below the normalized stored
stage and uses persisted high-water price.

Evidence: `src/domain/trading/trailingPolicy.js:143-230`.

The stage is persisted only after a successful stop mutation. On failure,
high-water state may be saved without advancing the stage. Thresholds are
strategy-family and asset-tier dependent; they are not universally
`0.5R/1.0R/1.8R`.

### 4.4 Initial SL/TP — PARTIAL

Main and scalp entry paths attempt one `STOP_MARKET` and one
`TAKE_PROFIT_MARKET` conditional algo order with reduction semantics and mark
price protection.

Evidence: `autoBot.js:270-286`,
`local-daemon/src/application/scalping/scalpEngine.js:573-607`.

“Placed alongside entry” does not mean guaranteed active. Both paths continue
after protection failure, and neither verifies the initial orders.

### 4.5 Order ownership and symbol-wide deletion — REQUIRED / GAP

The ownership helper recognizes client IDs beginning `qts-`. Main auto-bot
initial protection derives deterministic `qts-sl-*` and `qts-tp-*` IDs from the
preallocated `trade_logs.id`; main trailing keeps the same trade token.

Evidence: `trailingOrders.js:1-68`.

Main auto-bot initial protection, main trailing replacements, and frontend
batch conditional orders receive this tag. Scalp initial protection does not,
so orphan cleanup still cannot identify every engine-created protection.

Several paths call `DELETE /fapi/v1/allOpenOrders` for a symbol: main preflight,
ledger cleanup, scanner invalidation/panic, HTTP cancel-all, and scalp cleanup.
That endpoint is not trade-specific and can cancel manual or other-engine
standard orders.

### 4.6 Symbol mutation lock — PARTIAL

`withSymbolOrderLock()` is an in-memory, main-daemon, skip-if-held lock used by
main protection, orphan cleanup, and one HTTP cleanup route.

Evidence: `protectionService.js:31-48`.

It is not used by main entry, ledger cancellation, scanner panic/invalidation,
HTTP batch placement/cancel-all, or scalp. It is neither queued nor
cross-process and vanishes on restart.

### 4.7 Scalp trailing safety claim — FALSE in prior documentation/comments

Scalp trailing posts a new SL and a new TP, but does not verify the new SL and
does not delete the prior SL in that flow. It then advances in-memory and
database state even if the POST block threw.

Evidence: `scalpEngine.js:850-930`.

The comment claiming “POST -> verify -> DELETE” is not implemented.

## 5. Pending orders and temporal exits

### 5.1 Main pending expiry — PARTIAL

The ledger expires a `PENDING` row after three parsed timeframe durations from
`created_at`, then cancels protection by persisted algo ID or the deterministic
trade client ID before canceling all standard orders on the symbol.
Invalid/missing timeframes do not expire.

Evidence: `src/domain/trading/pendingOrderPolicy.js:7-110`,
`ledgerSyncService.js:167-238`.

The scanner also independently re-evaluates pending gates and uses the same
trade-specific algo cancellation helper before canceling all standard symbol
orders. These two mutation paths do not share the symbol lock.

### 5.2 Main temporal barrier — PARTIAL

Protection market-closes a matching position when its holding limit is reached,
with a 25% extension for sufficiently profitable `LOCK`/`TRAIL` trades, then
sets the row to `CLOSED`.

Evidence: `protectionService.js:209-330`.

Cleanup after the close only deletes `qts-` owned SL/TP discovered from the
exchange. Legacy untagged main orders and untagged scalp orders may remain
until another path cancels them. A successful market close and successful
database update are separate operations.

### 5.3 Scanner panic exit — OBSERVED and previously omitted

The scanner can market-close an `OPEN` trade after a severe structure/flow
break, delete all standard symbol orders, and mark the row `CLOSED`.

Evidence: `matrixScannerService.js:638-672`.

This is an execution path and must be included in any lifecycle, locking, and
order-cleanup review.

## 6. Persistence and PnL

### 6.1 Supabase is durable intent/history, Binance is live position state

Neither is a complete single source of truth. Main protection is driven by
`trade_logs`; live position presence is read from Binance. Missing or stale
records can make a real position untracked or make an unrelated same-symbol
position look owned.

### 6.2 Main final PnL — PARTIAL, not exact

The ledger requests the last 20 symbol trades, filters from
`opened_at - 60 seconds` when possible, and sums `realizedPnl`. It does not
subtract commission or funding. If no trade data is found, it estimates from a
fallback close price and stored notional.

Evidence: `ledgerSyncService.js:326-414`.

Because there is no entry/order ID attribution, the selected symbol/time window
can include unrelated fills. When the position is already zero,
`findPositionForTrade()` returns no position, so close-price fallback can be the
stored entry. Exit-reason classification is heuristic.

### 6.3 Write failures — REQUIRED / GAP

Order placement and Supabase persistence are not transactional or idempotent.
The outer main-ledger catch also suppresses unexpected errors without logging.
`local-daemon/sql/optimizer_data_contract_v1.sql` defines the optimizer
additions and guarded removal of unused columns, but it is not a complete
from-zero schema for every table.

### 6.4 Post-trade enrichment — PARTIAL

`planned_holding_cycles` is captured at entry and is not replaced by elapsed
holding time at close. Main ledger resolution writes elapsed time to
`actual_holding_cycles`, records `metric_version`, and resets
`pee_analyzed=false`.

The PEE service queries unresolved `WIN`/`LOSS` rows directly from
`trade_logs`. Its horizon is
`clamp(round(1.5 * planned_holding_cycles), 6, 24)` complete trade-timeframe candles,
starting with the first complete candle after `close_time`. It stores
`pee_window_candles`, `pee_policy_version`, and `pee_analyzed_at`.

This path is independent of the scanner's current dynamic coin pool. Rows
missing `close_time`, `planned_holding_cycles`, or a complete evaluation window
are skipped rather than filled with estimates. The v1.5.2 repair uses Binance
1-minute candles with provenance `backfill-binance-1m/v1`: 17 of 20 resolved
rows had sufficient lifecycle geometry, while three were intentionally left
without reconstructed metrics.

The daemon also processes a bounded batch of resolved rows every five minutes
and replaces missing or process-local lifecycle MFE/MAE with complete Binance
1-minute candle reconstruction. Partial histories and rows with unprovable
geometry are not persisted.

## 7. Restart and concurrency

### 7.1 Main restart reconciliation — PARTIAL

After main daemon boot, scheduled loops query active Supabase rows and current
Binance positions/orders. Exchange-hosted orders survive daemon restart, and
main trailing can resume for a valid `OPEN` row.

This is not full reconstruction:

- missing DB rows are not synthesized from Binance positions;
- missing SL/TP are not recreated on boot;
- `PENDING`/`OPEN` ownership remains symbol+direction based;
- action cooldowns and symbol locks reset;
- initial untagged orphan orders may not be recognized.

Evidence: `local-daemon/src/bootstrap.js:90-222`,
`ledgerSyncService.js:50-425`, `protectionService.js:159-537`.

### 7.2 Main singleton — PARTIAL

The main daemon exits on `EADDRINUSE` for its configured HTTP/WS port.

Evidence: `bootstrap.js:83-107`,
`local-daemon/src/config/environment.js:16-31`.

This prevents two main instances from binding the same host/port. It does not
lock the Binance account, prevent a different `PORT`, or cover scalp processes.

### 7.3 Scalp recovery — PARTIAL

Scalp boot loads `PENDING`/`OPEN` rows from `scalp_trade_logs` and associates
them with live positions by symbol/direction. Positions without matching rows
are warned about but not adopted.

Evidence: `scalpEngine.js:1104-1185`.

Recovered records do not restore persisted `sl_algo_id`/`tp_algo_id` into the
in-memory trade object, so later trade-specific cancellation can lack IDs.

### 7.4 Binance REST rate control — ENFORCED for documented live processes

Main services, legacy auto-bot, and the HTTP Binance bridge precharge a shared
daemon coordinator before every Binance REST call. Scalp is a separate process
and reserves against the same coordinator through loopback-only HTTP routes;
if that coordinator is unavailable, scalp REST requests fail closed.

The coordinator tracks `REQUEST_WEIGHT` plus 10-second and one-minute `ORDERS`,
reconciles response headers upward, and blocks all lanes after HTTP 429/418 for
the observed `Retry-After`. Default request/order ceilings preserve progressive
headroom: market data 65%, account reads 75%, ordinary execution 85%, and
protection/reduce-only actions 95%, leaving 5% below the discovered exchange
limit.

Endpoint weights are explicit and fail closed when unknown; the frontend proxy
also accepts only its audited endpoint allowlist. The architecture check scans
production source for new literal Binance endpoints without a weight contract.

After daemon restart, ordinary traffic remains fail-closed until one governed
weight-1 Binance time request returns and seeds the current response-header
state. This prevents all gateway instances from treating an in-progress
exchange minute as empty at the same time.

This is not an exchange-wide guarantee. The counters are RAM state and reset
when the main daemon restarts; another program, manual script, VPS container,
or host sharing the public IP can consume Binance budget outside the
coordinator. Endpoint costs are conservative estimates and response headers
remain the authoritative correction available after a request.

## 8. Optimizer

### 8.1 Training data partition — ENFORCED in optimizer core

Only resolved `WIN`/`LOSS` rows with recognized source, strategy/tier,
non-discretionary exit reason, non-zero PnL, positive risk, and consistent
status/exit signs are usable. Paper rows are restricted to `PAPER_ONLY`
strategies; live rows reject `PAPER_ONLY` strategies.

Evidence: `local-daemon/src/application/optimization/optimizerCore.js:285-363`.

The current strategy catalog contains 13 strategies and all 13 are `LIVE`;
there are currently no `PAPER_ONLY` catalog entries. Consequently paper rows
are expected to be rejected under current catalog policy.

### 8.2 Optimizer cadence and authority — ENFORCED

The latest model is loaded before daemon services start. A coordinated cycle
runs at boot and hourly: lifecycle enrichment, mature PEE evaluation, model
build, save, then reload. A process-local single-flight guard prevents
overlapping cycles. The model stores a SHA-256 fingerprint of usable learning
evidence, so an unchanged dataset does not create another epoch.

Evidence: `local-daemon/src/bootstrap.js`,
`local-daemon/src/application/optimization/optimizationCycleService.js`,
`local-daemon/src/application/runtime/daemonScheduler.js`.

The optimizer writes `system_models` and is intended to adapt only TP/SL/tHold
targets, with deterministic fallback for insufficient samples. It does not
repair bad ledger attribution; filtered-but-wrong rows can still train it.

Trailing proposals are hierarchical: strategy × tier × coin-regime is the
parent, with exact BTC-regime children shrunk toward the parent. Five usable
excursions permit `OBSERVE`; at least fifteen in the exact cell are required
for `ACTIVE`. Missing, unknown, insufficient, or invalid BTC context falls
back to the parent proposal or deterministic trailing policy. The temporary
Adaptive Short Tier 3 observation override remains non-promotable.

Scalp optimization is separate and runs every 30 minutes inside
`scalpEngine.js`.

## 9. Dangerous assumptions register

Do not assume any of the following without a code change and dedicated tests:

1. An accepted entry always has an active, verified SL and TP.
2. `$55` means margin rather than notional.
3. Requested entry/SL risk equals actual filled and quantized risk.
4. Main, scalp, frontend, and manual trading share a lock or ownership ledger.
5. A symbol identifies one trade, especially in hedge mode or after restart.
6. `allOpenOrders` cleanup is scoped to one strategy/trade.
7. Every engine order has a `qts-` ownership tag or persisted algo ID.
8. `realizedPnl` equals net PnL after commission and funding.
9. Port binding makes the Binance account single-writer.
10. Restart recreates missing protection or missing database state.
11. A stored `CLOSED` row already contains final PnL.
12. Optimizer data is trustworthy merely because it passed row-level filters.
13. The daemon rate coordinator accounts for unrelated programs sharing the
    VPS public IP.
