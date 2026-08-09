const ROLLOUT_MODE = Object.freeze({
  LIVE: 'LIVE',
  PAPER_ONLY: 'PAPER_ONLY'
});

export const STRATEGY_IDS = Object.freeze({
  CAPITULATION_RECLAIM: 'CAPITULATION_RECLAIM',
  PASSIVE_ABSORPTION_REVERSAL: 'PASSIVE_ABSORPTION_REVERSAL',
  CROWDED_CARRY_UNWIND: 'CROWDED_CARRY_UNWIND',
  VOL_COMPRESSION_IGNITION: 'VOL_COMPRESSION_IGNITION',
  LIQUIDITY_VACUUM_DRIVE: 'LIQUIDITY_VACUUM_DRIVE',
  CVD_STRUCTURE_DIVERGENCE: 'CVD_STRUCTURE_DIVERGENCE',
  SMART_MONEY_OI_BUILD: 'SMART_MONEY_OI_BUILD',
  VALUE_AREA_TREND_PULLBACK: 'VALUE_AREA_TREND_PULLBACK',
  FLOW_REACCELERATION: 'FLOW_REACCELERATION',
  ALT_CAPITAL_ROTATION: 'ALT_CAPITAL_ROTATION',
  VOLATILITY_EXTREME_FADE: 'VOLATILITY_EXTREME_FADE',
  ADAPTIVE_LONG_FALLBACK: 'ADAPTIVE_LONG_FALLBACK',
  ADAPTIVE_SHORT_FALLBACK: 'ADAPTIVE_SHORT_FALLBACK'
});

const freezeProfile = ({
  slMult,
  tpMult,
  holdingCycles,
  minScore
}) => Object.freeze({
  slMult,
  tpMult,
  holdingCycles,
  minScore
});

const freezePolicy = ({
  allowRange = false,
  allowHighVpin = false
} = {}) => Object.freeze({
  allowRange,
  allowHighVpin
});

const defineStrategy = ({
  strategyId,
  displayName,
  family,
  priority,
  rolloutMode,
  profile,
  policy,
  supportedDirections = ['LONG', 'SHORT']
}) => Object.freeze({
  strategyId,
  displayName,
  family,
  priority,
  rolloutMode,
  supportedDirections: Object.freeze([...supportedDirections]),
  profile: freezeProfile(profile),
  policy: freezePolicy(policy)
});

/**
 * Stable strategy metadata.
 *
 * `strategyId` is the database/model key. Display names can be translated later
 * without invalidating optimizer cells. The eleven new strategies deliberately
 * remain PAPER_ONLY until shadow and walk-forward validation promote them.
 */
export const PAPER_STRATEGY_CATALOG = Object.freeze([
  defineStrategy({
    strategyId: 'CAPITULATION_RECLAIM',
    displayName: 'Capitulation Reclaim',
    family: 'EVENT_REVERSAL',
    priority: 1100,
    rolloutMode: ROLLOUT_MODE.LIVE,
    profile: { slMult: 1.2, tpMult: 2.8, holdingCycles: 4, minScore: 62 },
    policy: { allowRange: true, allowHighVpin: true }
  }),
  defineStrategy({
    strategyId: 'PASSIVE_ABSORPTION_REVERSAL',
    displayName: 'Passive Absorption Reversal',
    family: 'EVENT_REVERSAL',
    priority: 1000,
    rolloutMode: ROLLOUT_MODE.LIVE,
    profile: { slMult: 1.1, tpMult: 2.4, holdingCycles: 5, minScore: 60 },
    policy: { allowRange: true, allowHighVpin: true }
  }),
  defineStrategy({
    strategyId: 'CROWDED_CARRY_UNWIND',
    displayName: 'Crowded Carry Unwind',
    family: 'POSITIONING_REVERSAL',
    priority: 900,
    rolloutMode: ROLLOUT_MODE.LIVE,
    profile: { slMult: 1.3, tpMult: 3.2, holdingCycles: 6, minScore: 60 },
    policy: { allowRange: true }
  }),
  defineStrategy({
    strategyId: 'VOL_COMPRESSION_IGNITION',
    displayName: 'Volatility Compression Ignition',
    family: 'STRUCTURAL_BREAKOUT',
    priority: 800,
    rolloutMode: ROLLOUT_MODE.LIVE,
    profile: { slMult: 1.3, tpMult: 3.5, holdingCycles: 5, minScore: 61 },
    policy: { allowRange: true }
  }),
  defineStrategy({
    strategyId: 'LIQUIDITY_VACUUM_DRIVE',
    displayName: 'Liquidity Vacuum Drive',
    family: 'STRUCTURAL_BREAKOUT',
    priority: 700,
    rolloutMode: ROLLOUT_MODE.LIVE,
    profile: { slMult: 1.5, tpMult: 3.8, holdingCycles: 4, minScore: 64 },
    policy: { allowHighVpin: true }
  }),
  defineStrategy({
    strategyId: 'CVD_STRUCTURE_DIVERGENCE',
    displayName: 'CVD Structure Divergence',
    family: 'FLOW_REVERSAL',
    priority: 600,
    rolloutMode: ROLLOUT_MODE.LIVE,
    profile: { slMult: 1.4, tpMult: 2.6, holdingCycles: 6, minScore: 61 }
  }),
  defineStrategy({
    strategyId: 'SMART_MONEY_OI_BUILD',
    displayName: 'Smart Money OI Build',
    family: 'POSITION_CONTINUATION',
    priority: 500,
    rolloutMode: ROLLOUT_MODE.LIVE,
    profile: { slMult: 1.6, tpMult: 3.4, holdingCycles: 7, minScore: 58 }
  }),
  defineStrategy({
    strategyId: 'VALUE_AREA_TREND_PULLBACK',
    displayName: 'Value Area Trend Pullback',
    family: 'TREND_CONTINUATION',
    priority: 400,
    rolloutMode: ROLLOUT_MODE.LIVE,
    profile: { slMult: 1.5, tpMult: 3.0, holdingCycles: 8, minScore: 56 }
  }),
  defineStrategy({
    strategyId: 'FLOW_REACCELERATION',
    displayName: 'Flow Reacceleration',
    family: 'TREND_CONTINUATION',
    priority: 300,
    rolloutMode: ROLLOUT_MODE.LIVE,
    profile: { slMult: 1.4, tpMult: 3.2, holdingCycles: 5, minScore: 59 }
  }),
  defineStrategy({
    strategyId: 'ALT_CAPITAL_ROTATION',
    displayName: 'Alt Capital Rotation',
    family: 'MACRO_ROTATION',
    priority: 200,
    rolloutMode: ROLLOUT_MODE.LIVE,
    profile: { slMult: 1.6, tpMult: 3.6, holdingCycles: 8, minScore: 60 }
  }),
  defineStrategy({
    strategyId: 'VOLATILITY_EXTREME_FADE',
    displayName: 'Volatility Extreme Fade',
    family: 'MEAN_REVERSION',
    priority: 100,
    rolloutMode: ROLLOUT_MODE.LIVE,
    profile: { slMult: 1.2, tpMult: 2.2, holdingCycles: 4, minScore: 64 },
    policy: { allowRange: true }
  })
]);

