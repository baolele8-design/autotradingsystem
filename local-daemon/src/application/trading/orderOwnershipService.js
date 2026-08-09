import {
  makeInitialClientAlgoId
} from '../../domain/orders/trailingOrders.js';

function getCancellationReference(log, kind) {
  const algoId = kind === 'sl' ? log?.sl_algo_id : log?.tp_algo_id;
  if (algoId !== undefined && algoId !== null && algoId !== '') {
    return { algoId };
  }
  if (!log?.id) return null;
  return { clientAlgoId: makeInitialClientAlgoId(kind, log.id) };
}

function normalizeBinanceError(error) {
  return {
    code:
      error?.response?.data?.code ??
      error?.code ??
      'UNKNOWN',
    message:
      error?.response?.data?.msg ??
      error?.message ??
      String(error)
  };
}

export async function cancelTradeAlgoOrders({ log, sendBinanceReq }) {
  const result = { cancelled: [], failed: [] };
  if (typeof sendBinanceReq !== 'function' || !log?.symbol) {
    return result;
  }

  for (const kind of ['sl', 'tp']) {
    const reference = getCancellationReference(log, kind);
    if (!reference) continue;

    try {
      await sendBinanceReq('DELETE', '/fapi/v1/algoOrder', {
        symbol: log.symbol,
        ...reference
      });
      result.cancelled.push({ kind, ...reference });
    } catch (error) {
      result.failed.push({
        kind,
        ...reference,
        ...normalizeBinanceError(error)
      });
    }
  }

  return result;
}
