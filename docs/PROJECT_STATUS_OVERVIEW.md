# Tổng Quan Dự Án SFTMS - Trạng Thái Refactor

> Đích là năm backend services. Compose hiện chạy đúng năm backend runtime; điều này không đồng nghĩa mọi dữ liệu đã được nhập/gộp hoặc mọi nghiệp vụ đã đạt nghiệm thu production. Các database nguồn và mã legacy vẫn được giữ cho migration/rollback.

## 1. Kiến trúc runtime hiện tại

### Cập nhật Bước 6 — Prompt 1 ngày 25/11/2026

Đã triển khai tab **Đội ngũ trọng tài** bằng API Auth/Match/Notification và PostgreSQL thật: tra cứu tài khoản, thêm quyền REFEREE mà giữ các vai trò cũ, thêm/sửa hồ sơ theo giải, thông tin nâng cao và trạng thái gửi email. Ba tab Cấu hình trọng tài, Phân công, Công bố & theo dõi chỉ hiển thị chưa triển khai. Không có quy trình mời nhận việc/xác nhận/từ chối.

Đã kiểm chứng Chrome desktop/mobile, API thật trên giải DEMO, lưu/reload, chống trùng, lỗi SMTP giữ hồ sơ, 37 kiểm thử đơn vị và hai kiểm thử PostgreSQL cô lập PASS. Migration bổ sung Auth v9, Match scheduling v1009, Notification v7 đã áp dụng sau sao lưu; không xóa dữ liệu/volume.

SMTP **chưa PASS gửi thư**: kết nối/xác thực Gmail thành công nhưng máy chủ từ chối ở DATA với `550 5.4.5` (hạn mức gửi). Hồ sơ `haohaao78@gmail.com` đã lưu, chưa kích hoạt; trạng thái gửi FAILED được giữ đúng. Chưa xác nhận nhận thư Gmail hoặc thao tác kích hoạt từ hộp thư. Không tự đổi cấu hình SMTP hay giả lập gửi thành công. Chi tiết: [báo cáo Bước 6](./step6-referee-team-qa-20261125/report.html).

### Cập nhật Bước 4 ngày 24/11/2026

Giao diện sơ đồ từ checkpoint `788015c` được dùng cho cả bản nháp và bản công bố trên Docker chính thức cổng `5173`, kết nối API Tournament/Match và PostgreSQL nghiệp vụ. Đã kiểm chứng 12 trận vòng tròn hai lượt, 15 trận knockout, giữ ID sau gọi lại/reload, mở khóa Bước 5 và chặn tài khoản đội trưởng (403). Có 39 bài kiểm tra thuật toán và 20 bài tích hợp PostgreSQL riêng PASS, gồm BYE và liên kết nguồn đi tiếp.

Chưa nghiệm thu toàn bộ Bước 4 cho thể thức kết hợp trên giải chính thức: giải demo chưa công bố Bước 3. Chưa đối chiếu trực quan đầy đủ với cổng khôi phục `15173`: snapshot tại đó chưa có công bố Bước 3, Bước 4 còn khóa; source checkpoint và đủ 221 khối CSS sơ đồ đã được đối chiếu. Chi tiết, ảnh chụp và các giới hạn: [báo cáo Bước 4](./step4-official-qa-20261124/README.md).

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

## 5. Bản nháp và công bố sơ đồ trận (18/11/2026)

Match service hiện phân biệt `DRAFT` và `PUBLISHED` cho mỗi generation (`GROUP`/`KNOCKOUT`). Fixture mới sinh ở trạng thái nháp; BTC xem qua API có kiểm tra quyền sở hữu giải, sau đó công bố theo giai đoạn. Match lists, bracket, match details, live lists, lineups, events, reports và result reads công khai ẩn fixture chưa công bố. Lập/cập nhật lịch từ fixture nháp bị backend từ chối. Match migration v18 thêm metadata công bố theo kiểu additive; các generation cũ mặc định `PUBLISHED` để bảo toàn khả năng tra cứu dữ liệu hiện hữu.

Kiểm tra lượt này: TypeScript typecheck Match service và web-client thành công; Match service TypeScript build thành công; Vite production build thành công (có cảnh báo bundle JavaScript lớn hơn 500 kB). Chưa chạy migration trên DB hoặc Docker vì các CLI `pnpm` và `docker` không có trong PATH của terminal lượt này. Chưa chạy E2E nghiệp vụ phát hành fixture và lập lịch với tài khoản BTC/người xem.

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
| 17 | Đăng ký tham gia giải đấu | TEAM_CAPTAIN | PARTIAL | Đội trưởng gửi hồ sơ đội kèm roster từ lời mời đã ACCEPTED; Tournament kiểm tra cửa sổ đăng ký, phạm vi trường, hạn mức và reservation. API E2E qua database thật đã chạy ngày 12/11; chưa nghiệm thu lại toàn luồng UI trên dữ liệu sạch và chưa xác minh đầy đủ mọi điều kiện theo điều lệ. |
| 18 | Xét duyệt hồ sơ tham gia giải đấu | BTC được phân công | PARTIAL | BTC quyết định trên toàn bộ hồ sơ đội: APPROVED, REJECTED hoặc REVISION_REQUIRED; quyết định có lịch sử, outbox đồng bộ Tournament và thông báo đội trưởng. API E2E đã chạy ngày 12/11. Không có duyệt/từ chối từng cầu thủ trong luồng này; chưa nghiệm thu UI và các lỗi phục hồi khi một service gián đoạn. |
| 19 | Quản lý roster đăng ký theo giải | TEAM_CAPTAIN; BTC đọc hồ sơ | PARTIAL | Lời mời và phản hồi cầu thủ được lưu; hồ sơ nộp lưu snapshot/version, thay đổi bị giới hạn sau khi gửi và captain có thể gửi lại khi BTC yêu cầu bổ sung. Cần nghiệm thu các điều kiện số lượng, đội hình theo từng thể thức và thay thế cầu thủ xuyên suốt UI/API. |
| 20 | Chốt danh sách đội tham gia giải | BTC được phân công | PARTIAL | Tournament có chuyển trạng thái ROSTER_LOCKED và tạo snapshot sau khi kiểm tra đội APPROVED, phạm vi trường, số lượng roster, đội hình xuất phát/thủ môn và hạn mức trường. Unit test readiness đã có; chưa thực hiện thao tác khóa thành công trên giải fixture hoặc nghiệm thu ảnh hưởng tới draw. |
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
| 34 | Kết thúc giải đấu | BTC | PARTIAL | Có gate yêu cầu mọi trận có kết quả và biên bản được duyệt trước khi chuyển COMPLETED; chưa có quy trình kết thúc đầy đủ gồm khiếu nại còn mở, trao giải, báo cáo/xuất dữ liệu và archive chỉ đọc. |

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

### 5.13 Duyệt hồ sơ giải và khóa roster (source update)

- BTC là người tạo giải tải danh sách đăng ký theo giải, có lọc trạng thái/trường/từ khóa, mở roster trong modal và xác nhận trước khi duyệt/từ chối. Quyết định cập nhật hàng đang hiển thị ngay sau phản hồi thành công; backend kiểm tra quyền sở hữu giải.
- Trước khi duyệt đội, Organization yêu cầu roster được gửi và mọi cầu thủ trong hồ sơ đã được BTC duyệt. Tournament kiểm tra số lượng cầu thủ theo điều lệ của giải, số đá chính theo 7/11 người và đúng một thủ môn đá chính. Roster đã xác minh được dùng tiếp ở bước chia bảng.
- Bước chốt danh sách kiểm tra giải đã đóng đăng ký, đạt số đội tối thiểu, không còn đơn chờ và roster các đội đã duyệt đủ số cầu thủ tối thiểu; yêu cầu xác nhận trước khi khóa. Backend vẫn là nơi quyết định cuối cùng và kiểm tra điều kiện chuyển trạng thái.
- Tài khoản có role ADMIN bị từ chối ở quyền quản lý tournament, kể cả khi token đồng thời có role BTC; quyền yêu cầu assignment BTC cụ thể của giải. Bảo vệ được áp dụng ở Tournament và Organization.
- Tại thời điểm cập nhật mục 5.13, API loại trực tiếp chưa hỗ trợ. Phần KNOCKOUT đã được triển khai tiếp ở mục 5.20; thể thức kết hợp vẫn chưa hoàn chỉnh.
- Kiểm tra trong source: TypeScript `--noEmit` đạt cho tournament-service, organization-service và web-client. Chưa chạy acceptance API trên DB đang dùng, chưa build/deploy Docker và chưa có bộ kiểm thử tổ hợp 6/8/10/12/16 đội, bye, hạt giống, ràng buộc cùng trường hoặc lưu/tải draw. Không có migration trong cập nhật này.

### 5.14 Khóa roster trùng cầu thủ và kiểm thử vòng tròn (source update)

- Organization tuần tự hóa việc thêm cầu thủ vào roster theo giải và danh tính tài khoản/MSSV trong transaction. Roster bị từ chối nếu cùng người đã có trong hồ sơ PENDING hoặc APPROVED của đội khác ở cùng giải; đơn REJECTED/WITHDRAWN không giữ chỗ. Cả thêm từng cầu thủ lẫn gửi roster theo lô đi qua cùng kiểm tra. Không cần migration; truy vấn sử dụng dữ liệu player và trạng thái đăng ký do Organization sở hữu.
- Match xuất hàm sinh lịch vòng tròn thuần để kiểm thử: 5, 6, 7, 8, 10, 12, 16 đội, một/hai lượt, số trận, cặp đấu không trùng, không xếp một đội hai lần trong vòng; đội lẻ nhận đúng một lượt nghỉ.
- Kiểm thử đã chạy: `services/match-service/tests/fixtureGenerationService.test.cjs` 14/14 pass. Integration test Organization dùng hai đội và cùng MSSV trong fixture tạm, xác nhận hồ sơ thứ hai nhận `DUPLICATE_TOURNAMENT_PLAYER` (1/1 pass); fixture được xóa trong `finally`. TypeScript build Organization/Match đạt.
- Chưa kiểm thử E2E đăng ký→BTC duyệt→khóa roster trên tài khoản người dùng. Snapshot phiên bản roster và audit được bổ sung ở mục 5.16. Bracket KNOCKOUT/GROUP_AND_KNOCKOUT và các yêu cầu lịch nâng cao còn thiếu; xem 5.13 và các mục workflow trước đó. Cập nhật Organization/Match trước đó đã build Docker và healthcheck đạt.

