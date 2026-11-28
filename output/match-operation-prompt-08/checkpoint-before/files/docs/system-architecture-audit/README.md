# Kiểm toán chuẩn hóa kiến trúc – Bước 3–5

**Phạm vi:** lưu trữ test snapshot phía server, quyền truy cập, xác minh nguồn sơ đồ Bước 4 khi Match Service tính toán Bước 5, đồng bộ người xem và kiểm tra build/integration. Không thiết kế lại giao diện Bước 5.

## Tài liệu

- [01_ARCHITECTURE.md](./01_ARCHITECTURE.md) – miền sở hữu và kết quả chuẩn hóa.
- [02_API_AND_DATA.md](./02_API_AND_DATA.md) – API, migration và luồng dữ liệu.
- [03_TEST_RESULTS.md](./03_TEST_RESULTS.md) – build, unit/integration và giới hạn E2E.
- [04_REMAINING_WORK.md](./04_REMAINING_WORK.md) – các phần chưa đạt hoặc cần xử lý tiếp.
- [TEST_DATA_ARCHITECTURE.md](../TEST_DATA_ARCHITECTURE.md) – nguyên tắc snapshot test cập nhật.

## Kết luận nhanh

Đã chuyển nơi lưu state test Bước 3–5 sang snapshot server có revision CAS và phân quyền theo BTC quản lý giải. Match Service xác minh snapshot lịch khớp chính xác sơ đồ đã công bố qua Tournament Service. Thử nghiệm PostgreSQL cho snapshot concurrency/reset và xung đột đặt sân đã chạy thành công.

Chưa thể kết luận đã chuẩn hóa toàn hệ thống theo yêu cầu: phần chia bảng/generating fixtures còn một phần chạy ở frontend; chưa chạy E2E qua Gateway bằng code vừa build; Docker CLI không có trong PATH; một số integration test ngoài phạm vi Bước 3–5 đang thất bại. Xem bảng trạng thái trong các tài liệu con.
