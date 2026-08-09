function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress || req.ip || '';
  if (req.headers?.['x-forwarded-for'] || req.headers?.forwarded) return false;
  return [
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1'
  ].includes(address);
}

function requireLoopback(req, res) {
  if (isLoopbackRequest(req)) return true;
  res.status(403).json({ error: 'Loopback access required' });
  return false;
}

export function registerBinanceRateRoutes({ app, rateCoordinator }) {
  app.post('/internal/binance-rate/reserve', async (req, res) => {
    if (!requireLoopback(req, res)) return;
    const reservation = await rateCoordinator.reserve(req.body || {});
    res.status(reservation.allowed ? 200 : 429).json({
      reservation,
      state: rateCoordinator.getState()
    });
  });

  app.post('/internal/binance-rate/observe', async (req, res) => {
    if (!requireLoopback(req, res)) return;
    await rateCoordinator.observeResponse(req.body || {});
    res.status(200).json({ state: rateCoordinator.getState() });
  });

  app.post('/internal/binance-rate/limits', async (req, res) => {
    if (!requireLoopback(req, res)) return;
    await rateCoordinator.updateLimitsFromExchangeInfo({
      product: req.body?.product,
      rateLimits: req.body?.rateLimits
    });
    res.status(200).json({ state: rateCoordinator.getState() });
  });

  app.get('/internal/binance-rate/state', (req, res) => {
    if (!requireLoopback(req, res)) return;
    res.status(200).json({ state: rateCoordinator.getState() });
  });
}
