# Project: Scalp Bot Architecture Refactoring & Upgrade

## Architecture
- Layered Architecture: `Presentation / App -> Features / Application -> Domain <- Infrastructure`
- `local-daemon/src/domain/scalping/`: Pure scalping math, signal generators, trailing state machine, Empirical Bayes shrinkage (NO external deps, NO async/infrastructure calls).
- `src/domain/analytics/`: QuantMath facade, regime scoring, OBI, CVD, risk calculations (`classifyAssetTier`, `calculateTemporalBarrier`).
- `src/domain/trading/`: `trailingPolicy.js` (R-based stage machine).
- `local-daemon/src/application/scalping/`: Application services (`scalpEngineService.js`), coordinating between domain scalping policies, Binance gateway rate limiting, and Supabase DB tables.
- `local-daemon/src/infrastructure/`: Binance API client (`binanceGateway.js`), Supabase sync (`scalp_trade_logs`, `scalp_strategy_params`).

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1_Analysis_Exploration | Explore scalp codebase, rate limiter, QuantMath signals, trailing policy, optimizer logic, architecture checks | None | DONE |
| 2 | M2_Domain_Refactoring_and_Signals | Domain layer signals (Regime/OBI/CVD), R-based trailing policy & temporal barrier, Empirical Bayes optimizer | M1 | DONE |
| 3 | M3_Application_Infrastructure_Isolation | Application layer refactoring, binanceGateway rate limiter integration, process & resource isolation | M2 | DONE |
| 4 | M4_Verification_Audit_Release | Unit tests, check:architecture, full check, challenger tests, Forensic Integrity Audit, roadmap update | M3 | DONE |

## Interface Contracts
### `local-daemon/src/domain/scalping/scalpSignals.js`
- Signal evaluation gated by regime classification (`EXPANSION`, `RANGE`, `EXTREME`), Order Book Imbalance (OBI), and CVD Delta.

### `local-daemon/src/domain/scalping/scalpTrailing.js` / `trailingPolicy.js`
- Trailing policy using R-based stages (`NONE` -> `BE` -> `LOCK` -> `TRAIL`).
- Temporal barrier calculated via `calculateTemporalBarrier` with BTC trend alignment and soft extension (+25% duration when R >= 1.5R).

### `local-daemon/src/domain/scalping/scalpOptimizer.js`
- Regime-weighted Empirical Bayes Shrinkage parameter estimation.

### Infrastructure & Rate Limiting (`local-daemon/src/infrastructure/binance/binanceGateway.js`)
- Shared REST request governor ensuring total weight <= 2400 weight/min across Main Bot and Scalp Bot.

### Isolation Boundaries
- Scalp Bot runs in an independent Node.js process: `node local-daemon/scalpBot.js`.
- Separate DB tables: `scalp_trade_logs`, `scalp_strategy_params`.
- Isolated capital: $140 total capital limit.

## Code Layout
- `local-daemon/src/domain/scalping/`: Pure domain scalp modules.
- `local-daemon/src/application/scalping/`: Scalp engine application services.
- `local-daemon/src/infrastructure/`: Shared Binance REST gateway & DB clients.
- `local-daemon/scalpBot.js`: Scalp Bot composition root / daemon entry.
