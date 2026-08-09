import test from 'node:test';
import assert from 'node:assert/strict';

import {
  liquidationEventFromMessage,
  selectLiquidationFilledQuantity
} from './marketStreams.js';

test('accepts only Binance incremental last-fill quantity', () => {
  assert.equal(
    selectLiquidationFilledQuantity({
      l: '0.25',
      q: '4',
      z: '2'
    }),
    0.25
  );
  assert.equal(
    selectLiquidationFilledQuantity({
      l: '0',
      q: '4',
      z: '2'
    }),
    0
  );
  assert.equal(
    selectLiquidationFilledQuantity({
      q: '4',
      z: '2'
    }),
    0
  );
});

test('normalizes a force-order message into stable USDT notional', () => {
  const message = {
    E: 1234,
    o: {
      S: 'SELL',
      T: 1230,
      X: 'FILLED',
      ap: '100',
      l: '2.5',
      p: '101',
      q: '9',
      s: 'BTCUSDT',
      z: '2.5'
    }
  };

  const first = liquidationEventFromMessage(message);
  const repeated = liquidationEventFromMessage(message);

  assert.equal(first.symbol, 'BTCUSDT');
  assert.equal(first.event.side, 'SELL');
  assert.equal(first.event.notionalUsd, 250);
  assert.equal(first.event.timestamp, 1230);
  assert.equal(first.event.id, repeated.event.id);
});

test('stable fill id ignores cumulative quantity and status changes', () => {
  const base = {
    E: 1234,
    o: {
      S: 'SELL',
      T: 1230,
      X: 'PARTIALLY_FILLED',
      ap: '100',
      l: '0.5',
      p: '101',
      q: '9',
      s: 'BTCUSDT',
      z: '2.5'
    }
  };
  const laterStatus = {
    ...base,
    o: {
      ...base.o,
      X: 'FILLED',
      ap: '100.5',
      z: '9'
    }
  };

  assert.equal(
    liquidationEventFromMessage(base).event.id,
    liquidationEventFromMessage(laterStatus).event.id
  );
});

test('rejects force-order snapshots without positive fill or price', () => {
  assert.equal(
    liquidationEventFromMessage({
      o: {
        S: 'BUY',
        ap: '100',
        l: '0',
        q: '5',
        s: 'BTCUSDT',
        z: '2'
      }
    }),
    null
  );
  assert.equal(
    liquidationEventFromMessage({
      o: {
        S: 'BUY',
        ap: '0',
        l: '1',
        p: '0',
        s: 'BTCUSDT'
      }
    }),
    null
  );
  assert.equal(
    liquidationEventFromMessage({
      o: {
        S: 'UNKNOWN',
        ap: '100',
        l: '1',
        s: 'BTCUSDT'
      }
    }),
    null
  );
});