### 5.15 Phạm vi quản lý giải theo người tạo (source update)

- Chỉ tài khoản BTC tạo giải được xem workflow riêng và gọi các API quản lý giải. Điều kiện này được áp dụng trong middleware mutation, endpoint quyền nội bộ dùng bởi Organization, API vị trí workflow và danh sách “giải của tôi”. ADMIN, kể cả tài khoản đồng thời có role BTC, không được điều hành giải.
- Đã bỏ giao diện thêm BTC phối hợp vì chức năng này thể hiện quyền quản lý cho người không phải chủ giải. Các bản ghi phân công cũ vẫn được giữ trong database để bảo toàn lịch sử, nhưng không còn cấp quyền quản lý. Không thay đổi hay xóa dữ liệu giải.
- Typecheck Tournament, Organization, Web đạt; Docker build Organization, Tournament và Web thành công; các service healthy. Kiểm tra endpoint quyền nội bộ trên fixture đang có: creator nhận HTTP 204, BTC cộng tác viên được phân công nhận HTTP 404. Chưa chạy browser E2E cho toàn bộ workflow.

### 5.16 Snapshot roster khi chốt danh sách (source update)

- Tournament migration v9 tạo bảng append-only `tournament_roster_lock_snapshots`, mỗi lần khóa có version, người thao tác, thời điểm và payload JSONB. Khi chuyển `REGISTRATION_CLOSED` → `ROSTER_LOCKED`, service lưu snapshot cùng transaction với cập nhật trạng thái; khóa hàng giải và kiểm tra lại trạng thái để chống hai thao tác khóa đồng thời. Snapshot gồm đội/trường và roster cầu thủ đã xác minh do Organization trả về qua API nội bộ; không đọc database của service khác.
- Chốt danh sách tiếp tục bị từ chối khi còn đơn PENDING, thiếu/vượt số đội, vượt hạn mức từng trường, sai phạm vi trường, đội không hoạt động/không gắn trường, roster nằm ngoài số lượng điều lệ, thiếu số đá chính hoặc không có đúng một thủ môn đá chính. Màn hình bước 3 hiển thị checklist theo từng đội và giải thích lỗi trước khi cho xác nhận. API Organization chặn cập nhật roster khi Tournament báo đã khóa. Không có đường sửa snapshot cũ; điều chỉnh roster sau khóa cần quy trình điều chỉnh riêng (chưa triển khai).
- Xác minh source: toàn workspace typecheck và build đạt; Match fixture tests 14/14 pass cho 5, 6, 7, 8, 10, 12, 16 đội và một/hai lượt; Organization DB integration test 1/1 pass với fixture tạm được xóa trong `finally`. Package test scripts được sửa để không gọi lồng `pnpm` từ shell test runner; web build script gọi trực tiếp Vite để chạy được qua Corepack trên Windows.
- Đã build/recreate Docker Compose cho các service phụ thuộc. Migration v9 chạy thành công trên `sfl_tournament`; truy vấn chỉ đọc xác nhận version 9 và bảng `tournament_roster_lock_snapshots` tồn tại. Tất cả backend, Gateway, PostgreSQL, Redis healthy; Web trả HTTP 200. Không reset DB/volume. Chưa chạy UI/API E2E chuyển giải thật sang ROSTER_LOCKED, chưa có giao diện xem lịch sử snapshot, chưa có optimistic version trên thay đổi roster Organization; do đó race xuyên service giữa đọc snapshot và thay đổi roster đồng thời vẫn cần được xử lý trước khi coi khóa roster là production-grade.

### 5.17 Trọng tài gửi biên bản, BTC duyệt kết quả (source update)

- Trọng tài được phân công kết thúc trận, ghi tỷ số `PENDING` và gửi biên bản `PENDING`; thao tác gửi không duyệt báo cáo, không chuyển trận sang `VERIFIED` và không tính điểm vào bảng xếp hạng. Backend khóa dữ liệu trận và biên bản trong transaction khi ghi nhận lần nộp.
- BTC có quyền duyệt, từ chối hoặc yêu cầu sửa biên bản của giải mình quản lý. Duyệt sẽ cập nhật báo cáo và kết quả thành `APPROVED`, trận thành `VERIFIED`, ghi lịch sử xét duyệt và tính lại bảng xếp hạng trong cùng transaction. Từ chối/yêu cầu sửa cần lý do; kết quả không được tính chính thức. Sau yêu cầu sửa, trọng tài có thể gửi lại hồ sơ đang chờ.
- Giao diện BTC hiển thị các biên bản `PENDING`, có nút duyệt kết quả chính thức kèm xác nhận và thao tác từ chối/yêu cầu sửa kèm ghi chú. Giao diện trọng tài ghi rõ hồ sơ đang chờ BTC duyệt.
- Xác minh trong phiên này: Match/Web typecheck và build đạt; test Match 24/24 pass, bao gồm PostgreSQL integration cho scheduling concurrency, báo cáo trận và discipline outbox. Integration test xác nhận kết quả chỉ vào standings sau khi BTC duyệt và hồ sơ yêu cầu chỉnh sửa giữ nguyên trạng thái chưa chính thức. Docker Compose đã build/recreate Match, Gateway, Web và chạy các migration jobs thành công; Match/Web/Gateway/PostgreSQL/Redis healthy, HTTP health trả 200. Chưa chạy E2E bằng tài khoản thật qua Gateway. Ngoài phạm vi gồm khiếu nại và workflow sửa kết quả đã công bố.

### 5.18 Tổ trọng tài theo trận (source update; chờ migration runtime)

- Scheduling migration v2 bổ sung bảng phân công theo trận và bảng lịch sử JSONB; backfill trọng tài đơn hiện hữu thành `REFEREE` có quyền cuối. Thay đổi tổ được ghi transactionally, có unique constraint chống trùng người/vị trí và unique partial index bảo đảm tối đa một quyền cuối. Kiểm tra trùng lịch được tuần tự hóa theo ID trọng tài bằng advisory lock trước khi lưu.
- BTC có thể tìm kiếm tài khoản REFEREE đang hoạt động/đã xác minh qua Auth internal API, phân nhiều vị trí (trọng tài, trợ lý, trọng tài thứ tư, thư ký), xem lịch sử trước/sau, lý do và thời điểm. Backend xác minh vai trò người được phân công, lịch trùng, đúng một quyền cuối và khóa thay đổi sau khi trận bắt đầu. Thay đổi ở lịch đã công bố yêu cầu lý do. Người bị thêm/gỡ/chuyển vị trí nhận thông báo in-app; API trả danh sách thông báo thất bại riêng sau khi lưu thành công.
- Các endpoint trọng tài điều khiển trận và xác nhận kết quả yêu cầu quyền cuối; endpoint sự kiện chỉ mở cho các vị trí thi đấu được hỗ trợ. Giao diện ẩn thao tác điều khiển với trợ lý và cho BTC chọn người từ danh sách thay vì nhập UUID.
- Đã thêm kiểm thử thuần cho crew 1 người, nhiều người, quyền cuối, vị trí chỉ ghi sự kiện, trùng người/vị trí, mã vị trí và giới hạn 12; toàn bộ Match tests hiện đạt 24/24, gồm integration concurrency lịch với PostgreSQL thật. Docker build/recreate và migration jobs chạy thành công; Match và các service phụ thuộc healthy. Chưa chạy API/E2E phân công bằng tài khoản thật. Chưa kiểm chứng notification service thực tế; thông báo gửi sau transaction nên lỗi notification không rollback phân công, retry/outbox cho thông báo chưa có. Chưa cấu hình mô hình tổ mặc định theo từng giải, các quyền ghi sự kiện hiện giới hạn theo mã vị trí, chưa có clock/live events UI hay màn hình xử lý khiếu nại/sửa kết quả.

## 5.19 Diễn biến trận, đồng bộ thẻ và đính chính (source + DB update)
- Match events chỉ được ghi khi trận `IN_PROGRESS`, đội thuộc trận, cầu thủ có trong lineup; thẻ vàng/đỏ bắt buộc gắn cầu thủ. Đính chính chuyển sự kiện sang void, yêu cầu lý do và ghi snapshot trong `match_event_history` (match migration v5); danh sách sự kiện chỉ trả những dòng còn hiệu lực.
- Sự kiện thẻ và outbox được lưu trong cùng transaction của Match DB. Worker trong match-service chuyển thẻ sang Discipline DB với retry/backoff; unique source event/card ngăn ghi trùng nếu worker retry. Đính chính tạo lệnh thu hồi; thẻ bị void và án treo tự động gắn với thẻ bị vô hiệu hóa. Match migration v6 tạo outbox; Discipline migration v2 thêm liên kết nguồn và dữ liệu đính chính. Không thêm runtime service hoặc truy cập trực tiếp database của service khác.
- PostgreSQL integration test thật xác nhận thẻ đỏ được tạo trong Discipline DB, án treo liên kết được tạo, rồi cả hai được vô hiệu hóa sau khi sự kiện được đính chính. Cùng lượt kiểm thử, flow trọng tài gửi/BTC duyệt kết quả cũng đạt. Match/Web typecheck/build đạt; Match tests 24/24 pass; gồm schedule concurrency trên PostgreSQL thật. Docker Compose build/recreate thành công; migration jobs đã chạy và các container Match, Web, Gateway, PostgreSQL, Redis healthy; trang và health endpoints trả HTTP 200. Không reset database hoặc volume.
- Giới hạn còn lại: chưa chạy E2E thao tác UI bằng tài khoản REFEREE/BTC; outbox hiện retry tự động nhưng chưa có màn hình/alert dead-letter. Án treo đỏ vẫn dùng mặc định 7 ngày lịch của nghiệp vụ cũ, chưa lấy cấu hình điều lệ giải; cần xử lý ở giai đoạn kế tiếp trước khi dùng làm kỷ luật chính thức. Chưa có clock/hiệp phụ/luân lưu và endpoint xem lịch sử đính chính trong UI.

