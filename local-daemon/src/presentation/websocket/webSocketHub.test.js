import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWebSocketHub } from './webSocketHub.js';

const makeFakeWs = (readyState = 1) => ({
  readyState,
  sent: [],
  hudConfig: null,
  send(message) {
    this.sent.push(message);
  },
  on() {
    return this;
  }
});

test('broadcast gui message toi moi client dang mo', () => {
  const wss = new EventEmitter();
  const hub = createWebSocketHub({
    marketDataCache: { onPriceUpdate: () => {} },
    wss,
    syncHUD: () => {}
  });

  const ws1 = makeFakeWs(1);
  const ws2 = makeFakeWs(1);
  wss.emit('connection', ws1);
  wss.emit('connection', ws2);

  hub.broadcast({ type: 'LEDGER_CHANGED', payload: { n: 1 } });

  assert.equal(ws1.sent.length, 1);
  assert.equal(ws2.sent.length, 1);
  const parsed = JSON.parse(ws1.sent[0]);
  assert.equal(parsed.type, 'LEDGER_CHANGED');
  assert.equal(parsed.payload.n, 1);
});

test('broadcast bo qua client khong con OPEN (readyState != 1)', () => {
  const wss = new EventEmitter();
  const hub = createWebSocketHub({
    marketDataCache: { onPriceUpdate: () => {} },
    wss,
    syncHUD: () => {}
  });

  const open = makeFakeWs(1);
  const closing = makeFakeWs(2);
  wss.emit('connection', open);
  wss.emit('connection', closing);

  hub.broadcast({ type: 'LEDGER_CHANGED' });

  assert.equal(open.sent.length, 1);
  assert.equal(closing.sent.length, 0);
});
