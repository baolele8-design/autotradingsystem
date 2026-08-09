export const EMPTY_TRADE_STATS = {
  totalClosed: 0,
  winRate: 0,
  avgWinR: 0,
  avgLossR: 1,
  historicalRR: 0,
  hasEnoughData: false
};

export function calculateTradeStats(tradeLogs, symbol) {
  const closedTrades = tradeLogs.filter(
    trade =>
      ['WIN', 'LOSS', 'PARTIAL_CLOSED'].includes(trade.status) &&
      trade.symbol === symbol
  );

  let totalWinR = 0;
  let winCount = 0;
  let totalLossR = 0;
  let lossCount = 0;

  closedTrades.forEach(trade => {
    const rMultiple =
      (parseFloat(trade.pnl_usd) || 0) /
      (parseFloat(trade.risk_amount_usd) || 1);

    if (trade.pnl_usd > 0) {
      totalWinR += rMultiple;
      winCount++;
    }
    if (trade.pnl_usd <= 0 && trade.status === 'LOSS') {
      totalLossR += Math.abs(rMultiple);
      lossCount++;
    }
  });

  const avgWinR = winCount > 0 ? totalWinR / winCount : 0;
  const avgLossR = lossCount > 0 ? totalLossR / lossCount : 1;

  return {
    totalClosed: closedTrades.length,
    winRate: closedTrades.length > 0 ? winCount / closedTrades.length : 0,
    avgWinR,
    avgLossR,
    historicalRR: avgLossR > 0 ? avgWinR / avgLossR : 0,
    hasEnoughData: closedTrades.length >= 30
  };
}
