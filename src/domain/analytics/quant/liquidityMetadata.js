import { AMIHUD_UNIT } from './microstructure.js';

export const LIQUIDITY_FEATURE_SCHEMA_VERSION = 3;
export const LIQUIDATION_SOURCE =
  'binance_usdm_all_market_force_order_snapshot_1s';
export const LIQUIDATION_NOTIONAL_UNIT =
  'quote_asset_notional_usd_equivalent';
export const LIQUIDATION_COMPLETENESS = 'observed_lower_bound';
export const LIQUIDATION_PRESSURE_UNIT =
  'observed_liquidation_notional_per_expected_quote_turnover';

export const LIQUIDITY_FEATURE_VERSION_TAG =
  'feature-v3.amihud-fracret-usd1m.liq-binance-usdm-fo1s-quoteusd-lowerbound';

const LEDGER_MARKER = ' | LM3:';

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundedOrNull(value, digits = 8) {
  const numeric = finiteOrNull(value);
  if (numeric === null) return null;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

export function createLiquidityFeatureMetadata(data = {}) {
  return {
    schemaVersion: LIQUIDITY_FEATURE_SCHEMA_VERSION,
    amihud: {
      rank: finiteOrNull(data.amihudRank),
      ready: data.amihudReady === true,
      unit: data.amihudUnit || AMIHUD_UNIT
    },
    liquidation: {
      completeness:
        data.liquidationCompleteness ||
        LIQUIDATION_COMPLETENESS,
      coverageMs: finiteOrNull(data.liquidationCoverageMs),
      coverageReady:
        data.liquidationCoverageReady === true,
      imbalance: finiteOrNull(data.liqImbalance),
      longRatio: finiteOrNull(data.liqLongRatio),
      notionalUnit:
        data.liquidationNotionalUnit ||
        LIQUIDATION_NOTIONAL_UNIT,
      observedLowerBound:
        data.liquidationObservedLowerBound !== false,
      pressureUnit:
        data.liquidationPressureUnit ||
        LIQUIDATION_PRESSURE_UNIT,
      ready: data.liquidationReady === true,
      shortRatio: finiteOrNull(data.liqShortRatio),
      source: data.liquidationSource || LIQUIDATION_SOURCE,
      windowMs: finiteOrNull(data.liquidationWindowMs)
    }
  };
}

/**
 * Keep the optimizer-facing strategy version stable while making the feature
 * semantics independently identifiable in historical rows.
 */
export function withLiquidityFeatureVersion(version = '') {
  const tokens = String(version)
    .split('|')
    .map(token =>
      token
        .trim()
        .replace(/-liquidity-v\d+/gi, '')
    )
    .filter(Boolean)
    .filter(token =>
      !/^liquidity-v\d+$/i.test(token) &&
      !/^feature-v\d+(?:[.-].*)?$/i.test(token)
    );
  return [...tokens, LIQUIDITY_FEATURE_VERSION_TAG].join('|');
}

/**
 * `trade_logs` has no discovered JSON feature column. Persist the dynamic
 * rank/ratio snapshot in the existing, otherwise presentation-only L3 text
 * column. Unit/source/completeness are encoded by the stable version tag.
 */
export function encodeLiquidityLedgerEvent(label, data = {}) {
  const baseLabel = String(label || 'Quiet')
    .split(LEDGER_MARKER)[0]
    .trim()
    .slice(0, 80) || 'Quiet';
  const metadata = createLiquidityFeatureMetadata(data);
  const compact = {
    v: LIQUIDITY_FEATURE_SCHEMA_VERSION,
    ar: roundedOrNull(metadata.amihud.rank, 2),
    ao: metadata.amihud.ready ? 1 : 0,
    lr: roundedOrNull(metadata.liquidation.longRatio),
    sr: roundedOrNull(metadata.liquidation.shortRatio),
    li: roundedOrNull(metadata.liquidation.imbalance),
    lo: metadata.liquidation.ready ? 1 : 0,
    cr: metadata.liquidation.coverageReady ? 1 : 0
  };
  return `${baseLabel}${LEDGER_MARKER}${JSON.stringify(compact)}`;
}

export function decodeLiquidityLedgerEvent(value) {
  const text = String(value || '');
  const markerIndex = text.lastIndexOf(LEDGER_MARKER);
  if (markerIndex < 0) {
    return {
      label: text,
      metadata: null
    };
  }

  const label = text.slice(0, markerIndex);
  try {
    return {
      label,
      metadata: JSON.parse(
        text.slice(markerIndex + LEDGER_MARKER.length)
      )
    };
  } catch {
    return {
      label: text,
      metadata: null
    };
  }
}