## 5.20 Nhánh loại trực tiếp và BYE (source update; migration v7 chờ runtime)
- Tournament cho phép lập bản nháp một nhánh duy nhất đối với giải KNOCKOUT sau khi roster đã khóa, điều lệ đã công bố và đội đạt điều kiện. Bản chia đã công bố vẫn là nguồn duy nhất để Match tạo lịch; không sinh đội giả.
- Match tạo topology nhánh tới 32 đội, dùng vị trí hạt giống chuẩn để tránh hai hạt giống đầu gặp nhau ở vòng mở màn. BYE được lưu như slot miễn đấu, không tạo trận/kết quả giả; slot được truyền tiếp cho đến khi gặp đội ở trận thực.
- Match chỉ tạo một trận UNSCHEDULED khi cả hai vị trí đã xác định. Sau khi báo cáo được BTC duyệt, transaction tính đội thắng từ tỷ số chính thức/hiệp phụ/luân lưu, khóa slot và đưa đội sang đúng slot tiếp theo. Trận hòa ở loại trực tiếp không có luân lưu hợp lệ bị từ chối duyệt. Chỉ kết quả đã duyệt mới tạo nhánh kế tiếp; bản nháp, báo cáo đang chờ và bị từ chối không tiến nhánh.
- Có API đọc bracket và giao diện BTC xem các vòng, BYE, đội thắng và vị trí chờ kết quả; có thể tải lại bracket sau khi duyệt trận. Bảng xếp hạng không tính các trận bracket.
- Kiểm tra source: Match build, Tournament build, Web typecheck đạt. Match unit tests 30 pass, 3 PostgreSQL integration tests skipped vì chưa bật `RUN_MATCH_REPORT_DB_INTEGRATION=1`; bộ mới kiểm tra topology/BYE cho 5, 6, 7, 8, 10, 12, 16 đội, hạt giống và đầu vào trùng/thiếu. Chưa kiểm chứng runtime migration v7, tạo bracket trên PostgreSQL đang chạy hoặc E2E qua UI. Chưa build/recreate Docker trong cập nhật này.
- Giới hạn: manual draw hiện lưu thứ tự đội theo danh sách đầu vào, UI chưa có kéo-thả thứ tự seed; hạt giống được dùng theo nhóm khi tạo bracket. Thể thức kết hợp vòng bảng→bracket, lịch tự động cho các vòng phụ thuộc và workflow điều chỉnh bracket đã công bố chưa được thêm ở mục này.

## 5.21 Xếp lịch trận đấu trong nhánh loại trực tiếp (source update)
- Trận nhánh chỉ được tạo trong Match DB khi cả hai slot đã được giải quyết. Scheduling xác minh lại bracket slot ở backend trước khi xem xung đột/tạo/cập nhật lịch; nếu slot chưa READY hoặc một đội chưa chốt thì trả lỗi `BRACKET_TEAMS_UNRESOLVED`. Trận vòng tròn không có slot bracket vẫn theo luồng cũ.
- Các trận bracket đã sẵn sàng xuất hiện trong bộ chọn lịch hiện có; dropdown và lịch đã lưu dùng tên đội nếu client có danh mục tên đội. Sau khi BTC duyệt kết quả, quay lại bước xếp lịch sẽ tải các trận vòng tiếp theo vừa được sinh.
- Kiểm thử: Match suite 35 pass, 0 fail, 1 skip; gồm kiểm tra readiness và tích hợp PostgreSQL cho tiến trình bracket sau khi duyệt kết quả, cùng kiểm tra xung đột lịch. Web typecheck đạt. Docker images đã build và các endpoint Match (`:3005/health`), Gateway (`:8080/health`) và Web (`:5173/`) trả HTTP 200.
- Giới hạn: Chưa chạy browser E2E cho lập lịch bán kết/chung kết. Trận vòng sau được sinh sau khi kết quả trước được duyệt rồi BTC có thể xếp lịch bằng form hiện có; chưa có bộ tự động lập lịch nhiều vòng phụ thuộc.

## 5.22 Chỉ chia bảng sau khi chốt roster
- Siết điều kiện giai đoạn chia bảng: `preview`, lưu nháp, xác nhận và công bố chỉ hợp lệ khi giải ở `ROSTER_LOCKED`. `REGISTRATION_CLOSED` chưa có snapshot roster; `PREPARING` nghĩa là draw đã công bố và giải chuyển sang lập lịch nên draw không được thay đổi để tránh lệch với fixture.
- Repository khóa hàng giải trong transaction trước khi lưu/cập nhật trạng thái phiên bản chia bảng, rồi kiểm tra lại giai đoạn; tránh chuyển trạng thái giải đồng thời với thao tác chia/công bố. Trước khi công bố, service kiểm tra lại danh sách đội đủ điều kiện và cấu hình bản đã xác nhận.
- Tournament tests: 9 pass, 0 fail. Docker images đã build và stack được cập nhật; Tournament (`:3003/health`), Gateway (`:8080/health`) và Web (`:5173/`) trả HTTP 200. Chưa chạy E2E qua API/UI cho cả chuỗi đóng đăng ký → chốt roster → chia bảng.

## 5.23 Chống race khi chuyển trạng thái giải
- Cập nhật giải nay dùng compare-and-set theo trạng thái đã đọc. Nếu hai thao tác chuyển giai đoạn chạy đồng thời hoặc dữ liệu trạng thái đổi trong lúc service kiểm tra lịch/điều lệ, thao tác cũ bị từ chối với `TOURNAMENT_STATE_CHANGED` thay vì ghi đè trạng thái mới hoặc báo thành công giả.
- Kiểm thử Tournament: 10 pass, 0 fail; trong đó test database thật xác nhận cập nhật với trạng thái cũ/giải không tồn tại bị từ chối 409 và không ghi dữ liệu. Docker đã build/recreate; Tournament (`:3003/health`), Gateway (`:8080/health`) và Web (`:5173/`) trả HTTP 200. Chưa chạy E2E race qua Gateway với hai request chuyển giai đoạn thật.

## 5.24 Giải kết hợp: chốt đội đi tiếp và tạo playoff
- Thể thức `GROUP_AND_KNOCKOUT` nay có thao tác riêng sau khi vòng bảng đã được công bố và giải đang ở giai đoạn thi đấu: Match lấy các trận vòng bảng cùng kết quả đã BTC duyệt, tính thứ hạng theo điểm thắng/hòa/thua cấu hình, hiệu số, bàn thắng, đối đầu và fair-play theo thứ tự điều lệ. Không dùng kết quả đang chờ duyệt.
- Nếu còn hòa cần bốc thăm chính thức (LOT_DRAW), backend chặn tạo nhánh và trả lý do thay vì tự chọn đội. Snapshot đội vượt qua vòng bảng lưu bảng, thứ hạng, tiêu chí và thời điểm; Match tạo bracket qua cơ chế idempotent theo draw + stage, ngăn tạo trùng nhánh.
- UI bước chia bảng hiển thị nút “Chốt đội đi tiếp và tạo nhánh playoff” và bracket sau khi tạo. Backend tiếp tục xác minh chủ giải, thể thức, trạng thái giải, số đội và dữ liệu bảng; thao tác không dựa vào lựa chọn đội từ trình duyệt.
- Match migration v8 thêm group assignment cho fixture, phân biệt generation vòng bảng/playoff và bảng snapshot qualifiers. Migration v8 đã chạy trên database Docker hiện tại; không xóa hoặc reset dữ liệu.
- **Kiểm thử:** Match suite 44 pass, 0 fail, 4 skip khi bật `RUN_HYBRID_PLAYOFF_DB_INTEGRATION=1`. PostgreSQL integration tạo vòng bảng đã duyệt, xếp hạng, lưu snapshot và bracket cho 5, 6, 7, 8, 10, 12, 16 đội; xác nhận số slot, BYE, lưu DB và gọi lại không tạo trùng. Fixture dùng UUID riêng và được dọn sau khi chạy. Web typecheck đạt.
- **Giới hạn:** chưa chạy E2E bằng tài khoản BTC trên trình duyệt cho một giải thật. Bộ DB đa quy mô hiện dùng một bảng và tất cả đội trong bảng đi tiếp, chưa kiểm tra chia nhiều bảng/đi tiếp nhiều hạng trên nhiều bảng. Khi LOT_DRAW vẫn hòa, backend chặn đúng nhưng chưa có giao diện/bản ghi quy trình bốc thăm có biên bản; BTC cần xử lý tie-break chính thức trước khi sinh playoff. Chưa kiểm thử thao tác đồng thời nhiều BTC.

## 5.25 Thứ tự hạt giống đội đi tiếp ở giải nhiều bảng
- Tách quy tắc chọn đội playoff thành `selectHybridQualifiers`: hệ thống đan xen theo hạng (Nhất A, Nhất B, Nhì A, Nhì B...) trước khi tạo seed/bracket. Backend trả lỗi rõ nếu bảng thiếu thứ hạng cần thiết hoặc một đội bị gán vào nhiều bảng.
- **Kiểm thử:** unit test xác nhận thứ tự liên bảng và các điều kiện chặn; Match suite sau phần hoàn thiện tiếp theo đạt 47 pass, 0 fail, 4 skip; Web typecheck đạt. Docker Match/Web được build/cập nhật.
- **Giới hạn:** PostgreSQL integration nhiều cỡ đội dùng một bảng; đã thêm kịch bản hai bảng riêng cho chọn hạng Nhất/Nhì và lưu audit tie-break nhưng chưa phủ mọi cách chia bảng/số đội đi tiếp hoặc chạy E2E trên giải thật.

