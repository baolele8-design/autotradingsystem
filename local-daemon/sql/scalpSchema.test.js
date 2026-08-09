import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sqlDirectory = new URL('./', import.meta.url);

test('scalp schema preserves fractional BBW percentile ranks', async () => {
  const [baseSchema, ownershipMigration] = await Promise.all([
    readFile(new URL('scalp_trade_logs.sql', sqlDirectory), 'utf8'),
    readFile(
      new URL('scalp_execution_ownership.sql', sqlDirectory),
      'utf8'
    )
  ]);

  assert.match(baseSchema, /\bbbw_rank\s+NUMERIC\b/i);
  assert.match(
    ownershipMigration,
    /ALTER\s+COLUMN\s+bbw_rank\s+TYPE\s+NUMERIC/i
  );
});
