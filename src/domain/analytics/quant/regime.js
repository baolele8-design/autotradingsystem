export const evaluateL1 = autoData => {
  // ĐÃ SỬA: Lấy cvdTrend thay vì các biến OBV lỗi thời
  const {
    currentPrice,
    ema20,
    ema50,
    ema200,
    htfSma200,
    atrPercent,
    macd,
    adx,
    hurstValue,
    cvdTrend
  } = autoData;

  // 🏛️ CỤM A: Định Vị Không Gian (Structural Alignment) - Max 100
  const vsHtf = currentPrice > htfSma200 ? 40 : -40;
  let emaAlign = 0;
  if (ema20.value > ema50.value && ema50.value > ema200.value) emaAlign = 60;else if (ema20.value < ema50.value && ema50.value < ema200.value) emaAlign = -60;else if (ema20.value > ema50.value) emaAlign = 30;else if (ema20.value < ema50.value) emaAlign = -30;
  const cA = vsHtf + emaAlign;

  // 🚀 CỤM B: Động Năng & Gia Tốc (Velocity & Trajectory) - Max 100
  const normSlope20 = atrPercent > 0 ? ema20.slope / atrPercent : 0;
  let cB;
  if (normSlope20 > 0.1 && macd.hist > 0) cB = 100; // Tăng tốc đồng thuận
  else if (normSlope20 < -0.1 && macd.hist < 0) cB = -100; // Rơi tự do
  else if (normSlope20 > 0.1 && macd.hist <= 0) cB = 20; // Bò lên nhưng kiệt sức (Divergence rủi ro)
  else if (normSlope20 < -0.1 && macd.hist >= 0) cB = -20; // Rớt nhưng hãm phanh
  else cB = normSlope20 > 0 ? 10 : -10;

  // ⚖️ CỤM C: Bằng Chứng Dòng Tiền TAKER CHỦ ĐỘNG (Conviction Multiplier)
  const k_adx = Math.max(0.1, Math.min(1.5, adx / 25));
  let k_cvd = 1.0;

  // Phân kỳ CVD: Giá cấu trúc tăng (cA > 0) nhưng dòng tiền Taker xả ngầm (cvdTrend < -5)
  // Giá cấu trúc giảm (cA < 0) nhưng Taker gom ngầm (cvdTrend > 5)
  if (cA > 0 && cvdTrend < -5 || cA < 0 && cvdTrend > 5) {
    k_cvd = -0.5; // Chặn đứng hệ thống, triệt tiêu sTrend
  }
  let sTrend = (cA * 0.55 + cB * 0.45) * (k_adx * k_cvd);

  // 🎲 ÁP DỤNG HURST EXPONENT (Lượng tử hóa Độ nhiễu)
  let l1;
  if (hurstValue < 0.45) {
    // Thị trường Random Walk / Mean-reverting. Bóp nát sTrend.
    sTrend *= 0.5;
    l1 = "Chop / Mean Reversion";
  } else if (sTrend >= 75 && hurstValue > 0.6) l1 = "Strong Trend Up";else if (sTrend >= 30) l1 = "Trend Up";else if (sTrend <= -75 && hurstValue > 0.6) l1 = "Strong Trend Down";else if (sTrend <= -30) l1 = "Trend Down";else l1 = "Range";
  return {
    l1,
    sTrend,
    cA,
    cB,
    k_adx,
    k_cvd,
    hurstValue
  }; // Trả về k_cvd để các tầng sau có thể Tracking
};