## 5.26 Bốc thăm phân hạng có người chứng kiến và lưu biên bản
- Khi tiêu chí điều lệ có `LOT_DRAW` và thứ hạng còn hòa, API trả nhóm bảng và đúng các đội đang hòa. BTC có thể nhập thứ tự đã rút công khai, tên người chứng kiến, căn cứ/biên bản và xác nhận; frontend không tự sinh thứ tự ngẫu nhiên thay cho sự kiện thực tế.
- Backend đối chiếu lại nhóm hòa trên kết quả đã duyệt, yêu cầu thứ tự chứa đúng mỗi đội một lần, biên bản hợp lệ và người chứng kiến; các biên bản lạ hoặc không khớp điều lệ bị từ chối. Snapshot ghi trong cùng transaction tạo playoff cùng tournament/draw/group, đội hòa, thứ tự, người chứng kiến, lý do, tài khoản BTC và thời gian.
- BTC có thể tải lại danh sách biên bản từ API quản lý; quyền đọc/ghi yêu cầu role BTC và quyền quản lý chính giải. Migration Match v9 tạo bảng audit riêng, additive và transactional.
- **Kiểm thử:** Match suite 47 pass, 0 fail, 4 skip; unit kiểm tra tie/order/validation và PostgreSQL integration xác nhận lưu actor, witness, thứ tự và lý do cho hai bảng, đồng thời kiểm tra các size 5–16 và BYE. Web typecheck và Docker Match/Web build đạt; Match `:3005/health` và Web `:5173/` HTTP 200. Integration dùng fixture UUID tạm và xóa sau test.
- **Giới hạn:** chưa chạy E2E bằng tài khoản BTC trên browser thật; tên BTC ghi nhận hiện là user ID từ JWT, còn tên người chứng kiến là nội dung BTC khai báo, chưa liên kết một tài khoản thứ hai hoặc chữ ký số. Chưa có file scan/đính kèm biên bản. Bốn integration test cũ của discipline/result/scheduling vẫn skip do không bật cờ DB riêng.

## 5.27 Kiểm tra tỷ số hiệp phụ và luân lưu tại Match Service
- Thêm validation dùng chung cho API ghi kết quả và yêu cầu đính chính. Backend chỉ nhận tỷ số nguyên 0–99, bắt buộc nhập đủ hai bên cho hiệp phụ/luân lưu, chỉ cho hiệp phụ sau khi hòa chính thức, chỉ cho luân lưu sau khi hòa sau hiệp phụ (hoặc hòa chính thức nếu giải đi thẳng đến luân lưu), và yêu cầu luân lưu xác định đội thắng.
- Tách quyền ghi diễn biến khỏi quyền đính chính/vô hiệu hóa: trợ lý và thư ký vẫn ghi nhận sự kiện theo phân công; thao tác đính chính chỉ dành cho trọng tài được gán quyền cuối. API kiểm tra quyền này ở Match Service và nút tương ứng cũng ẩn với tài khoản không có quyền.
- Kiểm tra tự động bao phủ tỷ số thường, 1/2 giai đoạn phân định, tỷ số thiếu/lẻ/sai miền và luân lưu hòa. Match service tests: 49 pass, 0 fail, 17 integration tests skipped vì chưa cấu hình cờ/database integration trong môi trường này. Web typecheck pass; `git diff --check` không có whitespace error.
- Docker chưa thể được kiểm tra trong lượt này vì executable `docker` không có trong PATH của môi trường hiện tại. Chưa chạy E2E qua Gateway hoặc trình duyệt.
- Các phần lớn còn lại trong yêu cầu trọng tài vẫn cần triển khai/nghiệm thu riêng: biên bản có đội hình/sự kiện đầy đủ, quyền chi tiết cấu hình theo từng trận, thay người/đủ tư cách theo điều lệ, thông báo/retry, cùng E2E trên Docker bằng các tài khoản REFEREE/BTC. Đồng hồ trận và điều khiển hiệp đã được bổ sung tại mục 5.28.

## 5.28 Đồng hồ trận và điều khiển hiệp được lưu bền vững
- Match Service migration v14 tạo `match_clock_states`, lưu trạng thái hiệp, giây đã chạy, mốc bắt đầu, người thao tác và phiên bản cập nhật. Migration additive, chạy trong transaction, có advisory lock và khởi tạo trạng thái cho trận cũ đang `IN_PROGRESS` mà không đặt đồng hồ về một khoảng thời gian lịch sử không xác định.
- API cho phép trọng tài có quyền cuối bắt đầu/tạm dừng/tiếp tục/kết thúc giai đoạn, bắt đầu hiệp kế tiếp, hiệp phụ/luân lưu và kết thúc trận. Các thao tác dùng `expectedVersion` để phát hiện cập nhật từ thiết bị khác; trạng thái đồng hồ và trạng thái trận cập nhật trong cùng transaction. Trọng tài phụ/thư ký không thể điều khiển đồng hồ. BTC có thể xem trạng thái.
- Diễn biến trận chỉ được ghi khi đồng hồ đang chạy. UI tải đồng hồ từ API khi chọn trận, hiển thị thời gian theo mốc máy chủ và cung cấp điều khiển theo giai đoạn; hết giờ không tự động kết thúc hiệp. Kết thúc trận là thao tác xác nhận riêng.
- **Kiểm thử/build:** unit tests cho chuyển hiệp, tạm dừng/tiếp tục, hiệp phụ, luân lưu, kết thúc tường minh và tính thời gian theo mốc máy chủ. Match Service tests: 52 pass, 0 fail, 17 integration tests skipped; Match typecheck/build và Web typecheck/build đạt; `git diff --check` đạt.
- **Giới hạn:** Docker executable không có trong PATH của môi trường này, vì vậy chưa chạy migration v14 trên database đang dùng, chưa build/recreate container và chưa chạy E2E qua Gateway/trình duyệt. Thời lượng được lưu cho giai đoạn hiện tại và tổng trận, chưa có bảng lịch sử thời lượng riêng cho từng hiệp. Việc cho phép hiệp phụ/luân lưu hiện do trọng tài thao tác; backend chưa đối chiếu cấu hình điều lệ cụ thể của từng giải trước khi cho mở giai đoạn đó.

## 5.29 Snapshot đội hình và diễn biến trong từng lần nộp biên bản
- Match migration v15 bổ sung mảng JSONB `submission_snapshots` cho biên bản. Khi trọng tài gửi hoặc gửi lại biên bản, Match Service chụp tỷ số, danh sách đội hình và xác nhận, các sự kiện chưa bị đính chính, cùng thời lượng/trạng thái đồng hồ. Snapshot được ghi cùng transaction với trạng thái hồ sơ.
- Mỗi lần gửi tạo một snapshot nối tiếp; BTC xem các lần nộp trong chi tiết biên bản và có thể đối chiếu hồ sơ trước/sau khi yêu cầu chỉnh sửa. API không lấy lại lineup/event hiện thời để thay nội dung bản đã nộp.
- Typecheck Match/Web đạt; Match tests 52 pass, 0 fail, 17 database integration tests skipped. Chưa chạy migration v15 hoặc kiểm thử lưu/đọc snapshot trên PostgreSQL thật vì Docker/DB không khả dụng trong môi trường này.
- Giới hạn: snapshot lưu ID cầu thủ và ID người xác nhận; chưa lấy tên/ảnh từ Organization/Auth service. Chưa có chữ ký điện tử hoặc xác nhận riêng của hai đội trưởng; đây là bản ghi do trọng tài lập, không thay thế chữ ký pháp lý.

## 5.30 Trung tâm lịch thi đấu và trận trực tiếp
- Web có trang dùng chung cho lịch công khai, lọc theo giải/đội/ngày/trạng thái, khu vực trận LIVE và modal chi tiết có đồng hồ, diễn biến, thống kê sự kiện, đội hình và trạng thái kết quả. Chi tiết được mở bằng URL `/matches/:id`; điều hướng quay lại giữ đúng mục lịch thi đấu. Bản nháp bị loại khỏi truy vấn lịch phía client.
- Match Service có API công khai `GET /matches/live`, `GET /matches/:matchId/live-state`, `GET /matches/live/stream` và `GET /matches/:matchId/stream`. API kiểm tra giải không ở trạng thái DRAFT thông qua Tournament Service; lỗi xác minh quyền công khai không được coi là cho phép. Tỷ số trực tiếp tính từ sự kiện trận chưa bị vô hiệu hóa; kết quả chỉ trả như kết quả chính thức khi đã APPROVED. Hồ sơ đang chờ duyệt chỉ gửi trạng thái, không công bố điểm số.
- Thay đổi đồng hồ, trạng thái, diễn biến, kết quả và duyệt biên bản được ghi vào event log trong cùng transaction với dữ liệu nghiệp vụ rồi phát qua PostgreSQL LISTEN/NOTIFY. SSE hỗ trợ heartbeat, tự kết nối lại ở trình duyệt, replay theo Last-Event-ID (giới hạn 200 sự kiện) và đồng bộ lại từ API snapshot. Event log được dọn sau 30 ngày; không xóa lịch sử sự kiện thi đấu chính thức.
- **Kiểm tra source:** Match Service, API Gateway và Web typecheck đạt; Match suite đạt 52 pass, 0 fail, 17 database integration tests skip; Web production build đạt (còn cảnh báo bundle JS 581.54 KB). `git diff --check` không báo lỗi whitespace.
- **Giới hạn:** chưa chạy Docker build, migration v16 trên database đang dùng, API/E2E bằng trình duyệt hoặc test reconnect khi PostgreSQL/SSE ngắt do Docker không khả dụng trong môi trường lần này. Lịch phân trang tải đủ dữ liệu nhưng giao diện hiện chưa có phân trang trực quan; live feed không phân trang. Chưa phát realtime cho đổi lịch từ Scheduling DB (khác transaction/database), thay đổi bảng xếp hạng/nhánh có thể cần tải lại trang tương ứng; tên cầu thủ không được tra từ Organization/Auth service nên chi tiết công khai chỉ hiện số áo/vị trí, không lộ ID nội bộ. Bundle lớn nên cần code splitting riêng.

