// 2026-08-13: [H2 REALIZED] telemetry log aggregation.
//
// REVERT P0-2 (2026-08-13): h2_realized là TELEMETRY (shadow — gate OR,
// không chặn). Trước đây log per-candidate (~560-1100 dòng/cycle =
// ~1M dòng/ngày) — gộp thành per-cycle summary theo (direction, version),
// pattern [BTC BIAS SHADOW] (btcRegimeFrame.js): create → accumulate mỗi
// candidate → format 1 dòng/key cuối cycle.
export const createH2RealizedStats = () => new Map();

export const accumulateH2Realized = (stats, { direction, version, realizedEV } = {}) => {
  if (!(stats instanceof Map)) return;
  if (!Number.isFinite(realizedEV)) return;
  const key = `${direction}|${version}`;
  const entry = stats.get(key) || { direction, version, count: 0, evSum: 0 };
  entry.count += 1;
  entry.evSum += realizedEV;
  stats.set(key, entry);
};

export const formatH2RealizedSummary = (stats) => {
  if (!(stats instanceof Map) || stats.size === 0) return null;
  return [...stats.values()]
    .map(({ direction, version, count, evSum }) =>
      `[H2 REALIZED] direction=${direction} version=${version} ` +
      `n=${count} avgEV=${(evSum / count).toFixed(3)}R (telemetry only — gate OR)`
    )
    .join('\n');
};
