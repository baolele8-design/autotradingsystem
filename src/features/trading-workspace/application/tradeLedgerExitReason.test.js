import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decideExitReasonUpdate
} from './tradeLedgerExitReason.js';

// A1-2: frontend ledger resolve phải KHÔNG ghi đè exit_reason đã có trên row
// (daemon reconcile là nguồn reason chính xác hơn; UI chỉ điền khi còn trống).
test('decideExitReasonUpdate keeps a stored PORTFOLIO_TP reason (A1-2)', () => {
  const log = { exit_reason: 'PORTFOLIO_TP_BTC_BREAK' };
  assert.equal(
    decideExitReasonUpdate(log, 'TAKE_PROFIT_HIT'),
    'PORTFOLIO_TP_BTC_BREAK'
  );
});

test('decideExitReasonUpdate keeps a stored MANUAL_CLOSE reason (A1-2)', () => {
  const log = { exit_reason: 'MANUAL_CLOSE' };
  assert.equal(
    decideExitReasonUpdate(log, 'STOP_LOSS_HIT'),
    'MANUAL_CLOSE'
  );
});

test('decideExitReasonUpdate applies the precise reason when exit_reason is null (A1-2)', () => {
  const log = { exit_reason: null };
  assert.equal(
    decideExitReasonUpdate(log, 'STOP_LOSS_HIT'),
    'STOP_LOSS_HIT'
  );
});

test('decideExitReasonUpdate applies the precise reason when exit_reason is empty string (A1-2)', () => {
  const log = { exit_reason: '' };
  assert.equal(
    decideExitReasonUpdate(log, 'TAKE_PROFIT_HIT'),
    'TAKE_PROFIT_HIT'
  );
});

test('decideExitReasonUpdate applies the precise reason when exit_reason is only whitespace (A1-2)', () => {
  const log = { exit_reason: '   ' };
  assert.equal(
    decideExitReasonUpdate(log, 'TAKE_PROFIT_HIT'),
    'TAKE_PROFIT_HIT'
  );
});

test('decideExitReasonUpdate returns the stored value verbatim (no trim mutation) (A1-2)', () => {
  const log = { exit_reason: ' PANIC_SELL_REVERSAL ' };
  assert.equal(
    decideExitReasonUpdate(log, 'TAKE_PROFIT_HIT'),
    ' PANIC_SELL_REVERSAL '
  );
});
