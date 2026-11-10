# Tổng Quan Dự Án SFTMS - Trạng Thái Refactor

> Đích là năm backend services. Compose hiện chạy đúng năm backend runtime; điều này không đồng nghĩa mọi dữ liệu đã được nhập/gộp hoặc mọi nghiệp vụ đã đạt nghiệm thu production. Các database nguồn và mã legacy vẫn được giữ cho migration/rollback.

## 1. Kiến trúc runtime hiện tại

| Backend runtime | Port | Trách nhiệm hiện được phục vụ | Database nguồn còn sử dụng |
|---|---:|---|---|
| Auth | 3001 | Đăng ký, xác minh email, đăng nhập, refresh/logout, profile/user/admin APIs | `sfl_auth`, `sfl_user` |
| Organization | 3004 | Trường, đội, cầu thủ, membership, registration/roster legacy | `sfl_team` |
| Tournament | 3003 | Giải đấu, mùa giải, điều lệ, nhóm, draw và kỳ đăng ký | `sfl_tournament` |
| Match | 3005 | Trận, kết quả, BXH, lineups, lịch/sân/trọng tài và kỷ luật | `sfl_match`, `sfl_scheduling`, `sfl_discipline` |
| Notification | 3006 | Thông báo trong ứng dụng và gửi email tài khoản qua SMTP thật | `sfl_notification` |

API Gateway (`8080`) và web-client (`5173`) không tính là business backend services. Redis vẫn phục vụ session. Chỉ có năm thư mục backend trong `services/`. Năm migration jobs là one-shot runners: Auth xử lý cả `sfl_auth`/`sfl_user`, Match xử lý `sfl_match`/`sfl_scheduling`/`sfl_discipline`; chúng không phải application runtimes.

## 2. Tiến độ theo 5 services

| Service mục tiêu | Tiến độ | Còn lại |
|---|---|---|
| Auth | Auth phục vụ cả `/api/auth/**` và `/api/users/**`; User runtime đã được gỡ khỏi Compose. | `sfl_auth` và `sfl_user` chưa được nhập vào cùng database; auth vẫn là Redis session + opaque refresh cookie, chưa phải JWT access token. |
| Organization | Runtime Team được đổi tên; team/institution/player APIs giữ đường dẫn tương thích. | Registration và roster còn ở Organization/`sfl_team`, cần chuyển ownership sang Tournament. |
| Tournament | APIs độc lập; migration v2 và form tạo giải đã có thông tin ban tổ chức, phạm vi/trường, thể thức, giới hạn đội/cầu thủ, kỳ đăng ký, ngày giải, điều kiện tham gia và điều lệ có cấu trúc. Việc ghi giải + kỳ đăng ký + rules + tiêu chí xếp hạng dùng một transaction. | Chưa sở hữu registration/roster; chưa kiểm thử điều kiện/duyệt/chốt danh sách end-to-end. |
| Match | Lịch/sân/trọng tài và kỷ luật được mount trong Match; Gateway giữ nguyên API paths. | Ba database nguồn vẫn tách biệt; chưa nhập/copy dữ liệu hoặc nghiệm thu sửa/hủy kết quả và tính lại BXH xuyên workflow. |
| Notification | Auth gọi endpoint nội bộ được bảo vệ bằng API key; Notification gửi email tiếng Việt qua SMTP thật và ghi delivery log qua migration v2. Mailpit đã được loại khỏi Compose. | Cần xác minh giao nhận tới hộp thư bên ngoài được cung cấp; thông báo nghiệp vụ xuyên các service chưa triển khai đầy đủ. |

## 3. Bảo toàn dữ liệu và database

Các database legacy vẫn còn và không database nào bị xóa:

`sfl_auth`, `sfl_user`, `sfl_team`, `sfl_tournament`, `sfl_match`, `sfl_scheduling`, `sfl_discipline`, `sfl_notification`.

Auth runtime là owner duy nhất đang đọc/ghi hai database Auth/User; Match runtime là owner duy nhất đang đọc/ghi ba database Match/Scheduling/Discipline. Đây là giai đoạn chuyển tiếp, chưa phải data consolidation. Không xóa database/source service cho đến khi có migration idempotent, đối soát IDs/counts/quan hệ, kiểm thử tương thích và backup/restore đã diễn tập.

## 4. Kiểm thử và giới hạn

Kiểm thử đã thực hiện trong lượt refactor này:

- Full workspace TypeScript build và typecheck các service đã sửa.
- Tournament migration v2 chạy trên database hiện hữu và chạy lại thành công; một giải đấu hiện có được giữ nguyên.
- Tournament service API tạo thành công fixture tạm với registration period, rules và 3 tiêu chí xếp hạng; fixture được xóa sau test. Giới hạn đội không hợp lệ trả HTTP 400 và không ghi dữ liệu; tạo giải khi thiếu xác thực trả HTTP 401.
- Docker images Tournament/Web được build lại; frontend trả HTTP 200; năm backend, Gateway, PostgreSQL và Redis health checks đạt.
- Docker build và Compose `config --quiet`.
- Khởi chạy stack với Compose; năm backend, Gateway, PostgreSQL và Redis health checks đạt.
- Auth account workflow đã từng được kiểm thử qua Mailpit: đăng ký, chặn login chưa xác minh, xác minh email, login, profile, Viewer bị từ chối API Admin, quên/đặt lại mật khẩu, token reset dùng một lần và logout. Mailpit không còn trong runtime.
- Các database code đã hợp nhất vẫn là database riêng: Auth dùng `sfl_auth` và `sfl_user`; Match dùng `sfl_match`, `sfl_scheduling`, `sfl_discipline`. Không database nào bị xóa hoặc gộp.
- SMTP thật trong `.env` đã vượt qua kiểm tra kết nối và xác thực từ Notification container; chưa gửi thư đến hộp thư bên ngoài do chưa có địa chỉ nhận thử được cung cấp.
- Gateway/Match route isolation: `GET /api/disciplinary-decisions`, `GET /api/venues`, `GET /api/tournaments/{id}/cards` và `GET /api/players/{id}/tournaments/{id}/suspension` trả 200; `POST /api/venues` và `POST /api/cards` không session trả 401.
- `pnpm --filter @sfl/match-service typecheck`, `pnpm --filter @sfl/api-gateway typecheck`, và Docker builds cho Match/Gateway đều thành công; Compose validation đạt. Stack chạy năm backend, Gateway, PostgreSQL và Redis.

