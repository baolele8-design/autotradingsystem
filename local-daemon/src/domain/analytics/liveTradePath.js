import {
  calculateTrailingDecision,
  getTrailingPolicy
} from '../../../../src/domain/trading/trailingPolicy.js';

export const LIVE_PATH_VERSION = 'mark-price-live/v1';
export const LIVE_PATH_THRESHOLDS_R = Object.freeze([
  0.25, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9, 1,
  1.05, 1.2, 1.5, 1.6, 1.8, 2, 2.5
]);

// 2026-08-06: the adaptive protection floor is permanent policy for every
// adaptive cell, so the shadow 'rollback' lane is no longer a divergent
// pre-observation schedule — it resolves to the same pinned policy. The
// historical rollback values (SHORT T1 0.75/1.4/0.8/2.35/1.1 ... T4
// 0.95/1.75/0.8/2.85/1.5R) are recorded in AGENTS.md §6.

export const getRollbackPolicy = (strategyName, assetTier) =>
  getTrailingPolicy(strategyName, assetTier);

const finitePositive = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const makeShadow = (name, policy) => ({
  name,
  policy,
  stage: 'NONE',
  stop_r: -1,
  stop_hit_at: null,
  stop_hit_r: null
});

export function createLiveTradePathState(trade, { now = Date.now() } = {}) {
  const entry = finitePositive(trade?.entry);
  const risk = finitePositive(trade?.initial_risk_per_coin);
  const direction = String(trade?.direction || '').toUpperCase();
  if (!trade?.id || entry === null || risk === null || !['LONG', 'SHORT'].includes(direction)) {
    return null;
  }
  const actual = getTrailingPolicy(trade.strategy_name, trade.asset_tier);
  const rollback = getRollbackPolicy(trade.strategy_name, trade.asset_tier);
  const openedAt = Date.parse(trade.opened_at || trade.created_at || '');
  const startedAt = Number.isFinite(openedAt) && openedAt <= now
    ? openedAt
    : now;
  return {
    trade_id: trade.id,
    symbol: String(trade.symbol || '').toUpperCase(),
    direction,
    entry,
    risk,
    interval: trade.interval || null,
    opened_at: trade.opened_at || trade.created_at || null,
    started_at: startedAt,
    last_event_time: null,
    sample_count: 0,
    out_of_order_count: 0,
    gap_count: now - startedAt > 5_000 ? 1 : 0,
    mfe_r: 0,
    mae_r: 0,
    current_r: 0,
    reversal_count: 0,
    prior_delta_sign: 0,
    threshold_crossings: Object.fromEntries(
      LIVE_PATH_THRESHOLDS_R.map(value => [String(value), null])
    ),
    shadows: [makeShadow('actual', actual), makeShadow('rollback', rollback)]
      .filter(item => item.policy)
  };
}

const stopHit = (direction, currentR, stopR) => direction === 'LONG'
  ? currentR <= stopR
  : currentR <= stopR;

export function updateLiveTradePathState(state, price, eventTime = Date.now()) {
  const mark = finitePositive(price);
  if (!state || mark === null || !Number.isFinite(eventTime)) return false;
  if (state.last_event_time !== null && eventTime <= state.last_event_time) {
    state.out_of_order_count += 1;
    return false;
  }
  if (state.last_event_time !== null && eventTime - state.last_event_time > 5_000) {
    state.gap_count += 1;
  }
  const sign = state.direction === 'LONG' ? 1 : -1;
  const currentR = sign * (mark - state.entry) / state.risk;
  const deltaSign = Math.sign(currentR - state.current_r);
  if (deltaSign && state.prior_delta_sign && deltaSign !== state.prior_delta_sign) {
    state.reversal_count += 1;
  }
  if (deltaSign) state.prior_delta_sign = deltaSign;
  state.current_r = currentR;
  state.mfe_r = Math.max(state.mfe_r, currentR);
  state.mae_r = Math.min(state.mae_r, currentR);
  state.sample_count += 1;
  state.last_event_time = eventTime;
  for (const threshold of LIVE_PATH_THRESHOLDS_R) {
    if (currentR >= threshold && state.threshold_crossings[String(threshold)] === null) {
      state.threshold_crossings[String(threshold)] = eventTime;
    }
  }
  for (const shadow of state.shadows) {
    if (shadow.stop_hit_at !== null) continue;
    const currentSl = state.direction === 'LONG'
      ? state.entry + shadow.stop_r * state.risk
      : state.entry - shadow.stop_r * state.risk;
    const highWaterPrice = state.direction === 'LONG'
      ? state.entry + state.mfe_r * state.risk
      : state.entry - state.mfe_r * state.risk;
    const decision = calculateTrailingDecision({
      entryPrice: state.entry,
      currentSl,
      markPrice: mark,
      initialRiskPerCoin: state.risk,
      direction: state.direction,
      storedHighWater: highWaterPrice,
      protectionStage: shadow.stage,
      policyOverride: shadow.policy
    });
    shadow.stage = decision.nextStage;
    const targetR = sign * (decision.targetSl - state.entry) / state.risk;
    shadow.stop_r = Math.max(shadow.stop_r, targetR);
    if (stopHit(state.direction, currentR, shadow.stop_r)) {
      shadow.stop_hit_at = eventTime;
      shadow.stop_hit_r = shadow.stop_r;
    }
  }
  return true;
}

export function summarizeLiveTradePath(state, now = Date.now()) {
  const elapsedMs = Math.max(0, now - state.started_at);
  const expectedSamples = Math.max(1, Math.floor(elapsedMs / 1_000));
  return {
    path_version: LIVE_PATH_VERSION,
    source: 'BINANCE_FUTURES_MARK_PRICE_WS_1S',
    coverage_ratio: Math.min(1, state.sample_count / expectedSamples),
    gap_count: state.gap_count,
    out_of_order_count: state.out_of_order_count,
    sample_count: state.sample_count,
    mfe_r: state.mfe_r,
    mae_r: state.mae_r,
    current_r: state.current_r,
    reversal_count: state.reversal_count,
    threshold_crossings: state.threshold_crossings,
    shadow_results: Object.fromEntries(state.shadows.map(shadow => [
      shadow.name,
      {
        stage: shadow.stage,
        stop_r: shadow.stop_r,
        stop_hit_at: shadow.stop_hit_at,
        stop_hit_r: shadow.stop_hit_r
      }
    ])),
    first_event_at: state.started_at,
    last_event_at: state.last_event_time
  };
}
