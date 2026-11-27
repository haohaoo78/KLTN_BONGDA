# Prompt 4 — Đội hình theo trận và chuẩn bị trước trận (F02)

Thực hiện: **26–27/11/2026, UTC+7**. Căn cứ: [baseline](./MATCH_OPERATION_BASELINE.md), [ma trận quy tắc](./MATCH_RULES_MATRIX.md), [Prompt 1](./MATCH_OPERATION_PROMPT_01_REPORT.md) và [Prompt 3](./MATCH_OPERATION_PROMPT_03_REPORT.md).

## 1. Kết quả và phạm vi

Đã triển khai đường nghiệp vụ đội trưởng chuẩn bị/gửi đội hình, trọng tài kiểm tra, ghi nhận vấn đề trước trận và gate F02 tại backend. Lưu danh sách có transaction, revision, lịch sử và nguồn roster/quy tắc hiện hành. Đã chạy thành công **32 ca API/PostgreSQL QA**, bao gồm xác nhận sẵn sàng và START hợp lệ trên bản sao dữ liệu riêng.

Giữ giao diện trọng tài hiện tại, sáu route và ba giai đoạn; bổ sung đội hình trong lịch thi đấu hiện có của đội trưởng. Không viết lại đăng ký đội, duyệt đội hoặc chốt roster. Không triển khai Prompt 5, không nghiệm thu toàn bộ trận đấu đến kết quả/BXH.

