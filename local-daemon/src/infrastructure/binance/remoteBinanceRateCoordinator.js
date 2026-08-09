const DEFAULT_TIMEOUT_MS = 2_000;

function serializeHeaders(headers) {
  const result = {};
  for (const name of [
    'retry-after',
    'x-mbx-order-count-10s',
    'x-mbx-order-count-1m',
    'x-mbx-used-weight-1m'
  ]) {
    const value = typeof headers?.get === 'function'
      ? headers.get(name)
      : headers?.[name];
    if (value !== undefined && value !== null) result[name] = String(value);
  }
  return result;
}

export function createRemoteBinanceRateCoordinator({
  baseUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const origin = String(baseUrl).replace(/\/$/, '');
  let latestState = {
    coordinator: 'remote',
    available: false
  };

  async function post(path, body) {
    try {
      const response = await fetchImpl(`${origin}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const payload = await response.json();
      if (!response.ok && response.status !== 429) return null;
      if (payload?.state) {
        latestState = {
          ...payload.state,
          coordinator: 'remote',
          available: true
        };
      }
      return payload;
    } catch {
      latestState = {
        ...latestState,
        coordinator: 'remote',
        available: false
      };
      return null;
    }
  }

  return {
    async reserve(cost) {
      const payload = await post('/internal/binance-rate/reserve', cost);
      return payload?.reservation || {
        allowed: false,
        reason: 'COORDINATOR_UNAVAILABLE',
        retryAfterMs: timeoutMs
      };
    },
    async observeResponse({ headers, status } = {}) {
      await post('/internal/binance-rate/observe', {
        headers: serializeHeaders(headers),
        status
      });
    },
    async updateLimitsFromExchangeInfo(exchangeInfo) {
      await post('/internal/binance-rate/limits', {
        product: exchangeInfo?.product,
        rateLimits: exchangeInfo?.rateLimits
      });
    },
    getState() {
      return latestState;
    }
  };
}
