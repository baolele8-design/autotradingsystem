# AGENTS.md — Trading-System Safety and Development Rules

This file is the operating guide for coding agents. Source code and tests are the
authority for current behavior. `SYSTEM_RULES.md` distinguishes enforced
properties from required-but-not-enforced safety rules; `ARCHITECTURE.md`
documents the observed runtime.

Before changing production code, data contracts, schemas, configuration, or
dependencies, read `AI_CHANGE_POLICY.md` completely. Its root-cause,
calculation, data-safety, external-documentation, and completion gates are
mandatory on every agent platform.

## 1. Non-negotiable workflow

1. Read the complete target file and its callers before editing.
2. Trace order and persistence side effects across all execution surfaces, not
   just the named module.
3. For a defect, reproduce it or collect concrete evidence before editing,
   identify the root cause, and add a regression test that fails for the
   original defect whenever practical. Do not patch symptoms without stating
   why the underlying cause cannot be fixed.
4. Make the smallest correct change. Do not hide failures with dummy values,
   empty catches, silent fallback behavior, or optimistic documentation.
5. For production-code changes, **always** run `npm run check` and inspect `git diff`.
   `npm run check` now includes ESLint which immediately catches undefined variables and syntax errors.
   - **On Windows:** If `npm run check` fails with "cannot be loaded because running scripts is disabled" (Execution Policy), you MUST run it via `cmd /c npm run check`. Do not skip this step!
   For documentation-only changes, at minimum run `npm run check:architecture`; run the full check when practical.
6. Update `logs/roadmap.md` only when the task authorizes it. Do not change
   production version strings for a documentation-only audit.
7. Before completion, verify that only files in the authorized scope changed.
   The worktree may already contain user changes; preserve them.

## 2. Evidence standard for safety claims

- Do not write “must”, “never”, “atomic”, “exact”, “single source of truth”, or
  “guarantees” unless every reachable path enforces the property.
- A comment is not evidence. An error that is caught and ignored is evidence
  that the operation is best-effort, not guaranteed.
- A process-local `Map` or `Set` is not a cross-process lock and does not
  survive restart.
- A database row is not exchange-order ownership unless it stores and later
  matches a stable exchange/client order identifier.
- Passing `npm run check:architecture` proves only the import rules implemented
  in `scripts/check-architecture.mjs`; it does not prove domain purity,
  transactional safety, or correct trading behavior.
- When evidence is partial, label the statement `PARTIAL` or `GAP`; do not
  promote desired behavior into an invariant.

## 3. Actual process and layer map

```text
Frontend/UI -> features -> domain
                     \-> daemon HTTP execution bridge

Main daemon:
bootstrap -> scanner / ledger / protection / orphan cleanup / optimizer
          -> Binance + Supabase
          -> legacy autoBot through the daemon WebSocket
```

- The operational system spans four distinct boundaries: Binance, Supabase,
  one or more VPS runtimes, and the user's local machine. Before changing
  configuration, networking, scheduling, persistence, startup, or recovery,
  identify which process runs where and which credentials, environment
  variables, clocks, files, ports, and versions each environment actually uses.
- Do not assume a local result proves VPS behavior, or that Supabase state
  proves Binance state. Binance positions/orders, Supabase rows, VPS
  processes/files, and local processes/files are separate sources of evidence
  that can diverge and must be reconciled explicitly.
- `local-daemon/server.js` imports `local-daemon/src/bootstrap.js`.
- The default daemon port is `1338` (`PORT` can override it). HTTP and WebSocket
  share the same server and port; there is no separately bound port 3001 in the
  current source.
- `local-daemon/src/legacy/autoBot.js` starts as an import side effect and opens
  a WebSocket to `ws://localhost:1338`.
- `src/domain/` and `local-daemon/src/domain/` contain calculation/policy code,
  but “zero external dependencies” is too broad: tests import Node modules.
  The architecture check
  only forbids selected inward-to-outer relative imports.

## 4. Critical execution surfaces

