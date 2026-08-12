// FILE: src/core/TradeValidator.js

export const TradeValidator = {
  evaluateScore: (autoData, apiMacro, vectorDetails, direction, mvrvZScore, symbol, aiModel) => {
    if (!autoData || !apiMacro || !vectorDetails) return { score: 0, synergyText: "", penaltyText: "", checks: {}, checkScores: {}, w: {}, passingScore: 50 };
    
    const { l1, l2, l3, l4, l5, l6, sTrend, volScore, liqSeverity, posScore, momScore, macroScore } = vectorDetails;
    
    let totalScore;
    let synergyText = "";
    let penaltyText = "";

    // 1. TRỌNG SỐ TÍN HIỆU CỐ ĐỊNH
    // Optimizer không được thay đổi ngữ nghĩa tín hiệu. Nó chỉ được điều chỉnh
    // TP, SL và tHold trong đúng ô chiến thuật × tier.
    const w = Object.freeze({
      trend: 0.30,
      momentum: 0.25,
      positioning: 0.20,
      liquidity: 0.15,
      macro: 0.10
    });

    // 2. KHỚP HƯỚNG LỆNH VÀ TÍNH TRỌNG SỐ
    const dirMultiplier = direction === 'LONG' ? 1 : -1;

    // Lấy trọng số thực tế (Base Weights)
    const wTrend = w.trend;
    const wMom = w.momentum;
    const wPos = w.positioning;
    const wLiq = w.liquidity;
    const wMacro = w.macro;

    const sumWeights = wTrend + wMom + wPos + wLiq + wMacro;

    // 3. TÍNH ĐIỂM THÀNH PHẦN (RAW POINTS) - Đã xử lý Triệt tiêu mâu thuẫn Long/Short bằng dirMultiplier
    const trendPoints = (sTrend * dirMultiplier) * wTrend;
    const momPoints = (momScore * dirMultiplier) * wMom;
    const posPoints = (posScore * dirMultiplier) * wPos;
    const macroPoints = (macroScore * dirMultiplier) * wMacro;
    
    let liqPoints = 0;
    const isBullishLiq = l3.includes('Low') || l3.includes('Shorts Trapped');
    const isBearishLiq = l3.includes('High') || l3.includes('Longs Trapped');

    if (direction === 'LONG' && isBullishLiq) liqPoints = liqSeverity * wLiq;
    else if (direction === 'SHORT' && isBearishLiq) liqPoints = liqSeverity * wLiq;
    else if (direction === 'LONG' && isBearishLiq) liqPoints = -liqSeverity * wLiq;
    else if (direction === 'SHORT' && isBullishLiq) liqPoints = -liqSeverity * wLiq;
    
    // CHỈ CHIA CHO TRỌNG SỐ CÓ HOẠT ĐỘNG (DYNAMIC DENOMINATOR)
    let activeWeights = wTrend + wMom + wPos + wMacro;
    if (liqPoints !== 0) activeWeights += wLiq; 

    // 1. TÍNH RAW SCORE (-100 đến +100)
    const rawScore = (trendPoints + momPoints + posPoints + liqPoints + macroPoints) / activeWeights;

    // 2. CHUẨN HÓA SANG PHỔ ĐIỂM (SPECTRUM) [0 - 100] (50 là Neutral)
    const spectrumScore = (rawScore + 100) / 2;

    // =========================================================================
    // 🧠 TOÁN HỌC PHI TUYẾN TÍNH TRÊN PHỔ ĐIỂM [0-100]
    // =========================================================================
    let synergyMultiplier = 1.0;
    let penaltyMultiplier = 1.0;
    const isSfpAligned = (direction === 'LONG' && autoData.isBullishSFP) || (direction === 'SHORT' && autoData.isBearishSFP);
    
    // Kích hoạt MSB vào Hệ số Khuếch đại (Đưa vào thực chiến thay vì chỉ trưng bày)
    const isMsbAligned = (direction === 'LONG' && autoData.msbState === 'Bullish_MSB') || 
                         (direction === 'SHORT' && autoData.msbState === 'Bearish_MSB');

    const directedTrend = sTrend * dirMultiplier;
    const directedMomentum = momScore * dirMultiplier;
    const directedPositioning = posScore * dirMultiplier;
    const directedMacro = macroScore * dirMultiplier;

    if (isMsbAligned) { synergyMultiplier += 0.15; synergyText += "[🌊 MSB Đồng Pha] "; }
    if (directedTrend > 50 && directedMomentum > 50) { synergyMultiplier += 0.15; synergyText += "[🔥 Tàu Siêu Tốc] "; }
    if (liqPoints > 0 && liqSeverity > 80 && directedPositioning > 50) { synergyMultiplier += 0.20; synergyText += "[🐳 Cá Mập Quét Mồi] "; }
    if (l2 === 'Compression' && Math.abs(autoData.bbwSlope) > 5) { synergyMultiplier += 0.20; synergyText += "[🧨 Lò Xo Bung] "; }
    if (vectorDetails.isLeadLagArb) { synergyMultiplier += 0.25; synergyText += "[⚡ Lead-Lag Arb] "; }

    if (directedTrend < -20) {
        if (isSfpAligned) synergyText += "[🛡️ Bypass Phạt Trend nhờ SFP] ";
        else { penaltyMultiplier -= 0.20; penaltyText += "[-20% Ngược Trend] "; }
    }
    if (directedMomentum < -50) { penaltyMultiplier -= 0.30; penaltyText += "[-30% Mom Phân kỳ] "; }
    if (directedMacro < -50) { penaltyMultiplier -= 0.15; penaltyText += "[-15% Vĩ Mô Độc Hại] "; }

    const safePenalty = Math.max(0.1, penaltyMultiplier);
    
    // Áp dụng Synergy/Penalty lấy mốc 50 làm tâm
    if (spectrumScore >= 50) {
        totalScore = 50 + ((spectrumScore - 50) * synergyMultiplier * safePenalty);
    } else {
        totalScore = 50 - ((50 - spectrumScore) * (1 / synergyMultiplier) * (1 / safePenalty));
    }

    totalScore = Math.max(0, Math.min(100, totalScore)); // Kẹp chuẩn tuyệt đối 0-100
    
    // =========================================================================
    // ĐIỂM CHUẨN ĐỘNG THEO CHẾ ĐỘ THỊ TRƯỜNG & BIAS
    // =========================================================================
    let passingScore = 50; 
    
    if (l1.includes('Range') || l2 === 'Extreme') passingScore = 62; 
    else if (l2 === 'Compression') passingScore = 58; 

    if (direction === 'SHORT' && l6.includes('Tailwind')) passingScore += 5; 
    else if (direction === 'LONG' && l6.includes('Bleeding')) passingScore += 3; 

    // 4. BÓC TÁCH BOOLEAN VÀ CHUẨN HÓA ĐIỂM CÁC CỔNG GATES ĐỂ UI HIỂN THỊ KHỚP 100% TOÁN HỌC
    // Công thức đóng góp: Contribution = (Component / ActiveWeights) / 2
    const normalizeComponent = (val) => (val / activeWeights) / 2;

    const checks = {
        checkS1: trendPoints > 0,
        checkS2: autoData.cmf * dirMultiplier > 0,
        checkS3: liqPoints > 0,
        checkS4: momPoints > 0,
        checkS5: posPoints > 0,
        checkS6: (apiMacro.takerBuySellRatio < 1.0 && direction === 'LONG') || 
                 (apiMacro.takerBuySellRatio > 1.0 && direction === 'SHORT'),
        checkS7: l2 === 'Compression',
        checkS8: macroPoints > 0,
        checkMSB: isMsbAligned 
    };

    const checkScores = {
        s1: normalizeComponent(trendPoints),
        s2: 0, // Điều kiện Boolean, ko cộng điểm
        s3: liqPoints !== 0 ? normalizeComponent(liqPoints) : 0,
        s4: normalizeComponent(momPoints),
        s5: normalizeComponent(posPoints),
        s6: 0, // Điều kiện Boolean
        s7: 0, // Điều kiện Boolean
        s8: normalizeComponent(macroPoints),
        s_msb: 0 // Đã được chuyển vào Synergy Bonus ở trên
    };

    return { score: totalScore, synergyText, penaltyText, checks, checkScores, w, passingScore };
  },

  evaluateGates: (autoData, apiMacro, vectorDetails, mathCore, direction, tradeType, entry, slTech, systemScore, tradeLogs, symbol, strategy = '') => {
    const { l1, l2, l3, l5 } = vectorDetails;
    const { score, synergyText, penaltyText, checks, checkScores, passingScore } = systemScore;
    // B3 (TP1 ~1R): requiredRR hạ 2.0/1.8 → 0.8/0.7 — TP mới ~1R nên
    // yêu cầu R:R 1.8R sẽ chặn toàn bộ setup hợp lệ.
    const requiredRR = autoData.bbwRank > 80 ? 0.8 : 0.7;

    const recentLossSameDirection = tradeLogs && tradeLogs.some(log => 
        log.symbol === symbol && 
        log.direction === direction && 
        log.status === 'LOSS' &&
        (Date.now() - new Date(log.close_time).getTime()) < 2 * 60 * 60 * 1000 
    );

    const strategyId = typeof strategy === 'string'
      ? strategy
      : strategy?.strategyId || '';
    const policy = typeof strategy === 'object' && strategy
      ? strategy.policy || strategy.policies || {}
      : {};
    const rangeAllowed =
      policy.allowRange === true ||
      strategyId === 'VOLATILITY_EXTREME_FADE';
    const highVpinAllowed =
      policy.allowHighVpin === true ||
      strategyId === 'CAPITULATION_RECLAIM';
    const cvdDivergenceAllowed =
      policy.allowCvdDivergence === true ||
      strategyId === 'PASSIVE_ABSORPTION_REVERSAL' ||
      strategyId === 'CVD_STRUCTURE_DIVERGENCE';
    const requiresTrendPersistence =
      policy.requiresTrendPersistence === true ||
      strategyId === 'VOL_COMPRESSION_IGNITION' ||
      strategyId === 'LIQUIDITY_VACUUM_DRIVE' ||
      strategyId === 'FLOW_REACCELERATION';
    const requiresFreshLiquidation =
      policy.requiresFreshLiquidation === true ||
      strategyId === 'CAPITULATION_RECLAIM';

    const isVpinSafe =
      (autoData.vpinValue || 0) <= 0.10 ||
      highVpinAllowed;

    // ĐIỀU KIỆN 1: Đồng thuận CMF (Money Flow)
    const isCmfAligned = (direction === 'LONG' && autoData.cmf > 0) || (direction === 'SHORT' && autoData.cmf < 0);
    
    // ĐIỀU KIỆN 2: Chống mua đuổi (Overextended) - Đo khoảng cách từ Giá tới EMA20
    // Nếu giá chạy quá xa EMA20 (Lớn hơn 1.5 lần ATR) -> Không được FOMO
    const isOverextendedEMA20 = Math.abs(entry - autoData.ema20.value) > (autoData.atr14 * 1.5);

    const isMsbContradictory = (direction === 'LONG' && autoData.msbState === 'Bearish_MSB') || 
                               (direction === 'SHORT' && autoData.msbState === 'Bullish_MSB');

    const l1Str = String(l1 || "");
    const l3Str = String(l3 || "");
    const isRangeRegime =
      l1Str.includes('Range') ||
      l1Str.includes('Mean Reversion') ||
      l1Str.includes('Chop');
    const isVwapSafe = direction === 'LONG' 
        ? entry < autoData.vwapUpper // Không Long nếu giá đang lơ lửng ngoài biên trên VWAP
        : entry > autoData.vwapLower; // Không Short nếu giá đã rớt khỏi biên dưới VWAP
        
    const isCvdAligned =
      cvdDivergenceAllowed ||
      (direction === 'LONG'
        ? autoData.cvdTrend > -5
        : autoData.cvdTrend < 5);
    const liquidationAgeMs = autoData.liquidationUpdatedAt
      ? Date.now() - autoData.liquidationUpdatedAt
      : Number.POSITIVE_INFINITY;
    const hasFreshLiquidation =
      !requiresFreshLiquidation ||
      (
        autoData.liquidationReady === true &&
        autoData.liquidationCoverageReady === true &&
        autoData.liquidationStale !== true &&
        autoData.liqEventCount > 0 &&
        liquidationAgeMs <= (autoData.liquidationWindowMs || 15 * 60 * 1000)
      );
    // =========================================================================
    // HỆ THỐNG HARD GATES MỚI (BỨC TƯỜNG KỶ LUẬT THÉP)
    // =========================================================================
    // F4 (P6): diagnostic h2_realized — E[R] thực tế từ tradeLogs cùng hướng.
    // Informational: KHÔNG đổi isApproved (đợi benchmark sạch trước khi block).
    // E_R = WR×avgWinR − (1−WR)×avgLossR, avgWinR = 0.50, avgLossR = 0.62 (từ dữ liệu).
    const resolvedSameDirection = (tradeLogs || []).filter(log =>
      log.direction === direction &&
      (log.status === 'WIN' || log.status === 'LOSS')
    );
    let h2Realized = null;
    if (resolvedSameDirection.length >= 5) {
      const realizedWinCount = resolvedSameDirection.filter(
        log => log.status === 'WIN'
      ).length;
      const realizedWinRate =
        realizedWinCount / resolvedSameDirection.length;
      h2Realized =
        realizedWinRate * 0.5 - (1 - realizedWinRate) * 0.62;
    }

    const hardGates = [
      { id: 'h_cd', passed: !recentLossSameDirection, text: `COOLDOWN: Không nhồi lệnh cùng hướng ${direction} sau khi bị SL.` },
      { id: 'h_spot_short', passed: tradeType !== 'SPOT' || direction === 'LONG', text: `SPOT DIRECTION: Không thể mở vị thế SHORT trên Spot.` },
      { id: 'h1', passed: apiMacro.realSpreadPct < 0.3 && slTech > 0 && Math.abs(entry - slTech) > (autoData.atr14 * 0.4), text: `CHỐNG NHIỄU: Khoảng cách SL > 0.4 ATR` },
      { id: 'h2', passed: parseFloat(mathCore.trueEVValue) > -0.05 || parseFloat(mathCore.theoreticalRR) >= requiredRR, h2_realized: h2Realized, text: `KỲ VỌNG: R:R >= ${requiredRR} hoặc EV Dương` },
      { id: 'h4', passed: tradeType === 'SPOT' || (mathCore.liqEstimate && !mathCore.leverageExceedsExchangeCap && mathCore.liqSafetyMargin >= 1.3), text: `ĐỆM THANH LÝ: An toàn Margin` },
      { id: 'h6', passed: autoData.lastClosedVolume >= (autoData.avgVolume20 * 0.4), text: `VOL DEADZONE: Thanh khoản ổn định` },
      { id: 'h_msb', passed: !isMsbContradictory, text: `MARKET STRUCTURE: Cấm giao dịch khi cấu trúc MSB đảo chiều ngược hướng lệnh.` },
      
      // 🛡️ 4 LUẬT SINH TỒN MỚI TỪ INSIGHT DỮ LIỆU
      { id: 'h_vpin', passed: isVpinSafe, text: `TOXIC FLOW: Cấm giao dịch khi VPIN > 0.10, trừ chiến thuật có policy riêng.` },
      { id: 'h_range_block', passed: !isRangeRegime || rangeAllowed, text: `L1 RANGE BLOCK: Chỉ family mean-reversion được giao dịch trong Range.` },
      { id: 'h_liq_fresh', passed: hasFreshLiquidation, text: `LIQUIDATION FRESHNESS: Chiến thuật event chỉ dùng dữ liệu rolling 15 phút còn tươi.` },
      { id: 'h_cmf_breakout', passed: !(l3Str.includes('Break') && !isCmfAligned), text: `CMF BREAKOUT: Cấm đánh Breakout/Breakdown khi dòng tiền CMF không đồng thuận.` },
      { id: 'h_expansion_fomo', passed: !(l2 === 'Expansion' && isOverextendedEMA20), text: `FOMO FILTER: Cấm mua đuổi khi L2 Expansion và giá đã chạy quá xa EMA20 (>1.5 ATR).` },
      { id: 'h_vwap', passed: isVwapSafe, text: `VWAP GRAVITY: Tránh FOMO - Giá đã đi quá xa vùng Giá trị Trung bình của Khối lượng (VWAP Bands).` },
      { id: 'h_cvd', passed: isCvdAligned, text: `CVD DIVERGENCE: Khóa lệnh - Taker Flow (CVD) đang xả hàng chủ động ngược hướng phân tích.` },
      { id: 'h_hurst', passed: !(autoData.hurstValue < 0.4 && requiresTrendPersistence), text: `HURST EXPONENT: Thị trường Mean-Reverting, không phù hợp family momentum.` }
    ];

    // F5 (P7): soft gates chỉ còn telemetry hữu ích — s1 (93% true), s4 (90% true)
    // không loại được gì; s3 (2% true) chặn nhầm 98% lệnh hợp lệ; s5 NGHỊCH hướng
    // (pass −0.269R tệ hơn fail −0.079R). Bỏ khỏi DANH SÁCH hiển thị; checkS1..S5 +
    // checkScores vẫn tính ở evaluateScore vì s1..s5 đóng góp score components.
    const softGates = [
      { id: 's2', passed: checks.checkS2, weight: 1, text: `DÒNG TIỀN CMF BƠM THỰC`, score: checkScores?.s2 },
      { id: 's6', passed: checks.checkS6, weight: 1, text: `ĐI NGƯỢC ĐÁM ĐÔNG FOMO (CONTRARIAN)`, score: checkScores?.s6 },
      { id: 's7', passed: checks.checkS7, weight: 1, text: `NÉN DẢI BĂNG (SQUEEZE)`, score: checkScores?.s7 },
      { id: 's8', passed: checks.checkS8, weight: 1, text: `VĨ MÔ BẢO CHỨNG (MACRO ALIGNMENT)`, score: checkScores?.s8 },
      { id: 's_msb', passed: checks.checkMSB, weight: 1, text: `ĐỒNG PHA CẤU TRÚC MSB`, score: checkScores?.s_msb }
    ];

    if (synergyText) softGates.push({ id: 's_syn', passed: true, weight: 0, text: `🔥 SYNERGY BONUS: ${synergyText}` });
    if (penaltyText) softGates.push({ id: 's_pen', passed: false, weight: 0, text: `⚠️ MACRO PENALTY: ${penaltyText}` });

    const hardPassed = hardGates.every(g => g.passed);

    // KỶ LUẬT THÉP
    const isApproved = hardPassed && (score >= passingScore);
    
    return { 
        hardGates, 
        softGates, 
        softScore: score, 
        passingScore, 
        isApproved 
    };
  }
};
