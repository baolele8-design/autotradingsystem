const FUTURES_TIME_URL = 'https://fapi.binance.com/fapi/v1/time';
const FUTURES_EXCHANGE_INFO_URL =
  'https://fapi.binance.com/fapi/v1/exchangeInfo';

const defaultSleep = delay => new Promise(resolve => setTimeout(resolve, delay));

async function waitForRequiredValue({
  dependency,
  isValid,
  onRetry = () => {},
  read,
  retryDelayMs,
  sleepFn
}) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const value = await read();
      if (isValid(value)) return value;
      throw new Error(`${dependency} response is unavailable`);
    } catch (error) {
      onRetry({ attempt, dependency, error, retryDelayMs });
      await sleepFn(retryDelayMs);
    }
  }
}

export async function readAutoBotServerTime({ safeFetch }) {
  const response = await safeFetch(FUTURES_TIME_URL, {
    maxRetries: 0,
    priority: 'reconciliation',
    ttlMs: 0
  });
  const serverTime = Number(response?.serverTime);
  if (!Number.isFinite(serverTime)) {
    throw new Error('Binance time response is unavailable');
  }
  return serverTime;
}

export async function waitForAutoBotServerTime({
  onRetry,
  retryDelayMs = 5_000,
  safeFetch,
  sleepFn = defaultSleep
}) {
  return waitForRequiredValue({
    dependency: 'serverTime',
    isValid: Number.isFinite,
    onRetry,
    read: () => readAutoBotServerTime({ safeFetch }),
    retryDelayMs,
    sleepFn
  });
}

export async function waitForAutoBotExchangeInfo({
  onRetry,
  retryDelayMs = 5_000,
  safeFetch,
  sleepFn = defaultSleep
}) {
  return waitForRequiredValue({
    dependency: 'exchangeInfo',
    isValid: value => Array.isArray(value?.symbols),
    onRetry,
    read: () => safeFetch(FUTURES_EXCHANGE_INFO_URL),
    retryDelayMs,
    sleepFn
  });
}
