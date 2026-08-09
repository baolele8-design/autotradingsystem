import QuantMath from '../../../domain/analytics/QuantMath.js';

export async function runQuantumCouncilAnalysis(context) {
  const {
    geminiCooldown,
    autoData,
    mathCore,
    vectorRegime,
    setIsAnalyzing,
    setChiefDecision,
    setCouncilReports,
    symbol,
    intervalTime,
    apiMacro,
    tradeSetup,
    mvrvZScore,
    logicGates,
    tradeStats,
    tradeLogs,
    tickSizes,
    setTradeSetup,
    showToast,
    setGeminiCooldown
  } = context;
    if (geminiCooldown > 0 || !autoData || !mathCore || !vectorRegime) return;
    setIsAnalyzing(true); 
    setChiefDecision(null);
    setCouncilReports([]);

    // Tự động phân loại tài sản để định hình chiến thuật tại Backend
    const activeTierClass = QuantMath.classifyAssetTier(
          symbol, 
          autoData.usdVolume24h || 0,
          apiMacro.realSpreadPct
      );

    // Context KHÔNG GÁN CỨNG - Hoàn toàn bảo toàn thông số gốc
    const rawSystemContext = `[DỮ LIỆU THỜI GIAN THỰC]
- TÀI SẢN: ${symbol} (${activeTierClass}) | KHUNG: ${intervalTime} | PHIÊN: ${apiMacro.tradingSession}
- SETUP: ${tradeSetup.tradeType} ${tradeSetup.direction} | Entry: $${tradeSetup.entry} | SL: $${tradeSetup.slTech} | TP1: $${tradeSetup.tp1}
- DỮ LIỆU VI CẤU TRÚC: VPIN=${autoData.vpinValue?.toFixed(4) || '0'}, OBI=${(autoData.obi*100).toFixed(1)}%, Taker Buy/Sell=${apiMacro.takerBuySellRatio.toFixed(2)}, Real Spread=${apiMacro.realSpreadPct.toFixed(4)}%
- DỮ LIỆU THỐNG KÊ & VĨ MÔ: MVRV-Z=${mvrvZScore}, ATR Rank=P${autoData.atrRank.toFixed(0)}, BBW Rank=P${autoData.bbwRank.toFixed(0)}, Gia tốc BBW=${autoData.bbwSlope.toFixed(2)}%, FGI=${apiMacro.fgiValue}, BTC Dom=${autoData.btcDomValue.toFixed(1)}% (Slope: ${autoData.btcDomSlope?.toFixed(2)}%), OI Delta=${autoData.oiDelta?.toFixed(2)}%
- CẤU TRÚC & HÀNH VI GIÁ: Price=$${autoData.currentPrice}, HTF SMA200=$${autoData.htfSma200?.toFixed(4)}, EMA20 Slope=${autoData.ema20.slope.toFixed(2)}%, EMA50 Slope=${autoData.ema50.slope.toFixed(2)}%, EMA200 Slope=${autoData.ema200.slope.toFixed(2)}%, ADX=${autoData.adx.toFixed(1)}, RSI=${autoData.rsi.toFixed(1)}, CMF=${autoData.cmf.toFixed(2)}
- SỰ KIỆN THANH KHOẢN: Bullish SFP=${autoData.isBullishSFP}, Bearish SFP=${autoData.isBearishSFP}, OBV BearDiv=${autoData.isObvBearDivergence}, OBV BullDiv=${autoData.isObvBullDivergence}
- TOÁN HỌC RỦI RO & MA SÁT: Size=$${mathCore.positionSizeUSD} (Risk: ${mathCore.appliedRiskPercent}%), Đòn bẩy=${mathCore.suggestedLeverage}x, Liq Margin=${mathCore.liqSafetyMargin ? (mathCore.liqSafetyMargin*100).toFixed(0)+'%' : 'N/A'}, R:R=1:${mathCore.theoreticalRR}, True EV=${mathCore.trueEVValue}R, Kelly=${mathCore.kellyPct}%
- TRẠNG THÁI GATES: ${logicGates.isApproved ? "PASS (Cho phép)" : "BLOCK (Nguy hiểm)"} | Điểm Mềm=${logicGates.softScore}/10.0
- LỊCH SỬ BAYESIAN: Winrate ${(tradeStats.winRate * 100).toFixed(1)}% | R:R trung bình: ${tradeStats.historicalRR.toFixed(2)} | Tổng lệnh đã đóng: ${tradeStats.totalClosed}`;

    try {
      // Đẩy toàn bộ tác vụ tính toán MAE/MFE và gọi 9 luồng LLM xuống Backend
      const res = await fetch('/api/quantum-council', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              rawSystemContext,
              tradeLogs, // Truyền trực tiếp logs cho Backend tự xử lý Kế toán Lượng tử
              activeTierClass,
              tradeSetup
          })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Daemon API từ chối phản hồi.');

      setCouncilReports(data.councilReports);
      setChiefDecision(data.chiefDecision); // Chief Decision trả về JSON Object

      // WALK-FORWARD OPTIMIZATION: Tự động ghi đè thông số
      if (data.chiefDecision && data.chiefDecision.optimized_params) {
          const params = data.chiefDecision.optimized_params;
          
          // Tính toán lại Entry, SL, TP từ hệ số Multiplier AI đưa ra
          const suggestedEntry = autoData.currentPrice;
          let calculatedSL, calculatedTP;

          if (tradeSetup.direction === 'LONG') {
             calculatedSL = suggestedEntry - (params.suggested_slMult * autoData.atr14);
             calculatedTP = suggestedEntry + (params.suggested_tpMult * autoData.atr14);
          } else {
             calculatedSL = suggestedEntry + (params.suggested_slMult * autoData.atr14);
             calculatedTP = suggestedEntry - (params.suggested_tpMult * autoData.atr14);
          }

          const tick = tickSizes[symbol] || 0.0001;
          const tickStr = parseFloat(tick).toString();
          const precision = tickStr.includes('e-') ? parseInt(tickStr.split('e-')[1]) : (tickStr.includes('.') ? tickStr.split('.')[1].length : 4);

          // CẬP NHẬT TRỰC TIẾP VÀO FORM UI
          setTradeSetup(prev => ({
             ...prev,
             riskPercent: params.suggested_risk_pct,
             slTech: Number(calculatedSL.toFixed(precision)),
             tp1: Number(calculatedTP.toFixed(precision)),
             activeStrategy: data.chiefDecision.suggested_strategy || prev.activeStrategy
          }));

          showToast(`⚙️ Đã nạp thông số Thích nghi từ AI: Risk ${params.suggested_risk_pct}%, SL ${params.suggested_slMult}x ATR`);
      }

      setGeminiCooldown(15); 
    } catch (error) {
      showToast(`❌ Lỗi Hệ thống AI: ${error.message}`); 
      setGeminiCooldown(30);
    }
    setIsAnalyzing(false);
  };
