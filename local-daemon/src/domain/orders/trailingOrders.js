const OWNED_ALGO_PREFIX = 'qts-';

function hasClientAlgoId(order) {
    return String(
        order?.clientAlgoId ??
        order?.clientOrderId ??
        ''
    ).trim().length > 0;
}

function decimalPlaces(value) {
    const normalized = String(value).toLowerCase();
    if (normalized.includes('e-')) {
        return Number.parseInt(normalized.split('e-')[1], 10);
    }

    const withoutTrailingZeros = normalized
        .replace(/0+$/, '')
        .replace(/\.$/, '');
    return withoutTrailingZeros.includes('.')
        ? withoutTrailingZeros.split('.')[1].length
        : 0;
}

export function getBinanceOrderType(order) {
    return String(
        order?.orderType ??
        order?.origType ??
        order?.type ??
        ''
    ).toUpperCase();
}

export function isStopLossOrder(order) {
    const type = getBinanceOrderType(order);
    return type === 'STOP' || type === 'STOP_MARKET';
}

export function isTakeProfitOrder(order) {
    const type = getBinanceOrderType(order);
    return type === 'TAKE_PROFIT' || type === 'TAKE_PROFIT_MARKET';
}

export function getOrderTriggerPrice(order) {
    const value =
        order?.triggerPrice ??
        order?.stopPrice ??
        order?.slTriggerPrice;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function isOwnedAlgoOrder(order) {
    const clientId = String(
        order?.clientAlgoId ??
        order?.clientOrderId ??
        ''
    );
    return clientId.startsWith(OWNED_ALGO_PREFIX);
}

export function makeTradeOwnershipToken(tradeId) {
    return String(tradeId || 'legacy')
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(-20) || 'legacy';
}

export function makeClientAlgoId(tradeId, now = Date.now()) {
    const compactTradeId = makeTradeOwnershipToken(tradeId);
    return `${OWNED_ALGO_PREFIX}sl-${compactTradeId}-${now.toString(36)}`
        .slice(0, 36);
}

export function makeInitialClientAlgoId(kind, tradeId) {
    const normalizedKind = kind === 'tp' ? 'tp' : 'sl';
    return `${OWNED_ALGO_PREFIX}${normalizedKind}-${makeTradeOwnershipToken(tradeId)}`;
}

export function makeExitClientOrderId(kind, tradeId) {
    const normalizedKind =
        kind === 'temporal' ? 'time' :
        kind === 'portfolio-btc' ? 'pbtc' :
        kind === 'portfolio-tp' ? 'ptp' :
        'panic';
    return `${OWNED_ALGO_PREFIX}ex-${normalizedKind}-${makeTradeOwnershipToken(tradeId)}`
        .slice(0, 36);
}

export function isOrderOwnedByTrade(order, tradeId) {
    const clientId = String(
        order?.clientAlgoId ??
        order?.clientOrderId ??
        ''
    );
    const token = makeTradeOwnershipToken(tradeId);
    return (
        clientId === makeInitialClientAlgoId('sl', tradeId) ||
        clientId === makeInitialClientAlgoId('tp', tradeId) ||
        clientId.startsWith(`${OWNED_ALGO_PREFIX}sl-${token}-`)
    );
}

export function findPositionForTrade(positions, trade) {
    const direction = String(trade?.direction || '').toUpperCase();
    return positions.find(position => {
        if (position.symbol !== trade?.symbol) return false;
        const amount = Number.parseFloat(position.positionAmt);
        if (!Number.isFinite(amount) || amount === 0) return false;

        const positionSide = String(position.positionSide || 'BOTH').toUpperCase();
        if (positionSide === 'LONG' || positionSide === 'SHORT') {
            return positionSide === direction;
        }
        return direction === 'LONG' ? amount > 0 : amount < 0;
    });
}

export function makePositionReductionPayload(position, basePayload) {
    const positionSide = String(position?.positionSide || 'BOTH').toUpperCase();
    if (positionSide === 'LONG' || positionSide === 'SHORT') {
        const { reduceOnly, ...payloadWithoutReduceOnly } = basePayload;
        return {
            ...payloadWithoutReduceOnly,
            positionSide
        };
    }
    return {
        ...basePayload,
        reduceOnly: 'true'
    };
}

export function quantizeStopPrice(rawPrice, priceFilter, isLong) {
    const tickSize = Number.parseFloat(priceFilter?.tickSize);
    const minPrice = Number.parseFloat(priceFilter?.minPrice || 0);

    if (
        !Number.isFinite(rawPrice) ||
        rawPrice <= 0 ||
        !Number.isFinite(tickSize) ||
        tickSize <= 0 ||
        !Number.isFinite(minPrice)
    ) {
        throw new Error('Invalid price filter for stop quantization');
    }

    const precision = Math.max(
        decimalPlaces(priceFilter.tickSize),
        decimalPlaces(priceFilter.minPrice || 0)
    );
    const scale = 10 ** precision;
    const tickUnits = Math.round(tickSize * scale);
    const minUnits = Math.round(minPrice * scale);
    const rawUnits = rawPrice * scale;
    const relativeUnits = (rawUnits - minUnits) / tickUnits;
    const tickCount = isLong
        ? Math.floor(relativeUnits + 1e-9)
        : Math.ceil(relativeUnits - 1e-9);
    const quantizedUnits = minUnits + tickCount * tickUnits;
    const numericPrice = quantizedUnits / scale;

    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
        throw new Error('Quantized stop price is invalid');
    }

    return {
        numericPrice,
        formattedPrice: numericPrice.toFixed(precision),
        tickSize,
        precision
    };
}

