import QuantMath from '../../../domain/analytics/QuantMath.js';

export function deriveMathCore({
  autoData,
  apiMacro,
  liveCapital,
  availableBalance,
  tradeSetup,
  symbol,
  tradeStats,
  leverageBrackets,
  vectorRegime,
  tradeFees,
  dynamicMinNotionals,
  systemScore,
  intervalTime,
  activeTierClass
}) {
  const safeResult = {
    appliedRiskPercent: 1.0,
    slPercent: '0.00',
    riskAmountUSD: '0.00',
    positionSizeUSD: '0.00',
    marginUsedUSD: '0.00',
    suggestedLeverage: 1,
    theoreticalRR: '0.00',
    trueEVValue: '0.00',
    kellyPct: 0,
    liqEstimate: null,
    liqSafetyMargin: 0,
    leverageExceedsExchangeCap: false,
    dynamicSlDistance: 0,
    isSizeForcedByExchange: false
  };

  if (
    !autoData ||
    !vectorRegime ||
    !tradeSetup.entry ||
    tradeSetup.entry <= 0 ||
    tradeSetup.slTech <= 0
  ) {
    return safeResult;
  }

  const riskDiffTech = Math.abs(tradeSetup.entry - tradeSetup.slTech);

  let cRegime;
  const l1Str = String(vectorRegime.details.l1 || '');
  if (l1Str.includes('Trend')) {
    cRegime = 1.2;
  } else if (vectorRegime.details.l2 === 'Extreme') {
    cRegime = 0.5;
  } else {
    cRegime = 0.8;
  }

  const currentHourUTC = new Date().getUTCHours();
  const routedTHold = QuantMath.calculateTemporalBarrier(
    intervalTime,
    tradeSetup.tradeType,
    tradeSetup.direction,
    vectorRegime.details,
    activeTierClass,
    currentHourUTC,
    tradeSetup.activeStrategyId || tradeSetup.activeStrategy,
    tradeSetup.tHoldModifier || 1
  );
  const tHold =
    Number.isFinite(Number(tradeSetup.holdingCycles)) &&
    Number(tradeSetup.holdingCycles) >= 2
      ? Number(tradeSetup.holdingCycles)
      : routedTHold;

  const minSafeAtr = 0.005;
  const isCompressed =
    vectorRegime.details.l2 === 'Compression' ||
    autoData.bbwRank < 20;
  const effectiveAtrPercent = isCompressed
    ? Math.max(autoData.atrPercent, minSafeAtr * 100) * 1.5
    : autoData.atrPercent;
  const slippageBuffer =
    tradeSetup.entry *
    (effectiveAtrPercent / 100) *
    cRegime *
    apiMacro.sessionMultiplier;
  const sizeSlDistance = riskDiffTech + slippageBuffer;
  let slPercentForSize = sizeSlDistance / tradeSetup.entry;
  if (
    !isFinite(slPercentForSize) ||
    isNaN(slPercentForSize) ||
    slPercentForSize === 0
  ) {
    slPercentForSize = 0.01;
  }

  const activeMakerFee = tradeFees.maker;
  const activeTakerFee = tradeFees.taker;
  const costDragLoss = QuantMath.costDrag(
    tradeSetup.entry,
    tradeSetup.tradeType,
    tradeSetup.direction,
    tradeSetup.execution,
    'MARKET',
    autoData.fundingRate / 100,
    apiMacro.realSpreadPct,
    tHold,
    activeMakerFee,
    activeTakerFee,
    intervalTime,
    autoData.obi
  );
  const costDragWin = QuantMath.costDrag(
    tradeSetup.entry,
    tradeSetup.tradeType,
    tradeSetup.direction,
    tradeSetup.execution,
    'LIMIT',
    autoData.fundingRate / 100,
    apiMacro.realSpreadPct,
    tHold,
    activeMakerFee,
    activeTakerFee,
    intervalTime,
    autoData.obi
  );

  const rewardDiff1 = Math.abs(tradeSetup.tp1 - tradeSetup.entry);
  let theoreticalRR =
    riskDiffTech > 0
      ? (rewardDiff1 - costDragWin) /
        (riskDiffTech + costDragLoss)
      : 0;
  if (
    !isFinite(theoreticalRR) ||
    isNaN(theoreticalRR) ||
    theoreticalRR < 0
  ) {
    theoreticalRR = 0;
  }

  const bayesianPrior = 0.45;
  const effectiveWinRate =
    tradeStats.totalClosed < 30
      ? (bayesianPrior * (30 - tradeStats.totalClosed) +
          (tradeStats.winRate || 0) * tradeStats.totalClosed) /
        30
      : tradeStats.winRate;
  const effectiveLossRate = 1 - effectiveWinRate;
  const trueEVCalc = QuantMath.trueEV(
    effectiveWinRate,
    theoreticalRR,
    effectiveLossRate,
    1
  );

  const capitalSafe = liveCapital > 0 ? liveCapital : 0;
  const passingScore = systemScore.passingScore || 50;
  const scoreRange = 100 - passingScore;
  const riskMultiplier = Math.max(
    0.5,
    Math.min(
      2.0,
      0.5 +
        ((systemScore.score - passingScore) / scoreRange) * 1.5
    )
  );
  const appliedRiskPercent =
    tradeSetup.riskPercent * riskMultiplier;

  let riskAmountUSD =
    capitalSafe * (appliedRiskPercent / 100);
  let positionSizeUSD = riskAmountUSD / slPercentForSize;
  if (!isFinite(positionSizeUSD) || isNaN(positionSizeUSD)) {
    positionSizeUSD = 0;
  }

  const targetMinThreshold = dynamicMinNotionals[symbol] || 5.0;
  let isSizeForcedByExchange = false;

  if (
    positionSizeUSD > 0 &&
    positionSizeUSD < targetMinThreshold
  ) {
    positionSizeUSD = targetMinThreshold;
    isSizeForcedByExchange = true;
    riskAmountUSD = positionSizeUSD * slPercentForSize;
  }

  let suggestedLeverage = 1;
  let marginUsedUSD = positionSizeUSD;
  if (tradeSetup.tradeType === 'FUTURES') {
    const minRequiredLev =
      positionSizeUSD / (capitalSafe * 0.9 || 1);
    suggestedLeverage = Math.max(1, Math.ceil(minRequiredLev));
    marginUsedUSD = positionSizeUSD / suggestedLeverage;
  }

  let liqEstimate = null;
  let leverageExceedsExchangeCap = false;
  let liqSafetyMargin = 0;

  if (
    tradeSetup.tradeType === 'FUTURES' &&
    leverageBrackets
  ) {
    liqEstimate = QuantMath.estimateLiquidation(
      positionSizeUSD,
      suggestedLeverage,
      tradeSetup.entry,
      tradeSetup.direction,
      leverageBrackets
    );

    if (liqEstimate) {
      if (suggestedLeverage > liqEstimate.maxLevForTier) {
        leverageExceedsExchangeCap = true;
        suggestedLeverage = liqEstimate.maxLevForTier;
        marginUsedUSD = positionSizeUSD / suggestedLeverage;
        liqEstimate = QuantMath.estimateLiquidation(
          positionSizeUSD,
          suggestedLeverage,
          tradeSetup.entry,
          tradeSetup.direction,
          leverageBrackets
        );
      }

      const liqDistancePct =
        Math.abs(tradeSetup.entry - liqEstimate.liqPrice) /
        tradeSetup.entry;
      const dynamicSlPct =
        sizeSlDistance / tradeSetup.entry;
      liqSafetyMargin =
        dynamicSlPct > 0
          ? liqDistancePct / dynamicSlPct
          : 0;
    }
  }

  const hasInsufficientMargin =
    parseFloat(marginUsedUSD) > availableBalance;
  const hasMinNotionalError =
    riskAmountUSD > capitalSafe * 0.05;
  const kellyDec = QuantMath.kellyCriterion(
    tradeStats.winRate,
    tradeStats.historicalRR,
    tradeStats.totalClosed
  );

  return {
    appliedRiskPercent: appliedRiskPercent.toFixed(2),
    slPercentForSize: (slPercentForSize * 100).toFixed(2),
    riskAmountUSD: riskAmountUSD.toFixed(2),
    positionSizeUSD: positionSizeUSD.toFixed(2),
    marginUsedUSD: marginUsedUSD.toFixed(2),
    suggestedLeverage,
    theoreticalRR: theoreticalRR.toFixed(2),
    trueEVValue: trueEVCalc.toFixed(3),
    kellyPct: (kellyDec * 100).toFixed(2),
    liqEstimate,
    liqSafetyMargin,
    leverageExceedsExchangeCap,
    dynamicSlDistance: sizeSlDistance,
    isSizeForcedByExchange,
    hasInsufficientMargin,
    hasMinNotionalError,
    tHold
  };
}