export const ADAPTIVE_FALLBACK_CATALOG = Object.freeze([
  defineStrategy({
    strategyId: 'ADAPTIVE_LONG_FALLBACK',
    displayName: 'Adaptive Long Fallback',
    family: 'ADAPTIVE',
    priority: 0,
    rolloutMode: ROLLOUT_MODE.LIVE,
    supportedDirections: ['LONG'],
    profile: { slMult: 1.5, tpMult: 3.0, holdingCycles: 8, minScore: 50 }
  }),
  defineStrategy({
    strategyId: 'ADAPTIVE_SHORT_FALLBACK',
    displayName: 'Adaptive Short Fallback',
    family: 'ADAPTIVE',
    priority: 0,
    rolloutMode: ROLLOUT_MODE.LIVE,
    supportedDirections: ['SHORT'],
    profile: { slMult: 1.5, tpMult: 3.0, holdingCycles: 6, minScore: 50 }
  })
]);

export const STRATEGY_CATALOG = Object.freeze([
  ...PAPER_STRATEGY_CATALOG,
  ...ADAPTIVE_FALLBACK_CATALOG
]);

const CATALOG_BY_ID = new Map(
  STRATEGY_CATALOG.map(strategy => [strategy.strategyId, strategy])
);

const asFiniteNumber = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = asFiniteNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const isAtLeast = (value, threshold) =>
  value !== null && value >= threshold;

const isAtMost = (value, threshold) =>
  value !== null && value <= threshold;

const isBetween = (value, lower, upper) =>
  value !== null && value >= lower && value <= upper;

const absoluteAtMost = (value, threshold) =>
  value !== null && Math.abs(value) <= threshold;

const directionSign = direction => direction === 'LONG' ? 1 : -1;

const directionalThreshold = (value, direction, longThreshold, shortThreshold) => {
  if (value === null) return false;
  return direction === 'LONG'
    ? value >= longThreshold
    : value <= shortThreshold;
};

const inverseDirectionalThreshold = (
  value,
  direction,
  longThreshold,
  shortThreshold
) => {
  if (value === null) return false;
  return direction === 'LONG'
    ? value <= longThreshold
    : value >= shortThreshold;
};

