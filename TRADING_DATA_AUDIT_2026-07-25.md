# Trading Data Audit — 2026-07-25

## Outcome snapshot

| Cohort | Trades | Win rate | Expectancy | Profit factor |
|---|---:|---:|---:|---:|
| All resolved WIN/LOSS rows | 156 | 46.2% | -0.029R | 0.672 |
| Excluding `MANUAL_CLOSE` | 107 | 29.9% | -0.109R | 0.366 |

The 49 manual closes contain 40 wins and 9 losses, adding USD 23.66. They create
strong selection bias and are excluded from optimizer learning.

The non-manual algorithmic cohort contains 32 wins and 75 losses, with total
PnL of approximately USD -53.72. The full resolved cohort is approximately
USD -30.06.

## Data quality

- 94 of 156 historical rows encode missing microstructure fields as zero.
- Historical CVD, Hurst, VWAP and liquidation fields are zero in essentially
  all resolved rows.
- OBI persisted historically is top-of-book OBI, while routing used depth
  heatmap OBI.
- Status, PnL and exit reason are inconsistent in part of the ledger.
- The current strategy taxonomy has too few resolved trades for inference.

Consequently, old rows cannot validate the new strategy taxonomy. They are
useful only for broad cold-start distributions and for identifying plumbing
errors.

## Observational hypotheses, not production evidence

- HTF-aligned trades: 95 samples, approximately +0.043R expectancy.
- Counter-trend trades: approximately -0.140R expectancy.
- ADX 25–50 with absolute OI delta no greater than 1%: 23 samples,
  approximately 56.5% win rate and +0.024R expectancy.
- BBW rank above 75, VPIN at least 0.10 and ISI above 0.10 were negative in
  this sample.
- Receiving funding while taker flow did not oppose the trade produced a
  positive result in only 10 samples; this is too small for promotion.

These observations informed conservative confirmations and vetoes. They were
not used to fit strategy rules or claim out-of-sample alpha.

## Optimizer eligibility after cleaning

- Raw resolved rows: 156.
- Usable algorithmic outcomes after consistency filtering: 51.
- Rejected/noisy rows: 105.
- Largest clean strategy × tier cell: 13.
- Learned cells at the 15-sample minimum: 0.

This is expected cold-start behavior. Each matrix cell keeps its deterministic
strategy baseline until it reaches 15 clean outcomes.
