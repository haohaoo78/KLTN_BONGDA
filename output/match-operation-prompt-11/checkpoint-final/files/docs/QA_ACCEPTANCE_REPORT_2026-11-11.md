# Báo cáo kiểm thử SFTMS (11/11/2026)

## Kết quả lượt kiểm tra hiện tại

Đã khởi động và kiểm tra Docker stack đang sử dụng, xác nhận đăng nhập cho sáu vai trò, gắn bộ fixture demo cũ vào trường IUH/HUTECH thật trong catalog, và kiểm tra một số API có/không có quyền. Đây **chưa phải nghiệm thu E2E toàn bộ quy trình tổ chức giải**.

Không reset DB, không xóa volume và không thay đổi SMTP. Seed chạy hai lần; cả hai lần đều kiểm tra 20 tài khoản và không tạo tài khoản mới.

## Bằng chứng đã kiểm tra

| Hạng mục | Kết quả |
|---|---|
| Auth service typecheck/build sau cập nhật demo seed | Đạt |
| Workspace typecheck/build các package | Đạt ở lượt kiểm tra trước trong cùng phiên làm việc |
| Match service tests | 22/22 đạt; gồm kiểm thử PostgreSQL đồng thời |
| Organization DB integration tests | 3/3 đạt với PostgreSQL thật: MSSV trùng bị chặn; quyết định cạnh tranh được serialize; outbox chịu được lỗi giao hàng và retry |
| Match DB migration v5 | Áp dụng thành công trên DB hiện tại; migration additive |
| Docker Compose runtime | PostgreSQL, Redis, Gateway và 5 backend service đều healthy; web-client đang chạy; `tournament-service` đã được cập nhật image sau sửa hạn đăng ký và điều kiện khóa roster |
| Quyết định đăng ký đồng thời | `organization-service` đã được build và cập nhật image; container healthy sau thay đổi serialize quyết định |
| Seed demo development | Hai lần chạy thành công; 20 tài khoản được kiểm tra, 0 tài khoản được tạo mới |
| Đăng nhập sáu vai trò và API dashboard | 6/6 đăng nhập thành công; endpoint theo vai trò trả 200 |
| BTC được phân công xem danh sách giải | Trước sửa trả `total=0`; sau sửa trả `total=1`, gồm `SFL Development Demo Cup` |
| RBAC âm | VIEWER đọc `/api/users` bị chặn với 403 |
| Kết quả trận công khai | GET kết quả trận đã duyệt không cần đăng nhập trả 200 |
| Trình duyệt admin | Đăng nhập thành công; trang tổng quan hiển thị giải, trận, bảng xếp hạng và đội từ DB |
| Lập lịch đồng thời | PostgreSQL integration: hai yêu cầu cùng sân chỉ một yêu cầu thành công; vi phạm thời gian nghỉ tối thiểu của đội bị chặn |
| Hạn đăng ký giải | 5/5 unit test: ngày cuối được bao gồm trọn ngày theo múi giờ Việt Nam, đóng đúng 00:00 ngày kế tiếp, giữ nguyên mốc giờ chính xác với timestamp |
| Điều kiện chốt roster | 2/2 unit test: chặn snapshot khi có roster entry chưa được duyệt/hợp lệ; cho phép khi toàn bộ danh sách đã được duyệt |

Các tài khoản được kiểm tra: `admin.demo`, `btc.demo`, `captain.demo`, `player.demo`, `referee.demo`, `viewer.demo` trên miền `football.local`. Cả sáu đang active và `email_verified=true`; không cần gửi email xác minh thật cho tài khoản demo đã xác thực.

### Liên kết dữ liệu demo

- `btc.demo`, `captain.demo` và `player.demo` được liên kết tới IUH. `admin.demo`, `referee.demo` và `viewer.demo` giữ vai trò toàn cục/không gắn trường.
- `SFL Demo North` thuộc IUH, do `captain.demo` điều hành, có 7 cầu thủ; `player.demo` nằm trong đội.
- `SFL Demo South` thuộc HUTECH, có 7 cầu thủ.
- Giải `SFL Development Demo Cup` giữ nguyên đăng ký, roster, trận, kết quả, standings và lịch trọng tài; danh sách trường được phép được đổi từ hai ID trường giả sang IUH và HUTECH.
- BTC demo đã được seed làm organizer của giải fixture; trọng tài demo vẫn được phân công các trận fixture hiện có.
- Seed từ chối tự sửa tài khoản đã gắn với trường khác và kiểm tra tên/đội trưởng của ID fixture trước khi đổi quan hệ trường.