function buildFeatures({
  autoData = {},
  apiMacro = {},
  vectorDetails = {},
  direction,
  symbol = '',
  assetTier = ''
}) {
  const sign = directionSign(direction);
  const currentPrice = firstNumber(autoData.currentPrice);
  const atr14 = firstNumber(autoData.atr14);
  const ema20 = firstNumber(autoData.ema20?.value);
  const ema50 = firstNumber(autoData.ema50?.value);
  const htfSma200 = firstNumber(autoData.htfSma200);
  const vwap = firstNumber(autoData.vwap);
  const vwapUpper = firstNumber(autoData.vwapUpper);
  const vwapLower = firstNumber(autoData.vwapLower);
  const suppliedVwapZ = firstNumber(autoData.vwapZ);
  const vwapSigma = vwap !== null && vwapUpper !== null && vwapUpper > vwap
    ? (vwapUpper - vwap) / 2
    : null;
  const vwapZ = suppliedVwapZ !== null
    ? suppliedVwapZ
    : (
      currentPrice !== null &&
      vwap !== null &&
      vwapSigma !== null &&
      vwapSigma > 0
        ? (currentPrice - vwap) / vwapSigma
        : null
    );

  const avgVolume20 = firstNumber(autoData.avgVolume20);
  const lastClosedVolume = firstNumber(autoData.lastClosedVolume);
  const volumeRatio = firstNumber(
    autoData.closedVolumeRatio,
    (
      avgVolume20 !== null &&
      avgVolume20 > 0 &&
      lastClosedVolume !== null
        ? lastClosedVolume / avgVolume20
        : null
    )
  );

  const oiDelta = firstNumber(autoData.oiDelta);
  const oiDeltaRank = firstNumber(autoData.oiDeltaRank);
  const fundingRate = firstNumber(autoData.fundingRate);
  const fundingSlope = firstNumber(autoData.fundingSlope);
  const fundingRateRank = firstNumber(autoData.fundingRateRank);
  const fundingSlopeRank = firstNumber(autoData.fundingSlopeRank);
  const liqLongRatio = firstNumber(
    autoData.liqLongRatio,
    autoData.liqLongsRatio
  );
  const liqShortRatio = firstNumber(
    autoData.liqShortRatio,
    autoData.liqShortsRatio
  );
  const amihudRank = firstNumber(autoData.amihudRank);
  const realSpreadPct = firstNumber(apiMacro.realSpreadPct);

  const cmf = firstNumber(autoData.cmf);
  const cvd = firstNumber(autoData.cvdTrend);
  const obi = firstNumber(autoData.obi);
  const takerRatio = firstNumber(apiMacro.takerBuySellRatio);
  const topTraderRatio = firstNumber(apiMacro.lsPositionVolRatio);
  const crowdRatio = firstNumber(apiMacro.longShortRatio);
  const fearGreed = firstNumber(apiMacro.fgiValue);
  const rsi = firstNumber(autoData.rsi);
  const adx = firstNumber(autoData.adx);
  const atrRank = firstNumber(autoData.atrRank);
  const bbwRank = firstNumber(autoData.bbwRank);
  const bbwSlope = firstNumber(autoData.bbwSlope);
  const hurst = firstNumber(autoData.hurstValue);
  const btcDomSlope = firstNumber(autoData.btcDomSlope);
  const sTrend = firstNumber(vectorDetails.sTrend);
  const momScore = firstNumber(vectorDetails.momScore);
  const posScore = firstNumber(vectorDetails.posScore);
  const macdHist = firstNumber(autoData.macd?.hist);
  const ema20Slope = firstNumber(autoData.ema20?.slope);
  const ema50Slope = firstNumber(autoData.ema50?.slope);
  const emaDistanceAtr = (
    currentPrice !== null &&
    ema20 !== null &&
    atr14 !== null &&
    atr14 > 0
  )
    ? ((currentPrice - ema20) / atr14) * sign
    : null;

  const l1 = String(vectorDetails.l1 || '');
  const l2 = String(vectorDetails.l2 || '');
  const msbState = String(autoData.msbState || '');
  const isLong = direction === 'LONG';
  const msbAligned = isLong
    ? msbState === 'Bullish_MSB'
    : msbState === 'Bearish_MSB';
  const msbContradictory = isLong
    ? msbState === 'Bearish_MSB'
    : msbState === 'Bullish_MSB';
  const sfpAligned = isLong
    ? autoData.isBullishSFP === true
    : autoData.isBearishSFP === true;

  const directionalLiqRatio = isLong ? liqLongRatio : liqShortRatio;
  const liquidationDataReady =
    autoData.liquidationReady === true &&
    autoData.liquidationCoverageReady === true &&
    autoData.liquidationStale !== true;
  const liquidationHigh =
    liquidationDataReady &&
    isAtLeast(directionalLiqRatio, 0.10);
  // R1 (2026-08-10): tier-2 soft cho CAPITULATION — stream connected nhưng
  // coverage/stale fail khiến baseline ratio understate → dùng raw directional
  // liq vol (USD). LONG: SELL liquidations (liqLongsVol), SHORT: liqShortsVol.
  const liquidationConnected = autoData.liquidationConnected === true;
  const directionalLiqVol = isLong
    ? firstNumber(autoData.liqLongsVol)
    : firstNumber(autoData.liqShortsVol);

  const oiHigh = oiDeltaRank !== null
    ? oiDeltaRank >= 75 && (oiDelta === null || oiDelta > 0)
    : isAtLeast(oiDelta, 1.0);
  const oiVeryLow = oiDeltaRank !== null
    ? oiDeltaRank <= 10 && (oiDelta === null || oiDelta < 0)
    : isAtMost(oiDelta, -2.5);
  const oiNotDropping = oiDeltaRank !== null
    ? oiDeltaRank >= 40 && (oiDelta === null || oiDelta >= -0.5)
    : isAtLeast(oiDelta, -0.5);
  const oiMidRange = oiDeltaRank !== null
    ? oiDeltaRank >= 40 && oiDeltaRank < 75
    : isBetween(oiDelta, -0.5, 1.0);

  const fundingAgainstDirection = isLong
    ? (
      fundingRateRank !== null
        ? fundingRateRank <= 10 && (fundingRate === null || fundingRate <= 0)
        : isAtMost(fundingRate, -0.01)
    )
    : (
      fundingRateRank !== null
        ? fundingRateRank >= 90 && (fundingRate === null || fundingRate >= 0)
        : isAtLeast(fundingRate, 0.01)
    );
  const fundingSlopeAgainstDirection = isLong
    ? (
      fundingSlopeRank !== null
        ? fundingSlopeRank <= 10 && (fundingSlope === null || fundingSlope <= 0)
        : isAtMost(fundingSlope, -0.025)
    )
    : (
      fundingSlopeRank !== null
        ? fundingSlopeRank >= 90 && (fundingSlope === null || fundingSlope >= 0)
        : isAtLeast(fundingSlope, 0.025)
    );
  const fundingCrowdedInDirection = isLong
    ? (
      fundingRateRank !== null
        ? fundingRateRank >= 90 && (fundingRate === null || fundingRate >= 0)
        : isAtLeast(fundingRate, 0.01)
    )
    : (
      fundingRateRank !== null
        ? fundingRateRank <= 10 && (fundingRate === null || fundingRate <= 0)
        : isAtMost(fundingRate, -0.01)
    );
  const hasFundingObservation = (
    fundingRateRank !== null ||
    fundingRate !== null
  );
  const fundingNeutral = fundingRateRank !== null
    ? (
      fundingRateRank >= 20 &&
      fundingRateRank <= 80 &&
      (fundingRate === null || Math.abs(fundingRate) <= 0.05)
    )
    : isBetween(fundingRate, -0.01, 0.01);

  const tierText = String(assetTier || '');
  let spreadCap = 0.10;
  if (tierText.includes('Tier 1') || tierText.includes('Tier 2')) {
    spreadCap = 0.03;
  } else if (tierText.includes('Tier 3')) {
    spreadCap = 0.06;
  }

  // R1-audit (2026-08-10): CAPITULATION tier-2 floor theo asset_tier — USD
  // cố định bias vốn hóa (ZEC max $45 vs BTC $120k). Tier 1/2 = macro/liquid
  // majors: $10k; Tier 3 = mid-cap: $2k; Tier 4/nano = $500.
  const capitulationLiqVolFloor = tierText.includes('Tier 1') || tierText.includes('Tier 2')
    ? 10_000
    : tierText.includes('Tier 3')
      ? 2_000
      : 500;

  return Object.freeze({
    direction,
    sign,
    symbol: String(symbol || '').toUpperCase(),
    isAltcoin: String(symbol || '').toUpperCase() !== 'BTCUSDT',
    assetTier: tierText,
    l1,
    l2,
    isRange: l1.includes('Range') || l1.includes('Chop'),
    isTrend: l1.includes('Trend'),
    isCompression: l2 === 'Compression' || isAtMost(bbwRank, 25),
    isExpansion: l2 === 'Expansion' || (
      isAtLeast(bbwSlope, 5) &&
      isAtLeast(bbwRank, 20)
    ),
    isExtremeVolatility: l2 === 'Extreme' || (
      isAtLeast(atrRank, 90) &&
      isAtLeast(bbwRank, 90)
    ),
    currentPrice,
    atr14,
    atrRank,
    bbwRank,
    bbwSlope,
    volumeRatio,
    rsi,
    adx,
    hurst,
    cmf,
    cmfD: cmf === null ? null : cmf * sign,
    cvd,
    cvdD: cvd === null ? null : cvd * sign,
    obi,
    obiD: obi === null ? null : (2 * obi - 1) * sign,
    takerRatio,
    takerAligned: directionalThreshold(takerRatio, direction, 1.05, 0.95),
    topTraderRatio,
    topTraderAligned: directionalThreshold(
      topTraderRatio,
      direction,
      1.05,
      0.95
    ),
    crowdAgainst: inverseDirectionalThreshold(
      crowdRatio,
      direction,
      0.85,
      1.15
    ),
    sentimentContrarianAligned:
      fearGreed !== null &&
      (isLong ? fearGreed <= 25 : fearGreed >= 75),
    msbAligned,
    msbContradictory,
    sfpAligned,
    liquidationHigh,
    liquidationConnected,
    directionalLiqVol,
    capitulationLiqVolFloor,
    oiDelta,
    oiHigh,
    oiVeryLow,
    oiNotDropping,
    oiMidRange,
    fundingAgainstDirection,
    fundingSlopeAgainstDirection,
    fundingNotCrowded: (
      hasFundingObservation &&
      !fundingCrowdedInDirection
    ),
    fundingNeutral,
    amihudHigh:
      autoData.amihudReady === true &&
      isAtLeast(amihudRank, 85),
    spreadSafe: realSpreadPct !== null && realSpreadPct <= spreadCap,
    emaDistanceD: emaDistanceAtr,
    emaAligned: (
      ema20 !== null &&
      ema50 !== null &&
      (
        isLong
          ? ema20 > ema50
          : ema20 < ema50
      )
    ),
    emaSlopeAligned: (
      ema20Slope !== null &&
      ema50Slope !== null &&
      ema20Slope * sign > 0 &&
      ema50Slope * sign >= 0
    ),
    htfAligned: (
      currentPrice !== null &&
      htfSma200 !== null &&
      (
        isLong
          ? currentPrice > htfSma200
          : currentPrice < htfSma200
      )
    ),
    htfContrarian: (
      currentPrice !== null &&
      htfSma200 !== null &&
      (
        isLong
          ? currentPrice < htfSma200
          : currentPrice > htfSma200
      )
    ),
    priceReclaimedEma: (
      currentPrice !== null &&
      ema20 !== null &&
      (
        isLong
          ? currentPrice > ema20
          : currentPrice < ema20
      )
    ),
    vwapZ,
    vwapExtremeAgainstDirection: vwapZ !== null && (
      isLong ? vwapZ <= -2 : vwapZ >= 2
    ),
    vwapOutsideValue: (
      currentPrice !== null &&
      (
        isLong
          ? vwapLower !== null && currentPrice <= vwapLower
          : vwapUpper !== null && currentPrice >= vwapUpper
      )
    ),
    trendD: sTrend === null ? null : sTrend * sign,
    momentumD: momScore === null ? null : momScore * sign,
    positionD: posScore === null ? null : posScore * sign,
    macdD: macdHist === null ? null : macdHist * sign,
    rsiReversalExtreme: rsi !== null && (
      isLong ? rsi <= 35 : rsi >= 65
    ),
    rsiDeepExtreme: rsi !== null && (
      isLong ? rsi <= 25 : rsi >= 75
    ),
    btcDomRotationAligned: (
      isLong
        ? (
          vectorDetails.isAltcoinSeason === true ||
          isAtMost(btcDomSlope, -0.5)
        )
        : (
          vectorDetails.isAltcoinBleeding === true ||
          isAtLeast(btcDomSlope, 0.3)
        )
    ),
    isLeadLagArb: vectorDetails.isLeadLagArb === true,
    hasEvent: sfpAligned || liquidationHigh
  });
}

