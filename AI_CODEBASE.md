--- START OF FILE Paste Jul 25, 2026, 06:01 PM ---

## 📂 SƠ ĐỒ KIẾN TRÚC HỆ THỐNG HIỆN TẠI
```text
.
├── .gitignore
├── api/
│   └── quantum-council.js
├── b.js
├── export.js
├── index.html
├── local-daemon/
│   ├── a.js
│   ├── optimizer.js
│   ├── package.json
│   └── server.js
├── logs/
│   └── roadmap.md
├── package.json
├── postcss.config.js
├── public/
├── src/
│   ├── App.jsx
│   ├── components/
│   │   ├── scanner/
│   │   │   └── MatrixScanner.jsx
│   │   └── terminal/
│   │       ├── AiAudit.jsx
│   │       ├── LiveMetrics.jsx
│   │       ├── LogicGates.jsx
│   │       ├── OrderForm.jsx
│   │       ├── TradeJournal.jsx
│   │       └── VectorState.jsx
│   ├── config/
│   │   └── constants.js
│   ├── core/
│   │   ├── QuantMath.js
│   │   └── TradeValidator.js
│   ├── hooks/
│   │   ├── useExchangeConfig.js
│   │   ├── useLiveData.js
│   │   └── useMatrixScanner.js
│   ├── index.css
│   ├── main.jsx
│   ├── services/
│   │   ├── llmAPI.js
│   │   └── supabase.js
│   └── store/
│       └── useAppStore.js
├── tailwind.config.js
└── vite.config.js
```

## 💻 CHI TIẾT MÃ NGUỒN

=========================================
/// FILE: .gitignore
=========================================

node_modules/
dist/
.env
.DS_Store

=========================================
/// FILE: api/quantum-council.js
=========================================

// FILE: api/quantum-council.js
import { getRandomModel, callAI } from '../src/services/llmAPI';

// BẢN VÁ: Hàm bóc tách JSON an toàn
const extractValidJSON = (text) => {
    try {
        const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        return match ? JSON.parse(match[0]) : JSON.parse(text);
    } catch (e) {
        throw new Error("AI trả về JSON không hợp lệ.");
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

=========================================
/// FILE: b.js
=========================================

import fs from 'fs';
import path from 'path';

// 1. CẤU HÌNH BỘ LỌC TỰ ĐỘNG
const rootDir = "D:\\100_Active_Projects\\107_Trading_Crypto\\03_Workspace\\sandbox";
const outputFile = 'AI_CODEBASE.md';

// Các đuôi file được phép đọc (Thêm TS, config phổ biến)
const allowedExtensions = ['.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.scss', '.md'];

// Các file cụ thể được phép đọc (không có đuôi)
const allowedFiles = ['.env.example', '.gitignore', 'Dockerfile'];

// Thư mục cần bỏ qua
const ignoredDirs = ['node_modules', '.git', 'dist', 'build', '.vercel', '.next', 'coverage', '.vscode', '.idea'];

// File cần bỏ qua (ĐẶC BIỆT QUAN TRỌNG: Bỏ qua file output và .env thật)
const ignoredFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', outputFile, '.DS_Store', '.env', '.env.local'];

// --- HÀM KIỂM TRA TÍNH HỢP LỆ ---
const isValidDir = (dirName) => !ignoredDirs.includes(dirName);
const isValidFile = (fileName) => {
    if (ignoredFiles.includes(fileName)) return false;
    if (allowedFiles.includes(fileName)) return true;
    const ext = path.extname(fileName);
    return allowedExtensions.includes(ext);
};

// --- HÀM VẼ SƠ ĐỒ CÂY THƯ MỤC CHUYÊN NGHIỆP ---
function generateTree(dir, prefix = '') {
    let treeStr = '';
    const items = fs.readdirSync(dir);
    
    // Lọc trước để biết chính xác số lượng item hợp lệ (dùng để vẽ nhánh cuối)
    const validItems = items.filter(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        return stat.isDirectory() ? isValidDir(item) : isValidFile(item);
    });

    validItems.forEach((item, index) => {
        const isLast = index === validItems.length - 1;
        const pointer = isLast ? '└── ' : '├── ';
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            treeStr += `${prefix}${pointer}${item}/\n`;
            // Nếu là thư mục cuối, khoảng trắng ở dưới; nếu không, kẻ vạch dọc
            treeStr += generateTree(fullPath, prefix + (isLast ? '    ' : '│   '));
        } else {
            treeStr += `${prefix}${pointer}${item}\n`;
        }
    });

    return treeStr;
}

// --- HÀM LẤY NỘI DUNG FILE ĐỆ QUY ---
function readFilesRecursively(dir) {
    let content = '';
    const items = fs.readdirSync(dir);

    items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory() && isValidDir(item)) {
            content += readFilesRecursively(fullPath);
        } else if (stat.isFile() && isValidFile(item)) {
            const fileContent = fs.readFileSync(fullPath, 'utf8');
            // Dùng path.relative để đường dẫn nhìn gọn gàng: src/App.jsx thay vì C:\...\src\App.jsx
            const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
            
            content += `=========================================\n`;
            content += `/// FILE: ${relativePath}\n`;
            content += `=========================================\n\n`;
            content += fileContent + `\n\n`;
        }
    });

    return content;
}

// ==========================================
// THỰC THI SCRIPT
// ==========================================
console.log('🔍 Đang quét toàn bộ dự án...');

const now = new Date();
const timeString = now.toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' });

// 1. Khởi tạo nội dung và vẽ cây
let outputContent = `--- START OF FILE Paste ${timeString} ---\n\n`;
outputContent += `## 📂 SƠ ĐỒ KIẾN TRÚC HỆ THỐNG HIỆN TẠI\n\`\`\`text\n`;
outputContent += `.\n`; // Dấu chấm đại diện cho thư mục hiện tại
outputContent += generateTree(rootDir);
outputContent += `\`\`\`\n\n`;

// 2. Gom mã nguồn
outputContent += `## 💻 CHI TIẾT MÃ NGUỒN\n\n`;
outputContent += readFilesRecursively(rootDir);

// 3. Xuất file
fs.writeFileSync(outputFile, outputContent);
console.log(`✅ Đã quét xong! Toàn bộ kiến trúc và mã nguồn đã được gom vào: ${outputFile}`);

=========================================
/// FILE: export.js
=========================================

import fs from 'fs';
import path from 'path';

// 1. Chỉ định target paths
const targetPaths = [
    'src', 
    'api', 
    'package.json', 
    'vite.config.js', 
    'tailwind.config.js', 
    'index.html'
];
const outputFile = 'AI_CODEBASE.md';

const allowedExtensions = ['.js', '.jsx', '.json', '.html', '.css'];
const ignoredDirs = ['node_modules', '.git', 'dist', '.vercel', 'build'];

// --- THÊM MỚI: HÀM VẼ SƠ ĐỒ CÂY THƯ MỤC ---
function generateTree(currentPath, prefix = '') {
    if (!fs.existsSync(currentPath)) return '';

    const stat = fs.statSync(currentPath);
    const name = path.basename(currentPath);

    // Xử lý nếu là File
    if (stat.isFile()) {
        const ext = path.extname(currentPath);
        if ((allowedExtensions.includes(ext) || name === '.env.example') && name !== 'package-lock.json') {
            return `${prefix}├── ${name}\n`;
        }
        return '';
    }

    // Xử lý nếu là Thư mục
    if (stat.isDirectory()) {
        if (ignoredDirs.includes(name)) return '';

        let treeStr = `${prefix}├── ${name}/\n`;
        const files = fs.readdirSync(currentPath);
        files.forEach((file) => {
            // Đệ quy chui vào trong thư mục
            treeStr += generateTree(path.join(currentPath, file), prefix + '│   ');
        });
        return treeStr;
    }
    return '';
}
// ----------------------------------------

const now = new Date();
const timeString = now.toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' });

// 2. KHỞI TẠO NỘI DUNG VỚI SƠ ĐỒ KIẾN TRÚC
let outputContent = `--- START OF FILE Paste ${timeString} ---\n\n`;
outputContent += `## 📂 SƠ ĐỒ KIẾN TRÚC HỆ THỐNG HIỆN TẠI\n\`\`\`text\n`;

// Vẽ cây cho từng thư mục/file target
targetPaths.forEach(p => {
    outputContent += generateTree(p);
});
outputContent += `\`\`\`\n\n`;
outputContent += `## 💻 CHI TIẾT MÃ NGUỒN\n\n`;

// 3. HÀM ĐỌC NỘI DUNG FILE (Giữ nguyên của bạn)
function readFilesRecursively(dir) {
    if (!fs.existsSync(dir)) return;
    
    const stat = fs.statSync(dir);
    
    if (stat.isFile()) {
        const ext = path.extname(dir);
        const fileName = path.basename(dir);
        
        if ((allowedExtensions.includes(ext) || fileName === '.env.example') && fileName !== 'package-lock.json') {
            const content = fs.readFileSync(dir, 'utf8');
            outputContent += `=========================================\n`;
            outputContent += `/// FILE: ${dir}\n`;
            outputContent += `=========================================\n\n`;
            outputContent += content;
            outputContent += `\n\n`;
        }
    } else if (stat.isDirectory()) {
        if (ignoredDirs.includes(path.basename(dir))) return;
        const files = fs.readdirSync(dir);
        files.forEach(file => readFilesRecursively(path.join(dir, file)));
    }
}

// Chạy thuật toán đệ quy lấy content
targetPaths.forEach(p => readFilesRecursively(p));

// Xuất file
fs.writeFileSync(outputFile, outputContent);
console.log(`✅ Đã gom mã nguồn và tạo Sơ đồ kiến trúc vào file ${outputFile}`);

=========================================
/// FILE: index.html
=========================================

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Anti-Fragile Terminal</title>
    <link rel="icon" href="data:,">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>

=========================================
/// FILE: local-daemon/a.js
=========================================

// FILE: local-daemon/auto-bot.js
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

// =========================================================================
// ⚙️ BẢNG ĐIỀU KHIỂN CHIẾN LƯỢC (CAPITAL ALLOCATION)
// =========================================================================
const CONFIG = {
    maxTotalUsd: 650,           // Ngân sách tối đa cấp cho Bot: $650
    refillUsdThreshold: 400,    // Chỉ khi Vốn bị chiếm dụng <= $400 Bot mới nhồi thêm lệnh
    fixedSizeUsd: 55,           // Ký quỹ mặc định: $55 mỗi lệnh
    maxRiskPct: 1.0,            // Rủi ro Cắt máu tuyệt đối: KHÔNG VƯỢT QUÁ 1% VỐN
    minScore: 50,               // Điểm Logic Gate tối thiểu để vào lệnh
    allowedIntervals: ['15m', '1h', '4h', '1d'] 
};

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const TRADE_API_KEY = process.env.BINANCE_TRADE_API_KEY;
const TRADE_API_SECRET = process.env.BINANCE_TRADE_API_SECRET;

let timeOffset = 0;
let exchangeInfoCache = null;
let isProcessing = false;

// 🛡️ BẢN VÁ: Bộ nhớ khóa chặn bắn đúp (Lưu thời điểm bắn lệnh cuối cùng)
const actionCooldowns = new Map();

// 1. Đồng bộ Đồng hồ & Kéo Thông số sàn
const syncBinanceTime = async () => {
    try {
        const res = await axios.get('https://fapi.binance.com/fapi/v1/time');
        timeOffset = res.data.serverTime - Date.now();
    } catch (e) { console.error("Lỗi đồng bộ giờ:", e.message); }
};
// Sửa lỗi cực kỳ nguy hiểm: Sync giờ liên tục để tránh API Binance báo lỗi "Timestamp"
setInterval(syncBinanceTime, 120000); 

const fetchExchangeInfo = async () => {
    try {
        const res = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
        exchangeInfoCache = res.data;
        console.log("✅ Đã tải Thông số Precision (Tick Size & Lot Size) từ Binance.");
    } catch (e) { console.error("Lỗi tải Exchange Info:", e.message); }
};

// 2. Core gửi lệnh API siêu tốc
const sendBinanceReq = async (method, endpoint, paramsObj = {}) => {
    const params = new URLSearchParams(paramsObj);
    params.append('timestamp', (Date.now() + timeOffset).toString());
    params.append('recvWindow', '10000');
    const qs = params.toString();
    const sig = crypto.createHmac('sha256', TRADE_API_SECRET).update(qs).digest('hex');

    const isGet = method.toUpperCase() === 'GET';
    const finalUrl = isGet ? `https://fapi.binance.com${endpoint}?${qs}&signature=${sig}` : `https://fapi.binance.com${endpoint}`;
    const finalData = isGet ? undefined : `${qs}&signature=${sig}`;

    return axios({
        method: method, url: finalUrl, data: finalData,
        headers: { 'X-MBX-APIKEY': TRADE_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }
    });
};

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

        console.log(`💼 [PORTFOLIO] Vốn đang chiếm dụng: $${currentAllocatedUsd.toFixed(2)} / $${CONFIG.maxTotalUsd}. (Bao gồm: ${occupiedSymbols.join(', ') || 'Trống'})`);

        // Bóp Cò Khởi Động Lại? (Chỉ nạp khi Vốn chiếm dụng <= Ngưỡng nạp 300$)
        if (currentAllocatedUsd > CONFIG.refillUsdThreshold) {
            console.log(`⏸️ [CHỜ ĐỢI] Đang kẹt $${currentAllocatedUsd.toFixed(2)} (> Ngưỡng nhồi đạn $${CONFIG.refillUsdThreshold}). Tạm ngưng để chốt lời/lỗ bớt.`);
            isProcessing = false;
            return;
        }

        // BỘ LỌC SINH TỒN MINH BẠCH - BẢN VÁ CHỐNG ĐÚP LỆNH
        let filterStats = { badInterval: 0, duplicate: 0, lowScore: 0, notFutures: 0, cooldown: 0, passed: 0 };
        
        // 1. Tự động loại bỏ các Setup trùng Symbol bị Radar gửi cùng lúc (Lấy cái R:R ngon nhất)
        const uniqueSetups = [];
        const seenInThisBatch = new Set();
        for (const s of topSetups) {
            if (!seenInThisBatch.has(s.symbol)) {
                seenInThisBatch.add(s.symbol);
                uniqueSetups.push(s);
            }
        }
        
        const validSetups = uniqueSetups.filter(s => {
            if (!CONFIG.allowedIntervals.includes(s.interval)) { filterStats.badInterval++; return false; }
            if (occupiedSymbols.includes(s.symbol)) { filterStats.duplicate++; return false; }
            if (!s.score || s.score < CONFIG.minScore) { filterStats.lowScore++; return false; }
            if (s.tradeType !== 'FUTURES') { filterStats.notFutures++; return false; }
            
            // 🛡️ BẢO VỆ LÕI: Kiểm tra thời gian Cooldown (Khóa 5 phút / 300,000ms)
            const lastFiredTime = actionCooldowns.get(s.symbol) || 0;
            if (Date.now() - lastFiredTime < 300000) {
                filterStats.cooldown++; 
                return false; 
            }
            
            // Đưa ngay vào danh sách tạm chiếm dụng để chống lặp cục bộ
            occupiedSymbols.push(s.symbol);
            filterStats.passed++;
            return true;
        });

        // BÁO CÁO LÝ DO CẮT TÍN HIỆU
        console.log(`🔍 [BỘ LỌC BOT] Báo cáo rà soát ${topSetups.length} tín hiệu:`);
        console.log(`   ├─ Cấm Khung giờ (VD: 5m, 1M): ${filterStats.badInterval}`);
        console.log(`   ├─ Trùng Coin đang chạy/treo: ${filterStats.duplicate}`);
        console.log(`   ├─ Trùng Coin đang bị Khóa (Cooldown 5p): ${filterStats.cooldown}`);
        console.log(`   ├─ Điểm yếu (Dưới ${CONFIG.minScore}đ): ${filterStats.lowScore}`);
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
        const usdAvailable = CONFIG.maxTotalUsd - currentAllocatedUsd;
        const slotsAvailable = Math.floor(usdAvailable / CONFIG.fixedSizeUsd);

        if (slotsAvailable <= 0) {
            console.log(`⚠️ Ngân sách rảnh rỗi ($${usdAvailable.toFixed(2)}) không đủ để đi thêm 1 lệnh $${CONFIG.fixedSizeUsd}. Bot tạm nghỉ.`);
            isProcessing = false;
            return;
        }

        const targets = validSetups.slice(0, slotsAvailable);

        if (targets.length > 0) {
            const accRes = await sendBinanceReq('GET', '/fapi/v2/account');
            const liveCapital = parseFloat(accRes.data.totalMarginBalance);
            const availableMargin = parseFloat(accRes.data.availableBalance); 

            // Nếu số dư khả dụng thấp hơn Size cố định ($55), dừng bắn lệnh luôn
            if (availableMargin < CONFIG.fixedSizeUsd) {
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
                
                await executeTrade(setup, liveCapital);
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
const executeTrade = async (setup, liveCapital) => {
    try {
        const entryPrice = parseFloat(setup.entry);
        const slPrice = parseFloat(setup.slTech);
        
        const riskDiff = Math.abs(entryPrice - slPrice);
        if (riskDiff <= 0) return;

        // BÀI TOÁN BÓP SIZE (Bảo vệ Rủi ro Tuyệt đối)
        const slPercent = riskDiff / entryPrice;
        let positionSizeUSD = CONFIG.fixedSizeUsd;
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

        console.log(`🚀 BẮN LỆNH: ${setup.symbol} | ${setup.execType} ${side} | Khung: ${setup.interval} | Size: $${positionSizeUSD.toFixed(1)} | Điểm: ${setup.score?.toFixed(1)}`);

        // 1. SETUP ĐÒN BẨY (An toàn)
        const lev = Math.max(1, Math.ceil(positionSizeUSD / (liveCapital * 0.9)));
        await sendBinanceReq('POST', '/fapi/v1/marginType', { symbol: setup.symbol, marginType: 'ISOLATED' }).catch(e=>e);
        await sendBinanceReq('POST', '/fapi/v1/leverage', { symbol: setup.symbol, leverage: lev }).catch(e=>e);

        // 2. VÀO LỆNH ENTRY (THÀNH CÔNG LÀ ĐÃ CÓ VỊ THẾ)
        const entryPayload = { symbol: setup.symbol, side: side, type: setup.execType, quantity: finalQty };
        if (setup.execType === 'LIMIT') { entryPayload.price = finalEntry; entryPayload.timeInForce = 'GTC'; }
        await sendBinanceReq('POST', '/fapi/v1/order', entryPayload);

        // 3. CẮM KHIÊN BẢO VỆ (CÔ LẬP TRONG TRY...CATCH ĐỂ KHÔNG CHẾT LÂY LỆNH GHI DATABASE)
        try {
            const algoEndpoint = '/fapi/v1/algoOrder';
            await sendBinanceReq('POST', algoEndpoint, { symbol: setup.symbol, side: exitSide, type: 'STOP_MARKET', triggerPrice: finalSl, quantity: finalQty, reduceOnly: "true", workingType: "MARK_PRICE", priceProtect: "true", algoType: "CONDITIONAL" });
            await sendBinanceReq('POST', algoEndpoint, { symbol: setup.symbol, side: exitSide, type: 'TAKE_PROFIT_MARKET', triggerPrice: finalTp, quantity: finalQty, reduceOnly: "true", workingType: "MARK_PRICE", priceProtect: "true", algoType: "CONDITIONAL" });
        } catch (algoErr) {
            console.log(`⚠️ KHÔNG CẮM ĐƯỢC SL/TP CHO [${setup.symbol}]:`, algoErr?.response?.data?.msg || algoErr.message);
            // Dù lỗi SL/TP, luồng code vẫn CHẠY TIẾP XUỐNG DƯỚI để ghi sổ cái
        }

        // 4. GHI SỔ CÁI BẰNG ĐÚNG BẢN PAYLOAD GỐC CỦA HỆ THỐNG
        const payload = {
            symbol: setup.symbol, 
            interval: setup.interval, 
            type: setup.tradeType || 'FUTURES', 
            direction: setup.direction,
            entry: parseFloat(finalEntry), 
            sl: parseFloat(finalSl), 
            tp_1_price: parseFloat(finalTp), 
            
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
            trailing_activated: false, // Mặc định khi mở lệnh là False
            
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
            l3_liq_event: setup.l3 || '',
            l4_positioning: setup.l4 || '', 
            l5_momentum: setup.l5 || '', 
            l6_macro: setup.l6 || '',
            
            soft_score: parseFloat(setup.score || 0), 
            holding_cycles: setup.tHold || 1, 
            strategy_name: `${setup.overrideTag} [BOT]`, // Gắn tag [BOT] để UI phân biệt
            capital_at_entry_usd: parseFloat(liveCapital.toFixed(2)), 
            strategy_version: 'v1.3.9-auto', 
            applied_risk_pct: parseFloat(riskPercentOfCapital || 0), 
            
            asset_tier: setup.assetTier || 'Tier 2',
            epoch_id: setup.epochId || 'epoch-alpha-001', 
            slippage_usd: 0,
            max_favorable_excursion_usd: 0, 
            max_adverse_excursion_usd: 0   
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
    await syncBinanceTime();
    await fetchExchangeInfo();

    const ws = new WebSocket('ws://localhost:1338');
    ws.on('open', () => console.log('🤖 AUTO-BOT ĐÃ KẾT NỐI VỚI VỆ TINH RADAR! Đang chờ con mồi...'));
    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.type === 'SCAN_RESULTS' && msg.data.length > 0 && !msg.data[0].isEmpty) {
                await processSignals(msg.data);
            }
        } catch (e) {}
    });
    ws.on('close', () => {
        console.log("🔴 Mất kết nối Radar, tự động khởi động lại sau 5s...");
        setTimeout(startBot, 5000);
    });
};

startBot();

=========================================
/// FILE: local-daemon/optimizer.js
=========================================

// FILE: local-daemon/optimizer.js
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

// Hàm tính Phân vị (Percentile) an toàn
const calculatePercentile = (arr, percentile) => {
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;
    if (upper >= sorted.length) return sorted[lower];
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

// Thông số gốc (Cold Start Baseline)
const BASELINE_MODEL = {
    gate_weights: { s1: 2.0, s2: 2.0, s3: 1.5, s4: 0.5, s5: 1.0, s6: 1.5, s7: 1.0, s8: 1.5, msb: 2.5 },
    dynamic_targets: { optimized: { slMult: 1.5, tpMult: 3.0, tHold_modifier: 1.0 } }
};


// Hàm phân tích lõi cho một tập dữ liệu con (Subset)
const analyzeSubset = (subsetTrades, baseline, minSampleRequired = 10) => {
    // Clone baseline để tránh tham chiếu bộ nhớ
    let model = JSON.parse(JSON.stringify(baseline));
    
    if (!subsetTrades || subsetTrades.length < minSampleRequired) {
        return model; // Trả về baseline nếu dữ liệu quá mỏng (Chống Overfitting)
    }
    // CHỐNG NGỘ ĐỘC DỮ LIỆU: Chỉ học từ các lệnh chạm TP, chạm SL hoặc bị chém bởi Time Barrier. 
    // Tuyệt đối bỏ qua lệnh chốt tay (MANUAL_CLOSE) hoặc Panic Sell (PANIC_SELL_REVERSAL) do con người/bảo vệ khẩn cấp can thiệp.
    const validAlgoTrades = subsetTrades.filter(t => 
        t.exit_reason !== 'MANUAL_CLOSE' && 
        t.exit_reason !== 'PANIC_SELL_REVERSAL'
    );

    const winningTrades = validAlgoTrades.filter(t => t.status === 'WIN');
    const losingTrades = validAlgoTrades.filter(t => t.status === 'LOSS');

    // 1. TỐI ƯU HÓA MỤC TIÊU KỲ VỌNG (MAE/MFE VÀ PEE)
    if (winningTrades.length >= 5 && losingTrades.length >= 5) {
        
        const winMaes = winningTrades.map(t => {
            const riskATR = parseFloat(t.atr) || 1;
            const entryPrice = parseFloat(t.entry);
            if (entryPrice <= 0) return null;
            const sizeCoins = parseFloat(t.position_size_usd) / entryPrice;
            const maeUSD = Math.abs(parseFloat(t.max_adverse_excursion_usd) || 0);
            return (maeUSD / sizeCoins) / riskATR; 
        }).filter(val => val !== null && !isNaN(val) && val > 0);

        const lossMfes = losingTrades.map(t => {
            const riskATR = parseFloat(t.atr) || 1;
            const entryPrice = parseFloat(t.entry);
            if (entryPrice <= 0) return null;
            const sizeCoins = parseFloat(t.position_size_usd) / entryPrice;
            const mfeUSD = Math.abs(parseFloat(t.max_favorable_excursion_usd) || 0);
            return (mfeUSD / sizeCoins) / riskATR;
        }).filter(val => val !== null && !isNaN(val) && val > 0);

        let baseSlMult = calculatePercentile(winMaes, 95) || baseline.dynamic_targets.optimized.slMult;
        let baseTpMult = calculatePercentile(lossMfes, 75) || baseline.dynamic_targets.optimized.tpMult;

        let finalSlMult = baseSlMult;
        let finalTpMult = baseTpMult;
        
        // ==========================================================
        // 🧠 TÍCH HỢP PEE: TỰ ĐỘNG THÍCH NGHI VỚI SHAKEOUT & CHỐT NON
        // ==========================================================
        let shakeoutCount = 0;
        let leftOnTableCount = 0;

        // BỎ QUA LỆNH ĐÓNG TAY KHI HỌC MÁY ĐỂ CHỐNG NGỘ ĐỘC (POISONING)
        const peeAnalyzedLosses = losingTrades.filter(t => t.pee_analyzed === true && t.exit_reason !== 'MANUAL_CLOSE');
        const peeAnalyzedWins = winningTrades.filter(t => t.pee_analyzed === true && t.exit_reason !== 'MANUAL_CLOSE');

        // A. Hội chứng Shakeout (Bị quét râu rồi giá đi đúng hướng)
        if (peeAnalyzedLosses.length > 0) {
            peeAnalyzedLosses.forEach(t => {
                const riskUsd = parseFloat(t.risk_amount_usd);
                const peeMfe = parseFloat(t.pee_mfe_usd);
                if (peeMfe >= riskUsd * 1.5) shakeoutCount++;
            });
            const shakeoutRate = shakeoutCount / peeAnalyzedLosses.length;
            
            if (shakeoutRate > 0.25) {
                finalSlMult = baseSlMult * 1.15; // Nhân từ Base, đảm bảo không bùng nổ cấp số nhân
            }
        }

        // B. Hội chứng Alpha Decay (Chốt non)
        if (peeAnalyzedWins.length > 0) {
            peeAnalyzedWins.forEach(t => {
                const pnlUsd = parseFloat(t.pnl_usd);
                const peeMfe = parseFloat(t.pee_mfe_usd);
                if (peeMfe >= pnlUsd) leftOnTableCount++;
            });
            const leftOnTableRate = leftOnTableCount / peeAnalyzedWins.length;
            
            if (leftOnTableRate > 0.30) {
                finalTpMult = baseTpMult * 1.20; // Nhân từ Base
            }
        }

     
        // ==========================================================
        // KHỐI C: HỘI CHỨNG FOMO SỚM (HỌC TỪ PEE_MAE)
        // Nếu lệnh WIN nhưng PEE_MAE âm rất nặng (tức là sau khi chốt lời, giá sập mạnh tạo đáy mới)
        // Hoặc lệnh LOSS do cắt lỗ, sau đó giá sập tiếp sâu hơn nữa -> Bot đã vào lệnh khi nhịp rơi chưa kết thúc.
        // ==========================================================
        let fomoCount = 0;
        const allPeeTrades = [...peeAnalyzedWins, ...peeAnalyzedLosses];
        if (allPeeTrades.length > 0) {
            allPeeTrades.forEach(t => {
                const riskUsd = parseFloat(t.risk_amount_usd);
                const peeMae = Math.abs(parseFloat(t.pee_mae_usd));
                // Nếu sau khi thoát, giá giật ngược lại sâu hơn 1.5R -> Vào quá sớm
                if (peeMae >= riskUsd * 1.5) fomoCount++;
            });
            
            if (fomoCount / allPeeTrades.length > 0.35) {
                // Phạt điểm Entry: Yêu cầu mặc cả gắt gao hơn ở chu kỳ sau
                model.dynamic_targets.optimized.entry_penalty = (model.dynamic_targets.optimized.entry_penalty || 0) + 0.1;
                console.log(`   └─ ⚠️ Cảnh báo FOMO sớm. Nâng mức phạt Entry (Yêu cầu mặc cả sâu hơn).`);
            }
        }

        // ==========================================================
        // KHỐI D: ĐỊNH CỠ THỜI GIAN LƯỢNG TỬ (HỌC TỪ PEE_MFE_CANDLES)
        // ==========================================================
        if (peeAnalyzedWins.length > 0) {
            // Rút trích số nến cần thiết để chạm đỉnh PEE (MFE Tương lai)
            const timeToPeeks = peeAnalyzedWins
                .map(t => parseInt(t.pee_mfe_candles || 0))
                .filter(c => c > 0);

            if (timeToPeeks.length >= 3) {
                // Tính trung vị (Median) số nến cần gồng để ăn trọn con sóng
                const medianCandlesToPeak = calculatePercentile(timeToPeeks, 50);
                
                // Nếu thực tế cần gồng 8 nến, nhưng model đang set tHold quá ngắn -> Điều chỉnh
                const currentHoldModifier = model.dynamic_targets.optimized.tHold_modifier || 1.0;
                
                // Thuật toán nắn form: Nếu Median cao, nới modifier ra 5%. Nếu Median thấp, siết lại 5%.
                if (medianCandlesToPeak > 8) {
                    model.dynamic_targets.optimized.tHold_modifier = Math.min(2.0, currentHoldModifier * 1.05);
                } else if (medianCandlesToPeak < 4) {
                    model.dynamic_targets.optimized.tHold_modifier = Math.max(0.5, currentHoldModifier * 0.95);
                }
            }
        }
        // Cập nhật vào Model với chốt chặn an toàn tuyệt đối
        model.dynamic_targets.optimized = {
            slMult: Math.max(0.5, Math.min(3.5, finalSlMult)), 
            tpMult: Math.max(1.5, Math.min(15.0, finalTpMult)) 
        };


        const totalTrades = winningTrades.length + losingTrades.length;
        const winRate = totalTrades > 0 ? winningTrades.length / totalTrades : 0;
        const avgWinR = winningTrades.length > 0 
            ? winningTrades.reduce((s,t) => s + (parseFloat(t.pnl_usd)/parseFloat(t.risk_amount_usd)), 0) / winningTrades.length 
            : 0;
        const avgLossR = losingTrades.length > 0 
            ? losingTrades.reduce((s,t) => s + Math.abs(parseFloat(t.pnl_usd)/parseFloat(t.risk_amount_usd)), 0) / losingTrades.length 
            : 1;
        const historicalRR = avgLossR > 0 ? avgWinR / avgLossR : 0;

        // Dùng lại công thức Kelly đã có trong QuantMath (import cần thiết) hoặc tính rút gọn tại đây
        const fullKelly = winRate - ((1 - winRate) / (historicalRR || 1));
        const suggestedRiskPct = Math.max(0.2, Math.min(2.0, Math.max(0, fullKelly * 0.5) * 100));

        model.dynamic_targets.optimized.suggested_risk_pct = suggestedRiskPct;

    }
    // ==========================================================
        // 🧠 TÍCH HỢP PEE THỜI GIAN: TỐI ƯU HÓA TEMPORAL BARRIER
        // ==========================================================
        const timeDecayLosses = losingTrades.filter(t => t.exit_reason === 'TEMPORAL_BARRIER_HIT');
        if (timeDecayLosses.length > 0) {
            // Nếu quá nhiều lệnh bị chém bởi Time Barrier mà sau đó (PEE) giá đi đúng hướng (MFE > PnL)
            let prematureTimeExits = 0;
            timeDecayLosses.forEach(t => {
                const peeMfe = parseFloat(t.pee_mfe_usd);
                const riskUsd = parseFloat(t.risk_amount_usd);
                if (peeMfe >= riskUsd * 1.0) prematureTimeExits++;
            });
            
            const prematureRate = prematureTimeExits / timeDecayLosses.length;
            if (prematureRate > 0.3) {
                // Tăng hệ số thời gian giữ lệnh (tHold_modifier) lên 15% vì ta đang chém quá vội
                model.dynamic_targets.optimized.tHold_modifier = 1.15;
            } else {
                // Nới Barrier chuẩn xác, tiếp tục siết tHold_modifier để luân chuyển vốn nhanh
                model.dynamic_targets.optimized.tHold_modifier = 0.90; 
            }
        }

    // 2. TỐI ƯU HÓA TRỌNG SỐ LOGIC GATES (Bayesian WoE)
    const gateKeys = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']; 
    const totalWins = winningTrades.length;
    const totalLosses = losingTrades.length;

    gateKeys.forEach(gate => {
        let winsWithGate = 0;
        let lossesWithGate = 0;

        subsetTrades.forEach(t => {
            // Đọc trực tiếp cờ Boolean từ database
            const colName = `gate_${gate}`;
            if (t[colName] === true) {
                if (t.status === 'WIN') winsWithGate++;
                if (t.status === 'LOSS') lossesWithGate++;
            }
        });
        
        // Laplace Smoothing (Cộng 1 để tránh chia 0)
        const pWinGivenGate = (winsWithGate + 1) / (totalWins + 2);
        const pLossGivenGate = (lossesWithGate + 1) / (totalLosses + 2);
        
        // Weight of Evidence (WoE)
        const woe = Math.log(pWinGivenGate / pLossGivenGate);
        
        // Giới hạn hệ số tác động (Impact Factor) từ 0.5x đến 2.0x
        const impactFactor = Math.max(0.5, Math.min(2.0, 1 + woe));
        
        // Cập nhật lại Trọng số (Weight) vào Model
        const baseWeight = baseline.gate_weights[gate] || 1.0;
        model.gate_weights[gate] = parseFloat((baseWeight * impactFactor).toFixed(2));
    });

    return model;
};

export async function runOptimizationEpoch() {
    console.log("🧠 [OPTIMIZER] Khởi động động cơ học máy Bayesian Matrix...");
    
    const { data: trades, error } = await supabase
        .from('trade_logs')
        .select('*')
        .in('status', ['WIN', 'LOSS']);

    if (error) {
        console.error("❌ [OPTIMIZER] Lỗi kéo data Supabase:", error);
        return;
    }

    const totalTrades = trades?.length || 0;

    // Kiến trúc Model Đa Chiều Mới (Multi-Dimensional Model)
    const masterModel = {
        global: JSON.parse(JSON.stringify(BASELINE_MODEL)),
        tiers: {},
        strategies: {}
    };

    if (totalTrades < 30) {
        console.log(`⚠️ [OPTIMIZER] Data tổng mỏng (${totalTrades}/30 lệnh). Dùng Cold Start Baseline.`);
        await saveModelToDB('epoch-cold-start', masterModel, totalTrades);
        return;
    }

    // 1. TỐI ƯU HÓA TOÀN CỤC (GLOBAL - Dùng làm Fallback)
    masterModel.global = analyzeSubset(trades, BASELINE_MODEL, 30);
    console.log(`✅ [OPTIMIZER] Đã xử lý Global Model (${totalTrades} lệnh).`);

    // 2. TỐI ƯU HÓA THEO PHÂN LỚP TÀI SẢN (TIERS)
    const uniqueTiers = [...new Set(trades.map(t => t.asset_tier).filter(Boolean))];
    uniqueTiers.forEach(tier => {
        const tierTrades = trades.filter(t => t.asset_tier === tier);
        // Kế thừa Global Model làm nền tảng, yêu cầu tối thiểu 10 lệnh để rẽ nhánh
        masterModel.tiers[tier] = analyzeSubset(tierTrades, masterModel.global, 10);
        console.log(`   ├─ Tier [${tier}]: Xử lý ${tierTrades.length} lệnh.`);
    });

    // 3. TỐI ƯU HÓA THEO MA TRẬN (STRATEGY + TIER)
    masterModel.matrix = {};
    
    trades.forEach(t => {
        // 🚀 BẢN VÁ 1: Cạo sạch tag [BOT] để gộp chung kinh nghiệm của Bot và Người
        const strat = t.strategy_name ? t.strategy_name.replace(' [BOT]', '') : 'UNKNOWN';
        const tier = t.asset_tier;
        
        if (strat && tier) {
            const matrixKey = `${strat}|${tier}`;
            if (!masterModel.matrix[matrixKey]) {
                // Lọc trade theo tên đã cạo sạch tag
                const matrixTrades = trades.filter(tr => 
                    (tr.strategy_name || '').replace(' [BOT]', '') === strat && 
                    tr.asset_tier === tier
                );
                // Học riêng cho từng ô Ma trận, yêu cầu cực nhạy (chỉ cần 3 lệnh là bắt đầu nắn form)
                masterModel.matrix[matrixKey] = analyzeSubset(matrixTrades, masterModel.global, 3);
                console.log(`   ├─ Matrix [${matrixKey}]: Xử lý ${matrixTrades.length} lệnh.`);
            }
        }
    });

    // Xuất bản Model
    const epochId = `epoch-matrix-${Date.now()}`;
    await saveModelToDB(epochId, masterModel, totalTrades);
    console.log(`🚀 [OPTIMIZER] Hoàn tất Epoch. Model ID: ${epochId} đã lên sóng!`);
}

async function saveModelToDB(epochId, modelData, count) {
    try {
        await supabase.from('system_models').insert([{
            epoch_id: epochId,
            model_data: modelData,
            trade_count_sampled: count
        }]);
    } catch (e) {
        console.error("❌ [OPTIMIZER] Lỗi lưu Model:", e.message);
    }
}

=========================================
/// FILE: local-daemon/package.json
=========================================

{
  "name": "antifragile-daemon",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "axios": "^1.18.1",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "node-cron": "^4.6.0",
    "ws": "^8.16.0"
  }
}


=========================================
/// FILE: local-daemon/server.js
=========================================

// FILE: local-daemon/server.js 
import http from 'http';
import express from 'express';
import cors from 'cors';
import WebSocket, { WebSocketServer } from 'ws';
import crypto from 'crypto';
import dotenv from 'dotenv';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

import QuantMath from '../src/core/QuantMath.js';
import { TradeValidator } from '../src/core/TradeValidator.js';
import { POOL_SYMBOLS } from '../src/config/constants.js';
import { runOptimizationEpoch } from './optimizer.js';

dotenv.config({ path: '../.env' }); 

const app = express();
app.use(cors({ exposedHeaders: ['x-mbx-used-weight-1m'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const READ_API_KEY = process.env.BINANCE_READ_API_KEY;
const READ_API_SECRET = process.env.BINANCE_READ_API_SECRET;
const TRADE_API_KEY = process.env.BINANCE_TRADE_API_KEY;
const TRADE_API_SECRET = process.env.BINANCE_TRADE_API_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
let currentAiModel = null;
const staticExchangeCache = new Map();


let timeOffset = 0;
// BỘ NHỚ ĐỆM CHO LUỒNG THANH LÝ (LIQUIDATIONS CACHE)
const liquidationsCache = new Map(); // Lưu { symbol: { longs: vol, shorts: vol, lastClear: timestamp } }

const initLiquidationStream = () => {
    const ws = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');
    ws.on('open', () => console.log("🔥 Đã mở luồng giám sát Thanh Lý Cưỡng Chế (Liquidations Stream)"));
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            const forceOrder = msg.o;
            const sym = forceOrder.s;
            const side = forceOrder.S; // "SELL" (Long bị cháy) hoặc "BUY" (Short bị cháy)
            const qty = parseFloat(forceOrder.q);
            const price = parseFloat(forceOrder.p);
            const vol = qty * price;

            if (!liquidationsCache.has(sym)) {
                liquidationsCache.set(sym, { longs: 0, shorts: 0, lastClear: Date.now() });
            }
            const cache = liquidationsCache.get(sym);
            
            // Nếu qua 15 phút, reset cache để lấy dữ liệu mới
            if (Date.now() - cache.lastClear > 900000) {
                cache.longs = 0; cache.shorts = 0; cache.lastClear = Date.now();
            }

            if (side === 'SELL') cache.longs += vol; // Lệnh Long bị thanh lý ép bán
            else if (side === 'BUY') cache.shorts += vol; // Lệnh Short bị thanh lý ép mua
            
            liquidationsCache.set(sym, cache);
        } catch (e) {}
    });
    ws.on('close', () => setTimeout(initLiquidationStream, 5000));
};
initLiquidationStream();
// --- BẮT ĐẦU BẢN VÁ: ĐỒNG BỘ MVRV TỪ HUD ---
let globalMvrvZScore = 0.39; // Mặc định

app.post('/api/mvrv', (req, res) => {
    if (req.body.mvrvZScore !== undefined) {
        globalMvrvZScore = parseFloat(req.body.mvrvZScore);
        console.log(`[SYNC] Đã cập nhật MVRV-Z Score: ${globalMvrvZScore}`);
    }
    res.status(200).json({ success: true });
});
// --- KẾT THÚC BẢN VÁ ---
async function syncBinanceTime() {
    try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/time');
        if (res.ok) {
            const data = await res.json();
            timeOffset = data.serverTime - Date.now();
            console.log(`🕒 [SYSTEM] Đã đồng bộ đồng hồ với Binance. Offset: ${timeOffset}ms`);
        }
    } catch (e) {
        console.error("❌ Lỗi đồng bộ thời gian:", e.message);
    }
}
syncBinanceTime();
setInterval(syncBinanceTime, 120000); // Tự động đồng bộ lại mỗi 2 phút
// --- KẾT THÚC BẢN VÁ ---

async function loadLatestAiModel() {
    try {
        const { data, error } = await supabase
            .from('system_models')
            .select('model_data')
            .order('created_at', { ascending: false })
            .limit(1);
        if (!error && data && data.length > 0) {
            currentAiModel = data[0].model_data;
            console.log("🤖 [AI SYNC] Đã nạp AI Model Bayesian mới nhất vào Radar.");
        }
    } catch (err) {
        console.error("❌ Lỗi nạp AI Model:", err.message);
    }
}

const sendBinanceReq = async (method, endpoint, paramsObj = {}) => {
    const params = new URLSearchParams(paramsObj);
    params.append('timestamp', (Date.now() + timeOffset).toString());
    params.append('recvWindow', '10000');
    const qs = params.toString();
    const sig = crypto.createHmac('sha256', TRADE_API_SECRET).update(qs).digest('hex');

    // BẮT BUỘC: Cả GET và DELETE đều phải đưa tham số lên URL (Query String)
    const isQuery = ['GET', 'DELETE'].includes(method.toUpperCase());
    const finalUrl = isQuery ? `https://fapi.binance.com${endpoint}?${qs}&signature=${sig}` : `https://fapi.binance.com${endpoint}`;
    const finalData = isQuery ? undefined : `${qs}&signature=${sig}`;

    return axios({
        method: method,
        url: finalUrl,
        data: finalData,
        headers: { 'X-MBX-APIKEY': TRADE_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }
    });
};

app.post('/api/execute-batch', async (req, res) => {
    try {
        const { symbol, leverage, marginType, batchOrders, tradeType } = req.body;
        if (!batchOrders || batchOrders.length === 0) return res.status(400).json({ error: 'Lệnh rỗng.' });

        if (tradeType !== 'SPOT') {
            try { await sendBinanceReq('POST', '/fapi/v1/marginType', { symbol, marginType }); } catch (e) {}
            try { await sendBinanceReq('POST', '/fapi/v1/leverage', { symbol, leverage }); } catch (e) {}
        }

        const results = [];
        for (let i = 0; i < batchOrders.length; i++) {
            const orderPayload = batchOrders[i];
            try {
                let baseUrl = 'https://fapi.binance.com';
                let endpoint = '/fapi/v1/order';

                if (tradeType === 'SPOT') {
                    baseUrl = 'https://api.binance.com';
                    endpoint = '/api/v3/order';
                    if (['STOP_LOSS', 'TAKE_PROFIT'].includes(orderPayload.type)) {
                        endpoint = '/sapi/v1/algo/spot/newOrderAlgo';
                        orderPayload.algoType = orderPayload.type; 
                        delete orderPayload.type; 
                    }
                } else {
                    if (['STOP_MARKET', 'TAKE_PROFIT_MARKET'].includes(orderPayload.type)) {
                        endpoint = '/fapi/v1/algoOrder';
                        orderPayload.algoType = 'CONDITIONAL';
                    }
                }

                const params = new URLSearchParams(orderPayload);
                params.append('timestamp', (Date.now() + timeOffset).toString());
                params.append('recvWindow', '10000');
                const qs = params.toString();
                const sig = crypto.createHmac('sha256', TRADE_API_SECRET).update(qs).digest('hex');
                
                const response = await axios({
                    method: 'POST',
                    // BẢN VÁ: Xóa đuôi ?qs&signature ở URL và đẩy xuống trường data
                    url: `${baseUrl}${endpoint}`,
                    data: `${qs}&signature=${sig}`,
                    headers: { 'X-MBX-APIKEY': TRADE_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }
                });

                results.push(response.data);
            } catch (err) {
                if (i === 0) throw new Error(`Lệnh Entry bị từ chối: ${err.response?.data?.msg || err.message}`);
                results.push({ error: true, type: orderPayload.type || orderPayload.algoType, msg: err.response?.data?.msg || err.message });
            }
        }
        return res.status(200).json(results);
    } catch (error) {
        return res.status(500).json({ error: 'Bridge Execution Failed', details: { msg: error.message } });
    }
});

app.delete('/api/cancel-orphans', async (req, res) => {
    try {
        const { symbol } = req.body;
        if (!symbol) return res.status(400).json({ error: "Thiếu symbol." });
        const openOrdersRes = await sendBinanceReq('GET', '/fapi/v1/openOrders', { symbol });
        const openOrders = openOrdersRes.data;

        if (!Array.isArray(openOrders) || openOrders.length === 0) return res.status(200).json({ success: true, message: "Không có lệnh treo." });

        const orphanOrders = openOrders.filter(order => order.reduceOnly === true);
        if (orphanOrders.length === 0) return res.status(200).json({ success: true, message: "Không có lệnh mồ côi." });

        for (const order of orphanOrders) {
            try { await sendBinanceReq('DELETE', '/fapi/v1/order', { symbol, orderId: order.orderId }); } catch (err) {}
        }
        return res.status(200).json({ success: true, count: orphanOrders.length });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to clear orphans', details: { msg: error.message } });
    }
});

app.post('/api/binance', async (req, res) => {
    if (req.body.action === 'SIGN_TRADFI') {
        try {
            const qs = new URLSearchParams({ timestamp: Date.now().toString(), recvWindow: '5000' }).toString();
            const sig = crypto.createHmac('sha256', TRADE_API_SECRET).update(qs).digest('hex');
            const response = await fetch(`https://fapi.binance.com/fapi/v1/stock/contract?${qs}&signature=${sig}`, {
                method: 'POST',
                headers: { 'X-MBX-APIKEY': TRADE_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            res.status(response.status).json(await response.json());
        } catch (err) { res.status(500).json({ error: err.message }); }
    } else res.status(400).json({ error: 'Invalid Action' });
});

app.get('/api/binance', async (req, res) => {
    try {
        const { path, isPrivate, t, ...restQuery } = req.query;
        let baseUrl = path.startsWith('/fapi') || path.startsWith('/futures') ? 'https://fapi.binance.com' : 'https://api.binance.com';
        
        const params = new URLSearchParams(restQuery);
        let queryString = params.toString();
        let headers = { 'Content-Type': 'application/json' };

        if (isPrivate === 'true') {
            // Thay thế bằng 3 dòng này:
            queryString += (queryString ? '&' : '') + `timestamp=${Date.now() + timeOffset}&recvWindow=10000`;
            headers['X-MBX-APIKEY'] = READ_API_KEY;
            queryString += `&signature=${crypto.createHmac('sha256', READ_API_SECRET).update(queryString).digest('hex')}`;
        }

        const response = await fetch(`${baseUrl}${path}?${queryString}`, { headers });
        const weight = response.headers.get('x-mbx-used-weight-1m');
        if (weight) res.setHeader('x-mbx-used-weight-1m', weight);

        res.status(response.status).json(await response.json());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/cmc', async (req, res) => {
    try {
        const [globalRes, fgiRes] = await Promise.all([
          fetch('https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest?convert=USD'),
          fetch('https://pro-api.coinmarketcap.com/public-api/v3/fear-and-greed/latest')
        ]);
        const globalData = await globalRes.json();
        const fgiData = await fgiRes.json();
        res.status(200).json({
          btcDominance: globalData.data?.btc_dominance || 55.0,
          fgiValue: fgiData.data?.value || 50
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/gemini', async (req, res) => {
    try {
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
            body: JSON.stringify(req.body)
        });
        res.status(response.status).json(await response.json());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/cancel-all', async (req, res) => {
    try {
        const { symbol } = req.body;
        if (!symbol) return res.status(400).json({ error: "Thiếu symbol." });
        const response = await sendBinanceReq('DELETE', '/fapi/v1/allOpenOrders', { symbol });
        return res.status(200).json({ success: true, data: response.data });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to clear orders', details: { msg: error.message } });
    }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 1338;

server.listen(PORT, async () => {
    console.log(`🚀 Daemon Server running on port ${PORT}`);
    try {
        await runOptimizationEpoch();
        await loadLatestAiModel();
    } catch (e) { console.log("❌ Lỗi chạy Optimizer lúc boot:", e); }
});

let connectedClients = [];
wss.on('connection', (ws) => {
    connectedClients.push(ws);
    ws.on('close', () => connectedClients = connectedClients.filter(c => c !== ws));

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            if (msg.action === 'SUBSCRIBE_HUD') {
                ws.hudConfig = { symbol: msg.symbol, intervalTime: msg.intervalTime, indicatorSpecs: msg.indicatorSpecs };
                console.log(`[HUD TELEMETRY] Mở luồng cấp dữ liệu: ${msg.symbol} [${msg.intervalTime}]`);
                syncHUD(ws); 
            }
        } catch (e) {}
    });
});

const safeFetch = async (url) => {
    try { const res = await fetch(url); return res.ok ? await res.json() : null; } 
    catch (e) { return null; }
};

let btcReturnsCache = new Map();

async function runMatrixScanner() {
    if (connectedClients.length === 0) return; 
    console.log(`[RADAR] Bắt đầu chu kỳ quét Đa Khung Thời Gian (100% Dữ liệu thực)...`);
    const topSetups = [];

    try {
        // [VÁ LỖI 1]: Chỉ lấy các lệnh trong 12h qua để check Gate Cooldown chính xác nhất, tránh bị trôi dữ liệu khi limit(200)
        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

        const [ticker24hAll, premiumIndexAll, bookTickerAll, cmcData, accountInfo, leverageBracketsRes, tradeFeesRes, { data: tradeLogs }, exchangeInfoRes] = await Promise.all([
            safeFetch('https://fapi.binance.com/fapi/v1/ticker/24hr'),
            safeFetch('https://fapi.binance.com/fapi/v1/premiumIndex'),
            safeFetch('https://fapi.binance.com/fapi/v1/ticker/bookTicker'),
            safeFetch('http://localhost:1338/api/cmc'),
            readBinanceReq('/fapi/v2/account'),
            readBinanceReq('/fapi/v1/leverageBracket'), 
            readBinanceReq('/fapi/v1/commissionRate', { symbol: 'BTCUSDT' }),
            supabase.from('trade_logs')
        .select('*')
        .or(`status.in.(OPEN,PENDING),created_at.gte.${twelveHoursAgo}`)
        .order('created_at', { ascending: false }),
            safeFetch('https://fapi.binance.com/fapi/v1/exchangeInfo'),
            readBinanceReq('/fapi/v2/positionRisk') 
        ]);

        const premiumMap = new Map((premiumIndexAll || []).map(i => [i.symbol, i]));
        const bookMap = new Map((bookTickerAll || []).map(i => [i.symbol, i]));

        const minNotionalMap = new Map();
        const matureSymbols = new Set(); // BỘ LỌC TUỔI ĐỜI COIN
        const legacySymbols = new Set();
        const MATURE_AGE_MS = 730 * 24 * 60 * 60 * 1000; // Yêu cầu coin phải sống sót ít nhất 2 năm
        const LEGACY_AGE_MS = 1460 * 24 * 60 * 60 * 1000;
        const nowMs = Date.now();

        if (exchangeInfoRes && exchangeInfoRes.symbols) {
            exchangeInfoRes.symbols.forEach(sym => {
                // 1. Tính toán Min Notional
                const notionalFilter = sym.filters.find(f => f.filterType === 'MIN_NOTIONAL');
                if (notionalFilter) {
                    const baseVal = parseFloat(notionalFilter.notional || 5);
                    let bufferedVal = baseVal;
                    if (baseVal <= 5) bufferedVal = baseVal + 0.3;
                    else if (baseVal <= 10) bufferedVal = baseVal + 1.0;
                    else if (baseVal <= 20) bufferedVal = baseVal + 2.0;
                    else if (baseVal >= 50) bufferedVal = baseVal + 5.0;
                    else bufferedVal = baseVal * 1.1; 
                    minNotionalMap.set(sym.symbol, bufferedVal);
                }

                // 2. Thu thập các Coin đã trưởng thành
                if (sym.onboardDate) {
                    if ((nowMs - sym.onboardDate) > MATURE_AGE_MS) matureSymbols.add(sym.symbol);
                    if ((nowMs - sym.onboardDate) > LEGACY_AGE_MS) legacySymbols.add(sym.symbol);
                }
            });
        }

        // DANH SÁCH ĐEN MEME COIN (Bắt buộc giữ lại)
        const MEME_BLACKLIST = [
            'DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BONKUSDT', 
            'BOMEUSDT', 'WIFUSDT', 'MEMEUSDT', 'PEOPLEUSDT', '1000PEPEUSDT', 
            '1000FLOKIUSDT', '1000SHIBUSDT', '1000BONKUSDT', 'PNUTUSDT', 'NOTUSDT'
        ];

        let scanPool = POOL_SYMBOLS;
        if (ticker24hAll && Array.isArray(ticker24hAll)) {
            // 1. TẠO BỘ LỌC GỐC (Bỏ Meme, Bỏ râu nến dài, Bỏ coin rác)
            const baseTickers = ticker24hAll.filter(t => 
                t.symbol.endsWith('USDT') && 
                !POOL_SYMBOLS.includes(t.symbol) && 
                !MEME_BLACKLIST.includes(t.symbol) && 
                Math.abs(parseFloat(t.priceChangePercent)) < 15 && 
                ((parseFloat(t.highPrice) - parseFloat(t.lowPrice)) / parseFloat(t.lowPrice) * 100) < 25
            );

            // 2. NGÁCH TRENDING (30 Slot): > 2 năm tuổi, Volume > 30 Triệu USD
            const trendingTickers = baseTickers
                .filter(t => matureSymbols.has(t.symbol) && parseFloat(t.quoteVolume) > 30000000)
                .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
                .slice(0, 30)
                .map(t => t.symbol);

            // 3. NGÁCH LEGACY TECH (10 Slot): > 4 năm tuổi (DASH, NEO, ZEN...), Volume > 5 Triệu USD
            const legacyTickers = baseTickers
                .filter(t => legacySymbols.has(t.symbol) && 
                             !trendingTickers.includes(t.symbol) &&
                             parseFloat(t.quoteVolume) > 5000000)
                .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
                .slice(0, 10)
                .map(t => t.symbol);
            
            // 4. [BẢN VÁ TỬ HUYỆT]: Trích xuất các Coin đang có lệnh để Radar KHÔNG BAO GIỜ bỏ rơi
            const activeTrackingSymbols = [...new Set((tradeLogs || [])
                .filter(t => t.status === 'PENDING' || t.status === 'OPEN')
                .map(t => t.symbol)
            )];

            // 5. GỘP TOÀN BỘ VÀO RADAR (Pool cứng + Trending + Legacy + ĐANG THEO DÕI)
            scanPool = [...new Set([...POOL_SYMBOLS, ...trendingTickers, ...legacyTickers, ...activeTrackingSymbols])];
        }

        const liveCapital = accountInfo?.totalMarginBalance ? parseFloat(accountInfo.totalMarginBalance) : 0;
        const availableBal = accountInfo?.availableBalance ? parseFloat(accountInfo.availableBalance) : 0; // Kéo số dư thực tế
        const activeMakerFee = tradeFeesRes ? parseFloat(tradeFeesRes.makerCommissionRate) : 0.0002;
        const activeTakerFee = tradeFeesRes ? parseFloat(tradeFeesRes.takerCommissionRate) : 0.0004;

        const btcDomValue = cmcData?.btcDominance || 55.0;
        const fgiValue = cmcData?.fgiValue || 50;
        
        const now = new Date();
        const utcHour = now.getUTCHours();
        const day = now.getUTCDay();
        let tradingSession = 'ASIAN'; let sessionMultiplier = 0.8; 
        if (utcHour >= 8 && utcHour < 13) { tradingSession = 'LONDON'; sessionMultiplier = 1.2; }
        if (utcHour >= 13 && utcHour < 21) { tradingSession = 'NEW_YORK'; sessionMultiplier = 1.5; }
        if (day === 0 || day === 6) sessionMultiplier *= 0.5;

        const targetIntervals = ['5m', '15m', '1h', '4h', '1d'];
       
        const btcDomCache = new Map();
        const requiredMtfIntervals = ['15m', '1h', '4h', '1d', '1w'];
        
        await Promise.all(requiredMtfIntervals.map(async (mtf) => {
             try {
                 const domKlines = await safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCDOMUSDT&interval=${mtf}&limit=25`);
                 let slope = 0; let value = cmcData?.btcDominance || 55.0;
                 if (domKlines && domKlines.length >= 2) {
                     const domCloses = domKlines.map(d => parseFloat(d[4]));
                     value = domCloses[domCloses.length - 1];
                     slope = ((value - domCloses[0]) / domCloses[0]) * 100;
                 }
                 btcDomCache.set(mtf, { value, slope });
             } catch (e) {
                 btcDomCache.set(mtf, { value: 55.0, slope: 0 });
             }
        }));

        btcReturnsCache.clear();
        for (const interval of targetIntervals) {
             const btcKlines = await safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=250`);
             let returns = [];
             if (btcKlines && btcKlines.length > 1) {
                 const closes = btcKlines.map(d => parseFloat(d[4]));
                 for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i-1]) / closes[i-1]);
             }
             btcReturnsCache.set(interval, returns);
        }

        const defaultBrackets = [{ bracket: 1, initialLeverage: 125, notionalCap: 50000, notionalFloor: 0, maintMarginRatio: 0.004 }];

        // [VÁ LỖI 2]: CHUNKING BATCHING CHỐNG NGHẼN API
        const CHUNK_SIZE = 4; // Quét 4 coin cùng lúc (Tối đa 12 requests futures/s)
        
        for (let i = 0; i < scanPool.length; i += CHUNK_SIZE) {
            const chunk = scanPool.slice(i, i + CHUNK_SIZE);
            
            await Promise.all(chunk.map(async (symbol) => {

                let totalWinR = 0, winCount = 0, totalLossR = 0, lossCount = 0;
                const coinLogs = (tradeLogs || []).filter(t => t.symbol === symbol);
                
                coinLogs.forEach(t => {
                    if (t.status === 'WIN' || t.status === 'LOSS') {
                        const rMultiple = (parseFloat(t.pnl_usd) || 0) / (parseFloat(t.risk_amount_usd) || 1);
                        if (t.pnl_usd > 0) { totalWinR += rMultiple; winCount++; }
                        if (t.pnl_usd <= 0) { totalLossR += Math.abs(rMultiple); lossCount++; }
                    }
                });
                
                const totalClosed = winCount + lossCount;
                const winRate = totalClosed > 0 ? winCount / totalClosed : 0;
                const avgWinR = winCount > 0 ? (totalWinR / winCount) : 0;
                const avgLossR = lossCount > 0 ? (totalLossR / lossCount) : 1; 
                const historicalRR = avgLossR > 0 ? (avgWinR / avgLossR) : 0;

                let fundingSlopeValue = 0;
                try {
                    const fundingHist = await safeFetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=10`);
                    if (fundingHist && fundingHist.length >= 3) {
                        fundingSlopeValue = (parseFloat(fundingHist[fundingHist.length - 1].fundingRate) - parseFloat(fundingHist[fundingHist.length - 3].fundingRate)) * 100;
                    }
                } catch(e) {}

                const klineIntervals = ['5m', '15m', '1h', '4h', '1d', '1w', '1M'];
                const klinesCache = {};
                
                try {
                    const klinesPromises = klineIntervals.map(inv => safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${inv}&limit=250`));
                    const klinesResults = await Promise.all(klinesPromises);
                    klineIntervals.forEach((inv, idx) => { klinesCache[inv] = klinesResults[idx]; });
                } catch (err) { return; }

                for (const interval of targetIntervals) {
                    try {
                        let mtfInterval = '1h'; let htfInterval = '4h'; let macroInterval = interval;
                        if (interval === '5m') { mtfInterval = '15m'; htfInterval = '1h'; }
                        else if (interval === '15m') { mtfInterval = '1h'; htfInterval = '4h'; }
                        else if (interval === '1h') { mtfInterval = '4h'; htfInterval = '1d'; }
                        else if (interval === '4h') { mtfInterval = '1d'; htfInterval = '1w'; }
                        else if (interval === '1d') { mtfInterval = '1w'; htfInterval = '1M'; macroInterval = '1d'; }

                        const klinesLTF = klinesCache[interval];
                        const klinesMTF = klinesCache[mtfInterval];
                        const klinesHTF = klinesCache[htfInterval];

                        // [VÁ LỖI 3 TỬ HUYỆT]: Hạ klinesHTF.length từ < 10 xuống < 4. Khung D1 sẽ chết đứng nếu check 10 tháng nến!
                        if (!klinesLTF || !klinesMTF || !klinesHTF || klinesLTF.length < 100 || klinesMTF.length < 30 || klinesHTF.length < 4) continue;

                       const [oiHist, takerData, lsPosData, depthData] = await Promise.all([
                            safeFetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${macroInterval}&limit=30`),
                            safeFetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=${macroInterval}&limit=1`),
                            safeFetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=${macroInterval}&limit=1`),
                            safeFetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=200`) // GỌI MỚI
                        ]);

                        const opens = klinesLTF.map(d => parseFloat(d[1]));
                        const highs = klinesLTF.map(d => parseFloat(d[2]));
                        const lows = klinesLTF.map(d => parseFloat(d[3]));
                        const closes = klinesLTF.map(d => parseFloat(d[4]));
                        const volumes = klinesLTF.map(d => parseFloat(d[7])); 
                        
                        const buyVols = klinesLTF.map(d => parseFloat(d[10]));
                        const sellVols = volumes.map((v, i) => v - buyVols[i]);
                        const vpinValue = QuantMath.vpin(buyVols, sellVols, volumes, 50);

                        const closesMTF = klinesMTF.map(d => parseFloat(d[4]));
                        const closesHTF = klinesHTF.map(d => parseFloat(d[4]));

                        const currentPrice = closes[closes.length - 1];
                        const avgVolume20 = QuantMath.sma(volumes.slice(0, -1), 20);
                        const htfSma200 = QuantMath.sma(closesHTF, 200);

                        let obi = 0.5; let realSpreadPct = 0.05;
                        const bookTick = bookMap.get(symbol);
                        if (bookTick && bookTick.bidPrice && bookTick.askPrice) {
                            const bid = parseFloat(bookTick.bidPrice);
                            const ask = parseFloat(bookTick.askPrice);
                            if (bid > 0) realSpreadPct = ((ask - bid) / bid) * 100;
                            const bidQty = parseFloat(bookTick.bidQty || 0); const askQty = parseFloat(bookTick.askQty || 0);
                            if (bidQty + askQty > 0) obi = bidQty / (bidQty + askQty);
                        }

                        const takerBuySellRatio = takerData?.length ? parseFloat(takerData[0].buySellRatio) : 1.0;
                        const lsPositionVolRatio = lsPosData?.length ? parseFloat(lsPosData[0].longShortRatio) : 1.0;
                        
                        const premTick = premiumMap.get(symbol);
                        const fundingRateValue = premTick ? parseFloat(premTick.lastFundingRate) * 100 : 0.01;

                        const oiValues = Array.isArray(oiHist) ? oiHist.map(d => parseFloat(d.sumOpenInterestValue) || 0) : [0];
                        const oiEma14 = QuantMath.ema(oiValues, 14) || oiValues[oiValues.length - 1] || 0;
                        let oiDelta = 0;
                        if (oiValues.length >= 2) {
                            const prevOi = oiValues[oiValues.length - 2];
                            if (prevOi > 0) oiDelta = ((oiValues[oiValues.length - 1] - prevOi) / prevOi) * 100;
                        }

                        const apiMacro = { realSpreadPct, takerBuySellRatio, longShortRatio: 1.0, fgiValue, tradingSession, sessionMultiplier, lsPositionVolRatio };

                        const atr14 = QuantMath.atr(highs, lows, closes, 14);
                        const rsi = QuantMath.rsi(closes, 14);
                        const adx = QuantMath.adx(highs, lows, closes, 14);
                        const cmf = QuantMath.cmf(highs, lows, closes, volumes, 20);
                        
                        const atrHist = []; for(let j=14; j<closes.length; j++) atrHist.push(QuantMath.atr(highs.slice(0, j+1), lows.slice(0, j+1), closes.slice(0, j+1), 14));
                        const atrRank = QuantMath.percentileRank(atr14, atrHist.slice(-100));

                        const bbwHist = []; for (let j = 20; j < closes.length; j++) bbwHist.push(QuantMath.bollinger(closes.slice(0, j+1), 20, 2).bbw);
                        const bollinger20 = QuantMath.bollinger(closes, 20, 2);
                        const bbwRank = QuantMath.percentileRank(bollinger20.bbw, bbwHist.slice(-100));
                        const bbwSlope = bbwHist.length >= 5 ? ((bollinger20.bbw - bbwHist[bbwHist.length - 5]) / (bbwHist[bbwHist.length - 5] || 1)) * 100 : 0;

                        const scan20_50 = QuantMath.scanEmaRange(closesMTF, 20, 50, 20);
                        const scan50_200 = QuantMath.scanEmaRange(closesMTF, 50, 200, 20);

                       

                        const isBullishSFP = QuantMath.detectSFP_Institutional_Advanced(highs, lows, closes, opens, volumes, avgVolume20, atr14, 'LONG');
                        const isBearishSFP = QuantMath.detectSFP_Institutional_Advanced(highs, lows, closes, opens, volumes, avgVolume20, atr14, 'SHORT');
                        const msbData = QuantMath.detectMarketStructure(highs, lows, closes);
                        

                        const altReturns = [];
                        for (let j = 1; j < closes.length; j++) altReturns.push((closes[j] - closes[j-1]) / closes[j-1]);

                        const amihudValue = QuantMath.amihudIlliquidity(altReturns, volumes.slice(1));
                        let isiValue = 0;
                        const btcReturnsCurrent = btcReturnsCache.get(interval);

                        if (btcReturnsCurrent && altReturns.length > 0) {
                            const minLen = Math.min(btcReturnsCurrent.length, altReturns.length);
                            const alignedBtc = btcReturnsCurrent.slice(-minLen);
                            const alignedAlt = altReturns.slice(-minLen);
                            
                            if (minLen > 10) {
                                isiValue = QuantMath.immediateSensitivityIndicator(alignedAlt, alignedBtc, 5);
                            }
                        }

                        const btcDomData = btcDomCache.get(mtfInterval) || { value: cmcData?.btcDominance || 55.0, slope: 0 };
                        const btcDomValue = btcDomData.value;
                        const btcDomSlope = btcDomData.slope;
                        const macdValue = QuantMath.macd(closes, 12, 26, 9);

                        // 🧠 TÍNH TOÁN CÁC CHỈ BÁO LƯỢNG TỬ MỚI
                        const { currentCVD, cvdTrend } = QuantMath.cvd(volumes, buyVols, 50);
                        const { vwap, upper2, lower2 } = QuantMath.vwapWithBands(highs, lows, closes, volumes, closes.length);
                        const hurstValue = QuantMath.hurst(closes, 100);
                        
          
                        let dynamicObi = obi; 
                        if (depthData && depthData.bids && depthData.asks) {
                            const scanDepthPct = (atr14 * 0.7) / currentPrice; 
                            dynamicObi = QuantMath.orderBookHeatmap(depthData.bids, depthData.asks, currentPrice, scanDepthPct);
                        }

                        // Kéo dữ liệu Cháy Tài Khoản
                        const liqData = liquidationsCache.get(symbol) || { longs: 0, shorts: 0 };
                        // LÕI DATA NGUYÊN BẢN (KHÔNG CẮT XÉN)
                        const autoData = {
                            currentPrice, atr14, atrPercent: (atr14/currentPrice)*100, atrRank, bbwRank, bbw: bollinger20.bbw, bbwSlope, cmf, rsi, 
                            obi: dynamicObi, // ĐÃ NÂNG CẤP LÊN HEATMAP 1.5%
                            adx, vpinValue, 
                            cvdTrend, vwap, vwapUpper: upper2, vwapLower: lower2, hurstValue, // CÁC BIẾN MỚI
                            liqLongsVol: liqData.longs, liqShortsVol: liqData.shorts,
                            fundingRate: fundingRateValue, fundingSlope: fundingSlopeValue, 
                            lastClosedVolume: volumes[volumes.length - 2], avgVolume20, htfSma200,
                            ema20: { slope: scan20_50.fastSlope, value: scan20_50.fastEmaCurrent },
                            ema50: { slope: scan20_50.slowSlope, value: scan20_50.slowEmaCurrent },
                            ema200: { slope: scan50_200.slowSlope, value: scan50_200.slowEmaCurrent },
                            isBullishSFP, isBearishSFP,
                            amihud: amihudValue,
                            isi: isiValue,
                            currentVolume: volumes[volumes.length - 1], 
                            oiDelta, isOiSpiking: oiValues[oiValues.length-1] > oiEma14, btcDomValue, btcDomSlope,
                            macd: macdValue,
                            msbRegime: msbData.regime, msbState: msbData.msbState, msbIsSFP: msbData.isSFP,
                            vpinValue
                        };

                        const vectorRegime = QuantMath.evaluateVectorState(autoData, apiMacro, globalMvrvZScore, symbol);
                        const vectorDetails = vectorRegime.details;
                        const { l1, l2 } = vectorDetails;
                        
                        let realUsdVolume24h = 0;
                        if (ticker24hAll && Array.isArray(ticker24hAll)) {
                            const tData = ticker24hAll.find(t => t.symbol === symbol);
                            if (tData) realUsdVolume24h = parseFloat(tData.quoteVolume);
                        }
                        if (!realUsdVolume24h) realUsdVolume24h = (autoData.avgVolume20 || 0) * currentPrice * 24; 
                        const assetTier = QuantMath.classifyAssetTier(symbol, realUsdVolume24h, apiMacro.realSpreadPct);

                        // 🚨 HỆ THỐNG CỨU HỘ ĐA TẦNG (ORDER INVALIDATION ENGINE)
                        // VALID CHÉO: [1] Cấu trúc (MSB) + [2] Dòng tiền (CMF/VPIN) + [3] Động lượng (EMA/MACD)
                        const activePendingLogs = coinLogs.filter(t => t.status === 'PENDING' && t.interval === interval);
                        const activeOpenLogs = coinLogs.filter(t => t.status === 'OPEN' && t.interval === interval);

                        // KỊCH BẢN 1: TÁI CHẤM ĐIỂM & ĐÓNG DẤU DỮ LIỆU LỆNH PENDING (DYNAMIC RE-EVALUATION)
                        for (const pLog of activePendingLogs) {
                            // 1. Phục dựng lại Lõi Toán Học từ lệnh cũ với Dữ liệu Thị trường Tươi sống (Fresh Market Data)
                            const pLogEntry = parseFloat(pLog.entry);
                            const pLogSl = parseFloat(pLog.sl);
                            const pLogDir = pLog.direction;
                            const pLogTradeType = pLog.type || 'FUTURES';

                            // Bốc lại Model AI đang áp dụng
                            const tierModelBase = currentAiModel?.tiers?.[assetTier] || currentAiModel?.global || currentAiModel;
                            const stratNameClean = pLog.strategy_name ? pLog.strategy_name.replace(' [BOT]', '') : "🤖 AI ADAPTIVE";
                            const matrixKey = `${stratNameClean}|${assetTier}`;
                            const activeModel = currentAiModel?.matrix?.[matrixKey] || currentAiModel?.strategies?.[stratNameClean] || tierModelBase;

                            // 2. Chấm điểm lại (Softgate & Hardgate)
                            const pLogScore = TradeValidator.evaluateScore(autoData, apiMacro, vectorDetails, pLogDir, globalMvrvZScore, symbol, activeModel);
                            
                            // Giả lập MathCore cơ bản để cho chạy qua Gate
                            const mockMathCore = {
                                appliedRiskPercent: parseFloat(pLog.applied_risk_pct || 1),
                                positionSizeUSD: parseFloat(pLog.position_size_usd || 10),
                                theoreticalRR: parseFloat(pLog.rr || 1.5),
                                trueEVValue: autoData.true_ev || 1.0, 
                                liqEstimate: null, // Đã đặt lệnh thành công nên không check lại thanh lý sàn
                                leverageExceedsExchangeCap: false,
                                liqSafetyMargin: 1.5,
                                dynamicSlDistance: Math.abs(pLogEntry - pLogSl),
                                hasInsufficientMargin: false,
                                hasMinNotionalError: false
                            };

                            const pLogGates = TradeValidator.evaluateGates(autoData, apiMacro, vectorDetails, mockMathCore, pLogDir, pLogTradeType, pLogEntry, pLogSl, pLogScore, coinLogs, symbol, stratNameClean);

                            // 3. RA QUYẾT ĐỊNH
                            if (!pLogGates.isApproved) {
                                // RỚT ĐÀI: Gãy Hard Gate hoặc Softgate tụt thảm hại
                                const failedHardGates = pLogGates.hardGates.filter(g => !g.passed).map(g => g.id).join(', ');
                                const failReason = failedHardGates ? `HARD_GATES: ${failedHardGates}` : `SOFT_SCORE_LOW: ${pLogScore.score.toFixed(1)}`;
                                
                                console.log(`[🛡️ DYNAMIC SHIELD] Hủy lệnh PENDING ${symbol}. Bị rớt đài lúc chờ khớp! Lỗi: ${failReason}`);
                                
                                try {
                                    await sendBinanceReq('DELETE', '/fapi/v1/allOpenOrders', { symbol });
                                    await supabase.from('trade_logs').update({ 
                                        status: 'CANCELED', 
                                        exit_reason: `GATES_INVALIDATED [${failReason}]` 
                                    }).eq('id', pLog.id);
                                } catch(e) {}
                            } else {
                                // VẪN PASS: Liên tục đóng dấu (Stamp) các thông số Lượng tử MỚI NHẤT vào Database
                                // Đảm bảo lúc lệnh thực sự Khớp, dữ liệu trên DB phản ánh đúng giây phút đó!
                                try {
                                    await supabase.from('trade_logs').update({
                                        adx: parseFloat(autoData.adx),
                                        atr: parseFloat(autoData.atr14),
                                        rsi: parseFloat(autoData.rsi),
                                        cmf: parseFloat(autoData.cmf),
                                        bbw_rank: parseInt(autoData.bbwRank),
                                        oi_delta: parseFloat(autoData.oiDelta || 0),
                                        funding_rate: parseFloat(fundingRateValue),
                                        funding_slope: parseFloat(fundingSlopeValue || 0),
                                        taker_ratio: parseFloat(apiMacro.takerBuySellRatio || 1),
                                        btc_dom_slope: parseFloat(autoData.btcDomSlope || 0),
                                        vpin: parseFloat(autoData.vpinValue || 0),
                                        obi: parseFloat(dynamicObi || 0.5),
                                        amihud: parseFloat(amihudValue || 0),
                                        isi: parseFloat(isiValue || 0),
                                        cvd_trend: parseFloat(autoData.cvdTrend || 0),
                                        vwap: parseFloat(autoData.vwap || 0),
                                        vwap_upper: parseFloat(autoData.vwapUpper || 0),
                                        vwap_lower: parseFloat(autoData.vwapLower || 0),
                                        hurst_value: parseFloat(autoData.hurstValue || 0),
                                        liq_longs_vol: parseFloat(liqData.longs || 0),
                                        liq_shorts_vol: parseFloat(liqData.shorts || 0),
                                        soft_score: parseFloat(pLogScore.score),
                                        gate_s1: pLogGates.softGates.find(g => g.id === 's1')?.passed || false,
                                        gate_s2: pLogGates.softGates.find(g => g.id === 's2')?.passed || false,
                                        gate_s3: pLogGates.softGates.find(g => g.id === 's3')?.passed || false,
                                        gate_s4: pLogGates.softGates.find(g => g.id === 's4')?.passed || false,
                                        gate_s5: pLogGates.softGates.find(g => g.id === 's5')?.passed || false,
                                        gate_s6: pLogGates.softGates.find(g => g.id === 's6')?.passed || false,
                                        gate_s7: pLogGates.softGates.find(g => g.id === 's7')?.passed || false,
                                        gate_s8: pLogGates.softGates.find(g => g.id === 's8')?.passed || false,
                                        l1_structure: vectorDetails.l1, 
                                        l2_volatility: vectorDetails.l2, 
                                        l3_liq_event: vectorDetails.l3,
                                        l4_positioning: vectorDetails.l4, 
                                        l5_momentum: vectorDetails.l5, 
                                        l6_macro: vectorDetails.l6,
                                        trend_sma200: autoData.currentPrice > autoData.htfSma200 ? 'UP' : 'DOWN'
                                    }).eq('id', pLog.id);
                                } catch (e) {}
                            }
                        }

                        // KỊCH BẢN 2: THOÁT HIỂM KHẨN CẤP (PANIC SELL) CHO LỆNH ĐÃ KHỚP (OPEN)
                        // Cắt máu sớm (Chấp nhận lỗ 0.2R thay vì đợi SL mất 1.0R)
                        for (const oLog of activeOpenLogs) {
                            const isLong = oLog.direction === 'LONG';
                            const severeStructureBreak = isLong ? msbData.msbState === 'Bearish_MSB' : msbData.msbState === 'Bullish_MSB';
                            const severeFlow = isLong ? cmf < -0.05 : cmf > 0.05;
                            const priceLostEma50 = isLong ? currentPrice < scan20_50.slowEmaCurrent : currentPrice > scan20_50.slowEmaCurrent;

                            if (severeStructureBreak && severeFlow && priceLostEma50) {
                                const position = positionsRisk?.find(p => p.symbol === symbol);
                                if (position && parseFloat(position.positionAmt) !== 0) {
                                    const posAmt = parseFloat(position.positionAmt);
                                    // Valid hướng vị thế thực tế
                                    if ((isLong && posAmt > 0) || (!isLong && posAmt < 0)) {
                                        console.log(`[🚨 PANIC SELL] Vị thế ${symbol} gãy cấu trúc HTF! Nhảy tàu khẩn cấp!`);
                                        try {
                                            const closeSide = isLong ? 'SELL' : 'BUY';
                                            // Đóng Market chính xác số lượng đang cầm
                                            await sendBinanceReq('POST', '/fapi/v1/order', {
                                                symbol: symbol, side: closeSide, type: 'MARKET', quantity: Math.abs(posAmt), reduceOnly: "true"
                                            });
                                            // Xóa sổ các rào chắn SL/TP cũ
                                            await sendBinanceReq('DELETE', '/fapi/v1/allOpenOrders', { symbol });
                                            // Ghi sổ cái
                                            await supabase.from('trade_logs').update({ status: 'CLOSED', close_price: currentPrice, exit_reason: 'PANIC_SELL_REVERSAL' }).eq('id', oLog.id);
                                        } catch(e) {
                                            console.log(`Lỗi Panic Sell ${symbol}:`, e.message);
                                        }
                                    }
                                }
                            }
                        }

                        // 0. Lấy Tier Model làm nền tảng cơ sở
                        const tierModelBase = currentAiModel?.tiers?.[assetTier] || currentAiModel?.global || currentAiModel;
                        
                        const directions = ['LONG', 'SHORT'];
                        for (const direction of directions) {
                            
                            // 1. GỌI HÀM ĐỂ XÁC ĐỊNH TÊN CHIẾN THUẬT (Dùng Tier Model làm nền)
                            const { tpMult, slMult, strategyName, execType, suggestedEntry } = QuantMath.dynamicAsymmetricTargets(
                                autoData, 
                                apiMacro, 
                                vectorDetails, 
                                direction, 
                                tierModelBase,
                                assetTier
                            );

                            // 2. ĐÃ CÓ TÊN CHIẾN THUẬT -> BỐC MODEL MA TRẬN
                            const matrixKey = `${strategyName}|${assetTier}`;
                            const stratModel = currentAiModel?.strategies?.[strategyName];
                            const matrixModel = currentAiModel?.matrix?.[matrixKey];

                            // Ưu tiên cao nhất: Ma Trận -> Chiến Thuật -> Tier
                            const activeModel = matrixModel || stratModel || tierModelBase;

                            // 3. ĐƯA ACTIVE MODEL VÀO CHẤM ĐIỂM
                            const systemScoreTmp = TradeValidator.evaluateScore(
                                autoData, apiMacro, vectorDetails, direction, globalMvrvZScore, symbol, activeModel
                            );
                            

                            
                            const slTech = direction === 'LONG' ? suggestedEntry - (slMult * atr14) : suggestedEntry + (slMult * atr14);
                            const tp1 = direction === 'LONG' ? suggestedEntry + (tpMult * atr14) : suggestedEntry - (tpMult * atr14);
                            const riskDiffTech = Math.abs(suggestedEntry - slTech);

                            let cRegime = 1.0
                            const l1Str = String(l1 || "");
                            if (l1Str.includes('Trend')) { cRegime = 1.2; } 
                            else if (l2 === 'Extreme') { cRegime = 0.5; } 
                            else { cRegime = 0.8; }

                            const tHold = QuantMath.calculateTemporalBarrier(interval, 'FUTURES', direction, vectorDetails, assetTier, utcHour);

                            const minSafeAtr = 0.005; 
                            const isCompressed = l2 === 'Compression' || autoData.bbwRank < 20;
                            const effectiveAtrPercent = isCompressed ? Math.max(autoData.atrPercent, minSafeAtr * 100) * 1.5 : autoData.atrPercent;
                            const slippageBuffer = suggestedEntry * (effectiveAtrPercent / 100) * cRegime * sessionMultiplier; 
                            const sizeSlDistance = riskDiffTech + slippageBuffer; 

                            let slPercentForSize = sizeSlDistance / suggestedEntry;
                            if (!isFinite(slPercentForSize) || isNaN(slPercentForSize) || slPercentForSize === 0) slPercentForSize = 0.01;

                            const costDragLoss = QuantMath.costDrag(suggestedEntry, 'FUTURES', direction, 'LIMIT', 'MARKET', fundingRateValue/100, realSpreadPct, tHold, activeMakerFee, activeTakerFee, interval, obi);
                            const costDragWin = QuantMath.costDrag(suggestedEntry, 'FUTURES', direction, 'LIMIT', 'LIMIT', fundingRateValue/100, realSpreadPct, tHold, activeMakerFee, activeTakerFee, interval, obi);
                            const rewardDiff1 = Math.abs(tp1 - suggestedEntry);
                            
                            let theoreticalRR = riskDiffTech > 0 ? ((rewardDiff1 - costDragWin) / (riskDiffTech + costDragLoss)) : 0;
                            if (!isFinite(theoreticalRR) || isNaN(theoreticalRR) || theoreticalRR < 0) theoreticalRR = 0;

                            const bayesianPrior = 0.45; 
                            const effWinRate = totalClosed < 30 ? ((bayesianPrior * (30 - totalClosed) + (winRate || 0) * totalClosed) / 30) : winRate; 
                            const effLossRate = 1 - effWinRate;
                            const trueEVCalc = QuantMath.trueEV(effWinRate, theoreticalRR, effLossRate, 1);
                            const kellyDec = QuantMath.kellyCriterion(winRate, historicalRR, totalClosed);

                            const evalCapital = liveCapital > 0 ? liveCapital : 1000; 
                            const passingScore = systemScoreTmp.passingScore || 50;
                            const scoreRange = 100 - passingScore;
                            const riskMultiplier = Math.max(0.5, Math.min(2.0, 0.5 + ((systemScoreTmp.score - passingScore) / scoreRange) * 1.5));
                            const baseRiskPct = activeModel?.dynamic_targets?.optimized?.suggested_risk_pct || 1.0;
                            let appliedRiskPercent = baseRiskPct * riskMultiplier;

                            let riskAmountUSD = evalCapital * (appliedRiskPercent / 100);
                            let positionSizeUSD = riskAmountUSD / slPercentForSize; 
                            if (!isFinite(positionSizeUSD) || isNaN(positionSizeUSD)) positionSizeUSD = 0;

                            const targetMinThreshold = minNotionalMap.get(symbol) || 5.3; 
                            if (positionSizeUSD > 0 && positionSizeUSD < targetMinThreshold) {
                                positionSizeUSD = targetMinThreshold; 
                            }

                            let minRequiredLev = evalCapital > 0 ? positionSizeUSD / (evalCapital * 0.9) : 1;
                            let suggestedLeverage = Math.max(1, Math.ceil(minRequiredLev));
                            const marginUsedUSD = positionSizeUSD / suggestedLeverage; // Tính Margin thực tế

                            let liqEstimate = null; let leverageExceedsExchangeCap = false; let liqSafetyMargin = 0;
                            const brackets = Array.isArray(leverageBracketsRes) ? (leverageBracketsRes.find(b => b.symbol === symbol)?.brackets || defaultBrackets) : defaultBrackets;

                            if (brackets) {
                                liqEstimate = QuantMath.estimateLiquidation(positionSizeUSD, suggestedLeverage, currentPrice, direction, brackets);
                                if (liqEstimate) {
                                    if (suggestedLeverage > liqEstimate.maxLevForTier) {
                                        leverageExceedsExchangeCap = true; 
                                        suggestedLeverage = liqEstimate.maxLevForTier; 
                                        liqEstimate = QuantMath.estimateLiquidation(positionSizeUSD, suggestedLeverage, currentPrice, direction, brackets);
                                    }
                                    const liqDistancePct = Math.abs(currentPrice - liqEstimate.liqPrice) / currentPrice;
                                    const dynamicSlPct = sizeSlDistance / currentPrice; 
                                    liqSafetyMargin = dynamicSlPct > 0 ? (liqDistancePct / dynamicSlPct) : 0; 
                                }
                            }

                            // [VÁ LỖI 4]: ĐỒNG BỘ HOÀN TOÀN CÁC CỜ MARGIN ĐỂ GATE H4 PASS Y HỆT TRÊN HUD
                            const mathCoreReal = { 
                                appliedRiskPercent: appliedRiskPercent.toFixed(2),
                                slPercentForSize: (slPercentForSize * 100).toFixed(2),
                                riskAmountUSD: riskAmountUSD.toFixed(2),
                                positionSizeUSD: positionSizeUSD.toFixed(2),
                                suggestedLeverage, 
                                theoreticalRR: theoreticalRR.toFixed(2), 
                                trueEVValue: trueEVCalc.toFixed(3), 
                                kellyPct: (kellyDec * 100).toFixed(2),
                                liqEstimate, 
                                liqSafetyMargin, 
                                leverageExceedsExchangeCap,
                                dynamicSlDistance: sizeSlDistance,
                                hasInsufficientMargin: marginUsedUSD > availableBal, 
                                hasMinNotionalError: riskAmountUSD > (evalCapital * 0.05),
                                tHold
                            };

                            let finalTradeType = 'FUTURES';
                            let gates = TradeValidator.evaluateGates(autoData, apiMacro, vectorDetails, mathCoreReal, direction, 'FUTURES', suggestedEntry, slTech, systemScoreTmp, tradeLogs || [], symbol, strategyName);
                            
                            // Nếu Futures tịt vì Margin (Gate H4), thử nảy qua SPOT xem pass không!
                            if (!gates.isApproved && gates.hardGates.find(g => g.id === 'h4' && !g.passed)) {
                                const spotGates = TradeValidator.evaluateGates(autoData, apiMacro, vectorDetails, mathCoreReal, direction, 'SPOT', suggestedEntry, slTech, systemScoreTmp, tradeLogs || [], symbol, strategyName);
                                if (spotGates.isApproved) {
                                    gates = spotGates;
                                    finalTradeType = 'SPOT';
                                }
                            }
                            
                            if (gates.isApproved) {
                                topSetups.push({
                                    // DỮ LIỆU THỰC THI (Cho Binance)
                                    symbol, interval, direction, assetTier, tradeType: finalTradeType,
                                    entry: suggestedEntry.toFixed(4), slTech: slTech.toFixed(4), tp1: tp1.toFixed(4),
                                    theoreticalRR: theoreticalRR.toFixed(2),
                                    suggestedLeverage: finalTradeType === 'SPOT' ? 1 : Math.max(1, Math.ceil(sizeSlDistance / currentPrice * 100)),
                                    overrideTag: strategyName,
                                    execType: execType,
                                    score: systemScoreTmp.score,
                                    tHold: tHold,

                                    // ==========================================
                                    // DỮ LIỆU ĐỂ BOT LƯU SUPABASE (CamelCase)
                                    // ==========================================
                                    adx: autoData.adx,
                                    atr: autoData.atr14,
                                    rsi: autoData.rsi,
                                    cmf: autoData.cmf,
                                    bbwRank: autoData.bbwRank,
                                    oiDelta: autoData.oiDelta || 0,
                                    fundingRate: fundingRateValue,
                                    fundingSlope: fundingSlopeValue,
                                    takerRatio: apiMacro.takerBuySellRatio,
                                    btcDomSlope: autoData.btcDomSlope,
                                    mvrv: globalMvrvZScore,
                                    fgi: apiMacro.fgiValue,
                                    
                                    vpin: autoData.vpinValue,
                                    obi: obi,
                                    amihud: amihudValue,
                                    isi: isiValue,
                                    // 🚀 BỔ SUNG 7 BIẾN LƯỢNG TỬ TRUYỀN CHO BOT VÀO ĐÂY:
                                    cvdTrend: autoData.cvdTrend,
                                    vwap: autoData.vwap,
                                    vwapUpper: autoData.vwapUpper,
                                    vwapLower: autoData.vwapLower,
                                    hurstValue: autoData.hurstValue,
                                    liqLongsVol: autoData.liqLongsVol,
                                    liqShortsVol: autoData.liqShortsVol,
                                    trueEV: mathCoreReal.trueEVValue,
                                    kellyPct: mathCoreReal.kellyPct,
                                    
                                    trendSma200: currentPrice > htfSma200 ? 'UP' : 'DOWN',
                                    session: apiMacro.tradingSession,
                                    marketRegime: vectorDetails.vector ? vectorDetails.vector.join(' | ') : '',
                                    l1: vectorDetails.l1, 
                                    l2: vectorDetails.l2, 
                                    l3: vectorDetails.l3,
                                    l4: vectorDetails.l4, 
                                    l5: vectorDetails.l5, 
                                    l6: vectorDetails.l6,
                                    
                                    gateS1: systemScoreTmp.checks.checkS1 || false,
                                    gateS2: systemScoreTmp.checks.checkS2 || false,
                                    gateS3: systemScoreTmp.checks.checkS3 || false,
                                    gateS4: systemScoreTmp.checks.checkS4 || false,
                                    gateS5: systemScoreTmp.checks.checkS5 || false,
                                    gateS6: systemScoreTmp.checks.checkS6 || false,
                                    gateS7: systemScoreTmp.checks.checkS7 || false,
                                    gateS8: systemScoreTmp.checks.checkS8 || false,
                                    
                                    epochId: currentAiModel ? 'epoch-matrix-active' : 'epoch-alpha-001'
                                });
                            }
                        }
                    } catch (err) {
                        // Log ra terminal của VSCode/Node.js để track lỗi
                        console.warn(`[SCANNER DROP] Coin ${symbol} khung ${interval} bị loại do lỗi: ${err.message}`);
                    }
                }
            }));
            
            // Nhịp nghỉ siêu nhỏ (300ms) để không dính Error WAF của Binance
            await new Promise(r => setTimeout(r, 300));
        }

        topSetups.sort((a, b) => parseFloat(b.theoreticalRR) - parseFloat(a.theoreticalRR));
        connectedClients.forEach(client => { if (client.readyState === 1) client.send(JSON.stringify({ type: 'SCAN_RESULTS', data: topSetups, isNewSignal: topSetups.length > 0 })); });
        console.log(`[RADAR] Chu kỳ hoàn tất. Bắt được ${topSetups.length} Setups trên ${scanPool.length} Coins (5 Khung).`);
    } catch (e) { console.error("[RADAR] Lỗi Engine Scanner:", e); }
}

// BẢN VÁ: Vòng lặp đệ quy chống Kẹt xe Đa luồng (Overlapping Scanners)
async function matrixScannerLoop() {
    await runMatrixScanner();
    setTimeout(matrixScannerLoop, 60000); // Chỉ bắt đầu đếm 60s SAU KHI đã quét xong hoàn toàn
}
setTimeout(matrixScannerLoop, 5000);

const readBinanceReq = async (endpoint, paramsObj = {}) => {
    const params = new URLSearchParams(paramsObj);
    params.append('timestamp', (Date.now() + timeOffset).toString());
    params.append('recvWindow', '10000');
    const qs = params.toString();
    const sig = crypto.createHmac('sha256', READ_API_SECRET).update(qs).digest('hex');
    try {
        const res = await fetch(`https://fapi.binance.com${endpoint}?${qs}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': READ_API_KEY } });
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
};

async function syncHUD(ws) {
    if (!ws.hudConfig) return;
    const { symbol, intervalTime, indicatorSpecs } = ws.hudConfig;
    
    try {
        let mtfInterval = '1h'; let htfInterval = '4h'; let macroInterval = intervalTime;
        if (intervalTime === '5m') { mtfInterval = '15m'; htfInterval = '1h'; }
        else if (intervalTime === '15m') { mtfInterval = '1h'; htfInterval = '4h'; }
        else if (intervalTime === '1h') { mtfInterval = '4h'; htfInterval = '1d'; }
        else if (intervalTime === '4h') { mtfInterval = '1d'; htfInterval = '1w'; }
        else if (intervalTime === '1d') { mtfInterval = '1w'; htfInterval = '1M'; macroInterval = '1d'; }

        const cacheKey = `static_${symbol}`;
        let leverageBracketsRes, tradeFeesRes;
        
        if (staticExchangeCache.has(cacheKey) && Date.now() - staticExchangeCache.get(cacheKey).ts < 3600000) {
             const cached = staticExchangeCache.get(cacheKey);
             leverageBracketsRes = cached.brackets;
             tradeFeesRes = cached.fees;
        } else {
             leverageBracketsRes = await readBinanceReq('/fapi/v1/leverageBracket', { symbol });
             tradeFeesRes = await readBinanceReq('/fapi/v1/commissionRate', { symbol });
             staticExchangeCache.set(cacheKey, { ts: Date.now(), brackets: leverageBracketsRes, fees: tradeFeesRes });
        }

        const [
            klinesLTF, klinesMTF, klinesHTF, fundingHist, oiCurrent, oiHist,
            lsAccData, lsPosData, takerData, positionsRisk, accountInfo,
            btcDomKlines, realBookTicker, realPremiumIndex, cmcDataRaw,
            ticker24hData
        ] = await Promise.all([
            safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${intervalTime}&limit=250`),
            safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${mtfInterval}&limit=250`),
            safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${htfInterval}&limit=250`),
            safeFetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=10`),
            safeFetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
            safeFetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${macroInterval}&limit=30`),
            safeFetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${macroInterval}&limit=1`),
            safeFetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=${macroInterval}&limit=1`),
            safeFetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=${macroInterval}&limit=1`),
            readBinanceReq('/fapi/v2/positionRisk'),
            readBinanceReq('/fapi/v2/account'),
            safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCDOMUSDT&interval=${mtfInterval}&limit=25`),
            safeFetch(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${symbol}`),
            safeFetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),
            safeFetch('http://localhost:1338/api/cmc'),
            safeFetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`)
        ]);

        if (!klinesLTF) return;

        const liveCapital = accountInfo?.totalMarginBalance ? parseFloat(accountInfo.totalMarginBalance) : 0;
        const availableBalance = accountInfo?.availableBalance ? parseFloat(accountInfo.availableBalance) : 0; 
        const binancePositions = positionsRisk && Array.isArray(positionsRisk) ? positionsRisk.filter(p => parseFloat(p.positionAmt) !== 0) : [];
        const leverageBrackets = Array.isArray(leverageBracketsRes) ? leverageBracketsRes[0]?.brackets : null;
        const tradeFees = tradeFeesRes ? { maker: parseFloat(tradeFeesRes.makerCommissionRate), taker: parseFloat(tradeFeesRes.takerCommissionRate) } : null;
        const cmcData = { btcDominanceRealtime: cmcDataRaw?.btcDominance || 55.0, fgiClassification: cmcDataRaw?.fgiClassification || 'NEUTRAL', totalMarketCapBillion: 0 };

        let realSpreadPct = 0.05; let obi = 0.5;
        if (realBookTicker && realBookTicker.bidPrice && realBookTicker.askPrice) {
            const bid = parseFloat(realBookTicker.bidPrice);
            const ask = parseFloat(realBookTicker.askPrice);
            if (bid > 0) realSpreadPct = ((ask - bid) / bid) * 100;
            const bidQty = parseFloat(realBookTicker.bidQty || 0); const askQty = parseFloat(realBookTicker.askQty || 0);
            if (bidQty + askQty > 0) obi = bidQty / (bidQty + askQty);
        }

        // [VÁ LỖI TỘI ĐỒ 3] ĐỒNG BỘ SESSION MULTIPLIER
        const now = new Date();
        const utcHour = now.getUTCHours();
        const day = now.getUTCDay();
        let tradingSession = 'ASIAN'; let sessionMultiplier = 0.8; 
        if (utcHour >= 8 && utcHour < 13) { tradingSession = 'LONDON'; sessionMultiplier = 1.2; }
        else if (utcHour >= 13 && utcHour < 21) { tradingSession = 'NEW_YORK'; sessionMultiplier = 1.5; }
        if (day === 0 || day === 6) sessionMultiplier *= 0.5;

        const apiMacro = {
            realSpreadPct, obi,
            longShortRatio: lsAccData?.length ? parseFloat(lsAccData[0].longShortRatio) : 1.0,
            lsPositionVolRatio: lsPosData?.length ? parseFloat(lsPosData[0].longShortRatio) : 1.0,
            takerBuySellRatio: takerData?.length ? parseFloat(takerData[0].buySellRatio) : 1.0,
            fgiValue: cmcDataRaw?.fgiValue || 50,
            tradingSession,
            sessionMultiplier
        };

        const opens = klinesLTF.map(d => parseFloat(d[1]));
        const highs = klinesLTF.map(d => parseFloat(d[2])); 
        const lows = klinesLTF.map(d => parseFloat(d[3]));
        const closes = klinesLTF.map(d => parseFloat(d[4])); 
        const volumes = klinesLTF.map(d => parseFloat(d[7]));
        
        const buyVols = klinesLTF.map(d => parseFloat(d[10]));
        const sellVols = volumes.map((v, i) => v - buyVols[i]);
        const vpinValue = QuantMath.vpin(buyVols, sellVols, volumes, 50);

        const closesMTF = klinesMTF.map(d => parseFloat(d[4])); const closesHTF = klinesHTF.map(d => parseFloat(d[4]));
        
        const currentPrice = closes[closes.length - 1];
        const avgVolume20 = QuantMath.sma(volumes.slice(0, -1), 20);
        const htfSma200 = QuantMath.sma(closesHTF, 200);

        const oiValues = Array.isArray(oiHist) ? oiHist.map(d => parseFloat(d.sumOpenInterestValue) || 0) : [0];
        const oiEma14 = QuantMath.ema(oiValues, 14) || oiValues[oiValues.length - 1] || 0;
        const currentOiValue = oiCurrent ? (parseFloat(oiCurrent.openInterest) * currentPrice) : 0;
        let oiDeltaPercent = 0;
        if (oiValues.length >= 2) {
           const prevOi = oiValues[oiValues.length - 2];
           if (prevOi > 0) oiDeltaPercent = ((oiValues[oiValues.length - 1] - prevOi) / prevOi) * 100;
        }

        const fundingRateValue = realPremiumIndex ? parseFloat(realPremiumIndex.lastFundingRate) * 100 : 0;
        let fundingSlopeValue = fundingHist && fundingHist.length >= 3 ? (parseFloat(fundingHist[fundingHist.length - 1].fundingRate) - parseFloat(fundingHist[fundingHist.length - 3].fundingRate)) * 100 : 0;

        const atr14 = QuantMath.atr(highs, lows, closes, 14);
        const rsiValue = QuantMath.rsi(closes, indicatorSpecs.rsiPeriod);
        const adxValue = QuantMath.adx(highs, lows, closes, 14);
        const cmfValue = QuantMath.cmf(highs, lows, closes, volumes, 20);

        const atrHist = []; for(let i=14; i<closes.length; i++) atrHist.push(QuantMath.atr(highs.slice(0, i+1), lows.slice(0, i+1), closes.slice(0, i+1), 14));
        const atrRank = QuantMath.percentileRank(atr14, atrHist.slice(-100));

        const bbwHist = []; for (let i = indicatorSpecs.bbPeriod; i < closes.length; i++) bbwHist.push(QuantMath.bollinger(closes.slice(0, i+1), indicatorSpecs.bbPeriod, indicatorSpecs.bbStdDev).bbw);
        const bollinger20 = QuantMath.bollinger(closes, indicatorSpecs.bbPeriod, indicatorSpecs.bbStdDev);
        const bbwRank = QuantMath.percentileRank(bollinger20.bbw, bbwHist.slice(-100));
        const bbwSlopeValue = bbwHist.length >= 5 ? ((bollinger20.bbw - bbwHist[bbwHist.length - 5]) / (bbwHist[bbwHist.length - 5] || 1)) * 100 : 0;

        let btcDomSlope = 0; let btcDomValue = cmcData.btcDominanceRealtime;
        if (btcDomKlines && btcDomKlines.length >= 2) {
             const domCloses = btcDomKlines.map(d => parseFloat(d[4]));
             btcDomValue = domCloses[domCloses.length - 1]; 
             btcDomSlope = ((btcDomValue - domCloses[0]) / domCloses[0]) * 100;
        }

        const scan20_50 = QuantMath.scanEmaRange(closesMTF, 20, 50, 20);
        const scan50_200 = QuantMath.scanEmaRange(closesMTF, 50, 200, 20);



        const isBullishSFP = QuantMath.detectSFP_Institutional_Advanced(highs, lows, closes, opens, volumes, avgVolume20, atr14, 'LONG');
        const isBearishSFP = QuantMath.detectSFP_Institutional_Advanced(highs, lows, closes, opens, volumes, avgVolume20, atr14, 'SHORT');

        
        // [VÁ LỖI TỘI ĐỒ 1] THÊM THUẬT TOÁN MSB
        const msbData = QuantMath.detectMarketStructure(highs, lows, closes);

        const altReturns = [];
        for (let i = 1; i < closes.length; i++) altReturns.push((closes[i] - closes[i-1]) / closes[i-1]);

        const amihudValue = QuantMath.amihudIlliquidity(altReturns, volumes.slice(1));
        let isiValue = 0;
        const btcReturnsCurrent = btcReturnsCache.get(intervalTime);

        if (btcReturnsCurrent && altReturns.length > 0) {
            const minLen = Math.min(btcReturnsCurrent.length, altReturns.length);
            const alignedBtc = btcReturnsCurrent.slice(-minLen);
            const alignedAlt = altReturns.slice(-minLen);
            
            if (minLen > 10) {
                isiValue = QuantMath.immediateSensitivityIndicator(alignedAlt, alignedBtc, 5);
            }
        }
        const macdValue = QuantMath.macd(closes, 12, 26, 9);
        const realUsdVol24h = ticker24hData ? parseFloat(ticker24hData.quoteVolume) : ((avgVolume20 || 0) * currentPrice * 24);
        // 🧠 TÍNH TOÁN CÁC CHỈ BÁO LƯỢNG TỬ MỚI CHO HUD
        const { currentCVD, cvdTrend } = QuantMath.cvd(volumes, buyVols, 50);
        // Đã áp dụng luôn Dải 2 (upper2, lower2) cho VWAP Gravity
        const { vwap, upper2, lower2 } = QuantMath.vwapWithBands(highs, lows, closes, volumes, closes.length);
        const hurstValue = QuantMath.hurst(closes, 100);
        const liqData = liquidationsCache.get(symbol) || { longs: 0, shorts: 0 };
        const autoData = {
            currentPrice, atr14, atrPercent: currentPrice > 0 ? (atr14 / currentPrice) * 100 : 0, atrRank,
            usdVolume24h: realUsdVol24h,
            adx: adxValue, htfSma200, rsi: rsiValue, bbwRank, bbw: bollinger20.bbw, cmf: cmfValue,
            ema20: { value: scan20_50.fastEmaCurrent, slope: scan20_50.fastSlope }, 
            ema34: { value: QuantMath.ema(closesMTF, 34), slope: 0 }, 
            ema50: { value: scan20_50.slowEmaCurrent, slope: scan20_50.slowSlope }, 
            ema89: { value: QuantMath.ema(closesMTF, 89), slope: 0 }, 
            ema200: { value: scan50_200.slowEmaCurrent, slope: scan50_200.slowSlope },
            scan20_50, scan50_200, fundingRate: fundingRateValue, fundingSlope: fundingSlopeValue, obi, bbwSlope: bbwSlopeValue,
            currentOi: currentOiValue, oiEma: oiEma14, oiDelta: oiDeltaPercent, isOiSpiking: currentOiValue > oiEma14,
            currentVolume: volumes[volumes.length - 1], lastClosedVolume: volumes[volumes.length - 2], avgVolume20, 
            isBullishSFP, isBearishSFP,
            btcDomValue, btcDomSlope,
            vpinValue,
            amihud: amihudValue,
            isi: isiValue,
            macd: macdValue,
            msbRegime: msbData.regime, msbState: msbData.msbState, msbIsSFP: msbData.isSFP, // Đã thêm MSB
            // 🚀 BẢN VÁ: Bơm dữ liệu Lượng tử vào HUD
            cvdTrend, 
            vwap, 
            vwapUpper: upper2, 
            vwapLower: lower2, 
            hurstValue, 
            liqLongsVol: liqData.longs, 
            liqShortsVol: liqData.shorts
        };

        ws.send(JSON.stringify({ 
            type: 'HUD_SYNC', 
            payload: { autoData, apiMacro, liveCapital, availableBalance, binancePositions, leverageBrackets, tradeFees, cmcData } 
        }));

    } catch (error) {
        console.error('[HUD] Lỗi tính toán:', error.message);
    }
}
// =====================================================================
// 🚀 ĐỘNG CƠ BẢO VỆ LỢI NHUẬN (CHUẨN BINANCE API CANCEL-REPLACE/MODIFY)
// =====================================================================
let exchangeTickSizes = {}; 

async function runSmartTrailingEngine() {
    try {
        const { data: openTrades } = await supabase.from('trade_logs').select('*').eq('status', 'OPEN').eq('type', 'FUTURES');
        if (!openTrades || openTrades.length === 0) return;

        const positionsRes = await readBinanceReq('/fapi/v2/positionRisk');
        if (!positionsRes) return;

        // Kéo TẤT CẢ open orders một lần duy nhất để tiết kiệm API Weight
        const allOpenOrders = [];
        const blindSymbols = new Set();

        const uniqueSymbols = [
            ...new Set(openTrades.map(t => t.symbol))
        ];

        for (const sym of uniqueSymbols) {
            try {
                const [res, algoRes] = await Promise.all([
                    readBinanceReq(
                        '/fapi/v1/openOrders',
                        { symbol: sym }
                    ),

                    readBinanceReq(
                        '/fapi/v1/openAlgoOrders',
                        { symbol: sym }
                    )
                ]);

                if (
                    !Array.isArray(res) ||
                    !Array.isArray(algoRes)
                ) {
                    blindSymbols.add(sym);

                    console.error(
                        `[TRAILING FAIL-CLOSED] Không xác minh được order state ${sym}`
                    );

                    continue;
                }

                allOpenOrders.push(...res, ...algoRes);

            } catch (error) {
                blindSymbols.add(sym);

                console.error(
                    `[TRAILING FAIL-CLOSED] API lỗi ${sym}:`,
                    error.message
                );
            }
        }

        for (const trade of openTrades) {
            if (blindSymbols.has(trade.symbol)) {
                console.log(
                    `[TRAILING] Bỏ qua ${trade.symbol}: order state không đáng tin cậy.`
                );

                continue;
            }
            const position = positionsRes.find(p => p.symbol === trade.symbol);
            if (!position || parseFloat(position.positionAmt) === 0) continue; 

            const entryPrice = parseFloat(trade.entry);
            const currentSl = parseFloat(trade.sl);
            const tp1 = parseFloat(trade.tp_1_price);
            const markPrice = parseFloat(position.markPrice);
            const isLong = trade.direction === 'LONG';
            // =======================================================
            // 🔪 TEMPORAL BARRIER - RÀO CẢN THỜI GIAN (CHỐNG HOPE/CHOP)
            // =======================================================
            const openedAt =
                trade.opened_at || trade.created_at;

            const openTimeMs =
                new Date(openedAt).getTime();

            if (!Number.isFinite(openTimeMs)) {
                console.error(
                    `[TEMPORAL] Invalid opened_at: ${trade.symbol}`,
                    openedAt
                );

                continue;
            }
            const intervalMs = INTERVAL_MS[trade.interval] || 3600000;
            const candlesPassed = (Date.now() - openTimeMs) / intervalMs;
            const maxHoldingCycles = parseInt(trade.holding_cycles) || 5; 

            if (candlesPassed >= maxHoldingCycles) {
                console.log(`⏳ [TEMPORAL BARRIER] Lệnh ${trade.symbol} đã kẹt quá ${maxHoldingCycles} nến. THỰC THI ÉP ĐÓNG BẢO TOÀN VỐN!`);
                
                const closeSide = isLong ? 'SELL' : 'BUY';
                const closeQty = Math.abs(parseFloat(position.positionAmt));
                
                try {
                    // 1. Tự động đóng Market
                    await sendBinanceReq('POST', '/fapi/v1/order', {
                        symbol: trade.symbol,
                        side: closeSide,
                        type: 'MARKET',
                        quantity: closeQty,
                        reduceOnly: "true"
                    });
                    
                    // 2. Dọn dẹp Limit Orders thừa (An toàn: Chỉ dọn lệnh mồ côi giảm vị thế)
                    fetch('http://localhost:1338/api/cancel-orphans', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbol: trade.symbol })
                    }).catch(e => console.error(e));
                    
                    // 3. Update trạng thái Sổ cái
                    await supabase.from('trade_logs').update({ 
                        status: 'CLOSED', 
                        close_price: markPrice, 
                        exit_reason: 'TEMPORAL_BARRIER_HIT' 
                    }).eq('id', trade.id);
                    
                    continue; // Chuyển sang lệnh tiếp theo, không xử lý trailing SL nữa
                } catch(e) {
                    console.log(`❌ [TIME BARRIER] Lỗi khi ép đóng lệnh ${trade.symbol}:`, e.response?.data?.msg || e.message);
                }
            }
            // 💡 BẢN VÁ: Tái tạo Technical Risk cho Engine chạy ngầm
                const initialRiskPerCoin =
                    parseFloat(trade.initial_risk_per_coin);

                if (
                    !Number.isFinite(initialRiskPerCoin) ||
                    initialRiskPerCoin <= 0
                ) {
                    console.error(
                        `[TRAILING] ${trade.symbol} thiếu initial_risk_per_coin. Bỏ qua để an toàn.`
                    );

                    continue;
                }

                const currentProfit = isLong
                    ? markPrice - entryPrice
                    : entryPrice - markPrice;

                const currentProfitR =
                    currentProfit / initialRiskPerCoin;
            // =========================================================================
            // 🧠 MA TRẬN TRAILING BẤT ĐỐI XỨNG (ASYMMETRIC TRAILING)
            // =========================================================================
            let beTrigger = 0.5;   // Ngưỡng kéo Hòa vốn
            let lockTrigger = 1.0; // Ngưỡng kích hoạt Khóa lãi tĩnh
            let lockAmount = 0.5;  // Mức lợi nhuận Khóa lại
            let trailTrigger = 2.0;// Ngưỡng kích hoạt Trailing bám đuôi
            let trailDist = 1.0;   // Khoảng cách Trailing từ đỉnh

            const stratStr = String(trade.strategy_name || "").toUpperCase();
            const tierStr = String(trade.asset_tier || "").toUpperCase();

            // 1. TÙY CHỈNH THEO ĐẶC TÍNH CHIẾN THUẬT
            if (stratStr.includes('LEAD-LAG')) {
                // Arbitrage chớp nhoáng (MARKET order): Edge suy biến trong vài giây. Siết cực gắt.
                beTrigger = 0.35; lockTrigger = 0.8; lockAmount = 0.5; trailTrigger = 1.5; trailDist = 0.5;
            } else if (stratStr.includes('GAMMA')) {
                // Breakdown/Crash (LIMIT, slMult rộng hơn LEAD-LAG): cần thêm chút không gian trước khi coi là an toàn.
                beTrigger = 0.45; lockTrigger = 0.9; lockAmount = 0.5; trailTrigger = 1.6; trailDist = 0.55;
            } else if (stratStr.includes('LIQ-FLUSH')) {
                // Bẫy thanh khoản (LIMIT, target 2.5x giống KINETIC nhưng risk floor chặt hơn): nằm giữa GAMMA và KINETIC.
                beTrigger = 0.5; lockTrigger = 1.0; lockAmount = 0.5; trailTrigger = 1.8; trailDist = 0.7;
            } else if (stratStr.includes('KINETIC') || stratStr.includes('SFP')) {
                // Breakout / Bẫy cá mập: Cần thời gian phá cản, nới lỏng nhẹ.
                beTrigger = 0.6; lockTrigger = 1.2; lockAmount = 0.6; trailTrigger = 2.0; trailDist = 0.8;
            } else if (stratStr.includes('ADAPTIVE')) {
                // Đánh thuận Trend: Thả lỏng tối đa để giá có không gian dập dềnh tạo sóng.
                beTrigger = 0.8; lockTrigger = 1.5; lockAmount = 0.8; trailTrigger = 2.5; trailDist = 1.2;
            }

            // 2. TÙY CHỈNH THEO NHIỄU ĐỘNG TÀI SẢN (TIER)
            if (tierStr.includes('TIER 4')) {

                beTrigger += 0.15;
                lockTrigger += 0.25;
                trailTrigger += 0.35;
                trailDist += 0.30;

            }
            else if (tierStr.includes('TIER 3')) {

                beTrigger += 0.10;
                lockTrigger += 0.15;
                trailTrigger += 0.20;
                trailDist += 0.15;

            }
            else if (tierStr.includes('TIER 1')) {

                beTrigger -= 0.05;
                lockTrigger -= 0.10;
                trailTrigger -= 0.15;
                trailDist -= 0.10;
            }

            let newSl = currentSl;
            let triggerReason = "";
            let nextStage = trade.protection_stage || 'NONE';

            // =======================================================
            // 1. HIGH-WATER MARK
            // =======================================================

            const storedHighWater =
                Number.isFinite(parseFloat(trade.high_water_price))
                    ? parseFloat(trade.high_water_price)
                    : entryPrice;

            const highWaterPrice = isLong
                ? Math.max(storedHighWater, markPrice)
                : Math.min(storedHighWater, markPrice);

            const highWaterProfit = isLong
                ? highWaterPrice - entryPrice
                : entryPrice - highWaterPrice;

            const highWaterR =
                highWaterProfit / initialRiskPerCoin;


            // =======================================================
            // 2. STATE MACHINE
            // Ưu tiên stage cao nhất trước
            // =======================================================

            if (currentProfitR >= trailTrigger) {

                nextStage = 'TRAIL';

                const trailSl = isLong
                    ? highWaterPrice - initialRiskPerCoin * trailDist
                    : highWaterPrice + initialRiskPerCoin * trailDist;

                if (
                    (isLong && trailSl > currentSl) ||
                    (!isLong && trailSl < currentSl)
                ) {
                    newSl = trailSl;

                    triggerReason =
                        `TRAIL ${trailDist.toFixed(2)}R`;
                }

            }
            else if (currentProfitR >= lockTrigger) {

                nextStage = 'LOCK';

                const lockSl = isLong
                    ? entryPrice + initialRiskPerCoin * lockAmount
                    : entryPrice - initialRiskPerCoin * lockAmount;

                if (
                    (isLong && lockSl > currentSl) ||
                    (!isLong && lockSl < currentSl)
                ) {
                    newSl = lockSl;

                    triggerReason =
                        `LOCK +${lockAmount.toFixed(2)}R`;
                }

            }
            else if (currentProfitR >= beTrigger) {

                nextStage = 'BE';

                // Pareto version:
                // BE nằm +0.05R thay vì cố định ±0.1% giá.
                const beBufferR = 0.05;

                const breakevenSl = isLong
                    ? entryPrice + initialRiskPerCoin * beBufferR
                    : entryPrice - initialRiskPerCoin * beBufferR;

                if (
                    (isLong && breakevenSl > currentSl) ||
                    (!isLong && breakevenSl < currentSl)
                ) {
                    newSl = breakevenSl;

                    triggerReason =
                        `BE +${beBufferR.toFixed(2)}R`;
                }
            }
            const highWaterChanged =
                highWaterPrice !== storedHighWater;

            if (highWaterChanged) {
                await supabase
                    .from('trade_logs')
                    .update({
                        high_water_price: highWaterPrice,
                        high_water_r: highWaterR
                    })
                    .eq('id', trade.id);
            }
            if (newSl !== currentSl && triggerReason !== "") {
                const tick = exchangeTickSizes[trade.symbol] || 0.0001;
                const tickStr = tick.toString();
                const precision = tickStr.includes('e-') ? parseInt(tickStr.split('e-')[1]) : (tickStr.includes('.') ? tickStr.split('.')[1].length : 4);
                const formattedNewSl = newSl.toFixed(precision);

                // ==========================================
                // 🧹 BƯỚC 1: QUÉT SẠCH TOÀN BỘ LỆNH SL CŨ
                // ==========================================
                const exitSide = isLong ? 'SELL' : 'BUY';
                
                // BẢN VÁ: Bộ lọc tóm gọn lệnh SL cũ bất kể nó nằm ở Standard hay Algo
                const existingSlOrders = allOpenOrders.filter(o => {
                    // Bỏ qua nếu khác Symbol hoặc khác Hướng thoát (Exit Side)
                    if (o.symbol !== trade.symbol || o.side !== exitSide) return false;
                    
                    // Ép kiểu Type về chuỗi để kiểm tra an toàn
                    const typeStr = String(o.type || o.origType || o.algoType || "").toUpperCase();
                    
                    // BẢO VỆ TUYỆT ĐỐI: Không bao giờ xóa nhầm lệnh TAKE PROFIT
                    if (typeStr.includes('PROFIT')) return false;

                    // Nếu là lệnh STOP, CONDITIONAL, hoặc có ID Algo -> Chắc chắn 100% là SL cũ
                    return typeStr.includes('STOP') || typeStr.includes('CONDITIONAL') || o.algoId !== undefined;
                });

                console.log(`[🛡️ TRAILING] Kích hoạt bảo vệ (${triggerReason}) cho ${trade.symbol}. Dời SL: ${currentSl} -> ${formattedNewSl}`);

                try {
                    // Dọn dẹp: Quét qua tất cả SL rác tìm được và Hủy không trượt phát nào
                    for (const oldSl of existingSlOrders) {
                        if (oldSl.algoId) {
                            // Cổng xóa Algo Order chuẩn của Binance
                            await sendBinanceReq('DELETE', '/fapi/v1/algoOrder', {
                                symbol: trade.symbol,
                                algoId: oldSl.algoId
                            }).catch(e => console.log(`[Lỗi Xóa Algo SL]:`, e.response?.data?.msg || e.message));
                        } 
                        if (oldSl.orderId) {
                            // Cổng xóa Standard Order (Đề phòng SL gốc đặt bằng lõi Standard)
                            await sendBinanceReq('DELETE', '/fapi/v1/order', {
                                symbol: trade.symbol,
                                orderId: oldSl.orderId
                            }).catch(e => console.log(`[Lỗi Xóa Std SL]:`, e.response?.data?.msg || e.message));
                        }
                    }

                // ==========================================
                // 🎯 BƯỚC 2: CẮM LỆNH SL MỚI (CHUẨN BINANCE FUTURES ALGO)
                // ==========================================
                    // Lấy chính xác khối lượng vị thế đang mở từ sàn để truyền vào Algo
                    const posAmtForTrailing = Math.abs(parseFloat(position.positionAmt));

                    const newOrderPayload = {
                        symbol: trade.symbol,
                        side: exitSide,
                        type: 'STOP_MARKET',         
                        triggerPrice: formattedNewSl,   // API Algo BẮT BUỘC dùng triggerPrice
                        quantity: posAmtForTrailing,    // API Algo BẮT BUỘC truyền Quantity thực tế
                        reduceOnly: "true",             // Dùng cờ Giảm Vị Thế (Không dùng closePosition ở Algo)
                        workingType: "MARK_PRICE",   
                        priceProtect: "true",
                        algoType: "CONDITIONAL"         // Khẳng định cờ Algo
                    };
                    
                    // Bắn vào cổng API Algo của Futures
                    await sendBinanceReq('POST', '/fapi/v1/algoOrder', newOrderPayload); 

                    // Cập nhật Database để HUD nhận tín hiệu
                    await supabase
                    .from('trade_logs')
                    .update({
                        sl: newSl,

                        protection_stage: nextStage,

                        high_water_price: highWaterPrice,
                        high_water_r: highWaterR,

                        // Giữ để frontend cũ không hỏng.
                        // Sau này có thể xóa field này.
                        trailing_activated:
                            nextStage !== 'NONE'
                    })
                    .eq('id', trade.id);
                    
                    console.log(`✅ [🛡️ TRAILING] Đã nâng khiên an toàn lệnh ${trade.symbol}!`);
                } catch(e) {
                    console.log(`❌ [TRAILING] Bị Binance từ chối dời SL:`, e.response?.data?.msg || e.message);
                }
            }
        }
    } catch (e) {

    console.error(
        '[TRAILING ENGINE ERROR]',
        e?.response?.data ||
        e?.stack ||
        e?.message ||
        e
    );
    }   
}
setInterval(() => {
    connectedClients.forEach(ws => { if (ws.hudConfig) syncHUD(ws); });
}, 15000);

setInterval(async () => {
    console.log("🧠 [CRON] Tiến hành đồng bộ định kỳ AI Model từ Supabase...");
    await loadLatestAiModel();
}, 3600000);

// =====================================================================
// 🔍 ĐỘNG CƠ ĐÁNH GIÁ HẬU GIAO DỊCH (POST-EXIT EXCURSION - PEE)
// Mục tiêu: Bắt lỗi "Chốt Non" (Alpha Decay) và "Bị Quét SL" (Shakeout)
// =====================================================================
const INTERVAL_MS = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };

async function runPostTradeEvaluation() {
    try {
        // Chỉ kéo những lệnh Đã Đóng nhưng chưa được phân tích (pee_analyzed = false)
        const { data: ripeTrades } = await supabase
            .from('trade_logs')
            .select('id, symbol, interval, direction, entry, close_price, position_size_usd, close_time')
            .in('status', ['WIN', 'LOSS'])
            .eq('pee_analyzed', false);

        if (!ripeTrades || ripeTrades.length === 0) return;

        const now = Date.now();
        
        for (const trade of ripeTrades) {
            const closeTimeMs = new Date(trade.close_time).getTime();
            const intervalMs = INTERVAL_MS[trade.interval] || 3600000;
            
            // "Độ chín": Chờ đúng 24 nến hình thành sau khi lệnh đóng
            const forwardWindowMs = 24 * intervalMs; 

            // Nếu thị trường đã chạy hết 24 nến, bắt đầu truy vấn
            if (now > closeTimeMs + forwardWindowMs) {
                // API LIMIT: limit=50 -> Chỉ tiêu thụ đúng 1 Weight!
                const klinesRes = await safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${trade.symbol}&interval=${trade.interval}&startTime=${closeTimeMs}&endTime=${closeTimeMs + forwardWindowMs}&limit=50`);
                
                if (klinesRes && klinesRes.length > 0) {
                    const absoluteHigh = Math.max(...klinesRes.map(k => parseFloat(k[2])));
                    const absoluteLow = Math.min(...klinesRes.map(k => parseFloat(k[3])));
                    
                    const entryPrice = parseFloat(trade.entry);
                    const closePrice = parseFloat(trade.close_price || entryPrice);
                    const sizeCoins = parseFloat(trade.position_size_usd) / entryPrice;

                    let peeMfeUsd = 0; let peeMaeUsd = 0;
                    let peeMfeCandles = 0; let peeMaeCandles = 0;

                    let maxHigh = -Infinity; let maxHighIdx = 0;
                    let minLow = Infinity;   let minLowIdx = 0;

                    // Tìm giá trị và index của đỉnh/đáy trong tương lai
                    klinesRes.forEach((k, idx) => {
                        const high = parseFloat(k[2]); const low = parseFloat(k[3]);
                        if (high > maxHigh) { maxHigh = high; maxHighIdx = idx + 1; }
                        if (low < minLow) { minLow = low; minLowIdx = idx + 1; }
                    });

                    if (trade.direction === 'LONG') {
                        peeMfeUsd = Math.max(0, (maxHigh - closePrice) * sizeCoins);
                        peeMfeCandles = maxHighIdx; // Số nến để đạt đỉnh
                        
                        peeMaeUsd = Math.min(0, (minLow - closePrice) * sizeCoins);
                        peeMaeCandles = minLowIdx; // Số nến để chạm đáy
                    } else {
                        peeMfeUsd = Math.max(0, (closePrice - minLow) * sizeCoins);
                        peeMfeCandles = minLowIdx;
                        
                        peeMaeUsd = Math.min(0, (closePrice - maxHigh) * sizeCoins);
                        peeMaeCandles = maxHighIdx;
                    }

                    // Ghi lại kết quả vào Supabase (Bao gồm cả Cột Thời Gian)
                    await supabase.from('trade_logs').update({
                        pee_mfe_usd: peeMfeUsd,
                        pee_mae_usd: peeMaeUsd,
                        pee_mfe_candles: peeMfeCandles, // Dạy AI về Thời gian
                        pee_mae_candles: peeMaeCandles,
                        pee_analyzed: true
                    }).eq('id', trade.id);
                    
                    console.log(`🔍 [PEE ENGINE] Khám nghiệm tử thi lệnh ${trade.symbol}. Lợi nhuận bỏ lỡ (MFE): $${peeMfeUsd.toFixed(2)}`);
                }
            }
        }
    } catch (e) {
        console.error("❌ [PEE ENGINE] Lỗi phân tích Hậu giao dịch:", e.message);
    }
}
// =====================================================================
// 👻 ĐỘNG CƠ HẬU KIỂM LỆNH ẢO (LAZY PAPER TRADING ENGINE)
// =====================================================================
async function runLazyPaperTrading() {
    try {
        // 1. Kéo các lệnh ảo đang MỞ
        const { data: openPapers } = await supabase
            .from('paper_trade_logs')
            .select('*')
            .eq('status', 'OPEN');

        if (!openPapers || openPapers.length === 0) return;

        for (const trade of openPapers) {
            const openTimeMs = new Date(trade.created_at).getTime();
            
            // 2. Kéo nến từ lúc Mở lệnh đến hiện tại (Dùng limit=1000 để soi được xa nhất, tốn 5 weight)
            const klinesRes = await safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${trade.symbol}&interval=${trade.interval}&startTime=${openTimeMs}&limit=1000`);
            
            if (!klinesRes || klinesRes.length === 0) continue;

            let isClosed = false;
            let closePrice = 0;
            let exitReason = '';
            let closeTimeMs = openTimeMs;
            let finalHoldingCycles = 1;

            const entry = parseFloat(trade.entry);
            const sl = parseFloat(trade.sl);
            const tp = parseFloat(trade.tp_1_price);

            // 3. Thuật toán Replay: Quét từng nến từ quá khứ đến hiện tại
            for (let i = 0; i < klinesRes.length; i++) {
                const candle = klinesRes[i];
                const high = parseFloat(candle[2]);
                const low = parseFloat(candle[3]);
                const candleCloseTime = candle[6]; 

                // Giả định khắc nghiệt (Worst-case Scenario): Luôn check SL trước TP trong cùng 1 nến
                if (trade.direction === 'LONG') {
                    if (low <= sl) {
                        isClosed = true; closePrice = sl; exitReason = 'STOP_LOSS_HIT';
                        closeTimeMs = candleCloseTime; finalHoldingCycles = i + 1; break;
                    } else if (high >= tp) {
                        isClosed = true; closePrice = tp; exitReason = 'TAKE_PROFIT_HIT';
                        closeTimeMs = candleCloseTime; finalHoldingCycles = i + 1; break;
                    }
                } else {
                    if (high >= sl) {
                        isClosed = true; closePrice = sl; exitReason = 'STOP_LOSS_HIT';
                        closeTimeMs = candleCloseTime; finalHoldingCycles = i + 1; break;
                    } else if (low <= tp) {
                        isClosed = true; closePrice = tp; exitReason = 'TAKE_PROFIT_HIT';
                        closeTimeMs = candleCloseTime; finalHoldingCycles = i + 1; break;
                    }
                }
            }

            // 4. Cập nhật Database nếu lệnh chạm TP/SL
            if (isClosed) {
                const sizeCoin = parseFloat(trade.position_size_usd) / entry;
                const rawPnl = trade.direction === 'LONG' 
                    ? (closePrice - entry) * sizeCoin 
                    : (entry - closePrice) * sizeCoin;
                
                // Trừ phí ma sát ảo: Taker x 2 chiều (0.04% * 2) = 0.08%
                const fee = (trade.position_size_usd * 0.0008); 
                const finalPnl = rawPnl - fee;

                await supabase.from('paper_trade_logs').update({
                    status: finalPnl > 0 ? 'WIN' : 'LOSS',
                    pnl_usd: finalPnl,
                    close_price: closePrice,
                    close_time: new Date(closeTimeMs).toISOString(),
                    exit_reason: exitReason,
                    holding_cycles: finalHoldingCycles
                }).eq('id', trade.id);
                
                console.log(`👻 [PAPER TRADE] Lệnh ${trade.symbol} đã chốt! KQ: ${finalPnl > 0 ? 'WIN' : 'LOSS'} | H.Cycles: ${finalHoldingCycles} | Lãi/Lỗ: $${finalPnl.toFixed(2)}`);
            }
        }
    } catch (e) {
        console.error("❌ [PAPER ENGINE] Lỗi Hậu kiểm Lệnh Ảo:", e.message);
    }
}

// =====================================================================
// 🔄 ĐỘNG CƠ ĐỒNG BỘ TRẠNG THÁI NGẦM (LEDGER STATE SYNC)
// =====================================================================
async function runLedgerStateSync() {
    try {
        // 1. Kéo lệnh PENDING/OPEN. (VÁ LỖI: Sắp xếp lấy lệnh Mới Nhất lên đầu)
        const { data: activeLogs } = await supabase
            .from('trade_logs')
            .select('id, symbol, direction, status, entry, sl')
            .in('status', ['PENDING', 'OPEN'])
            .eq('type', 'FUTURES')
            .order('created_at', { ascending: false });

        if (!activeLogs || activeLogs.length === 0) return;

        const positionsRes = await readBinanceReq('/fapi/v2/positionRisk');
        if (!positionsRes || !Array.isArray(positionsRes)) return;

        // VÁ LỖI: Danh sách những coin đã được quét để chống Duplicate Sổ cái
        const processedSymbols = new Set();

        for (const log of activeLogs) {
            const position = positionsRes.find(p => p.symbol === log.symbol);
            const posAmt = position ? parseFloat(position.positionAmt) : 0;
            const isLongPos = posAmt > 0;
            const isShortPos = posAmt < 0;

            // KỊCH BẢN 1: LỆNH CHỜ VỪA KHỚP (PENDING -> OPEN)
            if (log.status === 'PENDING') {
                if ((log.direction === 'LONG' && isLongPos) || (log.direction === 'SHORT' && isShortPos)) {
                    
                    // CHỐNG NHÂN BẢN: Nếu coin này chưa từng được Active trong nhịp quét
                    if (!processedSymbols.has(log.symbol)) {
                        console.log(`[🔄 LEDGER SYNC] Lệnh ${log.symbol} đã khớp trên sàn. Kích hoạt trạng thái OPEN!`);
                        const actualEntry = parseFloat(position.entryPrice);
                        const initialSl = parseFloat(log.sl);
                        const initialRiskPerCoin = Math.abs(actualEntry - initialSl);

                        if (
                            !Number.isFinite(actualEntry) ||
                            !Number.isFinite(initialSl) ||
                            !Number.isFinite(initialRiskPerCoin) ||
                            initialRiskPerCoin <= 0
                        ) {
                            console.error(
                                `[RISK INIT] Không thể khởi tạo R cho ${log.symbol}`,
                                {
                                    actualEntry,
                                    initialSl,
                                    initialRiskPerCoin
                                }
                            );

                            continue;
                        }

                        await supabase
                            .from('trade_logs')
                            .update({
                                status: 'OPEN',

                                // Giá fill thực tế
                                entry: actualEntry,

                                // Geometry bất biến của trade
                                initial_sl: initialSl,
                                initial_risk_per_coin: initialRiskPerCoin,

                                // Thời điểm position thực sự tồn tại
                                opened_at: new Date().toISOString(),

                                // State của protection engine
                                protection_stage: 'NONE',

                                // Điểm khởi đầu high-water mark
                                high_water_price: actualEntry,
                                high_water_r: 0
                            })
                            .eq('id', log.id);
                        
                        processedSymbols.add(log.symbol); // Đánh dấu đã Active Sổ Cái
                    } 
                    else {
                        // RÁC DUPLICATE: Đã có 1 bản ghi của coin này được chuyển sang OPEN rồi. Bản ghi này là rác bị nhân bản!
                        console.log(`[🧹 DB CLEANUP] Xóa bản ghi PENDING bị duplicate của ${log.symbol}.`);
                        await supabase.from('trade_logs').update({ 
                            status: 'CANCELED', 
                            exit_reason: 'DUPLICATE_ENTRY_FIXED' 
                        }).eq('id', log.id);
                    }
                }
            }
            
            // KỊCH BẢN 2: LỆNH ĐANG CHẠY VỪA CHẠM TP/SL (OPEN -> CLOSED)
            else if (log.status === 'OPEN') {
                processedSymbols.add(log.symbol); // Đánh dấu coin này đang chiếm 1 Slot OPEN

                if (posAmt === 0 || (log.direction === 'LONG' && isShortPos) || (log.direction === 'SHORT' && isLongPos)) {
                    console.log(`[🔄 LEDGER SYNC] Vị thế ${log.symbol} đã kết thúc (Chạm TP/SL). Chuyển về CLOSED.`);
                    await supabase.from('trade_logs').update({
                        status: 'CLOSED',
                        close_price: parseFloat(position?.markPrice || log.entry), // 🚀 BẢN VÁ: Ghi lại giá Mark Price khoảnh khắc bị đóng
                        close_time: new Date().toISOString()
                    }).eq('id', log.id);
                }
            }
        }
    } catch (e) {
        // Im lặng bỏ qua
    }
}
// =====================================================================
// 🧹 ĐỘNG CƠ DỌN DẸP LỆNH RÁC (HARDCORE DEBUG VERSION)
// Bắt mọi lỗi từ Binance và in ra màn hình để biết tại sao lệnh không xóa được
// =====================================================================
async function runOrphanCleanupEngine() {
    try {
        // 1. Kéo vị thế. Cảnh báo nếu API trả về null (Thường do lỗi IP/Timestamp/API Key)
        const positionsRes = await readBinanceReq('/fapi/v2/positionRisk');
        if (!positionsRes || !Array.isArray(positionsRes)) {
            console.error("❌ [LỖI API API] API /positionRisk trả về null. Hãy kiểm tra API Key Read-Only hoặc Đồng bộ giờ.");
            return;
        }

        // 2. Kéo toàn bộ lệnh treo
        const allStdOrders = await readBinanceReq('/fapi/v1/openOrders');
        const allAlgoOrders = await readBinanceReq('/fapi/v1/openAlgoOrders');

        if (!allStdOrders) console.error("❌ [LỖI API] API /openOrders trả về null.");
        if (!allAlgoOrders) console.error("❌ [LỖI API] API /openAlgoOrders trả về null.");

        const stdList = Array.isArray(allStdOrders) ? allStdOrders : (allStdOrders?.orders || []);
        const algoList = Array.isArray(allAlgoOrders) ? allAlgoOrders : (allAlgoOrders?.orders || []);
        const allOpenOrders = [...stdList, ...algoList];
        
        if (allOpenOrders.length === 0) return;

        // Gom nhóm theo symbol
        const ordersBySymbol = {};
        for (const o of allOpenOrders) {
            if (!ordersBySymbol[o.symbol]) ordersBySymbol[o.symbol] = [];
            ordersBySymbol[o.symbol].push(o);
        }

        // --- HÀM XÓA LỆNH CHUYÊN SÂU KÈM BẮT LỖI ---
        const executeDelete = async (sym, order) => {
            try {
                if (order.algoId) {
                    await sendBinanceReq('DELETE', '/fapi/v1/algoOrder', { symbol: sym, algoId: order.algoId });
                    console.log(`✅ [ĐÃ XÓA ALGO] ${sym} | ID: ${order.algoId} | Loại: ${order.type || order.origType}`);
                } else if (order.orderId) {
                    await sendBinanceReq('DELETE', '/fapi/v1/order', { symbol: sym, orderId: order.orderId });
                    console.log(`✅ [ĐÃ XÓA STD] ${sym} | ID: ${order.orderId} | Loại: ${order.type || order.origType}`);
                }
            } catch (err) {
                // ÉP BINANCE PHẢI KHAI RA LÝ DO TỪ CHỐI
                const errorCode = err.response?.data?.code || 'UNKNOWN';
                const errorMsg = err.response?.data?.msg || err.message;
                console.error(`🚨 [BINANCE TỪ CHỐI XÓA] ${sym} | ID: ${order.algoId || order.orderId} | Mã lỗi: ${errorCode} | Lý do: ${errorMsg}`);
            }
        };

        for (const sym of Object.keys(ordersBySymbol)) {
            const orders = ordersBySymbol[sym];
            const position = positionsRes.find(p => p.symbol === sym);
            const posAmt = position ? Math.abs(parseFloat(position.positionAmt)) : 0;

            const entryOrders = [];
            const exitOrders = [];

            for (const o of orders) {
                const typeStr = String(o.type || o.origType || o.algoType || "").toUpperCase();
                const isReduceOnly = o.reduceOnly === true || o.reduceOnly === "true";

                if (!isReduceOnly && !typeStr.includes('STOP') && !typeStr.includes('PROFIT')) {
                    entryOrders.push(o);
                } else {
                    exitOrders.push(o);
                }
            }

            // -------------------------------------------------------------
            // KỊCH BẢN 1: DỌN SẠCH RÁC MỒ CÔI (Khong Vị thế + Không Entry)
            // -------------------------------------------------------------
            if (posAmt === 0 && entryOrders.length === 0 && exitOrders.length > 0) {
                console.log(`\n🧹 [BẮT ĐẦU DỌN MỒ CÔI] ${sym} | Tìm thấy ${exitOrders.length} lệnh rác.`);
                for (const o of exitOrders) {
                    await executeDelete(sym, o);
                }
                continue;
            }

            if (posAmt === 0 && entryOrders.length > 0) {
                continue; // Bảo vệ
            }

            // -------------------------------------------------------------
            // KỊCH BẢN 3: ĐANG CÓ VỊ THẾ -> CẮT TỈA TP/SL BỊ TRÙNG LẶP
            // -------------------------------------------------------------
            if (posAmt > 0) {
                const slOrders = exitOrders.filter(o => {
                    const t = String(o.type || o.origType || "").toUpperCase();
                    return t.includes('STOP') && !t.includes('PROFIT');
                });

                const tpOrders = exitOrders.filter(o => {
                    const t = String(o.type || o.origType || "").toUpperCase();
                    return t.includes('PROFIT');
                });

                if (slOrders.length > 1) {
                    console.log(`\n✂️ [CẮT TỈA SL] ${sym} | Phát hiện ${slOrders.length} SL đè nhau. Đang xóa đồ cũ...`);
                    slOrders.sort((a, b) => (b.time || b.updateTime || 0) - (a.time || a.updateTime || 0));
                    const trash = slOrders.slice(1);
                    for (const o of trash) await executeDelete(sym, o);
                }

                if (tpOrders.length > 1) {
                    console.log(`\n✂️ [CẮT TỈA TP] ${sym} | Phát hiện ${tpOrders.length} TP đè nhau. Đang xóa đồ cũ...`);
                    tpOrders.sort((a, b) => (b.time || b.updateTime || 0) - (a.time || a.updateTime || 0));
                    const trash = tpOrders.slice(1);
                    for (const o of trash) await executeDelete(sym, o);
                }
            }
        }
    } catch (error) {
        console.error("🔥 [CRITICAL ERROR] Động cơ dọn dẹp sập toàn tập:", error.message);
    }
}
// =====================================================================
// HỆ THỐNG CRONJOB ĐỆ QUY (CHỐNG RACE CONDITION TỐI ĐA)
// =====================================================================

// 1. Chạy ngầm Lệnh Ảo mỗi 5 phút (Sau khi tác vụ trước đã xong)
async function paperTradingLoop() {
    await runLazyPaperTrading();
    setTimeout(paperTradingLoop, 300000); 
}
paperTradingLoop(); 

// 2. Chạy Khám nghiệm Hậu giao dịch PEE mỗi 5 phút
async function postTradeEvaluationLoop() {
    await runPostTradeEvaluation();
    setTimeout(postTradeEvaluationLoop, 300000);
}
postTradeEvaluationLoop(); 

// 3. Động cơ Trailing quét liên tục mỗi 5 giây
async function trailingLoop() {
    await runSmartTrailingEngine();
    setTimeout(trailingLoop, 5000); 
}
trailingLoop(); 
// 4. Động cơ Đồng bộ Trạng thái chạy mỗi 3 giây
async function ledgerSyncLoop() {
    await runLedgerStateSync();
    setTimeout(ledgerSyncLoop, 3000); 
}
// 5. Động cơ tự động dọn dẹp rác & Lệnh mồ côi (Chạy mỗi 20 giây)
async function orphanCleanupLoop() {
    await runOrphanCleanupEngine();
    setTimeout(orphanCleanupLoop, 20000); 
}
orphanCleanupLoop();
ledgerSyncLoop();
// Đẩy dữ liệu HUD qua WebSocket (Hàm này chạy rất nhẹ, không gọi await ra ngoài 
// nên có thể giữ lại setInterval, nhưng vẫn khuyên dùng setTimeout nếu muốn đồng bộ)
setInterval(() => {
    connectedClients.forEach(ws => { if (ws.hudConfig) syncHUD(ws); });
}, 10000);

=========================================
/// FILE: logs/roadmap.md
=========================================

# 1.3.2 alpha
-Chỉnh optimizer: thay vì học máy cho toàn bộ dữ liệu, thì chia ra theo tier, theo chiến thuật
# 1.3.3
-Chỉnh lại dữ liệu gửi cho supabase
-Chỉnh lại cấu trúc supabase.
-Chỉnh sửa tối ưu weight consume của Matrix Scanner
-Bổ sung tính năng PEE: theo dõi giá sau đóng lệnh để tối ưu học máy.
-Bổ sung hiển thị tỉ lệ thắng của chiến thuật - tier coin, pnl theo ngày.

# 1.3.4
-Đại phẫu toàn bộ L1 - L6, thay đổi cơ chế chấm điểm, chuyển từ dạng bậc sang dạng phổ.
-Lồng L1-L6 vào quanmath, từ giờ matrix và hud chính đều xài chung.

# 1.3.5
-Tinh chỉnh optimizer
-Bỏ chiến thuật x10
-CHỈNH SỬA QUAN TRỌNG: Config setup vào lệnh 1 cách linh hoạt cho từng chiến thuật
-Đưa leverageBracket và commissionRate ra khỏi vòng lặp syncHUD.
-Giãn nhịp syncHUD từ 10 giây lên 15 giây.
-Chỉnh holding cycle thành dữ liệu thật (có thể dùng để học máy sau này)
-Phát triển tính năng paper trading (lấy 10 lệnh trên matrix ghi vào 1 database khác, rồi cronjob tự kiểm sau 5p)
-Điều chỉnh cách tính volumn ngày cho chính xác => lọc tier chính xác

# 1.3.6
-Cấy `detectMarketStructure` vào `QuantMath.js`:** Phân tích vi cấu trúc, lọc nhiễu SFP và MSB.
-Cấy `calculateTemporalBarrier` vào `QuantMath.js`:** Tính toán giới hạn số nến giữ lệnh (tHold) theo từng Tier và Phiên.
-Vá lỗi sập Scanner trong `server.js`:** Dời logic tính `assetTier` lên trước để làm đầu vào cho hàm `calculateTemporalBarrier`.
-Kích hoạt Rào cản thời gian trong `server.js`:** Thêm cơ chế tự động Market Close vị thế nếu gồng quá hạn `maxHoldingCycles`.
-Nâng cấp AI trong `optimizer.js`:** Thêm module P.E.E Thời gian, tự động nới/siết `tHold_modifier` nếu cắt lệnh quá vội.
-Chống lỗi ký quỹ trong `OrderForm.jsx`:** Áp trần đòn bẩy an toàn `Math.min(125)` để sàn không từ chối lệnh khi vốn biến động.
-Đồng bộ UI trong `App.jsx`:** Xóa hardcode `tHold = 3`, nối thẳng với lõi tính toán để lưu sổ cái chuẩn xác.

-Chỉnh matrix scanner: quét các đồng coin có volumn từ 3m$ 24h lên 30m$ 24h.
-Chỉ quét các coin có tuổi đời trên 365 ngày, biên động nến ngày k quá 25%.
-Chỉnh trailing engine từ 50% thành 25%
-Thêm tính năng theo dõi lãi
-Điều chỉnh chiến thuật Whale Imbalance
-Chỉnh bể coin: bổ sung bể coin legacy(tuổi đời trên 4 năm)
-Hiện điểm lên softgate
-Chỉnh sửa sâu softgate

# 1.3.7
-Bỏ chiến thuật Whale imbalane
-Thêm chiến thuật Climax hunt
-Dưới đây là các đầu mục chính chúng ta đã thực hiện để "lột xác" hệ thống:
-Sửa lỗi Core & Toán học:** Khắc phục lỗi sập ngầm (chia 0) khiến Scanner bỏ sót coin, chuẩn hóa hệ trục điểm số (về thang $0-100$) để đánh giá lệnh công bằng và minh bạch hơn.
-Bảo vệ Optimizer (AI):** Cô lập các lệnh chốt tay (`MANUAL_CLOSE`) để hệ thống học máy không bị "ngộ độc dữ liệu" và đẩy Take Profit lên mức ảo tưởng.
-Khai thác Insight từ Dữ liệu thực:** Bóc tách tệp CSV để phát hiện rủi ro chốt non (Alpha Decay), sự độc hại của VPIN $> 0.06$, và quyết định loại bỏ hoàn toàn chiến thuật "Whale Imbalance".
-Củng cố Kỷ luật thép (Hard Gates):** Chặn đứng lệnh tự động bằng các cổng mới khi: VPIN $> 0.06$, thị trường đi ngang (Range), mua đuổi (FOMO), hoặc dòng tiền (CMF) từ chối đồng thuận.
-Nâng cấp Auto Setup:** Tích hợp logic tự động đổi chiến thuật và thông số dựa trên Vector (VD: ép khớp Market và x2 TP khi gặp Climax Reversal, nới TP theo trạng thái Vĩ mô).
-Tối ưu Quản trị Rủi ro (Theo Tier):** Cá nhân hóa Stoploss, Take Profit và giới hạn thời gian gồng lệnh (khóa trần $10$ nến) cho từng Phân lớp tài sản (Tier) thay vì cào bằng.
-Hoàn thiện Trailing Stop:** Đổi cơ chế kéo Stoploss hòa vốn từ "% quãng đường kỳ vọng" sang mốc thực tế là **$0.5R$** (nửa bước rủi ro) để chống lại các cú săn thanh khoản (Fakeout).

# 1.3.8
-Bổ sung, chỉnh sửa 1 loạt các chiến thuật đánh
-Phát triển bot tự động đánh: đánh tối đa 650$ vốn, tổng lệnh dưới 400$ thì đánh tiếp, 1 lệnh tối đa 55$ và dưới 1% risk.
-Nâng cáp optimizer

# 1.3.9
-Thêm vwap, cvd, hurst, forced liquidation stream, orderbookheatmap & depth
-Bỏ obv
-Thêm các thông số mới vào chiến thuật

=========================================
/// FILE: package.json
=========================================

{
  "name": "trading-system",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "dotenv": "^17.4.2",
    "lucide-react": "^0.300.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "ws": "^8.21.1",
    "zustand": "^5.0.14"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "tailwindcss": "^3.4.0",
    "vite": "^7.3.6"
  }
}


=========================================
/// FILE: postcss.config.js
=========================================

export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}

=========================================
/// FILE: src/App.jsx
=========================================

// FILE: src/App.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { BrainCircuit, Activity, Loader2, ServerCrash, Bell, Server, Zap } from 'lucide-react';

import QuantMath from './core/QuantMath';
import { supabase } from './services/supabase';

import useLiveData from './hooks/useLiveData';
import useMatrixScanner from './hooks/useMatrixScanner';
import useExchangeConfig from './hooks/useExchangeConfig';

import MatrixScanner from './components/scanner/MatrixScanner';
import LiveMetrics from './components/terminal/LiveMetrics';
import VectorState from './components/terminal/VectorState';
import OrderForm from './components/terminal/OrderForm';
import LogicGates from './components/terminal/LogicGates';
import AiAudit from './components/terminal/AiAudit';
import TradeJournal from './components/terminal/TradeJournal';
import { TradeValidator } from './core/TradeValidator';
import useAppStore from './store/useAppStore';

export const SYSTEM_VERSION = "v1.3.9-alpha"; 

export default function AntiFragileTerminal() {

  const { 
    symbol, setSymbol, 
    intervalTime, setIntervalTime, 
    mvrvZScore, setMvrvZScore,
    tradeSetup, setTradeSetup,
    systemHealth, setSystemHealth,
    currentEpochId // <--- LẤY TỪ STORE CHO HỆ THỐNG THÍCH NGHI
  } = useAppStore();

  const [toast, setToast] = useState('');

  // GIỮ NGUYÊN BỘ CHỈ BÁO GỐC
  const [indicatorSpecs, setIndicatorSpecs] = useState({ emaFast: 12, emaSlow: 26, rsiPeriod: 14, bbPeriod: 20, bbStdDev: 2.0 });

  const [tradeLogs, setTradeLogs] = useState([]);
  const [tradeStats, setTradeStats] = useState({ totalClosed: 0, winRate: 0, avgWinR: 0, avgLossR: 1, historicalRR: 0, hasEnoughData: false });

  // STATE MỚI CHO HỘI ĐỒNG LƯỢNG TỬ (JSON MODE)
  const [councilReports, setCouncilReports] = useState([]);
  const [chiefDecision, setChiefDecision] = useState(null);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [geminiCooldown, setGeminiCooldown] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const { dynamicMinNotionals, dynamicPool, stepSizes, tickSizes } = useExchangeConfig();

  const {
    loading, lastUpdated, systemError, liveCapital, availableBalance,
    binancePositions, leverageBrackets, tradeFees,
    autoData, cmcData, apiMacro, aiModel 
  } = useLiveData({ symbol, intervalTime, indicatorSpecs, setSystemHealth });

  const { 
    scannedTopSetups, isScanningBackground, sonarEnabled, setSonarEnabled 
  } = useMatrixScanner({ 
    liveCapital, autoData, mvrvZScore, tradeFees, apiMacro, showToast,
    dynamicPool, dynamicMinNotionals, setSystemHealth, systemHealth,
    tradeLogs
  });

  useEffect(() => {
    if (geminiCooldown > 0) { 
      const t = setTimeout(() => setGeminiCooldown(c => c - 1), 1000); 
      return () => clearTimeout(t); 
    }
  }, [geminiCooldown]);

  // TỰ ĐỘNG BƠM MVRV XUỐNG BACKEND KHI NHẬP TAY
  useEffect(() => {
    const syncTimer = setTimeout(() => {
      fetch('/api/mvrv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mvrvZScore })
      }).catch(e => console.warn("Lỗi sync MVRV:", e.message));
    }, 500); // Đợi 500ms sau khi ngừng nhập mới gửi

    return () => clearTimeout(syncTimer); // Dọn dẹp timer nếu mvrvZScore thay đổi liên tục
  }, [mvrvZScore]);
  
  const fetchTradeLogs = async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase.from('trade_logs').select('*').order('created_at', { ascending: false }).limit(300);
      if (!error && data) setTradeLogs(data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    fetchTradeLogs();
    const subscription = supabase.channel('public:trade_logs').on('postgres_changes', { event: '*', schema: 'public', table: 'trade_logs' }, (payload) => {
        if (payload.eventType === 'INSERT') setTradeLogs(current => [payload.new, ...current].slice(0, 300));
        else if (payload.eventType === 'UPDATE') setTradeLogs(current => current.map(log => log.id === payload.new.id ? payload.new : log));
        else if (payload.eventType === 'DELETE') setTradeLogs(current => current.filter(log => log.id !== payload.old.id));
      }).subscribe();
    return () => supabase.removeChannel(subscription);
  }, []);

  useEffect(() => {
    const closedTrades = tradeLogs.filter(d => ['WIN', 'LOSS', 'PARTIAL_CLOSED'].includes(d.status) && d.symbol === symbol);
    let totalWinR = 0; let winCount = 0; let totalLossR = 0; let lossCount = 0;

    closedTrades.forEach(t => {
       const rMultiple = (parseFloat(t.pnl_usd) || 0) / (parseFloat(t.risk_amount_usd) || 1);
       if (t.pnl_usd > 0) { totalWinR += rMultiple; winCount++; }
       if (t.pnl_usd <= 0 && t.status === 'LOSS') { totalLossR += Math.abs(rMultiple); lossCount++; }
    });
    
    setTradeStats({ 
      totalClosed: closedTrades.length, 
      winRate: closedTrades.length > 0 ? (winCount / closedTrades.length) : 0, 
      avgWinR: winCount > 0 ? (totalWinR / winCount) : 0, 
      avgLossR: lossCount > 0 ? (totalLossR / lossCount) : 1, 
      historicalRR: (lossCount > 0 ? (totalLossR / lossCount) : 1) > 0 ? ((winCount > 0 ? (totalWinR / winCount) : 0) / (lossCount > 0 ? (totalLossR / lossCount) : 1)) : 0,
      hasEnoughData: closedTrades.length >= 30 
    });
  }, [tradeLogs, symbol]);

  const activeTierClass = useMemo(() => {
      if (!autoData || !apiMacro) return "Đang phân loại...";
      const usdVol24h = autoData.usdVolume24h || ((autoData.avgVolume20 || 0) * autoData.currentPrice * 24);
      return QuantMath.classifyAssetTier(symbol, usdVol24h, apiMacro.realSpreadPct);
  }, [symbol, autoData, apiMacro]);

  const vectorRegime = useMemo(() => {
    if (!autoData || !apiMacro || !cmcData) return null;
    return QuantMath.evaluateVectorState(autoData, apiMacro, mvrvZScore, symbol);
  }, [lastUpdated, apiMacro, cmcData, mvrvZScore, symbol]);

  const systemScore = useMemo(() => {
    if (!autoData || !apiMacro || !vectorRegime) return { score: 0, synergyText: "", penaltyText: "", checks: {}, w: {}, passingScore: 50 };
    
    // Tạm lấy Tier Model để truyền vào dynamicAsymmetricTargets
    const baseTierModel = aiModel?.tiers?.[activeTierClass] || aiModel?.global || aiModel;
    
    const { strategyName } = QuantMath.dynamicAsymmetricTargets(
        autoData, 
        apiMacro, 
        vectorRegime.details, 
        tradeSetup.direction, 
        baseTierModel,
        activeTierClass
    );

    // 🚀 BẢN VÁ BỊ THIẾU: Thêm logic bốc Model theo Ma trận (Matrix) giống hệt server.js
    const matrixKey = `${strategyName}|${activeTierClass}`;
    const tierModel = aiModel?.tiers?.[activeTierClass] || aiModel?.global || aiModel;
    const stratModel = aiModel?.strategies?.[strategyName];
    const matrixModel = aiModel?.matrix?.[matrixKey];

    // Ưu tiên: Matrix -> Strategy -> Tier
    const activeModel = matrixModel || stratModel || tierModel;

    return TradeValidator.evaluateScore(autoData, apiMacro, vectorRegime.details, tradeSetup.direction, mvrvZScore, symbol, activeModel);
  }, [lastUpdated, apiMacro, vectorRegime, tradeSetup.direction, mvrvZScore, symbol, aiModel, activeTierClass]);

  const mathCore = useMemo(() => {
    const safeResult = { appliedRiskPercent: 1.0, slPercent: "0.00", riskAmountUSD: "0.00", positionSizeUSD: "0.00", marginUsedUSD: "0.00", suggestedLeverage: 1, theoreticalRR: "0.00", trueEVValue: "0.00", kellyPct: 0, liqEstimate: null, liqSafetyMargin: 0, leverageExceedsExchangeCap: false, dynamicSlDistance: 0, isSizeForcedByExchange: false };
    if (!autoData || !vectorRegime || !tradeSetup.entry || tradeSetup.entry <= 0 || tradeSetup.slTech <= 0) return safeResult;
    
    const riskDiffTech = Math.abs(tradeSetup.entry - tradeSetup.slTech);
    
    // ĐỒNG BỘ: Sử dụng hệ số cRegime và Rào cản Thời gian từ lõi QuantMath
    let cRegime = 1.0;
    const l1Str = String(vectorRegime.details.l1 || "");
    if (l1Str.includes('Trend')) { cRegime = 1.2; } 
    else if (vectorRegime.details.l2 === 'Extreme') { cRegime = 0.5; } 
    else { cRegime = 0.8; }

    const currentHourUTC = new Date().getUTCHours();
    const tHold = QuantMath.calculateTemporalBarrier(
        intervalTime, 
        tradeSetup.tradeType, 
        tradeSetup.direction, 
        vectorRegime.details, 
        activeTierClass, 
        currentHourUTC
    );
    
    const minSafeAtr = 0.005; const isCompressed = vectorRegime.details.l2 === 'Compression' || autoData.bbwRank < 20;
    const effectiveAtrPercent = isCompressed ? Math.max(autoData.atrPercent, minSafeAtr * 100) * 1.5 : autoData.atrPercent;
    const slippageBuffer = tradeSetup.entry * (effectiveAtrPercent / 100) * cRegime * apiMacro.sessionMultiplier; 
    const sizeSlDistance = riskDiffTech + slippageBuffer; 
    let slPercentForSize = sizeSlDistance / tradeSetup.entry;
    if (!isFinite(slPercentForSize) || isNaN(slPercentForSize) || slPercentForSize === 0) slPercentForSize = 0.01;

    const activeMakerFee = tradeFees.maker; const activeTakerFee = tradeFees.taker;
    const costDragLoss = QuantMath.costDrag(tradeSetup.entry, tradeSetup.tradeType, tradeSetup.direction, tradeSetup.execution, 'MARKET', autoData.fundingRate / 100, apiMacro.realSpreadPct, tHold, activeMakerFee, activeTakerFee, intervalTime, autoData.obi);
    const costDragWin = QuantMath.costDrag(tradeSetup.entry, tradeSetup.tradeType, tradeSetup.direction, tradeSetup.execution, 'LIMIT', autoData.fundingRate / 100, apiMacro.realSpreadPct, tHold, activeMakerFee, activeTakerFee, intervalTime, autoData.obi);
    const rewardDiff1 = Math.abs(tradeSetup.tp1 - tradeSetup.entry);
    let theoreticalRR = riskDiffTech > 0 ? ((rewardDiff1 - costDragWin) / (riskDiffTech + costDragLoss)) : 0;
    if (!isFinite(theoreticalRR) || isNaN(theoreticalRR) || theoreticalRR < 0) theoreticalRR = 0;

    const bayesianPrior = 0.45; 
    const effWinRate = tradeStats.totalClosed < 30 ? ((bayesianPrior * (30 - tradeStats.totalClosed) + (tradeStats.winRate || 0) * tradeStats.totalClosed) / 30) : tradeStats.winRate; 
    const effLossRate = 1 - effWinRate;
    const trueEVCalc = QuantMath.trueEV(effWinRate, theoreticalRR, effLossRate, 1);

    const capitalSafe = liveCapital > 0 ? liveCapital : 0; 
    const passingScore = systemScore.passingScore || 50;
    const scoreRange = 100 - passingScore;
    const riskMultiplier = Math.max(0.5, Math.min(2.0, 
        0.5 + ((systemScore.score - passingScore) / scoreRange) * 1.5
    ));
    let appliedRiskPercent = tradeSetup.riskPercent * riskMultiplier;

    let riskAmountUSD = capitalSafe * (appliedRiskPercent / 100);
    let positionSizeUSD = riskAmountUSD / slPercentForSize; 
    if (!isFinite(positionSizeUSD) || isNaN(positionSizeUSD)) positionSizeUSD = 0;

    const targetMinThreshold = dynamicMinNotionals[symbol] || 5.0; 
    let isSizeForcedByExchange = false;
      
    if (positionSizeUSD > 0 && positionSizeUSD < targetMinThreshold) {
        positionSizeUSD = targetMinThreshold; 
        isSizeForcedByExchange = true;
        riskAmountUSD = positionSizeUSD * slPercentForSize; 
    }
    
    let suggestedLeverage = 1; let marginUsedUSD = positionSizeUSD;
    if (tradeSetup.tradeType === 'FUTURES') {
       let minRequiredLev = positionSizeUSD / (capitalSafe * 0.9 || 1);
       suggestedLeverage = Math.max(1, Math.ceil(minRequiredLev)); marginUsedUSD = positionSizeUSD / suggestedLeverage;
    }

    let liqEstimate = null; let leverageExceedsExchangeCap = false; let liqSafetyMargin = 0;
    if (tradeSetup.tradeType === 'FUTURES' && leverageBrackets) {
       liqEstimate = QuantMath.estimateLiquidation(positionSizeUSD, suggestedLeverage, tradeSetup.entry, tradeSetup.direction, leverageBrackets);
       if (liqEstimate) {
         if (suggestedLeverage > liqEstimate.maxLevForTier) {
             leverageExceedsExchangeCap = true; suggestedLeverage = liqEstimate.maxLevForTier; marginUsedUSD = positionSizeUSD / suggestedLeverage;
             liqEstimate = QuantMath.estimateLiquidation(positionSizeUSD, suggestedLeverage, tradeSetup.entry, tradeSetup.direction, leverageBrackets);
         }
         const liqDistancePct = Math.abs(tradeSetup.entry - liqEstimate.liqPrice) / tradeSetup.entry;
         const dynamicSlPct = sizeSlDistance / tradeSetup.entry; liqSafetyMargin = dynamicSlPct > 0 ? (liqDistancePct / dynamicSlPct) : 0; 
       }
    }

    let hasInsufficientMargin = false;
    if (parseFloat(marginUsedUSD) > availableBalance) {
        hasInsufficientMargin = true;
    }

    const hasMinNotionalError = riskAmountUSD > (capitalSafe * 0.05); // Lệnh ép vượt 5% vốn

    const kellyDec = QuantMath.kellyCriterion(tradeStats.winRate, tradeStats.historicalRR, tradeStats.totalClosed);
    return {
      appliedRiskPercent: appliedRiskPercent.toFixed(2),
      slPercentForSize: (slPercentForSize * 100).toFixed(2), riskAmountUSD: riskAmountUSD.toFixed(2), positionSizeUSD: positionSizeUSD.toFixed(2), marginUsedUSD: marginUsedUSD.toFixed(2),
      suggestedLeverage, theoreticalRR: theoreticalRR.toFixed(2), trueEVValue: trueEVCalc.toFixed(3), kellyPct: (kellyDec * 100).toFixed(2),
      liqEstimate, liqSafetyMargin, leverageExceedsExchangeCap, dynamicSlDistance: sizeSlDistance, isSizeForcedByExchange,
      hasInsufficientMargin,
      hasMinNotionalError,
      tHold 
    };
  }, [autoData, apiMacro, liveCapital, availableBalance, tradeSetup, symbol, tradeStats, leverageBrackets, vectorRegime, tradeFees, dynamicMinNotionals, systemScore.score, intervalTime]); 

  const logicGates = useMemo(() => {
    if (!autoData || !mathCore || !vectorRegime) return { hardGates: [], softGates: [], softScore: 0, isApproved: false };
    return TradeValidator.evaluateGates(
       autoData, apiMacro, vectorRegime.details, mathCore, tradeSetup.direction, 
       tradeSetup.tradeType, tradeSetup.entry, tradeSetup.slTech, systemScore, tradeLogs, symbol
    );
  }, [lastUpdated, mathCore, tradeSetup, apiMacro, vectorRegime, symbol, systemScore, tradeLogs]);


  // ==============================================================
  // LUỒNG AI TRANH BIỆN LƯỢNG TỬ (BACKEND SERVERLESS)
  // ==============================================================
  const runQuantumCouncilAnalysis = async () => {
    if (geminiCooldown > 0 || !autoData || !mathCore || !vectorRegime) return;
    setIsAnalyzing(true); 
    setChiefDecision(null);
    setCouncilReports([]);

    // Tự động phân loại tài sản để định hình chiến thuật tại Backend
    const activeTierClass = QuantMath.classifyAssetTier(
          symbol, 
          autoData.usdVolume24h || ((autoData.avgVolume20 || 0) * autoData.currentPrice * 24), 
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

  const handleSaveTradeLog = async (executionMetrics = { latency: 0, slippage: 0, exactEntry: null }) => {
    if (!supabase) return;
    try {
      // (Bỏ toàn bộ các biến const compressedAutoData và fullSystemContext)
      
      const activeTierClass = QuantMath.classifyAssetTier(
          symbol, 
          (autoData.avgVolume20 || 0) * autoData.currentPrice * 24, 
          apiMacro.realSpreadPct
      );

      const payload = {
        symbol, interval: intervalTime, type: tradeSetup.tradeType, direction: tradeSetup.direction,
        entry: executionMetrics.exactEntry ? executionMetrics.exactEntry : parseFloat(tradeSetup.entry), 
        sl: parseFloat(tradeSetup.slTech), 
        tp_1_price: parseFloat(tradeSetup.tp1), 
        
        risk_amount_usd: Math.max(0.1, parseFloat(mathCore.riskAmountUSD)), 
        position_size_usd: parseFloat(mathCore.positionSizeUSD),
        rr: parseFloat(mathCore.theoreticalRR), 
        
        // --- CÁC CỘT THỐNG KÊ LÕI ---
        adx: parseFloat(autoData.adx),
        atr: parseFloat(autoData.atr14),
        rsi: parseFloat(autoData.rsi),
        cmf: parseFloat(autoData.cmf),
        bbw_rank: parseInt(autoData.bbwRank),
        oi_delta: parseFloat(autoData.oiDelta || 0),
        funding_rate: parseFloat(autoData.fundingRate),
        funding_slope: parseFloat(autoData.fundingSlope || 0),
        taker_ratio: parseFloat(apiMacro.takerBuySellRatio || 1),
        btc_dom_slope: parseFloat(autoData.btcDomSlope || 0),
        mvrv: parseFloat(mvrvZScore),
        fgi: parseInt(apiMacro.fgiValue),

        // --- CÁC CỘT VI CẤU TRÚC VÀ RỦI RO (MỚI) ---
        vpin: parseFloat(autoData.vpinValue || 0),
        obi: parseFloat(autoData.obi || 0.5),
        amihud: parseFloat(autoData.amihud || 0),
        isi: parseFloat(autoData.isi || 0),
        // 🚀 BỔ SUNG 7 CỘT LƯỢNG TỬ MỚI VÀO ĐÂY:
        cvd_trend: parseFloat(autoData.cvdTrend || 0),
        vwap: parseFloat(autoData.vwap || 0),
        vwap_upper: parseFloat(autoData.vwapUpper || 0),
        vwap_lower: parseFloat(autoData.vwapLower || 0),
        hurst_value: parseFloat(autoData.hurstValue || 0),
        liq_longs_vol: parseFloat(autoData.liqLongsVol || 0),
        liq_shorts_vol: parseFloat(autoData.liqShortsVol || 0),
        // ------------------------------------------
        true_ev: parseFloat(mathCore.trueEVValue || 0),
        kelly_pct: parseFloat(mathCore.kellyPct || 0),
        trailing_activated: false, // Mặc định khi mở lệnh là False
        
        // --- BÓC TÁCH SOFT GATES (MỚI) ---
        gate_s1: systemScore.checks.checkS1 || false,
        gate_s2: systemScore.checks.checkS2 || false,
        gate_s3: systemScore.checks.checkS3 || false,
        gate_s4: systemScore.checks.checkS4 || false,
        gate_s5: systemScore.checks.checkS5 || false,
        gate_s6: systemScore.checks.checkS6 || false,
        gate_s7: systemScore.checks.checkS7 || false,
        gate_s8: systemScore.checks.checkS8 || false,

        trend_sma200: autoData.currentPrice > autoData.htfSma200 ? 'UP' : 'DOWN', 
        leverage: parseFloat(mathCore.suggestedLeverage), 
        status: 'PENDING', pnl_usd: 0, session: apiMacro.tradingSession,
        l1_structure: vectorRegime.details.l1, l2_volatility: vectorRegime.details.l2, l3_liq_event: vectorRegime.details.l3,
        l4_positioning: vectorRegime.details.l4, l5_momentum: vectorRegime.details.l5, l6_macro: vectorRegime.details.l6,
        
        soft_score: parseFloat(logicGates.softScore), 
        holding_cycles: mathCore.tHold || 1, // Đã giữ lại theo yêu cầu
        strategy_name: tradeSetup.activeStrategy || '🤖 AI ADAPTIVE (MANUAL)',
        capital_at_entry_usd: parseFloat(liveCapital.toFixed(2)), strategy_version: SYSTEM_VERSION, 
        applied_risk_pct: parseFloat(mathCore.appliedRiskPercent), 
        
        asset_tier: activeTierClass,
        epoch_id: currentEpochId || 'epoch-alpha-001', 
        slippage_usd: executionMetrics.slippage || 0,
        max_favorable_excursion_usd: 0, 
        max_adverse_excursion_usd: 0   
      };
      
      const { data, error } = await supabase.from('trade_logs').insert([payload]).select();
      if (error) {
          console.error("Lỗi Supabase Detail:", error);
          throw error;
      }
      if (data && data.length > 0) setTradeLogs(current => [data[0], ...current].slice(0, 300));
      showToast("☁️ ĐÃ LƯU SỔ TAY THÀNH CÔNG!");
    } catch (e) { 
        showToast(`❌ Lỗi Supabase: Kiểm tra Console F12 để xem chi tiết.`); 
    }
  };

  const syncBinanceToSupabase = async (isSilent = false) => {
    if (!supabase || !tradeLogs || tradeLogs.length === 0) return;
    setIsSyncing(true);
    
    try {
      if (!isSilent) showToast("🔄 Khởi chạy Kiểm toán Sổ cái Độc lập (Isolated Ledger Sync)...");
      const uniqueSymbols = [...new Set(tradeLogs.map(log => log.symbol))];
      let updatedCount = 0;
      const ts = Date.now();

      for (const sym of uniqueSymbols) {
          const symLogs = tradeLogs.filter(l => l.symbol === sym).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          const currentPosition = binancePositions?.find(p => p.symbol === sym);
          const positionAmt = currentPosition ? parseFloat(currentPosition.positionAmt) : 0;

          let binanceTrades = [];
          let openOrders = [];
          
          // 1. NHẬN DIỆN LOẠI THỊ TRƯỜNG CỦA TOKEN
          const hasFutures = symLogs.some(l => l.type === 'FUTURES' || !l.type);
          const hasSpot = symLogs.some(l => l.type === 'SPOT');

          try {
              // 2. KÉO LỊCH SỬ FUTURES (Nếu có)
              if (hasFutures) {
                  const tradeRes = await fetch(`/api/binance?path=/fapi/v1/userTrades&symbol=${sym}&isPrivate=true&limit=1000&t=${ts}`);
                  if (tradeRes.ok) {
                      const data = await tradeRes.json();
                      binanceTrades.push(...data.map(d => ({ ...d, tradeType: 'FUTURES', normalizedSide: d.side })));
                  }
                  
                  const orderRes = await fetch(`/api/binance?path=/fapi/v1/openOrders&symbol=${sym}&isPrivate=true&t=${ts}`);
                  if (orderRes.ok) {
                      const data = await orderRes.json();
                      openOrders.push(...data.map(d => ({ ...d, tradeType: 'FUTURES' })));
                  }
              }

              // 3. KÉO LỊCH SỬ SPOT (Nếu có)
              if (hasSpot) {
                  const tradeRes = await fetch(`/api/binance?path=/api/v3/myTrades&symbol=${sym}&isPrivate=true&limit=1000&t=${ts}`);
                  if (tradeRes.ok) {
                      const data = await tradeRes.json();
                      binanceTrades.push(...data.map(d => ({ ...d, tradeType: 'SPOT', normalizedSide: d.isBuyer ? 'BUY' : 'SELL' })));
                  }
                  
                  const orderRes = await fetch(`/api/binance?path=/api/v3/openOrders&symbol=${sym}&isPrivate=true&t=${ts}`);
                  if (orderRes.ok) {
                      const data = await orderRes.json();
                      openOrders.push(...data.map(d => ({ ...d, tradeType: 'SPOT' })));
                  }
              }
          } catch(e) { 
              // BỎ QUA LỖI 400 (DO TOKEN DELIST HOẶC FAKE) ĐỂ VÒNG LẶP KHÔNG BỊ CHẾT
              console.warn(`Bỏ qua đồng bộ ${sym} do API từ chối.`); 
              continue; 
          }

          // 4. XỬ LÝ ĐÓNG LỆNH CHO TỪNG DÒNG LOG
          for (let i = 0; i < symLogs.length; i++) {
              const log = symLogs[i];
              const logTradeType = log.type || 'FUTURES';
              const logStartTime = new Date(log.created_at).getTime() - 60000; 
              const logEndTime = Date.now();

              // Lọc các giao dịch chỉ thuộc đúng thị trường (Spot/Futures)
              const cycleTrades = binanceTrades.filter(t => t.tradeType === logTradeType && t.time >= logStartTime && t.time <= logEndTime);

              const entrySide = log.direction === 'LONG' ? 'BUY' : 'SELL';
              const exitSide = log.direction === 'LONG' ? 'SELL' : 'BUY';
              
              const entryTrades = cycleTrades.filter(t => t.normalizedSide === entrySide);
              const closingTrades = cycleTrades.filter(t => t.normalizedSide === exitSide);

              // =========================================================
              // XỬ LÝ LỆNH CHỜ KHỚP (PENDING)
              // =========================================================
              if (log.status === 'PENDING') {
                 const isStillOpen = openOrders.some(o => o.tradeType === logTradeType && o.side === entrySide && Math.abs(parseFloat(o.price) - parseFloat(log.entry)) / parseFloat(log.entry) < 0.005);
                 
                 if (entryTrades.length > 0 || (logTradeType === 'FUTURES' && positionAmt !== 0 && !isStillOpen)) {
                     let exactEntryPrice = parseFloat(log.entry);
                     if (entryTrades.length > 0) {
                         const totalQty = entryTrades.reduce((sum, t) => sum + parseFloat(t.qty), 0);
                         exactEntryPrice = entryTrades.reduce((sum, t) => sum + (parseFloat(t.price) * parseFloat(t.qty)), 0) / totalQty;
                     }

                     await supabase.from('trade_logs').update({ 
                         status: 'OPEN', 
                         entry: exactEntryPrice 
                     }).eq('id', log.id);
                     updatedCount++;
                 }
              } 
              // =========================================================
              // XỬ LÝ LỆNH ĐANG CHẠY (OPEN) VÀ TÍNH PNL CÁCH LY
              // =========================================================
              else if (log.status === 'OPEN' || log.status === 'CLOSED') {
                 const isPositionCleared = logTradeType === 'SPOT' ? true : positionAmt === 0;

                 if (closingTrades.length > 0 && isPositionCleared) {
                    const totalQty = closingTrades.reduce((sum, t) => sum + parseFloat(t.qty), 0);
                    const exitPrice = totalQty > 0 ? closingTrades.reduce((sum, t) => sum + (parseFloat(t.price) * parseFloat(t.qty)), 0) / totalQty : parseFloat(log.entry); 

                    const logSizeCoin = parseFloat(log.position_size_usd) / parseFloat(log.entry);
                    const logEntry = parseFloat(log.entry);
                    const rawIsolatedPnl = log.direction === 'LONG' ? (exitPrice - logEntry) * logSizeCoin : (logEntry - exitPrice) * logSizeCoin;
                    
                    const estimatedFee = (logSizeCoin * exitPrice) * 0.0004; 
                    const finalIsolatedPnl = rawIsolatedPnl - estimatedFee;

                    let preciseExitReason = 'MANUAL_CLOSE';
                    const tpPrice = parseFloat(log.tp_1_price);
                    const slPrice = parseFloat(log.sl);
                    const tolerance = exitPrice * 0.003; 

                    if (log.direction === 'LONG') {
                        if (exitPrice >= tpPrice - tolerance) preciseExitReason = 'TAKE_PROFIT_HIT';
                        else if (exitPrice <= slPrice + tolerance) preciseExitReason = 'STOP_LOSS_HIT';
                    } else {
                        if (exitPrice <= tpPrice + tolerance) preciseExitReason = 'TAKE_PROFIT_HIT';
                        else if (exitPrice >= slPrice - tolerance) preciseExitReason = 'STOP_LOSS_HIT';
                    }

                    const exitTime = new Date(closingTrades[closingTrades.length - 1].time);
                    // 🧠 THUẬT TOÁN TÍNH TOÁN DỮ LIỆU THẬT CHO HOLDING CYCLE
                    const INTERVAL_MS = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
                    const intervalMs = INTERVAL_MS[log.interval] || 3600000;
                    // Lấy Thời gian đóng - Thời gian mở / Khung giờ nến
                    const actualHoldingCycles = Math.max(1, Math.ceil((exitTime.getTime() - new Date(log.created_at).getTime()) / intervalMs));

                    // =========================================================
                    // 🧠 LÕI THUẬT TOÁN MFE/MAE THÍCH ỨNG (ADAPTIVE KLINES)
                    // =========================================================
                    let maxMfeUsd = 0;
                    let maxMaeUsd = 0;
                    
                    try {
                        const durationMs = exitTime.getTime() - logStartTime;
                        let klineInterval = '1m'; // Mặc định Scalp (< 15h)
                        
                        // Co giãn khung thời gian tự động để bảo vệ Weight Limit (< 1000 nến)
                        if (durationMs > 10 * 24 * 60 * 60 * 1000) klineInterval = '1h';       // > 10 ngày
                        else if (durationMs > 3 * 24 * 60 * 60 * 1000) klineInterval = '15m'; // 3 - 10 ngày
                        else if (durationMs > 15 * 60 * 60 * 1000) klineInterval = '5m';      // 15h - 3 ngày

                        const basePath = logTradeType === 'SPOT' ? '/api/v3/klines' : '/fapi/v1/klines';
                        const klinesRes = await fetch(`/api/binance?path=${basePath}&symbol=${sym}&interval=${klineInterval}&startTime=${logStartTime}&endTime=${exitTime.getTime()}&limit=1500&t=${ts}`);
                        
                        if (klinesRes.ok) {
                            const klines = await klinesRes.json();
                            if (klines && klines.length > 0) {
                                // Quét mảng Klines để tìm đỉnh/đáy tuyệt đối trong quãng đời của lệnh
                                const absoluteHigh = Math.max(...klines.map(k => parseFloat(k[2])));
                                const absoluteLow = Math.min(...klines.map(k => parseFloat(k[3])));
                                
                                if (log.direction === 'LONG') {
                                    maxMfeUsd = Math.max(0, (absoluteHigh - logEntry) * logSizeCoin);
                                    maxMaeUsd = Math.min(0, (absoluteLow - logEntry) * logSizeCoin); // Ra số âm
                                } else {
                                    maxMfeUsd = Math.max(0, (logEntry - absoluteLow) * logSizeCoin);
                                    maxMaeUsd = Math.min(0, (logEntry - absoluteHigh) * logSizeCoin); // Ra số âm
                                }
                            }
                        }
                    } catch (err) {
                        console.warn(`[Klines Engine] Lỗi ngoại suy MAE/MFE cho ${sym}:`, err.message);
                    }
                    // =========================================================
           
                    await supabase.from('trade_logs').update({ 
                        status: finalIsolatedPnl > 0 ? 'WIN' : 'LOSS', 
                        pnl_usd: finalIsolatedPnl, 
                        close_price: exitPrice,
                        exit_reason: preciseExitReason, 
                        close_time: exitTime.toISOString(),
                        max_favorable_excursion_usd: maxMfeUsd, 
                        max_adverse_excursion_usd: maxMaeUsd,
                        holding_cycles: actualHoldingCycles   
                    }).eq('id', log.id);
                    
                    updatedCount++;

                    if (logTradeType === 'FUTURES') {
                        fetch('/api/cancel-orphans', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: log.symbol }) }).catch(e=>e);
                    }
                  // 🚀 BẢN VÁ TỐI THƯỢNG: QUÉT RÁC CÁC LỆNH BỊ KẸT MÀ API BINANCE TỪ CHỐI TRẢ VỀ
                 else if (log.status === 'CLOSED') {
                    const logEntry = parseFloat(log.entry);
                    const logSizeCoin = parseFloat(log.position_size_usd) / logEntry;
                    const fallbackExitPrice = log.close_price ? parseFloat(log.close_price) : logEntry;
                    
                    const rawIsolatedPnl = log.direction === 'LONG' 
                        ? (fallbackExitPrice - logEntry) * logSizeCoin 
                        : (logEntry - fallbackExitPrice) * logSizeCoin;
                    
                    const fallbackStatus = rawIsolatedPnl > 0 ? 'WIN' : (rawIsolatedPnl < 0 ? 'LOSS' : 'CANCELED');

                    await supabase.from('trade_logs').update({ 
                        status: fallbackStatus, 
                        pnl_usd: rawIsolatedPnl, 
                        exit_reason: log.exit_reason || 'FORCE_SYNC_RESOLVED', 
                        close_time: log.close_time || new Date().toISOString()
                    }).eq('id', log.id);
                    
                    updatedCount++;
                 }
                 } else if (logTradeType === 'FUTURES' && positionAmt !== 0) { 
                    // [GIỮ NGUYÊN ĐOẠN NÀY ĐỂ TRACKING LIVE TRÊN GIAO DIỆN]
                    const markPrice = parseFloat(currentPosition?.markPrice || currentPosition?.entryPrice || log.entry);
                    const logSizeCoin = parseFloat(log.position_size_usd) / parseFloat(log.entry);
                    const livePnl = log.direction === 'LONG' 
                        ? (markPrice - parseFloat(log.entry)) * logSizeCoin 
                        : (parseFloat(log.entry) - markPrice) * logSizeCoin;
                        
                    let newMfe = log.max_favorable_excursion_usd || 0; 
                    let newMae = log.max_adverse_excursion_usd || 0;
                    let requiresUpdate = false;
                    
                    if (livePnl > newMfe) { newMfe = livePnl; requiresUpdate = true; }
                    if (livePnl < newMae) { newMae = livePnl; requiresUpdate = true; }

                    // 🚀 BẢN VÁ: ĐỒNG BỘ SL CHỈNH TAY TỪ BINANCE VỀ SUPABASE
                    const activeStopOrders = openOrders.filter(o => o.tradeType === 'FUTURES' && (o.type === 'STOP_MARKET' || o.origType === 'STOP_MARKET'));
                    if (activeStopOrders.length > 0) {
                        const expectedExitSide = log.direction === 'LONG' ? 'SELL' : 'BUY';
                        const currentLiveSl = activeStopOrders.find(o => o.side === expectedExitSide);
                        
                        if (currentLiveSl && currentLiveSl.stopPrice) {
                            const liveSlPrice = parseFloat(currentLiveSl.stopPrice);
                            // Nhận diện SL bị lệch so với DB
                            if (Math.abs(liveSlPrice - parseFloat(log.sl)) > (parseFloat(log.sl) * 0.0005)) {
                                // Tự động xác định xem SL mới đã là mốc An Toàn chưa
                                const isSafe = log.direction === 'LONG' ? liveSlPrice >= parseFloat(log.entry) : liveSlPrice <= parseFloat(log.entry);
                                
                                await supabase.from('trade_logs').update({ 
                                    sl: liveSlPrice,
                                    trailing_activated: isSafe || log.trailing_activated,
                                    max_favorable_excursion_usd: newMfe,
                                    max_adverse_excursion_usd: newMae
                                }).eq('id', log.id);
                                requiresUpdate = false; // Đã gom update, ko cần update rời nữa
                            }
                        }
                    }

                    if (requiresUpdate) {
                        await supabase.from('trade_logs').update({ 
                            max_favorable_excursion_usd: newMfe, 
                            max_adverse_excursion_usd: newMae 
                        }).eq('id', log.id);
                    }
                 }
              }
          }
      }

      if (updatedCount > 0) {
          fetchTradeLogs();
          if (!isSilent) showToast(`✅ Deep Sync thành công! Xử lý chuẩn xác ${updatedCount} trạng thái lệnh.`);
      } else {
          if (!isSilent) showToast(`✅ Sổ cái hoàn hảo. Tuyệt đối không sai lệch.`);
      }

    } catch (e) { 
      if (!isSilent) showToast(`❌ Lỗi đồng bộ: ${e.message}`); 
    } finally { 
      setIsSyncing(false); 
    }
  };

 const handleMasterAuto = () => { 
    if (!autoData || !vectorRegime) return;

    let bestSetup = null;
    let highestScore = -999;

    // Test cả 2 hướng hệt như Matrix Scanner
    const directions = ['LONG', 'SHORT'];
    
    for (const dir of directions) {
        
        // GỌI HÀM THEO KIẾN TRÚC MỚI
        const setupInfo = QuantMath.dynamicAsymmetricTargets(
            autoData, 
            apiMacro, 
            vectorRegime.details, 
            dir, 
            aiModel,
            activeTierClass
        );

        const tmpScore = TradeValidator.evaluateScore(autoData, apiMacro, vectorRegime.details, dir, mvrvZScore, symbol, aiModel);

        // 3. Chọn hướng có điểm số cao nhất
        if (tmpScore.score > highestScore) {
            highestScore = tmpScore.score;
            bestSetup = { ...setupInfo, direction: dir };
        }
    }

    if (bestSetup) {
        const sl = bestSetup.direction === 'LONG' 
            ? bestSetup.suggestedEntry - (bestSetup.slMult * autoData.atr14) 
            : bestSetup.suggestedEntry + (bestSetup.slMult * autoData.atr14);
            
        const tp1 = bestSetup.direction === 'LONG' 
            ? bestSetup.suggestedEntry + (bestSetup.tpMult * autoData.atr14) 
            : bestSetup.suggestedEntry - (bestSetup.tpMult * autoData.atr14);

        const tick = tickSizes[symbol] || 0.0001;
        const tickStr = parseFloat(tick).toString();
        const precision = tickStr.includes('e-') ? parseInt(tickStr.split('e-')[1]) : (tickStr.includes('.') ? tickStr.split('.')[1].length : 4);

        setTradeSetup(prev => ({ 
          ...prev, 
          direction: bestSetup.direction, 
          execution: bestSetup.execType, 
          entry: Number(bestSetup.suggestedEntry.toFixed(precision)), 
          slTech: Number(sl.toFixed(precision)), 
          tp1: Number(tp1.toFixed(precision)),
          activeStrategy: bestSetup.strategyName 
        }));
        
        showToast(`⚡ KÍCH HOẠT: ${bestSetup.strategyName} | ${bestSetup.execType} | SL: ${bestSetup.slMult.toFixed(2)} ATR | TP: ${bestSetup.tpMult.toFixed(1)} ATR`);
    }
  };

  const handlePaperTradeTop10 = async () => {
    if (!scannedTopSetups || scannedTopSetups.length === 0 || scannedTopSetups[0].isEmpty) {
        showToast("⚠️ Không có Setup hợp lệ trên Radar để đánh ảo!");
        return;
    }
    
    showToast("⏳ Đang tính toán ma trận và bắn 10 lệnh ảo vào Paper Ledger...");

    const top10 = scannedTopSetups.slice(0, 10);
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
            strategy_name: setup.overrideTag || '🤖 AI ADAPTIVE (PAPER)',
            capital_at_entry_usd: simulatedCapital,
            asset_tier: setup.assetTier,
            applied_risk_pct: tradeSetup.riskPercent,
            holding_cycles: 1,
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

  const injectScannedSetup = (setup) => {
    setSymbol(setup.symbol); setIntervalTime(setup.interval);
    setTradeSetup(prev => ({ 
        ...prev, direction: setup.direction, entry: setup.entry, 
        slTech: setup.slTech, tp1: setup.tp1, 
        // 🛠️ BẢN VÁ: Thay "TIÊU CHUẨN" thành tên chuẩn
        activeStrategy: setup.overrideTag || "🤖 AI ADAPTIVE" 
    }));
    showToast(`🚀 Đã nạp cấu trúc ${setup.symbol} [${setup.interval}] lên tổng đài chỉ huy!`);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-200 font-mono p-2 md:p-6 relative overflow-x-hidden">
      {systemError && (
        <div className="fixed top-0 left-0 w-full bg-red-600/90 text-white text-center py-1.5 text-xs font-bold z-[100] flex justify-center items-center gap-2 shadow-lg">
          <ServerCrash className="w-4 h-4 animate-pulse"/> API BINANCE DOWN HOẶC VERCEL BLOCKED!
        </div>
      )}
      {toast && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 px-4 py-2 rounded shadow-2xl flex items-center gap-2">
          <Bell className="w-4 h-4 text-emerald-400" /> <span className="text-xs">{toast}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-center gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-emerald-500 flex items-center gap-2 tracking-tighter">
            <BrainCircuit className="w-7 h-7" /> ANTI-FRAGILE <span className="text-slate-500">V5.5.0 (Quantum Watch)</span>
          </h1>
          <p className="text-slate-500 text-[10px] mt-1 uppercase tracking-widest flex items-center gap-2">
            {lastUpdated ? `Sync: ${lastUpdated.toLocaleTimeString()}` : 'Khởi động Core...'}
            <span className="text-blue-400 border border-blue-900/50 bg-blue-900/10 px-1.5 rounded">{apiMacro.tradingSession}</span>
            {tradeStats.hasEnoughData ? (
               <span className="text-purple-400 border border-purple-900/50 bg-purple-900/10 px-1.5 rounded">
                 WR: {Number(tradeStats.winRate * 100 || 0).toFixed(1)}% | RR: {Number(tradeStats.historicalRR || 0).toFixed(2)}
               </span>
            ) : (
               <span className="text-amber-500 border border-amber-900/50 bg-amber-900/10 px-1.5 rounded">COLD START N={tradeStats.totalClosed}/30</span>
            )}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
            <button 
             onClick={handlePaperTradeTop10} 
             className="bg-purple-900/40 hover:bg-purple-600/60 text-purple-300 border border-purple-500/50 px-3 py-1.5 rounded text-[10px] font-black flex items-center gap-2 transition-all shadow-[0_0_10px_rgba(168,85,247,0.2)]"
          >
             <Zap className="w-3 h-3" /> BẮN 10 LỆNH ẢO
          </button>
          <div className={`px-2 py-1 rounded text-[9px] font-bold border flex flex-col items-center ${systemHealth.weight > 2000 ? 'bg-red-950/50 text-red-400 border-red-900 animate-pulse' : systemHealth.weight > 1200 ? 'bg-amber-950/50 text-amber-400 border-amber-900' : 'bg-slate-900/50 text-emerald-400 border-slate-700'}`}>
              <span>API LIMIT: {systemHealth.weight}/{systemHealth.maxWeight}</span>
              <span className={`text-[7px] ${systemHealth.latency > 3000 ? 'text-red-500 animate-pulse' : 'text-slate-500'}`}>VERCEL RTT: {systemHealth.latency}ms</span>
          </div>

          <div className="flex items-center gap-2 bg-slate-900/50 p-1.5 rounded border border-slate-800">
            <select className="bg-black text-emerald-400 font-bold px-3 py-1.5 rounded border border-slate-700/50 outline-none text-sm cursor-pointer" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {dynamicPool.map(sym => (
                <option key={sym} value={sym}>{sym.replace('USDT', '/USDT')}</option>
              ))}
            </select>
            <select className="bg-black text-blue-400 font-bold px-3 py-1.5 rounded border border-slate-700/50 outline-none text-sm cursor-pointer" value={intervalTime} onChange={(e) => setIntervalTime(e.target.value)}>
              <option value="5m">M5 (Scalp)</option><option value="15m">M15 (Day)</option><option value="1h">H1 (Swing)</option>
              <option value="4h">H4 (Macro)</option><option value="1d">D1 (Trend)</option>
            </select>
            <div className="px-3 border-l border-slate-700/50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin text-slate-500"/> : <Activity className="w-4 h-4 text-emerald-500"/>}
            </div>
          </div>
        </div>
      </div>

      <MatrixScanner
        scannedTopSetups={scannedTopSetups}
        isScanningBackground={isScanningBackground}
        sonarEnabled={sonarEnabled}
        setSonarEnabled={setSonarEnabled}
        injectScannedSetup={injectScannedSetup}
      />

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-6">
          <LiveMetrics autoData={autoData} apiMacro={apiMacro} cmcData={cmcData} indicatorSpecs={indicatorSpecs} mvrvZScore={mvrvZScore} setMvrvZScore={setMvrvZScore} activeTierClass={activeTierClass} />
          <VectorState vectorRegime={vectorRegime} mvrvZScore={mvrvZScore} autoData={autoData} />
          <OrderForm 
            autoData={autoData} tradeSetup={tradeSetup} setTradeSetup={setTradeSetup} 
            liveCapital={liveCapital} availableBalance={availableBalance} mathCore={mathCore} tradeStats={tradeStats} 
            symbol={symbol} handleMasterAuto={handleMasterAuto} 
            stepSizes={stepSizes} tickSizes={tickSizes}
            handleSaveTradeLog={handleSaveTradeLog}
            syncBinanceToSupabase={syncBinanceToSupabase}
          />
          <TradeJournal 
            tradeLogs={tradeLogs} 
            currentPrice={autoData?.currentPrice} 
            syncBinanceToSupabase={syncBinanceToSupabase} 
            isSyncing={isSyncing} 
            binancePositions={binancePositions}
          />
        </div>

        <div className="lg:col-span-5 flex flex-col gap-6">
          <LogicGates logicGates={logicGates} tradeSetup={tradeSetup} mathCore={mathCore} handleSaveTradeLog={handleSaveTradeLog} />
          <AiAudit 
            autoData={autoData} 
            runQuantumCouncilAnalysis={runQuantumCouncilAnalysis} 
            isAnalyzing={isAnalyzing} 
            geminiCooldown={geminiCooldown} 
            councilReports={councilReports}
            chiefDecision={chiefDecision}
          />
        </div>
      </div>
    </div>
  );
}

=========================================
/// FILE: src/components/scanner/MatrixScanner.jsx
=========================================

import React from 'react';
import { Crosshair, Loader2, Bell, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { getMinNotional } from '../../config/constants';

export default function MatrixScanner({
  scannedTopSetups,
  isScanningBackground,
  sonarEnabled,
  setSonarEnabled,
  injectScannedSetup
}) {
  // Hàm tạo màu sắc cho Tier
  const getTierStyle = (tierStr) => {
      if (!tierStr) return 'bg-slate-900 text-slate-500 border-slate-700';
      if (tierStr.includes('Tier 1')) return 'bg-blue-900/30 text-blue-400 border-blue-500/30';
      if (tierStr.includes('Tier 2')) return 'bg-emerald-900/30 text-emerald-400 border-emerald-500/30';
      if (tierStr.includes('Tier 3')) return 'bg-amber-900/30 text-amber-400 border-amber-500/30';
      return 'bg-pink-900/30 text-pink-400 border-pink-500/30 shadow-[0_0_5px_rgba(236,72,153,0.3)]'; 
  };
  return (
    <div className="max-w-7xl mx-auto mb-6">
      <div className="bg-[#111116] border border-emerald-900/50 rounded-xl p-4 shadow-xl">
        <div className="flex justify-between items-center border-b border-emerald-900/30 pb-2 mb-3">
          <h3 className="text-xs font-black text-emerald-400 flex items-center gap-2 tracking-widest uppercase">
            <Crosshair className="w-4 h-4 animate-pulse text-emerald-400" /> MATRIX SCANNER: ALPHA ASSETS (GATES PASSED)
          </h3>
          <div className="flex items-center gap-3 text-[9px] text-slate-500 font-mono">
            <button
              onClick={() => setSonarEnabled(!sonarEnabled)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-all ${
                sonarEnabled
                  ? 'bg-emerald-950 text-emerald-400 border-emerald-500/50'
                  : 'bg-slate-900 text-slate-500 border-slate-700'
              }`}
            >
              <Bell className={`w-3 h-3 ${sonarEnabled ? 'animate-bounce' : ''}`} />
              {sonarEnabled ? 'SONAR: ON' : 'SONAR: OFF'}
            </button>

            {isScanningBackground ? (
              <span className="flex items-center gap-1 text-amber-400 animate-pulse">
                <Loader2 className="w-2.5 h-2.5 animate-spin" /> DEEP RE-INDEXING...
              </span>
            ) : (
              <span>40S/CYCLE</span>
            )}
          </div>
        </div>

        {scannedTopSetups.length === 0 ? (
          <div className="text-center py-4 text-slate-600 text-xs font-bold uppercase tracking-wider animate-pulse">
            Khởi động Động cơ Lượng tử, rà soát Logic Gates 45 vùng không gian...
          </div>
        ) : scannedTopSetups[0]?.isEmpty ? (
          <div className="text-center py-4 text-amber-500/80 bg-amber-950/10 border border-amber-900/30 rounded text-xs font-bold uppercase tracking-wider">
            ⚠️ KHÔNG CÓ SETUP NÀO ĐẠT TIÊU CHUẨN LOGIC GATES TRONG CHU KỲ NÀY. ĐỨNG NGOÀI LÀ BẢO VỆ VỐN.
          </div>
        ) : (
          <div
            className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-2"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#065f46 #0a0a0c' }}
          >
            {scannedTopSetups.map((setup, idx) => (
              <div
                key={idx}
                className="bg-black/40 border border-slate-800/80 rounded p-2.5 flex flex-col md:flex-row items-start md:items-center justify-between hover:border-emerald-500/40 hover:bg-black/60 transition-all group gap-3 md:gap-0"
              >
                <div className="flex items-center gap-3 w-full md:w-1/5">
                  <span
                    className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${
                      idx === 0
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-900/50'
                        : idx === 1
                        ? 'bg-blue-950 text-blue-400 border-blue-900/50'
                        : idx === 2
                        ? 'bg-purple-950 text-purple-400 border-purple-900/50'
                        : 'bg-slate-900 text-slate-400 border-slate-700'
                    }`}
                  >
                    #{idx + 1}
                  </span>
                  <div>
                    <div className="text-xs font-black text-white flex items-center gap-1">
                      {setup.symbol}
                      {setup.overrideTag && (
                        <span className="text-[7.5px] font-black bg-purple-900/50 border border-purple-500/50 text-purple-400 px-1 rounded shadow-[0_0_8px_rgba(168,85,247,0.4)] animate-pulse">
                          {setup.overrideTag}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="text-[9px] font-bold text-blue-400">{setup.interval}</div>
                        <span className={`text-[7px] px-1 font-bold rounded border ${getTierStyle(setup.assetTier)}`}>
                            {setup.assetTier?.split(':')[0] || 'TIER X'} 
                        </span>
                    </div>
                    <div className="text-[9px] font-bold text-blue-400">{setup.interval}</div>
                  </div>
                </div>

                <div className="flex flex-col w-full md:w-1/4">
                  <div className="flex items-center gap-1 text-[10px] font-bold">
                    {setup.direction === 'LONG' ? (
                      <TrendingUp className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <TrendingDown className="w-3 h-3 text-red-500" />
                    )}
                    <span className={setup.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>
                      {setup.direction}
                    </span>
                  </div>
                  <div className="text-[9.5px] text-slate-400 font-mono mt-0.5">
                    E: <span className="text-white">${setup.entry}</span>{' '}
                    <span className="mx-1">|</span> S:{' '}
                    <span className="text-red-400">${setup.slTech}</span>
                  </div>
                </div>

                <div className="flex flex-col w-full md:w-1/4 font-mono">
                  <div className="text-[10.5px]">
                    <span className="text-slate-500">NET R:R</span>{' '}
                    <span className="text-emerald-400 font-black">1 : {setup.theoreticalRR}</span>
                  </div>
                  <div className="text-[9.5px] flex gap-3 mt-0.5">
                    <span>
                      RSI: <span className="text-cyan-400">{setup.rsi}</span>
                    </span>
                    <span>
                      CMF:{' '}
                      <span className={parseFloat(setup.cmf) > 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {setup.cmf}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="flex flex-row md:flex-col justify-between md:justify-start w-full md:w-1/6 font-mono text-[9.5px] text-slate-400">
                  <div>
                    Lev: <span className="text-amber-400 font-bold">{setup.suggestedLeverage}x</span>
                  </div>
                  <div>
                    Min Size: <span className="text-purple-400">${getMinNotional(setup.symbol)}</span>
                  </div>
                </div>

                <div className="w-full md:w-auto flex justify-end">
                  <button
                    onClick={() => injectScannedSetup(setup)}
                    className="text-[9px] bg-blue-950/50 hover:bg-blue-600/30 text-blue-400 font-bold px-3 py-1.5 rounded border border-blue-900/50 transition-colors flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 w-full md:w-auto"
                  >
                    <Zap className="w-3 h-3" /> <span>LOAD TO HUD</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

=========================================
/// FILE: src/components/terminal/AiAudit.jsx
=========================================

// FILE: src/components/terminal/AiAudit.jsx
import React from 'react';
import { Bot, Database, Loader2, Cpu, LineChart, Target, ShieldAlert, History } from 'lucide-react';

export default function AiAudit({
  autoData,
  runQuantumCouncilAnalysis,
  isAnalyzing,
  geminiCooldown,
  councilReports,
  chiefDecision // Giờ là một JSON Object
}) {
  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col">
       <h2 className="text-[10px] font-bold text-blue-400 uppercase flex items-center gap-2 mb-3 border-b border-slate-800 pb-2">
         <Bot className="w-3.5 h-3.5" /> HỘI ĐỒNG LƯỢNG TỬ ĐA MÔ HÌNH (JSON MODE)
       </h2>
       
       <button 
         onClick={runQuantumCouncilAnalysis} 
         disabled={isAnalyzing || !autoData || geminiCooldown > 0} 
         className={`w-full py-2 mb-4 border rounded text-[10px] font-bold flex items-center justify-center gap-2 transition-all bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border-blue-500/30 ${isAnalyzing ? 'opacity-50 cursor-not-allowed' : ''}`}
       >
         {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
         {isAnalyzing ? 'SERVERLESS ĐANG XỬ LÝ 8 LUỒNG...' : 'KÍCH HOẠT HỘI ĐỒNG (TỐI ƯU HÓA)'}
       </button>

       {councilReports && councilReports.length > 0 && (
         <div className="flex-grow overflow-y-auto pr-1 space-y-4" style={{ maxHeight: '500px', scrollbarWidth: 'thin', scrollbarColor: '#1e293b #0a0a0c' }}>
            
            {/* RENDER DỮ LIỆU TỪ 4 CẶP CHUYÊN GIA */}
            <div className="grid grid-cols-1 gap-2">
                {councilReports.map((rep, idx) => (
                    <div key={idx} className="bg-black/40 border border-slate-800 p-2 rounded relative">
                        <span className="absolute top-0 right-0 bg-slate-800 text-[6px] px-1.5 py-0.5 rounded-bl rounded-tr text-slate-400">{rep.model}</span>
                        <div className="text-[8.5px] font-bold text-cyan-500 mb-1">{rep.role}</div>
                        {rep.data.error ? (
                            <div className="text-[9px] text-red-500 font-mono">{rep.data.error}</div>
                        ) : (
                            <div className="text-[9px] font-mono text-slate-300">
                                <span className="text-amber-400 font-bold">Điểm Tín nhiệm: </span> {rep.data.score}<br/>
                                <span className="text-purple-400 font-bold">Lập luận: </span> {rep.data.reasoning}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* TỔNG TƯ LỆNH */}
            <div className="mt-4 pt-4 border-t border-emerald-900/50">
                <div className="text-[9px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1.5 mb-2"><ShieldAlert className="w-3.5 h-3.5"/> TỔNG TƯ LỆNH PHÁN QUYẾT</div>
                <div className="bg-emerald-950/20 border border-emerald-900/50 p-3 rounded">
                   {!chiefDecision ? (
                       <span className="text-slate-500 text-[10px] animate-pulse">Đang chờ phán quyết...</span>
                   ) : (
                       <div className="text-[10px] font-mono space-y-2">
                           <div className={`font-black text-lg ${chiefDecision.decision === 'DUYỆT' ? 'text-emerald-500' : 'text-red-500'}`}>
                               PHÁN QUYẾT: {chiefDecision.decision}
                           </div>
                           <div className="text-slate-300"><strong className="text-cyan-400">Tài sản:</strong> {chiefDecision.tier_classification}</div>
                           <div className="text-slate-300"><strong className="text-amber-400">Chiến thuật:</strong> {chiefDecision.suggested_strategy}</div>
                           <div className="text-slate-400 italic">"{chiefDecision.reasoning_summary}"</div>
                           <div className="bg-black/50 p-2 mt-2 border border-slate-700 rounded text-purple-300">
                               <strong>Tham số Tối ưu (Gợi ý):</strong><br/>
                               SL Mult: {chiefDecision.optimized_params?.suggested_slMult}x | 
                               TP Mult: {chiefDecision.optimized_params?.suggested_tpMult}x | 
                               Risk: {chiefDecision.optimized_params?.suggested_risk_pct}%
                           </div>
                       </div>
                   )}
                </div>
            </div>
         </div>
       )}
    </div>
  );
}

=========================================
/// FILE: src/components/terminal/LiveMetrics.jsx
=========================================

import React from 'react';
import { Database } from 'lucide-react';

export default function LiveMetrics({ 
  autoData, 
  apiMacro, 
  cmcData, 
  indicatorSpecs, 
  mvrvZScore, 
  setMvrvZScore, 
  activeTierClass
}) {
  const getTierStyle = (tierStr) => {
      if (!tierStr) return 'bg-slate-900 text-slate-500 border-slate-800';
      if (tierStr.includes('Tier 1')) return 'bg-blue-950/50 text-blue-400 border-blue-500/50 shadow-[0_0_8px_rgba(59,130,246,0.3)]';
      if (tierStr.includes('Tier 2')) return 'bg-emerald-950/50 text-emerald-400 border-emerald-500/50';
      if (tierStr.includes('Tier 3')) return 'bg-amber-950/50 text-amber-400 border-amber-500/50';
      return 'bg-pink-950/50 text-pink-400 border-pink-500/50 animate-pulse'; // Tier 4 Nano
  };
  return (
    <div className="bg-[#111116] border border-blue-900/40 rounded-xl p-4 shadow-xl space-y-4">
      <div className="flex justify-between items-center border-b border-blue-900/30 pb-2">
        <h2 className="text-[10px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
          <Database className="w-3.5 h-3.5" /> LIVE DATA & ORDERBOOK METRICS
        </h2>
        {/* HIỂN THỊ TIER Ở GÓC PHẢI */}
        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border tracking-wider ${getTierStyle(activeTierClass)}`}>
          {activeTierClass}
        </span>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">MARK PRICE</label>
          <div className="font-black text-sm text-white">${autoData?.currentPrice?.toFixed(4) || '0.00'}</div>
        </div>
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-emerald-500 block mb-1 font-bold">EMA (20/50/200)</label>
          <div className="font-bold text-xs text-indigo-300">
            ${autoData?.ema20?.value?.toFixed(4) || '0.0000'} <span className="text-slate-600 mx-0.5">/</span> <span className="text-purple-300">${autoData?.ema50?.value?.toFixed(4) || '0.0000'}</span> <span className="text-slate-600 mx-0.5">/</span> <span className="text-amber-500">${autoData?.ema200?.value?.toFixed(4) || '0.0000'}</span>
          </div>
        </div>
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-cyan-400 font-bold block mb-1">TAKER BUY/SELL</label>
          <div className={`font-black text-sm ${apiMacro.takerBuySellRatio > 1.05 ? 'text-emerald-500' : apiMacro.takerBuySellRatio < 0.95 ? 'text-red-500' : 'text-slate-300'}`}>
            {apiMacro.takerBuySellRatio?.toFixed(2) || '1.00'}
          </div>
        </div>
        <div className="bg-[#0c0c10] p-2 rounded border border-amber-900/50">
          <label className="text-[8px] text-amber-500 block mb-1 font-bold">REAL SPREAD</label>
          <div className="font-black text-xs text-amber-400">{apiMacro.realSpreadPct?.toFixed(4)}%</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">ADX (TREND)</label>
          <div className={`font-black text-sm ${autoData?.adx > 25 ? 'text-amber-400' : 'text-slate-400'}`}>{autoData?.adx?.toFixed(1) || '0'}</div>
        </div>
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">RSI ({indicatorSpecs.rsiPeriod})</label>
          <div className={`font-black text-sm ${autoData?.rsi > 70 ? 'text-red-500' : autoData?.rsi < 30 ? 'text-emerald-500' : 'text-cyan-400'}`}>{autoData?.rsi?.toFixed(1) || '0'}</div>
        </div>
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">ATR RANK (100 Kỳ)</label>
          <div className="font-bold text-xs text-slate-300">P{autoData?.atrRank?.toFixed(0) || '0'} <span className="text-[8px] text-slate-600">(${autoData?.atr14?.toFixed(2)})</span></div>
        </div>
        <div className="bg-black/40 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">BBW RANK (100 Kỳ)</label>
          <div className={`font-bold text-xs ${autoData?.bbwRank < 20 ? 'text-pink-500 animate-pulse' : 'text-slate-300'}`}>P{autoData?.bbwRank?.toFixed(0) || '0'} <span className="text-[8px] font-normal">({autoData?.bbw?.toFixed(2)}%)</span></div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <div className="bg-slate-900/50 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">CHAIKIN CMF</label>
          <div className={`font-bold text-xs ${autoData?.cmf > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{autoData?.cmf?.toFixed(2) || '0.00'}</div>
        </div>
        <div className="bg-slate-900/50 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">L/S VOL RATIO</label>
          <div className="font-bold text-xs text-slate-300">
            <span className={apiMacro.lsPositionVolRatio > 1.5 ? 'text-amber-500' : ''}>{apiMacro.lsPositionVolRatio?.toFixed(2)}</span>
          </div>
        </div>
        <div className="bg-slate-900/50 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">FUNDING SLOPE</label>
          <div className={`font-bold text-[10px] ${Math.abs(autoData?.fundingSlope) > 0.05 ? 'text-amber-400' : 'text-slate-300'}`}>{autoData?.fundingSlope?.toFixed(4) || '0'}</div>
        </div>
        <div className="bg-slate-900/50 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-amber-400 font-bold block mb-1">OI DELTA (%)</label>
          <div className={`font-bold text-[10px] ${autoData?.oiDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {autoData?.oiDelta > 0 ? '+' : ''}{autoData?.oiDelta?.toFixed(2)}%
          </div>
        </div>
        <div className="bg-slate-900/50 p-2 rounded border border-slate-800">
          <label className="text-[8px] text-slate-500 block mb-1">BTC DOM (SLOPE)</label>
          <div className="flex items-center justify-between">
             <span className="font-bold text-[10px] text-slate-300">{autoData?.btcDomValue?.toFixed(1)}%</span>
             <span className={`font-bold text-[9px] ${autoData?.btcDomSlope > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {autoData?.btcDomSlope > 0 ? '+' : ''}{autoData?.btcDomSlope?.toFixed(2)}%
             </span>
          </div>
        </div>
        <div className="bg-[#0c0c10] p-2 rounded border border-blue-900/30 flex flex-col justify-center">
           <label className="text-[8px] font-bold text-blue-400 block mb-1">MVRV Z-SCORE</label>
           <input type="number" step="0.1" value={mvrvZScore} onChange={(e) => setMvrvZScore(Number(e.target.value))} className="w-full bg-transparent text-white font-bold outline-none text-xs border-b border-slate-700/50 focus:border-blue-500 pb-0.5"/>
        </div>
      </div>
    </div>
  );
}

=========================================
/// FILE: src/components/terminal/LogicGates.jsx
=========================================

import React from 'react';
import { ShieldAlert, CheckCircle2, XCircle, AlertTriangle, ClipboardList, Zap, Target, TrendingUp, Save } from 'lucide-react';

export default function LogicGates({
  logicGates,
  tradeSetup,
  mathCore,
  handleSaveTradeLog
}) {
  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 flex-grow flex flex-col shadow-xl">
       <h2 className="text-[10px] font-bold text-slate-300 uppercase mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
         <ShieldAlert className="w-4 h-4 text-emerald-500" /> BỘ LỌC CỔNG KIỂM DUYỆT (LOGIC GATES)
       </h2>

       {/* 1. CỬA TỬ - HARD GATES */}
       <div className="mb-2">
          <span className="text-[8px] font-black text-red-500 uppercase tracking-widest block mb-2 border-b border-slate-800 pb-1">Cửa Tử - Hard Gates (Bắt buộc 100%)</span>
          <div className="space-y-2">
            {logicGates.hardGates.map((item) => (
              <div key={item.id} className="flex items-start gap-2.5 bg-red-950/10 p-2 rounded border border-red-900/20">
                {item.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />}
                <span className={`text-[9.5px] leading-relaxed font-bold ${item.passed ? 'text-slate-300' : 'text-red-400'}`}>{item.text}</span>
              </div>
            ))}
          </div>
       </div>

       {/* 2. CỬA MỀM - SOFT GATES & MULTIPLIERS */}
       <div className="flex-grow mt-3">
          {/* HEADER HIỂN THỊ ĐIỂM CHUẨN ĐỘNG */}
          <div className="flex justify-between items-end mb-2 border-b border-slate-800 pb-2">
             <span className="text-[8px] font-black text-blue-500 uppercase tracking-widest">
                Cửa Mềm - Adaptive Soft Gates
             </span>
             <span className="text-[9px] bg-slate-900 px-2 py-0.5 rounded border border-slate-700 text-slate-400 flex items-center gap-1.5 shadow-inner">
                <span>Pass: <span className="text-white font-bold">{logicGates.passingScore?.toFixed(1)}</span></span>
                <span className="text-slate-600">|</span>
                <span>Net Score: </span>
                <span className={`font-black text-[10px] ${logicGates.softScore >= logicGates.passingScore ? "text-emerald-400" : "text-amber-500"}`}>
                   {logicGates.softScore.toFixed(1)}
                </span>
             </span>
          </div>

          <div className="space-y-2">
            {logicGates.softGates.map((item) => {
              // Bỏ qua các cổng không dùng, ngoại trừ 2 cổng hệ số nhân
              if (item.weight === 0 && !item.id.includes('s_syn') && !item.id.includes('s_pen')) return null; 
              
              // ==========================================
              // RENDER ĐẶC BIỆT: HỆ SỐ KHUẾCH ĐẠI (SYNERGY)
              // ==========================================
              if (item.id === 's_syn') {
                  return (
                      <div key={item.id} className="flex items-start gap-2.5 bg-gradient-to-r from-emerald-900/40 to-transparent p-2 rounded border-l-2 border-emerald-500 mt-3 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                          <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5 animate-pulse" />
                          <span className="text-[9.5px] leading-relaxed font-black text-emerald-300">
                             HỆ SỐ KHUẾCH ĐẠI:<br/><span className="text-emerald-400/80 font-mono text-[8.5px]">{item.text.replace('🔥 SYNERGY BONUS:', '')}</span>
                          </span>
                      </div>
                  );
              }

              // ==========================================
              // RENDER ĐẶC BIỆT: HỆ SỐ TRỪNG PHẠT (PENALTY)
              // ==========================================
              if (item.id === 's_pen') {
                  return (
                      <div key={item.id} className="flex items-start gap-2.5 bg-gradient-to-r from-red-900/40 to-transparent p-2 rounded border-l-2 border-red-500 mt-3 shadow-[0_0_10px_rgba(239,68,68,0.1)]">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5 animate-pulse" />
                          <span className="text-[9.5px] leading-relaxed font-black text-red-300">
                             HỆ SỐ TRỪNG PHẠT:<br/><span className="text-red-400/80 font-mono text-[8.5px]">{item.text.replace('⚠️ MACRO PENALTY:', '')}</span>
                          </span>
                      </div>
                  );
              }

              // ==========================================
              // RENDER CÁC CỔNG SOFT GATES CƠ SỞ (BASE SCORE)
              // ==========================================
              return (
                <div key={item.id} className="flex items-center justify-between bg-blue-950/10 p-2 rounded border border-blue-900/20 transition-all hover:bg-blue-900/20">
                  <div className="flex items-start gap-2.5">
                    {item.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-slate-700 shrink-0 mt-0.5" />}
                    <span className={`text-[9.5px] leading-relaxed font-medium ${item.passed ? 'text-slate-300' : 'text-slate-600 line-through'}`}>{item.text}</span>
                  </div>
                  
                  {/* BẢN VÁ UI: Hiển thị ĐIỀU KIỆN (0đ) và ĐIỂM SỐ chi tiết */}
                  {item.score !== undefined && item.score !== 0 && (
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm ${item.score > 0 ? 'text-emerald-400 bg-emerald-950/50 border border-emerald-900/50' : 'text-red-400 bg-red-950/50 border border-red-900/50'}`}>
                      {item.score > 0 ? '+' : ''}{item.score.toFixed(1)}đ
                    </span>
                  )}
                  
                  {item.score === 0 && (
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded text-slate-400 bg-slate-800/50 border border-slate-700">
                      ĐIỀU KIỆN
                    </span>
                  )}
                </div>
              )
            })}
          </div>
       </div>

       {/* 3. KHU VỰC HÀNH ĐỘNG & THÔNG SỐ ĐÁNH TAY */}
       <div className="mt-5 pt-5 border-t border-slate-800 flex flex-col gap-3">
          {!logicGates.isApproved ? (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-[9px] p-2 rounded flex items-center gap-1.5 font-bold shadow-inner">
              <AlertTriangle className="w-3 h-3 shrink-0" /> LỆNH BỊ HỆ THỐNG KHÓA VÌ RỚT LOGIC GATES.
            </div>
          ) : (
            <div className="bg-emerald-950/20 border border-emerald-500/30 p-3 rounded text-[10px] shadow-inner">
              <div className="font-black text-emerald-400 mb-2 flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5"/> THÔNG SỐ ĐÁNH TAY TRÊN BINANCE:</div>
              <ul className="text-slate-300 space-y-1 font-mono pl-1">
                 <li>[1] Hướng lệnh: <strong className={tradeSetup.direction==='LONG'?'text-emerald-400':'text-red-400'}>{tradeSetup.direction}</strong> ({tradeSetup.execution})</li>
                 <li className="text-amber-400">[2] Khối lượng (Size USD): <strong>${mathCore.positionSizeUSD}</strong></li>
                 <li>[3] Giá Entry: <strong>{tradeSetup.entry}</strong></li>
                 <li>[4] Stoploss Cứng: <strong>{tradeSetup.slTech}</strong></li>
                 <li className="text-red-400 uppercase mt-2 pt-1 border-t border-emerald-900/50">[5] Margin Mode: <strong>ISOLATED (BẮT BUỘC)</strong> | Leverage: <strong>{mathCore.suggestedLeverage}x</strong></li>
              </ul>
            </div>
          )}

          <button disabled={!logicGates.isApproved} onClick={handleSaveTradeLog} className={`w-full py-3 rounded-lg font-black text-[10px] tracking-widest flex items-center justify-center gap-2 transition-all duration-300 shadow-xl
              ${logicGates.isApproved ? 'bg-slate-800 text-white hover:bg-slate-700 border border-slate-600' : 'bg-slate-800/20 text-slate-700 border border-slate-800 cursor-not-allowed'}`}>
            <Save className="w-4 h-4"/> LƯU VÀO SỔ TAY SUPABASE
          </button>
       </div>
    </div>
  );
}

=========================================
/// FILE: src/components/terminal/OrderForm.jsx
=========================================

// FILE: src/components/terminal/OrderForm.jsx
import React, { useState } from 'react';
import { Zap, TrendingUp, TrendingDown, BarChart3, Lock, Rocket, Loader2, Target, FileSignature } from 'lucide-react'; 

export default function OrderForm({
  autoData, tradeSetup, setTradeSetup, liveCapital, availableBalance, mathCore, tradeStats, 
  symbol, handleMasterAuto, stepSizes, tickSizes,
  handleSaveTradeLog, syncBinanceToSupabase 
}) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [execStatus, setExecStatus] = useState('');

  const handleSignTradFi = async () => {
    setIsExecuting(true);
    setExecStatus('⏳ Đang liên kết API để ký hợp đồng TradFi với Binance...');
    try {
      const res = await fetch('/api/binance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'SIGN_TRADFI' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details?.msg || data.error || 'Lỗi khi ký.');
      setExecStatus('✅ ĐÃ KÝ HỢP ĐỒNG TRADFI THÀNH CÔNG! BẠN ĐÃ CÓ THỂ PHÓNG LỆNH.');
    } catch (err) {
      setExecStatus('❌ LỖI KÝ TRADFI: ' + err.message);
    }
    setIsExecuting(false);
  };

  const handleExecuteBatch = async () => {
    if (mathCore.hasMinNotionalError || tradeSetup.entry <= 0 || tradeSetup.slTech <= 0) {
        setExecStatus('❌ LỖI SETUP: Check lại Min Notional hoặc Entry/SL');
        return;
    }

    setIsExecuting(true);
    setExecStatus('Đang tiền trạm & Phóng lệnh...');

    // ĐO LƯỜNG ĐỘ TRỄ THỰC THI (LATENCY) BẮT ĐẦU TẠI ĐÂY
    const requestStartTime = performance.now(); 

    try {
        const step = stepSizes[symbol] || 0.001;
        const tick = tickSizes[symbol] || 0.001;

        const formatPrecision = (val, step) => {
            const numVal = parseFloat(val);
            const numStep = parseFloat(step);
            if (isNaN(numVal) || isNaN(numStep) || numStep === 0) return "0";
            
            let stepStr = numStep.toString();
            if (stepStr.includes('e-')) {
                stepStr = numStep.toFixed(parseInt(stepStr.split('e-')[1], 10));
            }
            const precision = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
            
            // Khắc phục sai số Dấu phẩy động (Floating point error) của JS
            const multiplier = Math.pow(10, precision);
            const quantized = Math.round(numVal / numStep) * numStep;
            
            // Ép tròn chuỗi khít với TickSize
            return quantized.toFixed(precision);
        };

        const rawQty = parseFloat(mathCore.positionSizeUSD) / tradeSetup.entry;
        const finalQty = formatPrecision(rawQty, step);
        const finalEntry = formatPrecision(tradeSetup.entry, tick);
        const finalSl = formatPrecision(tradeSetup.slTech, tick);
        const finalTp = formatPrecision(tradeSetup.tp1, tick);

        const batch = [];
        const side = tradeSetup.direction === 'LONG' ? 'BUY' : 'SELL';
        const exitSide = tradeSetup.direction === 'LONG' ? 'SELL' : 'BUY';

        // 1. LỆNH ENTRY (Chung cho cả Spot và Futures)
        batch.push({
            symbol: symbol,
            side: side,
            type: tradeSetup.execution,
            quantity: finalQty,
            ...(tradeSetup.execution === 'LIMIT' ? { price: finalEntry, timeInForce: 'GTC' } : {})
        });

        // 2. BẺ NHÁNH ĐIỀU KIỆN SL/TP (PHÂN BIỆT RÕ RÀNG SPOT VÀ FUTURES)
        if (tradeSetup.tradeType === 'FUTURES') {
            // [CHUẨN FUTURES]: Đòi hỏi triggerPrice và reduceOnly
            if (parseFloat(finalSl) > 0) {
                batch.push({ symbol, side: exitSide, type: 'STOP_MARKET', triggerPrice: finalSl, quantity: finalQty, reduceOnly: "true", workingType: "MARK_PRICE", priceProtect: "true" });
            }
            if (parseFloat(finalTp) > 0) {
                batch.push({ symbol, side: exitSide, type: 'TAKE_PROFIT_MARKET', triggerPrice: finalTp, quantity: finalQty, reduceOnly: "true", workingType: "MARK_PRICE", priceProtect: "true" });
            }
        } else {
            // [CHUẨN SPOT ALGO API]: Đòi hỏi stopPrice
            if (parseFloat(finalSl) > 0) {
                batch.push({ symbol, side: exitSide, type: 'STOP_LOSS', stopPrice: finalSl, quantity: finalQty });
            }
            if (parseFloat(finalTp) > 0) {
                batch.push({ symbol, side: exitSide, type: 'TAKE_PROFIT', stopPrice: finalTp, quantity: finalQty });
            }
        }

        const payload = {
            symbol: symbol,
            tradeType: tradeSetup.tradeType, // Bơm biến này để Backend biết đường phân luồng
            leverage: mathCore.suggestedLeverage,
            marginType: 'ISOLATED',
            batchOrders: batch
        };

        const LOCAL_BRIDGE_URL = '/api/execute-batch';
        const res = await fetch(LOCAL_BRIDGE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.details?.msg || data.error || 'Bridge Cục bộ từ chối.');

        // BỘ ĐỌC LỖI NÂNG CẤP: Bóc tách chính xác lý do sàn Binance từ chối
        if (Array.isArray(data)) {
            const errors = data.filter(r => r.error === true || r.code !== undefined);
            if (errors.length > 0) {
                const errorMsgs = errors.map(e => e.msg || e.code).join(" | ");
                console.error("LỖI CHI TIẾT TỪ BINANCE:", errors);
                throw new Error(`Entry đã khớp nhưng sàn TỪ CHỐI SL/TP. Lý do: [${errorMsgs}]. Hãy check app Binance!`);
            }
        }

        // CHỐT THỜI GIAN ĐỘ TRỄ VÀ TÍNH TOÁN SLIPPAGE
        const executionLatencyMs = Math.round(performance.now() - requestStartTime);
        let slippageUsd = 0;
        let executedEntry = tradeSetup.entry; // Thêm biến này
        
        // Bắt chính xác Giá Khớp Thực Tế (avgPrice) do Binance trả về cho lệnh MARKET
        if (tradeSetup.execution === 'MARKET' && Array.isArray(data) && data[0] && data[0].avgPrice) {
            executedEntry = parseFloat(data[0].avgPrice);
            slippageUsd = Math.abs(executedEntry - tradeSetup.entry) * parseFloat(finalQty);
        }

        setExecStatus('✅ LỆNH ĐÃ VÀO SÀN! Đang tự động lưu sổ cái...');
        
        if (typeof handleSaveTradeLog === 'function') {
            await handleSaveTradeLog({
               latency: executionLatencyMs,
               slippage: slippageUsd,
               exactEntry: executedEntry // TRUYỀN GIÁ THẬT LÊN APP.JSX
            });
        }

        setTimeout(() => {
            if (typeof syncBinanceToSupabase === 'function') {
                syncBinanceToSupabase(true);
            }
        }, 3500);

        setTimeout(() => setExecStatus(''), 6000);

    } catch (err) {
        // ĐÂY LÀ ĐOẠN ĐÃ BỊ THIẾU TRƯỚC ĐÓ LÀM VITE BÁO LỖI
        setExecStatus('❌ LỖI: ' + err.message);
    }
    
    setIsExecuting(false);
  };

  // --- GIỮ NGUYÊN HOÀN TOÀN GIAO DIỆN HTML/JSX CŨ BÊN DƯỚI ---
  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl">
      <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
        <button onClick={handleMasterAuto} disabled={!autoData} className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-2">
          <Zap className="w-3 h-3" /> AUTO SYNC TEMPLATE
        </button>

        <button 
          onClick={handleExecuteBatch} 
          disabled={isExecuting || !autoData || mathCore.hasInsufficientMargin}
          className={`px-4 py-1.5 rounded text-[10px] font-black flex items-center gap-2 transition-all shadow-lg
            ${isExecuting ? 'bg-slate-800 text-slate-500' : mathCore.hasInsufficientMargin ? 'bg-pink-900/50 text-pink-400 border border-pink-900 cursor-not-allowed' : 'bg-emerald-600 text-black hover:bg-emerald-500 border border-emerald-400'}`}
        >
          {isExecuting ? <Loader2 className="w-3 h-3 animate-spin"/> : <Rocket className="w-3 h-3" />} 
          PHÓNG LỆNH & LƯU SỔ TAY
        </button>
      </div>

      {execStatus && (
          <div className={`mb-3 text-[10px] font-bold p-2 rounded border flex flex-col gap-2 ${execStatus.includes('✅') ? 'bg-emerald-950/30 text-emerald-400 border-emerald-900' : 'bg-red-950/30 text-red-400 border-red-900'} animate-pulse`}>
              <span>{execStatus}</span>
              
              {execStatus.includes('TradFi-Perps') && (
                  <button 
                    onClick={handleSignTradFi} 
                    disabled={isExecuting}
                    className="bg-amber-600/20 text-amber-400 border border-amber-500/50 px-3 py-1.5 rounded w-max hover:bg-amber-600/40 flex items-center gap-1.5 transition-all shadow-[0_0_10px_rgba(217,119,6,0.3)]"
                  >
                     {isExecuting ? <Loader2 className="w-3 h-3 animate-spin"/> : <FileSignature className="w-3 h-3" />}
                     KÝ HỢP ĐỒNG TRADFI (1-CLICK BYPASS)
                  </button>
              )}
          </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div className="flex gap-2">
            <button onClick={() => setTradeSetup({...tradeSetup, tradeType: 'FUTURES'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded shadow-sm ${tradeSetup.tradeType === 'FUTURES' ? 'bg-indigo-500 text-white' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}>FUTURES</button>
            <button onClick={() => setTradeSetup({...tradeSetup, tradeType: 'SPOT'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded shadow-sm ${tradeSetup.tradeType === 'SPOT' ? 'bg-amber-500 text-black' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}>SPOT</button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setTradeSetup({...tradeSetup, direction: 'LONG'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded flex justify-center gap-1 shadow-sm ${tradeSetup.direction === 'LONG' ? 'bg-emerald-500 text-black' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}><TrendingUp className="w-3 h-3"/> LONG</button>
            <button onClick={() => setTradeSetup({...tradeSetup, direction: 'SHORT'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded flex justify-center gap-1 shadow-sm ${tradeSetup.direction === 'SHORT' ? 'bg-red-500 text-white' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}><TrendingDown className="w-3 h-3"/> SHORT</button>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
             <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 col-span-2 flex flex-col gap-2">
                <div className="flex justify-between">
                  <div className="w-1/2 pr-2 border-r border-slate-800">
                    <label className="text-[8px] font-bold text-slate-400 block mb-1">EQUITY <span className="text-slate-600 mx-1">|</span> <span className="text-cyan-400">FREE MARGIN</span></label>
                    <div className="flex items-baseline gap-1.5">
                       <span className="text-emerald-400 font-bold text-sm">${liveCapital.toFixed(2)}</span>
                       <span className="text-cyan-500 font-bold text-[10px]">${availableBalance.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="w-1/2 pl-2">
                    <label className="text-[8px] font-bold text-slate-400 block mb-1">BASE RISK: {tradeSetup.riskPercent}%</label>
                    <input type="number" step="0.1" max="5" value={tradeSetup.riskPercent} onChange={e=>setTradeSetup({...tradeSetup, riskPercent: Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-sm"/>
                  </div>
                </div>
             </div>
             <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
              <label className="text-[8px] font-bold text-slate-400 block mb-1">ENTRY PRICE</label>
              <input type="number" value={tradeSetup.entry} onChange={e=>setTradeSetup({...tradeSetup, entry:Number(e.target.value)})} className="w-full bg-transparent text-white font-bold outline-none text-sm"/>
             </div>
             <div className="bg-red-950/20 p-2 rounded border border-red-900/50">
              <label className="text-[8px] font-bold text-red-500 block mb-1">TECH STOPLOSS</label>
              <input type="number" value={tradeSetup.slTech} onChange={e=>setTradeSetup({...tradeSetup, slTech:Number(e.target.value)})} className="w-full bg-transparent text-red-400 font-bold outline-none text-sm"/>
             </div>
             <div className="bg-emerald-950/20 p-2 rounded border border-emerald-900/50 col-span-2">
              <label className="text-[8px] font-bold text-emerald-500 block mb-1">TAKE PROFIT (WORST-CASE EV)</label>
              <input type="number" value={tradeSetup.tp1} onChange={e=>setTradeSetup({...tradeSetup, tp1:Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-sm"/>
             </div>
          </div>
        </div>

        <div className={`bg-gradient-to-br p-4 rounded-lg border flex flex-col justify-between shadow-inner relative transition-colors ${mathCore.hasMinNotionalError ? 'from-red-950/40 to-[#0a0a0c] border-red-900/50' : mathCore.isSizeForcedByExchange ? 'from-amber-950/30 to-[#0a0a0c] border-amber-900/50' : 'from-slate-900 to-[#0a0a0c] border-slate-800'}`}>
          <div className="absolute top-2 right-2 text-[8px] text-slate-600 font-bold border border-slate-800 px-1.5 py-0.5 rounded uppercase">Định Cỡ Vị Thế</div>
          
          <div className="mt-2 mb-1 flex items-center justify-between border-b border-slate-800 pb-2">
             <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                 <Target className="w-3.5 h-3.5 text-blue-500" /> CHIẾN THUẬT AUTO:
             </span>
             <span className={`text-[10px] font-black px-2 py-0.5 rounded border animate-pulse shadow-lg
                 ${tradeSetup.activeStrategy?.includes('KINETIC') ? 'bg-pink-900/30 text-pink-400 border-pink-500/50' 
                 : tradeSetup.activeStrategy?.includes('GAMMA') ? 'bg-red-900/30 text-red-400 border-red-500/50'
                 : tradeSetup.activeStrategy?.includes('QUANT-SFP') ? 'bg-amber-900/30 text-amber-400 border-amber-500/50'
                 : tradeSetup.activeStrategy?.includes('LEAD-LAG') ? 'bg-cyan-900/30 text-cyan-400 border-cyan-500/50'
                 : 'bg-slate-900 text-slate-400 border-slate-700'}`}>
                 {tradeSetup.activeStrategy || "TIÊU CHUẨN"}
             </span>
          </div>

          <div className="space-y-3 mt-2">
            <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
              <span className="text-[10px] font-bold text-slate-500">Khối lượng (Size USD):</span>
              <span className={`font-mono text-xs font-black ${mathCore.hasMinNotionalError ? 'text-red-500 animate-pulse' : mathCore.isSizeForcedByExchange ? 'text-amber-400' : 'text-white'}`}>
                ${mathCore?.positionSizeUSD || '0.00'}
              </span>
            </div>
            
            {mathCore.hasMinNotionalError && (
              <div className="text-[8px] text-red-500 font-bold text-right -mt-2">⚠️ LỖI: SIZE BỊ ÉP VƯỢT RỦI RO SINH TỒN ({'>'} 5% VỐN)</div>
            )}
            
            {!mathCore.hasMinNotionalError && mathCore.isSizeForcedByExchange && (
              <div className="text-[8px] text-amber-500 font-bold text-right -mt-2">⚠️ CẢNH BÁO: SIZE ĐÃ BỊ ÉP LÊN MỨC TỐI THIỂU CỦA SÀN KỲ HẠN</div>
            )}
            
            {mathCore.hasInsufficientMargin && (
              <div className="text-[8px] text-pink-500 font-bold text-right -mt-2 animate-pulse">⚠️ LỖI: SỐ DƯ KHẢ DỤNG KHÔNG ĐỦ KÝ QUỸ (CẦN ${mathCore.marginUsedUSD})</div>
            )}

            <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
              <span className="text-[10px] font-bold text-slate-500">Mất ròng tối đa (Risk):</span>
              <span className={`font-black text-sm ${mathCore.isSizeForcedByExchange ? 'text-amber-500' : 'text-red-400'}`}>
                ${mathCore?.riskAmountUSD || '0.00'}
                <span className="text-[8.5px] ml-1.5 text-purple-400 font-normal border border-purple-500/30 bg-purple-900/20 px-1 rounded">
                  APPLIED: {mathCore.appliedRiskPercent}%
                </span>
              </span>
            </div>
            <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
              <span className="text-[10px] font-bold text-slate-500 flex flex-col">
                <span>R:R Ròng (Trừ Ma sát)</span>
                <span className="text-[7.5px] text-purple-400">TRUE EV: {mathCore?.trueEVValue}R</span>
              </span>
              <span className={`font-black text-sm ${parseFloat(mathCore?.theoreticalRR || 0) >= 1.2 ? 'text-emerald-400' : 'text-amber-500'}`}>1 : {mathCore?.theoreticalRR || '0.00'}</span>
            </div>
            
            <div className="flex justify-between items-center bg-slate-950 p-2 rounded border border-slate-800 mt-2">
              <div className="flex flex-col gap-1">
                <span className="text-[8px] text-slate-500 uppercase font-bold flex items-center gap-1"><BarChart3 className="w-3 h-3 text-cyan-500"/> EV Kelly (Bayesian):</span>
                {tradeStats.hasEnoughData ? (
                  <span className={`text-[11px] font-black ${mathCore?.kellyPct > 0 ? 'text-cyan-400' : 'text-red-400'}`}>{mathCore?.kellyPct > 0 ? `+${mathCore?.kellyPct}% VỐN` : 'ÂM ĐỘNG LỰC'}</span>
                ) : (
                  <span className="text-[9px] text-amber-500 flex items-center gap-1"><Lock className="w-2.5 h-2.5"/> SURVIVAL ({mathCore.kellyPct}%)</span>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                 <span className="text-[8px] text-slate-500 uppercase font-bold text-amber-500">Gợi ý Đòn bẩy (An toàn):</span>
                 <span className={`px-2 py-0.5 rounded text-[10px] font-black bg-amber-500/10 text-amber-400 border border-amber-500/20`}>
                   {tradeSetup.tradeType === 'SPOT' ? '1x' : `Min ${mathCore?.suggestedLeverage || '1'}x`}
                 </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

=========================================
/// FILE: src/components/terminal/TradeJournal.jsx
=========================================

// File: src/components/terminal/TradeJournal.jsx
import React, { useMemo } from 'react';
import { History, RefreshCw, CheckCircle2, XCircle, TrendingUp, TrendingDown, Clock, Link, AlertTriangle, Trash2, Calculator, CalendarDays, Trophy } from 'lucide-react';
import { supabase } from '../../services/supabase';

export default function TradeJournal({ tradeLogs, currentPrice, syncBinanceToSupabase, isSyncing, binancePositions }) {
  
  const activeLogSymbols = tradeLogs.filter(l => l.status === 'OPEN' || l.status === 'PENDING').map(l => l.symbol);
  const ghostPositions = binancePositions.filter(p => !activeLogSymbols.includes(p.symbol) && parseFloat(p.positionAmt) !== 0);

// ========Tính Lợi nhuận chuẩn theo R (Dùng Risk Gốc để chống lỗi chia 0 khi đã dời SL)
  // ========Tính Lợi nhuận chuẩn theo Technical R (Tái tạo R gốc bằng Nghịch đảo R:R)
  const getProfitProgress = (log) => {
    const isLive = log.status === 'OPEN';
    if (!isLive) return null;

    const actualPos = binancePositions.find(p => p.symbol === log.symbol);
    if (!actualPos || parseFloat(actualPos.positionAmt) === 0) return null;

    const entry = parseFloat(log.entry);
    const sl = parseFloat(log.sl);
    const tp = parseFloat(log.tp_1_price);
    const markPrice = parseFloat(actualPos.markPrice || entry);
    const sizeCoin = parseFloat(log.position_size_usd) / entry;

    // 💡 BẢN VÁ: Khôi phục Rủi ro Kỹ thuật (Technical Risk)
    let originalRiskPerCoin;
    if (!log.trailing_activated) {
        // Trailing chưa kích hoạt -> SL hiện tại chính là SL gốc
        originalRiskPerCoin = Math.abs(entry - sl);
    } else {
        // Trailing ĐÃ kích hoạt (SL bị dời) -> Tái tạo SL gốc bằng R:R nghịch đảo
        const rewardPerCoin = Math.abs(tp - entry);
        const theoreticalRR = parseFloat(log.rr) || 1;
        originalRiskPerCoin = rewardPerCoin / theoreticalRR;
    }

    const totalRiskUsd = originalRiskPerCoin * sizeCoin;
    if (totalRiskUsd <= 0) return null;

    const currentPnl = log.direction === 'LONG'
      ? (markPrice - entry) * sizeCoin
      : (entry - markPrice) * sizeCoin;

    const currentR = currentPnl / totalRiskUsd;
    const totalRewardUsd = Math.abs(tp - entry) * sizeCoin;
    const targetR = totalRewardUsd / totalRiskUsd;

    return { currentR, currentPnl, targetR, isProfitable: currentPnl > 0 };
  };

  // Danh sách các lệnh đang lời nhưng CHƯA đạt ngưỡng khóa lời
  const atRiskOfEarlyExit = useMemo(() => {
    return tradeLogs
      .filter(log => log.status === 'OPEN')
      .map(log => ({ log, progress: getProfitProgress(log) }))
      // SỬA LỖI: Thay progress.pct thành tỷ lệ giữa currentR và targetR
      .filter(({ progress }) => progress && progress.isProfitable && progress.currentR < progress.targetR); 
  }, [tradeLogs, binancePositions]);
  //=============================================================

  const { sortedLogs, totalRealized, totalFloating, netTotalPnL } = useMemo(() => {
    let realized = 0;
    let floating = 0;

    tradeLogs.forEach(log => {
      if (log.status === 'WIN' || log.status === 'LOSS') {
        realized += parseFloat(log.pnl_usd || 0);
      }
      if (log.status === 'OPEN' || log.status === 'PENDING') {
        const actualPos = binancePositions.find(p => p.symbol === log.symbol);
        if (actualPos && parseFloat(actualPos.positionAmt) !== 0) {
           const markPrice = parseFloat(actualPos.markPrice || log.entry);
           const sizeCoin = parseFloat(log.position_size_usd) / parseFloat(log.entry);
           const isolatedPnl = log.direction === 'LONG' 
              ? (markPrice - parseFloat(log.entry)) * sizeCoin
              : (parseFloat(log.entry) - markPrice) * sizeCoin;
           floating += isolatedPnl;
        }
      }
    });

    const priority = { 'OPEN': 1, 'PENDING': 2, 'WIN': 3, 'LOSS': 4 };
    
    const sorted = [...tradeLogs].sort((a, b) => {
      const pA = priority[a.status] || 99;
      const pB = priority[b.status] || 99;
      if (pA !== pB) return pA - pB;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    return { 
      sortedLogs: sorted, 
      totalRealized: realized, 
      totalFloating: floating, 
      netTotalPnL: realized + floating 
    };
  }, [tradeLogs, binancePositions]);

  // 📊 PHÂN TÍCH 1: PNL THEO NGÀY (7 NGÀY GẦN NHẤT)
  const dailyPnL = useMemo(() => {
    const daily = {};
    tradeLogs.forEach(t => {
        if (t.status === 'WIN' || t.status === 'LOSS') {
            const dateObj = t.close_time ? new Date(t.close_time) : new Date(t.created_at);
            const yyyy = dateObj.getFullYear();
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const dd = String(dateObj.getDate()).padStart(2, '0');
            
            const sortKey = `${yyyy}-${mm}-${dd}`;
            const displayDate = `${dd}/${mm}`;
            
            if (!daily[sortKey]) daily[sortKey] = { displayDate, pnl: 0 };
            daily[sortKey].pnl += parseFloat(t.pnl_usd || 0);
        }
    });
    
    return Object.entries(daily)
        .sort(([keyA], [keyB]) => keyB.localeCompare(keyA)) 
        .slice(0, 7) 
        .map(([key, data]) => data);
  }, [tradeLogs]);

  const topStrategies = useMemo(() => {
    const stats = {};
    tradeLogs.forEach(t => {
        // Chỉ chấp nhận lệnh WIN/LOSS VÀ BẮT BUỘC phải có dữ liệu asset_tier
        if ((t.status === 'WIN' || t.status === 'LOSS') && t.asset_tier) {
            const strat = t.strategy_name || 'UNKNOWN';
            const tier = t.asset_tier.split(':')[0].trim(); 
            
            const key = `${strat}|${tier}`; 
            
            // Khởi tạo các biến để đo lường Thực tế
            if (!stats[key]) stats[key] = { 
                strat, tier, wins: 0, losses: 0, total: 0, pnl: 0, 
                win_r_sum: 0, loss_r_sum: 0 
            };
            
            stats[key].total += 1;
            stats[key].pnl += parseFloat(t.pnl_usd || 0);

            // TÍNH TOÁN R-MULTIPLE THỰC TẾ (REALIZED R)
            const riskUsd = parseFloat(t.risk_amount_usd) || 1; // Chống lỗi chia 0
            const pnlUsd = parseFloat(t.pnl_usd) || 0;
            const rMultiple = pnlUsd / riskUsd;
            
            if (t.status === 'WIN') {
                stats[key].wins += 1;
                stats[key].win_r_sum += rMultiple;
            } else if (t.status === 'LOSS') {
                stats[key].losses += 1;
                // Tổn thất lấy trị tuyệt đối để tính R:R mẫu số
                stats[key].loss_r_sum += Math.abs(rMultiple);
            }
        }
    });

    return Object.values(stats)
        .map(data => {
            // Trung bình R thực tế khi Thắng
            const avgWinR = data.wins > 0 ? (data.win_r_sum / data.wins) : 0;
            // Trung bình R thực tế khi Thua (Mặc định là 1 nếu chưa thua)
            const avgLossR = data.losses > 0 ? (data.loss_r_sum / data.losses) : 1; 
            
            // TỶ LỆ R:R THỰC TẾ (REALIZED R:R)
            const realizedRR = avgLossR > 0 ? (avgWinR / avgLossR) : avgWinR;

            return {
                strat: data.strat,
                tier: data.tier,
                winRate: (data.wins / data.total) * 100,
                avgRR: realizedRR, 
                total: data.total,
                pnl: data.pnl
            }
        })
        .filter(x => x.total >= 3) // Tối thiểu 3 lệnh
        .sort((a, b) => b.winRate - a.winRate || b.avgRR - a.avgRR) 
        .slice(0, 5);
  }, [tradeLogs]);


  const handleDeleteLog = async (log) => {
    if (log.status === 'OPEN') {
        alert(`⛔ KHÔNG THỂ XÓA: Lệnh ${log.symbol} đang chạy thực tế trên sàn. Bạn phải ĐÓNG VỊ THẾ (Close Position) trên app Binance trước!`);
        return;
    }
    const isConfirmed = window.confirm(`CẢNH BÁO: Xóa sổ tay lệnh ${log.symbol} [Trạng thái: ${log.status}]?`);
    if (!isConfirmed) return;

    try {
      if (log.status === 'PENDING') {
        const LOCAL_BRIDGE_URL = '/api/cancel-orphans';
        const cancelRes = await fetch(LOCAL_BRIDGE_URL, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: log.symbol, entry: log.entry, sl: log.sl, tp: log.tp_1_price })
        });
        const cancelData = await cancelRes.json();
        if (!cancelRes.ok) throw new Error(cancelData.details?.msg || cancelData.error || "Lỗi Bridge Cục bộ");
      }
      const { error } = await supabase.from('trade_logs').delete().eq('id', log.id);
      if (error) throw error;
    } catch (err) {
      alert("Lỗi khi hủy/xóa lệnh: " + err.message);
    }
  };

  return (
    <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl mt-6">
      
      <div className="flex justify-between items-center mb-4 border-b border-slate-800/80 pb-3">
        <h2 className="text-[12px] font-black text-slate-300 uppercase flex items-center gap-2 tracking-widest">
          <History className="w-4 h-4 text-purple-500" /> SỔ TAY LƯỢNG TỬ (SUPABASE)
        </h2>
        <button 
          onClick={syncBinanceToSupabase}
          disabled={isSyncing}
          className="bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/30 px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-2 transition-all"
        >
          <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} /> 
          {isSyncing ? 'ĐANG ĐỒNG BỘ...' : 'ĐỒNG BỘ AUTO-SYNC'}
        </button>
      </div>

      {/* TỔNG KẾT PNL CHÍNH */}
      <div className="flex gap-4 mb-4 text-[10px] font-mono bg-[#0a0a0c] p-3 rounded-lg border border-slate-800 shadow-inner">
        <div className="flex flex-col flex-1">
          <span className="text-slate-500 font-bold mb-1 flex items-center gap-1"><Calculator className="w-3 h-3"/> REALIZED (ĐÃ CHỐT)</span>
          <span className={`font-black text-sm ${totalRealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalRealized >= 0 ? '+' : ''}{totalRealized.toFixed(2)}$
          </span>
        </div>
        <div className="flex flex-col flex-1 border-l border-slate-800 pl-4">
          <span className="text-slate-500 font-bold mb-1">FLOATING (ĐANG CHẠY)</span>
          <span className={`font-black text-sm ${totalFloating >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalFloating >= 0 ? '+' : ''}{totalFloating.toFixed(2)}$
          </span>
        </div>
        <div className="flex flex-col flex-1 border-l border-slate-800 pl-4 bg-purple-900/10 rounded-r-lg -my-3 -mr-3 p-3">
          <span className="text-purple-400 font-bold mb-1 uppercase tracking-widest">Net Total PnL</span>
          <span className={`font-black text-lg ${netTotalPnL >= 0 ? 'text-emerald-500' : 'text-red-500'} drop-shadow-md`}>
            {netTotalPnL >= 0 ? '+' : ''}{netTotalPnL.toFixed(2)}$
          </span>
        </div>
      </div>

      {/* CẢNH BÁO: LỆNH CÓ NGUY CƠ BỊ CHỐT NON (Alpha Decay Risk) */}
      {atRiskOfEarlyExit.length > 0 && (
        <div className="mb-5 bg-red-950/30 border-2 border-red-500/60 rounded-lg p-3 shadow-[0_0_15px_rgba(239,68,68,0.2)] animate-pulse">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <span className="text-[11px] font-black text-red-400 uppercase tracking-widest">
              ĐỪNG ĐÓNG TAY — {atRiskOfEarlyExit.length} lệnh đang lời nhưng chưa tới điểm khóa lãi
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {atRiskOfEarlyExit.map(({ log, progress }) => {
            const { currentR, targetR } = progress;
            // 🚀 BẢN VÁ: ĐỒNG BỘ ĐỘNG (DYNAMIC) NGƯỠNG TRAILING TỪ BACKEND
            const stratStr = String(log.strategy_name || "").toUpperCase();
            const tierStr = String(log.asset_tier || "").toUpperCase();

            let beTrigger = 0.5; let lockTrigger = 1.0; let lockAmount = 0.5;
            if (stratStr.includes('LEAD-LAG')) {
                beTrigger = 0.35; lockTrigger = 0.8; lockAmount = 0.5;
            } else if (stratStr.includes('GAMMA')) {
                beTrigger = 0.45; lockTrigger = 0.9; lockAmount = 0.5;
            } else if (stratStr.includes('LIQ-FLUSH')) {
                beTrigger = 0.5; lockTrigger = 1.0; lockAmount = 0.5;
            } else if (stratStr.includes('KINETIC') || stratStr.includes('SFP')) {
                beTrigger = 0.6; lockTrigger = 1.2; lockAmount = 0.6;
            } else if (stratStr.includes('ADAPTIVE')) {
                beTrigger = 0.8; lockTrigger = 1.5; lockAmount = 0.8;
            }

            if (tierStr.includes('TIER 4') || tierStr.includes('TIER 3')) {
                beTrigger += 0.2; lockTrigger += 0.3;
            } else if (tierStr.includes('TIER 1')) {
                beTrigger -= 0.1; lockTrigger -= 0.1;
            }

            let nextGoalR = beTrigger;
            let prevGoalR = 0;
            let goalText = `Dời SL Hòa Vốn (${beTrigger.toFixed(2)}R)`;
            let barColor = "bg-amber-500";
            let textHighlight = "text-amber-400";
            
            if (currentR < beTrigger && log.trailing_activated) {
                nextGoalR = lockTrigger;
                prevGoalR = 0.0; 
                goalText = "Khóa lãi tĩnh (Khiên BE đã bật)";
                barColor = "bg-blue-500/30"; 
                textHighlight = "text-blue-400";
            }
            else if (currentR < beTrigger && !log.trailing_activated) {
                nextGoalR = beTrigger;
                prevGoalR = 0;
                goalText = `Dời SL Hòa Vốn (${beTrigger.toFixed(2)}R)`;
                barColor = "bg-amber-500";
                textHighlight = "text-amber-400";
            }
            else if (currentR >= beTrigger && currentR < lockTrigger) {
                nextGoalR = lockTrigger;
                prevGoalR = beTrigger;
                goalText = `Khóa lãi +${lockAmount.toFixed(2)}R`;
                barColor = "bg-blue-500";
                textHighlight = "text-blue-400";
            } else if (currentR >= lockTrigger) {
                nextGoalR = targetR;
                prevGoalR = lockTrigger;
                goalText = "chạm Full TP";
                barColor = "bg-emerald-500";
                textHighlight = "text-emerald-400";
            }

            const rDisplay = currentR.toFixed(2);
            const neededR = nextGoalR.toFixed(2);
            
            // Tính độ dài thanh Bar giữa 2 mốc R
            const segmentProgress = Math.max(0, Math.min(100, ((currentR - prevGoalR) / (nextGoalR - prevGoalR)) * 100));

            return (
              <div key={log.id} className="flex items-center justify-between bg-black/40 border border-red-900/40 rounded px-2.5 py-1.5 text-[9.5px] font-mono">
                <div className="flex items-center gap-2">
                  <span className="font-black text-white">{log.symbol}</span>
                  <span className={log.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>{log.direction}</span>
                  <span className="text-emerald-400 font-bold">+${progress.currentPnl.toFixed(2)}</span>
                </div>
                
                <div className="flex items-center gap-2 text-slate-400">
                  <span>Mức <span className="text-white font-bold">+{rDisplay}R</span> / Cần <span className={`font-bold ${textHighlight}`}>{neededR}R</span> để {goalText}</span>
                  <div className="w-16 h-1.5 bg-slate-800 rounded overflow-hidden">
                    <div className={`h-full ${barColor} transition-all duration-500`} style={{ width: `${segmentProgress}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
          </div>
          <div className="text-[8.5px] text-red-400/80 mt-2 italic">
            ⚠️ Dữ liệu lịch sử cho thấy: các lệnh đóng tay sớm chỉ ăn trung bình ~17% mục tiêu, trong khi lệnh thua mất gần trọn Stoploss. Hãy để hệ thống Trailing tự bảo vệ.
          </div>
        </div>
      )}

      {/* DASHBOARD PHÂN TÍCH CHUYÊN SÂU */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        
        {/* PNL 7 NGÀY GẦN NHẤT */}
        <div className="bg-[#0a0a0c] p-3 rounded-lg border border-slate-800">
           <div className="text-[9px] font-bold text-slate-500 mb-2 flex items-center gap-1.5 uppercase tracking-widest">
              <CalendarDays className="w-3.5 h-3.5 text-blue-400"/> PnL 7 Ngày Gần Nhất
           </div>
           <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {dailyPnL.length === 0 ? <span className="text-[9px] text-slate-600 font-bold">Chưa có dữ liệu chốt lời/lỗ.</span> : 
                 dailyPnL.map((d, i) => (
                    <div key={i} className="flex flex-col items-center justify-center bg-black border border-slate-800 p-2 rounded min-w-[55px] shadow-sm">
                       <span className="text-[8px] font-bold text-slate-500 mb-1">{d.displayDate}</span>
                       <span className={`text-[10px] font-black ${d.pnl > 0 ? 'text-emerald-400' : d.pnl < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                          {d.pnl > 0 ? '+' : ''}{d.pnl.toFixed(1)}$
                       </span>
                    </div>
                 ))
              }
           </div>
        </div>

        {/* TOP 5 CHIẾN THUẬT - TIER */}
        <div className="bg-[#0a0a0c] p-3 rounded-lg border border-slate-800 flex flex-col">
           <div className="text-[9px] font-bold text-slate-500 mb-2 flex items-center justify-between uppercase tracking-widest border-b border-slate-800 pb-2">
              <span className="flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5 text-amber-400"/> Top 5 Alpha (Min 3 Lệnh)</span>
           </div>
           
           <div className="space-y-2 flex-grow overflow-y-auto pr-1" style={{ scrollbarWidth: 'none' }}>
              {topStrategies.length === 0 ? (
                 <span className="text-[9px] text-slate-600 font-bold flex items-center h-full justify-center">Chưa có tổ hợp nào đạt chuẩn 3 lệnh.</span>
              ) : (
                 topStrategies.map((s, i) => (
                    <div key={i} className="flex justify-between items-center bg-black border border-slate-800/80 px-2.5 py-2 rounded shadow-sm hover:border-slate-700 transition-colors">
                       
                       {/* THÔNG TIN CHIẾN THUẬT VÀ TIER */}
                       <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] font-bold text-slate-200 truncate max-w-[150px]" title={s.strat}>
                             {s.strat}
                          </span>
                          <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded border w-max tracking-wider
                              ${s.tier.includes('1') ? 'bg-blue-900/30 text-blue-400 border-blue-500/30' : 
                                s.tier.includes('2') ? 'bg-emerald-900/30 text-emerald-400 border-emerald-500/30' : 
                                s.tier.includes('3') ? 'bg-amber-900/30 text-amber-400 border-amber-500/30' : 
                                'bg-pink-900/30 text-pink-400 border-pink-500/30 shadow-[0_0_5px_rgba(236,72,153,0.2)]'}`}>
                              {s.tier}
                          </span>
                       </div>

                       {/* THỐNG KÊ WINRATE VÀ R:R */}
                       <div className="flex flex-col items-end gap-1">
                          <div className="flex items-baseline gap-2">
                             <span className="text-[8px] font-bold text-slate-500">N={s.total}</span>
                             <span className={`text-[11px] font-black ${s.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {s.winRate.toFixed(1)}%
                             </span>
                          </div>
                          <span className="text-[8.5px] font-mono text-cyan-400 font-bold bg-cyan-950/30 border border-cyan-900/50 px-1 rounded">
                             Avg R:R 1:{s.avgRR.toFixed(2)}
                          </span>
                       </div>

                    </div>
                 ))
              )}
           </div>
        </div>
      </div>

      {/* BẢNG LỊCH SỬ LỆNH (Giữ nguyên) */}
      <div className="overflow-x-auto max-h-[350px]" style={{ scrollbarWidth: 'thin', scrollbarColor: '#065f46 #0a0a0c' }}>
        <table className="w-full text-left border-collapse relative">
          <thead className="sticky top-0 bg-[#111116] z-10 shadow-md">
            <tr className="text-[9px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
              <th className="pb-2 pt-2">Trạng thái</th>
              <th className="pb-2 pt-2">Cặp / Hướng</th>
              <th className="pb-2 pt-2">Entry / SL / TP</th>
              <th className="pb-2 pt-2 text-right">PnL</th>
              <th className="pb-2 pt-2 text-center w-8">Xóa</th>
            </tr>
          </thead>
          <tbody className="text-[10px] font-mono">
            
            {ghostPositions.map(pos => {
              const isLong = parseFloat(pos.positionAmt) > 0;
              const pnl = parseFloat(pos.unRealizedProfit);
              return (
                  <tr key={`ghost-${pos.symbol}`} className="border-b border-amber-900/50 bg-amber-950/10 hover:bg-amber-900/30">
                      <td className="py-2.5 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                          <span className="font-bold text-amber-500">GHOST</span>
                      </td>
                      <td className="py-2.5">
                          <div className="font-black text-white">{pos.symbol}</div>
                          <div className={`flex items-center gap-1 text-[9px] ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                              {isLong ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>} {isLong ? 'LONG' : 'SHORT'}
                          </div>
                      </td>
                      <td className="py-2.5 text-slate-400">
                          E: <span className="text-white">${parseFloat(pos.entryPrice).toFixed(4)}</span><br/>
                          <span className="text-[8px] text-amber-500 italic">⚠️ Lệnh chưa lưu DB</span>
                      </td>
                      <td className={`py-2.5 text-right font-black ${pnl > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}$
                      </td>
                      <td className="py-2.5 text-center text-slate-600">-</td>
                  </tr>
              );
            })}

            {sortedLogs.length === 0 && ghostPositions.length === 0 ? (
              <tr><td colSpan="5" className="text-center py-6 text-slate-600 font-bold">KHÔNG CÓ DỮ LIỆU GIAO DỊCH</td></tr>
            ) : (
              sortedLogs.slice(0, 30).map((log) => {
                let isLive = log.status === 'OPEN';
                let isPending = log.status === 'PENDING';
                let displayPnl = parseFloat(log.pnl_usd || 0);
                let displayEntry = parseFloat(log.entry || 0);

                if (isLive || isPending) {
                   const actualPos = binancePositions.find(p => p.symbol === log.symbol);
                   if (actualPos && parseFloat(actualPos.positionAmt) !== 0) {
                      const markPrice = parseFloat(actualPos.markPrice || log.entry);
                      const sizeCoin = parseFloat(log.position_size_usd) / parseFloat(log.entry);
                      displayPnl = log.direction === 'LONG' 
                         ? (markPrice - parseFloat(log.entry)) * sizeCoin
                         : (parseFloat(log.entry) - markPrice) * sizeCoin;
                      
                      displayEntry = parseFloat(log.entry);
                      isLive = true; 
                      isPending = false;
                   }
                }

                return (
                  <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-900/50 transition-colors group">
                    <td className="py-2.5 flex items-center gap-1.5">
                      {isPending ? <Link className="w-3.5 h-3.5 text-blue-400 animate-pulse" /> : 
                       isLive ? <Clock className="w-3.5 h-3.5 text-amber-500 animate-spin-slow" /> : 
                       log.status === 'CANCELED' ? <XCircle className="w-3.5 h-3.5 text-slate-500" /> :
                       displayPnl > 0 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : 
                       <XCircle className="w-3.5 h-3.5 text-red-500" />}
                      <span className={`font-bold ${isPending ? 'text-blue-400' : isLive ? 'text-amber-500' : log.status === 'CANCELED' ? 'text-slate-500 line-through' : displayPnl > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {isPending ? 'CHỜ KHỚP' : log.status === 'CANCELED' ? 'ĐÃ HỦY' : log.status}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <div className="font-black text-white">{log.symbol}</div>
                      <div className={`flex items-center gap-1 text-[9px] ${log.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {log.direction === 'LONG' ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>} {log.direction}
                      </div>
                    </td>
                    <td className="py-2.5 text-slate-400">
                      E: <span className="text-white">${displayEntry.toFixed(4)}</span><br/>
                      <span className="text-red-400">S: ${parseFloat(log.sl).toFixed(4)}</span> <span className="text-slate-600">|</span> <span className="text-emerald-400">T: ${parseFloat(log.tp_1_price).toFixed(4)}</span>
                    </td>
                    <td className={`py-2.5 text-right font-black ${isPending ? 'text-slate-500' : displayPnl > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isPending ? '0.00$' : `${displayPnl > 0 ? '+' : ''}${displayPnl.toFixed(2)}$`}
                      {isLive && (() => {
                      const progress = getProfitProgress(log);
                      
                      if (!progress || !progress.isProfitable) {
                          return <div className="text-[8px] text-slate-500 font-normal mt-0.5">(Live)</div>;
                      }
                      
                      // 🚀 BẢN VÁ: ĐỒNG BỘ NGƯỠNG HIỂN THỊ ĐỘNG TRONG NHÃN (LABEL)
                      const stratStr = String(log.strategy_name || "").toUpperCase();
                      const tierStr = String(log.asset_tier || "").toUpperCase();
                      let beTrigger = 0.5; let lockTrigger = 1.0; let trailTrigger = 2.0;
                      if (stratStr.includes('LEAD-LAG')) { beTrigger = 0.35; lockTrigger = 0.8; trailTrigger = 1.5; }
                      else if (stratStr.includes('GAMMA')) { beTrigger = 0.45; lockTrigger = 0.9; trailTrigger = 1.6; }
                      else if (stratStr.includes('LIQ-FLUSH')) { beTrigger = 0.5; lockTrigger = 1.0; trailTrigger = 1.8; }
                      else if (stratStr.includes('KINETIC') || stratStr.includes('SFP')) { beTrigger = 0.6; lockTrigger = 1.2; trailTrigger = 2.0; }
                      else if (stratStr.includes('ADAPTIVE')) { beTrigger = 0.8; lockTrigger = 1.5; trailTrigger = 2.5; }
                      if (tierStr.includes('TIER 4') || tierStr.includes('TIER 3')) { beTrigger += 0.2; lockTrigger += 0.3; trailTrigger += 0.5; }
                      else if (tierStr.includes('TIER 1')) { beTrigger -= 0.1; lockTrigger -= 0.1; trailTrigger -= 0.2; }

                      if (progress.currentR < beTrigger) {
                          if (log.trailing_activated) {
                              return (
                                <div className="text-[8px] text-blue-400 font-bold mt-0.5 flex items-center gap-1 justify-end animate-pulse">
                                  🛡️ AN TOÀN (Lùi về: +{progress.currentR.toFixed(2)}R)
                                </div>
                              );
                          } else {
                              return (
                                <div className="text-[8px] text-amber-400 font-bold mt-0.5 flex items-center gap-1 justify-end">
                                  <AlertTriangle className="w-2.5 h-2.5" /> Rủi ro mở (+{progress.currentR.toFixed(2)}R)
                                </div>
                              );
                          }
                      } 
                      else if (progress.currentR >= beTrigger && progress.currentR < lockTrigger) {
                          return (
                            <div className="text-[8px] text-blue-400 font-bold mt-0.5 flex items-center gap-1 justify-end animate-pulse">
                              🛡️ HÒA VỐN (+{progress.currentR.toFixed(2)}R)
                            </div>
                          );
                      } 
                      else if (progress.currentR >= lockTrigger && progress.currentR < trailTrigger) {
                          return (
                            <div className="text-[8px] text-emerald-400 font-bold mt-0.5 flex items-center gap-1 justify-end drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]">
                              🔒 KHÓA LÃI (+{progress.currentR.toFixed(2)}R)
                            </div>
                          );
                      }
                      else {
                          return (
                            <div className="text-[8px] text-purple-400 font-bold mt-0.5 flex items-center gap-1 justify-end animate-pulse">
                              🌊 BÁM TREND (+{progress.currentR.toFixed(2)}R)
                            </div>
                          );
                      }
                    })()}
                    </td>
                    <td className="py-2.5 text-center">
                      <button 
                        onClick={() => handleDeleteLog(log)}
                        className="text-slate-600 hover:text-red-500 hover:bg-red-950/30 p-1.5 rounded transition-all opacity-20 group-hover:opacity-100"
                        title="Xóa lệnh này"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

=========================================
/// FILE: src/components/terminal/VectorState.jsx
=========================================

import React from 'react';
import { Activity } from 'lucide-react';

export default function VectorState({ vectorRegime, mvrvZScore, autoData }) {
  if (!vectorRegime || !autoData) return null;

  return (
    <div className="bg-[#111116] border border-purple-900/40 rounded-xl p-4 shadow-xl mb-6 relative overflow-hidden">
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-900/10 rounded-full blur-xl"></div>
      <div className="flex justify-between items-end border-b border-purple-900/30 pb-2 mb-4">
        <h2 className="text-[10px] font-black text-purple-400 uppercase tracking-widest flex items-center gap-2">
          <Activity className="w-4 h-4" /> VECTOR STATE SPACE (V6.1)
        </h2>
        <div className="text-[9px] text-slate-500 font-mono">
          <span className="text-purple-500 font-bold">MVRV-Z:</span> {mvrvZScore} ({vectorRegime.details.mvrvDesc})
        </div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 font-mono">
        <div className="bg-black/50 border border-slate-800 p-2 rounded flex flex-col justify-between">
          <span className="text-[7.5px] text-slate-500 uppercase font-bold mb-1">L1: Structure</span>
          <span className={`text-[10px] font-black uppercase ${vectorRegime.details.l1.includes('Trend') ? 'text-emerald-400' : 'text-amber-400'}`}>
            {vectorRegime.details.l1}
          </span>
        </div>

        <div className="bg-black/50 border border-slate-800 p-2 rounded flex flex-col justify-between">
          <span className="text-[7.5px] text-slate-500 uppercase font-bold mb-1">L2: Volatility</span>
          <span className={`text-[10px] font-black uppercase ${vectorRegime.details.l2 === 'Compression' ? 'text-pink-500 animate-pulse' : vectorRegime.details.l2 === 'Extreme' ? 'text-red-500' : 'text-blue-400'}`}>
            {vectorRegime.details.l2}
          </span>
        </div>

        <div className="bg-black/50 border border-slate-800 p-2 rounded flex flex-col justify-between">
          <span className="text-[7.5px] text-slate-500 uppercase font-bold mb-1">L3: Liq Event</span>
          <span className={`text-[9px] font-black uppercase ${vectorRegime.details.l3 !== 'Quiet' ? 'text-red-400 font-bold' : 'text-slate-400'}`}>
            {vectorRegime.details.l3}
          </span>
        </div>

        <div className="bg-black/50 border border-slate-800 p-2 rounded flex flex-col justify-between">
          <span className="text-[7.5px] text-slate-500 uppercase font-bold mb-1">L4: Positioning (OI)</span>
          <span className={`text-[9px] font-black uppercase ${vectorRegime.details.l4.includes('Smart') ? 'text-amber-300' : vectorRegime.details.l4.includes('Building') ? 'text-cyan-400' : vectorRegime.details.l4.includes('Liquidation') || vectorRegime.details.l4.includes('Capitulation') ? 'text-red-500' : 'text-slate-300'}`}>
            {vectorRegime.details.l4}
          </span>
        </div>

        <div className="bg-black/50 border border-slate-800 p-2 rounded flex flex-col justify-between">
          <span className="text-[7.5px] text-slate-500 uppercase font-bold mb-1">L5: Momentum</span>
          <span className={`text-[9px] font-black uppercase ${vectorRegime.details.l5.includes('Fake') || vectorRegime.details.l5.includes('Divergence') ? 'text-red-500 animate-pulse' : 'text-emerald-400'}`}>
            {vectorRegime.details.l5}
          </span>
        </div>

        <div className="bg-black/50 border border-slate-800 p-2 rounded flex flex-col justify-between">
          <span className="text-[7.5px] text-slate-500 uppercase font-bold mb-1">L6: Macro Status</span>
          <span className={`text-[9px] font-black uppercase ${vectorRegime.details.l6.includes('Overvaluation') ? 'text-red-500' : vectorRegime.details.l6.includes('Bleeding') ? 'text-amber-500' : 'text-emerald-500'}`}>
            {vectorRegime.details.l6}
          </span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-purple-900/30 text-center font-mono relative">
         <div className="absolute left-0 top-3 text-[7px] text-purple-400 rotate-[-90deg] uppercase tracking-widest opacity-50">Range Scan</div>
         <div className="grid grid-cols-5 gap-2 pl-4">
            <div className="flex flex-col"><span className="text-[7px] text-slate-500">EMA 20 SLOPE</span><span className={`text-[10px] font-bold ${autoData.ema20.slope > 0 ? 'text-emerald-500' : 'text-red-500'}`}>{autoData.ema20.slope.toFixed(2)}%</span></div>
            <div className="flex flex-col"><span className="text-[7px] text-slate-500">EMA 50 SLOPE</span><span className={`text-[10px] font-bold ${autoData.ema50.slope > 0 ? 'text-emerald-500' : 'text-red-500'}`}>{autoData.ema50.slope.toFixed(2)}%</span></div>
            <div className="flex flex-col"><span className="text-[7px] text-slate-500">EMA 200 SLOPE</span><span className={`text-[10px] font-bold ${autoData.ema200.slope > 0 ? 'text-emerald-500' : 'text-red-500'}`}>{autoData.ema200.slope.toFixed(2)}%</span></div>
            
            <div className={`col-span-2 flex flex-col items-center justify-center rounded border ${autoData.scan20_50.isCrossBull ? 'bg-emerald-950/30 border-emerald-500/50' : autoData.scan20_50.isCrossBear ? 'bg-red-950/30 border-red-500/50' : 'bg-black/30 border-slate-800'}`}>
               <span className="text-[7px] text-slate-500 uppercase">20/50 Crossover (20 Nến)</span>
               <span className={`text-[10px] font-black ${autoData.scan20_50.isCrossBull ? 'text-emerald-400' : autoData.scan20_50.isCrossBear ? 'text-red-400' : 'text-slate-600'}`}>
                  {autoData.scan20_50.isCrossBull ? '🟢 GOLDEN CROSS' : autoData.scan20_50.isCrossBear ? '🔴 DEATH CROSS' : `NO CROSS (Spread: ${autoData.scan20_50.spreadPercent.toFixed(2)}%)`}
               </span>
            </div>
         </div>
      </div>
    </div>
  );
}

=========================================
/// FILE: src/config/constants.js
=========================================

// File: src/config/constants.js

export const MIN_NOTIONALS = {
  BTCUSDT: 50, 
  ETHUSDT: 20, 
  SOLUSDT: 5, 
  BNBUSDT: 5,   
  LINKUSDT: 20, 
  XRPUSDT: 5, 
  ADAUSDT: 5, 
  DASHUSDT: 5,  
  AVAXUSDT: 5   
};

export const getMinNotional = (sym) => MIN_NOTIONALS[sym] || 10;

export const POOL_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 
  'LINKUSDT', 'XRPUSDT', 'ADAUSDT', 'DASHUSDT', 'AVAXUSDT'
];

export const POOL_INTERVALS = ['5m', '15m', '1h', '4h', '1d'];

=========================================
/// FILE: src/core/QuantMath.js
=========================================

// FILE: src/core/QuantMath.js

const QuantMath = {
  sma: (data, period) => {
    if (!data || data.length === 0 || period <= 0) return 0;
    // BẢN VÁ: Nếu không đủ nến, tính trung bình trên số nến hiện có
    const actualPeriod = Math.min(data.length, period);
    return data.slice(-actualPeriod).reduce((a, b) => a + b, 0) / actualPeriod;
  },
  
  ema: (data, period) => {
    if (!data || data.length < period || period <= 0) return 0;
    const k = 2 / (period + 1);
    let emaVal = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      emaVal = (data[i] * k) + (emaVal * (1 - k));
    }
    return emaVal;
  },

  // --- BỔ SUNG MỚI CHO L1: TÍNH CHUỖI EMA & MACD ---
  emaSeries: (data, period) => {
    let emaArr = [];
    if (!data || data.length < period) return emaArr;
    const k = 2 / (period + 1);
    let emaVal = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for(let i = period - 1; i < data.length; i++) {
        if(i === period - 1) emaArr.push(emaVal);
        else {
            emaVal = (data[i] * k) + (emaVal * (1 - k));
            emaArr.push(emaVal);
        }
    }
    return emaArr; 
  },

  macd: (closes, fast=12, slow=26, sig=9) => {
    if (!closes || closes.length < slow + sig) return { macd: 0, signal: 0, hist: 0 };
    const fastEmaSeries = QuantMath.emaSeries(closes, fast);
    const slowEmaSeries = QuantMath.emaSeries(closes, slow);
    
    const diff = fastEmaSeries.length - slowEmaSeries.length;
    let macdSeries = [];
    for(let i = 0; i < slowEmaSeries.length; i++){
        macdSeries.push(fastEmaSeries[i+diff] - slowEmaSeries[i]);
    }
    const signalLine = QuantMath.ema(macdSeries, sig);
    const currentMacd = macdSeries[macdSeries.length-1];
    return { macd: currentMacd, signal: signalLine, hist: currentMacd - signalLine };
  },

  // 1. ANCHORED VWAP & STANDARD DEVIATION BANDS
  vwapWithBands: (highs, lows, closes, volumes, period = 200) => {
      if (!closes || closes.length < period) return { vwap: closes[closes.length-1], upper1: 0, lower1: 0, upper2: 0, lower2: 0 };
      
      const sliceH = highs.slice(-period); const sliceL = lows.slice(-period);
      const sliceC = closes.slice(-period); const sliceV = volumes.slice(-period);
      
      let sumVol = 0; let sumPriceVol = 0;
      for (let i = 0; i < period; i++) {
          const typicalPrice = (sliceH[i] + sliceL[i] + sliceC[i]) / 3;
          sumPriceVol += typicalPrice * sliceV[i];
          sumVol += sliceV[i];
      }
      const vwap = sumVol > 0 ? sumPriceVol / sumVol : sliceC[sliceC.length-1];

      // Tính Phương sai (Variance) để làm Dải Band
      let varianceSum = 0;
      for (let i = 0; i < period; i++) {
          const typicalPrice = (sliceH[i] + sliceL[i] + sliceC[i]) / 3;
          varianceSum += sliceV[i] * Math.pow(typicalPrice - vwap, 2);
      }
      const sd = Math.sqrt(varianceSum / (sumVol || 1));

      return { vwap, upper1: vwap + sd, lower1: vwap - sd, upper2: vwap + (sd * 2), lower2: vwap - (sd * 2) };
  },

  // 2. CUMULATIVE VOLUME DELTA (CVD)
  cvd: (volumes, buyVolumes, period = 50) => {
      if (!volumes || !buyVolumes || volumes.length < period) return { currentCVD: 0, cvdTrend: 0 };
      let cumulativeDelta = 0;
      let totalVolumePeriod = 0;
      const startIdx = volumes.length - period;
      
      for (let i = startIdx; i < volumes.length; i++) {
          const sellVol = volumes[i] - buyVolumes[i];
          const delta = buyVolumes[i] - sellVol;
          cumulativeDelta += delta;
          totalVolumePeriod += volumes[i];
      }
      
      // ✅ BẢN VÁ CHUẨN QUANT: Net Taker Flow % (So với tổng thanh khoản)
      const cvdTrend = totalVolumePeriod > 0 ? (cumulativeDelta / totalVolumePeriod) * 100 : 0;
      return { currentCVD: cumulativeDelta, cvdTrend };
  },

  // 3. CHỈ SỐ HURST (Hurst Exponent Approximation)
  // Xác định xem thị trường Trend (H > 0.5) hay Đi ngang Mean-Reverting (H < 0.5)
  hurst: (closes, period = 100) => {
      if (!closes || closes.length < period) return 0.5;
      const slice = closes.slice(-period);
      let logReturns = [];
      for (let i = 1; i < slice.length; i++) logReturns.push(Math.log(slice[i] / slice[i-1]));
      
      const mean = logReturns.reduce((a,b)=>a+b,0) / logReturns.length;
      let sumDev = 0; let minCum = 0; let maxCum = 0;
      
      // Rescaled Range (R/S) Calculation
      for (let i = 0; i < logReturns.length; i++) {
          sumDev += (logReturns[i] - mean);
          if (sumDev > maxCum) maxCum = sumDev;
          if (sumDev < minCum) minCum = sumDev;
      }
      const range = maxCum - minCum;
      const stdDev = Math.sqrt(logReturns.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / logReturns.length);
      
      const rs = (stdDev === 0) ? 0 : range / stdDev;
      // Công thức xấp xỉ logarit của H
      const h = Math.log(rs) / Math.log(period);
      return Math.max(0.1, Math.min(0.9, h)); // Chuẩn hóa vào phổ 0.1 - 0.9
  },

  // 4. ORDER BOOK HEATMAP (Sức ép Cung/Cầu Động)
  orderBookHeatmap: (bids, asks, currentPrice, depthPercent = 0.01) => {
      let bidVol = 0; let askVol = 0;
      const minBidPrice = currentPrice * (1 - depthPercent);
      const maxAskPrice = currentPrice * (1 + depthPercent);

      bids.forEach(b => { if (parseFloat(b[0]) >= minBidPrice) bidVol += parseFloat(b[1]); });
      asks.forEach(a => { if (parseFloat(a[0]) <= maxAskPrice) askVol += parseFloat(a[1]); });

      const totalBook = bidVol + askVol;
      return totalBook > 0 ? (bidVol / totalBook) : 0.5; // OBI Heatmap: >0.6 là tường mua dày, <0.4 là tường bán đè
  },
  
  // --- HỆ THỐNG CHẤM ĐIỂM TRỰC GIAO L1 (MARKET REGIME) ---
  evaluateL1: (autoData) => {
    // ĐÃ SỬA: Lấy cvdTrend thay vì các biến OBV lỗi thời
    const { currentPrice, ema20, ema50, ema200, htfSma200, atrPercent, macd, adx, hurstValue, cvdTrend } = autoData;
    
    // 🏛️ CỤM A: Định Vị Không Gian (Structural Alignment) - Max 100
    const vsHtf = currentPrice > htfSma200 ? 40 : -40;
    let emaAlign = 0;
    if (ema20.value > ema50.value && ema50.value > ema200.value) emaAlign = 60;
    else if (ema20.value < ema50.value && ema50.value < ema200.value) emaAlign = -60;
    else if (ema20.value > ema50.value) emaAlign = 30;
    else if (ema20.value < ema50.value) emaAlign = -30;
    const cA = vsHtf + emaAlign;

    // 🚀 CỤM B: Động Năng & Gia Tốc (Velocity & Trajectory) - Max 100
    const normSlope20 = atrPercent > 0 ? (ema20.slope / atrPercent) : 0;
    let cB = 0;
    if (normSlope20 > 0.1 && macd.hist > 0) cB = 100;         // Tăng tốc đồng thuận
    else if (normSlope20 < -0.1 && macd.hist < 0) cB = -100; // Rơi tự do
    else if (normSlope20 > 0.1 && macd.hist <= 0) cB = 20;   // Bò lên nhưng kiệt sức (Divergence rủi ro)
    else if (normSlope20 < -0.1 && macd.hist >= 0) cB = -20; // Rớt nhưng hãm phanh
    else cB = normSlope20 > 0 ? 10 : -10;

    // ⚖️ CỤM C: Bằng Chứng Dòng Tiền TAKER CHỦ ĐỘNG (Conviction Multiplier)
    const k_adx = Math.max(0.1, Math.min(1.5, adx / 25));
    let k_cvd = 1.0;
    
    // Phân kỳ CVD: Giá cấu trúc tăng (cA > 0) nhưng dòng tiền Taker xả ngầm (cvdTrend < -5)
    // Giá cấu trúc giảm (cA < 0) nhưng Taker gom ngầm (cvdTrend > 5)
    if ((cA > 0 && cvdTrend < -5) || (cA < 0 && cvdTrend > 5)) {
        k_cvd = -0.5; // Chặn đứng hệ thống, triệt tiêu sTrend
    }

    let sTrend = (cA * 0.55 + cB * 0.45) * (k_adx * k_cvd);
    
    // 🎲 ÁP DỤNG HURST EXPONENT (Lượng tử hóa Độ nhiễu)
    let l1 = "Range";
    if (hurstValue < 0.45) {
        // Thị trường Random Walk / Mean-reverting. Bóp nát sTrend.
        sTrend *= 0.5;
        l1 = "Chop / Mean Reversion";
    } else if (sTrend >= 75 && hurstValue > 0.6) l1 = "Strong Trend Up";
    else if (sTrend >= 30) l1 = "Trend Up";
    else if (sTrend <= -75 && hurstValue > 0.6) l1 = "Strong Trend Down";
    else if (sTrend <= -30) l1 = "Trend Down";
    else l1 = "Range";

    return { l1, sTrend, cA, cB, k_adx, k_cvd, hurstValue }; // Trả về k_cvd để các tầng sau có thể Tracking
  },

  // --- HỆ THỐNG CHẤM ĐIỂM TRỰC GIAO L2 (VOLATILITY) ---
  evaluateL2: (autoData) => {
      const { atrRank, bbwRank, bbwSlope, currentVolume, avgVolume20 } = autoData;

      // 1. Chỉ số Biến động Không gian (Spatial Vol Score: 0 - 100)
      // Tỷ trọng: Bollinger Bands (60%) quan trọng hơn ATR (40%) trong việc tìm Điểm Nén
      const volScore = (atrRank * 0.4) + (bbwRank * 0.6);

      // 2. Gia tốc Biến động (Volatility Trajectory)
      const isBandsExpanding = bbwSlope > 5; // Dải băng đang mở toác > 5%
      const isBandsContracting = bbwSlope < -2; // Dải băng đang thắt chặt lại

      // 3. Khối lượng xác nhận (Volume Validation)
      const volRatio = avgVolume20 > 0 ? (currentVolume / avgVolume20) : 1;
      const isVolSpiking = volRatio > 1.5;

      // 4. Phân loại L2 bằng sự hội tụ của 3 Cụm
      let l2 = "Normal";
      
      // Đang Nén (Squeeze): Điểm nén tổng thể cực thấp HOẶC đang ở vùng thấp mà còn thắt chặt thêm
      if (volScore < 20 || (bbwRank < 25 && isBandsContracting)) {
          l2 = "Compression";
      } 
      // Cực Đại (Extreme): Nguy cơ đảo chiều Mean Reversion rất cao
      else if (volScore > 85) {
          l2 = "Extreme";
      }
      // Nổ Biến Động (Expansion): Đang nén nhưng BBW dốc ngược lên VÀ có Volume bơm vào
      else if ((volScore >= 20 && volScore <= 85) && isBandsExpanding && isVolSpiking) {
          l2 = "Expansion";
      } 
      // Trạng thái bình thường
      else {
          l2 = "Normal";
      }

      return { l2, volScore, isBandsExpanding, isBandsContracting, volRatio };
  },

  // --- HỆ THỐNG CHẤM ĐIỂM TRỰC GIAO L3 (LIQUIDITY EVENTS & TRAPS) ---
  evaluateL3: (autoData, l1, l2) => {
      const {
          isBullishSFP, isBearishSFP, currentVolume, avgVolume20,
          fundingSlope, vpinValue, obi, currentPrice, ema20,
          liqLongsVol, liqShortsVol, lastClosedVolume // 🚀 ĐÃ VÁ: Bổ sung lastClosedVolume
      } = autoData;

      // 1. CỤM A: Bẫy Cấu Trúc (Vol Spike hạ threshold xuống 2.0x để nhạy hơn với bẫy)
      const volRatio = avgVolume20 > 0 ? (lastClosedVolume / avgVolume20) : 1;
      const isVolSpike = volRatio > 2.0;

      // 2. CỤM B: Bằng Chứng Vi Cấu Trúc & Dòng Lệnh
      const isToxic = (vpinValue || 0) > 0.45; // Dòng lệnh độc hại, Smart Money đang gom/xả chủ động
      const isObiBullish = obi > 0.65;         // Tường Limit Buy cực dày chặn dưới
      const isObiBearish = obi < 0.35;         // Tường Limit Sell cực dày đè trên

      // 3. CỤM C: Áp Lực Phái Sinh (Kết hợp điều kiện từ L1)
      const isFundingSqueezeLongs = fundingSlope > 0.05 && l1.includes("Range");
      const isFundingSqueezeShorts = fundingSlope < -0.05 && l1.includes("Range");
      // TÍNH TOÁN CÚ SỐC THANH LÝ (LIQUIDATION CASCADE)
      const isShortSqueeze = autoData.liqShortsVol > (autoData.lastClosedVolume * 0.3); // Bọn Short cháy bằng 30% vol 1 nến
      const isLongFlush = autoData.liqLongsVol > (autoData.lastClosedVolume * 0.3); // Bọn Long cháy bằng 30% vol 1 nến

      let l3 = "Quiet";
      let liqSeverity = 0; 

      // QUÉT THANH KHOẢN (SWEEP) KẾT HỢP DỮ LIỆU CHÁY TÀI KHOẢN THỰC
      if (isBullishSFP || isLongFlush) {
          if (isObiBullish || isToxic) { l3 = "Institutional Sweep Low (Flush)"; liqSeverity = 100; } 
          else { l3 = "Sweep Low"; liqSeverity = 70; }
      } 
      else if (isBearishSFP || isShortSqueeze) {
          if (isObiBearish || isToxic) { l3 = "Institutional Sweep High (Squeeze)"; liqSeverity = 100; } 
          else { l3 = "Sweep High"; liqSeverity = 70; }
      }
      
      // ƯU TIÊN 2: BẪY PHÁI SINH (SQUEEZE)
      else if (isFundingSqueezeLongs) {
          l3 = "Longs Trapped (Squeeze)";
          liqSeverity = isToxic ? 90 : 70; // Nếu dính thêm thao túng dòng lệnh -> Rất tàn khốc
      } 
      else if (isFundingSqueezeShorts) {
          l3 = "Shorts Trapped (Squeeze)";
          liqSeverity = isToxic ? 90 : 70;
      }
      
      // ƯU TIÊN 3: ĐỘT PHÁ & ĐIỂM CHẶN (BREAKOUT & CLIMAX)
      else if (isVolSpike) {
          const priceUp = currentPrice > ema20.value;
          
          if (l2 === "Expansion") {
              // Valid Chéo L2: Breakout cần Dải băng mở rộng (L2 Expansion) VÀ Sổ lệnh (OBI) không được chặn ngược chiều
              if (priceUp && !isObiBearish) { l3 = "Valid Breakout"; liqSeverity = 80; }
              else if (!priceUp && !isObiBullish) { l3 = "Valid Breakdown"; liqSeverity = 80; }
              else { l3 = "Fakeout (Blocked by OBI)"; liqSeverity = 50; } // Breakout giả vì đâm vào Tường Sổ Lệnh
          } 
          else {
              // Vol nổ lớn nhưng dải băng (L2) không mở toác -> Báo hiệu sự chốt lời hàng loạt / Stop hunt
              l3 = "Stop Hunt / Climax";
              liqSeverity = 85;
          }
      }

      return { l3, liqSeverity, isToxic, volRatio };
  },

  // --- HỆ THỐNG CHẤM ĐIỂM TRỰC GIAO L4 (POSITIONING & SMART MONEY) ---
  evaluateL4: (autoData, apiMacro) => {
      const { currentPrice, ema20, oiDelta, atrRank, lastClosedVolume, avgVolume20 } = autoData;
      const { takerBuySellRatio, lsPositionVolRatio } = apiMacro;

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
                  l4 = "Smart Money Long Building"; posScore = 100;
              } else if (!isTakerBuying && isTopTraderShort) {
                  // Đám đông mua Taker fomo, Cá mập đang đè Limit Sell
                  l4 = "Retail Long Building (Trap Risk)"; posScore = -50; 
              } else {
                  l4 = "Mixed Long Building"; posScore = 30;
              }
          } else {
              // Kịch bản: Bơm tiền + Giá giảm (Xây Short)
              if (isTakerSelling && isTopTraderShort) {
                  l4 = "Smart Money Short Building"; posScore = -100;
              } else if (!isTakerSelling && isTopTraderLong) {
                  // Đám đông bán fomo, Cá mập đang hứng Limit Buy
                  l4 = "Retail Short Building (Trap Risk)"; posScore = 50; 
              } else {
                  l4 = "Mixed Short Building"; posScore = -30;
              }
          }
      } 
      else if (isOiDropping) {
          if (isPriceUp) {
              // Tiền rút + Giá Tăng = Bọn Short hoảng loạn phải mua lại
              l4 = "Short Covering (Squeeze)"; posScore = 40; // Lực nảy không bền vì tiền thực đang rút
          } else {
              // Tiền rút + Giá Giảm = Bọn Long hoảng loạn bị thanh lý
              l4 = "Long Liquidation (Flush)"; posScore = -40;
          }
      }

      // ƯU TIÊN TUYỆT ĐỐI: SỰ KIỆN ĐẦU HÀNG (CAPITULATION OVERRIDE)
      const isVolSpike = lastClosedVolume > (avgVolume20 * 2.5);
      if (isVolSpike && isOiDropping && atrRank > 90) {
          // Nổ Volume + OI bốc hơi + Biến động biên độ cực đại -> Sự kiện Đầu hàng
          if (isPriceUp) {
              l4 = "Short Capitulation / Blow-off Top"; 
              posScore = -80; // Bọn short cháy sạch đẩy giá vọt lên đỉnh, chuẩn bị đảo chiều Rớt
          } else {
              l4 = "Long Capitulation / Flush Bottom"; 
              posScore = 80;  // Bọn long cháy sạch đẩy giá chọc gậy đáy, chuẩn bị đảo chiều Tăng
          }
      }

      return { l4, posScore, isOiSurging, isOiDropping, isTakerBuying, isTakerSelling };
  },

  // --- HỆ THỐNG CHẤM ĐIỂM TRỰC GIAO L5 (MOMENTUM & EXHAUSTION) ---
  evaluateL5: (autoData) => {
      // ĐÃ SỬA: Lấy cvdTrend, currentPrice và htfSma200 thay cho OBV
      const { rsi, cmf, adx, cvdTrend, currentPrice, htfSma200 } = autoData;

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
      if (adx < 20) trendMultiplier = 0.5;
      else if (adx > 30) trendMultiplier = 1.2;

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
      else if (rsi >= 75) l5 = "Overbought Exhaustion";
      else if (rsi <= 25) l5 = "Oversold Exhaustion";
      
      // Mức 4: Động Lượng Chân Chính (Đã được Dòng tiền và ADX bảo chứng)
      else if (momScore >= 60) l5 = "Strong Bullish";
      else if (momScore <= -60) l5 = "Strong Bearish";
      else if (momScore >= 20) l5 = "Moderate Bullish";
      else if (momScore <= -20) l5 = "Moderate Bearish";

      return { l5, momScore, baseMom, isTrap };
  },

  // --- HỆ THỐNG CHẤM ĐIỂM TRỰC GIAO L6 (MACRO & ALPHA MATRIX) ---
  evaluateL6: (autoData, mvrvZScore, symbol) => {
      const { btcDomValue, btcDomSlope, isi, amihud } = autoData;
      const isAltcoin = symbol !== 'BTCUSDT';

      // 1. CỤM A: Định Giá Vĩ Mô (Macro Valuation)
      let mvrvDesc = "Fair value";
      let valScore = 0; // -100 (Bong bóng) tới +100 (Tích lũy)
      if (mvrvZScore > 3.5) { mvrvDesc = "Bong bóng"; valScore = -100; }
      else if (mvrvZScore >= 2.5) { mvrvDesc = "Định giá cao"; valScore = -50; }
      else if (mvrvZScore >= 1.0) { mvrvDesc = "Bình thường - Khá cao"; valScore = -10; }
      else if (mvrvZScore >= 0.8) { mvrvDesc = "Bình thường - Rẻ"; valScore = 50; }
      else { mvrvDesc = "Vùng tích lũy"; valScore = 100; }

      // 2. CỤM B: Trọng Lực Dòng Vốn (Capital Gravity)
      let isAltcoinBleeding = false;
      let isAltcoinSeason = false;
      let domScore = 0; // Điểm âm = Tiền rút khỏi Altcoin, Điểm dương = Tiền bơm vào Altcoin
      
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
      
      // XÁC NHẬN CHÉO: Altcoin phản ứng trễ (isi < -0.1) + BTC Dom đang có biến động + Thanh khoản tốt (amihud < 1.5)
      if (isAltcoin && isi < -0.10 && Math.abs(btcDomSlope) > 0.2 && amihud < 1.5) {
          isLeadLagArb = true;
          lagScore = 100; // Cơ hội Arbitrage thông tin hoàn hảo (Khả năng Win cực cao)
      } else if (isi > 0.5) {
          lagScore = -20; // Quá đồng pha với BTC, không có lợi thế thông tin
      }

      // TỔNG HỢP MACRO SCORE
      const macroScore = (valScore * 0.40) + (domScore * 0.35) + (lagScore * 0.25);

      // PHÂN LOẠI L6 (Chuẩn hóa nhãn để HUD hiển thị gọn gàng)
      let l6 = "Fair Value";
      if (mvrvZScore > 2.5) l6 = "Overvaluation Risk";
      else if (mvrvZScore < 1.0) l6 = "Accumulation Zone";

      if (isAltcoinBleeding) l6 += " | Bleeding (Danger)";
      else if (isAltcoinSeason) l6 += " | Alt Season (Tailwind)";
      
      if (isLeadLagArb) l6 += " | ⚡ Lead-Lag Arb";

      return { l6, macroScore, mvrvDesc, isAltcoinBleeding, isAltcoinSeason, isLeadLagArb };
  },

  // --- GOM CHUNG KIẾN TRÚC VECTOR LƯỢNG TỬ (L1 -> L6) ---
  evaluateVectorState: (autoData, apiMacro, mvrvZScore, symbol) => {
    
    // L1: Cấu trúc & Động năng
    const l1Data = QuantMath.evaluateL1(autoData);
    let l1 = l1Data.l1;

    // L2: Độ Biến Động & Nén
    const l2Data = QuantMath.evaluateL2(autoData);
    let l2 = l2Data.l2;

    // L3: Sự kiện Thanh khoản & Bẫy (Đã xác nhận chéo bằng Vi Cấu Trúc)
    const l3Data = QuantMath.evaluateL3(autoData, l1, l2);
    let l3 = l3Data.l3;

    // L4: Định vị Dòng tiền & Smart Money Footprint
    const l4Data = QuantMath.evaluateL4(autoData, apiMacro);
    let l4 = l4Data.l4;

    // L5: Động lượng Giá & Dòng Tiền (Dùng Multiplier và Phân kỳ)
    const l5Data = QuantMath.evaluateL5(autoData);
    let l5 = l5Data.l5;

    // L6: Định giá Vĩ mô & Ma sát Lead-Lag (MỚI TÍCH HỢP)
    const l6Data = QuantMath.evaluateL6(autoData, mvrvZScore, symbol);
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
            l1, l2, l3, l4, l5, l6, 
            mvrvDesc: l6Data.mvrvDesc, 
            isAltcoinBleeding: l6Data.isAltcoinBleeding, 
            isAltcoinSeason: l6Data.isAltcoinSeason,
            isLeadLagArb: l6Data.isLeadLagArb, // Chuyển tên biến l7 cũ thành tính năng
            
            // XUẤT CÁC CHỈ SỐ ĐIỂM SỐ NỘI TẠI ĐỂ LOGIC GATES SỬ DỤNG VỀ SAU
            sTrend: l1Data.sTrend,
            volScore: l2Data.volScore,
            liqSeverity: l3Data.liqSeverity,
            posScore: l4Data.posScore,
            momScore: l5Data.momScore,
            macroScore: l6Data.macroScore
        } 
    };
  },
  
  trueRange: (h, l, pc) => Math.max(h - l || 0, Math.abs(h - pc) || 0, Math.abs(l - pc) || 0),
  
  atr: (highs, lows, closes, period) => {
    if (!closes || closes.length < period + 1 || highs.length !== closes.length) return 0;
    let trs = [];
    for (let i = 1; i < closes.length; i++) {
      trs.push(QuantMath.trueRange(highs[i], lows[i], closes[i-1]));
    }
    let currentAtr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      currentAtr = ((currentAtr * (period - 1)) + trs[i]) / period; 
    }
    return currentAtr || 0;
  },
  
  adx: (highs, lows, closes, period = 14) => {
    if (!closes || closes.length < period * 2) return 0;
    let trs = [], plusDMs = [], minusDMs = [];
    for (let i = 1; i < closes.length; i++) {
      trs.push(QuantMath.trueRange(highs[i], lows[i], closes[i-1]));
      const upMove = highs[i] - highs[i-1];
      const downMove = lows[i-1] - lows[i];
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    let smoothedTR = trs.slice(0, period).reduce((a,b)=>a+b,0);
    let smoothedPlusDM = plusDMs.slice(0, period).reduce((a,b)=>a+b,0);
    let smoothedMinusDM = minusDMs.slice(0, period).reduce((a,b)=>a+b,0);
    
    let dxs = [];
    for (let i = period; i < trs.length; i++) {
      smoothedTR = smoothedTR - (smoothedTR/period) + trs[i];
      smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM/period) + plusDMs[i];
      smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM/period) + minusDMs[i];
      const plusDI = 100 * (smoothedPlusDM / smoothedTR);
      const minusDI = 100 * (smoothedMinusDM / smoothedTR);
      const dx = 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1);
      dxs.push(dx || 0);
    }
    
    let adx = dxs.slice(0, period).reduce((a,b)=>a+b,0) / period;
    for (let i = period; i < dxs.length; i++) {
      adx = ((adx * (period - 1)) + dxs[i]) / period; 
    }
    return adx || 0;
  },
  
  rsi: (closes, period = 14) => {
    if (!closes || closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i-1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i-1];
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  },
  
  bollinger: (closes, period = 20, stdDev = 2) => {
    if (!closes || closes.length < period) return { bbw: 0, upper: 0, lower: 0, sma: 0 };
    const slice = closes.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
    const dev = Math.sqrt(variance);
    const upper = sma + (stdDev * dev);
    const lower = sma - (stdDev * dev);
    const bbw = ((upper - lower) / sma) * 100; 
    return { bbw, upper, lower, sma };
  },

  percentileRank: (currentValue, historicalArray) => {
    if (!historicalArray || historicalArray.length === 0) return 50;
    const belowCount = historicalArray.filter(val => val < currentValue).length;
    return (belowCount / historicalArray.length) * 100;
  },
  
  obv: (closes, volumes) => { 
    if (!closes || closes.length < 2) return 0;
    let obv = 0;
    for (let j = 1; j < closes.length; j++) {
      if (closes[j] > closes[j-1]) obv += volumes[j];
      else if (closes[j] < closes[j-1]) obv -= volumes[j];
    }
    return obv;
  },

  cmf: (highs, lows, closes, volumes, period = 20) => { 
    if (!closes || closes.length < period) return 0;
    let mfValues = [];
    for (let j = 0; j < closes.length; j++) {
      const clv = ((closes[j] - lows[j]) - (highs[j] - closes[j])) / (highs[j] - lows[j] || 1);
      mfValues.push(clv * volumes[j]);
    }
    const recentMfSum = mfValues.slice(-period).reduce((a, b) => a + b, 0);
    const recentVolSum = volumes.slice(-period).reduce((a, b) => a + b, 0);
    return recentMfSum / (recentVolSum || 1);
  },
  
  costDrag: (entryPrice, tradeType, direction, entryExecution, exitExecution, fundingRate, spreadPercent, holdingCycles = 1, makerFee = 0.0002, takerFee = 0.0004, interval = '1h', obi = 0.5) => { 
    let slippagePenalty = 0;
    if (entryExecution === 'MARKET') {
        if (direction === 'LONG' && obi < 0.4) slippagePenalty = 0.0015; 
        if (direction === 'SHORT' && obi > 0.6) slippagePenalty = 0.0015; 
    }
    const entrySlippage = entryExecution === 'MARKET' ? (0.001 + slippagePenalty) : 0; 
    const entryFee = entryExecution === 'MARKET' ? takerFee : makerFee;
    
    const exitSlippage = exitExecution === 'MARKET' ? 0.001 : 0; 
    const exitFee = exitExecution === 'MARKET' ? takerFee : makerFee;

    const spreadCost = (spreadPercent / 100) / 2;
    
    const intervalToHours = { '5m': 5/60, '15m': 15/60, '1h': 1, '4h': 4, '1d': 24 }; 
    const hoursPerCandle = intervalToHours[interval] || 1;
    const totalHoldingHours = holdingCycles * hoursPerCandle;
    const realFundingCycles = totalHoldingHours / 8; 
    
    let fundingImpact = 0;
    if (tradeType === 'FUTURES') {
       if (direction === 'LONG') {
           fundingImpact = fundingRate * realFundingCycles; 
       } else {
           fundingImpact = -fundingRate * realFundingCycles; 
       }
    }
    
    const entryCostPerCoin = (entrySlippage + entryFee + spreadCost) * entryPrice;
    const exitCostPerCoin = (exitSlippage + exitFee + spreadCost) * entryPrice;

    return entryCostPerCoin + exitCostPerCoin + (fundingImpact * entryPrice); 
  },

  trueEV: (winRate, reward, lossRate, risk) => {
     return (winRate * reward) - (lossRate * risk);
  },
  
  // NÂNG CẤP 1: Bắt bài "Đuôi Béo" (Fat-Tails) với Volatility-Adjusted Fractional Kelly
  // Thêm tham số atrRank (để đo lường mức độ biến động hiện tại)
  kellyCriterion: (winRate, historicalAvgRR, nTrades = 0, atrRank = 50) => {
    if (nTrades < 5) return 0.02; 
    if(winRate === 0 || historicalAvgRR === 0) return 0.01; 
    
    const fullKelly = winRate - ((1 - winRate) / historicalAvgRR);
    let halfKelly = Math.max(0, fullKelly * 0.5); 
    if (nTrades < 30) {
      const penalty = Math.max(0.15, nTrades / 30); 
      halfKelly = halfKelly * penalty;
    }

    // Co dãn tỷ lệ Kelly theo hàm mũ để chống Thiên nga đen (Black Swans)
    // Nếu biến động quá lớn (atrRank cao), tỷ lệ Kelly sẽ tự động teo nhỏ lại.
    const dynamicKelly = halfKelly * Math.exp(-(atrRank / 100));
    
    return dynamicKelly;
  },

  scanEmaRange: (closesArray, fastPeriod, slowPeriod, lookback = 20, atrValue = 0) => {
      if (!closesArray || closesArray.length < Math.max(fastPeriod, slowPeriod) + lookback) {
         return { fastEmaCurrent: 0, slowEmaCurrent: 0, fastSlope: 0, slowSlope: 0, isCrossBull: false, isCrossBear: false, spreadPercent: 0, normFastSlope: 0, normSlowSlope: 0 };
      }
      const fastEmaCurrent = QuantMath.ema(closesArray, fastPeriod);
      const slowEmaCurrent = QuantMath.ema(closesArray, slowPeriod);
      
      const pastCloses = closesArray.slice(0, -lookback);
      const fastEmaPast = QuantMath.ema(pastCloses, fastPeriod);
      const slowEmaPast = QuantMath.ema(pastCloses, slowPeriod);

      const fastSlope = fastEmaPast > 0 ? ((fastEmaCurrent - fastEmaPast) / fastEmaPast) * 100 : 0;
      const slowSlope = slowEmaPast > 0 ? ((slowEmaCurrent - slowEmaPast) / slowEmaPast) * 100 : 0;
      
      const normFastSlope = (atrValue > 0 && fastEmaPast > 0) ? (fastEmaCurrent - fastEmaPast) / atrValue : fastSlope;
      const normSlowSlope = (atrValue > 0 && slowEmaPast > 0) ? (slowEmaCurrent - slowEmaPast) / atrValue : slowSlope;

      const isCrossBull = (fastEmaPast < slowEmaPast) && (fastEmaCurrent > slowEmaCurrent);
      const isCrossBear = (fastEmaPast > slowEmaPast) && (fastEmaCurrent < slowEmaCurrent);
      
      const spreadPercent = slowEmaCurrent > 0 ? Math.abs(fastEmaCurrent - slowEmaCurrent) / slowEmaCurrent * 100 : 0;

      return { fastEmaCurrent, slowEmaCurrent, fastSlope, slowSlope, isCrossBull, isCrossBear, spreadPercent, normFastSlope, normSlowSlope };
  },
  
  detectSFP_Advanced: (highs, lows, closes, volumes, avgVolume, direction) => {
    if (!closes || closes.length < 10 || !volumes) return false;
    const triggerIndex = closes.length - 2; 
    const triggerClose = closes[triggerIndex];
    const triggerHigh = highs[triggerIndex];
    const triggerLow = lows[triggerIndex];
    const triggerVol = volumes[triggerIndex];

    if (triggerVol < avgVolume * 1.2) return false;

    let lastPivotHigh = -1;
    let lastPivotLow = Infinity;

    for (let j = triggerIndex - 3; j >= 2; j--) {
        if (highs[j] > highs[j-1] && highs[j] > highs[j-2] && 
            highs[j] > highs[j+1] && highs[j] > highs[j+2]) {
            lastPivotHigh = highs[j];
            break; 
        }
    }

    for (let j = triggerIndex - 3; j >= 2; j--) {
        if (lows[j] < lows[j-1] && lows[j] < lows[j-2] && 
            lows[j] < lows[j+1] && lows[j] < lows[j+2]) {
            lastPivotLow = lows[j];
            break;
        }
    }

    if (direction === 'SHORT') {
        return (lastPivotHigh !== -1 && triggerHigh > lastPivotHigh && triggerClose < lastPivotHigh);
    } else {
        return (lastPivotLow !== Infinity && triggerLow < lastPivotLow && triggerClose > lastPivotLow);
    }
  },

  detectSFP_Institutional_Advanced: (highs, lows, closes, opens, volumes, avgVolume, atrValue, direction, lookback = 20) => {
      if (!closes || closes.length < lookback || !volumes) return false;
      const i = closes.length - 2; 
      if (i < lookback) return false;

      const currentHigh = highs[i];
      const currentLow = lows[i];
      const currentClose = closes[i];
      const currentOpen = opens[i];
      const currentVol = volumes[i];

      if (currentVol < avgVolume * 1.2) return false;

      const lookbackHighs = highs.slice(i - lookback, i);
      const lookbackLows = lows.slice(i - lookback, i);
      const pivotHigh = Math.max(...lookbackHighs);
      const pivotLow = Math.min(...lookbackLows);

      const candleLength = currentHigh - currentLow;
      if (candleLength < atrValue * 0.5) return false;

      const upperWick = currentHigh - Math.max(currentOpen, currentClose);
      const lowerWick = Math.min(currentOpen, currentClose) - currentLow;

      if (direction === 'SHORT') {
          const isWickSignificant = (upperWick / candleLength) >= 0.5;
          const isSweepingPivot = currentHigh > pivotHigh;
          const isClosingBelow = currentClose < pivotHigh;
          return isWickSignificant && isSweepingPivot && isClosingBelow;
      } else {
          const isWickSignificant = (lowerWick / candleLength) >= 0.5;
          const isSweepingPivot = currentLow < pivotLow;
          const isClosingAbove = currentClose > pivotLow;
          return isWickSignificant && isSweepingPivot && isClosingAbove;
      }
  },

  // CHỮ KÝ HÀM MỚI: Tích hợp đầy đủ AutoData, ApiMacro và VectorDetails
  dynamicAsymmetricTargets: (autoData, apiMacro, vectorDetails, direction, aiModel, assetTier = 'Tier 2') => {
      // 1. GIẢI NÉN MA TRẬN VECTOR (Orthogonal Vectors)
      const { 
          currentPrice, atr14, atrPercent, bbwRank,
          currentVolume, avgVolume20, cmf, vpinValue, amihud, isi, 
          btcDomSlope, fundingRate, oiDelta, msbState, 
          isBullishSFP, isBearishSFP, adx, macd, ema20, htfSma200
      } = autoData;
      
      const { obi } = apiMacro;
      const { l1, l3, l6 } = vectorDetails;

      const isLong = direction === 'LONG';
      const sfpTriggered = isLong ? isBullishSFP : isBearishSFP;

      // 2. TẢI CẤU HÌNH BAYESIAN TỪ AI MODEL
      const baseSlMult = aiModel?.dynamic_targets?.optimized?.slMult || 1.5;
      const baseTpMult = aiModel?.dynamic_targets?.optimized?.tpMult || 3.0;

      let slMult = baseSlMult; 
      let tpMult = baseTpMult;
      let strategyName = "🤖 AI ADAPTIVE (STANDARD)";
      let execType = 'LIMIT';
      let suggestedEntry = currentPrice;

      // ==========================================
      // BỘ ĐIỀU HƯỚNG MÔI TRƯỜNG & PHÂN LỚP TÀI SẢN
      // ==========================================
      let tierTpModifier = 1.0;
      let tierSlModifier = 1.0;
      
      if (assetTier.includes('Tier 1') || assetTier.includes('Tier 2')) {
          tierTpModifier = 0.7; // Coin hóa lớn MFE kém -> Hạ TP dễ khớp
          tierSlModifier = 1.2; // Râu quét sâu -> Nới SL chống Shakeout
      } else if (assetTier.includes('Tier 4')) {
          tierTpModifier = 1.3; // Coin rác rủi ro cao -> Cần Reward lớn (Nới TP)
          tierSlModifier = 1.3; // Gãy trend là rơi tự do -> Siết SL cắt máu sớm
      }

      const noiseBuffer = atrPercent > 2.0 ? 0.2 : 0;
      let regimeTpMultiplier = 1.0;
      if (l1.includes('Range')) regimeTpMultiplier = 0.7; 
      else if (l1.includes('Trend')) regimeTpMultiplier = 1.3; 

      if (isLong && (l6.includes('Accumulation') || l6.includes('Tailwind'))) {
          regimeTpMultiplier *= 1.25; // Vĩ mô ủng hộ phe Long -> Nuôi mập Target
      }

      // =======================================================================
      // NÃO BỘ HỆ SINH THÁI CHIẾN THUẬT BẤT ĐỐI XỨNG
      // =======================================================================

      // ⚡ 1. ĐỘ TRỄ THÔNG TIN PHÂN TẦNG (Cross-Market Lag Arbitrage)
      // Vector: Trễ nhịp (ISI) + Dòng lệnh sạch (VPIN) + Cấu trúc đồng pha (MSB)
      if (isi < -0.10 && vpinValue < 0.05 && ((isLong && msbState === 'Bullish_MSB') || (!isLong && msbState === 'Bearish_MSB'))) { 
          tpMult = baseTpMult * 1.5 * regimeTpMultiplier;
          slMult = Math.max(1.2, baseSlMult * 1.0 + noiseBuffer);
          strategyName = "⚡ LEAD-LAG ARBITRAGE (X-MARKET)";
          execType = 'MARKET'; // Đua tốc độ chênh lệch Arbitrage
          suggestedEntry = currentPrice;
      }
      
      // 🌪️ 2. SỰ KIỆN THANH LÝ NGẦM (Hidden Liquidation Squeeze)
      // BẮT BUỘC LONG: Bọn Retail đang Short (Funding âm) nhưng Dòng tiền thực đang gom (CMF dương) ở vùng Nén
      else if (isLong && fundingRate < 0 && oiDelta > 0 && cmf > 0.05 && bbwRank < 30) {
          tpMult = baseTpMult * 2.5 * regimeTpMultiplier; // Bóp nát phe Short -> Giá nổ cực đại
          slMult = Math.max(0.8, baseSlMult * 0.8 + noiseBuffer);
          strategyName = "🌪️ KINETIC SQUEEZE (BEAR TRAP)";
          execType = 'LIMIT';
          suggestedEntry = currentPrice - (0.1 * atr14); // Kê sát giá hiện tại để không lỡ tàu Squeeze
      }

      // 🧲 3. HỘI CHỨNG TẮC NGHẼN ĐỘNG NĂNG (Kinetic Exhaustion)
      // BẮT BUỘC SHORT: Động lượng gãy (MACD âm) + Dòng lệnh độc hại (VPIN) ở vùng cạn thanh khoản (Amihud)
      else if (!isLong && macd.hist < 0 && vpinValue > 0.06 && amihud > 0.5 && bbwRank > 75) {
          tpMult = baseTpMult * 1.5 * regimeTpMultiplier;
          slMult = Math.max(1.5, baseSlMult * 1.2 + noiseBuffer); 
          strategyName = "🧲 GAMMA EXHAUSTION (CRASH)";
          execType = 'LIMIT';
          suggestedEntry = currentPrice + (0.5 * atr14); // Mặc cả giá lên vùng Extreme
      }

     // 🎯 4. BẪY THANH KHOẢN (LIQ-FLUSH SYNERGY)
        else if (isLong && 
                (sfpTriggered || autoData.liqLongsVol > avgVolume20 * 0.1) && 
                currentPrice < autoData.vwapLower && 
                autoData.obi > 0.65 && // 🚀 VÁ LỖI: Đã đổi dynamicObi thành autoData.obi
                vpinValue < 0.05 && 
                amihud < 1.0) {
            
            tpMult = baseTpMult * 2.5 * regimeTpMultiplier; 
            slMult = Math.max(1.0, baseSlMult * 0.8 + noiseBuffer); 
            strategyName = "🎯 LIQ-FLUSH SYNERGY (WHALE WALL)";
            execType = 'LIMIT';
            suggestedEntry = currentPrice; 
        }

      // 🤖 5. TIÊU CHUẨN (AI ADAPTIVE) - ĐÃ BẤT ĐỐI XỨNG HÓA
      else {
          if (!isLong) {
              if (l1.includes('Strong Trend') || l1.includes('Trend Up')) {
                  execType = 'LIMIT';
                  suggestedEntry = currentPrice + (0.8 * atr14); // Short Counter-Trend -> Mặc cả giá cao
                  slMult = Math.max(0.8, baseSlMult * 0.7); 
                  strategyName = "🤖 ADAPTIVE SHORT (COUNTER-TREND)";
              } else {
                  execType = 'MARKET'; 
                  suggestedEntry = currentPrice;
                  strategyName = "🤖 ADAPTIVE SHORT (STANDARD)";
              }
          } else {
              if (l1.includes('Strong Trend')) {
                  execType = 'MARKET'; // FOMO Thuận bão
                  suggestedEntry = currentPrice;
                  strategyName = "🤖 ADAPTIVE LONG (MOMENTUM)";
              } else if (l1.includes('Trend')) {
                  execType = 'LIMIT';  
                  suggestedEntry = currentPrice - (0.5 * atr14);
                  strategyName = "🤖 ADAPTIVE LONG (PULLBACK)";
              } else {
                  execType = 'LIMIT'; 
                  suggestedEntry = currentPrice - (0.8 * atr14); // Range Market -> Đón đáy biên dưới
                  strategyName = "🤖 ADAPTIVE LONG (RANGE)";
              }
          }
      }
      
      slMult = Math.max(0.8, slMult * tierSlModifier); 
      tpMult = Math.max(tpMult * tierTpModifier, slMult * 1.5); // Chống RR < 1.5

      return { tpMult, slMult, strategyName, execType, suggestedEntry };
  },


  estimateLiquidation: (notionalUSD, leverage, entry, direction, brackets) => {
    if (!brackets || brackets.length === 0 || !leverage) return null;
    const tier = brackets.find(b => notionalUSD >= b.notionalFloor && notionalUSD < b.notionalCap) 
                 || brackets[brackets.length - 1]; 
    const mmr = tier.maintMarginRatio;
    const maxLevForTier = tier.initialLeverage; 

    const liqPrice = direction === 'LONG'
      ? entry * (1 - (1 / leverage) + mmr)
      : entry * (1 + (1 / leverage) - mmr);

    return { liqPrice, mmr, maxLevForTier, bracket: tier.bracket };
  },

  classifyAssetTier: (symbol, usdVolume24h, realSpreadPct) => {
    const tier1Macros = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
    if (tier1Macros.includes(symbol)) return "Tier 1: Macro";
    
    if (usdVolume24h >= 50000000 && realSpreadPct <= 0.03) {
        return "Tier 2: Liquid Majors";
    }
    if (usdVolume24h >= 10000000 && realSpreadPct <= 0.06) {
        return "Tier 3: Mid-Cap Equities";
    }
    return "Tier 4: Nano/Illiquid";
  },
  
  cusumFilter: (returns, threshold) => {
    if (!returns || returns.length === 0) return { sp: 0, sn: 0, isTriggered: false };
    let sp = 0; 
    let sn = 0; 
    let isTriggered = false;

    for (let i = 0; i < returns.length; i++) {
        sp = Math.max(0, sp + returns[i]);
        sn = Math.min(0, sn + returns[i]);
        
        if (sp >= threshold || sn <= -threshold) {
            isTriggered = true;
        }
    }
    return { sp, sn, isTriggered };
  },

  vpin: (buyVols, sellVols, totalVols, lookback = 50) => {
      if (!buyVols || !sellVols || !totalVols || buyVols.length < lookback) return 0;
      let orderImbalanceSum = 0;
      let totalVolumeSum = 0;

      const startIdx = buyVols.length - lookback;
      for (let i = startIdx; i < buyVols.length; i++) {
          orderImbalanceSum += Math.abs(sellVols[i] - buyVols[i]);
          totalVolumeSum += totalVols[i];
      }
      return totalVolumeSum > 0 ? orderImbalanceSum / totalVolumeSum : 0;
  },

  rollMeasure: (priceDeltas) => {
      if (!priceDeltas || priceDeltas.length < 3) return 0;
      let meanDelta1 = 0, meanDelta2 = 0;
      const n = priceDeltas.length - 1;
      
      let d1 = [], d2 = [];
      for(let i = 1; i <= n; i++) {
          d1.push(priceDeltas[i]);
          d2.push(priceDeltas[i-1]);
          meanDelta1 += priceDeltas[i];
          meanDelta2 += priceDeltas[i-1];
      }
      meanDelta1 /= n; meanDelta2 /= n;

      let covariance = 0;
      for(let i = 0; i < n; i++) {
          covariance += (d1[i] - meanDelta1) * (d2[i] - meanDelta2);
      }
      covariance /= (n - 1);

      return 2 * Math.sqrt(Math.abs(covariance));
  },

  // NÂNG CẤP 2: Hiệu chỉnh Amihud Illiquidity (Log-Transformation)
  // Sử dụng logarit tự nhiên để nén các cú spike volume xuống, chống nhiễu từ Wash Trading
  amihudIlliquidity: (returns, volumes) => {
      if (!returns || !volumes || returns.length !== volumes.length) return 0;
      let sumIlliq = 0;
      let count = 0;
      for (let i = 0; i < returns.length; i++) {
          const dollarVolume = volumes[i]; 
          if (dollarVolume > 0) {
              // Sử dụng Math.log(1 + dollarVolume) để làm mượt mẫu số
              sumIlliq += Math.abs(returns[i]) / (Math.log(1 + dollarVolume) + 0.0001);
              count++;
          }
      }
      // Bỏ việc nhân 1e6 vì Log-transformation đã đưa con số về một scale hợp lý
      return count > 0 ? (sumIlliq / count) : 0; 
  },

  pearsonCorrelation: (x, y) => {
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
      const minLength = Math.min(x.length, y.length);
      if (minLength < 2) return 0;
      for (let i = 0; i < minLength; i++) {
          sumX += x[i]; sumY += y[i];
          sumXY += x[i] * y[i];
          sumX2 += x[i] * x[i]; sumY2 += y[i] * y[i];
      }
      const num = (minLength * sumXY) - (sumX * sumY);
      const den = Math.sqrt(((minLength * sumX2) - (sumX * sumX)) * ((minLength * sumY2) - (sumY * sumY)));
      return den === 0 ? 0 : num / den;
  },

  immediateSensitivityIndicator: (altReturns, btcReturns, lagPeriods = 5) => {
      if (!altReturns || !btcReturns || altReturns.length < lagPeriods + 1) return 0;
      const corr0 = QuantMath.pearsonCorrelation(altReturns, btcReturns);
      
      let sumLagCorr = 0;
      for (let i = 1; i <= lagPeriods; i++) {
          const shiftedBtc = btcReturns.slice(0, -i);
          const currentAlt = altReturns.slice(i);
          sumLagCorr += QuantMath.pearsonCorrelation(currentAlt, shiftedBtc);
      }
      return corr0 - (sumLagCorr / lagPeriods);
  },

  // THUẬT TOÁN XÁC ĐỊNH MSB & CHOCH (Loại bỏ nhiễu SFP)
  detectMarketStructure: (highs, lows, closes, lookback = 20) => {
      let swingHighs = [];
      let swingLows = [];
      
      // 1. Tìm các Swing Points (Đỉnh/Đáy cục bộ)
      for (let i = 2; i < closes.length - 2; i++) {
          if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
              swingHighs.push({ index: i, price: highs[i] });
          }
          if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
              swingLows.push({ index: i, price: lows[i] });
          }
      }

      // Sửa tại file src/core/QuantMath.js
        if (swingHighs.length < 2 || swingLows.length < 2) {
            return { regime: 'Sideways', msbState: 'None', sfp: false }; // Đổi 'msb' thành 'msbState'
        }

      const lastSH = swingHighs[swingHighs.length - 1];
      const prevSH = swingHighs[swingHighs.length - 2];
      const lastSL = swingLows[swingLows.length - 1];
      const prevSL = swingLows[swingLows.length - 2];
      
      const currentClose = closes[closes.length - 1];
      const currentHigh = highs[highs.length - 1];
      const currentLow = lows[lows.length - 1];

      let msbState = 'None';
      let isSFP = false;

      // 2. Phát hiện MSB Tăng (Bullish MSB / ChoCH)
      if (currentHigh > lastSH.price) {
          if (currentClose > lastSH.price) {
              msbState = 'Bullish_MSB'; // Phá vỡ cấu trúc giảm hợp lệ
          } else {
              isSFP = 'Bearish_SFP'; // Bẫy thanh khoản (Chỉ quét râu)
          }
      }

      // 3. Phát hiện MSB Giảm (Bearish MSB / ChoCH)
      if (currentLow < lastSL.price) {
          if (currentClose < lastSL.price) {
              msbState = 'Bearish_MSB'; // Phá vỡ cấu trúc tăng hợp lệ
          } else {
              isSFP = 'Bullish_SFP'; // Bẫy thanh khoản (Chỉ quét râu)
          }
      }

      // 4. Xác định Regime (HH/HL hay LH/LL)
      let regime = 'Range';
      if (lastSH.price > prevSH.price && lastSL.price > prevSL.price) regime = 'Uptrend';
      if (lastSH.price < prevSH.price && lastSL.price < prevSL.price) regime = 'Downtrend';

      return { regime, msbState, isSFP, lastSH, lastSL };
  },
    // THUẬT TOÁN ĐỊNH CỠ RÀO CẢN THỜI GIAN (TEMPORAL BARRIER V2 - ASYMMETRIC DECAY)
    calculateTemporalBarrier: (interval, tradeType, direction, vectorDetails, assetTier, currentHourUTC, strategyName = '') => {
        let baseCycles = 6; 

        // 1. CHỈNH BASE CYCLES THEO ĐẶC TÍNH PHÂN RÃ CỦA TỪNG CHIẾN THUẬT QUANTS
        const stratStr = String(strategyName).toUpperCase();
        
        if (stratStr.includes('LEAD-LAG')) {
            // Áp chênh lệch độ trễ: Tính bằng phút. Không chạy là mô hình sai. Thoát ngay!
            baseCycles = 3; 
        } else if (stratStr.includes('GAMMA EXHAUSTION')) {
            // Bắt dao rơi (Crash): Cần thêm 1 nhịp hồi (Bounce) để rũ hàng.
            baseCycles = 4; 
        } else if (stratStr.includes('KINETIC SQUEEZE') || stratStr.includes('QUANT-SFP')) {
            // Quét râu SFP hoặc chờ Nén: Cần thời gian tạo đáy chữ W hoặc tích lũy.
            baseCycles = 6; 
        } else if (stratStr.includes('ADAPTIVE')) {
            if (stratStr.includes('MOMENTUM')) {
                // Đánh thuận bão mạnh (Market Order): Bão phải đẩy giá đi ngay, ngâm lâu là đảo chiều.
                baseCycles = 5; 
            } else {
                // Pullback hoặc Range (Limit Order đón đáy/đỉnh): Đòi hỏi sự kiên nhẫn.
                baseCycles = 8; 
            }
        }

        // 2. CHỈNH THEO VOLATILITY (L2) - TRÁNH HIỆN TƯỢNG "PHẠT KÉP"
        // Chỉ trừ nến khi baseCycles đủ dài. Nếu đang bắt dao rơi (baseCycles = 3,4) thì cấm trừ thêm.
        if (vectorDetails.l2 === 'Extreme' || vectorDetails.l2 === 'Compression') {
            if (baseCycles > 5) {
                baseCycles -= 1; // Nén/Nổ thì chạy nhanh hơn bình thường một chút
            }
        }

        // 3. TIER MODIFIER (Tier vốn hóa quyết định thời gian MM rũ hàng)
        let tierModifier = 1.0;
        const tierStr = String(assetTier || "");
        if (tierStr.includes('Tier 1') || tierStr.includes('Tier 2')) {
            tierModifier = 1.2; // Coin Top, vốn hóa lớn, bò chậm -> Nới thời gian cho nó chạy
        } else if (tierStr.includes('Tier 4')) {
            tierModifier = 0.7; // Coin Lowcap rác, ngâm lâu là bị xả sập hầm -> Rút ngắn thời gian
        } 

        // 4. SESSION MODIFIER (Phiên giao dịch theo giờ UTC)
        let sessionModifier = 1.0;
        if (interval === '5m' || interval === '15m') {
            if (currentHourUTC >= 13 && currentHourUTC <= 21) sessionModifier = 0.8; // Mỹ (Vol cao) -> Chạy nhanh
            else if (currentHourUTC >= 0 && currentHourUTC <= 7) sessionModifier = 1.2; // Á (Vol thấp) -> Chạy chậm
        }
        
        let maxHoldingCycles = Math.round(baseCycles * sessionModifier * tierModifier);

        // CHỐT CHẶN SINH TỒN ABSOLUTE: Min 2 nến, Max 10 nến.
        return Math.max(2, Math.min(10, maxHoldingCycles)); 
    }
};

export default QuantMath;

=========================================
/// FILE: src/core/TradeValidator.js
=========================================

// FILE: src/core/TradeValidator.js

export const TradeValidator = {
  evaluateScore: (autoData, apiMacro, vectorDetails, direction, mvrvZScore, symbol, aiModel) => {
    if (!autoData || !apiMacro || !vectorDetails) return { score: 0, synergyText: "", penaltyText: "", checks: {}, checkScores: {}, w: {}, passingScore: 50 };
    
    const { l1, l2, l3, l4, l5, l6, sTrend, volScore, liqSeverity, posScore, momScore, macroScore } = vectorDetails;
    
    let totalScore = 0;
    let synergyText = "";
    let penaltyText = "";

    // 1. ÁP DỤNG TRỌNG SỐ TỪ AI MODEL
    const w = aiModel?.gate_weights || {};

    // 2. KHỚP HƯỚNG LỆNH VÀ TÍNH TRỌNG SỐ
    const dirMultiplier = direction === 'LONG' ? 1 : -1;

    // Lấy trọng số thực tế (Base Weights)
    const wTrend = 0.30 * (w.s1 || w.sTrend || 1.0);
    const wMom   = 0.25 * (w.s4 || w.mom || 1.0);
    const wPos   = 0.20 * (w.s5 || w.pos || 1.0);
    const wLiq   = 0.15 * (w.s3 || w.liq || 1.0);
    const wMacro = 0.10 * (w.s8 || w.macro || 1.0);

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

    if (isMsbAligned) { synergyMultiplier += 0.15; synergyText += "[🌊 MSB Đồng Pha] "; }
    if (trendPoints > 50 && momPoints > 50) { synergyMultiplier += 0.15; synergyText += "[🔥 Tàu Siêu Tốc] "; }
    if (liqPoints > 80 && posPoints > 50) { synergyMultiplier += 0.20; synergyText += "[🐳 Cá Mập Quét Mồi] "; }
    if (l2 === 'Compression' && Math.abs(autoData.bbwSlope) > 5) { synergyMultiplier += 0.20; synergyText += "[🧨 Lò Xo Bung] "; }
    if (vectorDetails.isLeadLagArb) { synergyMultiplier += 0.25; synergyText += "[⚡ Lead-Lag Arb] "; }

    if (trendPoints < -20) {
        if (isSfpAligned) synergyText += "[🛡️ Bypass Phạt Trend nhờ SFP] ";
        else { penaltyMultiplier -= 0.20; penaltyText += "[-20% Ngược Trend] "; }
    }
    if (momPoints < -50) { penaltyMultiplier -= 0.30; penaltyText += "[-30% Mom Phân kỳ] "; }
    if (macroPoints < -50) { penaltyMultiplier -= 0.15; penaltyText += "[-15% Vĩ Mô Độc Hại] "; }

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

  evaluateGates: (autoData, apiMacro, vectorDetails, mathCore, direction, tradeType, entry, slTech, systemScore, tradeLogs, symbol, strategyName = '') => {
    const { l1, l2, l3, l5 } = vectorDetails;
    const { score, synergyText, penaltyText, checks, checkScores, passingScore } = systemScore;
    const requiredRR = autoData.bbwRank > 80 ? 2.0 : 1.8;

    const recentLossSameDirection = tradeLogs && tradeLogs.some(log => 
        log.symbol === symbol && 
        log.direction === direction && 
        log.status === 'LOSS' &&
        (Date.now() - new Date(log.close_time).getTime()) < 2 * 60 * 60 * 1000 
    );

    // SIẾT CHẶT TOXIC FLOW VPIN XUỐNG MỨC CỰC ĐOAN (0.06)
    const isVpinSafe = (autoData.vpinValue || 0) <= 0.06 || strategyName.includes('GAMMA EXHAUSTION');

    // ĐIỀU KIỆN 1: Đồng thuận CMF (Money Flow)
    const isCmfAligned = (direction === 'LONG' && autoData.cmf > 0) || (direction === 'SHORT' && autoData.cmf < 0);
    
    // ĐIỀU KIỆN 2: Chống mua đuổi (Overextended) - Đo khoảng cách từ Giá tới EMA20
    // Nếu giá chạy quá xa EMA20 (Lớn hơn 1.5 lần ATR) -> Không được FOMO
    const isOverextendedEMA20 = Math.abs(entry - autoData.ema20.value) > (autoData.atr14 * 1.5);

    const isMsbContradictory = (direction === 'LONG' && autoData.msbState === 'Bearish_MSB') || 
                               (direction === 'SHORT' && autoData.msbState === 'Bullish_MSB');

    const l1Str = String(l1 || "");
    const l3Str = String(l3 || "");
    const isVwapSafe = direction === 'LONG' 
        ? entry < autoData.vwapUpper // Không Long nếu giá đang lơ lửng ngoài biên trên VWAP
        : entry > autoData.vwapLower; // Không Short nếu giá đã rớt khỏi biên dưới VWAP
        
    const isCvdAligned = direction === 'LONG' ? autoData.cvdTrend > -5 : autoData.cvdTrend < 5;
    // =========================================================================
    // HỆ THỐNG HARD GATES MỚI (BỨC TƯỜNG KỶ LUẬT THÉP)
    // =========================================================================
    const hardGates = [
      { id: 'h_cd', passed: !recentLossSameDirection, text: `COOLDOWN: Không nhồi lệnh cùng hướng ${direction} sau khi bị SL.` },
      { id: 'h1', passed: apiMacro.realSpreadPct < 0.3 && slTech > 0 && Math.abs(entry - slTech) > (autoData.atr14 * 0.4), text: `CHỐNG NHIỄU: Khoảng cách SL > 0.4 ATR` },
      { id: 'h2', passed: parseFloat(mathCore.trueEVValue) > -0.05 || parseFloat(mathCore.theoreticalRR) >= requiredRR, text: `KỲ VỌNG: R:R >= ${requiredRR} hoặc EV Dương` },
      { id: 'h4', passed: tradeType === 'SPOT' || (mathCore.liqEstimate && !mathCore.leverageExceedsExchangeCap && mathCore.liqSafetyMargin >= 1.3), text: `ĐỆM THANH LÝ: An toàn Margin` },
      { id: 'h6', passed: autoData.lastClosedVolume >= (autoData.avgVolume20 * 0.4), text: `VOL DEADZONE: Thanh khoản ổn định` },
      { id: 'h_msb', passed: !isMsbContradictory, text: `MARKET STRUCTURE: Cấm giao dịch khi cấu trúc MSB đảo chiều ngược hướng lệnh.` },
      
      // 🛡️ 4 LUẬT SINH TỒN MỚI TỪ INSIGHT DỮ LIỆU
      { id: 'h_vpin', passed: isVpinSafe, text: `TOXIC FLOW: Cấm giao dịch khi VPIN > 0.06 (Nghi vấn thao túng).` },
      { id: 'h_range_block', passed: !l1Str.includes('Range'), text: `L1 RANGE BLOCK: Tuyệt đối không đánh khi thị trường đi ngang.` },
      { id: 'h_cmf_breakout', passed: !(l3Str.includes('Break') && !isCmfAligned), text: `CMF BREAKOUT: Cấm đánh Breakout/Breakdown khi dòng tiền CMF không đồng thuận.` },
      { id: 'h_expansion_fomo', passed: !(l2 === 'Expansion' && isOverextendedEMA20), text: `FOMO FILTER: Cấm mua đuổi khi L2 Expansion và giá đã chạy quá xa EMA20 (>1.5 ATR).` },
      { id: 'h_vwap', passed: isVwapSafe, text: `VWAP GRAVITY: Tránh FOMO - Giá đã đi quá xa vùng Giá trị Trung bình của Khối lượng (VWAP Bands).` },
      { id: 'h_cvd', passed: isCvdAligned, text: `CVD DIVERGENCE: Khóa lệnh - Taker Flow (CVD) đang xả hàng chủ động ngược hướng phân tích.` },
      { id: 'h_hurst', passed: !(autoData.hurstValue < 0.4 && strategyName.includes('MOMENTUM')), text: `HURST EXPONENT: Thị trường đang Mean-Reverting (Đi ngang), cấm đánh chiến thuật Đột phá (Momentum).` }
    ];

    const softGates = [
      { id: 's1', passed: checks.checkS1, weight: 1, text: `CẤU TRÚC L1 ĐỒNG THUẬN`, score: checkScores?.s1 },
      { id: 's2', passed: checks.checkS2, weight: 1, text: `DÒNG TIỀN CMF BƠM THỰC`, score: checkScores?.s2 },
      { id: 's3', passed: checks.checkS3, weight: 1, text: `SĂN THANH KHOẢN (LIQUIDITY EVENT)`, score: checkScores?.s3 },
      { id: 's4', passed: checks.checkS4, weight: 1, text: `ĐỘNG LƯỢNG GIÁ (RSI STOCHASTIC)`, score: checkScores?.s4 },
      { id: 's5', passed: checks.checkS5, weight: 1, text: `ĐỊNH VỊ DÒNG TIỀN (SMART MONEY)`, score: checkScores?.s5 },
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

=========================================
/// FILE: src/hooks/useExchangeConfig.js
=========================================

// FILE: src/hooks/useExchangeConfig.js
import { useState, useEffect } from 'react';
import { POOL_SYMBOLS, MIN_NOTIONALS } from '../config/constants';

export default function useExchangeConfig() {
  const [dynamicMinNotionals, setDynamicMinNotionals] = useState(MIN_NOTIONALS);
  const [dynamicPool, setDynamicPool] = useState(POOL_SYMBOLS);
  const [stepSizes, setStepSizes] = useState({});
  const [tickSizes, setTickSizes] = useState({});

  useEffect(() => {
    let isMounted = true;
    const fetchExchangeData = async () => {
      try {
        const ts = Date.now();
        const exRes = await fetch(`/api/binance?path=/fapi/v1/exchangeInfo&t=${ts}`);
        const exData = await exRes.json();

        const tickerRes = await fetch(`/api/binance?path=/fapi/v1/ticker/24hr&t=${ts}`);
        const tickerData = await tickerRes.json();

        if (!isMounted || !exData.symbols || !Array.isArray(tickerData)) return;

        const newNotionals = { ...MIN_NOTIONALS };
        const newStepSizes = {};
        const newTickSizes = {};
        
        // BỘ LỌC TUỔI ĐỜI UI
        const matureSymbols = new Set();
        const legacySymbols = new Set();
        const MATURE_AGE_MS = 730 * 24 * 60 * 60 * 1000;
        const LEGACY_AGE_MS = 1460 * 24 * 60 * 60 * 1000;
        const nowMs = Date.now();

        exData.symbols.forEach(sym => {
          const notionalFilter = sym.filters.find(f => f.filterType === 'MIN_NOTIONAL');
          if (notionalFilter) {
              const baseVal = parseFloat(notionalFilter.notional || 5);
              let bufferedVal = baseVal;
              if (baseVal === 5) bufferedVal = 5.3;
              else if (baseVal === 10) bufferedVal = 11.0;
              else if (baseVal === 20) bufferedVal = 22.0;
              else if (baseVal === 50) bufferedVal = 55.0;
              else bufferedVal = baseVal * 1.05; 

              newNotionals[sym.symbol] = bufferedVal;
          }
          
          const lotSize = sym.filters.find(f => f.filterType === 'LOT_SIZE');
          if (lotSize) newStepSizes[sym.symbol] = parseFloat(lotSize.stepSize);
          
          const priceFilter = sym.filters.find(f => f.filterType === 'PRICE_FILTER');
          if (priceFilter) newTickSizes[sym.symbol] = parseFloat(priceFilter.tickSize);

          // Cập nhật mảng trưởng thành
          if (sym.onboardDate) {
                    if ((nowMs - sym.onboardDate) > MATURE_AGE_MS) matureSymbols.add(sym.symbol);
                    if ((nowMs - sym.onboardDate) > LEGACY_AGE_MS) legacySymbols.add(sym.symbol);
                }
        });

        // 1. TẠO DANH SÁCH ĐEN CÁC ĐỒNG MEME (Giống hệt server)
        const MEME_BLACKLIST = [
            'DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BONKUSDT', 
            'BOMEUSDT', 'WIFUSDT', 'MEMEUSDT', 'PEOPLEUSDT', '1000PEPEUSDT', 
            '1000FLOKIUSDT', '1000SHIBUSDT', '1000BONKUSDT', 'PNUTUSDT', 'NOTUSDT'
        ];

        // 2. TẠO BỘ LỌC GỐC (Bỏ Meme, Bỏ râu nến dài, Bỏ coin rác)
        const baseTickers = tickerData.filter(t => 
            t.symbol.endsWith('USDT') && 
            !POOL_SYMBOLS.includes(t.symbol) && 
            !MEME_BLACKLIST.includes(t.symbol) && 
            Math.abs(parseFloat(t.priceChangePercent)) < 15 && 
            ((parseFloat(t.highPrice) - parseFloat(t.lowPrice)) / parseFloat(t.lowPrice) * 100) < 25
        );

        // 3. NGÁCH TRENDING (30 Slot): > 2 năm tuổi, Volume > 30 Triệu USD
        const trendingTickers = baseTickers
            .filter(t => matureSymbols.has(t.symbol) && parseFloat(t.quoteVolume) > 30000000)
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, 30)
            .map(t => t.symbol);

        // 4. NGÁCH LEGACY TECH (10 Slot): > 4 năm tuổi, Volume > 5 Triệu USD
        const legacyTickers = baseTickers
            .filter(t => legacySymbols.has(t.symbol) && 
                         !trendingTickers.includes(t.symbol) && // Tránh trùng lặp
                         parseFloat(t.quoteVolume) > 5000000)
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, 10)
            .map(t => t.symbol);

        // 5. GỘP TOÀN BỘ (Đồng bộ UI với Scanner)
        const mergedPool = [...new Set([...POOL_SYMBOLS, ...trendingTickers, ...legacyTickers])];

        setDynamicMinNotionals(newNotionals);
        setStepSizes(newStepSizes);
        setTickSizes(newTickSizes);
        setDynamicPool(mergedPool);
      } catch (e) {
        console.error("⚠️ Lỗi Đồng bộ Dữ liệu Exchange Info:", e);
      }
    };

    fetchExchangeData();
    const timer = setInterval(fetchExchangeData, 300000); 
    return () => { isMounted = false; clearInterval(timer); };
  }, []);

  return { dynamicMinNotionals, dynamicPool, stepSizes, tickSizes };
}

=========================================
/// FILE: src/hooks/useLiveData.js
=========================================

// FILE: src/hooks/useLiveData.js
import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase'; // Import thêm Supabase

export default function useLiveData({ symbol, intervalTime, indicatorSpecs, setSystemHealth }) {
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [systemError, setSystemError] = useState(false);

  const [liveCapital, setLiveCapital] = useState(0);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [binancePositions, setBinancePositions] = useState([]);
  const [leverageBrackets, setLeverageBrackets] = useState(null);
  const [tradeFees, setTradeFees] = useState({ maker: 0.0002, taker: 0.0004 });
  const [autoData, setAutoData] = useState(null);
  const [apiMacro, setApiMacro] = useState({ fgiValue: 50, longShortRatio: 1.0, lsPositionVolRatio: 1.0, takerBuySellRatio: 1.0, tradingSession: 'ASIAN', sessionMultiplier: 0.8, isWeekend: false, realSpreadPct: 0.05 });
  const [cmcData, setCmcData] = useState({ btcDominanceRealtime: 55.0, totalMarketCapBillion: 0, fgiClassification: 'NEUTRAL' });
  
  // STATE MỚI: CHỨA NÃO BỘ TỐI ƯU
  const [aiModel, setAiModel] = useState(null);

  // KÉO MODEL TỪ SUPABASE (Chạy 1 lần khi load app)
  useEffect(() => {
    const fetchLatestModel = async () => {
        if (!supabase) return;
        const { data, error } = await supabase
            .from('system_models')
            .select('model_data')
            .order('created_at', { ascending: false })
            .limit(1);
            
        if (!error && data && data.length > 0) {
            setAiModel(data[0].model_data);
        }
    };
    fetchLatestModel();
  }, []);

  // LUỒNG 1: NHẬN STREAM DỮ LIỆU ĐÃ TÍNH TOÁN SẴN TỪ DAEMON
  useEffect(() => {
    let isMounted = true;
    let ws;
    let reconnectTimer;

    const connectTelemetry = () => {
        ws = new WebSocket('ws://localhost:1338');
        
        ws.onopen = () => {
            if (isMounted) {
                ws.send(JSON.stringify({ action: 'SUBSCRIBE_HUD', symbol, intervalTime, indicatorSpecs }));
                setSystemError(false);
            }
        };

        ws.onmessage = (event) => {
            if (!isMounted) return;
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'HUD_SYNC') {
                    const { autoData: ad, apiMacro: am, liveCapital: lc, availableBalance: ab, binancePositions: bp, leverageBrackets: lb, tradeFees: tf, cmcData: cmc } = msg.payload; 
                    
                    setAutoData(ad); setApiMacro(am); 
                    if (lc !== undefined && lc > 0) setLiveCapital(lc);
                    if (ab !== undefined && ab > 0) setAvailableBalance(ab);
                    
                    if (bp) setBinancePositions(bp); 
                    if (lb) setLeverageBrackets(lb);
                    if (tf) setTradeFees(tf);
                    if (cmc) setCmcData(cmc);
                    
                    setLastUpdated(new Date()); setLoading(false);
                }
            } catch (e) {}
        };

        ws.onclose = () => {
            if (isMounted) { setSystemError(true); reconnectTimer = setTimeout(connectTelemetry, 5000); }
        };
    };

    setLoading(true);
    connectTelemetry();

    return () => {
        isMounted = false;
        clearTimeout(reconnectTimer);
        if (ws) {
            if (ws.readyState === 1) ws.close();
            else if (ws.readyState === 0) ws.onopen = () => ws.close();
        }
    };
  }, [symbol, intervalTime]);

  // LUỒNG 2: GIỮ NGUYÊN STREAM NATIVE CỦA BINANCE ĐỂ GIÁ NHÁY 100MS KHÔNG ĐỘ TRỄ
  useEffect(() => {
    let isMounted = true;
    const wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@markPrice@1s`;
    const ws = new WebSocket(wsUrl);
    let lastRenderedPrice = 0;

    ws.onmessage = (event) => {
        if (!isMounted) return;
        const data = JSON.parse(event.data);
        if (data.e === 'markPriceUpdate') {
            const newPrice = parseFloat(data.p);
            if (lastRenderedPrice === 0 || Math.abs(newPrice - lastRenderedPrice) / lastRenderedPrice > 0.0005) {
                lastRenderedPrice = newPrice;
                setAutoData(prev => {
                    if (!prev) return prev;
                    return { ...prev, currentPrice: newPrice, atrPercent: newPrice > 0 ? (prev.atr14 / newPrice) * 100 : prev.atrPercent };
                });
            }
        }
    };

    return () => {
        isMounted = false;
        if (ws && ws.readyState === 1) ws.close();
        else if (ws && ws.readyState === 0) ws.onopen = () => ws.close();
    };
  }, [symbol]);

  // TRẢ VỀ aiModel để các module khác sử dụng
  return { loading, lastUpdated, systemError, liveCapital, availableBalance, binancePositions, leverageBrackets, tradeFees, autoData, cmcData, apiMacro, aiModel };
}

=========================================
/// FILE: src/hooks/useMatrixScanner.js
=========================================

import { useState, useEffect } from 'react';

export default function useMatrixScanner({ showToast, tradeLogs }) {
  const [scannedTopSetups, setScannedTopSetups] = useState([]);
  const [isScanningBackground, setIsScanningBackground] = useState(true);
  const [sonarEnabled, setSonarEnabled] = useState(false); 

  useEffect(() => {
    let isMounted = true;
    let ws;
    let reconnectTimeout;

    const connectWS = () => {
        ws = new WebSocket('ws://localhost:1338');

        ws.onopen = () => {
            if (isMounted) console.log("🟢 Matrix Radar Connected to Local Daemon");
        };

        ws.onmessage = (event) => {
            if (!isMounted) return;
            try {
                const payload = JSON.parse(event.data);
                
                if (payload.type === 'SCAN_RESULTS') {
                    if (payload.data && payload.data.length > 0) {
                        // VÁ LỖ HỔNG AMNESIA: Dùng tradeLogs của Frontend để lọc lại tín hiệu từ Daemon
                        const validatedSetups = payload.data.filter(setup => {
                             const recentLoss = tradeLogs && tradeLogs.some(log => 
                                 log.symbol === setup.symbol && 
                                 log.direction === setup.direction && 
                                 log.status === 'LOSS' &&
                                 (Date.now() - new Date(log.close_time).getTime()) < 2 * 60 * 60 * 1000 
                             );
                             return !recentLoss; // Chỉ giữ lại các setup KHÔNG bị dính Cooldown
                        });

                        if (validatedSetups.length > 0) {
                            setScannedTopSetups(validatedSetups);
                        } else {
                            setScannedTopSetups([{ isEmpty: true, reason: 'ALL_FILTERED_BY_COOLDOWN' }]);
                        }
                    } else {
                        setScannedTopSetups([{ isEmpty: true }]);
                    }
                    
                    setIsScanningBackground(false);

                    if (sonarEnabled && showToast && payload.isNewSignal) {
                         try {
                            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
                            audio.volume = 0.6; audio.play().catch(() => {});
                         } catch(e) {}
                         showToast("🎯 RADAR PING: Lõi Local vừa phê duyệt tín hiệu mới!");
                    }
                }
            } catch(e) {
                console.error("Lỗi parse dữ liệu Matrix WS:", e);
            }
        };

        ws.onclose = () => {
            if (isMounted) {
                console.log("🔴 Matrix Radar ngắt kết nối. Đang thử lại sau 5s...");
                reconnectTimeout = setTimeout(connectWS, 5000);
            }
        };
    };

    connectWS();

    return () => { 
        isMounted = false; 
        if (reconnectTimeout) clearTimeout(reconnectTimeout); 
        
        if (ws) {
            if (ws.readyState === 1) { 
                ws.close();
            } else if (ws.readyState === 0) { 
                ws.onopen = () => ws.close();
            }
        }
    };
  }, [sonarEnabled, showToast, tradeLogs]); // Thêm tradeLogs vào dependency array

  return { scannedTopSetups, isScanningBackground, sonarEnabled, setSonarEnabled };
}

=========================================
/// FILE: src/index.css
=========================================

@tailwind base;
@tailwind components;
@tailwind utilities;

/* Tùy chỉnh thanh cuộn (Scrollbar) cho giao diện ngầu hơn */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: #0a0a0c;
}
::-webkit-scrollbar-thumb {
  background: #065f46;
  border-radius: 3px;
}

=========================================
/// FILE: src/main.jsx
=========================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

=========================================
/// FILE: src/services/llmAPI.js
=========================================

// FILE: src/services/llmAPI.js
const MODELS = ['gemini-3.5-flash', 'deepseek-v4-flash', 'mimo-v2.5'];

export const getRandomModel = () => MODELS[Math.floor(Math.random() * MODELS.length)];

export const callAI = async (model, systemPrompt, userPrompt, requiresJson = true) => {
    try {
        // Lấy key an toàn cho cả môi trường Node.js và Vite
        const getEnv = (key) => (typeof process !== 'undefined' ? (process.env[key] || process.env[`VITE_${key}`]) : import.meta.env[`VITE_${key}`]);

        if (model === 'gemini-3.5-flash') {
            const apiKey = getEnv('GEMINI_API_KEY');
            if (!apiKey) throw new Error("Thiếu GEMINI_API_KEY");
            
            const bodyPayload = { 
                contents: [{ role: 'user', parts: [{ text: `[HƯỚNG DẪN HỆ THỐNG]: ${systemPrompt}\n\n[DỮ LIỆU ĐẦU VÀO]: ${userPrompt}` }] }] 
            };
            if (requiresJson) bodyPayload.generationConfig = { responseMimeType: "application/json" };

            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyPayload)
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.candidates[0].content.parts[0].text;
        }

        if (model === 'deepseek-v4-flash') {
            const apiKey = getEnv('DEEPSEEK_API_KEY');
            if (!apiKey) throw new Error("Thiếu DEEPSEEK_API_KEY");
            
            const bodyPayload = {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt + (requiresJson ? " You MUST output valid JSON." : "") },
                    { role: 'user', content: userPrompt }
                ],
                stream: false,
                thinking: { type: "enabled" } 
            };
            if (requiresJson) bodyPayload.response_format = { type: 'json_object' };

            const res = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(bodyPayload)
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.choices[0].message.content;
        }

        if (model === 'mimo-v2.5') {
            const apiKey = getEnv('MIMO_API_KEY');
            if (!apiKey) throw new Error("Thiếu MIMO_API_KEY");
            
            const bodyPayload = {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt + (requiresJson ? " Return only JSON, no explanations." : "") },
                    { role: 'user', content: userPrompt }
                ],
                stream: false,
                thinking: { type: "enabled" } // BẢN VÁ: Bật Deep Thinking cho MiMo
            };
            if (requiresJson) bodyPayload.response_format = { type: 'json_object' };

            const res = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(bodyPayload)
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.choices[0].message.content;
        }
    } catch (error) {
        throw error;
    }
};

=========================================
/// FILE: src/services/supabase.js
=========================================

// File: src/services/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''; 
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''; 

export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

=========================================
/// FILE: src/store/useAppStore.js
=========================================

// FILE: src/store/useAppStore.js
import { create } from 'zustand';

const useAppStore = create((set) => ({
  // Dữ liệu cài đặt người dùng
  symbol: 'BTCUSDT',
  setSymbol: (sym) => set({ symbol: sym }),
  
  intervalTime: '15m',
  setIntervalTime: (int) => set({ intervalTime: int }),
  
  mvrvZScore: 0.39,
  setMvrvZScore: (z) => set({ mvrvZScore: z }),

  // Epoch ID dùng để theo dõi chu kỳ tiến hóa của hệ thống (Walk-forward optimization)
  currentEpochId: 'epoch-alpha-001',
  setCurrentEpochId: (id) => set({ currentEpochId: id }),

  // Cấu hình giao dịch
  tradeSetup: {
    tradeType: 'FUTURES', direction: 'LONG', execution: 'LIMIT', 
    riskPercent: 1.0, entry: 0, slTech: 0, tp1: 0, activeStrategy: "TIÊU CHUẨN" 
  },
  setTradeSetup: (updater) => set((state) => ({ 
    tradeSetup: typeof updater === 'function' ? updater(state.tradeSetup) : { ...state.tradeSetup, ...updater } 
  })),

  // Cấu hình mạng & hệ thống
  systemHealth: { weight: 0, maxWeight: 2400, latency: 0 },
  setSystemHealth: (updater) => set((state) => ({
      systemHealth: typeof updater === 'function' ? updater(state.systemHealth) : { ...state.systemHealth, ...updater }
  }))
}));

export default useAppStore;

=========================================
/// FILE: tailwind.config.js
=========================================

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

=========================================
/// FILE: vite.config.js
=========================================

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:1338',
        changeOrigin: true,
      }
    }
  }
});

