import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBinanceGateway
} from '../infrastructure/binance/binanceGateway.js';
import {
  createBinanceRateCoordinator
} from '../infrastructure/binance/binanceRateCoordinator.js';
import {
  waitForAutoBotExchangeInfo,
  waitForAutoBotServerTime
} from './autoBotStartup.js';

function jsonResponse(value, weight) {
  return new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json',
      'x-mbx-used-weight-1m': String(weight)
    },
    status: 200
  });
}

test('warms the shared governor before loading required AutoBot metadata', async () => {
  const requestedPaths = [];
  const rateCoordinator = createBinanceRateCoordinator({
    requireInitialObservation: true
  });
  const gateway = createBinanceGateway({
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      requestedPaths.push(path);
      if (path.endsWith('/time')) {
        return jsonResponse({ serverTime: 1_700_000_000_000 }, 1);
      }
      return jsonResponse({ symbols: [{ symbol: 'BTCUSDT' }] }, 2);
    },
    getTimeOffset: () => 0,
    rateCoordinator,
    readApiKey: '',
    readApiSecret: '',
    tradeApiKey: '',
    tradeApiSecret: ''
  });

  const serverTime = await waitForAutoBotServerTime({
    safeFetch: gateway.safeFetch,
    sleepFn: async () => {}
  });
  const exchangeInfo = await waitForAutoBotExchangeInfo({
    safeFetch: gateway.safeFetch,
    sleepFn: async () => {}
  });

  assert.equal(serverTime, 1_700_000_000_000);
  assert.equal(exchangeInfo.symbols[0].symbol, 'BTCUSDT');
  assert.deepEqual(requestedPaths, [
    '/fapi/v1/time',
    '/fapi/v1/exchangeInfo'
  ]);
  assert.equal(rateCoordinator.getState().ready, true);
});

test('retries missing startup metadata instead of disabling AutoBot forever', async () => {
  let exchangeInfoReads = 0;
  const retries = [];
  const exchangeInfo = await waitForAutoBotExchangeInfo({
    onRetry: retry => retries.push(retry),
    retryDelayMs: 25,
    safeFetch: async () => {
      exchangeInfoReads += 1;
      return exchangeInfoReads === 1
        ? null
        : { symbols: [{ symbol: 'ETHUSDT' }] };
    },
    sleepFn: async delay => assert.equal(delay, 25)
  });

  assert.equal(exchangeInfoReads, 2);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].dependency, 'exchangeInfo');
  assert.equal(exchangeInfo.symbols[0].symbol, 'ETHUSDT');
});
