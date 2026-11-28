# Quy trình roster tham gia giải

## Trách nhiệm

- Đội trưởng duyệt yêu cầu gia nhập CLB; việc này không thay đổi trong luồng giải đấu.
- Đội trưởng chọn thành viên CLB, cấu hình vai trò trong giải/vị trí/số áo và gửi lời mời.
- Cầu thủ dùng tài khoản được liên kết với hồ sơ thành viên để đồng ý hoặc từ chối lời mời.
- Đội trưởng gửi hồ sơ đội cùng danh sách các lời mời đã được chấp nhận.
- BTC quyết định trên toàn bộ hồ sơ đội: duyệt, từ chối có lý do hoặc yêu cầu bổ sung có nội dung.
- BTC chốt danh sách tại bước roster lock của giải. Không có quyết định xét duyệt từng cầu thủ.

## API của Organization Service

- `POST /teams/:teamId/tournaments/:tournamentId/invitations`: captain gửi lời mời theo lô.
- `GET /teams/:teamId/tournaments/:tournamentId/invitations`: captain xem trạng thái, nhắc hoặc thu hồi lời mời.
- `GET /tournament-invitations/my`: cầu thủ xem lời mời.
- `POST /tournament-invitations/:id/respond`: cầu thủ phản hồi lời mời của chính mình.
- `POST /registrations`: gửi hồ sơ mới; backend chỉ lấy cầu thủ có lời mời `ACCEPTED` và ghi snapshot.
- `PUT /registrations/:id`: BTC quyết định trên hồ sơ đội.
- `POST /registrations/:id/resubmit`: captain gửi lại hồ sơ sau yêu cầu bổ sung.

Các API roster cũ cho captain thêm/xóa/sửa trực tiếp và API BTC review từng roster đã được rút khỏi route. Các cột review cũ vẫn còn trong database để tương thích dữ liệu lịch sử, nhưng roster mới không được xem như đã được BTC duyệt từng người.

API Gateway phải định tuyến `/tournament-invitations/**` tới Organization Service và yêu cầu session người dùng cho các route này; thiếu ánh xạ này sẽ làm danh sách/phản hồi lời mời của cầu thủ trả 404 dù route service đã có.

## Yêu cầu rút đội sau khi được duyệt

- Đội trưởng gửi `POST /registrations/:id/withdrawal-requests` kèm lý do tối thiểu 10 ký tự. Hồ sơ vẫn giữ `APPROVED` trong khi chờ BTC.
- BTC được phân công xem `GET /tournaments/:tournamentId/withdrawal-requests` và ra quyết định bằng `POST /withdrawal-requests/:requestId/decision` (`APPROVED` hoặc `REJECTED`). Từ chối bắt buộc có lý do.
- Khi duyệt, Organization đồng bộ reservation với Tournament trước, sau đó ghi quyết định, chuyển registration sang `WITHDRAWN`, ghi phiên bản và thông báo đội trưởng. Nếu ghi local thất bại sau đồng bộ, service thử bù reservation về `APPROVED`.
- Chỉ cho chấp thuận khi Tournament báo roster còn có thể chỉnh sửa. Khi roster đã chốt, hệ thống chặn duyệt rút đội vì chưa có quy trình đánh giá tác động tới draw, lịch và trận đã diễn ra. Không tự xóa trận hoặc tự gán xử thua.
- Migration Organization v18 thêm bảng yêu cầu rút đội, bảo toàn hồ sơ cũ.

## Quyền xác nhận kết quả

- API ghi kết quả và gửi biên bản chỉ chấp nhận REFEREE được gán quyền `FINALIZE` cho đúng trận.
- Biên bản thông thường được xác nhận bởi trọng tài quyền cuối; kết quả và bảng xếp hạng được cập nhật trong transaction của Match.
- Trọng tài có thể đánh dấu biên bản cần BTC xem xét khi có ngoại lệ. Biên bản ngoại lệ ở trạng thái chờ, chưa công khai kết quả; BTC được phân công mới quyết định.
- BTC vẫn có luồng yêu cầu hiệu chỉnh kết quả đã chính thức, có snapshot, lý do và audit. Việc hiệu chỉnh làm đổi người thắng playoff vẫn bị chặn cho tới khi có xử lý phụ thuộc trận an toàn.

## Dữ liệu và bảo toàn hồ sơ

Migration Organization v16 thêm lời mời tham gia giải, snapshot hồ sơ roster, version hồ sơ và lịch sử quyết định. Migration v17 thêm durable notification outbox và retry. Các migration chạy trên database `sfl_team`, additive và không sửa/xóa dữ liệu cũ. Khi BTC yêu cầu bổ sung, captain có thể hủy lời mời cũ, mời người thay thế, đợi xác nhận rồi gửi lại; snapshot hiện tại chỉ được thay trong trạng thái yêu cầu bổ sung.

## Kiểm thử

Organization integration tests cần chạy với `DATABASE_URL` trỏ chính xác đến `sfl_team` và `RUN_ORG_DB_INTEGRATION=1`. Các kịch bản hiện có kiểm tra quyền phản hồi theo user, trạng thái ACCEPTED trước khi vào roster, ngăn đăng ký cầu thủ trùng và retry quyết định BTC. Tournament tests kiểm tra việc chốt roster theo số lượng/đội hình mà không cần trạng thái duyệt cầu thủ.

