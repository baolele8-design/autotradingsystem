import QuantMath from '../../../domain/analytics/QuantMath.js';
import { TradeValidator } from '../../../domain/trading/TradeValidator.js';
import {
  getStrategyDefinition,
  routeStrategy
} from '../../../domain/trading/strategyRouter.js';

export function deriveActiveTierClass({ autoData, apiMacro, symbol }) {
  if (!autoData || !apiMacro) return 'Đang phân loại...';

  const usdVol24h =
    autoData.usdVolume24h ||
    0;

  return QuantMath.classifyAssetTier(
    symbol,
    usdVol24h,
    apiMacro.realSpreadPct
  );
}

export function deriveVectorRegime({
  autoData,
  apiMacro,
  cmcData,
  mvrvZScore,
  symbol
}) {
  if (!autoData || !apiMacro || !cmcData) return null;
  return QuantMath.evaluateVectorState(
    autoData,
    apiMacro,
    mvrvZScore,
    symbol
  );
}

export function deriveSystemScore({
  autoData,
  apiMacro,
  vectorRegime,
  tradeSetup,
  mvrvZScore,
  symbol,
  activeTierClass
}) {
  if (!autoData || !apiMacro || !vectorRegime) {
    return {
      score: 0,
      synergyText: '',
      penaltyText: '',
      checks: {},
      w: {},
      passingScore: 50
    };
  }

  const routedStrategy =
    getStrategyDefinition(tradeSetup.activeStrategyId) ||
    routeStrategy({
      autoData,
      apiMacro,
      vectorDetails: vectorRegime.details,
      direction: tradeSetup.direction,
      symbol,
      assetTier: activeTierClass
    });
  const score = TradeValidator.evaluateScore(
    autoData,
    apiMacro,
    vectorRegime.details,
    tradeSetup.direction,
    mvrvZScore,
    symbol,
    null
  );
  return {
    ...score,
    passingScore: Math.max(
      score.passingScore,
      routedStrategy.profile?.minScore || 50
    )
  };
}
