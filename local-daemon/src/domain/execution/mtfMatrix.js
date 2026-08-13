// MTF MATRIX (2026-08-13) — multi-timeframe alignment shadow.
// Pure domain module: payload/log only. NEVER gates, scores, sizes or
// influences order placement (per owner directive: MỌI THAY ĐỔI = shadow).
//
// Frame ladder mirrors matrixScannerService.js:571-576:
// entry interval -> { bias: 1 bậc trên, structure: 2 bậc trên }.
// BTC frames (btc4h/btc1d) are read by the caller via resolveBtcStructure
// (fixed 4h/1d frames per O1 — btcRegimeFrame.js), not from the ladder.
import { frameDirection } from './btcRegimeFrame.js';

export const MTF_LADDER = {
  '15m': { bias: '1h', structure: '4h' },
  '1h': { bias: '4h', structure: '1d' },
  '4h': { bias: '1d', structure: '1w' },
  '1d': { bias: '1w', structure: '1M' }
};

export const MTF_VERDICTS = Object.freeze({
  NEUTRAL: 'NEUTRAL',
  STRONG_ALIGNED: 'STRONG_ALIGNED',
  ALIGNED: 'ALIGNED',
  MISALIGNED: 'MISALIGNED',
  MIXED: 'MIXED'
});

const VERDICT_KEYS = Object.values(MTF_VERDICTS);

// Frame power priority for the tie-break (highest first).
const TOP_FRAME_PRIORITY = ['btc1d', 'btc4h', 'structure', 'bias', 'entry'];

// Normalize one frame cell to a direction vote ('UP' | 'DOWN' | null).
// Accepts:
//   - object { regime, ... } — shape of detectMarketStructure (full AND
//     early-return indicators.js:354-360, which has key 'sfp' and no
//     lastSL/lastSH) and of resolveBtcStructure ({ regime, msbState, ... })
//   - plain regime string ('Uptrend' / 'Downtrend' / 'Range' / 'Sideways')
// null/undefined/unknown -> null (no vote). Never throws.
const normalizeFrame = (frame) => {
  if (frame === null || frame === undefined) return null;
  if (typeof frame === 'string') return frameDirection(frame);
  if (typeof frame === 'object') {
    return frameDirection(
      typeof frame.regime === 'string' ? frame.regime : null
    );
  }
  return null;
};

const tradeDirOf = (direction) =>
  direction === 'LONG' ? 'UP' : direction === 'SHORT' ? 'DOWN' : null;

const countVotes = (votes, tradeDir) => {
  let countAligned = 0;
  let countMisaligned = 0;
  let countNeutral = 0;
  for (const vote of votes) {
    if (vote === null) countNeutral += 1;
    else if (vote === tradeDir) countAligned += 1;
    else countMisaligned += 1;
  }
  return {
    countAligned,
    countMisaligned,
    countNeutral,
    totalDirectional: countAligned + countMisaligned
  };
};

// Verdict rules (architect spec, critic 1+2+5 fixed):
//   1. <2 directional cells -> NEUTRAL (fail-open, never throws)
//   2. btc1d OPPOSE -> MIXED (blocks STRONG_ALIGNED and demotes
//      ALIGNED->MIXED; BTC 1d is the most powerful frame — contract O1)
//   3. agree>=3 && agree>oppose && topFrame agrees -> STRONG_ALIGNED
//   4. agree>=2 && agree>oppose -> ALIGNED
//   5. agree === oppose && topFrame agrees -> ALIGNED (topFrame tie-break)
//   6. oppose>=2 && oppose>agree -> MISALIGNED
//   7. otherwise -> MIXED
const decideVerdict = ({ tradeDir, votes, frameDirs, topFrame }) => {
  const { countAligned, countMisaligned, totalDirectional } = countVotes(
    votes,
    tradeDir
  );
  if (totalDirectional < 2) return MTF_VERDICTS.NEUTRAL;
  if (frameDirs.btc1d !== null && frameDirs.btc1d !== tradeDir) {
    return MTF_VERDICTS.MIXED;
  }
  const topFrameDir = topFrame ? frameDirs[topFrame] : null;
  if (countAligned >= 3 && countAligned > countMisaligned && topFrameDir === tradeDir) {
    return MTF_VERDICTS.STRONG_ALIGNED;
  }
  if (countAligned >= 2 && countAligned > countMisaligned) {
    return MTF_VERDICTS.ALIGNED;
  }
  if (countAligned === countMisaligned && topFrameDir === tradeDir) {
    return MTF_VERDICTS.ALIGNED;
  }
  if (countMisaligned >= 2 && countMisaligned > countAligned) {
    return MTF_VERDICTS.MISALIGNED;
  }
  return MTF_VERDICTS.MIXED;
};

// counterTrendEntry: the ENTRY frame regime opposes the trade direction
// (e.g. SHORT while the entry frame is Uptrend). This is a REGIME signal —
// different from the h_msb gate (TradeValidator.js:204-205), which blocks on
// msbState (Bearish_MSB/Bullish_MSB — a fresh structure break against the
// trade), not on the Uptrend/Downtrend regime.
const isCounterTrendEntry = (entryDir, tradeDir) =>
  entryDir !== null && entryDir !== tradeDir;

