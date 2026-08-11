export const PORTFOLIO_TP_THRESHOLD = 15;
export const PORTFOLIO_TP_TOLERANCE = 0.1;

export function isEngineOwnedPosition(position, openTrades) {
  const amount = Number.parseFloat(position?.positionAmt);
  if (!Number.isFinite(amount) || amount === 0) return false;
  const direction = amount > 0 ? 'LONG' : 'SHORT';
  const positionSide = String(position?.positionSide || 'BOTH').toUpperCase();

  return openTrades.some(trade => {
    if (trade?.symbol !== position.symbol) return false;
    if (String(trade.status || '').toUpperCase() !== 'OPEN') return false;
    if (String(trade.direction || '').toUpperCase() !== direction) return false;
    if (positionSide === 'LONG' || positionSide === 'SHORT') {
      return positionSide === direction;
    }
    return true;
  });
}

export function computeGreenTotal(positions, openTrades) {
  if (!Array.isArray(positions) || !Array.isArray(openTrades)) {
    return { totalGreen: 0, candidates: [] };
  }

  const candidates = [];
  let totalGreen = 0;
  for (const position of positions) {
    const pnl = Number.parseFloat(position?.unrealizedProfit);
    if (!Number.isFinite(pnl) || pnl <= 0) continue;
    if (!isEngineOwnedPosition(position, openTrades)) continue;
    candidates.push({ symbol: position.symbol, pnl });
    totalGreen += pnl;
  }
  return { totalGreen, candidates };
}

export function shouldTriggerPortfolioTp(
  totalGreen,
  threshold = PORTFOLIO_TP_THRESHOLD
) {
  if (!Number.isFinite(totalGreen) || !Number.isFinite(threshold)) return false;
  return totalGreen >= threshold - PORTFOLIO_TP_TOLERANCE;
}