Chưa đạt/không được tuyên bố production-ready:

- Chưa xác minh thư được giao tới địa chỉ nhận bên ngoài cụ thể.
- Chưa chạy toàn bộ nghiệp vụ giải đấu và registration/roster sau refactor.
- Chưa chuyển dữ liệu sang database đích; database legacy được giữ nguyên.
- Chưa tích hợp RabbitMQ, OpenAPI/Swagger hoặc JWT access token; Redis/session-cookie vẫn là auth hiện tại.
- Cần tiếp tục kiểm tra authorization theo từng role và quyền sở hữu tài nguyên trên mọi route.

Xem [PROJECT_OVERVIEW.md](../PROJECT_OVERVIEW.md), [REFACTOR_8_TO_5.md](./REFACTOR_8_TO_5.md), [API_ROUTING.md](./API_ROUTING.md) và [PROJECT_AUDIT_AND_PLAN.md](./PROJECT_AUDIT_AND_PLAN.md) để biết chi tiết.

## 5. Tiếp tục kiểm thử phân quyền theo vai trò

Trong lượt tiếp tục này, không reset database/volume và không sửa migration. Compose đã chạy lại các one-shot migration phụ thuộc khi triển khai service; các job hoàn tất, không có thay đổi schema cần thiết. Match, Gateway, Organization và Tournament được build/deploy lại; toàn bộ Compose runtime services hiện Healthy.

- Đã sửa binding của hai Admin handler provision/resend staff activation; kiểm thử API tạo trùng email trả `409 EMAIL_EXISTS`, role tạo staff không hợp lệ trả `400 INVALID_ROLE`, và resend tài khoản BTC đang hoạt động trả `404` mà không gửi thư.
- Match kiểm tra BTC được phân công qua Tournament internal manager-access API, không truy cập database Tournament trực tiếp. Quyền này được áp dụng cho tạo/sửa/xóa trận, các mutation theo match, report review và thao tác lịch theo giải. Xóa match event hiện lấy match cha để kiểm tra phân công trước khi xóa.
- Organization chỉ cho BTC xem chi tiết/roster đội có đăng ký trong giải BTC được giao. Sửa hồ sơ đội và membership cầu thủ thuộc Admin/đội trưởng; cầu thủ đang ở đội được xem hồ sơ và roster của đội mình. API `/teams/my` trả đội do người dùng làm đội trưởng hoặc cầu thủ đang hoạt động.
- Frontend đã chuyển danh sách đội BTC sang giải được phân công, ẩn tạo đội/thêm cầu thủ đối với BTC và cầu thủ; Admin/đội trưởng giữ chức năng tương ứng.
- Kiểm thử qua Docker: đăng nhập và dashboard của ADMIN, BTC, TEAM_CAPTAIN, PLAYER, REFEREE và VIEWER thành công. Viewer bị `403` ở danh sách Admin; BTC bị `403` với giải/đội ngoài phạm vi; captain đọc đội mình thành công nhưng đọc/sửa đội khác bị `403`; player đọc đội/roster của mình thành công nhưng đọc đội khác hoặc thêm cầu thủ bị `403`; referee đọc lịch được giao thành công và match ID chưa được phân công bị `403`. Các probe mutation dùng dữ liệu không hợp lệ/không tồn tại để không ghi dữ liệu demo.
- Admin UI hiển thị danh sách 27 tài khoản. Tự hạ role Admin bị `409 SELF_ADMIN_CHANGE`.
- `pnpm run typecheck`, `pnpm run build`, `docker compose config --quiet` đều thành công. SMTP `transporter.verify()` thành công từ Notification container; phép kiểm tra chỉ xác thực kết nối, không gửi email.

### 5.1 Kết quả bổ sung: demo và phân quyền kỷ luật/đăng ký

- Chạy `demo-seed` trong Docker với `NODE_ENV=development`: kiểm tra 20 tài khoản, tạo mới 0 và không sửa tài khoản hiện hữu. DB xác nhận 20 user demo đang active/verified và password hash dùng bcrypt; hai đội có 7 cầu thủ mỗi đội, hai registration đã duyệt, 14 roster entries đã xác minh, 2 lịch có trọng tài, 1 kết quả và 2 standing rows.
- Sáu tài khoản đăng nhập được và gọi được API dữ liệu dashboard tương ứng: Admin `/api/users`, BTC `/api/my/tournaments`, Captain/Player `/api/teams/my`, Referee `/api/my/schedules`, Viewer `/api/tournaments` đều trả `200`.
- Sửa Gateway để gửi internal key ổn định qua proxy; nếu không, các request protected từ Gateway đến Match bị `401 Untrusted gateway request`.
- BTC: tạo suspension trên giải được giao đi qua kiểm tra quyền tới bước validation (`400` với ngày không hợp lệ); giải chưa được giao trả `403`.
- Captain: khiếu nại đội mình đi qua kiểm tra sở hữu tới validation (`400` mô tả rỗng); khiếu nại thay mặt đội khác trả `403`. Referee tạo card cho trận được phân công đi tới validation (`400` phút không hợp lệ). Các probe không ghi card/suspension/complaint/decision.
- Organization gọi Tournament internal API trước khi nhận đăng ký; Tournament kiểm tra trạng thái `OPEN_REGISTRATION`, kỳ đăng ký đang hiệu lực và trường được phép. Đăng ký vào demo tournament `IN_PROGRESS` bị từ chối `409 REGISTRATION_CLOSED`.
- Không thay đổi SMTP. Không gửi email đến hộp thư bên ngoài; transport verification trước đó chỉ chứng minh kết nối/xác thực SMTP, không chứng minh email được giao.

### 5.2 Ma trận 34 Use Case theo tài liệu bổ sung