const confirmation = (id, test) => Object.freeze({ id, test });

const RULES = Object.freeze([
  {
    strategyId: 'CAPITULATION_RECLAIM',
    regime: f => f.oiVeryLow && isAtLeast(f.atrRank, 85),
    // R1 (2026-08-10): two-tier. Tier-1 hard gate giữ nguyên (fail-closed khi
    // disconnected). Tier-2 soft: stream connected nhưng coverage/stale fail
    // khiến ratio understate → raw directional liq vol >= floor.
    trigger: f => {
      const alignment = f.sfpAligned || f.msbAligned;
      if (f.liquidationHigh && alignment) return true;
      return (
        f.liquidationConnected &&
        isAtLeast(f.directionalLiqVol, f.capitulationLiqVolFloor) &&
        alignment
      );
    },
    confirmations: [
      confirmation('rsi_extreme', f => f.rsiReversalExtreme),
      confirmation('order_book_absorption', f => isAtLeast(f.obiD, 0.16)),
      confirmation('money_flow_turn', f => isAtLeast(f.cmfD, 0.05)),
      confirmation('cvd_not_hostile', f => isAtLeast(f.cvdD, -2)),
      confirmation('sentiment_extreme', f => f.sentimentContrarianAligned)
    ]
  },
  {
    strategyId: 'PASSIVE_ABSORPTION_REVERSAL',
    regime: f => f.vwapOutsideValue && !f.liquidationHigh,
    // R1 (2026-08-10): per-direction từ percentile thật — LONG cvdD<=-3.0
    // (cực âm top-1%); SHORT GIỮ -5 (fallback LONG-only, KHÔNG lật dấu —
    // semantic change cần owner confirm; SHORT thực tế vẫn 0 fire).
    trigger: f => (
      f.sfpAligned &&
      (f.direction === 'LONG'
        ? isAtMost(f.cvdD, -3.0)
        : isAtMost(f.cvdD, -5))
    ),
    confirmations: [
      confirmation('cmf_absorption', f => isAtLeast(f.cmfD, 0.05)),
      confirmation('order_book_absorption', f => isAtLeast(f.obiD, 0.20)),
      confirmation('closed_volume_confirmation', f => isAtLeast(f.volumeRatio, 1.2)),
      confirmation('top_trader_alignment', f => f.topTraderAligned)
    ]
  },
  {
    strategyId: 'CROWDED_CARRY_UNWIND',
    regime: f => (
      f.fundingAgainstDirection &&
      f.fundingSlopeAgainstDirection &&
      f.oiNotDropping
    ),
    trigger: f => f.crowdAgainst && f.topTraderAligned && !f.hasEvent,
    confirmations: [
      confirmation('market_structure_turn', f => f.msbAligned),
      confirmation('cmf_turn', f => isAtLeast(f.cmfD, 0.03)),
      confirmation('cvd_turn', f => isAtLeast(f.cvdD, 3)),
      confirmation('not_extreme_volatility', f => !f.isExtremeVolatility)
    ]
  },
  {
    strategyId: 'VOL_COMPRESSION_IGNITION',
    regime: f => f.isCompression,
    trigger: f => (
      isAtLeast(f.bbwSlope, 5) &&
      isAtLeast(f.volumeRatio, 1.5) &&
      f.msbAligned
    ),
    confirmations: [
      confirmation('cvd_ignition', f => isAtLeast(f.cvdD, 3)),
      confirmation('order_book_alignment', f => isAtLeast(f.obiD, 0.10)),
      confirmation('new_open_interest', f => isAtLeast(f.oiDelta, 0)),
      confirmation('persistent_regime', f => isAtLeast(f.hurst, 0.50)),
      confirmation('funding_not_crowded', f => f.fundingNeutral)
    ]
  },
  {
    strategyId: 'LIQUIDITY_VACUUM_DRIVE',
    // R1 (2026-08-10): AND→OR — giao amihud∩Expansion = 0 row trong sample
    // (spec §1.2). amihudHigh giữ làm nhánh hiếm, isExpansion làm nhánh chính;
    // selectivity được giữ bởi trigger chặt + 2/5 confs.
    regime: f => f.amihudHigh || f.isExpansion,
    trigger: f => (
      f.msbAligned &&
      isAtLeast(f.volumeRatio, 1.8) &&
      f.spreadSafe &&
      absoluteAtMost(f.emaDistanceD, 1.5)
    ),
    confirmations: [
      confirmation('cvd_drive', f => isAtLeast(f.cvdD, 5)),
      confirmation('taker_drive', f => f.takerAligned),
      confirmation('order_book_drive', f => isAtLeast(f.obiD, 0.10)),
      confirmation('open_interest_not_falling', f => f.oiNotDropping),
      confirmation('no_reversal_event', f => !f.hasEvent)
    ]
  },
  {
    strategyId: 'CVD_STRUCTURE_DIVERGENCE',
    regime: f => (
      f.htfContrarian &&
      f.rsi !== null &&
      (
        f.direction === 'LONG'
          ? f.rsi < 40
          : f.rsi > 60
      )
    ),
    // R1-audit (2026-08-10): per-direction từ percentile thật — LONG cvdD>=2.0
    // (trung dung: 1.5 = p27.5 quá lỏng khi mirror regime, 2.5 ≈ max 2.61 làm
    // LONG chết lại; 2.0 = ~p90 flow-active), SHORT cvdD>=4.0 (~p90–p95).
    trigger: f => (
      (f.direction === 'LONG'
        ? isAtLeast(f.cvdD, 2.0)
        : isAtLeast(f.cvdD, 4.0)) &&
      (f.msbAligned || f.priceReclaimedEma)
    ),
    confirmations: [
      confirmation('cmf_divergence', f => isAtLeast(f.cmfD, 0)),
      confirmation('order_book_divergence', f => isAtLeast(f.obiD, 0.10)),
      confirmation('not_new_position_pressure', f => isAtMost(f.oiDelta, 0)),
      confirmation('no_liquidation_or_sfp_event', f => !f.hasEvent)
    ]
  },
  {
    strategyId: 'SMART_MONEY_OI_BUILD',
    regime: f => f.oiHigh && isAtLeast(f.adx, 26),
    trigger: f => f.topTraderAligned && f.takerAligned,
    confirmations: [
      confirmation('cvd_alignment', f => isAtLeast(f.cvdD, 3)),
      confirmation('cmf_alignment', f => isAtLeast(f.cmfD, 0.05)),
      confirmation('ema_slope_alignment', f => f.emaSlopeAligned),
      confirmation('volatility_not_extreme', f => !isAtLeast(f.bbwRank, 85)),
      confirmation('funding_not_crowded', f => f.fundingNotCrowded)
    ]
  },
  {
    strategyId: 'VALUE_AREA_TREND_PULLBACK',
    regime: f => (
      isAtLeast(f.trendD, 30) &&
      isAtLeast(f.hurst, 0.55) &&
      isAtLeast(f.adx, 26) &&
      f.emaAligned
    ),
    trigger: f => (
      isBetween(f.emaDistanceD, -0.8, 0.3) &&
      !f.hasEvent &&
      !f.isExpansion &&
      !f.isExtremeVolatility
    ),
    confirmations: [
      confirmation('balanced_rsi', f => isBetween(f.rsi, 40, 60)),
      confirmation('cmf_support', f => isAtLeast(f.cmfD, 0.03)),
      confirmation('cvd_not_hostile', f => isAtLeast(f.cvdD, -2)),
      confirmation('order_book_support', f => isAtLeast(f.obiD, 0.04)),
      confirmation('open_interest_not_collapsing', f => f.oiNotDropping),
      confirmation('higher_timeframe_alignment', f => f.htfAligned)
    ]
  },
  {
    strategyId: 'FLOW_REACCELERATION',
    regime: f => (
      isAtLeast(f.trendD, 60) &&
      isAtLeast(f.adx, 34) &&
      isAtLeast(f.hurst, 0.60)
    ),
    trigger: f => (
      isAtLeast(f.macdD, 0) &&
      f.emaSlopeAligned &&
      absoluteAtMost(f.emaDistanceD, 1.2) &&
      !f.hasEvent
    ),
    confirmations: [
      confirmation('cvd_reacceleration', f => isAtLeast(f.cvdD, 5)),
      confirmation('taker_reacceleration', f => f.takerAligned),
      confirmation('cmf_reacceleration', f => isAtLeast(f.cmfD, 0.05)),
      confirmation('moderate_oi_build', f => f.oiMidRange),
      confirmation('normal_volatility_band', f => isBetween(f.bbwRank, 30, 80))
    ]
  },
  {
    strategyId: 'ALT_CAPITAL_ROTATION',
    regime: f => (
      f.isAltcoin &&
      f.btcDomRotationAligned &&
      isAtLeast(f.trendD, 30)
    ),
    trigger: f => (
      isAtLeast(f.oiDelta, 0) &&
      isAtLeast(f.cvdD, 0) &&
      !f.isLeadLagArb &&
      !f.hasEvent
    ),
    confirmations: [
      confirmation('top_trader_rotation', f => f.topTraderAligned),
      confirmation('taker_rotation', f => f.takerAligned),
      confirmation('cmf_rotation', f => isAtLeast(f.cmfD, 0.03)),
      confirmation('funding_not_crowded', f => f.fundingNotCrowded),
      confirmation('higher_timeframe_alignment', f => f.htfAligned)
    ]
  },
  {
    strategyId: 'VOLATILITY_EXTREME_FADE',
    regime: f => (
      f.isRange &&
      isAtMost(f.hurst, 0.45) &&
      f.isExtremeVolatility
    ),
    trigger: f => (
      f.vwapExtremeAgainstDirection &&
      f.rsiDeepExtreme &&
      !f.msbContradictory &&
      !f.hasEvent
    ),
    confirmations: [
      confirmation('cmf_reversal', f => isAtLeast(f.cmfD, 0)),
      confirmation('order_book_reversal', f => isAtLeast(f.obiD, 0.16)),
      confirmation('open_interest_deleveraging', f => isAtMost(f.oiDelta, 0)),
      confirmation('cvd_not_accelerating_against', f => isAtLeast(f.cvdD, -5)),
      confirmation('sentiment_extreme', f => f.sentimentContrarianAligned)
    ]
  }
]);

