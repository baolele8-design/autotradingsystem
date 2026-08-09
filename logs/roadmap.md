# 1.5.2
- **Targeted Algo Order Cleanup (algoId-based):** Thay đổi toàn diện cách xóa CO (Conditional Orders / SL-TP Algo Orders) từ "xóa tất cả theo symbol" (nguy hiểm) sang "xóa đúng algoId của lệnh đó" (an toàn):
  * **autoBot.js:** Capture `algoId` từ response của `POST /fapi/v1/algoOrder` (SL & TP). Lưu `sl_algo_id` và `tp_algo_id` vào payload Supabase `trade_logs`. Pre-flight cleanup chỉ xóa limit orders (`/fapi/v1/allOpenOrders`), không còn bulk delete algo orders.
  * **ledgerSyncService.js:** Tách `safeCancelOpenOrders` thành 2 hàm: `cancelTradeAlgoOrders(log)` (xóa đúng algoId từ DB, fallback an toàn nếu lệnh cũ chưa có algoId) và `safeCancelLimitOrders(symbol)` (chỉ xóa limit orders). SELECT thêm `sl_algo_id`, `tp_algo_id`. Tất cả luồng PENDING/OPEN/WIN/LOSS đều dùng targeted cancel.
  * **scalpEngine.js:** Capture `slAlgoId`/`tpAlgoId` từ response, lưu vào `openTrades` Map. Thêm `cancelAlgoOrdersForTrade(trade)` sử dụng algoId trong memory. Khi posAmt===0 và lệnh đóng tự nhiên (TP/SL hit), dùng targeted cancel thay vì bulk `cancelAllOrders`.
  * **Nguyên tắc:** Lệnh cũ không có algoId → bỏ qua xóa CO (in warning log) để bảo vệ lệnh mới có thể đang chạy cùng coin.
  * **Yêu cầu Supabase SQL:** `ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS sl_algo_id BIGINT; ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS tp_algo_id BIGINT;`
- Hoàn tất Nâng cấp & Refactor Toàn diện Scalp Bot (Milestones 1–4, Requirements R1–R5):
  * R1: Architecture & Shared Rate Limiter: Tái cấu trúc theo Layered Architecture (Inward Dependency Only). Chuyển đổi toàn bộ các lời gọi API Binance sang dùng chung `binanceGateway.js` rate limiter (≤ 2400 weight/min) với Main Bot.
  * R2: Regime & Microstructure Signal Gating: Tích hợp bộ lọc Regime (Expansion/Range/Extreme) và Microstructure (OBI / CVD Delta) cho 3 chiến thuật scalping S1 (EMA Momentum), S2 (RSI Snap), S3 (BB Squeeze), chặn tín hiệu sai trong vùng sideway/fakeout.
  * R3: Trailing Policy & Temporal Barrier: Áp dụng state machine bảo vệ lệnh (`NONE -> BE -> LOCK -> TRAIL`) và Temporal Barrier tự động điều chỉnh nến giữ lệnh dựa trên BTC trend alignment, hỗ trợ +25% Soft Extension khi đạt stage LOCK/TRAIL với PnL R >= 1.5R.
  * R4: Scalp Optimizer (Empirical Bayes Shrinkage): Nâng cấp mini-optimizer với Empirical Bayes Shrinkage theo trọng số mẫu ($w = N / (N + 15)$) và Regime-weighting, tự động tối ưu hóa SL%, TP%, ngưỡng chỉ báo theo từng khung thị trường.
  * R5: Process & Resource Isolation: Tách độc lập tiến trình (`node local-daemon/scalpBot.js`), giới hạn vốn ảo $140 không xâm phạm Main Bot ($750), cách ly hoàn toàn dữ liệu với 2 bảng Supabase riêng biệt `scalp_trade_logs` và `scalp_strategy_params`.
  * Đồng bộ hóa Version System: Cập nhật `SYSTEM_VERSION = "v1.5.2"` trong `AntiFragileTerminal.jsx`, `scalpEngine.js` (`scalp-v1.5.2`), `autoBot.js` (`v1.5.2-auto`), `matrixScannerService.js` (`v1.5.2-pending`), và `AGENTS.md`.


# 1.5.1
- Sửa lỗi truy vấn Supabase LedgerSync: Loại bỏ trường `atr_at_entry` không tồn tại khỏi mảng `select` trong `ledgerSyncService.js` để ngăn lỗi crash truy vấn.
- Cập nhật đồng bộ `strategy_version` lên v1.5.1 cho Main Bot và Scalp Bot.