**Bản Docker chính thức:** [http://localhost:5173](http://localhost:5173). Không dùng môi trường khôi phục 15173 thay bản chính thức.

## 2. Nguồn và vòng đời dữ liệu

### Roster khác danh sách trận

- Organization cung cấp API chỉ đọc của đúng đội/giải: hồ sơ đội APPROVED, danh sách đã nộp, roster hiện hành và xác nhận tham gia của cầu thủ. Người ngoài roster, đã rút/chưa xác nhận, rời CLB hoặc bị từ chối không được chọn hợp lệ. Không dùng toàn bộ thành viên CLB làm roster thay thế.
- Dữ liệu thực tế có 664 dòng roster vẫn mang đánh giá cá nhân PENDING/is_verified=false, dù BTC đã duyệt hồ sơ đội như một khối. Không ép thay những cờ này, không sửa luồng xét duyệt đã hoàn thành. Hồ sơ đội, danh sách đã nộp, roster hiện hành và xác nhận cầu thủ là nguồn đúng của quy trình hiện tại; người có đánh giá REJECTED vẫn bị loại.
- Match gọi API Organization, không đọc database khác service. Kiểm tra án treo giò của chính ngày trận; lỗi nguồn trả lỗi thật, không fallback danh sách CLB/mock.
- Danh sách trận gồm các phần tử xuất phát/dự bị, số áo và vị trí. Lưu giữ ID dòng lineup của cầu thủ đang có; không tái tạo roster hoặc đổi ID trận/đội/cầu thủ.

### Lưu, gửi, kiểm tra và khóa

1. Đội trưởng hiện tại của đúng đội lưu DRAFT hoặc gửi SUBMITTED. Bản nháp có thể chưa đủ người/quy tắc, nhưng không cho lưu người không hợp lệ, trùng người/số áo hoặc vượt giới hạn đã biết.
2. Gửi kiểm tra đầy đủ giới hạn xuất phát/tối thiểu/dự bị/thủ môn/số áo và phiên bản quy tắc. Không lấy giới hạn cầu thủ đăng ký cả giải làm giới hạn một trận.
3. Trọng tài có FINALIZE kiểm tra từng đội; đây là quyết định riêng với việc đội trưởng gửi. READ chỉ xem; RECORD_EVENT có thể ghi nhận vấn đề thực tế trong phạm vi trận.
4. Khi trận SCHEDULED và còn trong hạn thực sự quy định, được sửa cả bản đã gửi/đã kiểm tra. Lần lưu sửa bỏ xác nhận cũ; cần gửi và kiểm tra lại. **Không tự khóa chỉ vì vừa gửi đội hình.**
5. Xác nhận sẵn sàng chuyển trận sang LINEUP_CONFIRMED và khóa chỉnh thông thường. Yêu cầu điều chỉnh có thẩm quyền hoặc BTC mở lại chuẩn bị phải có lý do/audit. Không cho sửa/xóa đội hình đang thi đấu bằng API trước trận.

Các hạn nộp/sửa chỉ dùng giá trị được công bố/áp dụng cho trận. Không tự đặt 30/60 phút. Nếu mô tả thẩm quyền sửa sát giờ chưa đủ để ánh xạ quyền API, hệ thống không tự cho vượt hạn; có thể ghi nhận vấn đề để BTC xử lý.

### F02 và tính nhất quán

- PUT trạng thái sẵn sàng kiểm tra lại hai đội, từng đội hình hợp lệ đã gửi và được kiểm tra, roster/quy tắc hiện hành, vấn đề mở, phân công/capability và trạng thái. Generic PUT cập nhật trận cũng không vượt được gate.
- Thao tác lưu/review/sẵn sàng cùng khóa dòng Match. Các API lineup cũ đi vào đúng đường ghi bulk mới, bắt buộc expectedRevision; bỏ các helper ghi cạnh tranh cũ.
- START kiểm tra mới lại đội hình/treo giò dưới Match lock và Scheduling lease của Prompt 3. QA chứng minh án treo giò mới sau READY làm START bị chặn; bỏ án bằng nghiệp vụ hợp lệ rồi START chạy thành công trên QA.
- Không coi các database độc lập là một transaction. Đọc roster qua API mới tại các điểm quyết định; chưa kiểm thử fault/race giữa thay roster ở Organization và commit ở Match.

### Ngoại lệ có thẩm quyền

Trọng tài ghi nhận đội chưa có mặt, thiếu người/người không hợp lệ, sân không bảo đảm hoặc vấn đề khác. Vấn đề mở chặn sẵn sàng; BTC đúng giải có thể ghi nhận kết luận hoặc mở lại chuẩn bị có lý do trước khi trận bắt đầu. Không tự xử thua, không tự đặt thời gian chờ và không tự xác nhận lại trận sẵn sàng sau khi giải quyết.

## 3. API và database

Các đường dẫn dưới đây có tiền tố `/api` khi đi qua web/Gateway. Không thêm service hoặc endpoint test vào runtime.

| API | Quyền / mục đích |
|---|---|
| GET `/internal/tournaments/:tournamentId/teams/:teamId/match-roster` | Nội bộ Organization, nguồn roster hiện hành, chỉ đọc |
| GET `/matches/:matchId/squads/:teamId` | Đội trưởng đúng đội; BTC đúng giải hoặc trọng tài có READ. Trả roster, quy tắc, đội hình, đối thủ, lịch và lịch sử |
| PUT `/matches/:matchId/squads/:teamId` | Đội trưởng hiện tại; lưu cả danh sách/gửi, expectedRevision bắt buộc |
| POST `/lineups` | Giữ path, thêm người qua cùng service/revision; không còn đường ghi bỏ validation |
| PUT `/matches/:matchId/lineups/:teamId/confirm` | Giữ path, gửi bản hiện hành qua cùng service/revision; không phải trọng tài xác nhận thực tế |
| DELETE `/matches/:matchId/lineups/:teamId` | Giữ path, xóa lựa chọn trước trận qua cùng service/revision; không xóa đang thi đấu |
| GET `/matches/:matchId/preparation` | BTC đúng giải / trọng tài READ, hai đội và vấn đề trước trận |
| POST `/matches/:matchId/squads/:teamId/review` | FINALIZE được phân công; APPROVE hoặc REQUEST_CHANGES có revision/lý do |
| POST `/matches/:matchId/preparation/issues` | RECORD_EVENT được phân công, ghi nhận và chuyển vấn đề cho BTC |
| POST `/matches/:matchId/preparation/organizer` | BTC đúng giải; RESOLVE_ISSUE hoặc REOPEN có lý do |
| PUT `/matches/:id/referee-status` | Giữ path, chỉ xác nhận LINEUP_CONFIRMED khi backend kiểm tra đủ |
| GET `/matches/:matchId/referee-context` | Giữ path, thêm projection preparation; không đổi quyền/capability |

**Tương thích client:** bulk và legacy mutation đều yêu cầu revision. POST lineup cũ trả `{saved:true}` sau khi lưu, không giả trả một Lineup mới khi nghiệp vụ đã chuyển sang cả danh sách. Frontend chính thức dùng bulk API; không còn caller ghi bằng flow cũ trong giao diện này.

Migration Match **23** bổ sung:

- `match_squads`: trạng thái, revision, nguồn roster/quy tắc, người/thời điểm gửi và kiểm tra.
- `match_squad_history`: lịch sử append-only, actor/lý do và snapshot trước/sau thao tác cần thiết.
- `match_preparation_issues`: vấn đề, người ghi nhận và kết luận BTC.
- Constraint nền `lineups_jersey_check` cho phép số nguyên dương hoặc null; chính quy tắc áp dụng mới quyết định giới hạn cụ thể như 1–99. Không sửa dữ liệu áo hiện có.

Migration có transaction, advisory lock và version guard, không backfill đội hình/trạng thái trận. Không sửa migration đã áp dụng. Không thêm bảng Scheduling vào Match DB.

## 4. Giao diện đã tích hợp

| Màn hình | Hoàn thiện |
|---|---|
| Đội trưởng → Lịch thi đấu | Trận của đội có nút Chuẩn bị đội hình. Modal dùng thông tin hai đội/logo, giải, vòng, ngày/sân, quy tắc, roster tìm kiếm/điều kiện, xuất phát/dự bị, số áo/vị trí, lưu/gửi và lịch sử |
| Trọng tài → Chi tiết trận | Hiển thị hai đội hình, số lượng, gửi khác kiểm tra, lỗi cụ thể; không đưa toàn bộ công cụ điều hành vào chi tiết |
| Trọng tài → Tác nghiệp → Trước trận | Hai đội song song khi đủ chiều rộng; xác nhận kiểm tra/yêu cầu điều chỉnh theo quyền; modal ghi nhận vấn đề; gate sẵn sàng/START theo server |
| BTC → Quản lý trận | Khung kiểm tra chuẩn bị theo trận và xử lý vấn đề/mở lại có lý do; không tạo workflow xử thua tự động |
| Đồng bộ form | SSE và đọc định kỳ giữ lựa chọn chưa lưu; chỉ báo thay đổi nguồn khi dữ liệu thực sự khác. Phản hồi cũ/chậm không ghi đè lần chỉnh mới; tải lại thủ công phải xác nhận nếu có phần chưa lưu |

Không đổi sidebar trọng tài, cấu trúc sáu route, layout cam–đen, công cụ live/sau trận hoặc phân hệ phân công của BTC. Không tạo route/frontend song song.

## 5. Kiểm thử thực tế

### API / PostgreSQL QA — 32 PASS

Chạy [harness nghiệp vụ](../scripts/qa-match-squads.cjs) với Gateway/Auth thật và các router/service/repository đã build. Năm database QA mới được phục hồi từ dump; Auth chỉ dùng tài khoản/session hợp lệ. Không gửi email, không sửa thời gian hệ điều hành hoặc ngày trận chính thức. Ca giờ đấu điều khiển Date trong tiến trình kiểm thử riêng; validation runtime giữ nguyên.

[Kết quả cuối QA 003](../output/match-operation-prompt-04/qa-api-003.json) ghi tên từng ca. QA 001 dừng vì lỗi harness đọc danh tính/thiếu session; không gán PASS. QA 002 hoàn tất trên bản trước, QA 003 xác minh backend cuối. Giữ các database/bằng chứng này, không reset để chạy lại.

| Nghiệp vụ | Kết quả / giới hạn |
|---|---|
| Đội trưởng đọc/gửi đúng đội; người khác, sai đội/giải | **PASS API QA** |
| Thành viên CLB ngoài roster chính thức | **PASS API QA**, dùng thành viên thật của CLB giải vòng tròn |
| Cầu thủ đã rút | **PASS API QA**, nguồn có trạng thái WITHDRAWN trả không hợp lệ; không làm lại quy trình rút |
| Cầu thủ treo giò theo ngày trận | **PASS API QA**, tạo/gỡ án qua API trên QA |
| Trùng người/số áo, thiếu tối thiểu/thủ môn | **PASS API QA**, lỗi theo cầu thủ/trường; thất bại không ghi danh sách |
| Profile 5/7/11 và số áo tùy quy tắc | **PASS unit**; API submit đầy đủ profile 5 và 7 **NOT TESTED** |
| Thiếu quy tắc / hạn điều lệ được cấu hình | **PASS API QA**, không tự sinh giá trị để vượt kiểm thử |
| Nháp, gửi, reload | **PASS API QA**, nháp không trở thành SUBMITTED hoặc hiện ở endpoint lineup công khai |
| Hai client / bulk / legacy cùng revision | **PASS API QA**, chỉ một client được ghi, client cũ bị 409 |
| Sửa trước READY | **PASS API QA**, bỏ xác nhận/gửi cũ, được gửi lại theo điều kiện |
| Một đội / hai đội chưa qua trọng tài | **PASS API QA**, không xác nhận sẵn sàng |
| Trọng tài ngoài tổ | **PASS API QA**, không được review |
| Trọng tài kiểm tra, yêu cầu điều chỉnh, gửi/kiểm tra lại | **PASS API QA**, captain đọc lại thấy đúng; READY bị thu hồi bởi thao tác có thẩm quyền |
| Sau READY / sau START không chỉnh thông thường | **PASS API QA**, không xóa danh sách đã lưu |
| Vấn đề sân / kết luận BTC | **PASS API QA**, có audit, không phát sinh xử thua |
| Trận cũ READY nhưng không đội hình | **PASS API QA**, phát hiện không nhất quán; mở lại có lý do chỉ trên QA |
| START sau thay đổi điều kiện / START hợp lệ | **PASS API QA**, kiểm tra mới và ghi IN_PROGRESS/clock đúng trên QA |
| Reload hai phía | **PASS API QA** qua đọc mới của captain/referee; thao tác ghi hai trình duyệt tương tác đồng thời **NOT TESTED** |
| Mất mạng, reconnect/backlog SSE và race roster qua service | **NOT TESTED**, không suy ra từ kiểm thử revision hoặc đọc lại |

### Typecheck / tests / build

| Hạng mục | Kết quả |
|---|---|
| Typecheck toàn workspace | **PASS** — [log](../output/match-operation-prompt-04/typecheck-final.txt) |
| Typecheck frontend sau sửa đồng bộ cuối | **PASS** — [log](../output/match-operation-prompt-04/web-typecheck-final.txt) |
| Match suite | **215 PASS / 34 SKIP / 0 FAIL** — [log](../output/match-operation-prompt-04/match-tests-configured-final.txt); có 12 test squad mới. Unit dùng URL DB không thể kết nối, các bài DB opt-in vẫn SKIP |
| Organization suite | **5 PASS / 14 SKIP / 0 FAIL** — [log](../output/match-operation-prompt-04/organization-tests.txt) |
| Frontend suite | **27 PASS / 0 FAIL** — [log](../output/match-operation-prompt-04/web-tests-release.txt); bốn ca mới bảo vệ chỉnh sửa chưa lưu/cảnh báo nguồn |
| Shared, Organization, Match, frontend production build | **PASS**, frontend còn cảnh báo bundle lớn từ trước; không gọi là lỗi build |
| Docker Compose config / build / migration / chạy | **PASS**, đúng ba thành phần có thay đổi; chi tiết bên dưới |

Lượt gọi Match test không cấu hình URL Scheduling/Discipline bị lỗi tải config, đã ghi riêng ở [log lần gọi thiếu môi trường](../output/match-operation-prompt-04/match-tests-final.txt). Chạy lại với cấu hình unit riêng đạt kết quả ở bảng; không sửa validation hoặc khai báo PASS cho lượt gọi lỗi.

### Trình duyệt cổng chính thức

Đã đăng nhập tài khoản thật theo vai trò, mở lịch đội trưởng → modal trận HITU–TDC, trang chi tiết trọng tài và giai đoạn Trước trận. [Bằng chứng DOM](../output/match-operation-prompt-04/browser-dom-proof.json).

- **PASS DOM:** đúng hai đội/logo, giải/vòng/ngày/sân; roster chính thức 20 người của HITU, xuất phát/dự bị, thông báo quy tắc thiếu; nút Gửi bị vô hiệu hóa khi thiếu quy tắc.
- **PASS tương tác chưa lưu:** chọn thủ môn, chuyển xuất phát → dự bị; sau gần hai phút/bốn lần đọc API vẫn giữ cầu thủ và không cảnh báo đổi nguồn giả. Đây là React state chưa lưu, không phải dữ liệu nghiệp vụ được tạo.
- **PASS hủy/tải lại và BTC:** hủy hộp thoại tải lại giữ nguyên cầu thủ; xác nhận tải lại đưa form về bản lưu rỗng phiên bản 0. BTC chọn trận cũ không nhất quán và thấy cảnh báo/nút mở lại có lý do; không bấm mở lại trên dữ liệu chính thức. [Bằng chứng thao tác](../output/match-operation-prompt-04/browser-workflow-proof.json).
- **PASS DOM trọng tài:** tách trạng thái đội trưởng gửi và kiểm tra thực tế; không có lineup thì nút sẵn sàng/START/review bị chặn; modal vấn đề có đúng hai đội, các loại vấn đề và nội dung.
- **PASS ở viewport kiểm tra:** 715×805, không tràn ngang tài liệu; bảng roster có cuộn riêng. **NOT TESTED:** mọi kích thước desktop/mobile và ảnh render đầy đủ. Công cụ screenshot không trả ảnh sử dụng được; không coi DOM là nghiệm thu pixel.
- **NOT TESTED UI ghi hoàn chỉnh trên chính thức:** không bấm lưu/gửi/xác nhận/START để tạo dữ liệu cho trận tương lai. Phần ghi đã được kiểm thử bằng API/PostgreSQL QA.

## 6. Bản chạy chính thức và dữ liệu được bảo toàn

- Docker build từ workspace hiện tại, cập nhật Organization, Match và web. Match migration 23 có trong database chính thức; Auth, Tournament, Notification, Gateway không có thay đổi Prompt 4 nên không build lại.
- Chín runtime container running; tám container có healthcheck đều healthy, web phục vụ cổng 5173. [Container/image](../output/match-operation-prompt-04/runtime-containers.json), [build context](../output/match-operation-prompt-04/runtime-build-contexts.json), [build](../output/match-operation-prompt-04/docker-build.txt), [migration](../output/match-operation-prompt-04/docker-migration.txt), [khởi chạy](../output/match-operation-prompt-04/docker-up.txt). Sửa đồng bộ cuối đã được [build web](../output/match-operation-prompt-04/docker-web-release-build.txt) và [cập nhật web](../output/match-operation-prompt-04/docker-web-release-up.txt) thêm một lần.
- [API/bundle runtime](../output/match-operation-prompt-04/runtime-api-proof.json): JS HTTP trùng SHA-256 local production build; vẫn đọc đúng 12/15/31 trận của vòng tròn/KO/kết hợp. Trận đang xem giữ SCHEDULED, clock NOT_STARTED phiên bản 0, hai đội hình trống.
- Trận legacy `e45a599b-1377-4377-9016-3956cc4e0738` vẫn LINEUP_CONFIRMED với hai đội hình trống. API mới báo inconsistent, không tự tạo lineup hoặc sửa trạng thái. Chức năng mở lại chỉ chạy trên QA trong kiểm thử.
- Ba bảng mới chính thức đều **0 dòng** tại thời điểm đối chiếu. Không tự gửi đội hình hoặc xác nhận sẵn sàng cho trận người dùng.
- QA xác nhận hash cả năm database nghiệp vụ chính thức không đổi. Sau khi khởi chạy Organization, cơ chế reconcile đã có từ trước cập nhật `updated_at` của 584 participation claims và 36 reservations. [So sánh đủ nội dung từng dòng](../output/match-operation-prompt-04/registration-row-preservation.json) với bản phục hồi cho thấy không thêm/mất bản ghi hoặc đổi trường nghiệp vụ. Không ghi PASS “hash toàn bộ Tournament không đổi” sau restart. Các bảng nghiệp vụ Match/Scheduling/Discipline/Team giữ nguyên hash; bảng ledger Match chỉ thêm migration 23. [Đối chiếu](../output/match-operation-prompt-04/official-database-proof.json).
- Khi mở Bước 7 để kiểm tra khung ngoại lệ, luồng điều hướng BTC hiện có lưu `tournament_workflow_state.current_step` từ 4 sang 7 và thời điểm cập nhật cho đúng giải đang xem. [Đối chiếu toàn dòng](../output/match-operation-prompt-04/workflow-row-comparison.json) xác nhận các trường khác không đổi; đây là vị trí màn hình đang xem, không phải tự hoàn tất bước hoặc thay trạng thái giải. Không phục hồi đè database để che khác biệt này.

**Điểm người dùng cần biết:** điều lệ của trận đang xem chưa có đủ quy tắc đội hình được công bố và áp dụng từ Prompt 2. Gửi/xác nhận vẫn bị chặn đúng điều kiện, không phải hệ thống tự chọn 11 người/giới hạn dự bị để cho qua. BTC cần sử dụng phần bổ sung điều lệ có phiên bản đã có để quyết định các quy tắc còn thiếu. Báo cáo này không tự công bố bản bổ sung cho giải hiện tại.

## 7. File thay đổi trong Prompt 4

| Nhóm | File |
|---|---|
| Kiểu dữ liệu | [matchSquad.ts](../packages/shared/src/matchSquad.ts), [shared index](../packages/shared/src/index.ts) |
| Nguồn roster Organization | [repository](../services/organization-service/src/repositories/matchRosterRepository.ts), [controller](../services/organization-service/src/controllers/matchRosterController.ts), [routes](../services/organization-service/src/routes/teamRoutes.ts) |
| Squad Match | [migration 23](../services/match-service/src/db/matchSquadMigration.ts), [migration runner](../services/match-service/src/db/migrate.ts), [repository](../services/match-service/src/repositories/matchSquadRepository.ts), [service](../services/match-service/src/services/matchSquadService.ts), [validation](../services/match-service/src/services/matchSquadValidation.ts), [controller](../services/match-service/src/controllers/matchSquadController.ts), [routes](../services/match-service/src/routes/matchRoutes.ts) |
| Lineup cũ / gate | [lineup repository](../services/match-service/src/repositories/lineupRepository.ts), [lineup service](../services/match-service/src/services/lineupService.ts), [lineup controller](../services/match-service/src/controllers/lineupController.ts), [match controller](../services/match-service/src/controllers/matchController.ts), [match service](../services/match-service/src/services/matchService.ts), [readiness](../services/match-service/src/services/matchOperationReadinessService.ts), [referee projection](../services/match-service/src/services/refereePortalService.ts), [suspension date check](../services/match-service/src/discipline/services/disciplineService.ts) |
| Client / API | [App](../apps/web-client/src/App.tsx), [API client](../apps/web-client/src/api/client.ts), [squad API](../apps/web-client/src/api/matchSquad.ts), [referee DTO](../apps/web-client/src/api/refereePortal.ts) |
| Đội trưởng | [lịch hiện có](../apps/web-client/src/components/LiveMatchCenterPanel.tsx), [editor](../apps/web-client/src/components/MatchSquadEditor.tsx), [CSS phạm vi squad](../apps/web-client/src/components/match-squad.css) |
| Trọng tài / BTC | [chi tiết và hai đội hình](../apps/web-client/src/components/referee/RefereeMatchDetailPage.tsx), [tác nghiệp](../apps/web-client/src/components/referee/RefereeOperationPage.tsx), [chuẩn bị trước trận](../apps/web-client/src/components/referee/RefereePreparationPanel.tsx), [BTC ngoại lệ](../apps/web-client/src/components/BtcPreparationPanel.tsx), [màn hình quản lý trận](../apps/web-client/src/components/MatchOperationsPanel.tsx) |
| Kiểm thử | [12 unit squad](../services/match-service/tests/matchSquad.test.cjs), [stub test projection](../services/match-service/tests/refereePortal.test.cjs), [frontend tests](../apps/web-client/scripts/refereePortal.test.cjs), [API QA](../scripts/qa-match-squads.cjs) |
| Tài liệu | [baseline](./MATCH_OPERATION_BASELINE.md), [ma trận](./MATCH_RULES_MATRIX.md), báo cáo này |

Những thay đổi từ Prompt 1–3 và công việc có trước vẫn được giữ. Các file clock repository, scheduling repository, phân công trọng tài, điều lệ và registration đã sửa từ trước không bị viết lại trong Prompt 4.

## 8. Sao lưu và checkpoint

- Trước sửa: HEAD `27fa2bd9fef76f23bc6cb16b939f124735c8cea0`, [checkpoint trước](../output/match-operation-prompt-04/checkpoint-before/manifest.json), bảo toàn 68 đường dẫn dirty/untracked có sẵn cùng diff/index patch.
- Trước migration: [năm dump custom](../backups/match-operation-prompt-04-20261126-001/) của Tournament, Match, Scheduling, Discipline và Team; đã phục hồi vào database QA riêng. Không ghi đè bản sao/backup trước.
- [Checkpoint sau](../output/match-operation-prompt-04/checkpoint-after/manifest.json) có bản sao source, SHA-256, diff và trạng thái; [kiểm tra bảo toàn](../output/match-operation-prompt-04/source-preservation.json). Đây là checkpoint file, **không phải Git commit gộp**. HEAD không đổi, không reset/stash/checkout.
- Khi cần quay lại code, lấy bản sao có kiểm chứng và đối chiếu phần thay đổi; giữ các bảng audit bổ sung. Không chạy down -v/drop/reset hoặc restore đè database chính thức. Phục hồi dump phải vào database mới và đối chiếu trước khi quyết định đổi kết nối.

Chạy lại riêng các thành phần đã đổi:

```powershell
docker compose --profile apps build organization-service match-service web-client
docker compose --profile apps run --rm --no-deps match-migrate
docker compose --profile apps up -d --no-deps organization-service match-service web-client
docker compose --profile apps ps
```

**Dừng tại Prompt 4/F02.** Các giới hạn được ghi NOT TESTED ở trên, thẩm quyền vượt hạn chưa có cấu hình đủ căn cứ và luồng trận hoàn chỉnh vẫn cần nghiệm thu theo phạm vi tương ứng.