const RULE_BY_ID = new Map(
  RULES.map(rule => [rule.strategyId, rule])
);

function evaluateRule(rule, features) {
  const regimePassed = Boolean(rule.regime(features));
  const triggerPassed = Boolean(rule.trigger(features));
  const confirmations = rule.confirmations.map(item => Object.freeze({
    id: item.id,
    passed: Boolean(item.test(features))
  }));
  const confirmationPassed = confirmations.filter(item => item.passed).length;
  const confirmationRequired = 2;
  const matched = (
    regimePassed &&
    triggerPassed &&
    confirmationPassed >= confirmationRequired
  );

  return Object.freeze({
    matched,
    regimePassed,
    triggerPassed,
    confirmationPassed,
    confirmationRequired,
    confirmations: Object.freeze(confirmations)
  });
}

function assertDirection(direction) {
  if (direction !== 'LONG' && direction !== 'SHORT') {
    throw new TypeError('strategyRouter direction must be LONG or SHORT');
  }
}

export function getStrategyDefinition(strategyIdOrName) {
  if (!strategyIdOrName) return null;
  if (typeof strategyIdOrName === 'object' && strategyIdOrName?.strategyId) {
    return CATALOG_BY_ID.get(strategyIdOrName.strategyId) || null;
  }
  const str = String(strategyIdOrName).trim();
  if (CATALOG_BY_ID.has(str)) return CATALOG_BY_ID.get(str);

  const upper = str.toUpperCase();
  for (const strategy of STRATEGY_CATALOG) {
    if (
      strategy.strategyId.toUpperCase() === upper ||
      strategy.displayName.toUpperCase() === upper ||
      upper.includes(strategy.strategyId.toUpperCase()) ||
      upper.includes(strategy.displayName.toUpperCase())
    ) {
      return strategy;
    }
  }
  return null;
}