Ma trận này theo số UC trong `Usecase_bo_sung_theo_quy_trinh_TO_DO_MAU_DO (1).docx`; UC 3.4.21 cũ có ghi “bỏ”, nên UC 21.1 “Bốc thăm chia bảng” được tính là UC 21 trong bảng dưới. Actor tài liệu được quy về sáu role hệ thống gần nhất; “đơn vị tổ chức” chỉ có quyền phù hợp khi được phân công, không mặc nhiên đồng nghĩa BTC có quyền toàn cục. `DONE` chỉ dùng khi có bằng chứng kiểm thử luồng; build/typecheck không được tính là nghiệm thu.

| UC | Tên theo tài liệu | Actor chính (role) | Trạng thái | Bằng chứng/giới hạn |
|---:|---|---|---|---|
| 1 | Đăng ký tài khoản | VIEWER / khách | PARTIAL | Đăng ký công khai tạo VIEWER, không còn nhận role PLAYER/CAPTAIN từ body; vẫn cần kiểm tra SMTP inbox thực tế sau thay đổi. |
| 2 | Xác minh email | VIEWER | PARTIAL | Token flow có; giao nhận email tới inbox bên ngoài chưa được xác minh. |
| 3 | Gửi lại email xác minh | VIEWER | PARTIAL | API có; chưa kiểm chứng giao thư tới inbox bên ngoài. |
| 4 | Đăng nhập | Cả sáu role | DONE | Sáu tài khoản demo đã đăng nhập và gọi API dashboard trong lượt kiểm thử trước. |
| 5 | Đăng xuất | Cả sáu role | DONE | Session logout đã được kiểm tra ở Auth workflow trước. |
| 6 | Quên mật khẩu và đặt lại mật khẩu | VIEWER / người dùng | PARTIAL | API/token có; SMTP delivery và đặt lại thực tế chưa kiểm tra lại trong lượt này. |
| 7 | Cập nhật thông tin cá nhân | Cả sáu role | PARTIAL | Trang tài khoản, cập nhật họ tên, đổi mật khẩu và yêu cầu đổi email đã xác minh được triển khai; chưa chạy acceptance test/SMTP inbox. |
| 8 | Quản lý tài khoản và phân quyền | ADMIN | PARTIAL | Quản lý tài khoản/staff có; Admin và BTC đọc được hàng chờ role application trên Docker, Viewer bị 403. Chưa thực hiện quyết định cấp role bằng fixture biệt lập. |
| 9 | Quản lý trường học và đơn vị tổ chức | ADMIN; BTC theo phạm vi | PARTIAL | Organization migration v10 đã chạy; Admin đọc được 8 trường TP.HCM, public form chỉ trả 4 trường ACTIVE có BTC. Viewer bị 403 ở API quản lý; chưa chạy CRUD/trạng thái trên fixture riêng. |
| 10 | Tạo đội bóng | TEAM_CAPTAIN; ADMIN | PARTIAL | Tạo đội và ràng buộc trường có; chưa chạy acceptance test trên dữ liệu biệt lập. |
| 11 | Quản lý danh sách thành viên | TEAM_CAPTAIN; ADMIN | PARTIAL | Organization migration v9 đã áp dụng; giao diện có bộ lọc JOIN/LEAVE, trạng thái/ngày/tìm kiếm, phân trang và lịch sử. Chưa chạy mutation duyệt/từ chối trong lượt này. |
| 12 | Gửi yêu cầu tham gia đội bóng | PLAYER | PARTIAL | UI/API có rút yêu cầu pending và gửi thông báo; runtime decisions và notification chưa kiểm thử lại trong lượt này. |
| 13 | Xét duyệt yêu cầu tham gia đội bóng | TEAM_CAPTAIN; ADMIN | PARTIAL | Ghi người duyệt/lý do, bắt buộc lý do từ chối, chống tự duyệt; mutation chưa được chạy để bảo toàn dữ liệu hiện có. |
| 14 | Tạo giải đấu | BTC | PARTIAL | Form/API/transaction có; chưa chạy lại workflow đầy đủ trên fixture mới. |
| 15 | Cấu hình giải | BTC; ADMIN/đơn vị được giao | PARTIAL | Rules/version API có; chưa xác nhận quy trình công bố trước đăng ký. |
| 16 | Xem thông tin giải đấu | VIEWER, PLAYER, TEAM_CAPTAIN | PARTIAL | Public detail/list có; chưa nghiệm thu đủ thông tin điều lệ và lọc trạng thái. |
| 17 | Đăng ký tham gia giải đấu | TEAM_CAPTAIN; BTC được phân công | PARTIAL | Màn hình gửi hồ sơ dùng API thật; backend kiểm tra mở đăng ký/trường; nhánh thành công chưa kiểm thử. |
| 18 | Xét duyệt hồ sơ tham gia giải đấu | BTC | PARTIAL | UI duyệt và API scope giải có; chưa chạy mutation hợp lệ trên fixture biệt lập. |
| 19 | Quản lý danh sách cầu thủ đăng ký theo giải | TEAM_CAPTAIN | PARTIAL | Roster API tồn tại; chưa nghiệm thu đủ thành viên/điều kiện hồ sơ. |
| 20 | Khóa danh sách đội tham gia giải | BTC | NOT IMPLEMENTED | Chưa có workflow khóa có kiểm tra pending, số đội tối thiểu và tính hợp lệ roster. |
| 21 | Bốc thăm chia bảng (UC 21.1 thay UC 21 bị bỏ) | BTC | PARTIAL | Group/draw API có; audit seed, cảnh báo trường trùng, lý do hủy và tái bốc thăm chưa được nghiệm thu. |
| 22 | Lập lịch thi đấu và phân công sân | BTC | PARTIAL | Scheduling/conflict API có; chưa chạy tạo và công bố lịch end-to-end. |
| 23 | Phân công trọng tài | BTC | PARTIAL | Assignment API có; thông báo trọng tài bận và kiểm tra xung đột chưa được nghiệm thu. |
| 24 | Xem lịch thi đấu | REFEREE, TEAM_CAPTAIN, PLAYER, VIEWER | PARTIAL | API đọc công khai/assigned schedule có; dashboard vừa được cải thiện nhưng chưa kiểm tra browser/runtime. |
| 25 | Ghi nhận diễn biến và kết quả trận đấu | REFEREE được phân công | PARTIAL | API ghi event/result có kiểm tra assignment; lineup lock, substitution/eligibility, abandoned match và audit event chưa hoàn thiện. |
| 26 | Xác nhận kết quả trận đấu | BTC | PARTIAL | API result/report có; xác nhận hai bên, deadline khiếu nại và khóa kết quả chưa nghiệm thu. |
| 27 | Cập nhật bảng xếp hạng và xác định đội đi tiếp | BTC; người xem | PARTIAL | Standings có dữ liệu; chỉ Verified result và logic tie-break/đội đi tiếp chưa kiểm tra xuyên suốt. |
| 28 | Ghi nhận thẻ phạt và xử lý kỷ luật | REFEREE/BTC theo quyền | PARTIAL | Card/suspension/discipline API có; tự động treo giò, kháng nghị và tính lại kết quả chưa nghiệm thu. |
| 29 | Gửi khiếu nại về trận đấu hoặc quyết định liên quan | TEAM_CAPTAIN | PARTIAL | Captain scope theo đội/trận đã kiểm tra; thời hạn khiếu nại và lifecycle đầy đủ chưa xác nhận. |
| 30 | Tiếp nhận và xử lý khiếu nại | BTC | PARTIAL | Scope BTC theo giải có; review hợp lệ, kỷ luật và tính lại BXH chưa chạy end-to-end. |
| 31 | Tra cứu đội bóng, cầu thủ và kết quả thi đấu | VIEWER, PLAYER, TEAM_CAPTAIN | PARTIAL | API public có; hồ sơ cầu thủ/roster và giao diện truy vấn cần kiểm tra thêm trên browser. |
| 32 | Quản lý thông báo | ADMIN/BTC/người dùng | PARTIAL | Bổ sung in-app events cho join/leave/review và nhắc quá hạn; chưa chạy runtime/API test sau thay đổi. |
| 33 | Hoãn, đổi lịch hoặc hủy trận đấu | BTC | PARTIAL | Endpoint scheduling hiện có; lý do, audit, thông báo và xử lý trận đã khóa chưa nghiệm thu. |
| 34 | Kết thúc giải đấu | BTC | NOT IMPLEMENTED | Chưa có cổng kiểm tra trận/khiếu nại, báo cáo, giải thưởng và trạng thái archive read-only hoàn chỉnh. |