### API đăng nhập và quyền đọc đã thử

| Tài khoản | Endpoint | HTTP |
|---|---|---:|
| ADMIN | `/api/users` | 200 |
| BTC | `/api/my/tournaments` | 200 |
| TEAM_CAPTAIN | `/api/teams/my` | 200 |
| PLAYER | `/api/teams/my` | 200 |
| REFEREE | `/api/my/schedules` | 200 |
| VIEWER | `/api/tournaments` | 200 |
| VIEWER | `/api/users` | 403 |

Gateway cũng được sửa để cho phép khách chưa đăng nhập đọc endpoint kết quả trận công khai; service chỉ trả kết quả khi đã APPROVED. GET kết quả fixture đã duyệt trả 200.

## Thay đổi source trong lượt này

- [seedDemo.ts](../services/auth-service/src/db/seedDemo.ts): seed idempotent gắn BTC/captain/player demo vào IUH, gắn hai đội fixture với IUH/HUTECH và đồng bộ allowed-school list của giải fixture. Tài khoản hiện có không bị đổi mật khẩu, vai trò hoặc trường khác.
- [organizerRepository.ts](../services/tournament-service/src/repositories/organizerRepository.ts): danh sách giải của BTC nhận cả giải được gán trong `tournament_organizers`, không chỉ giải có `created_by` trùng user.
- [index.ts](../apps/api-gateway/src/index.ts): GET kết quả trận công khai không bắt buộc session; các thao tác Match khác vẫn qua middleware xác thực.
- [MatchOperationsPanel.tsx](../apps/web-client/src/components/MatchOperationsPanel.tsx): giao diện diễn biến/đính chính sự kiện trận đã được thêm ở giai đoạn trước.
- [schedulingRepository.ts](../services/match-service/src/scheduling/repositories/schedulingRepository.ts) và [schedulingService.ts](../services/match-service/src/scheduling/services/schedulingService.ts): tạo/cập nhật lịch khóa các tài nguyên sân, trận, đội và trọng tài trong transaction, rồi kiểm tra lại xung đột và thời gian nghỉ trước khi ghi. Integration test dùng hai database thật và dọn fixture sau khi chạy.
- [schedulingConflicts.integration.test.cjs](../services/match-service/tests/schedulingConflicts.integration.test.cjs): kiểm tra cạnh tranh đặt cùng sân và thời gian nghỉ đội với PostgreSQL.
- [registrationPeriod.ts](../services/tournament-service/src/services/registrationPeriod.ts): ngày date-only được diễn giải theo múi giờ Việt Nam; ngày cuối bao gồm đến 23:59:59.999, timestamp có giờ cụ thể giữ nguyên thời điểm kết thúc.
- [registrationPeriod.test.cjs](../services/tournament-service/tests/registrationPeriod.test.cjs): kiểm thử biên bắt đầu/kết thúc, ngày cuối và dữ liệu ngày không hợp lệ.
- [rosterReadiness.ts](../services/tournament-service/src/services/rosterReadiness.ts): bước chốt roster từ chối snapshot nếu số hồ sơ cầu thủ không khớp số hồ sơ đã được duyệt/xác minh.
- [rosterReadiness.test.cjs](../services/tournament-service/tests/rosterReadiness.test.cjs): kiểm thử roster có mục chưa duyệt/bị từ chối và roster đã duyệt đầy đủ.
- [teamRepository.ts](../services/organization-service/src/repositories/teamRepository.ts): quyết định duyệt/từ chối khóa các hồ sơ chờ của cùng đội theo thứ tự ổn định, đồng bộ Tournament khi khóa còn giữ, ghi trạng thái đích và các hồ sơ tự rút trong một transaction Organization.
- [registrationDecision.integration.test.cjs](../services/organization-service/tests/registrationDecision.integration.test.cjs): với PostgreSQL thật, hai quyết định ngược nhau đồng thời chỉ cho một quyết định thắng và chỉ gọi đồng bộ Tournament một lần.

## Chưa kiểm chứng / còn giới hạn

Chưa chạy toàn bộ quy trình qua giao diện/API/database từ đăng ký tài khoản mới đến kết thúc giải. Các luồng sau vẫn cần E2E riêng với fixture có thể khôi phục:

