import test from 'node:test';
import assert from 'node:assert/strict';

import {
    calculateTrailingDecision,
    getTrailingPolicy
} from './trailingPolicy.js';

const UNIFIED = {
    beTrigger: 0.35,
    lockTrigger: 0.6,
    lockAmount: 0.35,
    trailTrigger: 1.0,
    trailDist: 0.5
};

test('uses the unified schedule for every strategy (directive 2026-08-07)', () => {
    assert.deepEqual(getTrailingPolicy('LEAD-LAG', 'TIER 2'), UNIFIED);
    assert.deepEqual(getTrailingPolicy('GAMMA', 'TIER 2'), UNIFIED);
    assert.deepEqual(getTrailingPolicy('LIQ-FLUSH', 'TIER 2'), UNIFIED);
    assert.deepEqual(getTrailingPolicy('KINETIC', 'TIER 2'), UNIFIED);
    assert.deepEqual(getTrailingPolicy('SFP', 'TIER 2'), UNIFIED);
    assert.deepEqual(getTrailingPolicy('ADAPTIVE', 'TIER 2'), UNIFIED);
});

test('uses the same schedule for every asset tier', () => {
    assert.deepEqual(getTrailingPolicy('DEFAULT', 'TIER 4'), UNIFIED);
    assert.deepEqual(getTrailingPolicy('DEFAULT', 'TIER 3'), UNIFIED);
    assert.deepEqual(getTrailingPolicy('DEFAULT', 'TIER 1'), UNIFIED);
});

test('moves a long trade through BE, LOCK and TRAIL using immutable R', () => {
    const common = {
        entryPrice: 100,
        currentSl: 95,
        initialRiskPerCoin: 5,
        direction: 'LONG',
        storedHighWater: 100
    };

    const be = calculateTrailingDecision({ ...common, markPrice: 102.5 });
    assert.equal(be.nextStage, 'BE');
    assert.equal(be.targetSl, 100.25);

    const lock = calculateTrailingDecision({ ...common, markPrice: 105 });
    assert.equal(lock.nextStage, 'TRAIL');
    assert.equal(lock.targetSl, 102.5);

    const trail = calculateTrailingDecision({ ...common, markPrice: 110 });
    assert.equal(trail.nextStage, 'TRAIL');
    assert.equal(trail.targetSl, 107.5);
});

test('mirrors stop calculations for short trades', () => {
    const decision = calculateTrailingDecision({
        entryPrice: 100,
        currentSl: 105,
        markPrice: 90,
        initialRiskPerCoin: 5,
        direction: 'SHORT',
        storedHighWater: 100
    });

    assert.equal(decision.nextStage, 'TRAIL');
    assert.equal(decision.highWaterPrice, 90);
    assert.equal(decision.targetSl, 92.5);
});

test('never regresses a previously achieved stage after a retracement', () => {
    const decision = calculateTrailingDecision({
        entryPrice: 100,
        currentSl: 105,
        markPrice: 104,
        initialRiskPerCoin: 5,
        direction: 'LONG',
        storedHighWater: 112,
        protectionStage: 'TRAIL'
    });

    assert.equal(decision.currentProfitR, 0.8);
    assert.equal(decision.nextStage, 'TRAIL');
    assert.equal(decision.targetSl, 109.5);
});

test('recovers TRAIL from persisted high-water even if current price retraced', () => {
    const decision = calculateTrailingDecision({
        entryPrice: 100,
        currentSl: 102.5,
        markPrice: 107.5,
        initialRiskPerCoin: 5,
        direction: 'LONG',
        storedHighWater: 112,
        protectionStage: 'LOCK'
    });

    assert.equal(decision.currentProfitR, 1.5);
    assert.equal(decision.highWaterR, 2.4);
    assert.equal(decision.nextStage, 'TRAIL');
    assert.equal(decision.targetSl, 109.5);
});