### 5.3 Thay đổi mới trong lượt rà soát giao diện

- Auth migration v3 thêm bảng `role_applications` theo kiểu additive; đăng ký công khai chỉ cấp VIEWER. VIEWER gửi yêu cầu PLAYER/TEAM_CAPTAIN; ADMIN/BTC đọc và duyệt/từ chối, việc thêm role vào tài khoản và quyết định được commit cùng transaction. Người dùng phải đăng nhập lại sau khi được cấp role để phiên mới nhận quyền. SMTP hiện tại không bị thay đổi.
- Organization migration v4 bổ sung thông tin cần thiết cho yêu cầu tham gia đội. Captain xem yêu cầu thuộc đội mình; chấp thuận tạo membership transactionally, từ chối yêu cầu được ghi trạng thái; API chặn cầu thủ đã ở đội hoạt động khác và đội đã đủ số lượng.
- Form đăng ký TEAM_CAPTAIN thu thập loại đại diện (sinh viên/giảng viên/cán bộ/khác), khoa/phòng ban, chức vụ đội, minh chứng và cam kết; MSSV không bắt buộc. Auth API kiểm tra các trường đại diện, trong khi PLAYER vẫn phải có MSSV và thông tin học tập/tư cách cầu thủ. Đã kiểm tra qua giao diện và API: trường MSSV hiện dạng tùy chọn cho captain; request captain không MSSV đi đến kiểm tra trường (`400 INVALID_INSTITUTION` với mã trường thử không tồn tại), còn PLAYER thiếu MSSV bị `400 studentId is required`. Hai request thử không ghi hồ sơ vào DB. Đã bind handler route tới controller vì kiểm tra runtime phát hiện mất `this` khiến nhánh gửi hồ sơ báo lỗi 500.
- Frontend có màn role application, yêu cầu tham gia đội, xét duyệt membership, gửi đăng ký giải, duyệt registration và xem roster. Các màn này gọi API thật; đăng ký đội chỉ bật khi giải có trạng thái mở, còn hạn và điều kiện khác vẫn được backend kiểm tra.
- Full workspace `pnpm run typecheck` và `pnpm run build` đạt; Compose config hợp lệ. Docker stack được build/chạy lại mà không xóa volumes; PostgreSQL, Redis, năm backend và Gateway báo healthy, web trả HTTP 200.
- Auth DB ghi nhận migration version 3; Organization DB ghi nhận version 4. Sau kiểm thử, DB có 27 users, 0 role applications, 14 players, 0 player requests và 2 registrations — không có tài khoản demo hoặc dữ liệu nghiệp vụ hiện có bị ghi/sửa.
- Cả 6 demo account đăng nhập `200` và gọi API tương ứng `200`. Viewer đọc yêu cầu của mình `200`, bị `403` khi đọc hàng chờ duyệt; public registration gửi role TEAM_CAPTAIN bị `400`; Admin đọc queue `200`; Viewer gọi player-request API bị `403`; PLAYER đọc yêu cầu của mình `200`, payload thiếu tên trả `400`; captain đọc yêu cầu đội mình `200`; BTC đọc registrations và rosters giải được giao `200`.
- Browser kiểm tra Viewer dashboard/role application, BTC màn xét duyệt giải được giao, Captain màn review membership và đăng ký giải, Player màn membership một-đội. Nút đăng ký demo bị disable vì giải đang `IN_PROGRESS`; không gửi mutation thành công vào tài khoản/dữ liệu demo.
- Không chạy thành công submit/approve role application hoặc player/team registration trong lượt này để tránh thay đổi demo fixtures. SMTP không đổi và không gửi thư test; không có bằng chứng giao nhận inbox bên ngoài.
- Không sửa migration đã áp dụng, không reset database/volume, không thay đổi SMTP và không sửa seed/demo accounts.

