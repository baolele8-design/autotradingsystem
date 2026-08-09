// FILE: local-daemon/auto-bot.js
import WebSocket from 'ws';
import crypto from 'crypto';
import { daemonEnvironment } from '../config/environment.js';
import { calculateMainBotAllocation } from '../domain/execution/capitalAllocation.js';
import { selectExecutableSetups } from '../domain/execution/setupSelection.js';
import { makeInitialClientAlgoId } from '../domain/orders/trailingOrders.js';
import { createDaemonSupabaseClient } from '../infrastructure/supabase/supabaseClient.js';
import { createBinanceGateway } from '../infrastructure/binance/binanceGateway.js';
import {
    readAutoBotServerTime,
    waitForAutoBotExchangeInfo,
    waitForAutoBotServerTime
} from './autoBotStartup.js';
import {
    encodeLiquidityLedgerEvent,
    withLiquidityFeatureVersion
} from '../../../src/domain/analytics/quant/liquidityMetadata.js';

// =========================================================================
// ⚙️ BẢNG ĐIỀU KHIỂN CHIẾN LƯỢC (CAPITAL ALLOCATION)
// =========================================================================
const CONFIG = {
    baseCapitalUsd: 700,        // Mốc vốn gốc của bộ tỷ lệ hiện tại
    maxTotalUsd: 700,           // Max total tại mốc vốn gốc
    refillUsdThreshold: 500,    // Refill tại mốc vốn gốc
    fixedSizeUsd: 55,           // Notional/lệnh tại mốc vốn gốc
    maxRiskPct: 1.0,            // Rủi ro Cắt máu tuyệt đối: KHÔNG VƯỢT QUÁ 1% VỐN
    minScore: 50,               // Điểm Logic Gate tối thiểu để vào lệnh
    allowedIntervals: ['15m', '1h', '4h', '1d'] 
};

const supabase = createDaemonSupabaseClient(
    daemonEnvironment.supabase
);
const TRADE_API_KEY = daemonEnvironment.binance.tradeApiKey;
const TRADE_API_SECRET = daemonEnvironment.binance.tradeApiSecret;

let timeOffset = 0;
let exchangeInfoCache = null;
let isProcessing = false;
const {
    safeFetch,
    sendBinanceReq
} = createBinanceGateway({
    readApiKey: daemonEnvironment.binance.readApiKey,
    readApiSecret: daemonEnvironment.binance.readApiSecret,
    tradeApiKey: TRADE_API_KEY,
    tradeApiSecret: TRADE_API_SECRET,
    getTimeOffset: () => timeOffset
});

// 🛡️ BẢN VÁ: Bộ nhớ khóa chặn bắn đúp (Lưu thời điểm bắn lệnh cuối cùng)
const actionCooldowns = new Map();

// 1. Đồng bộ Đồng hồ & Kéo Thông số sàn
const syncBinanceTime = async () => {
    try {
        const serverTime = await readAutoBotServerTime({ safeFetch });
        timeOffset = serverTime - Date.now();
    } catch (e) { console.error("Lỗi đồng bộ giờ:", e.message); }
};
// Sửa lỗi cực kỳ nguy hiểm: Sync giờ liên tục để tránh API Binance báo lỗi "Timestamp"
setInterval(syncBinanceTime, 120000); 

const fetchExchangeInfo = async () => {
    try {
        const response = await waitForAutoBotExchangeInfo({
            onRetry: ({ dependency, error, retryDelayMs }) => {
                console.error(
                    `[AUTO-BOT STARTUP] ${dependency} unavailable: ${error.message}. ` +
                    `Retrying in ${retryDelayMs}ms.`
                );
            },
            safeFetch
        });
        if (!Array.isArray(response?.symbols)) {
            throw new Error('Binance exchangeInfo response is unavailable');
        }
        exchangeInfoCache = response;
        console.log("✅ Đã tải Thông số Precision (Tick Size & Lot Size) từ Binance.");
    } catch (e) { console.error("Lỗi tải Exchange Info:", e.message); }
};

