import assert from 'node:assert/strict';
import test from 'node:test';

import { createBinanceRateCoordinator } from '../../infrastructure/binance/binanceRateCoordinator.js';
import { registerBinanceRateRoutes } from './registerBinanceRateRoutes.js';

function setup(coordinator) {
  const handlers = new Map();
  const app = {
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
    post: (path, handler) => handlers.set(`POST ${path}`, handler)
  };
  registerBinanceRateRoutes({ app, rateCoordinator: coordinator });
  return handlers;
}

function makeResponse() {
  return {
    body: null,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    }
  };
}

test('central route atomically pre-charges concurrent scalp reservations', async () => {
  const coordinator = createBinanceRateCoordinator({
    limits: {
      orderCount10s: 100,
      orderCount1m: 100,
      requestWeight1m: 100
    },
    now: () => 60_000
  });
  const handler = setup(coordinator).get('POST /internal/binance-rate/reserve');
  const responses = await Promise.all(
    Array.from({ length: 100 }, async () => {
      const res = makeResponse();
      await handler({
        body: { requestWeight: 1 },
        socket: { remoteAddress: '127.0.0.1' }
      }, res);
      return res;
    })
  );

  assert.equal(responses.filter(res => res.statusCode === 200).length, 65);
  assert.equal(responses.filter(res => res.statusCode === 429).length, 35);
  assert.equal(coordinator.getState().used.requestWeight1m, 65);
});

test('central rate routes reject non-loopback callers', async () => {
  let reservations = 0;
  const handler = setup({
    reserve: () => {
      reservations += 1;
      return { allowed: true };
    },
    getState: () => ({})
  }).get('POST /internal/binance-rate/reserve');
  const res = makeResponse();

  await handler({
    body: { requestWeight: 1 },
    socket: { remoteAddress: '203.0.113.4' }
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(reservations, 0);
});

test('central rate routes reject requests forwarded by a local reverse proxy', async () => {
  let reservations = 0;
  const handler = setup({
    reserve: () => {
      reservations += 1;
      return { allowed: true };
    },
    getState: () => ({})
  }).get('POST /internal/binance-rate/reserve');
  const res = makeResponse();

  await handler({
    body: { requestWeight: 1 },
    headers: { 'x-forwarded-for': '198.51.100.8' },
    socket: { remoteAddress: '127.0.0.1' }
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(reservations, 0);
});