export function isStrictlyBetterStop(candidate, current, tickSize, isLong) {
    if (
        !Number.isFinite(candidate) ||
        !Number.isFinite(current) ||
        !Number.isFinite(tickSize) ||
        tickSize <= 0
    ) {
        return false;
    }

    const tolerance = tickSize / 2;
    return isLong
        ? candidate - current >= tolerance
        : current - candidate >= tolerance;
}

export function isStopTriggerAdmissible(
    triggerPrice,
    markPrice,
    tickSize,
    isLong
) {
    if (
        !Number.isFinite(triggerPrice) ||
        !Number.isFinite(markPrice) ||
        !Number.isFinite(tickSize) ||
        triggerPrice <= 0 ||
        markPrice <= 0 ||
        tickSize <= 0
    ) {
        return false;
    }

    // STOP_MARKET closes a LONG with SELL below Mark Price and closes a SHORT
    // with BUY above Mark Price. Keep one full tick of separation so a target
    // that has already been crossed is rejected locally instead of sent to
    // Binance as an immediately-triggering order.
    return isLong
        ? triggerPrice <= markPrice - tickSize
        : triggerPrice >= markPrice + tickSize;
}

export function isSameTriggerPrice(order, expectedPrice, tickSize) {
    const actualPrice = getOrderTriggerPrice(order);
    if (
        actualPrice === null ||
        !Number.isFinite(expectedPrice) ||
        !Number.isFinite(tickSize)
    ) {
        return false;
    }
    return Math.abs(actualPrice - expectedPrice) < tickSize / 2;
}

export function selectReplaceableStopOrders({
    orders,
    symbol,
    exitSide,
    currentDbSl,
    tickSize,
    storedSlAlgoId
}) {
    const exactStops = orders.filter(order =>
        order?.symbol === symbol &&
        order?.side === exitSide &&
        isStopLossOrder(order)
    );
    const ownedStops = exactStops.filter(isOwnedAlgoOrder);

    // Legacy migration: only adopt one genuinely untagged stop if it matches
    // the SL currently recorded for this trade. A non-engine client ID is
    // explicit ownership metadata and must remain foreign.
    const legacyMatches = exactStops.filter(order =>
        !isOwnedAlgoOrder(order) &&
        !hasClientAlgoId(order) &&
        isSameTriggerPrice(order, currentDbSl, tickSize)
    );

    // Adopt the initial SL by its persisted Binance algoId (stored at entry time).
    const algoIdMatch = exactStops.find(order =>
        !isOwnedAlgoOrder(order) &&
        storedSlAlgoId != null &&
        String(order.algoId) === String(storedSlAlgoId)
    );

    return [
        ...ownedStops,
        ...(legacyMatches.length === 1 ? legacyMatches : []),
        ...(algoIdMatch &&
            !ownedStops.includes(algoIdMatch) &&
            !legacyMatches.includes(algoIdMatch) ? [algoIdMatch] : [])
    ];
}

export async function replaceStopSafely({
    existingStops,
    existingReplacement = null,
    createAndVerify,
    cancelOld,
    isSameOrder
}) {
    const verifiedReplacement =
        existingReplacement || await createAndVerify();

    if (!verifiedReplacement) {
        throw new Error('Replacement stop was not verified');
    }

    for (const oldStop of existingStops) {
        if (isSameOrder(oldStop, verifiedReplacement)) continue;
        await cancelOld(oldStop);
    }

    return verifiedReplacement;
}

export { OWNED_ALGO_PREFIX };