## 5.31 Nối dữ liệu lịch công bố với thông tin trận
- Khi BTC công bố hoặc đổi lịch, Scheduling Service xác minh sân và đồng bộ thời điểm, tên sân cùng trạng thái trận sang Match Service. Việc đồng bộ liên service vẫn là hai transaction riêng; Match Service phát sự kiện sau khi bản ghi trận đã đổi để client không chỉ nhận invalidation sớm từ Scheduling DB.
- Match Service phát một invalidation cho mỗi lần sinh bộ fixture vòng bảng/knockout. Các client đang xem chi tiết giải hoặc workspace trận tự tải lại danh sách qua API hiện có; không phát một event cho từng trận để tránh tạo bão request khi giải có nhiều fixture.
- **Kiểm tra source:** Match typecheck/test, Web typecheck và build được chạy sau khi sửa. Docker/migration và healthcheck đã được xác minh ở mục 5.32. Chưa chạy E2E bằng tài khoản trên browser.

## 5.32 Khung playoff giải kết hợp được tạo cùng fixture vòng bảng
- Khi tạo fixture vòng bảng cho `GROUP_AND_KNOCKOUT`, Match Service tạo trước cấu trúc bracket, các vị trí nguồn như Nhất/Nhì từng bảng và Match ID thật cho từng trận có thể thi đấu. Participant ID vẫn để trống đến khi toàn bộ kết quả vòng bảng được xác nhận; không tạo đội giả.
- Khi BTC chốt đội đi tiếp, backend lưu snapshot qualifiers và điền đúng các bracket slot/Match row đã đặt trước. Giữ nguyên Match ID, lịch và phân công trọng tài đã chuẩn bị; BYE chỉ được lan truyền khi nguồn qualifier đã xác định. Retry không tạo bracket trùng.
- Bổ sung migration Match v17 tạo bảng nguồn qualification cho bracket slots; migration transactional, có thể chạy lại và không xóa dữ liệu. Docker Compose đã build/recreate, migration job thoát 0, Match schema version 17 và bảng `match_bracket_qualification_sources` đã được xác minh. Gateway `/health` và Web `/` trả HTTP 200; backend services healthy.
- **Kiểm thử:** workspace typecheck và build đều đạt. Match suite với PostgreSQL thật: 65 pass, 0 fail, 5 skip. Integration mới xác nhận bracket giải kết hợp đặt trước Match ID, sau đó điền qualifier vào cùng ID; các kịch bản playoff 5, 6, 7, 8, 10, 12, 16 đội và chọn đội đi tiếp nhiều bảng đều pass. Test đã phát hiện một assertion cũ đếm thiếu trận cho 4 đội; sửa đúng thành N−1 và chạy lại thành công.
- **Giới hạn:** chưa chạy E2E qua giao diện BTC cho cả một giải đang tồn tại; chưa kiểm tra thao tác đồng thời giữa nhiều BTC hoặc từng lịch/sân/referee trong trình duyệt. Frontend bundle vẫn có cảnh báo chunk JavaScript lớn hơn 500 kB.

## 5.33 Rà soát tổng thể hiện trạng (18/11/2026)

### Phạm vi đã có trong source
- Hệ thống chạy theo monorepo gồm API Gateway, web client và năm backend service: Auth, Organization, Tournament, Match, Notification; PostgreSQL chia database theo miền, Redis lưu session. Registration/roster/lời mời hiện do Organization sở hữu; Tournament giữ luật, draw và reservation. Đây là quyết định chuyển tiếp đã được ghi ở `DECISION_REGISTRATION_OWNERSHIP.md`, chưa phải việc chuyển dữ liệu đã hoàn thành.
- Auth hỗ trợ tài khoản/phiên, xác minh email SMTP thật, hồ sơ, yêu cầu vai trò và quản lý tài khoản theo quyền. Organization hỗ trợ trường, CLB, thành viên, yêu cầu gia nhập/rời CLB, lời mời cầu thủ dự giải, roster snapshot, đăng ký/duyệt theo đội, yêu cầu bổ sung và rút đội có workflow.
- Tournament hỗ trợ tạo giải, kỳ đăng ký, điều lệ có phạm vi/format/cấu hình, quyền BTC theo giải, khóa roster có snapshot, chia bảng thủ công/ngẫu nhiên/hạt giống, phiên bốc thăm trực tiếp có lưu tiến độ, lịch sử phiên bản và công bố draw.
- Match hỗ trợ fixture vòng tròn và nhánh loại trực tiếp/BYE, giải kết hợp có khung playoff và Match ID giữ trước, lineup, đồng hồ trận, sự kiện, biên bản, quyền trọng tài cuối, cập nhật kết quả/xếp hạng, hiệu chỉnh kết quả có audit, xử thua, khiếu nại/kháng nghị, lịch/sân/tổ trọng tài và đồng bộ diễn biến trực tiếp qua event log/SSE.
- Notification có inbox, đọc/chưa đọc, email SMTP và một số outbox/retry bền vững cho nghiệp vụ. Không phải mọi luồng thông báo hậu transaction đều đã dùng outbox.

### Bằng chứng kiểm tra ở mốc này
- Workspace `corepack pnpm -r run typecheck` và `corepack pnpm -r run build`: pass. Vite vẫn báo bundle JS lớn hơn 500 kB.
- PostgreSQL integration: Match **65 pass / 0 fail / 5 skip** (bật hybrid DB integration); Organization **5 pass / 0 fail / 0 skip**; Tournament **11 pass / 0 fail / 0 skip**. Tổng ba suite **81 pass / 0 fail / 5 skip**. Các fixture integration dùng ID riêng và cleanup; điều này không thay thế E2E bằng UI.
- Docker Compose đã build/recreate trong mốc 5.32; các migration job thoát mã 0. Match database ở schema version 17 và có bảng `match_bracket_qualification_sources`. Gateway health và Web trả HTTP 200; backend services báo healthy. Không reset database/volume.
- Đã chạy E2E API/database cho một giải liên trường hai đội từ lời mời cầu thủ đến kết thúc giải theo báo cáo QA ngày 16/11. Đây là một kịch bản xuyên luồng có dữ liệu thật, không chứng minh mọi format/biên/role đều đạt.

### Những việc còn phải làm trước khi gọi là sản phẩm vận hành thương mại
1. Quy trình rút đội sau khi roster khóa chưa giải quyết dây chuyền lịch, bracket, walkover, standings và thông báo; hiện backend chặn quyết định có thể làm lệch giải.
2. Hiệu chỉnh kết quả knockout làm đổi đội thắng vẫn bị chặn an toàn; chưa có quy trình mở lại và tính lại toàn bộ trận phụ thuộc, lịch, phân công và audit.
3. Hành trình đội trưởng gửi kháng nghị đã có API và giao diện đội trưởng trong cập nhật 5.34; workflow quyết định walkover theo điều lệ `NO_AUTOMATIC_RESULT` và thông báo có đảm bảo giao nhận còn thiếu.
4. Chưa chạy ma trận role × resource ownership cho tất cả route, IDOR/pentest, test concurrency toàn hệ thống hoặc E2E UI cho mọi vai trò và ba thể thức.
5. Chưa diễn tập backup/restore, xác nhận deliverability tới inbox SMTP ngoài, kiểm thử tải, thiết lập monitoring/alert/SLO, secrets rotation, migration rollback và triển khai production. Do đó chưa thể kết luận production-ready.
6. Lịch vòng sau của bracket hiện có thể được tạo sau khi trận trước xác nhận; chưa có bộ sinh lịch tự động đa vòng phụ thuộc đầy đủ. Bundle web lớn và một số giao nhận thông báo ngoài transaction chưa có retry durable.

### Kết luận
- Các nghiệp vụ cốt lõi đã hiện diện và nhiều ràng buộc có kiểm tra backend; một luồng API/database hoàn chỉnh và nhiều integration test đã chạy thật. Hệ thống phù hợp để tiếp tục demo và phát triển có kiểm soát.
- Chưa nên coi đây là sản phẩm thương mại sẵn sàng triển khai production cho nhiều giải đồng thời. Ưu tiên tiếp theo: saga có audit cho rút đội/sửa kết quả playoff, hoàn thiện giao diện kháng nghị, sinh ma trận quyền tự động, sau đó diễn tập backup/restore và kiểm thử vận hành trước production.

## 5.34 Khiếu nại và kháng nghị đội trưởng (18/11/2026)

- Bổ sung giao diện cho đội trưởng tại khu vực Lịch thi đấu: chọn đội do chính tài khoản điều hành, chọn giải, xem các trận của đội đã kết thúc, gửi khiếu nại, đính kèm mô tả minh chứng, theo dõi trạng thái và quyết định của BTC.
- Khi BTC đã ra quyết định, người đội trưởng đã gửi khiếu nại có thể gửi một kháng nghị kèm minh chứng bổ sung. Quyền sở hữu đội, người gửi ban đầu, thời hạn khiếu nại/kháng nghị và trạng thái hồ sơ tiếp tục được kiểm tra ở Match Service; giao diện không thay thế kiểm tra backend. Lỗi API hiện được hiển thị cho người dùng; thao tác thành công làm mới hồ sơ ngay.
- API client hỗ trợ truy vấn hồ sơ theo `teamId`, đúng với phạm vi mà backend cho phép TEAM_CAPTAIN xem. Không thêm migration hoặc sửa database.
- Xác minh trong phiên: workspace typecheck pass; Match tests **52 pass / 0 fail / 18 skipped**; Organization tests **5 skipped** do chưa bật biến chạy DB integration; Tournament tests **10 pass / 0 fail / 1 skipped**. Các test bỏ qua là integration cần cơ sở dữ liệu/biến môi trường chuyên biệt; kết quả này không được tính là đã kiểm thử xuyên service. Web Vite production bundle build thành công nhưng vẫn cảnh báo JS chunk vượt 500 kB.
- Việc thay kết quả playoff làm đổi đội thắng vẫn bị chặn có chủ ý: hệ thống chưa có quy trình nguyên tử để mở lại toàn bộ trận phụ thuộc, lịch và phân công trọng tài, xử lý biên bản/kết quả phía sau, rồi ghi audit và phát thông báo. Rút đội sau khi khóa roster cũng tiếp tục bị chặn cho tới khi hoàn thiện quy trình ảnh hưởng bảng đấu/lịch/kết quả.
- Docker Compose đã được build lại trong lượt hoàn thiện sau; toàn bộ service container healthy, Match migration job thoát 0, database/volume được giữ nguyên. Health endpoint của các service trả 200. Bundle web vẫn có cảnh báo chunk lớn.