Giới hạn còn lại: các UC `PARTIAL`/`NOT IMPLEMENTED` chưa được nghiệm thu; các bổ sung đỏ về audit draw, roster/lineup lock, xác minh cầu thủ, biên bản và xác nhận hai bên, complaint deadline/appeal, auto-suspension, reschedule notification, báo cáo/xuất dữ liệu và archive vẫn cần backend implementation hoặc kiểm thử riêng. Không xem build, health check hay dữ liệu seed là bằng chứng thay thế cho luồng nghiệp vụ thực tế.

### 5.4 Các yêu cầu tô đỏ trong DOCX

Các nội dung đỏ được đối chiếu với route/schema hiện có; nhóm dưới đây chưa được xác nhận end-to-end. Tính năng có route nền được ghi `PARTIAL`, phần không có state/API/audit đủ dùng được ghi `NOT IMPLEMENTED`.

| Nhóm bổ sung | Trạng thái | Còn thiếu hoặc chưa kiểm thử |
|---|---|---|
| Bốc thăm | PARTIAL | Chỉ đội đủ điều kiện được bốc; lưu random seed; cảnh báo mềm đội cùng trường; hủy và bốc lại cần lý do/audit. |
| Điều phối trọng tài | PARTIAL | Báo BTC khi trọng tài không khả dụng và kiểm tra xung đột lịch. |
| Đội hình và tư cách thi đấu | PARTIAL | Kiểm tra roster đủ điều kiện, khóa lineup, giới hạn thay người và thẻ đỏ gián tiếp. |
| Diễn biến/kết quả | PARTIAL | Truy vết người sửa event; xử lý thiếu cầu thủ, abandon; biên bản, xác nhận trọng tài và acknowledgment của hai đội. |
| Khiếu nại/kỷ luật | PARTIAL | Cửa sổ khiếu nại, treo giò tự động, thu hồi khi appeal được chấp nhận, rà soát quyết định và tính lại BXH. |
| Lịch và kết quả khóa | PARTIAL | Hoãn/đổi/hủy có lý do và thông báo; override trận đã khóa phải có audit; chỉ kết quả Verified được cập nhật BXH. |
| Kết thúc giải | NOT IMPLEMENTED | Gate kiểm tra trận/khiếu nại, trao giải, thống kê, báo cáo/xuất file và archive chỉ đọc. |

### 5.5 Workflow gán trường và yêu cầu tạo CLB

- **Đã triển khai:** Auth migration v4 bổ sung `users.institution_id`, `role_applications.institution_id` và `application_data`; Organization migrations v5-v6 bổ sung metadata trường, tên viết tắt đội và bảng `club_requests`. Gateway chuyển school ID/name lấy từ session đã xác minh. BTC role-application queue và Organization team/request access được giới hạn theo trường; phê duyệt yêu cầu CLB tạo đội trong transaction. Captain không còn quyền gọi trực tiếp API tạo đội.
- **Kiểm thử:** workspace `pnpm run typecheck`, `pnpm run build` và `docker compose --profile apps config --quiet` đạt. Organization/auth migrations đã chạy trên database hiện tại, không reset container/volume; trước migration, kiểm tra không có trùng tên đội trong cùng trường. Các service được cập nhật healthy, browser trả trang web với dashboard Player và dữ liệu lấy từ API.

### 5.6 Danh mục trường TP.HCM và bộ demo liên kết

- **Đã triển khai:** Organization migration v7 nạp danh mục trường có nguồn vào `institutions`; migration additive v8 đồng bộ bốn cơ sở HUTECH từ nguồn chính thức nhưng chỉ sửa địa chỉ nếu DB còn nguyên giá trị cũ đã biết. Auth migration v5 thêm `account_profiles` và `demo_account_registry`. Seed riêng `seedHcmSchoolDemo.ts` chỉ chạy khi `NODE_ENV=development`, hash mật khẩu bằng bcryptjs, insert-bỏ-qua và dừng nếu email/MSSV bị chiếm bởi tài khoản không thuộc seed. Mật khẩu, thông tin và trạng thái tài khoản demo cũ không bị cập nhật.
- **Danh mục:** DB hiện có 4 đại học, 4 cao đẳng TP.HCM với nguồn chính thức; ADMIN xem được cả 8 qua API quản lý. Public `GET /api/institutions` chỉ trả trường ACTIVE có BTC được gán (4 trường hiện tại). Đây là tập đã xác minh trực tiếp, chưa đủ bằng chứng để gọi là danh mục toàn diện. UEH/HITU chưa có địa chỉ hiện hành được xác nhận nên để `address = NULL`; không tự điền mã tuyển sinh.
- **Dữ liệu nghiệp vụ:** 26 tài khoản mới; 4 BTC được gán trường; 5 yêu cầu TEAM_CAPTAIN (2 approved, 2 pending, 1 rejected); 13 yêu cầu PLAYER (8 approved, 4 pending, 1 rejected); 3 Viewer-only (2 verified, 1 pending email). Có 2 CLB approved, 4 club requests pending, 2 đội approved với 3 cầu thủ PLAYER và 1 đội trưởng mỗi đội, cùng 3 trạng thái yêu cầu gia nhập. Chứng cứ dùng URL `.invalid` mang nhãn DEMO.
- **Kiểm thử thực tế:** Auth/Organization migrations chạy thành công; seed vừa chạy lại sau cùng tạo 0 account mới (26 demo accounts hiện hữu). 25/25 account verified đăng nhập HTTP 200; Viewer chưa xác minh bị HTTP 403. Browser đã đăng nhập lần lượt ADMIN, BTC, TEAM_CAPTAIN, PLAYER, REFEREE và VIEWER, xác nhận đúng dashboard và email tài khoản cho cả 6 vai trò. API: Admin users `200`; queue BTC IUH/HUTECH mỗi bên chỉ có yêu cầu trường mình; BTC duyệt khác trường `403`; captain sửa đội khác `403`; player xin vào đội thứ hai `409`; Viewer quản lý/Admin APIs `403`; lịch của referee có phân công `200` với 2 schedule. Catalog database có 8 trường TP.HCM; public API hiện trả 4 do lọc BTC assignment. Frontend HTTP `200`; PostgreSQL, Redis, backend và Gateway báo healthy, web-client đang chạy.
- **Lỗi được phát hiện và sửa trong quá trình kiểm thử:** Auth session profile ban đầu bỏ `institutionId`, làm BTC bị `SCHOOL_ASSIGNMENT_REQUIRED`; đã đưa lại school assignment trong auth profile. Tên tiếng Việt trong `x-user-name` gây HTTP header lỗi; Gateway hiện mã hóa base64url UTF-8 và Organization giải mã sau khi xác minh internal key.
- **Giới hạn:** hai school fixtures cũ vẫn còn trong database nhưng bị ẩn khỏi directory API, không xóa; các đội fixture cũ vẫn tồn tại. UEH/HITU chưa có địa chỉ hiện hành được xác nhận nên để `address = NULL`. Tài khoản `viewer.pending` cố ý không đăng nhập được. Không gửi email từ seed; không xác nhận giao thư SMTP đến inbox; các đội HCMC mới chưa gắn một registration mới vào tournament. Dashboard đã kiểm chứng từng vai trò, nhưng chưa chạy toàn bộ nghiệp vụ từng vai trò qua UI.

