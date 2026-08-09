import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOptimizationCycleService
} from './optimizationCycleService.js';

test('runs one optimization at a time and reloads only a newly saved model', async () => {
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  let optimizationCalls = 0;
  let reloadCalls = 0;
  const service = createOptimizationCycleService({
    getCurrentAiModel: () => ({ training_data_fingerprint: 'old' }),
    loadLatestAiModel: async () => {
      reloadCalls += 1;
    },
    runOptimizationEpoch: async ({ previousModel }) => {
      optimizationCalls += 1;
      assert.equal(previousModel.training_data_fingerprint, 'old');
      await gate;
      return { skipped: false };
    }
  });

  const first = service.runOptimizationCycle();
  const overlapping = await service.runOptimizationCycle();
  assert.deepEqual(overlapping, { status: 'ALREADY_RUNNING' });

  release();
  assert.deepEqual(await first, { status: 'UPDATED' });
  assert.equal(optimizationCalls, 1);
  assert.equal(reloadCalls, 1);
});

test('does not reload the same model when the training fingerprint is unchanged', async () => {
  let reloadCalls = 0;
  const service = createOptimizationCycleService({
    getCurrentAiModel: () => ({ training_data_fingerprint: 'same' }),
    loadLatestAiModel: async () => {
      reloadCalls += 1;
    },
    runOptimizationEpoch: async () => ({ skipped: true })
  });

  assert.deepEqual(
    await service.runOptimizationCycle(),
    { status: 'UNCHANGED' }
  );
  assert.equal(reloadCalls, 0);
});

test('finishes data enrichment before building the next model', async () => {
  const events = [];
  const service = createOptimizationCycleService({
    getCurrentAiModel: () => null,
    loadLatestAiModel: async () => {
      events.push('reload');
    },
    prepareTrainingData: async () => {
      events.push('enrich');
    },
    runOptimizationEpoch: async () => {
      events.push('train');
      return { skipped: false };
    }
  });

  await service.runOptimizationCycle();

  assert.deepEqual(events, ['enrich', 'train', 'reload']);
});

test('does not train when data preparation fails', async () => {
  let optimizationCalls = 0;
  const service = createOptimizationCycleService({
    getCurrentAiModel: () => null,
    loadLatestAiModel: async () => {},
    prepareTrainingData: async () => false,
    runOptimizationEpoch: async () => {
      optimizationCalls += 1;
      return { skipped: false };
    }
  });

  assert.deepEqual(
    await service.runOptimizationCycle(),
    { status: 'DATA_NOT_READY' }
  );
  assert.equal(optimizationCalls, 0);
});

test('reports a saved model that could not be reloaded', async () => {
  const service = createOptimizationCycleService({
    getCurrentAiModel: () => null,
    loadLatestAiModel: async () => false,
    runOptimizationEpoch: async () => ({ skipped: false })
  });

  assert.deepEqual(
    await service.runOptimizationCycle(),
    { status: 'RELOAD_FAILED' }
  );
});