export const evaluateL2 = autoData => {
  const {
    atrRank,
    bbwRank,
    bbwSlope,
    lastClosedVolume,
    avgVolume20
  } = autoData;

  // 1. Chỉ số Biến động Không gian (Spatial Vol Score: 0 - 100)
  // Tỷ trọng: Bollinger Bands (60%) quan trọng hơn ATR (40%) trong việc tìm Điểm Nén
  const volScore = atrRank * 0.4 + bbwRank * 0.6;

  // 2. Gia tốc Biến động (Volatility Trajectory)
  const isBandsExpanding = bbwSlope > 5; // Dải băng đang mở toác > 5%
  const isBandsContracting = bbwSlope < -2; // Dải băng đang thắt chặt lại

  // 3. Khối lượng xác nhận (Volume Validation)
  const volRatio =
    avgVolume20 > 0
      ? lastClosedVolume / avgVolume20
      : 1;
  const isVolSpiking = volRatio > 1.5;

  // 4. Phân loại L2 bằng sự hội tụ của 3 Cụm
  let l2;

  // Đang Nén (Squeeze): Điểm nén tổng thể cực thấp HOẶC đang ở vùng thấp mà còn thắt chặt thêm
  if (volScore < 20 || bbwRank < 25 && isBandsContracting) {
    l2 = "Compression";
  }
  // Cực Đại (Extreme): Nguy cơ đảo chiều Mean Reversion rất cao
  else if (volScore > 85) {
    l2 = "Extreme";
  }
  // Nổ Biến Động (Expansion): Đang nén nhưng BBW dốc ngược lên VÀ có Volume bơm vào
  else if (volScore >= 20 && volScore <= 85 && isBandsExpanding && isVolSpiking) {
    l2 = "Expansion";
  }
  // Trạng thái bình thường
  else {
    l2 = "Normal";
  }
  return {
    l2,
    volScore,
    isBandsExpanding,
    isBandsContracting,
    volRatio
  };
};

export const evaluateL3 = (autoData, l1, l2) => {
  const {
    isBullishSFP,
    isBearishSFP,
    avgVolume20,
    fundingSlope,
    vpinValue,
    obi,
    currentPrice,
    ema20,
    lastClosedVolume // 🚀 ĐÃ VÁ: Bổ sung lastClosedVolume
  } = autoData;

  // 1. CỤM A: Bẫy Cấu Trúc (Vol Spike hạ threshold xuống 2.0x để nhạy hơn với bẫy)
  const volRatio = avgVolume20 > 0 ? lastClosedVolume / avgVolume20 : 1;
  const isVolSpike = volRatio > 2.0;

  // 2. CỤM B: Bằng Chứng Vi Cấu Trúc & Dòng Lệnh
  const isToxic = (vpinValue || 0) >= 0.10;
  const isObiBullish = obi > 0.65; // Tường Limit Buy cực dày chặn dưới
  const isObiBearish = obi < 0.35; // Tường Limit Sell cực dày đè trên

  // 3. CỤM C: Áp Lực Phái Sinh (Kết hợp điều kiện từ L1)
  const isFundingSqueezeLongs =
    fundingSlope > 0.02 &&
    l1.includes("Range");
  const isFundingSqueezeShorts =
    fundingSlope < -0.02 &&
    l1.includes("Range");
  // Liquidation and quote turnover share a 15m basis. Snapshot-derived events
  // remain fail-closed until the stream has continuous full-window coverage.
  const liquidationUsable =
    autoData.liquidationReady === true &&
    autoData.liquidationCoverageReady === true &&
    autoData.liquidationStale !== true;
  const isShortSqueeze =
    liquidationUsable &&
    (autoData.liqShortRatio || 0) >= 0.10;
  const isLongFlush =
    liquidationUsable &&
    (autoData.liqLongRatio || 0) >= 0.10;

  let l3 = "Quiet";
  let liqSeverity = 0;

  // QUÉT THANH KHOẢN (SWEEP) KẾT HỢP DỮ LIỆU CHÁY TÀI KHOẢN THỰC
  if (isBullishSFP || isLongFlush) {
    if (isObiBullish || isToxic) {
      l3 = "Institutional Sweep Low (Flush)";
      liqSeverity = 100;
    } else {
      l3 = "Sweep Low";
      liqSeverity = 70;
    }
  } else if (isBearishSFP || isShortSqueeze) {
    if (isObiBearish || isToxic) {
      l3 = "Institutional Sweep High (Squeeze)";
      liqSeverity = 100;
    } else {
      l3 = "Sweep High";
      liqSeverity = 70;
    }
  }

  // ƯU TIÊN 2: BẪY PHÁI SINH (SQUEEZE)
  else if (isFundingSqueezeLongs) {
    l3 = "Longs Trapped (Squeeze)";
    liqSeverity = isToxic ? 90 : 70; // Nếu dính thêm thao túng dòng lệnh -> Rất tàn khốc
  } else if (isFundingSqueezeShorts) {
    l3 = "Shorts Trapped (Squeeze)";
    liqSeverity = isToxic ? 90 : 70;
  }

  // ƯU TIÊN 3: ĐỘT PHÁ & ĐIỂM CHẶN (BREAKOUT & CLIMAX)
  else if (isVolSpike) {
    const priceUp = currentPrice > ema20.value;
    if (l2 === "Expansion") {
      // Valid Chéo L2: Breakout cần Dải băng mở rộng (L2 Expansion) VÀ Sổ lệnh (OBI) không được chặn ngược chiều
      if (priceUp && !isObiBearish) {
        l3 = "Valid Breakout";
        liqSeverity = 80;
      } else if (!priceUp && !isObiBullish) {
        l3 = "Valid Breakdown";
        liqSeverity = 80;
      } else {
        l3 = "Fakeout (Blocked by OBI)";
        liqSeverity = 50;
      } // Breakout giả vì đâm vào Tường Sổ Lệnh
    } else {
      // Vol nổ lớn nhưng dải băng (L2) không mở toác -> Báo hiệu sự chốt lời hàng loạt / Stop hunt
      l3 = "Stop Hunt / Climax";
      liqSeverity = 85;
    }
  }
  return {
    l3,
    liqSeverity,
    isToxic,
    volRatio
  };
};