# 1.5.0
- Đồng bộ hóa version string daemon:
  * Cập nhật `strategy_version` từ `v1.4.0-auto` thành `v1.5.0-auto` trong `local-daemon/src/legacy/autoBot.js`.
  * Cập nhật `strategy_version` fallback từ `v1.4.0-pending` thành `v1.5.0-pending` trong `local-daemon/src/application/scanner/matrixScannerService.js`.
- Sửa lỗi kết nối LedgerSyncService & MarketDataCache:
  * Bootstrap Wiring: Truyền `marketDataCache` vào `createLedgerSyncService` trong `local-daemon/src/bootstrap.js`.
  * Market Snapshot Resolution & Graceful Fallback: Cập nhật `ledgerSyncService.js` tự động lấy/dựng market snapshot qua `marketDataCache.getSnapshot` hoặc `marketDataCache.getKlines` + `QuantMath`. Bỏ qua đánh giá gate invalidation khi snapshot chưa sẵn sàng (`snapshot == null`), ngăn ngừa việc tự động hủy nhầm các lệnh PENDING hợp lệ.
  * Unit Tests: Bổ sung 4 unit tests trong `ledgerSyncService.test.js` kiểm tra tích hợp `marketDataCache` (getKlines, getSnapshot, null snapshot fallback, omitted cache fallback).

- Nâng cấp Optimizer Core v3.0 & Time Barrier & Trailing Policy:
  * Optimizer Regime & BTC Context: Tích hợp `regime_at_entry` & `btc_regime_at_entry` vào trade logs. Phân loại regime thành `TRENDING` vs `MEAN_REVERTING` và thực hiện Regime-weighted Empirical Bayes Shrinkage khi học SL/TP/Hold. Thêm `btc_context_summary` vào output model.
  * Time Barrier Adaptive & Soft Extension: Chuyển đổi regime hold modifier sang hàm liên tục (Range 0.75x, Extreme/Compression 0.80x, Expansion 0.85x). Thêm `btcTrendAlignment` modifier cho Altcoins (Counter-BTC 0.85x, Aligned 1.10x). Thêm Soft Extension +25% thới gian cho lệnh có lợi nhuận R ≥ 1.5R tại stage LOCK/TRAIL.
  * Trailing Policy Family-Based: Chuyển đổi trailing resolution từ keyword matching cũ sang 8 Strategy Family Profiles (`EVENT_REVERSAL`, `STRUCTURAL_BREAKOUT`, `MEAN_REVERSION`, v.v.) kết nối trực tiếp với 11 chiến thuật catalog mới.
  * Safe Database Query Limit: Thêm bộ lọc 90 ngày (`gte created_at`) cho Supabase query trong optimizer.
  * Explicit Tier 3 Policy: Cấu hình tường minh `sl: 1.0, tp: 1.0` cho Tier 3.
  * Pending Order Expiry & Gate Invalidation: Tích hợp `isPendingOrderExpired` (3 nến) và `evaluatePendingOrderGateInvalidation` vào `ledgerSyncService.js`, thực hiện Binance DELETE `/fapi/v1/allOpenOrders` (bỏ qua mã lỗi `-2011`) và cập nhật DB `trade_logs` (`CANCELLED_EXPIRED`, `CANCELLED_INVALIDATED`).


# 1.4.1
- Nâng cấp Scalp Bot 5m:
  * Tích hợp HTF Trend Filter (1h): Sử dụng đường EMA50 khung 1h làm bộ lọc xu hướng lớn, chặn các tín hiệu S1 đánh ngược Trend 1h và chặn S2 bắt đáy khi 1h xả quá sâu (1h RSI < 30).
  * Thêm Breakeven Trailing tự động: Tự động dời Stop Loss trên Binance Futures về giá Entry ngay khi vị thế đạt lợi nhuận PnL ≥ +1.0% Notional để bảo vệ vốn.
  * Hủy lệnh Limit chờ quá hạn (Unfilled Limit Expiry): Tự động hủy các lệnh Limit chờ quá 15 phút chưa khớp vị thế thật và cập nhật trạng thái CANCELLED_EXPIRED trong DB.

