export function createRuntimeState({ supabase }) {
  let currentAiModel = null;
  let binanceTimeReader = null;
  let mvrvState = {
    fetchedAt: null,
    observedAt: null,
    source: 'fallback',
    stale: true,
    value: 0.39
  };
  let timeOffset = 0;

  async function syncBinanceTime() {
    try {
      if (!binanceTimeReader) {
        throw new Error('Binance time reader is not configured');
      }
      const data = await binanceTimeReader();
      if (Number.isFinite(Number(data?.serverTime))) {
        timeOffset = data.serverTime - Date.now();
        console.log(
          `🕒 [SYSTEM] Đã đồng bộ đồng hồ với Binance. Offset: ${timeOffset}ms`
        );
        return true;
      }
      return false;
    } catch (error) {
      console.error(
        '❌ Lỗi đồng bộ thời gian:',
        error.message
      );
      return false;
    }
  }

  async function loadLatestAiModel() {
    try {
      const { data, error } = await supabase
        .from('system_models')
        .select('model_data')
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        console.error('[AI SYNC] Không đọc được system_models:', error.message);
        return false;
      }
      if (!data || data.length === 0) return false;
      currentAiModel = data[0].model_data;
      console.log(
        '🤖 [AI SYNC] Đã nạp AI Model Bayesian mới nhất vào Radar.'
      );
      return true;
    } catch (error) {
      console.error(
        'âŒ Lá»—i náº¡p AI Model:',
        error.message
      );
      return false;
    }
  }

  return {
    getCurrentAiModel: () => currentAiModel,
    getGlobalMvrvZScore: () => mvrvState.value,
    getMvrvState: () => ({ ...mvrvState }),
    getTimeOffset: () => timeOffset,
    loadLatestAiModel,
    setBinanceTimeReader: reader => {
      binanceTimeReader = typeof reader === 'function' ? reader : null;
    },
    setGlobalMvrvZScore: (value, metadata = {}) => {
      const parsedValue = Number.parseFloat(value);
      if (!Number.isFinite(parsedValue)) return false;
      mvrvState = {
        ...mvrvState,
        ...metadata,
        value: parsedValue
      };
      return true;
    },
    syncBinanceTime
  };
}
