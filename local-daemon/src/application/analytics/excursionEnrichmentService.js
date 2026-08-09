import {
  calculateDirectionalExcursions
} from '../../domain/analytics/excursionMetrics.js';
import {
  buildExcursionPath
} from '../../domain/analytics/excursionPath.js';

const ONE_MINUTE_MS = 60_000;
const MAX_KLINES_PER_REQUEST = 1_500;
export const LIFECYCLE_METRIC_VERSION = 'binance-1m-lifecycle-path/v2';

const finitePositive = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getLifecycleGeometry = trade => {
  const openedAt = Date.parse(trade?.opened_at || '');
  const closeTime = Date.parse(trade?.close_time || '');
  const entry = finitePositive(trade?.entry);
  const positionSizeUsd = finitePositive(trade?.position_size_usd);
  const direction = String(trade?.direction || '').toUpperCase();
  if (
    !Number.isFinite(openedAt) ||
    !Number.isFinite(closeTime) ||
    closeTime <= openedAt ||
    entry === null ||
    positionSizeUsd === null ||
    !['LONG', 'SHORT'].includes(direction)
  ) {
    return null;
  }

  const startTime = Math.ceil(openedAt / ONE_MINUTE_MS) *
    ONE_MINUTE_MS;
  const endTime = Math.floor(closeTime / ONE_MINUTE_MS) *
    ONE_MINUTE_MS;
  if (endTime <= startTime) return null;

  return {
    direction,
    endTime,
    entry,
    quantity: positionSizeUsd / entry,
    startTime
  };
};

const buildKlineUrl = ({ endTime, startTime, symbol }) =>
  'https://fapi.binance.com/fapi/v1/klines?' +
  new URLSearchParams({
    symbol,
    interval: '1m',
    startTime: String(startTime),
    endTime: String(endTime),
    limit: String(MAX_KLINES_PER_REQUEST)
  });

export function createExcursionEnrichmentService(context) {
  const {
    batchSize = 3,
    maxKlineRequestsPerRun = 12,
    safeFetch,
    supabase
  } = context;
  let activeRun = null;

  async function fetchLifecycleCandles(trade, geometry, requestBudget) {
    const candles = [];
    let cursor = geometry.startTime;
    while (
      cursor < geometry.endTime &&
      requestBudget.used < maxKlineRequestsPerRun
    ) {
      requestBudget.used += 1;
      const batch = await safeFetch(buildKlineUrl({
        endTime: geometry.endTime,
        startTime: cursor,
        symbol: trade.symbol
      }));
      if (!Array.isArray(batch) || batch.length === 0) break;

      const complete = batch.filter(candle => {
        const openTime = Number(candle?.[0]);
        return (
          Number.isFinite(openTime) &&
          openTime >= geometry.startTime &&
          openTime < geometry.endTime
        );
      });
      candles.push(...complete);

      const lastOpenTime = Number(batch.at(-1)?.[0]);
      const nextCursor = lastOpenTime + ONE_MINUTE_MS;
      if (!Number.isFinite(nextCursor) || nextCursor <= cursor) break;
      cursor = nextCursor;
      if (batch.length < MAX_KLINES_PER_REQUEST) break;
    }
    const expectedCandles =
      (geometry.endTime - geometry.startTime) / ONE_MINUTE_MS;
    const uniqueCandles = new Map(
      candles.map(candle => [Number(candle?.[0]), candle])
    );
    return uniqueCandles.size === expectedCandles
      ? [...uniqueCandles.values()].sort(
          (left, right) => Number(left[0]) - Number(right[0])
        )
      : null;
  }

  async function executeExcursionEnrichment() {
    const report = {
      enriched: 0,
      errors: 0,
      requestedKlines: 0,
      skipped: 0,
      status: 'COMPLETED'
    };
    const requestBudget = { used: 0 };

    try {
      const { data: trades, error } = await supabase
        .from('trade_logs')
        .select(
          'id, symbol, direction, entry, position_size_usd, opened_at, ' +
          'close_time, max_favorable_excursion_usd, ' +
          'max_adverse_excursion_usd, initial_risk_per_coin, metric_version'
        )
        .in('status', ['WIN', 'LOSS'])
        .or(
          `metric_version.is.null,metric_version.neq.${LIFECYCLE_METRIC_VERSION}`
        )
        .not('opened_at', 'is', null)
        .not('close_time', 'is', null)
        .order('close_time', { ascending: true })
        .limit(batchSize);
      if (error) throw error;

      for (const trade of trades || []) {
        const geometry = getLifecycleGeometry(trade);
        if (!geometry) {
          report.skipped += 1;
          continue;
        }
        try {
          const candles = await fetchLifecycleCandles(
            trade,
            geometry,
            requestBudget
          );
          const excursion = calculateDirectionalExcursions({
            anchorPrice: geometry.entry,
            candles,
            direction: geometry.direction,
            quantity: geometry.quantity
          });
          if (!excursion) {
            report.skipped += 1;
            continue;
          }

          const excursionPath = buildExcursionPath({
            anchorPrice: geometry.entry,
            candles,
            direction: geometry.direction,
            initialRiskPerCoin: trade.initial_risk_per_coin
          });

          const { error: updateError } = await supabase
            .from('trade_logs')
            .update({
              max_adverse_excursion_usd: excursion.adverseUsd,
              max_favorable_excursion_usd: excursion.favorableUsd,
              ...(excursionPath === null
                ? {}
                : { excursion_path: excursionPath }),
              metric_version: LIFECYCLE_METRIC_VERSION
            })
            .eq('id', trade.id);
          if (updateError) throw updateError;
          report.enriched += 1;
        } catch (error) {
          report.errors += 1;
          console.error(
            `[EXCURSION ENRICHMENT] ${trade.symbol} row=${trade.id}:`,
            error.message
          );
        }
      }
      report.requestedKlines = requestBudget.used;
      return report;
    } catch (error) {
      console.error('[EXCURSION ENRICHMENT]', error.message);
      return {
        ...report,
        requestedKlines: requestBudget.used,
        status: 'FAILED'
      };
    }
  }

  function runExcursionEnrichment() {
    if (activeRun) return activeRun;
    activeRun = executeExcursionEnrichment()
      .finally(() => {
        activeRun = null;
      });
    return activeRun;
  }

  return { runExcursionEnrichment };
}
