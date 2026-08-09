export function selectPaperSimulationSetups(scannedTopSetups, limit = 10) {
    const setups = Array.isArray(scannedTopSetups)
        ? scannedTopSetups
        : [];
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
    const isPaperOnly = setup =>
        setup?.rolloutMode === 'PAPER_ONLY' ||
        setup?.executionMode === 'PAPER_ONLY';
    return [
        ...setups.filter(isPaperOnly),
        ...setups.filter(setup => !isPaperOnly(setup))
    ].slice(0, safeLimit);
}

export async function createTopPaperTrades(context) {
  const {
    scannedTopSetups,
    showToast,
    liveCapital,
    tradeSetup,
    supabase
  } = context;
    if (!scannedTopSetups || scannedTopSetups.length === 0 || scannedTopSetups[0].isEmpty) {
        showToast("⚠️ Không có Setup hợp lệ trên Radar để đánh ảo!");
        return;
    }
    
    showToast("⏳ Đang tính toán ma trận và bắn 10 lệnh ảo vào Paper Ledger...");

    // Ưu tiên thu thập bằng chứng cho các chiến thuật shadow mới. Adaptive
    // vẫn có thể được mô phỏng khi danh sách PAPER_ONLY chưa đủ 10 lệnh.
    const top10 = selectPaperSimulationSetups(scannedTopSetups, 10);
    const simulatedCapital = liveCapital > 0 ? liveCapital : 1000; // Cấp vốn ảo 1000$ nếu chưa có
    
    const paperLogs = top10.map(setup => {
        const entryPrice = parseFloat(setup.entry);
        const slPrice = parseFloat(setup.slTech);
        const tpPrice = parseFloat(setup.tp1);
        
        const riskDiff = Math.abs(entryPrice - slPrice);
        const riskAmount = simulatedCapital * (tradeSetup.riskPercent / 100);
        
        // Tính Size cơ bản
        const sizeUsd = riskDiff > 0 ? (riskAmount / (riskDiff / entryPrice)) : 0;

        return {
            symbol: setup.symbol,
            interval: setup.interval,
            type: 'FUTURES',
            direction: setup.direction,
            entry: entryPrice,
            sl: slPrice,
            tp_1_price: tpPrice,
            risk_amount_usd: riskAmount,
            position_size_usd: sizeUsd,
            rr: parseFloat(setup.theoreticalRR),
            status: 'OPEN', // Lệnh ảo mặc định Khớp để dễ track
            strategy_name: setup.strategyId || 'ADAPTIVE_LONG_FALLBACK',
            capital_at_entry_usd: simulatedCapital,
            asset_tier: setup.assetTier,
            applied_risk_pct: tradeSetup.riskPercent,
            holding_cycles: setup.tHold || 1,
            pnl_usd: 0
        };
    });

    try {
        const { error } = await supabase.from('paper_trade_logs').insert(paperLogs);
        if (error) throw error;
        showToast(`✅ Đã phóng thành công ${paperLogs.length} lệnh vào Vũ Trụ Ảo!`);
    } catch (err) {
        showToast(`❌ Lỗi ghi sổ Ảo: ${err.message}`);
    }
  };
