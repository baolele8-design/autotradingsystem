import test from 'node:test';
import assert from 'node:assert/strict';

import {
    findPositionForTrade,
    getBinanceOrderType,
    isOwnedAlgoOrder,
    isOrderOwnedByTrade,
    isStopLossOrder,
    isTakeProfitOrder,
    isStrictlyBetterStop,
    makeClientAlgoId,
    makeExitClientOrderId,
    makeInitialClientAlgoId,
    makePositionReductionPayload,
    quantizeStopPrice,
    replaceStopSafely,
    selectReplaceableStopOrders
} from './trailingOrders.js';

const algoTp = {
    algoId: 10,
    algoType: 'CONDITIONAL',
    orderType: 'TAKE_PROFIT_MARKET',
    symbol: 'BTCUSDT',
    side: 'SELL',
    triggerPrice: '120.0',
    clientAlgoId: 'qts-tp-entry'
};

const algoSl = {
    algoId: 11,
    algoType: 'CONDITIONAL',
    orderType: 'STOP_MARKET',
    symbol: 'BTCUSDT',
    side: 'SELL',
    triggerPrice: '95.0',
    clientAlgoId: 'qts-sl-entry'
};

test('uses orderType instead of generic algoType for Binance algo orders', () => {
    assert.equal(getBinanceOrderType(algoTp), 'TAKE_PROFIT_MARKET');
    assert.equal(isTakeProfitOrder(algoTp), true);
    assert.equal(isStopLossOrder(algoTp), false);
    assert.equal(isStopLossOrder(algoSl), true);
});

test('never selects take-profit for stop replacement', () => {
    const selected = selectReplaceableStopOrders({
        orders: [algoTp, algoSl],
        symbol: 'BTCUSDT',
        exitSide: 'SELL',
        currentDbSl: 95,
        tickSize: 0.1
    });

    assert.deepEqual(selected, [algoSl]);
});

test('does not adopt an unrelated manual stop', () => {
    const manualStop = {
        algoId: 12,
        algoType: 'CONDITIONAL',
        orderType: 'STOP_MARKET',
        symbol: 'BTCUSDT',
        side: 'SELL',
        triggerPrice: '96.0',
        clientAlgoId: 'manual-stop'
    };
    const selected = selectReplaceableStopOrders({
        orders: [manualStop],
        symbol: 'BTCUSDT',
        exitSide: 'SELL',
        currentDbSl: 95,
        tickSize: 0.1
    });

    assert.deepEqual(selected, []);
});

test('does not adopt a manual stop even when its trigger matches the DB stop', () => {
    const manualStop = {
        algoId: 14,
        algoType: 'CONDITIONAL',
        orderType: 'STOP_MARKET',
        symbol: 'BTCUSDT',
        side: 'SELL',
        triggerPrice: '95.0',
        clientAlgoId: 'manual-stop'
    };
    const selected = selectReplaceableStopOrders({
        orders: [manualStop],
        symbol: 'BTCUSDT',
        exitSide: 'SELL',
        currentDbSl: 95,
        tickSize: 0.1
    });

    assert.deepEqual(selected, []);
});

test('adopts exactly one legacy stop only when it matches the DB stop', () => {
    const legacyStop = {
        algoId: 13,
        algoType: 'CONDITIONAL',
        orderType: 'STOP_MARKET',
        symbol: 'BTCUSDT',
        side: 'SELL',
        triggerPrice: '95.0'
    };
    const selected = selectReplaceableStopOrders({
        orders: [legacyStop, algoTp],
        symbol: 'BTCUSDT',
        exitSide: 'SELL',
        currentDbSl: 95,
        tickSize: 0.1
    });

    assert.deepEqual(selected, [legacyStop]);
});

test('quantizes long stops down and short stops up to a non-decimal tick', () => {
    const filter = { minPrice: '0.00', tickSize: '0.05' };
    assert.deepEqual(quantizeStopPrice(100.129, filter, true), {
        numericPrice: 100.1,
        formattedPrice: '100.10',
        tickSize: 0.05,
        precision: 2
    });
    assert.deepEqual(quantizeStopPrice(100.121, filter, false), {
        numericPrice: 100.15,
        formattedPrice: '100.15',
        tickSize: 0.05,
        precision: 2
    });
});

test('does not churn an order until the stop improves by at least one tick', () => {
    assert.equal(isStrictlyBetterStop(100.1, 100.1, 0.1, true), false);
    assert.equal(isStrictlyBetterStop(100.19, 100.1, 0.1, true), true);
    assert.equal(isStrictlyBetterStop(99.9, 100, 0.1, false), true);
});

