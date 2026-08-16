export function registerLedgerRoutes({
  app,
  supabase,
  broadcastLedgerChanged
}) {
  const safeBroadcast = message => {
    if (typeof broadcastLedgerChanged === 'function') {
      broadcastLedgerChanged(message);
    }
  };

  app.get('/api/ledger/trade-logs', async (req, res) => {
    try {
      const parsed = Number.parseInt(req.query?.limit, 10);
      const limit = Number.isFinite(parsed) && parsed > 0
        ? Math.min(parsed, 1000)
        : 300;
      const { data, error } = await supabase
        .from('trade_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      res.status(200).json({ data, error });
    } catch (err) {
      res.status(500).json({ data: null, error: { message: err.message } });
    }
  });

  app.get('/api/ledger/system-models/latest', async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('system_models')
        .select('model_data')
        .order('created_at', { ascending: false })
        .limit(1);
      const modelData = !error && Array.isArray(data) && data.length > 0
        ? data[0].model_data
        : null;
      res.status(200).json({
        data: { model_data: modelData },
        error
      });
    } catch (err) {
      res.status(500).json({ data: null, error: { message: err.message } });
    }
  });

  app.post('/api/ledger/trade-logs', async (req, res) => {
    try {
      const payload = req.body?.payload;
      const rows = Array.isArray(payload) ? payload : [payload];
      const { data, error } = await supabase
        .from('trade_logs')
        .insert(rows)
        .select();
      if (!error) {
        safeBroadcast({ type: 'LEDGER_CHANGED', table: 'trade_logs', event: 'INSERT' });
      }
      res.status(200).json({ data, error });
    } catch (err) {
      res.status(500).json({ data: null, error: { message: err.message } });
    }
  });

  app.patch('/api/ledger/trade-logs/:id', async (req, res) => {
    try {
      const orFilter = typeof req.query?.or === 'string' && req.query.or.length > 0
        ? req.query.or
        : null;
      let query = supabase
        .from('trade_logs')
        .update(req.body || {})
        .eq('id', req.params.id);
      if (orFilter) query = query.or(orFilter);
      const { data, error } = await query;
      if (!error) {
        safeBroadcast({ type: 'LEDGER_CHANGED', table: 'trade_logs', event: 'UPDATE' });
      }
      res.status(200).json({ data, error });
    } catch (err) {
      res.status(500).json({ data: null, error: { message: err.message } });
    }
  });

  app.delete('/api/ledger/trade-logs/:id', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('trade_logs')
        .delete()
        .eq('id', req.params.id);
      if (!error) {
        safeBroadcast({ type: 'LEDGER_CHANGED', table: 'trade_logs', event: 'DELETE' });
      }
      res.status(200).json({ data, error });
    } catch (err) {
      res.status(500).json({ data: null, error: { message: err.message } });
    }
  });

  app.post('/api/ledger/paper-logs', async (req, res) => {
    try {
      const payload = req.body?.payload;
      const rows = Array.isArray(payload) ? payload : [];
      const { data, error } = await supabase
        .from('paper_trade_logs')
        .insert(rows);
      if (!error) {
        safeBroadcast({ type: 'LEDGER_CHANGED', table: 'paper_trade_logs', event: 'INSERT' });
      }
      res.status(200).json({ data, error });
    } catch (err) {
      res.status(500).json({ data: null, error: { message: err.message } });
    }
  });
}
