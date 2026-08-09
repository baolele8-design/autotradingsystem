# Strategy Router v1

The router evaluates a strategy in four stages:

1. Regime must match.
2. A strategy-specific trigger must fire.
3. At least two independent confirmations must pass.
4. Shared safety gates may still reject the setup.

Only one strategy wins for each direction. The scanner then keeps one direction
per symbol and timeframe.

## Priority catalog

| Priority | Stable ID | Family | Core trigger | Default SL / TP / hold |
|---:|---|---|---|---|
| 1100 | `CAPITULATION_RECLAIM` | Event reversal | Same-side liquidation flush plus SFP/MSB reclaim | 1.2 / 2.8 / 4 |
| 1000 | `PASSIVE_ABSORPTION_REVERSAL` | Event reversal | SFP outside value while aggressive CVD is absorbed | 1.1 / 2.4 / 5 |
| 900 | `CROWDED_CARRY_UNWIND` | Positioning reversal | Extreme funding/crowd conflict with top traders | 1.3 / 3.2 / 6 |
| 800 | `VOL_COMPRESSION_IGNITION` | Structural breakout | Compression releases with MSB and closed-volume expansion | 1.3 / 3.5 / 5 |
| 700 | `LIQUIDITY_VACUUM_DRIVE` | Structural breakout | High Amihud percentile plus directional expansion | 1.5 / 3.8 / 4 |
| 600 | `CVD_STRUCTURE_DIVERGENCE` | Flow reversal | CVD leads a reclaim against the current HTF structure | 1.4 / 2.6 / 6 |
| 500 | `SMART_MONEY_OI_BUILD` | Position continuation | New OI, top-trader and taker flow align | 1.6 / 3.4 / 7 |
| 400 | `VALUE_AREA_TREND_PULLBACK` | Trend continuation | Persistent trend pulls back to EMA/VWAP value | 1.5 / 3.0 / 8 |
| 300 | `FLOW_REACCELERATION` | Trend continuation | Trend resumes through MACD, EMA and active flow | 1.4 / 3.2 / 5 |
| 200 | `ALT_CAPITAL_ROTATION` | Macro rotation | BTC-dominance rotation aligns with alt flow | 1.6 / 3.6 / 8 |
| 100 | `VOLATILITY_EXTREME_FADE` | Mean reversion | Range regime reaches VWAP 2σ and RSI extreme | 1.2 / 2.2 / 4 |

When none match, the router returns a direction-specific Adaptive fallback.

## Feature contracts

- VPIN, CVD, CMF, VWAP and SFP use base-asset volume.
- Amihud uses fractional absolute return per USD 1m quote turnover; routing
  uses `amihudRank`, never a legacy absolute threshold.
- Liquidations use observed force-order USDT notional over a rolling 15-minute
  window. Ratios use expected quote turnover over the same 15 minutes.
- `BTCDOMUSDT` supplies slope only. BTC-dominance level comes from CMC.
- Current open-candle volume is not used for the L2 expansion decision.
- Missing or stale event data fails closed.

## Rollout and learning

All eleven strategies are `PAPER_ONLY` in v1. The live bot rejects them even
when their gates pass. Promotion requires, at minimum:

- 100 shadow signals for the strategy;
- 30 resolved paper trades for the strategy;
- 15 clean outcomes in a strategy × tier cell before optimizer targets apply.

The optimizer may change only `slMult`, `tpMult` and `tHold_modifier`. Routing,
direction, gate weights, score thresholds and position risk remain
deterministic.