export const evaluateL4 = (autoData, apiMacro) => {
  const {
    currentPrice,
    ema20,
    oiDelta,
    atrRank,
    lastClosedVolume,
    avgVolume20
  } = autoData;
  const {
    takerBuySellRatio,
    lsPositionVolRatio
  } = apiMacro;

  // 1. CỤM A: Động lượng Hợp đồng mở (OI Dynamics)
  const isOiSurging = oiDelta > 1.5;
  const isOiDropping = oiDelta < -1.5;

  // 2. CỤM B: Sự đồng thuận Giá (Price-OI Alignment)
  const isPriceUp = currentPrice > ema20.value;

  // 3. CỤM C: Dấu chân Cá mập (Smart Money Footprint)
  const isTakerBuying = takerBuySellRatio > 1.05;
  const isTakerSelling = takerBuySellRatio < 0.95;
  const isTopTraderLong = lsPositionVolRatio > 1.05;
  const isTopTraderShort = lsPositionVolRatio < 0.95;
  let l4 = "Neutral";
  let posScore = 0; // Điểm định vị: -100 (Max Bearish) tới +100 (Max Bullish)

  // KIỂM DUYỆT CHÉO (CROSS-VALIDATION) VỊ THẾ DÒNG TIỀN
  if (isOiSurging) {
    if (isPriceUp) {
      // Kịch bản: Bơm tiền + Giá tăng (Xây Long)
      if (isTakerBuying && isTopTraderLong) {
        l4 = "Smart Money Long Building";
        posScore = 100;
      } else if (!isTakerBuying && isTopTraderShort) {
        // Đám đông mua Taker fomo, Cá mập đang đè Limit Sell
        l4 = "Retail Long Building (Trap Risk)";
        posScore = -50;
      } else {
        l4 = "Mixed Long Building";
        posScore = 30;
      }
    } else {
      // Kịch bản: Bơm tiền + Giá giảm (Xây Short)
      if (isTakerSelling && isTopTraderShort) {
        l4 = "Smart Money Short Building";
        posScore = -100;
      } else if (!isTakerSelling && isTopTraderLong) {
        // Đám đông bán fomo, Cá mập đang hứng Limit Buy
        l4 = "Retail Short Building (Trap Risk)";
        posScore = 50;
      } else {
        l4 = "Mixed Short Building";
        posScore = -30;
      }
    }
  } else if (isOiDropping) {
    if (isPriceUp) {
      // Tiền rút + Giá Tăng = Bọn Short hoảng loạn phải mua lại
      l4 = "Short Covering (Squeeze)";
      posScore = 40; // Lực nảy không bền vì tiền thực đang rút
    } else {
      // Tiền rút + Giá Giảm = Bọn Long hoảng loạn bị thanh lý
      l4 = "Long Liquidation (Flush)";
      posScore = -40;
    }
  }

  // ƯU TIÊN TUYỆT ĐỐI: SỰ KIỆN ĐẦU HÀNG (CAPITULATION OVERRIDE)
  const isVolSpike = lastClosedVolume > avgVolume20 * 2.5;
  if (isVolSpike && isOiDropping && atrRank > 90) {
    // Nổ Volume + OI bốc hơi + Biến động biên độ cực đại -> Sự kiện Đầu hàng
    if (isPriceUp) {
      l4 = "Short Capitulation / Blow-off Top";
      posScore = -80; // Bọn short cháy sạch đẩy giá vọt lên đỉnh, chuẩn bị đảo chiều Rớt
    } else {
      l4 = "Long Capitulation / Flush Bottom";
      posScore = 80; // Bọn long cháy sạch đẩy giá chọc gậy đáy, chuẩn bị đảo chiều Tăng
    }
  }
  return {
    l4,
    posScore,
    isOiSurging,
    isOiDropping,
    isTakerBuying,
    isTakerSelling
  };
};