### 5.7 Tài khoản cá nhân và vòng đời thành viên

- **Đã triển khai trong source:** trang Tài khoản của tôi cho các role (gồm REFEREE), xem role/trường/MSSV/hồ sơ role, sửa họ tên/số điện thoại/địa chỉ, đổi mật khẩu qua API hiện có và yêu cầu đổi email. Student ID không còn được tự sửa; school, role và quyền không được self-service thay đổi. Email mới chỉ được áp dụng sau token xác minh 24 giờ, một lần, hash trong Auth DB; khi xác nhận, phiên hiện có bị thu hồi. Notification dùng SMTP đang cấu hình, không có mock.
- **Đã triển khai trong source:** Organization migration v9 bổ sung audit fields cho yêu cầu gia nhập và bảng yêu cầu rời đội; có rút yêu cầu pending, yêu cầu không trùng, quyết định/reviewer/thời gian/lý do, chống tự duyệt. Thành viên vẫn còn trong đội cho tới khi rời được duyệt. Duyệt rời bị chặn nếu player còn trên roster của giải chưa COMPLETED/CANCELLED. BTC chỉ xem/can thiệp yêu cầu quá 3 ngày nếu có quyền trường và được phân công giải. Nhắc đại diện mỗi 3 ngày; không có tự động rời đội. Notification nội bộ được ghi vào inbox người nhận.
- **Kiểm thử lượt này:** `pnpm run typecheck`, `pnpm run build`, Docker builds và Compose config đạt; Auth migration v6 và Organization migration v9 đã áp dụng thành công, additive, không reset DB/volume. Auth/Organization/Notification/Gateway/web health trả 200. Sáu role demo đăng nhập được; profile/profile-history/inbox trả 200. PLAYER đọc join/leave requests trả 200; TEAM_CAPTAIN đọc đội/yêu cầu rời đội của mình trả 200; VIEWER đọc leave API bị 403; BTC truy cập đội trường khác bị 403. Payload rời đội thiếu lý do trả 400; tự cấp role/sửa MSSV trả 403; email-change thiếu mật khẩu bị từ chối, mật khẩu sai trả 401, email hiện tại trả 409; token xác nhận sai trả 400. API trực tiếp sửa leftAt/xóa membership đang hoạt động trả 409. Browser đã render trang Tài khoản cho một session Viewer; không gửi mutation, không gửi email thử và chưa kiểm tra mọi dashboard trong lượt này.
- **Giới hạn:** luồng email-change SMTP chưa được gửi thử; rule kiểm tra departure hiện dùng trạng thái giải và sự hiện diện trong roster, vì tournament API chưa có rule riêng về chuyển/rời đội. Lịch sử quyết định membership được lưu cùng request, không có audit append-only cho nhiều lần xét xử. Các UC liên quan tiếp tục là `PARTIAL` cho đến khi kiểm tra end-to-end bằng fixture an toàn.
- **Chi tiết tài khoản, nguồn và lệnh chạy:** [DEMO_ACCOUNTS_AND_TESTING.md](./DEMO_ACCOUNTS_AND_TESTING.md). Seed mới dùng profile Compose riêng `hcm-demo`; chạy migration không reset database hoặc Docker volume. Các service được cập nhật healthy, frontend trả HTTP 200 và từng dashboard role hoạt động với tài khoản tương ứng.

### 5.8 Tra cứu chi tiết giải và danh bạ CLB

- **Đã triển khai:** Chọn “Khám phá giải đấu” hoặc chọn thẻ giải sẽ mở phần chi tiết lấy trực tiếp từ Tournament API, gồm nội dung giải, phạm vi/thể thức, thời gian/địa điểm, quy mô đội, BTC/liên hệ, trường được tham gia, điều kiện cầu thủ, quy tắc điểm/xếp hạng/kỷ luật/khiếu nại, đợt đăng ký, điều lệ và lịch sử phiên bản điều lệ. Routes đọc registration period và regulation được public qua Gateway nhưng vẫn yêu cầu internal key giữa Gateway và service.
- **Danh bạ đội/CLB:** Trang đội có tìm theo tên và lọc trường. Khách và VIEWER gọi `/api/public/teams`, endpoint chỉ trả đội đang hoạt động cùng trường/tên/mô tả, không trả dữ liệu captain/liên hệ/cầu thủ. Giao diện công khai không mở roster riêng tư.
- **Kiểm thử thực tế:** Gateway trả danh sách 6 đội public, chỉ có các trường hiển thị an toàn. API chi tiết trả rules và một registration period cho `SFL Development Demo Cup`; regulation documents và versions hiện bằng 0. Qua browser, “Khám phá giải đấu” mở đúng trang chi tiết gồm quy định cấu trúc và thời hạn đăng ký; lọc IUH chỉ còn IUH Eagles. API gọi không cần đăng nhập trả thành công; các service cập nhật healthy, typecheck/build và Compose config đạt.
- **Giới hạn dữ liệu:** giải demo hiện chưa có văn bản điều lệ hoặc version đã lưu, nên giao diện báo rõ BTC chưa đăng tải thay vì tự tạo nội dung. Có thể cập nhật regulation từ chức năng quản lý Tournament khi có điều lệ thật.
- **API/RBAC:** không có phiên trả `401`; Viewer và Player không được đọc queue (`403`); Captain đọc hồ sơ của mình (`200`) nhưng chưa được phép gửi khi chưa gán trường (`403`); Admin đọc queue (`200`). Trạng thái BTC và school assignment trong dữ liệu đã thay đổi ở các lượt sau; xem mục 5.9 để biết kết quả hiện tại.
- **Bảo toàn dữ liệu:** không sửa tài khoản demo, không tạo club request thử, không gửi email và không thay đổi SMTP. Trạng thái catalog và các assignment hiện hành được ghi ở mục 5.9.
- **Chưa hoàn thiện tại thời điểm ghi mục này:** chưa có catalog chính thức, tải tệp minh chứng an toàn, notification/nhắc SLA 24 giờ, hay kiểm thử approve/reject end-to-end bằng tài khoản BTC được gán trường. Các kết quả mới hơn của school assignment và review scope được ghi ở mục 5.9.