- Xác minh và giao thư SMTP vào mailbox thật; các tài khoản demo đã verified nên không gửi email trong lượt này.
- Gửi/duyệt yêu cầu vai trò và tạo/duyệt đội mới. Đồng thời duyệt/từ chối một hồ sơ giải đã kiểm thử với PostgreSQL, nhưng chưa chạy end-to-end qua Tournament service thật trong bài test cạnh tranh.
- Đăng ký giải đang mở với roster mới, kiểm tra đội/trường/cầu thủ trùng, chốt roster và snapshot.
- Chia bảng/bracket cho cả ba thể thức, seed, BYE, số đội lẻ và tải lại bản nháp đã lưu.
- Sinh lịch, thử xung đột sân/đội/thời gian nghỉ; phân công nhiều trọng tài và phân quyền từng người.
- Trọng tài ghi sự kiện/biên bản thật; BTC duyệt/từ chối; cập nhật standings/nhánh; xử lý hoãn, hủy, khiếu nại, sửa kết quả và kết thúc giải.
- Kiểm thử đồng thời đã xác nhận cho đặt cùng sân và thời gian nghỉ đội. Retry outbox đã kiểm thử ở Organization DB; chưa kiểm thử restart/lỗi mạng xuyên HTTP giữa hai service, mọi dạng cập nhật lịch, responsive và console/network của từng vai trò.
- Hạn đăng ký date-only đã kiểm thử theo múi giờ Việt Nam; timestamp có giờ cụ thể và các biên ngày đã được unit test. Chưa kiểm thử vận hành cho giải đặt tại múi giờ ngoài Việt Nam.
- Quyết định BTC đồng thời trước đây được kiểm thử bằng callback mô phỏng; bản hiện tại đã chuyển sang durable outbox và cập nhật đồng bộ Organization sau khi Tournament xác nhận, không giữ transaction DB qua lời gọi mạng.

## Cập nhật tiếp theo: outbox đồng bộ quyết định đăng ký

- Organization migration v15 thêm `team_registration_decision_outbox`; trạng thái quyết định được commit trước khi gọi Tournament, worker thử lại theo backoff và thu hồi lease PROCESSING cũ sau khi process khởi động lại.
- BTC không thể gửi quyết định thứ hai cho cùng đội khi còn sự kiện đang đồng bộ. Trạng thái đăng ký địa phương chỉ đổi sau khi Tournament xác nhận; lỗi nghiệp vụ được giữ ở FAILED để BTC có thể xử lý lại, lỗi hạ tầng được retry.
- Tournament phản hồi lại các hồ sơ đã WITHDRAWN trùng lịch khi retry duyệt, để Organization có thể khôi phục cập nhật nếu phản hồi đầu tiên bị mất.
- Có integration test mới bao phủ ghi outbox, lỗi chuyển tiếp, retry và commit trạng thái cuối bằng PostgreSQL thật: [registrationDecisionOutbox.integration.test.cjs](../services/organization-service/tests/registrationDecisionOutbox.integration.test.cjs).
- **Đã kiểm chứng source/database:** Organization và Tournament typecheck/build thành công; Organization migration v15 áp dụng trên `sfl_team`; Organization PostgreSQL integration 3/3 pass (bao gồm retry outbox và kiểm tra MSSV); Tournament test 7/7 pass.
- **Chưa deploy Docker hoặc chạy E2E HTTP xuyên hai service**: Docker CLI không có trong PATH của môi trường này. Outbox test sử dụng PostgreSQL thật nhưng giả lập lỗi giao hàng ở tầng repository; chưa tắt/restart Tournament service thật để kiểm tra retry qua mạng.
- Lần chạy migration đầu đã nhắm nhầm database mặc định `postgres` do dùng `POSTGRES_DB` trong `.env`. Kiểm tra lịch sử cho thấy migration 1–14 ở đó đã tồn tại từ trước; chỉ migration v15 mới vừa được thêm. Tôi đã hoàn tác đúng bảng/outbox v15 và dòng lịch sử v15 trong `postgres`, không đụng tới migration/dữ liệu cũ. Sau đó áp dụng v15 đúng trên `sfl_team` và chạy integration tests ở database đó.

Do đó không kết luận hệ thống đã sẵn sàng production hoặc đã đạt nghiệm thu nghiệp vụ toàn diện. Xem thêm [PROJECT_STATUS_OVERVIEW.md](./PROJECT_STATUS_OVERVIEW.md) và [PROJECT_AUDIT_AND_PLAN.md](./PROJECT_AUDIT_AND_PLAN.md).