export const evaluateMtfMatrix = ({
  direction,
  entryInterval,
  frames
} = {}) => {
  const tradeDir = tradeDirOf(direction);
  const safeFrames = frames && typeof frames === 'object' ? frames : {};

  const frameDirs = {
    entry: normalizeFrame(safeFrames.entry),
    bias: normalizeFrame(safeFrames.bias),
    structure: normalizeFrame(safeFrames.structure),
    btc4h: normalizeFrame(safeFrames.btc4h),
    btc1d: normalizeFrame(safeFrames.btc1d)
  };

  const topFrame = TOP_FRAME_PRIORITY.find(name => frameDirs[name] !== null) || null;
  const counterTrendEntry = isCounterTrendEntry(frameDirs.entry, tradeDir);

  let verdict;
  if (tradeDir === null) {
    verdict = MTF_VERDICTS.NEUTRAL;
  } else {
    verdict = decideVerdict({
      tradeDir,
      votes: Object.values(frameDirs),
      frameDirs,
      topFrame
    });
  }

  const { countAligned, countMisaligned, countNeutral, totalDirectional } = countVotes(
    Object.values(frameDirs),
    tradeDir
  );

  // htfConfirms: how many of the 3 high-timeframe cells (btc1d, btc4h,
  // structure) vote with the trade direction.
  const htfConfirms = ['btc1d', 'btc4h', 'structure']
    .filter(name => frameDirs[name] === tradeDir)
    .length;

  let advice;
  switch (verdict) {
    case MTF_VERDICTS.STRONG_ALIGNED:
    case MTF_VERDICTS.ALIGNED:
      advice = { action: 'NONE', softBias: 1 };
      break;
    case MTF_VERDICTS.MISALIGNED:
      advice = { action: 'CAUTION', softBias: -1, counterTrend: true };
      break;
    case MTF_VERDICTS.MIXED:
      advice = { action: 'CAUTION', check: ['MSB_AT_ENTRY', 'SFP_AT_ENTRY'] };
      break;
    case MTF_VERDICTS.NEUTRAL:
    default:
      advice = { action: 'NONE', neutralVotes: countNeutral };
      break;
  }

  return {
    frames: frameDirs,
    alignment: {
      countAligned,
      countMisaligned,
      countNeutral,
      totalDirectional,
      verdict,
      topFrame,
      htfConfirms,
      counterTrendEntry
    },
    advice
  };
};

// ---- Stats (shadow) — NEUTRAL rate + counterTrendEntry per-interval
// from day 1 (critic 2) so the null-vote share can be calibrated.

const zeroVerdicts = () => {
  const counts = {};
  for (const key of VERDICT_KEYS) counts[key] = 0;
  return counts;
};

export const createMtfStats = () => ({
  verdicts: zeroVerdicts(),
  intervals: {}
});

const intervalSlot = (stats, interval) => {
  if (!stats.intervals[interval]) {
    stats.intervals[interval] = {
      verdicts: zeroVerdicts(),
      cycles: 0,
      counterTrendEntry: 0
    };
  }
  return stats.intervals[interval];
};

export const accumulateMtfStats = (stats, { interval, verdict, counterTrendEntry } = {}) => {
  if (!stats || !stats.verdicts) return;
  const key = MTF_VERDICTS[verdict];
  if (!key) return; // unknown verdict — skip, never throw
  stats.verdicts[key] += 1;
  if (typeof interval === 'string') {
    const slot = intervalSlot(stats, interval);
    slot.verdicts[key] += 1;
    slot.cycles += 1;
    if (counterTrendEntry) slot.counterTrendEntry += 1;
  }
};

const rateOf = (part, total) =>
  total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0.0%';

export const formatMtfSummary = (stats, { minCount = 1 } = {}) => {
  if (!stats || !stats.verdicts) return null;
  const total = VERDICT_KEYS.reduce((sum, key) => sum + stats.verdicts[key], 0);
  if (total < minCount) return null;
  const verdictText = VERDICT_KEYS
    .filter(key => stats.verdicts[key] > 0)
    .map(key => `${key} ${stats.verdicts[key]} (${rateOf(stats.verdicts[key], total)})`)
    .join(' ');
  const intervalText = Object.entries(stats.intervals)
    .map(([interval, slot]) => {
      const slotText = VERDICT_KEYS
        .filter(key => slot.verdicts[key] > 0)
        .map(key => `${key} ${slot.verdicts[key]} (${rateOf(slot.verdicts[key], slot.cycles)})`)
        .join(' ');
      return `${interval} ${slotText} ctr ${slot.counterTrendEntry}`;
    })
    .join('; ');
  return (
    `[MTF MATRIX] cycles ${total} — ${verdictText}` +
    (intervalText ? ` | per-interval: ${intervalText}` : '')
  );
};