export function getStrategyPolicy(strategyOrId) {
  const strategyId = typeof strategyOrId === 'string'
    ? strategyOrId
    : strategyOrId?.strategyId;
  return getStrategyDefinition(strategyId)?.policy || freezePolicy();
}

export function allowsRange(strategyOrId) {
  return getStrategyPolicy(strategyOrId).allowRange;
}

export function allowsHighVpin(strategyOrId) {
  return getStrategyPolicy(strategyOrId).allowHighVpin;
}

const modelKeySegment = value => String(value || '')
  .normalize('NFKD')
  .replace(/\p{Mark}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/gu, '-')
  .replace(/^-+|-+$/gu, '');

export function getStrategyTierModelKeys(strategyId, assetTier) {
  const displayKey = `${strategyId}|${assetTier}`;
  const stableKey =
    `${modelKeySegment(strategyId)}|${modelKeySegment(assetTier)}`;
  return Object.freeze({ displayKey, stableKey });
}

export function resolveStrategyTierModel(
  optimizerModel,
  strategyId,
  assetTier
) {
  if (!optimizerModel || !strategyId || !assetTier) return null;
  const { displayKey, stableKey } = getStrategyTierModelKeys(
    strategyId,
    assetTier
  );
  const indexedKey = optimizerModel.matrix_index?.[displayKey];
  return (
    (indexedKey && optimizerModel.matrix_by_id?.[indexedKey]) ||
    optimizerModel.matrix_by_id?.[stableKey] ||
    optimizerModel.matrix?.[displayKey] ||
    null
  );
}