All of these can mutate exchange or persistent state and must be audited
together when ownership, lifecycle, risk, or order contracts change.

| Surface | Source | Actual responsibility |
|---|---|---|
| Main daemon composition | `local-daemon/src/bootstrap.js` | Shared HTTP/WS server and scheduled services |
| Main automated entry | `local-daemon/src/legacy/autoBot.js` | Selects scanner setups, sizes and places entry plus initial SL/TP, inserts `trade_logs` |
| HTTP/manual batch execution | `local-daemon/src/presentation/http/registerRoutes.js` | Places frontend-submitted Futures or Spot batches; does not use the main auto-bot ledger flow |
| Scanner mutations | `local-daemon/src/application/scanner/matrixScannerService.js` | Generates setups, but also cancels pending orders and can market-close `OPEN` trades on panic reversal |
| Main lifecycle reconciliation | `local-daemon/src/application/ledger/ledgerSyncService.js` | Reconciles active `trade_logs` with Binance positions, expires pending rows, resolves outcomes |
| Main protection | `local-daemon/src/application/trading/protectionService.js` | Main trailing replacement and temporal market close |
| Orphan/duplicate cleanup | `local-daemon/src/application/trading/orphanCleanupService.js` | Deletes only recognized engine-owned conditional orders and prunes duplicates |
| Main order helpers | `local-daemon/src/domain/orders/trailingOrders.js` | Direction matching, ownership tags, price quantization, POST/verify-before-delete helper |
| Optimizer runner/core | `local-daemon/src/application/optimization/optimizer.js`, `optimizerCore.js` | Reads resolved live/paper rows, filters them, writes a model at main-daemon boot |
| Frontend ledger actions | `src/features/trading-workspace/application/tradeLedger.js` | Additional `trade_logs` inserts/updates initiated by UI workflows |

## 5. High-risk review checklist

### Risk and sizing

- Distinguish notional, margin, account equity, available balance, and risk at
  stop. In the main auto-bot, `positionSizeUSD` is used as notional
  (`qty = positionSizeUSD / entry`), despite comments calling `$55` margin.
- Recompute risk after quantity and price quantization and, for market fills,
  against actual fill price. Current main entry code does not enforce this
  end-to-end.
- Check `LOT_SIZE`, minimum quantity, notional filters, leverage brackets, fees,
  slippage, and simultaneous batch consumption. A `finalQty > 0` check alone is
  insufficient.

### Entry and lifecycle

- Treat “entry accepted”, “position filled”, “SL verified”, “TP verified”, and
  “ledger row persisted” as separate states.
-   Never assume `PENDING -> OPEN -> CLOSED -> WIN/LOSS` is universal. The main
  ledger commonly resolves `OPEN` directly to `WIN`/`LOSS`; `CLOSED` is an
  intermediate state used by temporal/panic paths.
- Audit partial fill, hedge mode, same-symbol manual positions, and duplicate
  rows. Symbol+direction matching is not trade-level ownership.

### SL/TP and cleanup

- Main trailing replacement uses create+verify before deleting replaceable
  stops. Initial main SL/TP placement does not provide the same
  guarantee.
- `DELETE /fapi/v1/allOpenOrders` is symbol-wide for standard orders. It can
  affect manual or other-engine orders and must never be described as
  trade-specific cleanup.
- The `qts-` client-ID ownership convention is not applied to initial orders
  placed by `autoBot.js`; orphan cleanup therefore cannot
  recognize all engine-created SL/TP orders.

### Persistence, restart, and optimizer

- Main restart behavior depends on active Supabase rows plus Binance position
  snapshots; it does not reconstruct missing trade rows or re-create missing
  protection orders.
- PnL currently sums Binance `realizedPnl` from a limited symbol/time window.
  It does not subtract commission or funding and is not exact trade-level
  attribution.
- Main optimization runs once at daemon boot. The latest saved model is reloaded
  at boot and hourly; the optimizer itself is not scheduled hourly.
- Optimizer source partitioning and sample filters are enforced in
  `optimizerCore.js`, but their quality is bounded by ledger attribution and
  exit-reason correctness.

