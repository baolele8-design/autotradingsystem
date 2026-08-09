import axios from 'axios';
import crypto from 'node:crypto';

import {
  BINANCE_RATE_PRIORITY,
  createBinanceRateCoordinator,
  estimateBinanceRateCost,
  getSharedBinanceRateCoordinator
} from './binanceRateCoordinator.js';

const FUTURES_ORIGIN = 'https://fapi.binance.com';
const SPOT_ORIGIN = 'https://api.binance.com';
const DEFAULT_MAX_CONCURRENCY = 12;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

const PERIOD_MS = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '1w': 604_800_000
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function inferPublicCacheTtl(url) {
  const parsed = new URL(url);
  const path = parsed.pathname;

  if (path.endsWith('/exchangeInfo')) return 6 * 60 * 60 * 1000;
  if (path.endsWith('/fundingRate')) return 4 * 60 * 1000;
  if (path.includes('/futures/data/')) {
    const period = parsed.searchParams.get('period');
    return Math.max(30_000, (PERIOD_MS[period] || 60_000) * 0.8);
  }
  if (path.endsWith('/ticker/24hr')) return 1_000;
  if (path.endsWith('/premiumIndex')) return 1_000;
  if (path.endsWith('/ticker/bookTicker')) return 500;
  if (path.endsWith('/openInterest')) return 2_000;
  if (path.endsWith('/depth')) return 1_000;

  return 0;
}

function inferSignedCacheTtl(endpoint) {
  if (endpoint.endsWith('/leverageBracket')) return 60 * 60 * 1000;
  if (endpoint.endsWith('/commissionRate')) return 60 * 60 * 1000;
  if (endpoint.endsWith('/positionSide/dual')) return 2_000;
  if (endpoint.endsWith('/account')) return 750;
  if (endpoint.endsWith('/positionRisk')) return 750;
  return 0;
}

function stableParamsKey(paramsObj) {
  return Object.entries(paramsObj)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');
}