## 5.35 Sửa lỗi xác thực quyền BTC và API tỷ số trực tiếp (18/11/2026)

- Sửa Organization: Tournament Service dùng HTTP 404 để ẩn giải không thuộc quyền người gọi; Organization nay diễn giải 403/404 là “không có quyền trên giải này” và tiếp tục kiểm tra các giải khác. Trước đây 404 bị biến thành 502, làm trang BTC không tải được đội. Thêm unit regression test cho quy tắc status này.
- Sửa Match route: đăng ký `/matches/live` trước `/matches/:id`. Trước đây `live` bị chuyển vào truy vấn UUID và trả HTTP 500. Thêm unit test đảm bảo route tĩnh đứng trước route tham số.
- Kiểm tra trực tiếp sau Docker build: BTC tải được đội từ 5 giải; 31/31 đội trả HTTP 200. `/matches/live` trả HTTP 200 trên Match Service và Gateway; Web `/` trả HTTP 200. Container backend báo healthy; PostgreSQL và Redis giữ nguyên.
- Kiểm thử lượt này: workspace typecheck pass; Match **53 pass / 0 fail / 18 skipped**; Organization **1 pass / 0 fail / 5 skipped** (các test DB integration chưa bật); Tournament **10 pass / 0 fail / 1 skipped**. Không chạy lại test E2E có ghi dữ liệu vào các giải demo đang dùng.
- Cập nhật script root để `corepack pnpm run build/typecheck/lint` gọi pnpm nhất quán trên Windows. Docker build thành công; các migration jobs chạy lại an toàn và thoát mã 0. Không thêm migration mới.
- Các workflow rút đội sau khóa roster và sửa kết quả playoff làm đổi đội thắng vẫn chưa được mở: phải có transaction/saga xử lý mọi trận con, lịch, phân công, standings, audit và thông báo. Không bỏ chặn an toàn chỉ để cho phép thao tác.

## 5.36 Chấp thuận rút đội sau khi khóa roster nhưng trước khi xác nhận bảng đấu (18/11/2026)

- Bổ sung workflow nội bộ Organization → Tournament để BTC chấp thuận yêu cầu rút đội đã duyệt. Với giải còn nhận đăng ký/đã đóng đăng ký, reservation được rút theo transaction. Sau khi khóa roster, chỉ cho phép điều chỉnh khi chưa có draw CONFIRMED/PUBLISHED, không có phiên live draw đang chạy/đã hoàn tất và giải còn ở ROSTER_LOCKED.
- Khi điều chỉnh snapshot đã chốt, Tournament Service giữ nguyên snapshot cũ, tạo phiên bản snapshot mới không còn đội rút và ghi người quyết định, lý do, registration/team ID, phiên bản trước/sau vào bảng audit. Thao tác khóa tournament row để không chạy đua với publish draw; kiểm tra số đội còn lại không thấp hơn mức tối thiểu.
- Bản chia nháp được lưu từng phần nhưng chỉ được xác nhận khi tập đội phân bảng khớp chính xác với các đăng ký đang duyệt; phiên live draw cũng kiểm tra lại tập đội trong transaction. Điều này chặn bản xem trước cũ chứa đội vừa rút.
- Nếu draw đã xác nhận/công bố hoặc giải đã sang giai đoạn sau, backend vẫn từ chối và giữ yêu cầu ở trạng thái có thể retry sau khi workflow thay đổi được xử lý. Chưa cho phép tự sửa bracket, lịch, trọng tài hoặc kết quả.
- Migration Tournament v14 bổ sung bảng audit, additive và không đụng dữ liệu cũ. Unit tests bao phủ trạng thái được phép/chặn và thao tác loại đội khỏi snapshot bất biến.
- **Kiểm thử:** Tournament tests **15 pass / 0 fail / 1 skipped**, Organization typecheck pass; workspace build/typecheck pass. Chưa chạy PostgreSQL integration, migration hoặc Docker build cho v14 trong lượt này vì Docker CLI không khả dụng ở shell hiện tại.
- **Giới hạn:** E2E xuyên service cho quyết định rút đội cần chạy sau khi migration v14 được áp dụng. Rút đội sau draw đã xác nhận/công bố vẫn chưa triển khai; vẫn cần quy trình thay đổi giải có kiểm soát để tái tạo bảng/lịch và thông báo.

## 5.37 Đồng bộ hàng đợi rút đội và trạng thái kháng nghị (18/11/2026)

- Màn hình BTC tự làm mới hàng đợi yêu cầu rút đội theo giải mỗi 15 giây, không tải lại toàn bộ hồ sơ/roster. Thao tác thủ công và sự kiện thông báo vẫn tiếp tục kích hoạt cập nhật ngay.
- Màn hình đội trưởng không còn xem lỗi tải trạng thái kháng nghị như trường hợp chưa gửi kháng nghị. Lỗi được hiển thị trên hồ sơ và nút gửi bị ẩn cho tới khi kiểm tra lại thành công, tránh hướng dẫn người dùng gửi trùng.
- Xác minh: Web Client typecheck và Vite production build đạt. Bundle JS khoảng 600 kB chưa nén, Vite tiếp tục cảnh báo vượt 500 kB.
- Chưa chạy Docker/API E2E cho phần này; Docker CLI không có trong shell hiện tại. Rút đội sau khi draw đã xác nhận/công bố và sửa kết quả làm đổi đội thắng playoff vẫn bị chặn an toàn.

## 5.38 Khôi phục yêu cầu rút đội sau lỗi nghiệp vụ (18/11/2026)

- Nếu BTC chấp thuận rút nhưng Tournament Service trả lỗi nghiệp vụ 4xx (ví dụ draw đã công bố), Organization trả yêu cầu từ `PROCESSING` về `PENDING`, xóa claim quyết định chưa hoàn tất và cho BTC chọn quyết định hợp lệ khác. Lỗi mạng hoặc 5xx vẫn giữ trạng thái `PROCESSING` để retry cùng quyết định, tránh mất kết quả nếu upstream đã commit nhưng response bị gián đoạn.
- Sau lỗi nghiệp vụ, UI đóng modal quyết định cũ, tải lại hàng đợi và giữ nguyên thông báo lỗi để BTC có thể xem lại/yêu cầu hoặc từ chối kèm lý do.
- Không cần migration mới; chuyển trạng thái về `PENDING` phù hợp constraint Organization migration v19. Typecheck/build cần chạy trước khi nghiệm thu; chưa có E2E qua PostgreSQL/Docker cho lỗi upstream này.

## 5.39 Kiểm tra thành viên và treo giò khi lập đội hình (18/11/2026)

- Organization Service bổ sung internal endpoint xác minh theo lô các `playerId` còn là thành viên hoạt động của đúng đội. Endpoint chỉ trả về ID hợp lệ, yêu cầu trusted gateway key, giới hạn 40 ID mỗi lần và không trả thông tin hồ sơ cầu thủ.
- Match Service gọi xác minh này khi thêm cầu thủ và khi xác nhận đội hình; backend đồng thời kiểm tra đội là một trong hai đội của trận. Không thể thêm cầu thủ thuộc đội khác, thành viên đã rời đội hoặc đội không tham gia trận bằng cách sửa request từ client.
- Khi Organization Service không sẵn sàng hoặc không xác minh được, Match Service từ chối thao tác với lỗi dịch vụ tạm thời thay vì cho qua. Trước khi thêm/xác nhận, Match Service cũng kiểm tra lệnh treo đang có cho giải.
- **Xác minh:** Organization và Match `typecheck` và `build` đều pass. Chưa chạy integration/E2E trên database hoặc Docker ở lượt này.
- Ở mốc cập nhật tiếp theo, kiểm tra đội hình đã chuyển sang xét cả án treo theo số trận; luồng ghi thẻ từ diễn biến trận vốn đã dùng outbox để đồng bộ sang Discipline DB.

## 5.41 Đính chính kết quả playoff và cập nhật trận phụ thuộc an toàn (source update; migration v19)