// 2. Core gửi lệnh API siêu tốc
// 3. THUẬT TOÁN ĐỊNH DẠNG PRECISION CHUẨN BINANCE
const formatPrecision = (val, step) => {
    const numVal = parseFloat(val); const numStep = parseFloat(step);
    if (isNaN(numVal) || isNaN(numStep) || numStep === 0) return "0";
    let stepStr = numStep.toString();
    if (stepStr.includes('e-')) stepStr = numStep.toFixed(parseInt(stepStr.split('e-')[1], 10));
    const precision = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
    return (Math.round(numVal / numStep) * numStep).toFixed(precision);
};

// =========================================================================
// 🧠 ĐỘNG CƠ XỬ LÝ GIAO DỊCH TỰ ĐỘNG MINH BẠCH (TRANSPARENT ENGINE)
// =========================================================================
const processSignals = async (topSetups) => {
    if (isProcessing || !exchangeInfoCache) return;
    isProcessing = true;

    try {
        console.log(`\n📡 [RADAR] Quét được ${topSetups.length} Setup đạt chuẩn Hard Gates...`);

        // [TUYỆT KỸ] Lấy vị thế TRỰC TIẾP TỪ BINANCE (Chống lỗi ngẽn khi Tắt Trình duyệt)
        const posRes = await sendBinanceReq('GET', '/fapi/v2/positionRisk');
        const activePositions = posRes.data.filter(p => parseFloat(p.positionAmt) !== 0);
        const activeSymbols = activePositions.map(p => p.symbol);

        const ordersRes = await sendBinanceReq('GET', '/fapi/v1/openOrders');
        const pendingOrders = ordersRes.data.filter(o => o.reduceOnly === false || o.reduceOnly === "false" || o.reduceOnly === undefined); 
        const pendingSymbols = pendingOrders.map(o => o.symbol);
        const accRes = await sendBinanceReq('GET', '/fapi/v2/account');
        const liveCapital = parseFloat(accRes.data.totalWalletBalance);
        const availableMargin = parseFloat(accRes.data.availableBalance);
        const allocation = calculateMainBotAllocation({
            walletBalance: liveCapital,
            baseCapitalUsd: CONFIG.baseCapitalUsd,
            baseMaxTotalUsd: CONFIG.maxTotalUsd,
            baseRefillUsd: CONFIG.refillUsdThreshold,
            baseFixedSizeUsd: CONFIG.fixedSizeUsd
        });

        // Gom tổng số khe (Slots) đang bị chiếm
        const occupiedSymbols = [...new Set([...activeSymbols, ...pendingSymbols])];

        // =========================================================
        // 💰 THUẬT TOÁN KẾ TOÁN LƯỢNG TỬ (Đo lường USD đang chiếm dụng)
        // =========================================================
        let currentAllocatedUsd = 0;
        
        // 1. Vốn của các vị thế đang chạy (OPEN)
        activePositions.forEach(p => {
            currentAllocatedUsd += Math.abs(parseFloat(p.positionAmt) * parseFloat(p.markPrice));
        });

        // 2. Vốn của các lệnh Limit đang treo (PENDING)
        pendingOrders.forEach(o => {
            currentAllocatedUsd += parseFloat(o.price) * parseFloat(o.origQty);
        });

        console.log(`💼 [PORTFOLIO] Vốn đang chiếm dụng: $${currentAllocatedUsd.toFixed(2)} / $${allocation.maxTotalUsd.toFixed(2)}. (Bao gồm: ${occupiedSymbols.join(', ') || 'Trống'})`);

        // Bóp Cò Khởi Động Lại? (Ngưỡng refill co giãn theo vốn ví)
        if (currentAllocatedUsd > allocation.refillUsdThreshold) {
            console.log(`⏸️ [CHỜ ĐỢI] Đang kẹt $${currentAllocatedUsd.toFixed(2)} (> Ngưỡng nhồi đạn $${allocation.refillUsdThreshold.toFixed(2)}). Tạm ngưng để chốt lời/lỗ bớt.`);
            isProcessing = false;
            return;
        }

        // Lọc điều kiện thực thi trước rồi mới khóa symbol. PAPER/invalid
        // setup không được phép che mất một setup LIVE hợp lệ phía sau.
        const { filterStats, validSetups } = selectExecutableSetups(
            topSetups,
            {
                actionCooldowns,
                allowedIntervals: CONFIG.allowedIntervals,
                minScore: CONFIG.minScore,
                occupiedSymbols
            }
        );

        // BÁO CÁO LÝ DO CẮT TÍN HIỆU
        console.log(`🔍 [BỘ LỌC BOT] Báo cáo rà soát ${topSetups.length} tín hiệu:`);
        console.log(`   ├─ Cấm Khung giờ (VD: 5m, 1M): ${filterStats.badInterval}`);
        console.log(`   ├─ Coin bị chặn mở vị thế mới: ${filterStats.blockedSymbol}`);
        console.log(`   ├─ Trùng Coin đang chạy/treo: ${filterStats.duplicate}`);
        console.log(`   ├─ Trùng Coin đang bị Khóa (Cooldown 5p): ${filterStats.cooldown}`);
        console.log(`   ├─ Điểm yếu (Dưới ${CONFIG.minScore}đ): ${filterStats.lowScore}`);
        console.log(`   ├─ Chiến thuật mới PAPER/SHADOW (không gửi lệnh thật): ${filterStats.paperOnly}`);
        console.log(`   └─ LỌT QUA CỬA BẢO VỆ: ${filterStats.passed} Tín hiệu cực sắc.`);

        if (validSetups.length === 0) {
            console.log(`💤 Không có tín hiệu nào đủ tiêu chuẩn sát thủ. Bot tiếp tục ngủ...`);
            isProcessing = false;
            return;
        }

        // THUẬT TOÁN XẾP HẠNG: Điểm cao trước -> R:R cao trước
        validSetups.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return parseFloat(b.theoreticalRR) - parseFloat(a.theoreticalRR);
        });

        // BỐC SLOT TRỐNG DỰA TRÊN NGÂN SÁCH CÒN LẠI VÀ THỰC THI
        const usdAvailable = allocation.maxTotalUsd - currentAllocatedUsd;
        const slotsAvailable = Math.floor(usdAvailable / allocation.fixedSizeUsd);

        if (slotsAvailable <= 0) {
            console.log(`⚠️ Ngân sách rảnh rỗi ($${usdAvailable.toFixed(2)}) không đủ để đi thêm 1 lệnh $${allocation.fixedSizeUsd.toFixed(2)}. Bot tạm nghỉ.`);
            isProcessing = false;
            return;
        }

        const targets = validSetups.slice(0, slotsAvailable);

        if (targets.length > 0) {
            // Nếu số dư khả dụng thấp hơn size động hiện tại, dừng bắn lệnh luôn
            if (availableMargin < allocation.fixedSizeUsd) {
                console.log(`⚠️ HẾT KÝ QUỸ: Số dư khả dụng ($${availableMargin.toFixed(2)}) không đủ 1 lệnh. Cần bơm vốn!`);
                isProcessing = false;
                return;
            }

            console.log(`\n======================================================`);
            console.log(`🔋 NẠP ĐẠN: Phát hiện trống ${slotsAvailable} Slot. Khởi động quy trình xả đạn...`);

            // VÒNG LẶP BÓP CÒ
            for (const setup of targets) {
                // 🛡️ Đóng dấu khóa ngay lập tức: Coin này vừa bị bắn, cấm bắn tiếp trong 5 phút!
                actionCooldowns.set(setup.symbol, Date.now());
                
                await executeTrade(setup, liveCapital, allocation.fixedSizeUsd);
                await new Promise(r => setTimeout(r, 800)); // Nhịp thở cho API
            }
            console.log(`======================================================\n`);
        }

    } catch (e) {
        console.error("❌ [BOT ERROR] Lỗi vòng lặp quét:", e?.response?.data?.msg || e.message);
    }

    isProcessing = false;
};