export function createBinanceRequestGovernor({
  fetchImpl = fetch,
  maxConcurrency = DEFAULT_MAX_CONCURRENCY,
  rateCoordinator = createBinanceRateCoordinator(),
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const queue = [];
  let activeCount = 0;

  function releaseSlot() {
    activeCount -= 1;
    const next = queue.shift();
    if (next) {
      activeCount += 1;
      next();
    }
  }

  async function acquireSlot() {
    if (activeCount < maxConcurrency) {
      activeCount += 1;
      return;
    }
    await new Promise(resolve => queue.push(resolve));
  }

  async function fetchJson(
    url,
    {
      cacheKey = url,
      ttlMs = inferPublicCacheTtl(url),
      priority = 'market-data',
      maxRetries = 2,
      headers
    } = {}
  ) {
    const currentTime = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > currentTime) return cached.value;
    const inFlightKey = `${priority}:${cacheKey}`;

    if (inFlight.has(inFlightKey)) return inFlight.get(inFlightKey);

    const request = (async () => {
      await acquireSlot();
      try {
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          const parsedUrl = new URL(url);
          const params = Object.fromEntries(parsedUrl.searchParams);
          const cost = estimateBinanceRateCost({
            endpoint: parsedUrl.pathname,
            method: 'GET',
            params
          });
          const reservation = await rateCoordinator.reserve({
            ...cost,
            priority
          });
          if (!reservation.allowed) {
            console.warn(
              `[BINANCE GATEWAY] fetchJson null (rate-budget-denied) url=${url} reason=${reservation.reason ?? 'unknown'}`
            );
            return cached?.value ?? null;
          }

          let response;
          try {
            response = await fetchImpl(url, {
              headers,
              signal: AbortSignal.timeout(requestTimeoutMs)
            });
          } catch (error) {
            if (attempt >= maxRetries) {
              const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
              console.warn(
                `[BINANCE GATEWAY] fetchJson null (${isTimeout ? 'timeout' : 'network-error'}) url=${url} attempt=${attempt} error=${error?.message ?? String(error)}`
              );
              return cached?.value ?? null;
            }
            await sleep(200 * 2 ** attempt);
            continue;
          }

          await rateCoordinator.observeResponse({
            headers: response.headers,
            status: response.status
          });

          if (response.status === 429 || response.status === 418) {
            console.warn(
              `[BINANCE GATEWAY] fetchJson null (rate-limited) url=${url} status=${response.status}${response.status === 418 ? ' ip-banned' : ''}`
            );
            return cached?.value ?? null;
          }

          if (response.ok) {
            let value;
            try {
              value = await response.json();
            } catch (error) {
              console.warn(
                `[BINANCE GATEWAY] fetchJson json-parse-failed url=${url} status=${response.status} error=${error?.message ?? String(error)}`
              );
              throw error;
            }
            if (parsedUrl.pathname.endsWith('/exchangeInfo')) {
              await rateCoordinator.updateLimitsFromExchangeInfo({
                ...value,
                product: parsedUrl.origin === SPOT_ORIGIN
                  ? 'spot'
                  : 'futures'
              });
            }
            if (ttlMs > 0) {
              cache.set(cacheKey, {
                value,
                expiresAt: Date.now() + ttlMs
              });
            }
            return value;
          }

          if (response.status < 500 || attempt >= maxRetries) {
            console.warn(
              `[BINANCE GATEWAY] fetchJson null (http-error) url=${url} status=${response.status}${response.status === 403 ? ' forbidden' : ''} attempt=${attempt} maxRetries=${maxRetries}`
            );
            return cached?.value ?? null;
          }

          await sleep(200 * 2 ** attempt);
        }
        console.warn(
          `[BINANCE GATEWAY] fetchJson null (retries-exhausted) url=${url} maxRetries=${maxRetries}`
        );
        return cached?.value ?? null;
      } finally {
        releaseSlot();
      }
    })();

    inFlight.set(inFlightKey, request);
    try {
      return await request;
    } finally {
      inFlight.delete(inFlightKey);
    }
  }

  return {
    fetchJson,
    getState: () => {
      const rateState = rateCoordinator.getState();
      return {
        activeCount,
        cacheEntries: cache.size,
        inFlight: inFlight.size,
        maxConcurrency,
        queued: queue.length,
        ...rateState,
        requestWeightLimit: rateState.limits?.requestWeight1m ?? null,
        usedWeight1m: rateState.used?.requestWeight1m ?? 0
      };
    },
    invalidate: cacheKey => cache.delete(cacheKey)
  };
}