export const evaluateL5 = autoData => {
  // ĐÃ SỬA: Lấy cvdTrend, currentPrice và htfSma200 thay cho OBV
  const {
    rsi,
    cmf,
    adx,
    cvdTrend,
    currentPrice,
    htfSma200
  } = autoData;

  // 1. CỤM A: Động lượng Giá cơ sở (Raw Price Momentum)
  let baseMom = (rsi - 50) * 5;
  baseMom = Math.max(-100, Math.min(100, baseMom));

  // 2. CỤM B: Sự Đồng Thuận Dòng Tiền (Money Flow Validation)
  let flowMultiplier = 1.0;
  let isTrap = false;
  if (baseMom > 20 && cmf < -0.05) {
    // Rủi ro Bull Trap: Giá kéo RSI lên vùng Bullish nhưng dòng tiền rút (Phân kỳ CMF)
    flowMultiplier = -0.5;
    isTrap = true;
  } else if (baseMom < -20 && cmf > 0.05) {
    // Rủi ro Bear Trap: Giá đạp RSI xuống vùng Bearish nhưng cá mập đang hứng hàng (CMF dương)
    flowMultiplier = -0.5;
    isTrap = true;
  }

  // 3. CỤM C: Bộ khuếch đại Trend (ADX Trend Filter)
  let trendMultiplier = 1.0;
  if (adx < 20) trendMultiplier = 0.5;else if (adx > 30) trendMultiplier = 1.2;

  // KẾT TOÁN ĐIỂM SỐ RÒNG (Net Momentum Score)
  let momScore = baseMom * flowMultiplier * trendMultiplier;
  momScore = Math.max(-100, Math.min(100, momScore));

  // DÁN NHÃN VÀ PHÂN LOẠI L5
  let l5 = "Weak / Mixed";

  // Mức 1 (Tối Cáo): Rạn nứt cấu trúc Khối lượng Taker (CVD Divergence)
  // Giá nằm trên SMA200 (Uptrend) nhưng dòng lệnh Taker chủ động xả ngập mặt (cvdTrend < -10)
  if (cvdTrend < -10 && currentPrice > htfSma200) {
    l5 = "Severe Divergence (CVD Bearish)";
  }
  // Giá nằm dưới SMA200 (Downtrend) nhưng dòng lệnh Taker chủ động mua gom (cvdTrend > 10)
  else if (cvdTrend > 10 && currentPrice < htfSma200) {
    l5 = "Severe Divergence (CVD Bullish)";
  }

  // Mức 2: Bẫy Động Lượng Tiền (RSI & CMF Mismatch)
  else if (isTrap) {
    l5 = baseMom > 0 ? "Fake Momentum (Bull Trap)" : "Fake Momentum (Bear Trap)";
  }

  // Mức 3: Kiệt Sức Đàn Hồi - Dây chun căng tối đa (Exhaustion)
  else if (rsi >= 75) l5 = "Overbought Exhaustion";else if (rsi <= 25) l5 = "Oversold Exhaustion";

  // Mức 4: Động Lượng Chân Chính (Đã được Dòng tiền và ADX bảo chứng)
  else if (momScore >= 60) l5 = "Strong Bullish";else if (momScore <= -60) l5 = "Strong Bearish";else if (momScore >= 20) l5 = "Moderate Bullish";else if (momScore <= -20) l5 = "Moderate Bearish";
  return {
    l5,
    momScore,
    baseMom,
    isTrap
  };
};