- Có thể gửi yêu cầu đính chính làm thay đổi đội thắng ở trận knockout; hệ thống không chặn ngay khi tạo yêu cầu. BTC kiểm tra hồ sơ, và backend đối chiếu lại snapshot kết quả cũ khi ra quyết định để chống áp dụng trên dữ liệu đã đổi.
- Khi được duyệt, Match cập nhật kết quả, BXH, người duyệt và audit trong cùng transaction. Nếu đội thắng đổi, backend lần theo slot nguồn để cập nhật đối thủ của trận kế tiếp, giữ nguyên Match ID và ghi snapshot trước/sau của trận bị ảnh hưởng; event log/SSE phát invalidation cho trận nguồn và trận phụ thuộc.
- Trước khi cập nhật, backend đối chiếu người thắng đang lưu ở bracket với kết quả chính thức hiện hành, đồng thời kiểm tra cả projection Match lẫn bản ghi lịch ở Scheduling DB để không bỏ sót lịch chưa đồng bộ.
- Chỉ tự động áp dụng khi trận phụ thuộc chưa lên lịch, chưa bắt đầu và chưa có lineup, report, event, clock hoặc kết quả. Nếu đã có lịch hoặc hoạt động, transaction rollback toàn bộ, yêu cầu vẫn PENDING và API trả mã cụ thể để BTC xử lý lịch/sự cố trước; không tự xóa phân công, biên bản hay dữ liệu thi đấu. Yêu cầu sửa kết quả vòng bảng sau khi đã khóa qualifier playoff tiếp tục bị chặn để tránh làm sai đội đi tiếp.
- Migration Match v19 thêm JSONB snapshot tác động vào bảng yêu cầu hiện hữu theo kiểu additive và transactional; không sửa migration cũ, không xóa dữ liệu. Giao diện BTC giải thích điều kiện và tải lại dữ liệu trận sau khi quyết định.
- **Kiểm tra:** Match typecheck/build qua script test thành công; Match tests **53 pass / 0 fail / 20 skipped**. Hai integration test mới bao phủ việc đổi người thắng giữ Match ID/audit và chặn nếu trận sau đã lên lịch, nhưng đang skip vì chưa bật PostgreSQL integration trong lượt này. Chưa chạy migration v19 trên Docker hoặc E2E qua BTC UI.
- **Giới hạn còn lại:** nhánh có lịch công bố cần một quy trình phối hợp Scheduling DB để hủy/đổi lịch, kiểm tra xung đột đội/sân/trọng tài, lấy xác nhận và phát thông báo trước khi cho áp dụng hiệu chỉnh. Rút đội sau khi draw đã công bố, backup/restore rehearsal, ma trận quyền toàn API và vận hành production vẫn chưa hoàn tất; các giới hạn này không được coi là đã xử lý bởi migration này.

## 5.40 Án treo theo điều lệ và xác thực nguồn thẻ (18/11/2026)

- Policy nội bộ từ Tournament Service trả thêm ngưỡng thẻ vàng và số trận treo. Thẻ đỏ tự tạo án treo theo số trận cấu hình; thẻ vàng cộng dồn theo cầu thủ/giải và tạo án khi đạt ngưỡng. Thẻ bị void không còn được tính và án gắn với thẻ nguồn cũng được thu hồi.
- Án treo có `matches_suspended` được kiểm tra theo các trận của chính đội đã có kết quả APPROVED và trạng thái VERIFIED/LOCKED kể từ trận phát sinh án. Đội hình ở fixture kế tiếp bị chặn cho tới khi đội đã phục vụ đủ số trận; án chỉ cấu hình theo ngày tiếp tục dùng cách kiểm tra ngày hiện có. Migration Discipline v4 bổ sung cột/index, transactional và không xóa dữ liệu.
- Match Service kiểm tra thẻ phải thuộc đúng trận, giải, đội và cầu thủ có trong đội hình. Thẻ gửi từ outbox phải khớp event chưa bị void; thẻ nhập trực tiếp chỉ được ghi khi trận đang diễn ra. Điều này ngăn BTC/referee tạo thẻ cho cầu thủ hoặc đội không liên quan bằng cách sửa payload.
- Quyết định kỷ luật từ khiếu nại nay có thể tạo án treo theo số trận bổ sung hoặc thời hạn ngày. Backend bắt buộc gắn người bị xử lý với một cầu thủ có mặt trong đội hình trận khiếu nại; quyết định và án treo được ghi trong cùng transaction của Discipline DB và bản quyết định lưu liên kết tới suspension. Migration Discipline v5 thêm liên kết này.
- **Xác minh:** Tournament và Match Service typecheck/build pass. Chưa chạy migration trên database thật, test tích hợp hoặc E2E; vì vậy thay đổi schema và hành vi runtime chưa được nghiệm thu trên Docker.
- **Giới hạn:** nếu BTC sửa/hủy kết quả một trận đã được tính là trận phục vụ án treo, chưa có workflow tính lại dây chuyền kỷ luật. Chưa có thông báo đến cầu thủ/đội trưởng và khiếu nại hoặc kháng nghị riêng đối với quyết định kỷ luật.

## 5.42 Kiểm tra lại Match Service sau cập nhật cascade correction (18/11/2026)

- Chuyển kiểm tra schedule của trận phụ thuộc sang dynamic import để các tác vụ/test Match không khởi tạo Scheduling database pool khi không sử dụng. Trước thay đổi này, Match test suite thất bại ngay khi nạp module nếu môi trường test không khai báo `SCHEDULING_DATABASE_URL`; lỗi không liên quan đến nghiệp vụ.
- **Xác minh:** `corepack pnpm --filter @sfl/match-service typecheck` pass; Match tests **53 pass / 0 fail / 20 skipped**. Workspace `corepack pnpm run typecheck` và `corepack pnpm run build` đều pass. Web build vẫn cảnh báo JS chunk khoảng 630 kB chưa nén.
- 20 test bị skip cần PostgreSQL/integration fixture; do đó migration Match v19 và luồng cascade chưa được kiểm chứng trên database/Docker trong lượt này. Không có migration hoặc thay đổi dữ liệu/volume nào được chạy.
- **Giới hạn nghiệp vụ còn lại:** rút đội sau khi Draw đã xác nhận/công bố vẫn cần workflow phối hợp lịch, bracket, kết quả và thông báo. Sửa kết quả playoff khi trận phụ thuộc đã có lịch/hoạt động tiếp tục bị chặn an toàn; chưa có saga phối hợp Scheduling để dời/hủy lịch và xử lý trọng tài trước khi áp dụng.

## 5.43 Khóa cầu thủ tại thời điểm xác nhận roster (19/11/2026, source build)

- Cầu thủ được mời ở nhiều giải đang chờ có thể chọn một lời mời; lúc đồng ý, Tournament Service tuần tự hóa theo `player_id` và kiểm tra ngày giải trong transaction. Một quyền tham gia duy nhất được giữ cho các giải có ngày giao nhau; các giải không giao ngày vẫn dùng được cùng cầu thủ.
- Organization lọc cầu thủ đã xác nhận ở giải khác trước khi tạo lời mời, lưu snapshot ngày/tên giải trên invitation và chuyển lời mời PENDING giao nhau sang `INVALIDATED` sau khi một lời mời được chấp nhận. Transaction lưu thay đổi và hai thông báo idempotent cho đội trưởng/cầu thủ cùng lúc.
- API gửi hồ sơ kiểm tra claim ACTIVE cho toàn roster. Claim tiếp tục trong PENDING/WAITLIST/APPROVED/yêu cầu bổ sung/điều chỉnh; được giải phóng khi lời mời được đội trưởng hủy, cầu thủ rút xác nhận hợp lệ, hồ sơ bị từ chối/rút/không được chọn hoặc ngày giải đã kết thúc. Roster snapshot đã gửi không bị sửa ngầm.
- Organization migration v26 mở rộng trạng thái invitation và lưu ngày/tên giải/xung đột; Tournament migration v19 tạo `tournament_player_participation_claims`. Cả hai additive, không xóa/reset database hoặc seed. Organization thử reconcile invitation ACCEPTED cũ theo thứ tự phản hồi; các hồ sơ lịch sử đang xung đột được giữ nguyên và log, cần rà soát trước khi gửi/duyệt lại.
- **Xác minh source:** workspace `typecheck` và `build` đều pass. Organization tests 2 pass / 11 skipped; Tournament tests 26 pass / 12 skipped. Integration mới cho xung đột invitation và khóa đồng thời cần database kiểm thử riêng, hiện skipped vì chưa cấu hình. Web build có cảnh báo bundle JS khoảng 673 kB chưa nén.
- **Giới hạn triển khai:** chưa chạy migration, Compose rebuild/restart hoặc API/browser E2E trong lượt này vì Docker CLI không có trong shell. Vì vậy runtime tại localhost chưa nhận schema/API mới. Không chạy seed hoặc reset; cần áp dụng migrations Organization v26 và Tournament v19 rồi dựng lại service để dùng chức năng mới.

## 5.44 Tái cấu trúc quy trình BTC thành 7 bước (20/11/2026)

- Quản lý giải tại đúng vị trí hiện có được chuyển thành 7 bước hiển thị: Thông tin & điều lệ; Xét duyệt & chốt danh sách; Bốc thăm & chia bảng; Sơ đồ thi đấu; Lập lịch & phân công trọng tài; Điều hành thi đấu; Tổng kết giải. Mỗi bước chỉ render nội dung tương ứng; không thêm mục sidebar hoặc trạng thái vòng đời database.
- UI map vị trí lưu workflow cũ sang bảy bước mới để tránh migration. Hoàn tất chốt roster mới mở bước bốc thăm; draw công bố mới mở sơ đồ; fixture công bố mới mở lập lịch. Backend kiểm tra công bố fixture qua internal endpoint Match Service; endpoint chỉ trả tình trạng stage và số trận, không chia sẻ database giữa service.
- Bước chốt danh sách vẫn áp dụng hàng đợi đăng ký hiện hành: khi còn chỗ và còn hồ sơ có thể xét thì phải xử lý trước; được chốt dưới mức tối đa khi không còn hồ sơ chưa xử lý; ở mức tối đa, hồ sơ còn lại không chặn chốt. Không thay đổi hoặc triển khai thêm thuật toán bốc thăm/sơ đồ/lập lịch trong phần tái cấu trúc này.
- **Xác minh source:** workspace `corepack pnpm run typecheck` và `corepack pnpm run build` pass. Tournament tests: **28 pass / 0 fail / 13 skipped**; Match tests: **53 pass / 0 fail / 20 skipped**; Organization tests: **5 pass / 0 fail / 13 skipped**. Các test bị bỏ qua cần PostgreSQL/integration environment; chưa tính là E2E.
- Frontend production bundle pass nhưng Vite cảnh báo chunk JavaScript 706 kB chưa nén vượt ngưỡng 500 kB. Không có test E2E trên database trong lượt này. Docker CLI không có trong PATH nên chưa rebuild/restart Compose; trang localhost hiện tại chưa được xác nhận đã nhận bundle mới. Không chạy migration, seed, reset DB hoặc thay đổi volume/SMTP.

