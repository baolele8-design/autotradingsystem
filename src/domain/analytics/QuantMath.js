import * as statistics from './quant/statistics.js';
import * as indicators from './quant/indicators.js';
import * as regime from './quant/regime.js';
import * as risk from './quant/risk.js';
import * as microstructure from './quant/microstructure.js';

const QuantMath = {
  sma: statistics.sma,
  ema: statistics.ema,
  emaSeries: statistics.emaSeries,
  macd: indicators.macd,
  vwapWithBands: indicators.vwapWithBands,
  cvd: indicators.cvd,
  hurst: indicators.hurst,
  orderBookHeatmap: indicators.orderBookHeatmap,
  evaluateL1: regime.evaluateL1,
  evaluateL2: regime.evaluateL2,
  evaluateL3: regime.evaluateL3,
  evaluateL4: regime.evaluateL4,
  evaluateL5: regime.evaluateL5,
  evaluateL6: regime.evaluateL6,
  evaluateVectorState: regime.evaluateVectorState,
  trueRange: indicators.trueRange,
  atr: indicators.atr,
  adx: indicators.adx,
  rsi: indicators.rsi,
  bollinger: indicators.bollinger,
  percentileRank: statistics.percentileRank,
  obv: indicators.obv,
  cmf: indicators.cmf,
  costDrag: risk.costDrag,
  trueEV: risk.trueEV,
  kellyCriterion: risk.kellyCriterion,
  scanEmaRange: indicators.scanEmaRange,
  detectSFP_Advanced: indicators.detectSFP_Advanced,
  detectSFP_Institutional_Advanced: indicators.detectSFP_Institutional_Advanced,
  dynamicAsymmetricTargets: risk.dynamicAsymmetricTargets,
  estimateLiquidation: risk.estimateLiquidation,
  classifyAssetTier: risk.classifyAssetTier,
  cusumFilter: microstructure.cusumFilter,
  vpin: microstructure.vpin,
  rollMeasure: microstructure.rollMeasure,
  amihudIlliquidity: microstructure.amihudIlliquidity,
  amihudProfile: microstructure.amihudProfile,
  liquidationPressure: microstructure.liquidationPressure,
  pearsonCorrelation: statistics.pearsonCorrelation,
  immediateSensitivityIndicator: microstructure.immediateSensitivityIndicator,
  detectMarketStructure: indicators.detectMarketStructure,
  calculateTemporalBarrier: risk.calculateTemporalBarrier
};

export default QuantMath;