export function createBinanceGateway({
  readApiKey,
  readApiSecret,
  tradeApiKey,
  tradeApiSecret,
  getTimeOffset,
  axiosImpl = axios,
  fetchImpl = fetch,
  rateCoordinator = getSharedBinanceRateCoordinator()
}) {
  const governor = createBinanceRequestGovernor({
    fetchImpl,
    rateCoordinator
  });

  const reserveMutation = async (method, endpoint, paramsObj, options) => {
    const priority = options.priority || (
      String(method).toUpperCase() === 'GET'
        ? BINANCE_RATE_PRIORITY.ACCOUNT
        : (
            endpoint.endsWith('/algoOrder') ||
            endpoint.endsWith('/allOpenOrders') ||
            paramsObj.reduceOnly === true ||
            paramsObj.reduceOnly === 'true'
              ? BINANCE_RATE_PRIORITY.PROTECTION
              : BINANCE_RATE_PRIORITY.EXECUTION
          )
    );
    const reservation = await rateCoordinator.reserve({
      ...estimateBinanceRateCost({ endpoint, method, params: paramsObj }),
      priority
    });
    if (!reservation.allowed) {
      const error = new Error(
        `Binance rate budget denied: ${reservation.reason}`
      );
      error.code = 'BINANCE_RATE_BUDGET_DENIED';
      error.rateLimit = reservation;
      throw error;
    }
  };

  const sendSignedRequest = async ({
    apiKey,
    apiSecret,
    endpoint,
    method,
    options = {},
    origin,
    paramsObj = {}
  }) => {
    const params = new URLSearchParams(paramsObj);
    params.append(
      'timestamp',
      (Date.now() + getTimeOffset()).toString()
    );
    params.append('recvWindow', '10000');
    const qs = params.toString();
    const sig = crypto
      .createHmac('sha256', apiSecret)
      .update(qs)
      .digest('hex');
    const isQuery = ['GET', 'DELETE'].includes(method.toUpperCase());
    const finalUrl = isQuery
      ? `${origin}${endpoint}?${qs}&signature=${sig}`
      : `${origin}${endpoint}`;
    const finalData = isQuery ? undefined : `${qs}&signature=${sig}`;

    await reserveMutation(method, endpoint, paramsObj, options);
    try {
      const response = await axiosImpl({
        method,
        url: finalUrl,
        data: finalData,
        headers: {
          'X-MBX-APIKEY': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: DEFAULT_REQUEST_TIMEOUT_MS
      });
      await rateCoordinator.observeResponse(response);
      return response;
    } catch (error) {
      if (error?.response) await rateCoordinator.observeResponse(error.response);
      throw error;
    }
  };

  const sendBinanceReq = async (
    method,
    endpoint,
    paramsObj = {},
    options = {}
  ) => {
    return sendSignedRequest({
      apiKey: tradeApiKey,
      apiSecret: tradeApiSecret,
      endpoint,
      method,
      options,
      origin: FUTURES_ORIGIN,
      paramsObj
    });
  };

  const sendSpotBinanceReq = async (
    method,
    endpoint,
    paramsObj = {},
    options = {}
  ) => sendSignedRequest({
    apiKey: tradeApiKey,
    apiSecret: tradeApiSecret,
    endpoint,
    method,
    options,
    origin: SPOT_ORIGIN,
    paramsObj
  });

  const readBinanceReq = async (
    endpoint,
    paramsObj = {},
    options = {}
  ) => {
    const params = new URLSearchParams(paramsObj);
    params.append(
      'timestamp',
      (Date.now() + getTimeOffset()).toString()
    );
    params.append('recvWindow', '10000');
    const qs = params.toString();
    const sig = crypto
      .createHmac('sha256', readApiSecret)
      .update(qs)
      .digest('hex');
    const cacheKey = `SIGNED:${endpoint}?${stableParamsKey(paramsObj)}`;

    return governor.fetchJson(
      `${FUTURES_ORIGIN}${endpoint}?${qs}&signature=${sig}`,
      {
        cacheKey,
        headers: { 'X-MBX-APIKEY': readApiKey },
        priority: options.priority || BINANCE_RATE_PRIORITY.ACCOUNT,
        ttlMs:
          options.ttlMs ??
          inferSignedCacheTtl(endpoint)
      }
    );
  };

  const readSpotBinanceReq = async (
    endpoint,
    paramsObj = {},
    options = {}
  ) => {
    const params = new URLSearchParams(paramsObj);
    params.append(
      'timestamp',
      (Date.now() + getTimeOffset()).toString()
    );
    params.append('recvWindow', '10000');
    const qs = params.toString();
    const sig = crypto
      .createHmac('sha256', readApiSecret)
      .update(qs)
      .digest('hex');
    const cacheKey = `SPOT_SIGNED:${endpoint}?${stableParamsKey(paramsObj)}`;

    return governor.fetchJson(
      `${SPOT_ORIGIN}${endpoint}?${qs}&signature=${sig}`,
      {
        cacheKey,
        headers: { 'X-MBX-APIKEY': readApiKey },
        priority: options.priority || BINANCE_RATE_PRIORITY.ACCOUNT,
        ttlMs: options.ttlMs ?? 0
      }
    );
  };

  const safeFetch = async (url, options = {}) => {
    if (url.startsWith(FUTURES_ORIGIN) || url.startsWith(SPOT_ORIGIN)) {
      return governor.fetchJson(url, options);
    }
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS)
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };

  return {
    getRateLimitState: governor.getState,
    readBinanceReq,
    readSpotBinanceReq,
    safeFetch,
    sendBinanceReq,
    sendSpotBinanceReq
  };
}
