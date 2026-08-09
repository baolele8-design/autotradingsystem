import test from 'node:test';
import assert from 'node:assert/strict';

import {
    calculateTrailingDecision,
    getTrailingPolicy
} from './trailingPolicy.js';

test('keeps every existing strategy threshold unchanged', () => {
    assert.deepEqual(getTrailingPolicy('LEAD-LAG', 'TIER 2'), {
        beTrigger: 0.35,
        lockTrigger: 0.8,
        lockAmount: 0.5,
        trailTrigger: 1.5,
        trailDist: 0.5
    });
    assert.deepEqual(getTrailingPolicy('GAMMA', 'TIER 2'), {
        beTrigger: 0.45,
        lockTrigger: 0.9,
        lockAmount: 0.5,
        trailTrigger: 1.6,
        trailDist: 0.55
    });
    assert.deepEqual(getTrailingPolicy('LIQ-FLUSH', 'TIER 2'), {
        beTrigger: 0.5,
        lockTrigger: 1,
        lockAmount: 0.5,
        trailTrigger: 1.8,
        trailDist: 0.7
    });
    assert.deepEqual(getTrailingPolicy('KINETIC', 'TIER 2'), {
        beTrigger: 0.6,
        lockTrigger: 1.2,
        lockAmount: 0.6,
        trailTrigger: 2,
        trailDist: 0.8
    });
    assert.deepEqual(getTrailingPolicy('SFP', 'TIER 2'), {
        beTrigger: 0.6,
        lockTrigger: 1.2,
        lockAmount: 0.6,
        trailTrigger: 2,
        trailDist: 0.8
    });
    assert.deepEqual(getTrailingPolicy('ADAPTIVE', 'TIER 2'), {
        beTrigger: 0.8,
        lockTrigger: 1.5,
        lockAmount: 0.8,
        trailTrigger: 2.5,
        trailDist: 1.2
    });
});

test('keeps tier adjustments unchanged', () => {
    assert.deepEqual(getTrailingPolicy('DEFAULT', 'TIER 4'), {
        beTrigger: 0.65,
        lockTrigger: 1.25,
        lockAmount: 0.5,
        trailTrigger: 2.35,
        trailDist: 1.3
    });
    assert.deepEqual(getTrailingPolicy('DEFAULT', 'TIER 3'), {
        beTrigger: 0.6,
        lockTrigger: 1.15,
        lockAmount: 0.5,
        trailTrigger: 2.2,
        trailDist: 1.15
    });
    assert.deepEqual(getTrailingPolicy('DEFAULT', 'TIER 1'), {
        beTrigger: 0.45,
        lockTrigger: 0.9,
        lockAmount: 0.5,
        trailTrigger: 1.85,
        trailDist: 0.9
    });
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
    assert.equal(lock.nextStage, 'LOCK');
    assert.equal(lock.targetSl, 102.5);

    const trail = calculateTrailingDecision({ ...common, markPrice: 110 });
    assert.equal(trail.nextStage, 'TRAIL');
    assert.equal(trail.targetSl, 105);
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
    assert.equal(decision.targetSl, 95);
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
    assert.equal(decision.targetSl, 107);
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
    assert.equal(decision.targetSl, 107);
});

