# Nghiệp vụ rút đội khỏi giải

## Quy tắc trạng thái

- Bản nháp trước khi gửi BTC được xóa bằng thao tác xóa draft; thao tác này không xóa CLB hoặc đội.
- Hồ sơ `PENDING`, `WAITLIST`, `REVISION_REQUIRED`, `NEEDS_SUPPLEMENT` hoặc `CONFLICT_ADJUSTMENT_REQUIRED` có thể được đội trưởng rút kèm lý do. Backend khóa theo hàng đợi giải, đọc lại trạng thái hiện tại, ghi quyết định qua registration outbox và chỉ hoàn tất khi Tournament service đồng bộ `WITHDRAWN`.
- Hồ sơ `APPROVED` chỉ tạo yêu cầu rút riêng. Suất và quyền cầu thủ tiếp tục được giữ cho tới khi BTC quyết định.
- Yêu cầu rút có trạng thái `PENDING`, `PROCESSING`, `APPROVED`, `REJECTED` hoặc `CANCELLED`; đội trưởng chỉ hủy được khi yêu cầu còn `PENDING`.
- Sau khi đồng bộ `WITHDRAWN`, lời mời `PENDING` chuyển `CANCELLED`, lời mời `ACCEPTED` chuyển `WITHDRAWN`; lịch sử lời mời và hồ sơ không bị xóa.
- `DISQUALIFIED` là một lý do loại riêng do BTC quyết định, không được đồng nhất với đội chủ động rút.

## API

- `POST /api/registrations/:id/withdraw`: đội trưởng rút hồ sơ chưa có quyết định BTC.
- `POST /api/registrations/:id/withdrawal-requests`: đội trưởng tạo yêu cầu rút hồ sơ đã duyệt.
- `GET /api/registrations/:id/withdrawal-requests`: đội trưởng/BTC xem lịch sử.
- `POST /api/withdrawal-requests/:requestId/cancel`: đội trưởng hủy yêu cầu còn chờ.
- `GET /api/tournaments/:tournamentId/withdrawal-requests`: BTC xem yêu cầu của giải.
- `POST /api/withdrawal-requests/:requestId/decision`: BTC chấp thuận hoặc từ chối.

Tất cả thay đổi đăng ký và reservation giữa Organization/Tournament được đồng bộ qua outbox và API nội bộ có xác thực. Migration `organization-service` v32 bổ sung trạng thái hủy cho yêu cầu rút; migration chỉ mở rộng constraint, không xóa dữ liệu.

## Giới hạn xử lý trận đấu

Tournament service hiện cho phép chấp thuận yêu cầu rút trước khi bảng đấu được xác nhận/công bố; nếu roster đã khóa, service tạo snapshot roster phiên bản mới. Sau khi draw đã xác nhận/công bố hoặc giải bước vào giai đoạn thi đấu, service từ chối quyết định chấp thuận với `WITHDRAWAL_REQUIRES_COMPETITION_CHANGE_WORKFLOW`. Hệ thống không tự xóa bảng/lịch, không sửa biên bản đã hoàn thành và không giả lập tỷ số xử thua.

Muốn hỗ trợ các trường hợp sau draw/đang thi đấu cần bổ sung giao dịch phối hợp có audit giữa Tournament và Match: BTC xem impact preview, chọn xử lý từng trận chưa diễn ra theo policy tỷ số lấy từ điều lệ, giữ nguyên hoặc yêu cầu sửa kết quả đã diễn ra theo điều lệ, cập nhật bracket/BYE, rồi mới giải phóng suất/cầu thủ. Hiện chưa triển khai giao dịch đó; yêu cầu phải giữ chờ và không được chấp thuận trong giao diện hiện tại.

## Kiểm chứng

Build TypeScript của Organization, Tournament, Match và API Gateway cùng build frontend được chạy sau thay đổi. Organization tests: 2 pass, 12 database-backed tests skipped do không có database test được cấu hình; vì vậy migration v32 và thao tác end-to-end chưa được xác minh trong runtime.
