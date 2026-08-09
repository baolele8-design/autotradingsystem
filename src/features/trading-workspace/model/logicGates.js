import { TradeValidator } from '../../../domain/trading/TradeValidator.js';
import { getStrategyDefinition } from '../../../domain/trading/strategyRouter.js';

export function deriveLogicGates({
  autoData,
  apiMacro,
  mathCore,
  vectorRegime,
  tradeSetup,
  systemScore,
  tradeLogs,
  symbol
}) {
  if (!autoData || !mathCore || !vectorRegime) {
    return {
      hardGates: [],
      softGates: [],
      softScore: 0,
      isApproved: false
    };
  }

  return TradeValidator.evaluateGates(
    autoData,
    apiMacro,
    vectorRegime.details,
    mathCore,
    tradeSetup.direction,
    tradeSetup.tradeType,
    tradeSetup.entry,
    tradeSetup.slTech,
    systemScore,
    tradeLogs,
    symbol,
    getStrategyDefinition(
      tradeSetup.activeStrategyId || tradeSetup.activeStrategy
    ) || tradeSetup.activeStrategyId || tradeSetup.activeStrategy
  );
}