// =========================================================================
// 🚀 VŨ KHÍ PHÓNG LỆNH & ĐỊNH CỠ VỊ THẾ (CHỐNG LỆNH GHOST 100%)
// =========================================================================
const executeTrade = async (setup, liveCapital, fixedSizeUsd) => {
    try {
        const entryPrice = parseFloat(setup.entry);
        const slPrice = parseFloat(setup.slTech);
        
        const riskDiff = Math.abs(entryPrice - slPrice);
        if (riskDiff <= 0) return;

        // BÀI TOÁN BÓP SIZE (Bảo vệ Rủi ro Tuyệt đối)
        const slPercent = riskDiff / entryPrice;
        let positionSizeUSD = fixedSizeUsd;
        let riskAmountUSD = positionSizeUSD * slPercent;
        const maxRiskUsd = liveCapital * (CONFIG.maxRiskPct / 100);

        if (riskAmountUSD > maxRiskUsd) {
            riskAmountUSD = maxRiskUsd; // Kẹp cứng rủi ro không quá % Vốn
            positionSizeUSD = riskAmountUSD / slPercent; // Cắt gọt Size
            console.log(`⚠️ Bóp Size [${setup.symbol}] xuống $${positionSizeUSD.toFixed(2)} để ép Risk < ${CONFIG.maxRiskPct}% Vốn.`);
        }

        // BẢN VÁ: Khai báo biến riskPercentOfCapital để truyền xuống Supabase
        const riskPercentOfCapital = (riskAmountUSD / liveCapital) * 100;

        // QUÉT CẤU HÌNH SÀN BINANCE
        const symInfo = exchangeInfoCache.symbols.find(s => s.symbol === setup.symbol);
        const stepSize = parseFloat(symInfo.filters.find(f => f.filterType === 'LOT_SIZE').stepSize);
        const tickSize = parseFloat(symInfo.filters.find(f => f.filterType === 'PRICE_FILTER').tickSize);

        const rawQty = positionSizeUSD / entryPrice;
        const finalQty = formatPrecision(rawQty, stepSize);
        if (parseFloat(finalQty) <= 0) {
            console.log(`⚠️ Bỏ qua [${setup.symbol}] vì Size quá bé so với quy định sàn.`);
            return;
        }

        const finalEntry = formatPrecision(entryPrice, tickSize);
        const finalSl = formatPrecision(slPrice, tickSize);
        const finalTp = formatPrecision(setup.tp1, tickSize);

        const side = setup.direction === 'LONG' ? 'BUY' : 'SELL';
        const exitSide = setup.direction === 'LONG' ? 'SELL' : 'BUY';
        const tradeId = crypto.randomUUID();

        console.log(`🚀 BẮN LỆNH: ${setup.symbol} | ${setup.execType} ${side} | Khung: ${setup.interval} | Size: $${positionSizeUSD.toFixed(1)} | Điểm: ${setup.score?.toFixed(1)}`);

        // 0. PRE-FLIGHT CLEANUP: Chỉ hủy lệnh Limit chưa khớp (không xóa CO của lệnh khác đang active)
        try {
          await sendBinanceReq('DELETE', '/fapi/v1/allOpenOrders', { symbol: setup.symbol });
        } catch (error) {
          console.warn(
            `[ENTRY CLEANUP] ${setup.symbol}:`,
            error.message
          );
        }

        // 1. SETUP ĐÒN BẨY (An toàn)
        const lev = Math.max(1, Math.ceil(positionSizeUSD / (liveCapital * 0.9)));
        await sendBinanceReq('POST', '/fapi/v1/marginType', { symbol: setup.symbol, marginType: 'ISOLATED' }).catch(e=>e);
        await sendBinanceReq('POST', '/fapi/v1/leverage', { symbol: setup.symbol, leverage: lev }).catch(e=>e);

        // 2. VÀO LỆNH ENTRY (THÀNH CÔNG LÀ ĐÃ CÓ VỊ THẾ)
        const entryPayload = { symbol: setup.symbol, side: side, type: setup.execType, quantity: finalQty };
        if (setup.execType === 'LIMIT') { entryPayload.price = finalEntry; entryPayload.timeInForce = 'GTC'; }
        await sendBinanceReq('POST', '/fapi/v1/order', entryPayload);

        // 3. CẮM KHIÊN BẢO VỆ — Lưu algoId để sau này chỉ xóa đúng SL/TP của lệnh này
        let slAlgoId = null;
        let tpAlgoId = null;
        try {
            const algoEndpoint = '/fapi/v1/algoOrder';
            const slClientAlgoId = makeInitialClientAlgoId('sl', tradeId);
            const tpClientAlgoId = makeInitialClientAlgoId('tp', tradeId);
            const slRes = await sendBinanceReq('POST', algoEndpoint, { symbol: setup.symbol, side: exitSide, type: 'STOP_MARKET', triggerPrice: finalSl, quantity: finalQty, reduceOnly: "true", workingType: "MARK_PRICE", priceProtect: "true", algoType: "CONDITIONAL", clientAlgoId: slClientAlgoId });
            slAlgoId = slRes?.data?.algoId ?? slRes?.algoId ?? null;
            const tpRes = await sendBinanceReq('POST', algoEndpoint, { symbol: setup.symbol, side: exitSide, type: 'TAKE_PROFIT_MARKET', triggerPrice: finalTp, quantity: finalQty, reduceOnly: "true", workingType: "MARK_PRICE", priceProtect: "true", algoType: "CONDITIONAL", clientAlgoId: tpClientAlgoId });
            tpAlgoId = tpRes?.data?.algoId ?? tpRes?.algoId ?? null;
            if (slAlgoId || tpAlgoId) {
                console.log(`[🛡️ ALGO ID] ${setup.symbol} SL algoId=${slAlgoId} | TP algoId=${tpAlgoId}`);
            }
        } catch (algoErr) {
            console.log(`⚠️ KHÔNG CẮM ĐƯỢC SL/TP CHO [${setup.symbol}]:`, algoErr?.response?.data?.msg || algoErr.message);
            // Dù lỗi SL/TP, luồng code vẫn CHẠY TIẾP XUỐNG DƯỚI để ghi sổ cái
        }

        // 4. GHI SỔ CÁI BẰNG ĐÚNG BẢN PAYLOAD GỐC CỦA HỆ THỐNG
        const payload = {
            id: tradeId,
            symbol: setup.symbol,
            interval: setup.interval,
            type: setup.tradeType || 'FUTURES',
            direction: setup.direction,

            entry: parseFloat(finalEntry),
            initial_entry: parseFloat(finalEntry),
            sl: parseFloat(finalSl),
            tp_1_price: parseFloat(finalTp),

            // ==========================================
            // RISK GEOMETRY / TRAILING V2
            // ==========================================

            // Biết chắc từ lúc đặt lệnh
            initial_sl: parseFloat(finalSl),

            // Chưa được phép tính vì chưa biết actual Binance fill
            initial_risk_per_coin: null,
            opened_at: null,

            protection_stage: 'NONE',

            high_water_price: null,
            high_water_r: 0,

            // Legacy compatibility
            trailing_activated: false, 
            
            risk_amount_usd: Math.max(0.1, parseFloat(riskAmountUSD)), 
            position_size_usd: parseFloat(positionSizeUSD),
            rr: parseFloat(setup.theoreticalRR), 
            
            // --- CÁC CỘT THỐNG KÊ LÕI ---
            adx: parseFloat(setup.adx || 0),
            atr: parseFloat(setup.atr || 0),
            rsi: parseFloat(setup.rsi || 0),
            cmf: parseFloat(setup.cmf || 0),
            bbw_rank: parseInt(setup.bbwRank || 0),
            oi_delta: parseFloat(setup.oiDelta || 0),
            funding_rate: parseFloat(setup.fundingRate || 0),
            funding_slope: parseFloat(setup.fundingSlope || 0),
            taker_ratio: parseFloat(setup.takerRatio || 1),
            btc_dom_slope: parseFloat(setup.btcDomSlope || 0),
            regime_at_entry: setup.l2 || null,
            btc_regime_at_entry: setup.btcRegime || null,
            mvrv: parseFloat(setup.mvrv || 0),
            fgi: parseInt(setup.fgi || 50),

            // --- CÁC CỘT VI CẤU TRÚC VÀ RỦI RO ---
            vpin: parseFloat(setup.vpin || 0),
            obi: parseFloat(setup.obi || 0.5),
            amihud: parseFloat(setup.amihud || 0),
            isi: parseFloat(setup.isi || 0),
            // 🚀 GHI XUỐNG CỘT MỚI TẠI SUPABASE:
            cvd_trend: parseFloat(setup.cvdTrend || 0),
            vwap: parseFloat(setup.vwap || 0),
            vwap_upper: parseFloat(setup.vwapUpper || 0),
            vwap_lower: parseFloat(setup.vwapLower || 0),
            hurst_value: parseFloat(setup.hurstValue || 0),
            liq_longs_vol: parseFloat(setup.liqLongsVol || 0),
            liq_shorts_vol: parseFloat(setup.liqShortsVol || 0),
            // ------------------------------------------
            true_ev: parseFloat(setup.trueEV || 0),
            kelly_pct: parseFloat(setup.kellyPct || 0),
            // --- BÓC TÁCH SOFT GATES ---
            gate_s1: setup.gateS1 || false,
            gate_s2: setup.gateS2 || false,
            gate_s3: setup.gateS3 || false,
            gate_s4: setup.gateS4 || false,
            gate_s5: setup.gateS5 || false,
            gate_s6: setup.gateS6 || false,
            gate_s7: setup.gateS7 || false,
            gate_s8: setup.gateS8 || false,

            trend_sma200: setup.trendSma200 || 'UP', 
            leverage: Math.max(1, Math.ceil(positionSizeUSD / (liveCapital * 0.9 || 1))), 
            status: 'PENDING', 
            pnl_usd: 0, 
            session: setup.session || 'ASIAN', 
            l1_structure: setup.l1 || '', 
            l2_volatility: setup.l2 || '', 
            l3_liq_event: encodeLiquidityLedgerEvent(
                setup.l3,
                setup
            ),
            l4_positioning: setup.l4 || '', 
            l5_momentum: setup.l5 || '', 
            l6_macro: setup.l6 || '',
            
            soft_score: parseFloat(setup.score || 0), 
            holding_cycles: setup.tHold || 1, 
            planned_holding_cycles: setup.tHold || 1,
            actual_holding_cycles: null,
            strategy_id:
                setup.strategyId || 'ADAPTIVE_LONG_FALLBACK',
            strategy_name: `${setup.strategyId || 'ADAPTIVE_LONG_FALLBACK'} [BOT]`,
            capital_at_entry_usd: parseFloat(liveCapital.toFixed(2)), 
            strategy_version: withLiquidityFeatureVersion(
                'v1.5.2-auto'
            ),
            applied_risk_pct: parseFloat(riskPercentOfCapital || 0), 
            
            asset_tier: setup.assetTier || 'Tier 2',
            epoch_id: setup.epochId || 'epoch-alpha-001', 
            slippage_usd: 0,
            max_favorable_excursion_usd: 0, 
            max_adverse_excursion_usd: 0,
            metric_version: 'pending-live-ledger/v2',
            pee_analyzed: false,
            // algoId để xóa đúng CO khi lệnh kết thúc, không ảnh hưởng lệnh khác cùng coin
            sl_algo_id: slAlgoId,
            tp_algo_id: tpAlgoId
        };

        // Ghi lên Supabase + Bắt lỗi để báo cáo minh bạch
        const { error: dbError } = await supabase.from('trade_logs').insert([payload]);

        if (dbError) {
            console.log(`❌ LỖI GHI SUPABASE [${setup.symbol}]:`, dbError.message);
        } else {
            console.log(`✅ [DB SYNC] Đã đẩy dữ liệu lệnh ${setup.symbol} về màn hình kiểm soát (HUD).`);
        }

    } catch (e) {
        // Chỉ những lỗi chết người từ Lệnh Entry mới lọt được xuống đây
        console.log(`❌ LỖI VÀO LỆNH ENTRY [${setup.symbol}]:`, e?.response?.data?.msg || e.message);
    }
};

