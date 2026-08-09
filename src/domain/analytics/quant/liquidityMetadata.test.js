import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIQUIDATION_COMPLETENESS,
  LIQUIDATION_NOTIONAL_UNIT,
  LIQUIDATION_SOURCE,
  LIQUIDITY_FEATURE_SCHEMA_VERSION,
  LIQUIDITY_FEATURE_VERSION_TAG,
  createLiquidityFeatureMetadata,
  decodeLiquidityLedgerEvent,
  encodeLiquidityLedgerEvent,
  withLiquidityFeatureVersion
} from './liquidityMetadata.js';

const featureData = {
  amihudRank: 87.125,
  amihudReady: true,
  liqImbalance: -0.333333333,
  liqLongRatio: 0.123456789,
  liqShortRatio: 0.061728394,
  liquidationCoverageMs: 900_000,
  liquidationCoverageReady: true,
  liquidationReady: true,
  liquidationWindowMs: 900_000
};

test('builds explicit unit, source and coverage metadata', () => {
  const metadata = createLiquidityFeatureMetadata(featureData);

  assert.equal(
    metadata.schemaVersion,
    LIQUIDITY_FEATURE_SCHEMA_VERSION
  );
  assert.equal(
    metadata.liquidation.notionalUnit,
    LIQUIDATION_NOTIONAL_UNIT
  );
  assert.equal(metadata.liquidation.source, LIQUIDATION_SOURCE);
  assert.equal(
    metadata.liquidation.completeness,
    LIQUIDATION_COMPLETENESS
  );
  assert.equal(metadata.liquidation.observedLowerBound, true);
  assert.equal(metadata.liquidation.coverageReady, true);
});

test('strategy version replaces legacy liquidity tags idempotently', () => {
  const first = withLiquidityFeatureVersion(
    'v1.4|router-v1|liquidity-v2'
  );
  const second = withLiquidityFeatureVersion(first);

  assert.equal(first, second);
  assert.match(first, new RegExp(`${LIQUIDITY_FEATURE_VERSION_TAG}$`));
  assert.doesNotMatch(first, /liquidity-v2/);

  const legacyBot = withLiquidityFeatureVersion(
    'strategy-router-v1-liquidity-v2-auto'
  );
  assert.match(legacyBot, /^strategy-router-v1-auto\|/);
  assert.doesNotMatch(legacyBot, /liquidity-v2/);
});

test('ledger envelope preserves label and dynamic rank/ratios', () => {
  const encoded = encodeLiquidityLedgerEvent(
    'Institutional Sweep Low (Flush)',
    featureData
  );
  const decoded = decodeLiquidityLedgerEvent(encoded);

  assert.equal(decoded.label, 'Institutional Sweep Low (Flush)');
  assert.deepEqual(decoded.metadata, {
    v: 3,
    ar: 87.13,
    ao: 1,
    lr: 0.12345679,
    sr: 0.06172839,
    li: -0.33333333,
    lo: 1,
    cr: 1
  });
  assert.ok(encoded.length < 255);
});