export const evaluateL6 = (autoData, mvrvZScore, symbol) => {
  const {
    btcDomValue,
    btcDomSlope,
    isi,
    amihudRank,
    amihudReady
  } = autoData;
  const isAltcoin = symbol !== 'BTCUSDT';

  // 1. CỤM A: Định Giá Vĩ Mô (Macro Valuation)
  let mvrvDesc;
  let valScore; // -100 (Bong bóng) tới +100 (Tích lũy)
  if (mvrvZScore > 3.5) {
    mvrvDesc = "Bong bóng";
    valScore = -100;
  } else if (mvrvZScore >= 2.5) {
    mvrvDesc = "Định giá cao";
    valScore = -50;
  } else if (mvrvZScore >= 1.0) {
    mvrvDesc = "Bình thường - Khá cao";
    valScore = -10;
  } else if (mvrvZScore >= 0.8) {
    mvrvDesc = "Bình thường - Rẻ";
    valScore = 50;
  } else {
    mvrvDesc = "Vùng tích lũy";
    valScore = 100;
  }

  // 2. CỤM B: Trọng Lực Dòng Vốn (Capital Gravity)
  let isAltcoinBleeding = false;
  let isAltcoinSeason = false;
  let domScore; // Điểm âm = Tiền rút khỏi Altcoin, Điểm dương = Tiền bơm vào Altcoin

  if (isAltcoin) {
    if (btcDomValue > 50 && btcDomSlope > 0.3) {
      isAltcoinBleeding = true;
      domScore = -100; // Tiền bị hút sạch về BTC
    } else if (btcDomSlope < -0.5) {
      isAltcoinSeason = true;
      domScore = 100; // Tiền chảy lan tỏa sang Altcoin
    } else {
      domScore = btcDomSlope < 0 ? 30 : -30;
    }
  } else {
    // Nếu đang đánh trực tiếp cặp BTCUSDT, Dom tăng là có lợi cho lệnh Long BTC
    domScore = btcDomSlope > 0 ? 50 : -50;
  }

  // 3. CỤM C: Ma Sát Thông Tin (Lead-Lag Friction / Arbitrage)
  let isLeadLagArb = false;
  let lagScore = 0;

  // Amihud v2 is a percentile signal; absolute v1 thresholds are invalid.
  const hasTradableLiquidity =
    amihudReady === true &&
    Number.isFinite(amihudRank) &&
    amihudRank <= 70;
  if (isAltcoin && isi < -0.10 && Math.abs(btcDomSlope) > 0.2 && hasTradableLiquidity) {
    isLeadLagArb = true;
    lagScore = 100; // Cơ hội Arbitrage thông tin hoàn hảo (Khả năng Win cực cao)
  } else if (isi > 0.5) {
    lagScore = -20; // Quá đồng pha với BTC, không có lợi thế thông tin
  }

  // TỔNG HỢP MACRO SCORE
  const macroScore = valScore * 0.40 + domScore * 0.35 + lagScore * 0.25;

  // PHÂN LOẠI L6 (Chuẩn hóa nhãn để HUD hiển thị gọn gàng)
  let l6 = "Fair Value";
  if (mvrvZScore > 2.5) l6 = "Overvaluation Risk";else if (mvrvZScore < 1.0) l6 = "Accumulation Zone";
  if (isAltcoinBleeding) l6 += " | Bleeding (Danger)";else if (isAltcoinSeason) l6 += " | Alt Season (Tailwind)";
  if (isLeadLagArb) l6 += " | ⚡ Lead-Lag Arb";
  return {
    l6,
    macroScore,
    mvrvDesc,
    isAltcoinBleeding,
    isAltcoinSeason,
    isLeadLagArb
  };
};