See `SYSTEM_RULES.md` for the full verified/gap register.

## 6. Permanent unified trailing schedule (2026-08-11)

- **Policy:** one schedule for **every** strategy, asset tier and regime —
  `BE 0.2R / LOCK 0.4R locking +0.2R / TRAIL 0.6R trailing 0.2R`
  (owner directive 2026-08-11, superseding the 2026-08-07 unified schedule).
  Family profiles, keyword fallbacks, tier offsets and regime buckets are
  removed; the owner's rationale is to take profits earlier and trail tightly.
- **Enforcement, three layers:**
  1. `getTrailingPolicy` returns the unified schedule for every call in
     `src/domain/trading/trailingPolicy.js` (no strategy/tier branching);
  2. `resolveOptimizedTrailingPolicy` returns `null` unconditionally, so a
     saved optimizer model — including stale pre-deploy rows — can never
     override the schedule at runtime;
  3. `isPinnedTrailingPolicyCell` returns `true` for every cell, so
     `optimizerCore.js` forces any ACTIVE/OBSERVE regime or BTC-context
     proposal to `status: BASELINE` with
     `activation_block: 'PERMANENT_PINNED_SCHEDULE'`.
- The shadow `rollback` lane in `local-daemon/src/domain/analytics/liveTradePath.js`
  resolves to the same pinned policy; there is no divergent rollback schedule.
- History for rollback/debug only: the 2026-08-07 unified schedule was
  `BE 0.35R / LOCK 0.6R locking +0.35R / TRAIL 1.0R trailing 0.5R`; the
  2026-08-06 adaptive floor was `BE 0.40R / LOCK 1.00R / +0.35R / TRAIL 1.50R / 0.60R`;
  before that, family/tier keyword schedules existed (see the 2026-08-03
  observation schedule and pre-observation per-tier values below). Re-opening
  this schedule requires a new owner directive.

## 7. Binance REST rate-limit contract

- Main services, legacy auto-bot, and the HTTP bridge must use
  `binanceGateway.js`; do not add direct Binance `fetch`/Axios calls.
- Every new Binance REST endpoint needs an explicit conservative entry in
  `estimateBinanceRateCost()`. Unknown endpoints intentionally fail closed, and
  HTTP proxy endpoints require an explicit allowlist entry.
- Preserve the priority headroom order: market data 65%, account 75%, ordinary
  execution 85%, protection/reduce-only 95%. A change requires endpoint-weight
  evidence plus burst and 429/418 regression tests.
- Preserve cold-start reconciliation: only one weight-1 time probe may pass
  before response headers mark the shared coordinator ready. Do not remove it
  merely to speed up daemon restart.
- This control covers the documented live processes, not arbitrary scripts or
  other programs sharing the VPS IP. Never describe it as an exchange-wide
  guarantee without reconciling those external consumers.

## 8. Commands

```bash
npm run dev
npm run test
npm run check:architecture
npm run build
npm run check
npm --prefix local-daemon start
```

## 9. Deployment (2026-08-09)

- **Automatic**: pushing `main` to GitHub triggers `.github/workflows/deploy.yml`,
  which runs `scripts/deploy.sh` on the VPS (`root@222.255.181.141:/root/quant-bot`):
  reset tracked build artifacts (`git checkout -- .`) → fetch → ff-only merge →
  `npm ci` → `npm test` (hard gate) → `check:architecture` warn-only (TD-005 known)
  → `npm run build` → `local-daemon npm ci` → `pm2 restart main-bot frontend`.
- **Manual**: `ssh root@222.255.181.141` then `cd /root/quant-bot && bash scripts/deploy.sh`
  (`--dry-run` to preview). Deploy log: `logs/deploy.log`; previous HEAD in `.deploy-prev-head`.
- The CI SSH key lives in the GitHub secret `VPS_SSH_DEPLOY_KEY` (no passphrase).
  Rotating it requires updating the secret plus `~/.ssh/authorized_keys` on the VPS.