### 5.9 Quản lý trường, phân công BTC và trung tâm yêu cầu (cập nhật mới nhất)

- **Đã triển khai:** Organization migration v10 (`institution-lifecycle-and-audit`) bổ sung trạng thái `DRAFT`/`ACTIVE`/`SUSPENDED`, cho phép mã trường để trống và tạo bảng `institution_change_history`. Trường mới mặc định DRAFT; thao tác sửa/đổi trạng thái của ADMIN được ghi nhật ký. ADMIN có thể tìm/lọc, thêm/sửa trường, xem BTC được phân công và lịch sử, tạo BTC qua luồng kích hoạt SMTP hiện tại hoặc phân công tài khoản BTC sẵn có. Kích hoạt kiểm tra BTC đã được gán; không cho chuyển/gỡ BTC cuối cùng khỏi trường. Danh sách trường công khai yêu cầu trường TP.HCM, ACTIVE, `is_active` và có BTC. Auth và Organization xác minh qua API nội bộ dùng internal key, không truy cập database của nhau.
- **Đã triển khai:** Approval Center tách các yêu cầu PLAYER, TEAM_CAPTAIN và thành lập CLB, có tìm kiếm, lọc trạng thái/ngày, phân trang, xem hồ sơ và lịch sử xét duyệt. Màn quản lý thành viên tách yêu cầu JOIN và LEAVE, có các bộ lọc tương ứng và hiển thị người/thời điểm/lý do xử lý. Quyền sở hữu không thay đổi: đại diện đội duyệt gia nhập/rời đội; BTC chỉ can thiệp yêu cầu rời đội quá hạn đủ điều kiện.
- **Database hiện tại:** migration v10 đã chạy trên `sfl_team`; truy vấn xác nhận có migration v9 và v10. DB có 10 trường ACTIVE tổng cộng; 8 trường TP.HCM (4 đại học, 4 cao đẳng), còn danh sách công khai hiện trả 4 trường do chỉ 4 trường có BTC được gán. `institution_change_history` hiện có 0 dòng; migration/API tests không tạo trường thử hoặc đổi trạng thái trường.
- **Kiểm thử qua Docker/Gateway:** workspace typecheck/build, frontend build, Docker builds cho Auth/Organization/Gateway/Web và Compose config đều đạt. Organization migration hoàn tất; Auth, Organization và Gateway sau khi deploy đều healthy; Gateway và web-client trả HTTP 200. ADMIN đọc được 8 trường quản lý TP.HCM; Viewer bị từ chối API quản lý trường và hàng chờ xét duyệt với HTTP 403. BTC IUH nhận 9 yêu cầu vai trò/2 yêu cầu CLB, BTC HUTECH nhận 6/2; `institutionId` của tất cả bản ghi khớp trường gán trên tài khoản BTC. Không chạy thao tác duyệt/từ chối.
- **Giới hạn còn lại:** chưa thử tạo/sửa/kích hoạt/tạm khóa trường trên fixture riêng vì không có API xóa và giữ lại fixture sẽ làm thay đổi dữ liệu người dùng. Không kích hoạt gửi email thật; việc tạo BTC vẫn dùng SMTP hiện tại nhưng chưa xác minh thư tới inbox. Chưa thực hiện quyết định yêu cầu hoặc phát notification membership. UC 8, 9, 11–13 và 32 tiếp tục là `PARTIAL`: chức năng đã tích hợp và kiểm tra được danh sách/RBAC, nhưng thao tác quyết định và thông báo cần acceptance test bằng fixture kiểm soát.
- **Bổ sung yêu cầu cá nhân:** Auth migration v7 mở rộng trạng thái role application với `WITHDRAWN` và `withdrawn_at`. Chủ tài khoản có thể đọc chi tiết, sửa toàn bộ hồ sơ của yêu cầu PENDING và hủy yêu cầu; các thao tác cập nhật/hủy kiểm tra `user_id` và khóa hàng trong transaction. Vai trò xin cấp không đổi khi sửa; trường được kiểm tra lại ACTIVE và trường đã xác minh của tài khoản không thể bị thay đổi. Hồ sơ đã quyết định không thể sửa/hủy và không bị xóa.
- **API mới:** `PATCH /api/users/me/role-applications/:id` cập nhật trường/hồ sơ/message; `POST /api/users/me/role-applications/:id/withdraw` hủy, giữ nguyên lịch sử. Lịch sử của chủ đơn có thể lọc `WITHDRAWN` trong reviewer API; phần xét duyệt không đưa đơn đã hủy vào hàng chờ mặc định.
- **UI:** người dùng xem trạng thái, trường, thời điểm gửi/cập nhật/xét duyệt/hủy và chi tiết hồ sơ; PENDING có nút sửa/hủy kèm xác nhận. Khi chỉnh sửa, role bị khóa; biểu mẫu và kiểm tra backend vẫn áp dụng điều kiện bắt buộc riêng PLAYER/TEAM_CAPTAIN.
- **Kiểm thử phần cập nhật này:** `pnpm run typecheck`, `pnpm run build`, Compose config và Docker builds Auth/web đạt. Auth migration v7 đã chạy trên DB hiện tại. Fixture tạm riêng được dùng cho cả PLAYER và TEAM_CAPTAIN: tạo/xem/sửa thành công; tài khoản khác sửa nhận 404; hủy đổi sang WITHDRAWN; sửa sau khi hủy nhận 409. Sau kiểm thử, user fixture và các application liên quan đã được cascade-clean; số role applications trở về 20 ban đầu. Chưa sửa/hủy yêu cầu người dùng hiện có, không gửi email và không thay đổi SMTP.