// =========================================================================
// 🎧 BẬT NGUỒN LẮNG NGHE TÍN HIỆU TỪ MATRIX SCANNER
// =========================================================================
const startBot = async () => {
    console.log("Khởi động Lõi Auto-Bot...");
    const onStartupRetry = ({ dependency, error, retryDelayMs }) => {
        console.error(
            `[AUTO-BOT STARTUP] ${dependency} unavailable: ${error.message}. ` +
            `Retrying in ${retryDelayMs}ms.`
        );
    };
    const serverTime = await waitForAutoBotServerTime({
        onRetry: onStartupRetry,
        safeFetch
    });
    timeOffset = serverTime - Date.now();
    await fetchExchangeInfo();

    const ws = new WebSocket('ws://localhost:1338');
    ws.on('open', () => console.log('🤖 AUTO-BOT ĐÃ KẾT NỐI VỚI VỆ TINH RADAR! Đang chờ con mồi...'));
    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.type === 'SCAN_RESULTS' && msg.data.length > 0 && !msg.data[0].isEmpty) {
                await processSignals(msg.data);
            }
        } catch (error) {
            console.error('[AUTO-BOT WS] Không xử lý được message:', error.message);
        }
    });
    ws.on('close', () => {
        console.log("🔴 Mất kết nối Radar, tự động khởi động lại sau 5s...");
        setTimeout(startBot, 5000);
    });
};

startBot();