export function selectStrategyLaneWinners(candidates) {
  const rankCandidates = (left, right) => {
    const scoreDelta =
      (Number(right?.score) || 0) - (Number(left?.score) || 0);
    if (scoreDelta !== 0) return scoreDelta;
    const priorityDelta =
      (Number(right?.strategyPriority) || 0) -
      (Number(left?.strategyPriority) || 0);
    if (priorityDelta !== 0) return priorityDelta;
    return (
      (Number(right?.theoreticalRR) || 0) -
      (Number(left?.theoreticalRR) || 0)
    );
  };
  const laneWinner = paperOnly => [...(candidates || [])]
    .filter(candidate =>
      (candidate?.rolloutMode === ROLLOUT_MODE.PAPER_ONLY) === paperOnly
    )
    .sort(rankCandidates)[0];

  return Object.freeze([
    laneWinner(true),
    laneWinner(false)
  ].filter(Boolean));
}

export function evaluateStrategyCandidates(input) {
  assertDirection(input?.direction);
  const features = buildFeatures(input);

  return Object.freeze(
    PAPER_STRATEGY_CATALOG.map(definition => {
      const rule = RULE_BY_ID.get(definition.strategyId);
      return Object.freeze({
        ...definition,
        direction: input.direction,
        diagnostics: evaluateRule(rule, features)
      });
    })
  );
}