# 1.4.0
- Kích hoạt toàn bộ 11 chiến thuật LIVE (từ PAPER_ONLY → LIVE): auto-bot được phép thực thi tất cả chiến thuật thay vì chỉ Adaptive fallback.
- Tăng ngân sách auto-bot: maxTotalUsd 650$ → 750$, refillUsdThreshold 400$ → 500$.
- Giữ nguyên fixedSizeUsd 55$, maxRiskPct 1.0%, minScore 50.
- Điều chỉnh ngưỡng phân loại Tier dựa trên spread thực tế: Tier 1 hardcode BTC/ETH/SOL/BNB. Tier 2: vol ≥ 30M & spread ≤ 0.015%. Tier 3: vol ≥ 8M & spread ≤ 0.040%. Tier 4: Nano/High-Risk.
- Phát triển Scalp Bot độc lập: bot đánh scalping riêng biệt, 9 coin Tier 1-2 (BTC/ETH/SOL/BNB/XRP/LINK/DOGE/SUI/AVAX), 3 khung (5m/15m/1h), 3 chiến thuật (EMA Momentum, RSI Snap, BB Squeeze), LIMIT order, không trailing, ghi bảng scalp_trade_logs riêng.
- Thêm mini-optimizer cho Scalp Bot: tự động học SL%, TP%, volume threshold, minScore từ lịch sử giao dịch mỗi 30 phút. Dùng shrinkage smoothing (70% cũ + 30% mới), lưu vào scalp_strategy_params.

# 1.3.9
-Thêm vwap, cvd, hurst, forced liquidation stream, orderbookheatmap & depth
-Bỏ obv
-Thêm các thông số mới vào chiến thuật
-Đóng băng 1R:** `1R = |actual entry - initial SL|` và giữ cố định suốt vòng đời trade.
-Loại bỏ reconstruct R cũ:** không còn tính lại R từ `current SL` hoặc từ `TP / theoreticalRR`.
-Lưu `initial_sl`:** giữ lại SL gốc để không bị mất sau khi BE/LOCK/TRAIL dời SL.
-Lưu `initial_risk_per_coin`:** làm denominator chuẩn cho toàn bộ BE, LOCK, TRAIL và profit R.
-Lưu `opened_at`:** thời gian giữ lệnh bắt đầu từ lúc Binance thực sự fill position, không phải lúc signal được tạo.
-Temporal Barrier dùng `opened_at`:** `created_at` chỉ còn fallback cho dữ liệu legacy.
-Thêm validation khi PENDING → OPEN:** kiểm tra `actualEntry`, `initialSl`, `initialRiskPerCoin` hợp lệ trước khi khởi tạo risk state.
-Kiểm tra lỗi Supabase khi OPEN trade:** không còn mặc định rằng `.update()` chắc chắn thành công.
-Thêm migration cho trade OPEN cũ:** các lệnh đã mở trước khi thêm `initial_risk_per_coin` được tự backfill khi có thể phục hồi an toàn.
-Không backfill mù:** nếu SL đã từng được dời mà không còn `initial_sl`, hệ thống không lấy SL hiện tại để giả lập R gốc.
-Ưu tiên actual Binance entry khi migration:** dùng `position.entryPrice` thay vì chỉ tin entry cũ trong database.
-Thêm `protection_stage`:** thay vì chỉ có `trailing_activated`, hệ thống phân biệt rõ:
  * `NONE`
  * `BE`
  * `LOCK`
  * `TRAIL`