export const evaluateVectorState = (autoData, apiMacro, mvrvZScore, symbol) => {
  // L1: Cấu trúc & Động năng
  const l1Data = evaluateL1(autoData);
  let l1 = l1Data.l1;

  // L2: Độ Biến Động & Nén
  const l2Data = evaluateL2(autoData);
  let l2 = l2Data.l2;

  // L3: Sự kiện Thanh khoản & Bẫy (Đã xác nhận chéo bằng Vi Cấu Trúc)
  const l3Data = evaluateL3(autoData, l1, l2);
  let l3 = l3Data.l3;

  // L4: Định vị Dòng tiền & Smart Money Footprint
  const l4Data = evaluateL4(autoData, apiMacro);
  let l4 = l4Data.l4;

  // L5: Động lượng Giá & Dòng Tiền (Dùng Multiplier và Phân kỳ)
  const l5Data = evaluateL5(autoData);
  let l5 = l5Data.l5;

  // L6: Định giá Vĩ mô & Ma sát Lead-Lag (MỚI TÍCH HỢP)
  const l6Data = evaluateL6(autoData, mvrvZScore, symbol);
  let l6 = l6Data.l6;

  // GHI ĐÈ BẢO VỆ RỦI RO CUỐI CÙNG LÊN L1
  // Nếu Vĩ mô là Altcoin Bleeding mà L1 lại báo Trend Up -> Cắm cờ Fake Trend
  if (l6Data.isAltcoinBleeding && l1.includes('Trend Up')) {
    l1 = l1 + " (Fake - Bleeding)";
  }
  // Nếu đang trong Range nhưng L2 báo Squeeze (Nén) -> Cảnh báo
  if (l1.includes('Range') && l2 === 'Compression') {
    l1 = "Range (Squeeze Imminent)";
  }
  return {
    vector: [l1, l2, l3, l4, l5, l6],
    details: {
      l1,
      l2,
      l3,
      l4,
      l5,
      l6,
      mvrvDesc: l6Data.mvrvDesc,
      isAltcoinBleeding: l6Data.isAltcoinBleeding,
      isAltcoinSeason: l6Data.isAltcoinSeason,
      isLeadLagArb: l6Data.isLeadLagArb,
      // Chuyển tên biến l7 cũ thành tính năng

      // XUẤT CÁC CHỈ SỐ ĐIỂM SỐ NỘI TẠI ĐỂ LOGIC GATES SỬ DỤNG VỀ SAU
      sTrend: l1Data.sTrend,
      volScore: l2Data.volScore,
      liqSeverity: l3Data.liqSeverity,
      posScore: l4Data.posScore,
      momScore: l5Data.momScore,
      macroScore: l6Data.macroScore
    }
  };
};
