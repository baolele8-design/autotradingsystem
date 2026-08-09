// FILE: api/quantum-council.js
import { getRandomModel, callAI } from '../../../infrastructure/llm/client.js';

// BẢN VÁ: Hàm bóc tách JSON an toàn
const extractValidJSON = (text) => {
    try {
        const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        return match ? JSON.parse(match[0]) : JSON.parse(text);
    } catch (error) {
        throw new Error("AI trả về JSON không hợp lệ.", { cause: error });
    }
};
// Hàm phân tích lịch sử MAE/MFE để AI không bị "Mù"
const calculateTierPerformance = (tradeLogs, currentSymbolTier, currentDirection) => {
    if (!tradeLogs || tradeLogs.length === 0) return { medianMae: 0, medianMfe: 0, recentLosses: 0 };
    
    // Lọc ra các lệnh cùng Tier và cùng Hướng
    const relevantLogs = tradeLogs.filter(l => l.tier_class === currentSymbolTier && l.direction === currentDirection);
    if (relevantLogs.length === 0) return { medianMae: 0, medianMfe: 0, recentLosses: 0 };

    let maes = []; let mfes = []; let consecutiveLosses = 0;
    
    // Sắp xếp từ mới nhất đến cũ nhất
    relevantLogs.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    
    for (let log of relevantLogs) {
        if (log.max_adverse_excursion_usd) maes.push(parseFloat(log.max_adverse_excursion_usd));
        if (log.max_favorable_excursion_usd) mfes.push(parseFloat(log.max_favorable_excursion_usd));
    }
    
    for (let log of relevantLogs) {
        if (log.status === 'LOSS') consecutiveLosses++;
        else break;
    }

    maes.sort((a,b)=>a-b); mfes.sort((a,b)=>a-b);
    const medianMae = maes.length > 0 ? maes[Math.floor(maes.length/2)] : 0;
    const medianMfe = mfes.length > 0 ? mfes[Math.floor(mfes.length/2)] : 0;

    return { medianMae, medianMfe, consecutiveLosses, sampleSize: relevantLogs.length };
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { rawSystemContext, tradeLogs, activeTierClass, tradeSetup } = req.body;

    try {
        // 1. Tính toán Kế toán Lượng tử (Lịch sử thực tế từ Supabase)
        const tierPerf = calculateTierPerformance(tradeLogs, activeTierClass, tradeSetup.direction);
        const enrichedContext = `${rawSystemContext}\n- KẾ TOÁN LƯỢNG TỬ (Tài sản cùng Tier): Mẫu số=${tierPerf.sampleSize} lệnh. Chuỗi thua liên tiếp hiện tại=${tierPerf.consecutiveLosses}. MAE trung vị=$${tierPerf.medianMae.toFixed(2)}. MFE trung vị=$${tierPerf.medianMfe.toFixed(2)}.`;

        // 2. Định nghĩa 4 Cặp Đối trọng (Yêu cầu Output JSON nghiêm ngặt)
        const experts = [
            // CẶP 1: KHOA HỌC DỮ LIỆU & VI CẤU TRÚC
            { role: "Chuyên gia Phân phối Thống kê", prompt: `Phân tích MVRV-Z, ATR Rank, BBW Rank. Xác định rủi ro Mean Reversion. Output JSON format: {"score": 0.0_to_1.0, "reasoning": "...", "mean_reversion_risk": "high/medium/low"}` },
            { role: "Chuyên gia Phân tích Dòng lệnh", prompt: `Phân tích VPIN, OBI, Spread. Phát hiện Toxic flow và Slippage. Output JSON format: {"score": 0.0_to_1.0, "reasoning": "...", "toxic_flow_detected": true/false}` },
            
            // CẶP 2: VĨ MÔ & HTF
            { role: "Chuyên gia Vĩ mô & Động học Chu kỳ", prompt: `Phân tích BTC Dominance, FGI, Funding Rate. Output JSON format: {"score": 0.0_to_1.0, "reasoning": "...", "macro_alignment": "bullish/bearish/neutral"}` },
            { role: "Chuyên gia Cấu trúc Kỹ thuật HTF", prompt: `Đánh giá khoảng cách giá với HTF SMA200, độ dốc EMA. Định hình Regime. Output JSON format: {"score": 0.0_to_1.0, "reasoning": "...", "regime": "Trend/Sideways/Crash"}` },
            
            // CẶP 3: HÀNH VI GIÁ & QUẢN TRỊ RỦI RO (TỒN TẠI)
            { role: "Chuyên gia Động lượng & Hành vi", prompt: `Phân tích RSI, CMF, ADX, phân kỳ OBV, mô hình SFP. Tìm Trigger point. Output JSON format: {"score": 0.0_to_1.0, "reasoning": "...", "trigger_strength": "strong/weak"}` },
            { role: "Chuyên gia Quản trị Rủi ro Tồn tại", prompt: `Phân tích Size, Risk Amount, Liq Safety Margin. Đánh giá Ruin Risk. Output JSON format: {"score": 0.0_to_1.0, "reasoning": "...", "ruin_risk_level": "high/low"}` },

            // CẶP 4: KẾ TOÁN LƯỢNG TỬ (LỊCH SỬ TỪ SUPABASE)
            { role: "Chuyên gia Sai số (MAE/MFE)", prompt: `Dựa vào Dữ liệu Kế toán Lượng tử, đánh giá xem lệnh đang đặt Stoploss quá sát (MAE cao) hay Take profit quá xa (MFE chạm đỉnh nhưng quay đầu). Output JSON format: {"score": 0.0_to_1.0, "reasoning": "...", "sl_adjustment_advice": "widen/tighten/keep"}` },
            { role: "Chuyên gia Định cỡ Bayesian", prompt: `Phân tích Winrate, Kelly, Chuỗi thua. Quyết định tăng/giảm khối lượng rủi ro. Output JSON format: {"score": 0.0_to_1.0, "reasoning": "...", "risk_multiplier_advice": float_value}` }
        ];

        // 3. Thực thi song song 8 Đặc vụ
        const expertPromises = experts.map(async (exp) => {
            const model = getRandomModel();
            const sysPrompt = `Bạn là ${exp.role}. Phân tích dữ liệu được cung cấp một cách khách quan nhất. Trả về đúng định dạng JSON được yêu cầu, không kèm văn bản nào khác.`;
            try {
                const res = await callAI(model, sysPrompt, `${enrichedContext}\n\nNHIỆM VỤ CỦA BẠN: ${exp.prompt}`, true);
                return { role: exp.role, model, data: extractValidJSON(res) }; // SỬ DỤNG HÀM MỚI Ở ĐÂY
            } catch (e) {
                return { role: exp.role, model, data: { error: e.message } };
            }
        });

        const completedReports = await Promise.all(expertPromises);

        // 4. Tổng Tư Lệnh Ra Phán Quyết
        const chiefModel = getRandomModel();
        const chiefSysPrompt = `Bạn là Tổng Tư lệnh Phán quyết (Chief Strategist). Bạn nhận báo cáo JSON từ 8 đặc vụ. Trả về một đối tượng JSON tổng hợp quyết định cuối cùng.`;
        const chiefUserPrompt = `[DỮ LIỆU ĐẦU VÀO]\n${enrichedContext}\n\n[BÁO CÁO 8 ĐẶC VỤ]\n${JSON.stringify(completedReports, null, 2)}\n\nYÊU CẦU JSON OUTPUT BẮT BUỘC:
        {
           "decision": "DUYỆT" hoặc "ĐỨNG NGOÀI",
           "reasoning_summary": "Phân tích 150 chữ giải thích điểm hợp lưu hoặc rủi ro...",
           "tier_classification": "Tier X...",
           "suggested_strategy": "Tên chiến thuật",
           "optimized_params": {
               "suggested_tpMult": float,
               "suggested_slMult": float,
               "suggested_risk_pct": float
           }
        }`;

        const chiefRes = await callAI(chiefModel, chiefSysPrompt, chiefUserPrompt, true);
        const finalData = extractValidJSON(chiefRes); // SỬ DỤNG HÀM MỚI Ở ĐÂY

        res.status(200).json({
            councilReports: completedReports,
            chiefDecision: finalData,
            chiefModel: chiefModel
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
