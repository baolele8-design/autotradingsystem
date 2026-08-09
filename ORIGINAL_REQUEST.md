# Original User Request

## Initial Request — 2026-07-26T17:07:10+07:00

Xây dựng cơ chế bảo vệ và tự động hủy các lệnh chờ khớp (PENDING Limit Orders) cho Main Bot (AutoBot / Matrix Scanner).

Working directory: d:\100_Active_Projects\107_Trading_Crypto\03_Workspace\sandbox
Integrity mode: development

## Requirements

### R1. Hủy theo thời gian (Time-based Expiry)
Lệnh PENDING sẽ bị tự động hủy nếu thời gian chờ khớp vượt quá **3 nến** của khung thời gian đánh lệnh (ví dụ: lệnh đánh khung 15m sẽ hết hạn sau 45 phút, khung 1h sẽ hết hạn sau 3 giờ).

### R2. Hủy theo điều kiện Logic/Soft Gates (Condition-based Expiry)
Trong thời gian chờ khớp, hệ thống phải liên tục đánh giá lại lệnh PENDING so với các logic gate và soft gate hiện tại. Nếu cấu trúc thị trường thay đổi khiến lệnh không còn thỏa mãn các gates này, lệnh phải bị hủy ngay lập tức thay vì chờ hết thời gian.

### R3. Đồng bộ trạng thái và dọn dẹp
Khi lệnh bị hủy (do thời gian hoặc do rớt gate), hệ thống phải gửi lệnh hủy (DELETE) lên Binance, đồng thời cập nhật trạng thái lệnh trong database thành `CANCELLED_EXPIRED` hoặc `CANCELLED_INVALIDATED` tương ứng.

## Acceptance Criteria

### Verification & Validation
- [ ] Hàm tính toán thời gian hết hạn của nến hoạt động chính xác theo từng khung thời gian (15m, 1h, 4h, 1d...).
- [ ] Có Unit Test chứng minh: Lệnh PENDING bị hủy khi vượt quá thời gian 3 nến.
- [ ] Có Unit Test chứng minh: Lệnh PENDING bị hủy sớm khi không còn vượt qua được logic/soft gates.
- [ ] Các thay đổi tuân thủ nghiêm ngặt ranh giới kiến trúc (Domain không gọi ra Infrastructure). Không phá vỡ limit 2400 weight/phút của Binance.
