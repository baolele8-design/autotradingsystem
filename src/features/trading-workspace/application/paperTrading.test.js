import test from 'node:test';
import assert from 'node:assert/strict';

import { selectPaperSimulationSetups } from './paperTrading.js';

test('paper simulation prioritizes shadow evidence over live fallbacks', () => {
  const selected = selectPaperSimulationSetups([
    { strategyId: 'LIVE_1', rolloutMode: 'LIVE' },
    { strategyId: 'PAPER_1', rolloutMode: 'PAPER_ONLY' },
    { strategyId: 'LIVE_2', rolloutMode: 'LIVE' },
    { strategyId: 'PAPER_2', executionMode: 'PAPER_ONLY' }
  ], 3);

  assert.deepEqual(
    selected.map(setup => setup.strategyId),
    ['PAPER_1', 'PAPER_2', 'LIVE_1']
  );
});