export function routeStrategy(input, options = {}) {
  // R2 (2026-08-10): cho phép truyền candidates đã tính sẵn (scanner cần
  // diagnostics của CẢ candidates để log near-miss, không chỉ strategy thắng).
  // Backward-compatible: không truyền → tính như cũ.
  const candidates = options.candidates || evaluateStrategyCandidates(input);
  const selected = candidates.find(
    candidate => candidate.diagnostics.matched
  );

  if (selected) {
    return Object.freeze({
      ...selected,
      isFallback: false
    });
  }

  return routeAdaptiveStrategy(input);
}

export function routeAdaptiveStrategy(input) {
  assertDirection(input?.direction);
  const fallbackId = input.direction === 'LONG'
    ? 'ADAPTIVE_LONG_FALLBACK'
    : 'ADAPTIVE_SHORT_FALLBACK';
  const fallback = getStrategyDefinition(fallbackId);

  return Object.freeze({
    ...fallback,
    direction: input.direction,
    isFallback: true,
    diagnostics: Object.freeze({
      matched: true,
      regimePassed: true,
      triggerPassed: true,
      confirmationPassed: 0,
      confirmationRequired: 0,
      confirmations: Object.freeze([])
    })
  });
}

const readEnvNumber = (name, fallback) => {
  try {
    const raw = Number(process?.env?.[name]);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  } catch {
    return fallback;
  }
};

// R1 (2026-08-10): CAPITULATION tier-2 soft floor — raw directional liquidation
// notional USD. Spec: floor $10k (~p90 của event rows); env-override.
const CAPITULATION_LIQ_VOL_FLOOR_USD =
  readEnvNumber('CAPITULATION_LIQ_VOL_FLOOR_USD', 10000);

export { ROLLOUT_MODE };