### 5.10 Thông báo và hồ sơ công khai đội/cầu thủ (source update)

- **Đã triển khai trong source:** Notification API lọc theo từ khóa, trạng thái đọc và ngày, phân trang, đồng thời giới hạn mọi truy vấn theo user nhận thông báo. Repository chuyển dữ liệu DB sang DTO camelCase để trạng thái đọc/thời gian hiển thị đúng. Giao diện đăng nhập có chuông với badge, tối đa 10 thông báo gần nhất, đánh dấu tất cả đã đọc, mở chi tiết và trang hộp thư có lọc/phân trang. Guest không tải thông báo cá nhân; nút đăng ký nằm dưới đăng nhập và menu trường học ẩn với guest/VIEWER.
- **Đã triển khai trong source:** Organization có API directory filter theo trường/từ khóa và API chi tiết public riêng. DTO chi tiết chỉ trả trường/tên/mô tả/logo/đại diện công khai/giải đã duyệt và tên, số áo, vị trí, vai trò đội của thành viên; không trả MSSV, email, phone, DOB, minh chứng hay account ID. Tên/logo đội có thể mở chi tiết, cầu thủ mở thẻ chi tiết responsive.
- **Giới hạn dữ liệu/chức năng:** schema hiện không lưu ảnh riêng từng cầu thủ, tiểu sử cầu thủ hoặc thống kê thi đấu, vì vậy không thể hiển thị các nội dung đó; chưa thay schema để tránh dữ liệu bịa. Trang chi tiết team dùng tournament IDs từ registration APPROVED và tên giải từ dữ liệu Tournament đang tải ở client.
- **Kiểm chứng:** `pnpm run typecheck`, `pnpm run build`, Compose config và Docker deploy cho Organization/Notification/Web đều đạt; các service mới healthy, Gateway và Web trả 200. Public directory trả 7 đội; backend search `IUH` và school filter mỗi trả 2 đội. HUTECH Tigers trả 4 thành viên với đúng DTO display-only. API thông báo không đăng nhập trả 401; với tài khoản demo ADMIN, inbox/unread-count trả 200 (hiện chưa có thông báo), bộ lọc ngày không hợp lệ trả 400. UI bằng session VIEWER mở chi tiết đội/cầu thủ và trang thông báo; ở viewport 390px không có tràn ngang. Không tạo/xóa thông báo thử, không chạy migration, không gửi email/SMTP và không sửa fixture nghiệp vụ.
- **Giới hạn kiểm chứng:** do inbox hiện rỗng nên chưa kiểm chứng trực tiếp hiển thị/đánh dấu đọc trên một notification record thực tế; không thêm dữ liệu tạm vào DB chỉ để tạo demo. Chưa kiểm tra mọi vai trò, trình duyệt/thiết bị, hay mutation API.
- **Phạm vi chưa hoàn tất:** yêu cầu chuẩn hóa form mọi module và backend search/filter mọi màn danh sách là rộng hơn phần đã cập nhật; mới có API search/filter cho danh bạ đội và thông báo, không tuyên bố các biểu mẫu/list khác đã được chuẩn hóa hoặc phân trang backend đầy đủ.

### 5.11 Hồ sơ đăng ký giải kèm đội hình (source update)

- Đội trưởng gửi ghi chú hồ sơ và roster cùng một lần nộp đơn. Roster ghi vai trò đá chính/dự bị, thủ môn, và dùng dữ liệu cầu thủ hiện có (họ tên, MSSV, ngày sinh, vị trí, số áo, email và minh chứng) để BTC kiểm tra.
- Backend yêu cầu roster, chỉ nhận cầu thủ đang thuộc đội, không trùng, giới hạn theo số cầu thủ đăng ký của đội và tối đa 30; đội hình xuất phát phải có 7 hoặc 11 cầu thủ với đúng một thủ môn. Việc tạo roster theo lô dùng transaction; nếu không lưu được roster thì hồ sơ đăng ký được thu hồi và giải phóng reservation.
- Organization migration v14 thêm vai trò đội hình/thủ môn vào roster, không sửa migration đã áp dụng và không xóa dữ liệu. BTC xem được thông tin trường, đơn vị, đại diện, liên hệ, ghi chú và từng dòng roster để duyệt cầu thủ.
- Đã xác minh frontend Vite build và typecheck; organization-service typecheck đạt. Chưa chạy migration v14 hoặc kiểm thử luồng mutation qua Docker/UI trong lượt này; cần triển khai organization-service kèm migration để API nhận các trường mới.

### 5.12 Xung đột thời gian giữa các giải của cùng đội (source update)

- Khi nộp hồ sơ, tournament-service từ chối nếu đội đã được duyệt vào giải khác có khoảng ngày tổ chức giao nhau. Khi BTC duyệt, service khóa theo đội và kiểm tra lại lịch trong transaction để tránh hai quyết định đồng thời lọt qua.
- Nếu giải sắp duyệt giao lịch với hồ sơ PENDING của cùng đội, hồ sơ PENDING kia tự chuyển WITHDRAWN ở reservation và organization DB; ghi chú hồ sơ nêu lý do tự rút để đội trưởng biết. Nếu đã có hồ sơ APPROVED giao lịch, thao tác duyệt bị từ chối với mã `TEAM_TOURNAMENT_DATE_CONFLICT`. Không cho duyệt giải thiếu ngày bắt đầu/kết thúc.
- Quy tắc hiện dựa trên khoảng ngày bắt đầu/kết thúc toàn giải vì hệ thống chưa có lịch trận hoàn chỉnh tại thời điểm nộp/duyệt. Điều này cố ý thận trọng: hai giải có khoảng thời gian tổng thể chồng nhau sẽ bị xem là xung đột dù các trận cụ thể có thể xếp khác ngày.
- Chưa deploy/build Docker, chưa chạy acceptance test với database đang dùng. Thay đổi không cần migration; cần build/deploy tournament-service và organization-service đồng thời để giữ trạng thái reservation và hồ sơ khớp nhau.
