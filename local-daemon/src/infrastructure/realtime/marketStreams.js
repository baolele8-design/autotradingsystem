import WebSocket from 'ws';
import {
  markLiquidationStreamConnected,
  markLiquidationStreamDisconnected,
  readLiquidationWindow,
  recordLiquidation
} from './liquidationWindow.js';

const MARKET_STREAM_URL =
  'wss://fstream.binance.com/market/stream';
const PUBLIC_STREAM_URL =
  'wss://fstream.binance.com/public/stream';
const MAX_STREAMS_PER_CONNECTION = 1024;
const SUBSCRIPTION_BATCH_SIZE = 200;
const CONNECTION_ROTATION_MS = 23 * 60 * 60 * 1000 + 50 * 60 * 1000;

function firstPositiveNumber(values) {
  for (const value of values) {
    const numeric = Number.parseFloat(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return 0;
}

export function selectLiquidationFilledQuantity(forceOrder) {
  // Binance defines `l` as the last (incremental) filled quantity. `z` is
  // cumulative and `q` is the original order quantity; neither is a valid
  // fallback for summing a rolling liquidation window.
  return firstPositiveNumber([forceOrder?.l]);
}

export function liquidationEventFromMessage(message) {
  const forceOrder = message?.o;
  if (
    !forceOrder?.s ||
    (forceOrder.S !== 'BUY' && forceOrder.S !== 'SELL')
  ) {
    return null;
  }

  const quantity = selectLiquidationFilledQuantity(forceOrder);
  const price = firstPositiveNumber([
    forceOrder.ap,
    forceOrder.p
  ]);
  const notionalUsd = quantity * price;
  if (
    quantity <= 0 ||
    price <= 0 ||
    !Number.isFinite(notionalUsd)
  ) {
    return null;
  }

  const timestamp =
    firstPositiveNumber([forceOrder.T, message.E]) || undefined;
  const id = [
    forceOrder.s,
    forceOrder.S,
    forceOrder.T || message.E || '',
    forceOrder.l || '',
    forceOrder.q || '',
    forceOrder.p || ''
  ].join(':');

  return {
    event: {
      id,
      notionalUsd,
      side: forceOrder.S,
      timestamp
    },
    symbol: forceOrder.s
  };
}

function createStreamSupervisor({
  label,
  url,
  initialStreams,
  onPayload,
  onOpen = () => {},
  onClose = () => {},
  onStreamsSubscribed = () => {},
  onSubscriptionError = () => {}
}) {
  const desiredStreams = new Set(initialStreams);
  const activeStreams = new Set();
  const pendingRequests = new Map();
  let socket = null;
  let started = false;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let rotationTimer = null;
  let staleTimer = null;
  let subscriptionFlushTimer = null;
  let lastMessageAt = 0;
  let requestId = 1;

  function scheduleReconnect() {
    if (!started || reconnectTimer) return;
    const baseDelay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt);
    const delay = baseDelay + Math.floor(Math.random() * 500);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function sendMissingSubscriptions() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (subscriptionFlushTimer) return;
    const targetSocket = socket;
    subscriptionFlushTimer = setTimeout(() => {
      subscriptionFlushTimer = null;
      if (socket !== targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
        return;
      }
      const missing = [...desiredStreams].filter(
        stream => !activeStreams.has(stream)
      );

      for (
        let offset = 0;
        offset < missing.length;
        offset += SUBSCRIPTION_BATCH_SIZE
      ) {
        const batch = missing.slice(offset, offset + SUBSCRIPTION_BATCH_SIZE);
        const delay =
          (offset / SUBSCRIPTION_BATCH_SIZE) * 150;
        setTimeout(() => {
          if (
            socket !== targetSocket ||
            targetSocket.readyState !== WebSocket.OPEN
          ) {
            return;
          }
          const id = requestId;
          requestId += 1;
          pendingRequests.set(id, {
            method: 'SUBSCRIBE',
            streams: batch
          });
          targetSocket.send(
            JSON.stringify({
              method: 'SUBSCRIBE',
              params: batch,
              id
            })
          );
          for (const stream of batch) activeStreams.add(stream);
        }, delay);
      }
    }, 0);
  }

  function connect() {
    if (!started) return;
    const connection = new WebSocket(url);
    socket = connection;

    connection.on('open', () => {
      if (socket !== connection) {
        connection.close(1000);
        return;
      }
      reconnectAttempt = 0;
      lastMessageAt = Date.now();
      activeStreams.clear();
      pendingRequests.clear();
      onOpen();
      sendMissingSubscriptions();
      console.log(`[STREAM] Đã kết nối ${label}.`);

      clearTimeout(rotationTimer);
      rotationTimer = setTimeout(() => {
        if (
          socket === connection &&
          connection.readyState === WebSocket.OPEN
        ) {
          connection.close(1000);
        }
      }, CONNECTION_ROTATION_MS);
    });

    connection.on('message', raw => {
      if (socket !== connection) return;
      lastMessageAt = Date.now();
      try {
        const message = JSON.parse(raw.toString());
        if (message.id !== undefined) {
          const pending = pendingRequests.get(message.id);
          pendingRequests.delete(message.id);
          if (!pending) return;

          if (message.result === null) {
            if (pending.method === 'SUBSCRIBE') {
              onStreamsSubscribed(pending.streams);
            }
          } else {
            for (const stream of pending.streams) {
              activeStreams.delete(stream);
            }
            onSubscriptionError(pending.streams, message);
            console.error(
              `[STREAM] ${label} từ chối subscription:`,
              message.msg || message.code || 'unknown error'
            );
            if (connection.readyState === WebSocket.OPEN) {
              connection.close(1011);
            }
          }
          return;
        }
        onPayload(message.data ?? message);
      } catch (error) {
        console.error(`[STREAM] Payload ${label} không hợp lệ:`, error.message);
      }
    });

    connection.on('error', () => {
      if (connection.readyState === WebSocket.OPEN) connection.close();
    });

    connection.on('close', () => {
      if (socket !== connection) return;
      activeStreams.clear();
      pendingRequests.clear();
      onClose();
      clearTimeout(subscriptionFlushTimer);
      subscriptionFlushTimer = null;
      clearTimeout(rotationTimer);
      scheduleReconnect();
    });
  }

  return {
    add(stream) {
      if (desiredStreams.has(stream)) return;
      if (desiredStreams.size >= MAX_STREAMS_PER_CONNECTION) {
        throw new Error(
          `${label} vượt giới hạn ${MAX_STREAMS_PER_CONNECTION} streams`
        );
      }
      desiredStreams.add(stream);
      sendMissingSubscriptions();
    },
    remove(streams) {
      const removable = streams.filter(stream => desiredStreams.has(stream));
      const targetSocket = socket;
      for (const stream of removable) {
        desiredStreams.delete(stream);
        activeStreams.delete(stream);
      }
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      for (
        let offset = 0;
        offset < removable.length;
        offset += SUBSCRIPTION_BATCH_SIZE
      ) {
        const batch = removable.slice(
          offset,
          offset + SUBSCRIPTION_BATCH_SIZE
        );
        if (batch.length === 0) continue;
        const delay =
          (offset / SUBSCRIPTION_BATCH_SIZE) * 150;
        setTimeout(() => {
          if (
            socket !== targetSocket ||
            targetSocket.readyState !== WebSocket.OPEN
          ) {
            return;
          }
          targetSocket.send(
            JSON.stringify({
              method: 'UNSUBSCRIBE',
              params: batch,
              id: requestId
            })
          );
          requestId += 1;
        }, delay);
      }
    },
    start() {
      if (started) return;
      started = true;
      connect();
      staleTimer = setInterval(() => {
        if (
          socket?.readyState === WebSocket.OPEN &&
          Date.now() - lastMessageAt > 120_000
        ) {
          socket.terminate();
        }
      }, 30_000);
    },
    stop() {
      started = false;
      clearInterval(staleTimer);
      clearTimeout(subscriptionFlushTimer);
      clearTimeout(reconnectTimer);
      clearTimeout(rotationTimer);
      if (socket?.readyState === WebSocket.OPEN) socket.close(1000);
    }
  };
}

export function createMarketStreams({
  liquidationsCache,
  marketDataCache
}) {
  const klineLastRequested = new Map();
  let klineCleanupTimer = null;
  function handleLiquidation(message) {
    const normalized = liquidationEventFromMessage(message);
    if (!normalized) return;
    recordLiquidation(
      liquidationsCache,
      normalized.symbol,
      normalized.event
    );
  }

  function handleMarketPayload(payload) {
    const updates = Array.isArray(payload) ? payload : [payload];
    for (const update of updates) {
      if (update?.st !== undefined && Number(update.st) !== 1) continue;
      switch (update?.e) {
        case 'markPriceUpdate':
          marketDataCache.updateMarkPrice(update);
          break;
        case '24hrTicker':
          marketDataCache.updateTicker24h(update);
          break;
        case 'forceOrder':
          handleLiquidation(update);
          break;
        case 'kline':
          marketDataCache.updateKline(update);
          break;
        default:
          break;
      }
    }
  }

  function handlePublicPayload(payload) {
    const updates = Array.isArray(payload) ? payload : [payload];
    for (const update of updates) {
      if (update?.st !== undefined && Number(update.st) !== 1) continue;
      if (update?.e === 'bookTicker' || update?.s) {
        marketDataCache.updateBookTicker(update);
      }
    }
  }

  const marketSupervisor = createStreamSupervisor({
    initialStreams: [
      '!markPrice@arr@1s',
      '!ticker@arr',
      '!forceOrder@arr'
    ],
    label: 'Binance Futures Market',
    onClose: () => {
      markLiquidationStreamDisconnected(liquidationsCache);
    },
    onOpen: () => {
      // Opening a socket is not sufficient coverage. Stay fail-closed until
      // Binance acknowledges the force-order subscription.
      markLiquidationStreamDisconnected(liquidationsCache);
    },
    onPayload: handleMarketPayload,
    onStreamsSubscribed: streams => {
      if (streams.includes('!forceOrder@arr')) {
        markLiquidationStreamConnected(liquidationsCache);
      }
    },
    onSubscriptionError: streams => {
      if (streams.includes('!forceOrder@arr')) {
        markLiquidationStreamDisconnected(liquidationsCache);
      }
    },
    url: MARKET_STREAM_URL
  });

  const publicSupervisor = createStreamSupervisor({
    initialStreams: ['!bookTicker'],
    label: 'Binance Futures Public',
    onPayload: handlePublicPayload,
    url: PUBLIC_STREAM_URL
  });

  marketDataCache.setKlineSubscriptionHandler((symbol, interval) => {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    klineLastRequested.set(stream, Date.now());
    marketSupervisor.add(stream);
  });

  return {
    getLiquidationSnapshot(symbol) {
      return readLiquidationWindow(liquidationsCache, symbol);
    },
    startMarketStreams() {
      marketSupervisor.start();
      publicSupervisor.start();
      if (!klineCleanupTimer) {
        klineCleanupTimer = setInterval(() => {
          const cutoff = Date.now() - 15 * 60_000;
          const staleStreams = [];
          for (const [stream, lastRequestedAt] of klineLastRequested) {
            if (lastRequestedAt < cutoff) {
              staleStreams.push(stream);
              klineLastRequested.delete(stream);
            }
          }
          marketSupervisor.remove(staleStreams);
          marketDataCache.pruneKlines(cutoff);
        }, 5 * 60_000);
      }
    },
    stopMarketStreams() {
      clearInterval(klineCleanupTimer);
      klineCleanupTimer = null;
      marketSupervisor.stop();
      publicSupervisor.stop();
    }
  };
}