## 5.45 Làm mới điều kiện nút chốt danh sách (20/11/2026)

- Khi BTC mở modal chốt danh sách, giao diện tải lại hồ sơ và trạng thái mới nhất thay vì dùng snapshot cũ từ lúc workspace được mở. Điều này tránh nút chốt còn bật sau khi trạng thái hồ sơ đã thay đổi ở tab xét duyệt.
- Còn suất và còn hồ sơ chưa có quyết định cuối (`PENDING`, bổ sung chưa hoàn tất, `WAITLIST` hoặc cần điều chỉnh): khóa nút chốt và yêu cầu BTC xử lý tiếp. Đạt tối đa: có thể chốt nếu các điều kiện khác hợp lệ. Đã đóng đăng ký, hết hồ sơ chưa xử lý và số đội được duyệt trong khoảng min/max: có thể chốt.
- Backend tiếp tục áp dụng cùng điều kiện trong transaction và kiểm tra lại trước khi tạo snapshot; không dựa riêng vào disabled state frontend. Tournament tests sau cập nhật: **28 pass / 0 fail / 13 skipped**; web-client typecheck và production build pass. Các skip cần database; chưa chạy E2E hoặc áp dụng thay đổi vào tiến trình đang chạy.

## 5.46 Nghiệm thu phân hệ Bước 5 trên giải demo (21/11/2026)

- Trên bản web-client dev tại `localhost:5174`, trang BTC của giải demo đọc được 32 đội đã chốt và sơ đồ Bước 4 với 119 fixtures. Tab Lập lịch thi đấu, Phân công trọng tài, Kiểm tra & công bố và lựa chọn phân công thủ công/tự động hiển thị.
- Tại origin này, trạng thái test Bước 5 là **0 sân, 0 hồ sơ trọng tài, 0/119 lịch và 0/119 phân công**. Thử chạy phân công theo chính sách từng đợt khi chưa công bố lịch bị chặn với thông báo phù hợp. Chưa có fixture đủ nguồn lực để xác nhận công bố lịch/trọng tài.
- **Kiểm thử đã chạy:** web-client typecheck pass; production build pass (Vite cảnh báo chunk JS 1,039 kB vượt 500 kB); planner trọng tài tự động có 9/9 unit test pass. Browser smoke chỉ xác nhận trang và controls, không phải E2E nghiệp vụ.
- **Chưa nghiệm thu:** 9 tổ hợp Bước 3–5, lập lịch thủ công/tự động và các ràng buộc nguồn lực, công bố lịch độc lập, công bố trọng tài, đồng bộ actor, xử lý sau khi lịch/nguồn lực đổi, quyền xem trọng tài, chuyển Bước 6 và các luồng đa tab/reset. Không tạo dữ liệu lịch/trọng tài giả để đánh dấu đạt.
- Lượt nghiệm thu không gọi API mutation, không ghi database, không chạy migration/seed và không reset volume. Docker CLI không khả dụng trong shell; bản đang xem ở 5174 là dev preview, chưa xác nhận Docker runtime được rebuild.
- Kết luận: **chưa đủ điều kiện xác nhận toàn bộ Bước 5**. Unit test, typecheck/build và browser smoke được báo riêng; các ca E2E ở trên vẫn NOT TESTED. Chi tiết nằm trong [DRAW_WORKSPACE_DEMO.md](./DRAW_WORKSPACE_DEMO.md).

## 5.47 Tách Bước 5 lập lịch và Bước 6 trọng tài (22/11/2026)

- Stepper BTC đổi sang 8 bước. Các bước 5 (Lập lịch thi đấu), 6 (Phân công trọng tài) và 7 (Điều hành giải đấu) là ba nội dung độc lập sau khi Bước 4 công bố sơ đồ. Step 6 không ghi đè con trỏ workflow đã lưu; điều hành không bị khóa bởi việc chưa phân công các vòng tương lai. Bước 8 chỉ mở sau khi giải hoàn tất và các kết quả trận đã xử lý.
- Workspace localStorage Bước 5 được tái sử dụng theo `tournamentId` và snapshot Bước 4: mode lịch chỉ hiện lập lịch/kiểm tra-công bố; công bố lịch khóa phiên bản và chuyển sang Bước 6. Bước 6 tái sử dụng nguồn lực, mô hình, tổ, phân công thủ công/tự động và công bố hiện có. Reset Bước 5 xóa lịch và dữ liệu trọng tài phụ thuộc; Reset Bước 6 chỉ xóa dữ liệu trọng tài và giữ lịch chính thức.
- Bỏ nút bắt đầu giải khỏi Bước 6; mở Bước 7 không đổi trạng thái vòng đời giải. Match Service chỉ cho START_MATCH khi trận đã có hai đội khác nhau, lịch `PUBLISHED`, ít nhất một trọng tài được công bố và đúng một người có thẩm quyền kết quả. Schema hiện tại không lưu danh mục vị trí bắt buộc theo mô hình trận, vì vậy gate backend xác minh người có thẩm quyền nhưng chưa thể đối chiếu đầy đủ từng vị trí bắt buộc cấu hình cục bộ.
- Kiểm thử đã chạy: web-client typecheck PASS; web-client build PASS (Vite cảnh báo bundle chính khoảng 1 MB); referee planner 9/9 PASS; match-service build PASS; match-service test 65 PASS / 0 FAIL / 21 SKIPPED. Ba test mới kiểm tra đội chưa xác định, thiếu lịch công bố, thiếu trọng tài/quyền xác nhận và trường hợp hợp lệ. Các skip cần database/integration.
- Chưa E2E chuyển Bước 4→5→6→7 hoặc kiểm thử ba thể thức trên UI. Browser reload tại `localhost:5173` vẫn hiển thị stepper 7 bước; vì vậy artifact build chưa được xác nhận là runtime đang chạy. Docker CLI không có trong shell hiện tại, không chạy Compose, không migration, không reset database/volume. Cần rebuild/restart web-client và match-service từ môi trường đang chạy để kiểm tra bản runtime; localStorage hiện có không bị xóa.

## 5.48 Thiết kế lại workspace lập lịch Bước 5 (22/11/2026)

- Tổ chức lại chế độ lập lịch thành workspace riêng, không hiển thị điều khiển trọng tài. Giao diện kế thừa giải, thể thức, danh sách đội, snapshot fixture và lịch local hiện có; không sinh lại cặp đấu hoặc sửa nguồn fixture.
- Bổ sung hướng dẫn theo trạng thái dữ liệu, thống kê giải, thanh công cụ sân/thiết lập/kiểm tra/tự động, bộ lọc chung và ba chế độ xem loại trừ nhau: sơ đồ fixture dùng lại component Bước 4, lịch trực quan theo ngày/địa điểm/sân với khoảng chiếm dụng, và danh sách lọc được. Cả ba đọc cùng lịch nháp localStorage; mở trận từ mọi chế độ dùng chung panel chỉnh lịch.
- Panel trận hỗ trợ chọn ngày, sân, giờ hợp lệ theo module kiểm tra hiện hữu; hiển thị đề xuất và lỗi, lưu/chỉnh/xóa/khóa nháp. Trung tâm kiểm tra/công bố tóm tắt lỗi bắt buộc, cảnh báo, khoảng ngày/địa điểm và preview; công bố lịch không đòi hỏi trọng tài.
- Kết quả xác minh: web-client typecheck PASS, production build PASS; referee-planner tests 9/9 PASS. Build báo cảnh báo bundle JS lớn hơn 500 kB.
- Docker Compose build riêng image `web-client` và cập nhật riêng container `student-football-league-web-client-1`; không cập nhật các backend service, migration, database hoặc volume. HTTP tại 5173 xác nhận đang phục vụ bundle `index-mt1tsURP.js`.
- **Browser smoke PASS:** đăng nhập phiên BTC sẵn có, mở giải Seed 1 kịch bản mới, xác nhận stepper 8 bước và workspace Bước 5 mới; chuyển qua lại giữa sơ đồ/lịch trực quan/danh sách; chọn một trận trong danh sách mở đúng panel chung; chọn Tự động mở riêng cấu hình phạm vi/ưu tiên. Không gọi API mutation. Sau khi refresh danh sách, fixtures vẫn là 12 trận.
- **E2E chức năng còn NOT TESTED:** giải mở ở runtime không có sân phù hợp (0 sân), nên không thể lưu lịch, áp dụng phương án hoặc công bố. Ba thể thức, ràng buộc sân thật, tính chính xác của planner trên dữ liệu runtime, reload bản lịch nháp đã tạo, công bố và đồng bộ actor chưa được xác minh. Không xem smoke/unit/build là bằng chứng cho các luồng này.

### Bước 4 tự chuẩn bị sơ đồ — 25/11/2026

- Giao diện chính thức tự gọi API sinh sơ đồ khi vào Bước 4 nếu đã có kết quả Bước 3 công bố và còn thiếu stage. Dùng điều lệ đã ghim; đọc lại các stage đã có, không thay mã trận hoặc sơ đồ đã công bố.
- Bỏ các nút Sinh sơ đồ/Lưu nháp/Kiểm tra cấu trúc; giữ nút Xác nhận & công bố sơ đồ thi đấu. Backend tiếp tục kiểm tra đầy đủ khi công bố, không tự công bố hoặc chuyển bước.
- Typecheck và Docker frontend build PASS. Chrome trên cổng 5173 đã tự tạo đúng 31 trận DRAFT cho giải kết hợp (24 vòng bảng, 7 knockout); reload giữ ID, không gọi sinh lần nữa. Hai sơ đồ vòng tròn/knockout đã công bố giữ nguyên ID và trạng thái. Không bấm công bố thay BTC trong lần kiểm tra này; không chạy lại bộ kiểm thử nghiệp vụ khác.