Thông báo in-app đi qua outbox Organization và được thử lại nếu Notification Service tạm thời lỗi.

## Thứ tự hồ sơ và xét duyệt song song

- Hệ thống nhận hồ sơ hợp lệ trong toàn bộ thời hạn đăng ký; `max_teams` và giới hạn theo trường chỉ áp dụng khi BTC duyệt, không giới hạn số hồ sơ nhận vào.
- Organization cấp `submission_sequence` tăng dần theo giải và `submitted_at` theo thời gian PostgreSQL khi tạo hồ sơ. Migration Organization v20 backfill hồ sơ cũ, thêm unique index theo giải và trigger ngăn sửa STT/thời gian sau khi gửi.
- Danh sách BTC sắp tăng dần theo STT và xử lý hồ sơ chờ duyệt theo thứ tự gửi. Organization khóa hàng xét duyệt trong lúc đồng bộ quyết định; Tournament tuần tự hóa cập nhật hạn mức trong transaction để không duyệt vượt suất toàn giải hoặc theo trường.
- Hồ sơ hợp lệ ở `PENDING` (Chờ duyệt) khi còn chỉ tiêu toàn giải và theo trường. Nếu chỉ tiêu giải hoặc trường đã đầy, hồ sơ ở `WAITLIST` (Chờ suất); không chiếm suất đã duyệt và không được duyệt vượt điều lệ. Hai hàng được xét theo thứ tự riêng, backend luôn kiểm tra lại chỉ tiêu trước khi duyệt.
- Sau mỗi quyết định, giao diện tải lại hàng chờ để hồ sơ kế tiếp thao tác được ngay. Migration Tournament v25/Organization v35 thuộc yêu cầu gom hàng đã áp dụng trước khi người dùng đính chính ngày 25/11; giữ lịch sử migration, không sửa lại migration đã chạy. Theo đính chính, khôi phục phân loại chờ suất theo chỉ tiêu và đối soát riêng hai hồ sơ IUH/HUTECH, không thay quyết định BTC hoặc hai hồ sơ HITU/HCMCT bổ sung.
- `NEEDS_SUPPLEMENT` cần nội dung và hạn bổ sung, tạm rời hàng. Khi captain gửi lại đúng hạn, thời điểm hoàn tất được ghi lại, roster snapshot mới được lưu, trạng thái về `PENDING` và hồ sơ trở lại hàng theo STT ban đầu.
- Tournament kiểm tra tổng chỉ tiêu và chỉ tiêu trường trong transaction khóa dòng giải. Chỉ reservation `APPROVED` đã đồng bộ mới tính vào chỉ tiêu; thao tác đồng thời không thể duyệt vượt hạn mức.
- Hồ sơ vượt chỉ tiêu vẫn được lưu. Khi hết hạn và trước khi chốt, BTC phải quyết định mọi hồ sơ chưa xử lý; hệ thống không để hồ sơ `PENDING` vô thời hạn. Chỉ đội `APPROVED` chiếm suất; các hồ sơ còn lại được BTC từ chối có lý do.
- Kết thúc thời hạn tự đóng nhận hồ sơ mới; BTC vẫn xử lý hồ sơ nộp đúng hạn và yêu cầu rút. Chốt danh sách là bước riêng, yêu cầu đủ số đội tối thiểu, không vượt tối đa, không còn hồ sơ/yêu cầu rút đang chờ và roster hợp lệ; BTC xác nhận để khóa snapshot.
- Trong development/test, `ENABLE_MANUAL_REGISTRATION_CONTROL=true` hiển thị nút **Đóng đăng ký (Test)**/**Mở lại đăng ký (Test)**. Các nút gọi API thật, ghi audit; reopen chỉ dùng được khi hạn đăng ký thật còn hiệu lực. Production luôn từ chối API test dù flag bị bật nhầm.

## Kiểm thử và giới hạn xác minh

Organization unit/integration tests và Tournament unit/integration tests được chạy bằng lệnh `corepack pnpm --filter @sfl/organization-service test` và `corepack pnpm --filter @sfl/tournament-service test`. Các bài integration yêu cầu database service riêng theo hướng dẫn trong test; không chạy trên dữ liệu người dùng. Kiểm thử tải 35 hồ sơ và duyệt đồng thời cần môi trường test dùng database riêng, không dùng volume dữ liệu demo.

### Xác minh triển khai ngày 12/11/2026

- Build Docker thành công cho Auth, Organization, Tournament, Notification, API Gateway và Web Client; cập nhật container tương ứng. Các migration jobs kết thúc thành công, không reset database/volume.
- Healthcheck Auth, Tournament, Organization, Match, Notification, Gateway và Web Client trả HTTP 200.
- Sửa route Gateway bị thiếu cho `/tournament-invitations/**`, nguyên nhân khiến cầu thủ trước đó nhận 404. Cập nhật seed development để các tài khoản cầu thủ của hai đội demo liên kết đúng IUH/HUTECH và điền MSSV còn trống; giữ nguyên MSSV đã có.
- API E2E với database/container thật: captain gửi 7 lời mời; cả 7 cầu thủ đăng nhập và chấp nhận; captain gửi hồ sơ có roster; BTC IUH nhìn thấy và duyệt hồ sơ đội; captain thấy trạng thái `APPROVED`. BTC đọc được 7 roster snapshot và 2 phiên bản lịch sử; cầu thủ nhận thông báo lời mời trong ứng dụng.
- Bộ Organization DB integration tests trên `sfl_team`: 5/5 pass. Tournament tests xác nhận điều kiện roster lock cấp đội; chưa đóng kỳ đăng ký giải đang dùng hoặc khóa roster trực tiếp để tránh chặn các đội khác đăng ký.
- Browser E2E trực quan chưa được xác nhận trong lượt này; xác minh luồng qua API thật và database, chưa kiểm tra toàn bộ trạng thái hiển thị sau thao tác trong trình duyệt.

### Kết quả xác minh hiện tại

- Tournament và Organization build thành công; Web Client typecheck thành công. Tournament tests: 24 pass, 7 DB integration tests skipped do không bật `RUN_TOURNAMENT_DB_INTEGRATION`; Organization tests: 1 pass, 8 DB integration tests skipped do không bật `RUN_ORG_DB_INTEGRATION`.
- Không thể chạy Compose, migration hoặc API E2E trong lượt này vì `docker` CLI không có trong PATH/môi trường shell. Trang đang mở còn phục vụ bundle cũ, nên giao diện trên server chưa phản ánh thay đổi source và chưa được xác minh sau rebuild.
- Migration audit/manual-close, API production gate, audit row trong DB, auto-expiry với database thật và hành trình BTC từ đóng sớm đến chia bảng cần chạy lại trên môi trường DEV/TEST có database. Không chạy seed/reset hoặc thay đổi volume trong lượt này.
- Yêu cầu rút sau khi draw đã publish/thi đấu vẫn bị chặn; chưa có quy trình đánh giá tác động và điều chỉnh draw/lịch/kết quả an toàn.

### Ghi chú kiểm thử lịch sử ngày 18/11/2026

Các kết quả FIFO, khóa review toàn giải và triển khai Docker ghi dưới đây thuộc lần kiểm thử cũ. Chúng không mô tả quy tắc hiện tại: thứ tự gửi chỉ để hiển thị, BTC có thể xét duyệt song song; không dùng các kết quả lịch sử này để kết luận trạng thái triển khai hiện thời.

### Xác minh source ngày 19/11/2026

- `corepack pnpm run build` hoàn tất cho toàn bộ workspace; typecheck Organization, Tournament và Web Client đều thành công.
- Organization: 1 unit test pass, 8 DB integration tests bỏ qua do thiếu cấu hình database test. Tournament: 24 unit tests pass, 7 DB integration tests bỏ qua do thiếu cấu hình database test.
- Bản build source không áp dụng migration vào database và không thay đổi seed/volume. Không thể rebuild container hoặc kiểm tra API/browser sau triển khai vì Docker CLI không khả dụng trong shell hiện tại.
- BTC có phân trang 12 hồ sơ/trang và thấy riêng số cầu thủ trong roster gửi lên cùng số lời mời đã xác nhận. Luồng rút hồ sơ PENDING được phép đi qua đồng bộ trạng thái durable như các trạng thái chờ khác.

### Xem xét lại phê duyệt

- Modal BTC tải hồ sơ, roster, lịch sử đăng ký và các sự kiện xem xét lại từ API; mặc định không mở form. BTC chọn giữ phê duyệt, yêu cầu giải trình/bổ sung hoặc thu hồi trước khi nhập nội dung và xác nhận.
- Chỉ mở yêu cầu mới khi kỳ đăng ký thực sự đang mở. Khi hết hạn hoặc đóng DEV, yêu cầu đã mở vẫn có thể được xử lý; không thể thu hồi phê duyệt sau khi khóa roster/chốt danh sách. Yêu cầu đang mở tiếp tục chặn chốt danh sách.
- Migration Organization số 24 thêm bảng append-only `team_registration_approval_review_events` lưu người thực hiện, thời điểm, ghi chú, snapshot roster và trạng thái trước/sau. Migration cũng bỏ ràng buộc cũ ngăn lưu nhiều phiên bản có cùng hành động; không xóa dữ liệu.
- Xác minh ngày 19/11/2026: Organization, Tournament và Web Client typecheck thành công; Web Client build thành công. Organization: 2 unit tests và 2 review DB integration tests pass (luồng mở → phản hồi → yêu cầu bổ sung → phản hồi → giữ duyệt; thu hồi ghi `APPROVAL_REVOKED` và giữ hồ sơ). Các fixture riêng được dọn sau test. Tournament: 25 unit tests pass, 7 DB integration tests bỏ qua vì chúng cần cấu hình database test riêng. Đã build/restart Organization, Tournament và Web Client trên compose test; migration báo database đã current, Organization và Tournament healthy. Browser xác nhận modal có hồ sơ/roster/timeline, ba lựa chọn, form chỉ mở sau khi chọn hành động và ngày theo `dd/MM/yyyy HH:mm`. Chưa gửi hành động trên các đội seed thật để tránh thêm lịch sử/thông báo vào hồ sơ demo; kiểm tra gửi notification qua API thật vẫn chưa thực hiện.

### Modal hồ sơ BTC — cập nhật 19/11/2026

- Hồ sơ đăng ký được chia thành tab “Hồ sơ đăng ký” và “Lịch sử xử lý”; trong tab hồ sơ có thông tin đội, điều lệ, roster đã nộp dạng bảng có tìm kiếm và chi tiết cầu thủ ngay trong cùng modal. Quyết định ban đầu (duyệt, yêu cầu bổ sung, từ chối) nằm trong modal và vẫn gọi API hiện tại.
- Ngày sinh được thêm vào JSON snapshot cho lần nộp/bổ sung mới. Hồ sơ snapshot cũ không có ngày sinh có thể dùng thông tin hiện tại của cầu thủ làm dự phòng.
- Web Client và Organization Service typecheck/build thành công. Bộ Organization tests chạy 11/12 pass; test FIFO “requires BTC to decide applications in submission order” thất bại vì test environment không cấu hình `Tournament registration` upstream. Hai review DB integration tests pass; không chạy seed/reset.
- Compose test ban đầu đụng cổng Redis của stack khác; đã khởi động lại bằng override tạm dùng UI `15173`, Gateway `18080`, PostgreSQL `15432`, Redis `16379` và cổng API riêng cho từng service. Organization, Tournament, Auth, Match, Notification, Gateway và Web Client đều healthy; migration jobs kết thúc thành công. Không chạy profile seed và volume PostgreSQL test được giữ nguyên.
- Browser xác nhận modal hồ sơ hiển thị đủ hai tab, điều lệ, roster 14 người với ngày sinh định dạng Việt Nam; panel chi tiết cầu thủ mở/đóng trong cùng modal. Chưa xác minh bằng browser sau lần build Web Client cuối cùng vì phiên đăng nhập của tab chuyển về trang danh sách khi tải lại; build và container đã cập nhật, không thực hiện quyết định có ghi dữ liệu.

### Đăng ký cầu thủ ở nhiều giải có lịch giao nhau

- Organization tiếp tục sở hữu hồ sơ/roster; Tournament sở hữu lịch giải, hạn mức và quyền tham gia theo ngày. Trao đổi dùng API nội bộ xác thực; không đọc chéo database.
- Mô tả trước đó về việc chờ BTC duyệt mới khóa quyền tham gia đã được thay bằng quy tắc dưới đây: claim được tạo khi cầu thủ xác nhận. Lời mời chưa xác nhận không khóa quyền tham gia.
- API tạo lời mời và API gửi hồ sơ kiểm tra quyền tham gia/claim ở backend; Tournament khóa theo cầu thủ trong transaction khi xác nhận. BTC không còn là điểm đầu tiên phát hiện tranh chấp roster.
- Organization chuyển lời mời đang chờ giao nhau sang `CONFLICTED`, thông báo đội trưởng và giữ roster/snapshot đã nộp nguyên trạng. Đội trưởng thay cầu thủ qua quy trình hiện có khi roster còn được chỉnh sửa.
- Worker Organization tự hết hiệu lực yêu cầu điều chỉnh khi hết hạn phản hồi hoặc kỳ đăng ký đóng, ghi lý do, chuyển REJECTED và đồng bộ reservation. Chốt roster bị chặn khi còn hồ sơ cần điều chỉnh.
- Hồ sơ WAITLIST không khóa quyền tham gia; BTC có thể duyệt nếu suất được giải phóng. Sau khi Tournament khóa roster, Organization đóng các hồ sơ chờ suất chưa được chọn thành REJECTED qua decision outbox.
- Duyệt yêu cầu rút đội hoặc thu hồi phê duyệt xóa claim tham gia; không tự động duyệt hồ sơ khác.
- Migration Organization v25 thêm trạng thái, xung đột và hạn điều chỉnh; Tournament v18 thêm roster IDs và bảng claim cầu thủ. Organization đồng bộ roster hiện có khi khởi động, trước luồng đăng ký/xét duyệt liên quan và retry định kỳ nếu lần đồng bộ khởi động lỗi, để lấp reservation cũ thiếu player IDs; Tournament bỏ qua hồ sơ đã rút/từ chối và khóa việc đồng bộ cùng quyết định duyệt/rút. Các migration cộng thêm, không reset database hoặc seed.
- Integration tests mới kiểm tra trả hồ sơ khác về điều chỉnh, chặn duyệt xung đột và đồng thời hai giải. Chúng cần `RUN_TOURNAMENT_DB_INTEGRATION=1` cùng database kiểm thử riêng; không chạy với database người dùng hoặc seed thật.

### Xác minh source ngày 19/11/2026 — xung đột roster giữa các giải

- Organization và Tournament typecheck/test đều thành công; Organization có 2 unit tests pass và 10 DB integration tests bỏ qua. Tournament có 26 unit tests pass và 11 DB integration tests bỏ qua. Các bài DB integration cần database kiểm thử riêng, chưa chạy trên database hoặc seed người dùng.
- Web Client typecheck và production build thành công. Vite báo bundle JavaScript vượt ngưỡng 500 kB; đây là cảnh báo phân tách bundle, không làm build thất bại.
- Chưa áp dụng migration, rebuild/restart container, hoặc kiểm tra luồng qua API/browser sau triển khai trong lượt này. Vì vậy trạng thái runtime và dữ liệu hiện có chưa được xác minh cập nhật; cần chạy migration Organization v25/Tournament v18 trong môi trường triển khai trước khi dùng API mới.

### Fixture Seed 1 kiểm tra trùng lịch

- Seed 1 mở rộng gồm giải A với 12 hồ sơ (tối đa 8, tối thiểu 4) và giải B có một hồ sơ của đội 01. Hai giải dùng cùng khoảng ngày; hồ sơ đội 01 dùng cùng roster 14 cầu thủ ở cả hai giải, cả hai đang PENDING.
- Duyệt đội 01 ở một giải trước để kiểm tra claim được giữ và hồ sơ ở giải còn lại tự chuyển `CONFLICT_ADJUSTMENT_REQUIRED`; sau đó đăng nhập đội trưởng 01 để điều chỉnh roster.
- `Add-Seed1OverlapToCurrent.ps1` bổ sung một cặp giải mới và đội demo 13 vào stack development hiện tại (cổng 5173), giữ nguyên volume và dữ liệu sẵn có. Hai hồ sơ của đội 13 dùng cùng roster và đều `PENDING`. Script build Web Client/Auth/Organization/Tournament, chạy migration và restart các service cần thiết.
- `Run-TestSeed.ps1 -Seed 1 -Expanded1` vẫn là tùy chọn riêng cho volume isolated seed; script yêu cầu xác nhận trước khi reset volume đó. Không dùng script isolated khi mục đích là thêm fixture vào hệ thống đang chạy.

### Fixture xác nhận lời mời cầu thủ trùng lịch

- Fixture cộng thêm dùng CLB `IUH Demo Club 31`, hai giải A/B mới cùng thời gian và 14 cầu thủ có lời mời `PENDING` ở cả hai giải. Không tạo hồ sơ đăng ký và không đánh dấu cầu thủ đã chấp nhận sẵn.
- Đăng nhập tài khoản cầu thủ `dataset.player0601@football.local` để chấp nhận lời mời ở giải A; lời mời giải B của cùng cầu thủ phải chuyển `CONFLICTED` và backend không cho xác nhận lời mời cũ ở B. Cầu thủ `dataset.player0602@football.local` có thể được dùng để thử ngược lại.
- Tài khoản đội trưởng là `dataset.captain31@football.local`. Tài khoản được tạo với `DEMO_ACCOUNT_PASSWORD` trong môi trường; nếu biến này không được cấu hình thì mật khẩu mặc định là `SflTest@2026!`.
- Hai giải có ID `12050c82-ca1e-5174-9f23-6065cf7b58b5` và `3b78de98-ed74-5980-83d9-6fee8237ed1c`. Fixture dùng ID ổn định và chỉ thêm bản ghi, không xóa hoặc reset dữ liệu đang có.

### Quy tắc mới: khóa quyền tham gia khi cầu thủ xác nhận (19/11/2026)

- Mốc khóa là lúc cầu thủ đồng ý lời mời, không phải lúc BTC duyệt hồ sơ. Tournament Service giữ claim theo `invitation_id`, `player_id`, `team_id`, `tournament_id`; transaction lấy advisory lock theo cầu thủ rồi so sánh khoảng ngày giải inclusive. Hai xác nhận đồng thời của cùng cầu thủ ở hai giải giao nhau chỉ có một yêu cầu được nhận.
- Các lời mời `PENDING` không giữ claim và có thể cùng tồn tại. Khi cầu thủ đồng ý, Organization cập nhật các lời mời `PENDING` có khoảng ngày giao nhau thành `CONFLICTED`, giữ lịch sử, nêu giải gây xung đột và báo đội trưởng. Giải không giao thời gian vẫn có thể được đồng ý.
- Trước khi tạo lời mời, backend gọi API Tournament kiểm tra quyền tham gia; màn hình chọn roster dùng cùng API và loại cầu thủ đã có claim ở giải giao nhau. Trước khi gửi hồ sơ, Tournament kiểm tra lại mọi cầu thủ trong roster có claim `ACTIVE`, để không thể bỏ qua xác nhận qua API trực tiếp.
- Claim còn hiệu lực với hồ sơ `PENDING`, `WAITLIST`, `APPROVED`, `NEEDS_SUPPLEMENT` và `CONFLICT_ADJUSTMENT_REQUIRED`. Khi đội trưởng hủy lời mời đã chấp nhận hoặc hồ sơ bị từ chối/rút/không được chọn và đóng, claim được giải phóng. Rút xác nhận trước khi gửi hồ sơ đồng nghĩa đội trưởng thu hồi lời mời đã chấp nhận; nếu hồ sơ đã gửi, roster snapshot không bị sửa âm thầm.
- Tournament migration v19 tạo bảng claim; Organization migration v26 lưu khoảng ngày/tên giải và trạng thái `CONFLICTED`. Migrations additive, không reset seed hoặc database. Organization reconciles các lời mời ACCEPTED cũ thành claim theo thứ tự thời gian; các xung đột dữ liệu cũ được ghi log và không bị xóa/ghi đè. Cần rà các log legacy conflict và yêu cầu đội cập nhật roster trước khi gửi/duyệt.
- Kiểm thử DB mới được bật riêng bằng `RUN_TOURNAMENT_DB_INTEGRATION=1` với database `sfl_tournament` kiểm thử và `RUN_ORG_DB_INTEGRATION=1` với `sfl_team` kiểm thử. Không đặt hai biến này khi môi trường kết nối tới dữ liệu người dùng.
### Rút xác nhận cầu thủ và điều lệ roster (20/11/2026)

- Cầu thủ không thể tự rút roster bằng cách đổi lời mời `ACCEPTED` thành `WITHDRAWN`. Cầu thủ gửi yêu cầu có lý do; yêu cầu được lưu trong `tournament_player_withdrawal_requests` và đội trưởng quyết định. Khi còn `PENDING`/`PROCESSING`, invitation và participation claim tiếp tục giữ nguyên.
- Tạo yêu cầu chỉ hợp lệ với hồ sơ `DRAFT`, `PENDING`, `REVISION_REQUIRED`, `NEEDS_SUPPLEMENT` hoặc `CONFLICT_ADJUSTMENT_REQUIRED`; `APPROVED`, roster khóa và giải đã vào giai đoạn không cho sửa bị chặn cả ở API lẫn giao diện. `DRAFT` không cần BTC phê duyệt.
- Khi yêu cầu đang chờ, invitation vẫn `ACCEPTED` và claim vẫn giữ. Không cho duyệt hồ sơ khi đang có yêu cầu rút `PENDING`/`PROCESSING`; tạo yêu cầu và xếp quyết định BTC cùng khóa hàng đăng ký để tránh race.
- Đội trưởng từ chối phải ghi lý do; hồ sơ và invitation được giữ nguyên. Khi chấp thuận ở `DRAFT`, invitation chuyển `WITHDRAWN`, cầu thủ bị bỏ khỏi bản nháp và điều kiện roster được tính lại.
  - Khi chấp thuận ở `PENDING`, thao tác transactionally chuyển invitation sang `WITHDRAWN`, giữ nguyên registration `PENDING`, `submitted_roster` và version đã gửi; tạo draft riêng `DRAFT_CHANGES` theo `base_version`, loại cầu thủ khỏi draft và ghi sự kiện `PLAYER_WITHDRAWAL_ACCEPTED` với actor/lý do/thời gian. Claim tham gia chỉ được giải phóng sau khi transaction thành công. Captain được đưa thẳng tới tab roster; điều kiện thiếu người/GK được hiển thị nhưng không tự chuyển `NEEDS_SUPPLEMENT`/`REVISION_REQUIRED`.
  - BTC bị chặn duyệt khi draft `DRAFT_CHANGES` đang mở. Khi captain gửi lại, Organization kiểm tra roster ACCEPTED, cầu thủ còn hoạt động, giới hạn min/max và GK lấy từ điều lệ giải, số áo; Tournament kiểm tra claim xác nhận và xung đột. Gửi thành công cập nhật cùng registration sang snapshot/version mới và giữ trạng thái `PENDING` nếu hồ sơ vốn đang `PENDING`; không tạo hồ sơ trùng. Draft được xóa sau khi version mới đã ghi thành công.
- `NEEDS_SUPPLEMENT`, `REVISION_REQUIRED` và `CONFLICT_ADJUSTMENT_REQUIRED` giữ trạng thái cần cập nhật sau khi gỡ cầu thủ. Claim chỉ được đồng bộ giải phóng sau khi transaction cập nhật roster và quyết định yêu cầu thành công; lời mời `INVALIDATED` không được tự khôi phục.
- Lịch sử yêu cầu lưu lý do, người quyết định, thời gian và ghi chú; lịch sử version lưu snapshot trước/sau. Thông báo kết quả gửi cầu thủ và thông báo tạo yêu cầu gửi đội trưởng.
- Migration Organization v28 thêm bảng request có lịch sử trạng thái/quyết định và action `PLAYER_WITHDRAWAL_ACCEPTED` trong phiên bản hồ sơ. Quyền rút được gọi qua `/tournament-invitations/:id/withdrawal-requests`; cầu thủ xem `/tournament-invitations/withdrawal-requests/my`; đội trưởng xem `/teams/:teamId/tournaments/:tournamentId/player-withdrawal-requests` và quyết định qua `/player-withdrawal-requests/:requestId/decision`.
- Điều lệ giải nay cho phép 5, 7 hoặc 11 người; ngoài `min_players`/`max_players_per_team` có `min_goalkeepers` (mặc định 1, điều chỉnh được). Roster yêu cầu đúng số cầu thủ đá chính theo thể thức, đúng một thủ môn ở đội hình xuất phát và tối thiểu số GK theo điều lệ trong toàn roster; GK dự bị được phép. Vị trí GK/DF/MF/FW được giữ trong invitation snapshot. Tournament migration v20 thêm cột `min_goalkeepers` và cập nhật ràng buộc football format; dữ liệu cũ nhận mặc định 1.
- Xác minh ngày 20/11/2026: typecheck và build service/frontend/gateway thành công; migration Organization/Tournament báo current; integration test `sfl_team` cho gửi yêu cầu, giữ ACCEPTED khi chờ, chấp thuận chuyển WITHDRAWN và từ chối giữ ACCEPTED đạt 3/3. Tournament unit test đạt 26 pass; DB integration còn skip nếu không bật biến phù hợp. Chưa có browser E2E cho BTC ngoại lệ roster sau khi duyệt/chốt.

### Form đăng ký roster đội trưởng

- Form hiển thị giải/CLB theo ngữ cảnh đã chọn, không cho đổi giải hoặc CLB ngay trong form. Roster chỉ đếm invitation `ACCEPTED` duy nhất theo cầu thủ; danh sách thành viên chung của CLB không được dùng làm roster giải.
- Form có các tab chọn cầu thủ, lời mời, roster đã xác nhận và yêu cầu rút. Tiến độ roster lấy từ invitation đang hiệu lực; cầu thủ đã rút/từ chối/vô hiệu hóa không được tính. Điều kiện nộp nêu rõ số người, thủ môn và đội hình xuất phát.
- Organization v29 thêm `tournament_registration_drafts` để lưu lựa chọn roster chưa gửi lời mời và ghi chú; API `GET/PUT/DELETE /teams/:teamId/tournaments/:tournamentId/registration-draft` chỉ cho captain sở hữu đội. Lưu nháp không gửi thông báo cầu thủ. Bản nháp của hồ sơ PENDING được giữ mở trong lúc lời mời mới chờ xác nhận và chỉ bị xóa khi gửi lại hoặc đội trưởng hủy chỉnh sửa.
- Hồ sơ đã gửi ở trạng thái xét duyệt chỉ hiển thị phần theo dõi. Chỉ trạng thái cần bổ sung/điều chỉnh mới mở lại phần roster và gửi lại.

### Chỉnh sửa hồ sơ trước quyết định BTC (20/11/2026)

- `PENDING`: đội trưởng chỉ mở chỉnh sửa khi kỳ đăng ký còn mở. Bản đang nộp được giữ trong `submitted_roster`; roster chỉnh sửa nằm trong `tournament_registration_drafts` với `registration_id`, `base_version` và cờ `editing_submitted`. Gửi lại mới thay roster chính thức, tăng `version`, ghi snapshot `RESUBMITTED` và xóa bản nháp.
- Khi bản PENDING đang được sửa hoặc BTC đã xếp một quyết định vào outbox, thao tác phía bên kia nhận xung đột HTTP 409. Các thao tác đều khóa hàng hồ sơ để ngăn BTC duyệt snapshot cũ hoặc đội trưởng bắt đầu sửa khi quyết định đã được xếp hàng.
- `REJECTED`: BTC có thể chủ động bật `resubmission_allowed`; đội trưởng chỉ sửa/nộp lại nếu cờ này bật và kỳ đăng ký còn mở. Mặc định từ chối cuối cùng, không có quyền sửa.
- `NEEDS_SUPPLEMENT`, `REVISION_REQUIRED`, `CONFLICT_ADJUSTMENT_REQUIRED`: tiếp tục dùng quy trình bổ sung/điều chỉnh hiện có; lần gửi lại tạo version mới.
- Migration Organization v30 bổ sung metadata bản nháp và cờ nộp lại, không xóa hoặc sửa migration cũ.
- Chưa triển khai luồng đề xuất sửa roster sau `APPROVED` hoặc luồng thêm cầu thủ sau khóa roster; chưa có cổng Match xác minh vòng cuối group stage/lineup đã thi đấu. Không được hiểu là các luồng ngoại lệ này đã sẵn sàng.
# Hồ sơ đã duyệt: đề xuất thay đổi roster

Organization Service lưu yêu cầu thay đổi tách khỏi roster chính thức trong `team_registration_change_requests`, cùng ảnh chụp roster trước/sau, phiên bản gốc, lý do và các sự kiện xử lý. Đội trưởng gửi `POST /registrations/:id/change-requests`; BTC xem `GET /tournaments/:tournamentId/registration-change-requests` và quyết định tại `POST /registration-change-requests/:id/decision`. Có thể xem lịch sử riêng bằng `GET /registrations/:id/change-requests`.

- Trước khi khóa roster, hồ sơ `APPROVED` có thể đề xuất một roster mới. Người gửi chỉ chọn cầu thủ có lời mời `ACCEPTED`; số lượng và thủ môn được đối chiếu với điều lệ Tournament Service.
- Khi giải ở `ROSTER_LOCKED`, `PREPARING` hoặc `IN_PROGRESS`, chỉ cho phép đề xuất thêm đúng một cầu thủ. BTC chỉ chấp thuận trước khi vòng bảng cuối bắt đầu; Match Service từ chối giải chưa có lịch vòng bảng, giải chỉ loại trực tiếp, vòng cuối đã bắt đầu, hoặc cầu thủ đã xuất hiện trong đội hình/diễn biến trận.
- Lời mời mới sau khi roster đã duyệt/khóa vẫn yêu cầu chính cầu thủ xác nhận. Việc xác nhận chỉ giữ quyền tham gia; roster chính thức chỉ đổi sau quyết định chấp thuận của BTC.
- Quyết định BTC dùng phiên bản gốc để chống duyệt yêu cầu cũ. Quyết định và cập nhật roster được lưu trước khi đồng bộ giải phóng quyền của cầu thủ bị loại; thao tác đồng bộ có thể retry idempotent.
- Không cho phép sửa trực tiếp roster đã duyệt/khóa. Yêu cầu đang chờ khóa yêu cầu mới trên cùng hồ sơ.

Các migration trước đó bổ sung dữ liệu roster/đăng ký; migration Organization v34 thêm metadata lý do và mức hoàn thiện cho hồ sơ trong hàng chờ. Đã xác nhận one-shot `organization-migrate` báo migration hiện hành trong lần triển khai 20/11/2026; không reset database hoặc volume.

### Xét duyệt, danh sách chờ và chốt roster (20/11/2026)

- Danh sách chính thức có thể chốt khi đăng ký đã đóng, số đội `APPROVED` nằm trong giới hạn min/max, roster và giới hạn trường hợp lệ, và cấu hình thi đấu khả thi. Hồ sơ `PENDING`, cần bổ sung hoặc trong danh sách chờ của các đội chưa được duyệt không tự chặn bước chốt.
- Với thể thức vòng tròn/loại trực tiếp, số đội không cần bằng mức tối đa. Với thể thức bảng + loại trực tiếp, backend kiểm tra số đội hiện có có thể xếp vào số bảng/sức chứa theo điều lệ hay không; lỗi trả nguyên nhân `HYBRID_GROUP_COUNT_INFEASIBLE`.
- Khi phê duyệt đội cuối cùng làm đầy chỉ tiêu giải, hồ sơ `PENDING` chuyển `WAITLIST`; hồ sơ `NEEDS_SUPPLEMENT`/`REVISION_REQUIRED` giữ trạng thái cần hoàn thiện, đồng thời có `waitlist_reason` để thể hiện đã vào hàng chờ nhưng chưa đủ điều kiện xét. Cột metadata được thêm bằng Organization migration v34. Khi hoàn thiện đúng hạn, hồ sơ được xét lại theo số suất và giới hạn trường; hệ thống không tự duyệt.
- Hồ sơ bổ sung/gửi lại bị backend từ chối sau khi kỳ đăng ký đóng, kể cả hồ sơ đã nộp bản đầu đúng hạn. BTC vẫn được xét duyệt `PENDING` đã nộp hợp lệ trước hạn. Hồ sơ còn thiếu nội dung khi hạn bổ sung hết hoặc kỳ đăng ký đóng sẽ được tác vụ định kỳ chuyển `REJECTED` với ghi chú rõ là hết hạn/đóng trước khi hoàn thiện, đồng thời giải phóng reservation/claim.
- Chốt roster chỉ ghi các đội đã `APPROVED` vào snapshot. Trong transaction Tournament, hồ sơ chưa được duyệt chuyển reservation sang kết thúc, các reservation roster bị xóa và claim cầu thủ được giải phóng. Organization job định kỳ hoàn tất trạng thái/history/notification của hồ sơ còn lại bằng lý do riêng cho chờ duyệt, chờ suất, cần bổ sung hoặc xung đột; thao tác idempotent để có thể retry sau lỗi liên service.
- Sau khi khóa roster thành công, Tournament Service gọi endpoint nội bộ `POST /internal/tournaments/:tournamentId/finalize-unselected-registrations` để Organization kết thúc ngay các hồ sơ chưa được chọn, hủy lời mời đang chờ và đánh dấu lời mời đã nhận là `WITHDRAWN` (không xóa lịch sử). Nếu Organization tạm thời không sẵn sàng, worker định kỳ vẫn retry. Việc đối soát lời mời `ACCEPTED` chỉ lấy hồ sơ còn hiệu lực; Tournament cũng từ chối tái lập participation claim cho đội không có reservation `APPROVED` sau khi giải khóa roster. Nhờ vậy việc đồng bộ cũ không thể chiếm lại suất cầu thủ đã giải phóng.
- Tác vụ khóa không tự chuyển đội trong waitlist thành đội chính thức. BTC phải xét duyệt tường minh khi phát sinh suất trước khi khóa. Với hồ sơ chưa duyệt kết thúc lúc khóa, trạng thái lịch sử được lưu là `REJECTED` nhưng ghi rõ kết thúc do chốt danh sách, không đồng nghĩa hồ sơ vi phạm điều lệ.
- Giao diện xác nhận chốt hiển thị min/max, số đội chính thức, hồ sơ pending, cần bổ sung, waitlist (tách hoàn thiện/chưa hoàn thiện) và bổ sung quá hạn. Các yêu cầu đang mở chỉ ngăn chốt nếu gắn với đội đã chính thức.

### Đóng kỳ đăng ký, hồ sơ bổ sung và hàng chờ (20/11/2026)

- Khi kỳ đăng ký đóng hoặc hết hạn, Organization worker quét mỗi 5 giây và kết thúc hồ sơ `NEEDS_SUPPLEMENT`/`REVISION_REQUIRED` chưa nộp bổ sung thành `REJECTED` qua registration decision outbox. Lý do, version, thông báo và giải phóng claim/reservation được đồng bộ qua Tournament Service; roster và lịch sử không bị xóa.
- Frontend và API đều chặn yêu cầu bổ sung mới sau khi đóng. Hồ sơ `PENDING` đã nộp đầy đủ trước hạn vẫn có thể được duyệt/từ chối nếu còn suất. Khi giải đạt giới hạn, hồ sơ đầy đủ chuyển `WAITLIST`; hồ sơ chưa hoàn thiện giữ trạng thái bổ sung và nhận `waitlist_reason` để hiển thị “Chờ suất · cần bổ sung”. Resubmit hợp lệ lúc giải mở vẫn nằm chờ nếu hết suất.
- Chốt chỉ cần kỳ đăng ký đóng, số đội `APPROVED` trong min/max, roster và cấu hình thi đấu hợp lệ. Hồ sơ chưa chọn không chặn chốt; sau xác nhận, chúng kết thúc với lý do theo trạng thái.
- Modal đóng đăng ký nêu rõ hệ thống ngừng hồ sơ mới, khóa bổ sung, từ chối hồ sơ bổ sung chưa hoàn tất và tiếp tục cho BTC xét hồ sơ đầy đủ.
