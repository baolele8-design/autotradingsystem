import {
  createLiveTradePathState,
  summarizeLiveTradePath,
  updateLiveTradePathState
} from '../../domain/analytics/liveTradePath.js';

export function createLiveTradePathService({
  marketDataCache,
  supabase,
  checkpointMs = 60_000,
  maximumTrades = 20
}) {
  const states = new Map();
  let lastCheckpointAttemptAt = 0;
  let checkpointInFlight = null;

  function observeOpenTrades(trades) {
    const openIds = new Set((trades || []).map(trade => String(trade.id)));
    for (const id of states.keys()) {
      if (!openIds.has(String(id))) states.delete(id);
    }
    for (const trade of trades || []) {
      if (states.has(trade.id) || states.size >= maximumTrades) continue;
      const state = createLiveTradePathState(trade);
      if (state) states.set(trade.id, state);
    }
  }

  async function checkpoint(force = false) {
    const now = Date.now();
    if (!force && now - lastCheckpointAttemptAt < checkpointMs) return null;
    if (checkpointInFlight) return checkpointInFlight;
    const rows = [...states.values()].map(state => {
      const summary = summarizeLiveTradePath(state, now);
      return {
        trade_id: state.trade_id,
        symbol: state.symbol,
        interval: state.interval,
        opened_at: state.opened_at,
        updated_at: new Date(now).toISOString(),
        summary
      };
    });
    if (rows.length === 0) return null;
    lastCheckpointAttemptAt = now;
    checkpointInFlight = supabase
      .from('trade_path_summaries')
      .upsert(rows, { onConflict: 'trade_id' })
      .then(({ error }) => {
        if (error) throw error;
        return rows.length;
      })
      .finally(() => { checkpointInFlight = null; });
    return checkpointInFlight;
  }

  const unsubscribe = marketDataCache.onPriceUpdate(update => {
    for (const state of states.values()) {
      if (state.symbol === update.symbol) {
        updateLiveTradePathState(state, update.price, update.eventTime || update.updatedAt);
      }
    }
    void checkpoint().catch(error => {
      console.error('[LIVE PATH CHECKPOINT]', error.message);
    });
  });

  return {
    checkpoint,
    dispose: unsubscribe,
    getStateCount: () => states.size,
    observeOpenTrades
  };
}
