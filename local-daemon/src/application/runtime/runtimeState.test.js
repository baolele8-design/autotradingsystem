import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeState } from './runtimeState.js';

test('model reload reports database failure and preserves the current model', async () => {
  const results = [
    { data: [{ model_data: { id: 'known-good' } }], error: null },
    { data: null, error: { message: 'database unavailable' } }
  ];
  const supabase = {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: async () => results.shift()
        })
      })
    })
  };
  const state = createRuntimeState({ supabase });

  assert.equal(await state.loadLatestAiModel(), true);
  assert.deepEqual(state.getCurrentAiModel(), { id: 'known-good' });
  assert.equal(await state.loadLatestAiModel(), false);
  assert.deepEqual(state.getCurrentAiModel(), { id: 'known-good' });
});

test('time sync uses only its governed reader and fails closed without one', async () => {
  const originalFetch = globalThis.fetch;
  let directFetchCalls = 0;
  globalThis.fetch = async () => {
    directFetchCalls += 1;
    throw new Error('direct fetch must not run');
  };
  try {
    const state = createRuntimeState({ supabase: {} });
    assert.equal(await state.syncBinanceTime(), false);
    assert.equal(directFetchCalls, 0);

    state.setBinanceTimeReader(async () => ({
      serverTime: Date.now() + 250
    }));
    assert.equal(await state.syncBinanceTime(), true);
    assert.ok(state.getTimeOffset() >= 200);
    assert.equal(directFetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
