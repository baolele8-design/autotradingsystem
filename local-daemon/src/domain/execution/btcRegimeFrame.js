// BTC regime fixed-frame lookup (O1, team-D report 2026-08-12):
// regime gates must NOT read the trade's own interval (15m/1h regimes are
// noisy and flip) — they read fixed 4h and 1d frames, stepping up:
// max(tradeInterval, 4h) → 4h for any interval < 4h, 1d for 1d+.
export const BTC_REGIME_FRAMES = ['4h', '1d'];

const FRAME_ORDER = ['5m', '15m', '1h', '4h', '1d', '1w'];
const FRAME_RANK = new Map(FRAME_ORDER.map((name, i) => [name, i]));
const FOUR_HOUR_RANK = FRAME_RANK.get('4h');
const DAY_RANK = FRAME_RANK.get('1d');

// F-E1b (2026-08-12): the regime cache now stores objects
// {regime, msbState, isSFP, lastSL, lastSH} (scanner-side). Readers stay
// dual-type so old string cache entries keep resolving.
const readRegimeValue = (entry) => {
  if (entry === null || entry === undefined) return null;
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object' && typeof entry.regime === 'string') return entry.regime;
  return null;
};

export const btcRegimeFrameFor = (interval) => {
  const rank = FRAME_RANK.get(String(interval || ''));
  const stepped = rank === undefined ? FOUR_HOUR_RANK : Math.max(rank, FOUR_HOUR_RANK);
  return stepped >= DAY_RANK ? '1d' : '4h';
};

export const resolveBtcRegime = (regimeCache, interval) => {
  if (!regimeCache || !(regimeCache instanceof Map)) return null;
  return readRegimeValue(regimeCache.get(btcRegimeFrameFor(interval)));
};

// F-E1b (2026-08-12): full fixed-frame structure (regime + MSB + SFP + swing
// levels) for the payload/shadow lanes. String entries carry no structure →
// null. Fail-open, never throws.
export const resolveBtcStructure = (regimeCache, interval) => {
  if (!regimeCache || !(regimeCache instanceof Map)) return null;
  const entry = regimeCache.get(btcRegimeFrameFor(interval));
  if (!entry || typeof entry !== 'object' || entry === null) return null;
  return {
    regime: typeof entry.regime === 'string' ? entry.regime : null,
    msbState: typeof entry.msbState === 'string' ? entry.msbState : null,
    isSFP: typeof entry.isSFP === 'string' ? entry.isSFP : null,
    lastSL: entry.lastSL && typeof entry.lastSL === 'object' ? entry.lastSL : null,
    lastSH: entry.lastSH && typeof entry.lastSH === 'object' ? entry.lastSH : null
  };
};

// F-E1b (2026-08-12): 2-frame BTC bias classification. Rule (critic-fixed):
// - both fixed frames agree with the trade direction → ALIGNED
// - frames disagree with each other, or agree but oppose the trade → MISALIGNED
// - Range/Sideways (indicators.js:356 vs :390 use both spellings) or
//   null/unknown regime → NEUTRAL
// Exported (2026-08-13) so mtfMatrix.js reuses it — the MTF MATRIX votes
// must map regimes with the SAME rule, no duplicate implementation.
export const frameDirection = (regime) => {
  if (regime === 'Uptrend') return 'UP';
  if (regime === 'Downtrend') return 'DOWN';
  return null; // Range, Sideways, null, unknown
};

export const classifyBtcBias = ({ direction, regime4h, regime1d } = {}) => {
  const dir4h = frameDirection(regime4h);
  const dir1d = frameDirection(regime1d);
  if (dir4h === null || dir1d === null) return 'NEUTRAL';
  const tradeDir = direction === 'LONG' ? 'UP' : direction === 'SHORT' ? 'DOWN' : null;
  if (tradeDir === null) return 'NEUTRAL';
  if (dir4h === dir1d) {
    return dir4h === tradeDir ? 'ALIGNED' : 'MISALIGNED';
  }
  return 'MISALIGNED';
};

// F-E1b (2026-08-12): per-cycle bias accumulation for the shadow log —
// counts the regime DISTRIBUTION per fixed frame (Uptrend/Downtrend/Range/
// Sideways/null) so the NEUTRAL rate can be calibrated, plus bias totals.
const REGIME_BUCKETS = ['Uptrend', 'Downtrend', 'Range', 'Sideways', 'null'];

export const createBtcBiasStats = () => ({
  bias: { ALIGNED: 0, MISALIGNED: 0, NEUTRAL: 0 },
  regimes: {
    '4h': { Uptrend: 0, Downtrend: 0, Range: 0, Sideways: 0, null: 0 },
    '1d': { Uptrend: 0, Downtrend: 0, Range: 0, Sideways: 0, null: 0 }
  }
});

const bucketOf = (regime) => {
  if (regime === 'Uptrend' || regime === 'Downtrend' || regime === 'Range' || regime === 'Sideways') {
    return regime;
  }
  return 'null';
};

export const accumulateBtcBiasStats = (stats, { direction, regime4h, regime1d } = {}) => {
  if (!stats?.bias || !stats?.regimes) return;
  const bias = classifyBtcBias({ direction, regime4h, regime1d });
  stats.bias[bias] += 1;
  for (const frame of ['4h', '1d']) {
    const bucket = stats.regimes[frame];
    if (!bucket) continue;
    const regime = frame === '4h' ? regime4h : regime1d;
    bucket[bucketOf(regime)] += 1;
  }
};

export const formatBtcBiasSummary = (stats, { minCount = 1 } = {}) => {
  if (!stats?.bias || !stats?.regimes) return null;
  const total = stats.bias.ALIGNED + stats.bias.MISALIGNED + stats.bias.NEUTRAL;
  if (total < minCount) return null;
  const frameText = (frame) => {
    const bucket = stats.regimes[frame] || {};
    return REGIME_BUCKETS
      .map(key => `${key} ${bucket[key] || 0}`)
      .join(' ');
  };
  return (
    `[BTC BIAS SHADOW] 4h: ${frameText('4h')} | 1d: ${frameText('1d')} | ` +
    `bias: ALIGNED ${stats.bias.ALIGNED} MISALIGNED ${stats.bias.MISALIGNED} NEUTRAL ${stats.bias.NEUTRAL}`
  );
};

// O10 (team-D 2026-08-12): read-only snapshot for GET /api/btc-regime
// and the HUD. isAltcoinBleeding mirrors regime.js:404-417 —
// dom > 50 && slope > 0.3 → bleeding; fail-open null/false when absent.
export const buildBtcRegimeSnapshot = ({
  regimeCache,
  domCache,
  btcDominance
}) => {
  const readDomSlope = (frame) => {
    const entry = domCache && domCache.get ? domCache.get(frame) : null;
    return Number.isFinite(entry?.slope) ? entry.slope : null;
  };
  const domSlope4h = readDomSlope('4h');
  const domSlope1d = readDomSlope('1d');
  const domValue =
    btcDominance !== undefined && btcDominance !== null && Number.isFinite(Number(btcDominance))
      ? Number(btcDominance)
      : null;
  return {
    regime4h: regimeCache && regimeCache.get ? readRegimeValue(regimeCache.get('4h')) : null,
    regime1d: regimeCache && regimeCache.get ? readRegimeValue(regimeCache.get('1d')) : null,
    domSlope4h,
    domSlope1d,
    btcDomValue: domValue,
    isAltcoinBleeding:
      domValue !== null && domSlope4h !== null &&
      domValue > 50 && domSlope4h > 0.3
  };
};