-`trailing_activated` chỉ giữ để tương thích:** state thực của protection nằm ở `protection_stage`.
-State machine ưu tiên stage cao nhất:** kiểm tra `TRAIL → LOCK → BE`, tránh price nhảy mạnh nhưng engine chỉ áp stage thấp.
-BE chuyển sang đơn vị R:** từ ±0.1% giá thành khoảng `+0.05R`, giúp thống nhất giữa các coin có SL distance khác nhau.
-Thêm High-Water Mark:** lưu mức giá thuận lợi nhất mà trade từng đạt được.
-Lưu `high_water_price`:** giá tốt nhất của trade theo hướng LONG/SHORT.
-Lưu `high_water_r`:** MFE hiện tại được chuẩn hóa theo `initial R`.
-Trailing dựa trên High-Water:** SL động bám đỉnh/đáy lợi nhuận đã đạt được thay vì chỉ dùng mark price hiện tại.
-High-Water vẫn được cập nhật dù SL chưa đổi:** tạo dữ liệu path-dependent để optimizer học sau này.
-Fail-closed khi Binance order state không rõ:** thêm `blindSymbols`; nếu không đọc được open orders/algo orders thì không chỉnh protection của symbol đó.
-Cô lập lỗi theo từng symbol:** lỗi API của một coin không làm ảnh hưởng logic trailing các coin khác.
-Bỏ silent catch trong trailing:** lỗi risk engine giờ được log rõ thay vì bị nuốt.
-Tách GAMMA khỏi LEAD-LAG:** GAMMA có profile trailing riêng và rộng hơn LEAD-LAG.
-Thêm profile riêng cho LIQ-FLUSH:** không còn rơi xuống default trailing.
-Tách Tier 3 và Tier 4:** không còn dùng chung modifier.
-Giảm độ mạnh modifier Tier:** vì initial SL đã ATR-normalized nên tránh bù volatility hai lần.
-Tier 1 modifier mới nhẹ hơn:** siết vừa phải và có giảm cả `trailTrigger`.
-Tier 3 modifier mới:** rộng hơn Tier 2 nhưng chưa quá mạnh.
-Tier 4 modifier mới:** rộng nhất để chịu wick, spread và liquidity noise lớn hơn.
-Ledger query lấy thêm các field mới:** `initial_sl`, `initial_risk_per_coin`, `opened_at`, `protection_stage`, `high_water_price`, `high_water_r`, `trailing_activated`.
-Schema Supabase mới cần thêm 6 cột:**
  `initial_sl`, `initial_risk_per_coin`, `opened_at`, `protection_stage`, `high_water_price`, `high_water_r`.
-OPEN → CLOSED logic cơ bản giữ nguyên:** chỉ bổ sung framework risk-management mới xung quanh lifecycle trade.
-Scanner, scoring, Bayesian optimizer, Kelly, True EV, TradeValidator, signal generation, execution entry, HUD, liquidation stream, PEE gần như không thay đổi.**
-Không áp dụng thay đổi POST SL mới rồi DELETE SL cũ:** cơ chế replace SL chính vẫn giữ theo hướng hiện tại như bạn yêu cầu.
-Thay đổi kiến trúc cốt lõi:** từ trailing routine dựa trên SL hiện tại → **stateful risk-management engine sử dụng R bất biến + protection state + high-water mark + migration legacy + fail-closed safety**.

# 1.3.8
-Bổ sung, chỉnh sửa 1 loạt các chiến thuật đánh
-Phát triển bot tự động đánh: đánh tối đa 650$ vốn, tổng lệnh dưới 400$ thì đánh tiếp, 1 lệnh tối đa 55$ và dưới 1% risk.
-Nâng cáp optimizer

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

# 1.3.5
-Tinh chỉnh optimizer
-Bỏ chiến thuật x10
-CHỈNH SỬA QUAN TRỌNG: Config setup vào lệnh 1 cách linh hoạt cho từng chiến thuật
-Đưa leverageBracket và commissionRate ra khỏi vòng lặp syncHUD.
-Giãn nhịp syncHUD từ 10 giây lên 15 giây.
-Chỉnh holding cycle thành dữ liệu thật (có thể dùng để học máy sau này)
-Phát triển tính năng paper trading (lấy 10 lệnh trên matrix ghi vào 1 database khác, rồi cronjob tự kiểm sau 5p)
-Điều chỉnh cách tính volumn ngày cho chính xác => lọc tier chính xác

# 1.3.4
-Đại phẫu toàn bộ L1 - L6, thay đổi cơ chế chấm điểm, chuyển từ dạng bậc sang dạng phổ.
-Lồng L1-L6 vào quanmath, từ giờ matrix và hud chính đều xài chung.

# 1.3.3
-Chỉnh lại dữ liệu gửi cho supabase
-Chỉnh lại cấu trúc supabase.
-Chỉnh sửa tối ưu weight consume của Matrix Scanner
-Bổ sung tính năng PEE: theo dõi giá sau đóng lệnh để tối ưu học máy.
-Bổ sung hiển thị tỉ lệ thắng của chiến thuật - tier coin, pnl theo ngày.

# 1.3.2 alpha
-Chỉnh optimizer: thay vì học máy cho toàn bộ dữ liệu, thì chia ra theo tier, theo chiến thuật
