// BTC regime fixed-frame lookup (O1, team-D report 2026-08-12):
// regime gates must NOT read the trade's own interval (15m/1h regimes are
// noisy and flip) — they read fixed 4h and 1d frames, stepping up:
// max(tradeInterval, 4h) → 4h for any interval < 4h, 1d for 1d+.
export const BTC_REGIME_FRAMES = ['4h', '1d'];

const FRAME_ORDER = ['5m', '15m', '1h', '4h', '1d', '1w'];
const FRAME_RANK = new Map(FRAME_ORDER.map((name, i) => [name, i]));
const FOUR_HOUR_RANK = FRAME_RANK.get('4h');
const DAY_RANK = FRAME_RANK.get('1d');

export const btcRegimeFrameFor = (interval) => {
  const rank = FRAME_RANK.get(String(interval || ''));
  const stepped = rank === undefined ? FOUR_HOUR_RANK : Math.max(rank, FOUR_HOUR_RANK);
  return stepped >= DAY_RANK ? '1d' : '4h';
};

export const resolveBtcRegime = (regimeCache, interval) => {
  if (!regimeCache || !(regimeCache instanceof Map)) return null;
  return regimeCache.get(btcRegimeFrameFor(interval)) || null;
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
    regime4h: regimeCache && regimeCache.get ? regimeCache.get('4h') || null : null,
    regime1d: regimeCache && regimeCache.get ? regimeCache.get('1d') || null : null,
    domSlope4h,
    domSlope1d,
    btcDomValue: domValue,
    isAltcoinBleeding:
      domValue !== null && domSlope4h !== null &&
      domValue > 50 && domSlope4h > 0.3
  };
};