test('creates owned client IDs that comply with Binance length limit', () => {
    const trailingId = makeClientAlgoId(
        '62bf63c8-dcc1-4f90-a2ea-123456789012',
        1_750_000_000_000
    );
    const initialId = makeInitialClientAlgoId(
        'tp',
        '62bf63c8dcc14f90a2ea123456789012'
    );

    assert.equal(isOwnedAlgoOrder({ clientAlgoId: trailingId }), true);
    assert.equal(isOwnedAlgoOrder({ clientAlgoId: initialId }), true);
    assert.ok(trailingId.length <= 36);
    assert.ok(initialId.length <= 36);
});

test('creates deterministic initial IDs owned by one trade', () => {
    const first = makeInitialClientAlgoId(
        'sl',
        '62bf63c8-dcc1-4f90-a2ea-123456789012'
    );
    const repeated = makeInitialClientAlgoId(
        'sl',
        '62bf63c8-dcc1-4f90-a2ea-123456789012'
    );
    const second = makeInitialClientAlgoId(
        'sl',
        '62bf63c8-dcc1-4f90-a2ea-999999999999'
    );

    assert.equal(first, repeated);
    assert.notEqual(first, second);
    assert.equal(isOwnedAlgoOrder({ clientAlgoId: first }), true);
    assert.equal(
        isOrderOwnedByTrade(
            { clientAlgoId: first },
            '62bf63c8-dcc1-4f90-a2ea-123456789012'
        ),
        true
    );
    assert.equal(
        isOrderOwnedByTrade(
            { clientAlgoId: first },
            '62bf63c8-dcc1-4f90-a2ea-999999999999'
        ),
        false
    );
    assert.ok(first.length <= 36);
});

test('creates deterministic owned IDs for forced lifecycle exits', () => {
    const panic = makeExitClientOrderId('panic', 'trade-123');
    const temporal = makeExitClientOrderId('temporal', 'trade-123');

    assert.equal(panic, makeExitClientOrderId('panic', 'trade-123'));
    assert.notEqual(panic, temporal);
    assert.equal(isOwnedAlgoOrder({ clientOrderId: panic }), true);
    assert.equal(isOwnedAlgoOrder({ clientOrderId: temporal }), true);
    assert.ok(panic.length <= 36);
    assert.ok(temporal.length <= 36);
});

test('selects the correct position side in Hedge Mode', () => {
    const positions = [
        {
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            positionAmt: '0.1'
        },
        {
            symbol: 'BTCUSDT',
            positionSide: 'SHORT',
            positionAmt: '-0.2'
        }
    ];

    assert.equal(
        findPositionForTrade(positions, {
            symbol: 'BTCUSDT',
            direction: 'SHORT'
        }),
        positions[1]
    );
});

test('uses positionSide without reduceOnly in Hedge Mode', () => {
    const payload = makePositionReductionPayload(
        { positionSide: 'LONG' },
        {
            symbol: 'BTCUSDT',
            side: 'SELL',
            quantity: 0.1,
            reduceOnly: 'true'
        }
    );

    assert.equal(payload.positionSide, 'LONG');
    assert.equal('reduceOnly' in payload, false);
});

test('uses reduceOnly in One-way Mode', () => {
    const payload = makePositionReductionPayload(
        { positionSide: 'BOTH' },
        {
            symbol: 'BTCUSDT',
            side: 'SELL',
            quantity: 0.1
        }
    );

    assert.equal(payload.reduceOnly, 'true');
    assert.equal('positionSide' in payload, false);
});

test('verifies the replacement before cancelling the old stop', async () => {
    const events = [];
    const oldStop = { algoId: 1 };
    const newStop = { algoId: 2 };

    await replaceStopSafely({
        existingStops: [oldStop],
        createAndVerify: async () => {
            events.push('create');
            events.push('verify');
            return newStop;
        },
        isSameOrder: (left, right) => left.algoId === right.algoId,
        cancelOld: async () => events.push('cancel-old')
    });

    assert.deepEqual(events, ['create', 'verify', 'cancel-old']);
});

test('never cancels the old stop when replacement verification fails', async () => {
    const events = [];

    await assert.rejects(
        replaceStopSafely({
            existingStops: [{ algoId: 1 }],
            createAndVerify: async () => {
                events.push('create');
                events.push('verify-failed');
                return null;
            },
            isSameOrder: (left, right) => left.algoId === right.algoId,
            cancelOld: async () => events.push('cancel-old')
        }),
        /not verified/
    );

    assert.deepEqual(events, ['create', 'verify-failed']);
});
