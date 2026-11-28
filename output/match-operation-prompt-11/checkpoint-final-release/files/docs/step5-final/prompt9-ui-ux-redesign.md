# Prompt 9 – Thiết kế lại UI/UX Bước 5

> Báo cáo này được viết trước khi hoàn tất Prompt 9A. Kết quả runtime mới nhất và đối chiếu nghiệp vụ đã được cập nhật tại [prompt9a-function-retention.md](./prompt9a-function-retention.md), [functions-and-ui.md](./functions-and-ui.md) và [test-results.md](./test-results.md).

Ngày thực hiện: 23/11/2026. Phạm vi: giao diện và hỗ trợ kiểm thử Bước 5. Không sửa điều lệ, danh sách đội, fixture hay sơ đồ Bước 4; không triển khai nghiệp vụ Bước 6.

## Cấu trúc workspace

Workspace Bước 5 dùng năm công đoạn điều hướng tại chỗ: Sân & địa điểm; Thời gian & điều kiện; Tạo lịch; Kiểm tra & điều chỉnh; Hoàn tất & công bố. Mỗi lần chỉ hiện nội dung công đoạn đang chọn. Sidebar, header giải đấu và thanh tiến trình workflow vẫn do trang quản lý giải cung cấp.

Lập lịch tự động và rà soát/công bố hiển thị trực tiếp trong workspace. Chọn trận thủ công chuyển sang danh sách đã lọc các trận chưa xếp; chỉ mở drawer chi tiết khi chọn một fixture. Thiết lập sân và thiết lập thời gian mở theo từng công đoạn, dữ liệu vẫn dùng chung snapshot Bước 5.

Nhóm thiết lập hiện có được chia thành cơ bản và nâng cao; không xóa trường hoặc quy tắc. Hệ thống chỉ đưa giá trị mặc định vào trường rỗng khi trường đó không bị điều lệ khóa; giá trị được đánh dấu là đề xuất chưa xác nhận. BTC vẫn phải xem và lưu xác nhận trước khi lập lịch.

## Bảo vệ dữ liệu

- Danh mục sân/địa điểm dùng lại lưu riêng theo tài khoản BTC trong `sfl_scheduling`; migration mới là phiên bản `1006`.
- Reset development dùng DELETE có kiểm tra `expectedRevision`, xóa đúng snapshot Step 5 của giải hiện tại, đồng thời xóa dữ liệu trọng tài phụ thuộc nằm trong snapshot đó. Snapshot Bước 4 và preset sân dùng lại ở bảng riêng được giữ nguyên.
- Reset không báo thành công cho tới khi Match Service xác nhận. Lỗi hoặc xung đột revision được hiển thị thay vì cập nhật cache như thể đã lưu.
- Mở lại lịch công bố vẫn giới hạn ở development/test; backend kiểm tra quyền, revision và phiên bản sơ đồ, giữ lịch trong snapshot nháp và loại bỏ phân công phụ thuộc.

## Sai khác thể thức đã phát hiện

Giải đang mở có thông tin thể thức “Vòng tròn” nhưng snapshot Bước 4 là loại trực tiếp với 7 fixture. Bước 5 không tự sửa dữ liệu đó. Workspace hiển thị cả hai nguồn, giải thích sai khác và chặn thao tác tạo/lưu lịch mới cho tới khi thông tin nguồn được đồng bộ ở ngoài phạm vi Bước 5.

## Kiểm tra

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| Typecheck web-client | PASS | `pnpm --filter @sfl/web-client typecheck` |
| Typecheck Match Service | PASS | `pnpm --filter @sfl/match-service typecheck` |
| Docker build + migration | PASS | Image web-client, Match Service và các runtime phụ thuộc được build; migration job hoàn tất; không chạy seed job |
| Năm công đoạn và luồng hiển thị | PASS – desktop browser | Mở được cả năm công đoạn trực tiếp trong vùng quản lý giải; không có modal bao ngoài |
| Route preset đọc DB | PASS – read-only API | `GET /api/schedules/test-resource-presets` trả HTTP 200, `{state:null,version:0}` sau migration 1006 |
| Phân tích thiết lập hiện hành | PASS – read-only API | HTTP 200; 12 fixture vòng tròn; đề xuất 30 phút/hiệp; không còn cảnh báo ngày do so sánh date với timestamp |
| Lưu/nạp preset và Reset qua DB | NOT TESTED | Không tạo bản ghi preset hoặc reset snapshot để tránh thay đổi dữ liệu giải đang dùng |
| Responsive dưới 700px | NOT TESTED | Browser thực tế kiểm tra ở desktop; chưa chụp viewport mobile |
| Quyền, nhiều tab và lỗi phiên bản | NOT TESTED | Chưa kiểm tra mutation cạnh tranh |

## Vấn đề runtime cần xử lý tiếp

Trước bản build mới, `GET /schedules/test-resource-presets` bị route động `/schedules/:id` bắt trước và trả 500 do cố parse chuỗi `test-resource-presets` thành UUID. Route cụ thể đã được đưa lên trước route động; lần đọc sau migration trả 200.

Snapshot Step 5 hiện vẫn lưu giá trị hiệp 25 phút dù điều lệ quy định tổng 60 phút. Phân tích đề xuất 30 phút/hiệp và đang liệt kê 7 thông số cần BTC xác nhận; không tự ghi đè bản snapshot. Sân/địa điểm xác nhận vẫn bằng 0 nên hệ thống chưa cho tạo hoặc công bố lịch. Các thao tác ghi chưa chạy trong lượt kiểm tra này.

Browser vẫn có lỗi `ERR_INCOMPLETE_CHUNKED_ENCODING` trên stream thông báo `/api/notifications/events` sau khi container khởi động lại; không phải lỗi của API preset hoặc phân tích Step 5. Chưa xác định tác động tới thông báo thời gian thực.

