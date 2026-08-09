import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AMIHUD_UNIT,
  amihudIlliquidity,
  amihudProfile,
  liquidationPressure
} from './microstructure.js';

test('Amihud is expressed as fractional absolute return per $1m turnover', () => {
  const value = amihudIlliquidity(
    [0.01, -0.02],
    [1_000_000, 2_000_000]
  );

  // 1% / $1m and 2% / $2m both equal 0.01 per $1m.
  assert.equal(value, 0.01);
  assert.equal(
    AMIHUD_UNIT,
    'fractional_abs_return_per_usd_1m_turnover'
  );
});

test('Amihud increases monotonically as quote turnover falls', () => {
  const liquid = amihudIlliquidity(
    [0.01, 0.01],
    [2_000_000, 2_000_000]
  );
  const illiquid = amihudIlliquidity(
    [0.01, 0.01],
    [500_000, 500_000]
  );

  assert.equal(liquid, 0.005);
  assert.equal(illiquid, 0.02);
  assert.ok(illiquid > liquid);
});

test('Amihud profile is neutral and not ready for missing or incomplete data', () => {
  assert.deepEqual(
    amihudProfile(null, null),
    {
      rank: 50,
      ready: false,
      referenceSize: 0,
      sampleSize: 0,
      unit: AMIHUD_UNIT,
      value: 0
    }
  );

  assert.equal(
    amihudProfile(
      [0.01, 0.01],
      [1_000_000, 1_000_000],
      { lookback: 2 }
    ).ready,
    false
  );

  assert.equal(
    amihudProfile(
      [0.01, 0.01, 0.01],
      [1_000_000, 0, 1_000_000],
      { lookback: 2 }
    ).rank,
    50
  );
});

test('Amihud profile uses a neutral mid-rank for tied history', () => {
  const profile = amihudProfile(
    [0.01, 0.01, 0.01, 0.01, 0.01],
    [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
    { lookback: 2, rankLookback: 10 }
  );

  assert.equal(profile.ready, true);
  assert.equal(profile.rank, 50);
  assert.equal(profile.sampleSize, 2);
  assert.equal(profile.referenceSize, 3);
  assert.equal(profile.value, 0.01);
});

test('Amihud profile ranks a current liquidity deterioration above history', () => {
  const profile = amihudProfile(
    [0.001, 0.001, 0.001, 0.001, 0.02],
    [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
    { lookback: 2, rankLookback: 10 }
  );

  assert.equal(profile.ready, true);
  assert.equal(profile.rank, 100);
});

test('liquidation pressure compares every timeframe with the same 15m turnover', () => {
  const inputs = [
    { avgQuoteVolumePerCandle: 1_000_000 / 3, interval: '5m' },
    { avgQuoteVolumePerCandle: 1_000_000, interval: '15m' },
    { avgQuoteVolumePerCandle: 4_000_000, interval: '1h' }
  ];

  for (const input of inputs) {
    const pressure = liquidationPressure({
      ...input,
      longLiquidationUsd: 100_000,
      shortLiquidationUsd: 25_000
    });

    assert.equal(pressure.ready, true);
    assert.ok(
      Math.abs(pressure.baselineQuoteVolumeUsd - 1_000_000) <
        1e-8
    );
    assert.ok(Math.abs(pressure.longFlushRatio - 0.1) < 1e-12);
    assert.ok(
      Math.abs(pressure.shortSqueezeRatio - 0.025) < 1e-12
    );
    assert.equal(pressure.imbalance, -0.6);
  }
});

test('liquidation imbalance is bounded and invalid baselines are not ready', () => {
  const oneSided = liquidationPressure({
    avgQuoteVolumePerCandle: 1,
    interval: '15m',
    shortLiquidationUsd: Number.MAX_VALUE
  });
  assert.equal(oneSided.imbalance, 1);

  const invalid = liquidationPressure({
    avgQuoteVolumePerCandle: 0,
    interval: '15m',
    longLiquidationUsd: 100
  });
  assert.deepEqual(invalid, {
    baselineQuoteVolumeUsd: 0,
    imbalance: 0,
    longFlushRatio: 0,
    ready: false,
    shortSqueezeRatio: 0,
    windowMs: 900_000
  });
});

test('liquidation pressure is zero and not ready without stream coverage', () => {
  const pressure = liquidationPressure({
    avgQuoteVolumePerCandle: 1_000_000,
    interval: '15m',
    longLiquidationUsd: 500_000,
    observationReady: false,
    shortLiquidationUsd: 250_000
  });

  assert.deepEqual(pressure, {
    baselineQuoteVolumeUsd: 0,
    imbalance: 0,
    longFlushRatio: 0,
    ready: false,
    shortSqueezeRatio: 0,
    windowMs: 900_000
  });
});
