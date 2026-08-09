export function createWebSocketHub({
  marketDataCache,
  wss,
  syncHUD
}) {
  let connectedClients = [];

  marketDataCache.onPriceUpdate(update => {
    for (const client of connectedClients) {
      if (
        client.readyState === 1 &&
        client.hudConfig?.symbol === update.symbol
      ) {
        client.send(
          JSON.stringify({
            type: 'MARK_PRICE',
            payload: update
          })
        );
      }
    }
  });

  wss.on('connection', ws => {
    connectedClients.push(ws);
    ws.on('close', () => {
      connectedClients = connectedClients.filter(
        client => client !== ws
      );
    });

    ws.on('message', message => {
      try {
        const msg = JSON.parse(message);
        if (msg.action === 'SUBSCRIBE_HUD') {
          ws.hudConfig = {
            symbol: msg.symbol,
            intervalTime: msg.intervalTime,
            indicatorSpecs: msg.indicatorSpecs
          };
          console.log(
            `[HUD TELEMETRY] Má»Ÿ luá»“ng cáº¥p dá»¯ liá»‡u: ${msg.symbol} [${msg.intervalTime}]`
          );
          syncHUD(ws);
        }
      } catch (error) {
        console.warn('[HUD WEBSOCKET MESSAGE]', error.message);
      }
    });
  });

  return {
    getConnectedClients: () => connectedClients
  };
}
