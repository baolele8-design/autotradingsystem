import test from 'node:test';
import assert from 'node:assert/strict';
import { registerLedgerRoutes } from './ledgerBridge.js';

const thenable = result => ({
  select: () => thenable(result),
  order: () => thenable(result),
  limit: () => thenable(result),
  eq: () => thenable(result),
  in: () => thenable(result),
  insert: () => thenable(result),
  update: () => thenable(result),
  delete: () => thenable(result),
  then: resolve => resolve(result)
});

const makeHarness = supabaseImpl => {
  const handlers = new Map();
  const app = {
    get: (p, h) => handlers.set(`GET ${p}`, h),
    post: (p, h) => handlers.set(`POST ${p}`, h),
    patch: (p, h) => handlers.set(`PATCH ${p}`, h),
    delete: (p, h) => handlers.set(`DELETE ${p}`, h)
  };
  const broadcasts = [];
  registerLedgerRoutes({
    app,
    supabase: supabaseImpl,
    broadcastLedgerChanged: msg => broadcasts.push(msg)
  });
  const makeResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  });
  return { handlers, broadcasts, makeResponse };
};

test('GET /api/ledger/trade-logs tra ve danh sach trade_logs', async () => {
  const calls = [];
  const rows = [{ id: 'a', symbol: 'BTCUSDT' }];
  const supabase = {
    from(table) {
      calls.push(table);
      return thenable({ data: rows, error: null });
    }
  };
  const { handlers, makeResponse } = makeHarness(supabase);
  const res = makeResponse();
  await handlers.get('GET /api/ledger/trade-logs')({ query: { limit: '50' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, rows);
  assert.equal(calls[0], 'trade_logs');
});

test('GET /api/ledger/system-models/latest tra ve model_data moi nhat', async () => {
  const supabase = {
    from: () => thenable({ data: [{ model_data: { v: 1 } }], error: null })
  };
  const { handlers, makeResponse } = makeHarness(supabase);
  const res = makeResponse();
  await handlers.get('GET /api/ledger/system-models/latest')({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { model_data: { v: 1 } });
});

test('POST /api/ledger/trade-logs insert payload va broadcast INSERT', async () => {
  const payload = { symbol: 'ETHUSDT', status: 'PENDING' };
  const supabase = {
    from: () => thenable({ data: [{ id: 'new-1' }], error: null })
  };
  const { handlers, broadcasts, makeResponse } = makeHarness(supabase);
  const res = makeResponse();
  await handlers.get('POST /api/ledger/trade-logs')({ body: { payload } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].id, 'new-1');
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].table, 'trade_logs');
  assert.equal(broadcasts[0].event, 'INSERT');
});

test('PATCH /api/ledger/trade-logs/:id update theo id va broadcast UPDATE', async () => {
  const supabase = {
    from: () => thenable({ data: null, error: null })
  };
  const { handlers, broadcasts, makeResponse } = makeHarness(supabase);
  const res = makeResponse();
  await handlers.get('PATCH /api/ledger/trade-logs/:id')(
    { params: { id: 'abc' }, body: { status: 'WIN' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(broadcasts[0].event, 'UPDATE');
});

test('DELETE /api/ledger/trade-logs/:id xoa theo id va broadcast DELETE', async () => {
  const supabase = {
    from: () => thenable({ data: null, error: null })
  };
  const { handlers, broadcasts, makeResponse } = makeHarness(supabase);
  const res = makeResponse();
  await handlers.get('DELETE /api/ledger/trade-logs/:id')(
    { params: { id: 'abc' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(broadcasts[0].event, 'DELETE');
});

test('POST /api/ledger/paper-logs insert danh sach paper va broadcast', async () => {
  const supabase = {
    from: () => thenable({ data: null, error: null })
  };
  const { handlers, broadcasts, makeResponse } = makeHarness(supabase);
  const res = makeResponse();
  await handlers.get('POST /api/ledger/paper-logs')(
    { body: { payload: [{ symbol: 'SOLUSDT' }] } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(broadcasts[0].table, 'paper_trade_logs');
});

test('supabase tra error thi route tra ve {data:null, error} va khong broadcast', async () => {
  const supabase = {
    from: () => thenable({ data: null, error: { message: 'db down' } })
  };
  const { handlers, broadcasts, makeResponse } = makeHarness(supabase);
  const res = makeResponse();
  await handlers.get('DELETE /api/ledger/trade-logs/:id')(
    { params: { id: 'abc' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error.message, 'db down');
  assert.equal(broadcasts.length, 0);
});

test('PATCH hon tro guard or (A1-2) de khong ghi de exit_reason da resolve', async () => {
  const orCalls = [];
  const supabase = {
    from() {
      return {
        update: () => ({
          eq: () => ({
            or: filter => {
              orCalls.push(filter);
              return thenable({ data: null, error: null });
            },
            then: () => {}
          })
        })
      };
    }
  };
  const { handlers, makeResponse } = makeHarness(supabase);
  const res = makeResponse();
  await handlers.get('PATCH /api/ledger/trade-logs/:id')(
    {
      params: { id: 'abc' },
      body: { status: 'WIN' },
      query: { or: 'exit_reason.is.null,exit_reason.eq.MANUAL_CLOSE' }
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(orCalls.length, 1);
  assert.equal(orCalls[0], 'exit_reason.is.null,exit_reason.eq.MANUAL_CLOSE');
});
