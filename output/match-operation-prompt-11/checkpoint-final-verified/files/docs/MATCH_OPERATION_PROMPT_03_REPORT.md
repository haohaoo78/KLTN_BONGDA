# Prompt 3 — F01, F10 và điều kiện mở tác nghiệp

Ngày thực hiện: 26/11/2026 (UTC+7). Căn cứ: [baseline](./MATCH_OPERATION_BASELINE.md), [Prompt 1](./MATCH_OPERATION_PROMPT_01_REPORT.md), [ma trận Prompt 2](./MATCH_RULES_MATRIX.md).

## 1. Kết quả trong phạm vi

| Hạng mục | Kết quả | Bằng chứng và giới hạn |
|---|---|---|
| F01 — START_MATCH đọc nhầm database | **PASS API/PostgreSQL QA** | START_MATCH đã chạy qua Gateway và service thật, lưu `IN_PROGRESS`/clock phiên bản 1. Match DB vẫn không có hai bảng `schedules` và `schedule_referee_assignments` |
| F10 — gate dùng `referee_id` cũ | **PASS API QA** | Bước 7 mở trong PREPARING khi có trận đủ điều kiện chuẩn bị. Chuyển giải sang IN_PROGRESS dùng tổ đã công bố theo phạm vi; Bước 6 vẫn chưa hoàn thành khi các trận khác chưa công bố |
| Chỉ lưu nháp / chưa phân công | **PASS API QA** | Có lịch công bố chưa đủ để tác nghiệp; nháp đủ người vẫn chưa là tổ chính thức |
| Một / nhiều người và quyền khác nhau | **PASS API + unit** | API kiểm tra tổ một người và tổ hai người: hỗ trợ có MANAGE_REPORT/RECORD_EVENT nhưng không FINALIZE. Unit kiểm tra cấu hình 1/2/3/4 người; không tạo giới hạn 4 người |
| Ngoài tổ / người đã bị thay | **PASS API QA** | Context và clock bị 403; lịch cá nhân theo người đang được phân công, không dùng `referee_id` còn lưu từ trước để cấp lại quyền |
| BTC đồng thời REFEREE | **PASS unit** | BTC không được vượt kiểm tra phân công/capability; cùng người đã được giao đúng nhiệm vụ vẫn được thực hiện. **NOT TESTED API** bằng một tài khoản thật đồng thời có cả hai role; không sửa role tài khoản chính thức để tạo ca test |
| Điều kiện đội hình và giờ đấu | **PASS API QA trong phạm vi** | Đội hình trống không xác nhận sẵn sàng được. QA dùng 22 cầu thủ thật, thủ môn thật và API xác nhận; START trước giờ 1 phút bị 409, sau giờ chạy được. Chưa nghiệm thu toàn bộ F02 |
| Đồng thời clock / thay trọng tài | **PASS HTTP + PostgreSQL QA** | Giữ Match transaction tại điểm trước commit; yêu cầu HTTP thay người chờ khóa Scheduling (quan sát `pg_stat_activity`). Sau commit, thay thế bị 409 vì trận đã bắt đầu; phân công không bị thay |
| Lưu/đọc lại và optimistic version | **PASS API QA** | Clock đọc lại đúng hiệp/phiên bản; expectedVersion cũ bị 409 |
| Database chính thức | **PASS đối chiếu trước/sau QA** | Hash các bảng trong bốn database Tournament/Match/Scheduling/Discipline bằng nhau; không bắt đầu trận chính thức |
| Typecheck toàn workspace | **PASS** | [Log](../output/match-operation-prompt-03/typecheck-all.txt) |
| Match tests | **203 PASS / 34 SKIP / 0 FAIL** | 18 test readiness/quyền mới; [log](../output/match-operation-prompt-03/match-tests.txt). Các bài DB opt-in còn SKIP |
| Tournament tests | **44 PASS / 20 SKIP / 0 FAIL** | [Log](../output/match-operation-prompt-03/tournament-tests.txt) |
| Frontend trọng tài | **23 PASS / 0 FAIL** | Thêm kiểm tra phân biệt chuẩn bị/bắt đầu và ẩn clock khi tổ không còn hợp lệ/giải tạm dừng; [log](../output/match-operation-prompt-03/web-tests.txt) |
| Build/Docker/runtime chính thức | **PASS** | Auth, Match, Tournament và web đã build/cập nhật tại cổng 5173; 9 container runtime đang chạy, 8 healthcheck healthy. Bundle HTTP khớp SHA-256 bản build cuối; không migration trong Prompt 3 |
| Giao diện/gate trên trình duyệt chính thức | **PASS DOM trong phạm vi** | Bước 6 hiển thị 2/31 đã công bố, chưa hoàn thành; Bước 7 mở với 2 trận chuẩn bị; Bước 8 khóa. Trọng tài xem được chuẩn bị, nút xác nhận/bắt đầu vô hiệu hóa khi thiếu đội hình/chưa tới giờ. Không nghiệm thu toàn bộ giao diện tác nghiệp hoặc so sánh ảnh |

Tổng kiểm thử API/database: **20 ca PASS**, gồm [16 ca đầy đủ](../output/match-operation-prompt-03/qa-api-003.json), [2 ca đồng thời qua HTTP](../output/match-operation-prompt-03/qa-concurrent-003.json) và [2 ca đọc lại tiến độ](../output/match-operation-prompt-03/qa-readiness-003.json). Nhóm chuẩn bị không đếm lại trận đang thi đấu. Không coi các ca này là một trận hoàn chỉnh đến biên bản/BXH.

## 2. Cơ chế nhất quán và ownership

1. [Scheduling repository](../services/match-service/src/scheduling/repositories/matchOperationReadinessRepository.ts) đọc hàng lịch chính thức, publication mới nhất, tổ còn hoạt động và nháp bằng Scheduling pool. Publication phải chưa bị vô hiệu hóa, khớp chữ ký lịch, khớp người/vị trí, đủ vị trí bắt buộc và có đúng một final authority theo cấu hình công bố.
2. Khi tác nghiệp, Scheduling mở **transaction giữ khóa, không ghi dữ liệu nghiệp vụ**, giữ hàng lịch `FOR SHARE` (không dùng `SET TRANSACTION READ ONLY`). Những đường ghi lịch/công bố/thay người hiện có dùng `FOR UPDATE` trên cùng hàng cha. Thứ tự khóa: **Scheduling → Match**. Không giữ khóa cấu hình trọng tài trong đường đọc tác nghiệp.
3. [Clock repository](../services/match-service/src/repositories/matchClockRepository.ts) mở Match transaction riêng, khóa trận và clock, kiểm tra expectedVersion, fixture, trạng thái giải/trận, đội hình, giờ đấu, quy tắc và quyền hiện tại trước khi ghi. Match commit xong mới giải phóng khóa Scheduling.
4. Các đường sửa/xóa lịch và API thay tổ cũ kiểm tra lại trạng thái trận **sau khi lấy khóa**. Luồng công bố/thay thế mới đã có kiểm tra này; không dựa vào lần kiểm tra sớm ở controller. Trận đã sẵn sàng/đang thi đấu không bị đổi qua luồng chỉnh sửa thông thường.
5. Đây **không phải transaction PostgreSQL xuyên database hoặc two-phase commit**. Không ghi đồng thời vào hai database trong thao tác clock. Trường hợp mất kết nối/response không xác định phải đọc lại clock/revision, không tự lặp thao tác như thể chưa commit. **NOT TESTED** fault injection mất kết nối/hard kill/failover giữa hai database; không tuyên bố tính nguyên tử phân tán.

Không tạo bảng lịch giả trong Match, view/FDW thay thế hay bản sao toàn bộ phân công. Snapshot publication/quy tắc vẫn là lịch sử nghiệp vụ hợp lệ.

## 3. Readiness và quyền

- **Mở trang chuẩn bị:** fixture chính thức hiện hành, đủ hai đội, lịch công bố, tổ công bố còn hiệu lực và tài khoản hợp lệ. Không đòi toàn giải phân công đủ. PREPARING được chuẩn bị; PAUSED chỉ được xem, không điều khiển.
- **Xác nhận sẵn sàng:** final authority hiện tại; hai đội có đội hình đã xác nhận đáp ứng các kiểm tra cơ bản theo quy tắc. Không dùng trạng thái `LINEUP_CONFIRMED` làm bằng chứng thay cho đội hình thật.
- **Bắt đầu trận:** giải IN_PROGRESS, trận LINEUP_CONFIRMED, đúng final authority, đủ quy tắc, đội hình hợp lệ theo các kiểm tra đang áp dụng, đã tới giờ và phiên bản clock đúng. Không tự bắt đầu giải hoặc tự chỉnh giờ trận.
- **Bước 6 hoàn thành:** mọi trận trong sơ đồ hiện hành có tổ chính thức hợp lệ. Nháp COMPLETE vẫn là nháp. Publication bị vô hiệu hóa/khác lịch/khác tổ/tài khoản không hợp lệ cần kiểm tra lại.
- **Bước 7:** có thể mở theo phạm vi; tiến độ chuẩn bị/đang thi đấu/đã kết thúc trận được hiển thị riêng. Hoàn thành toàn bộ Bước 7 vẫn theo kết quả/biên bản như trước, không sửa F11.
- **Phân quyền:** BTC có quyền quản lý/đọc và xử lý ngoại lệ theo endpoint hiện có. Clock, xác nhận sẵn sàng, ghi/xóa sự kiện, tỷ số, gửi biên bản và ghi thẻ chuyên môn phải có phân công cùng capability của chính trận. Không cấp quyền chuyên môn chỉ vì tài khoản có BTC hoặc REFEREE.
- Quyền MANAGE_REPORT/FINALIZE được đọc lại trong phạm vi khóa khi gửi biên bản, tránh quyết định theo quyền đã kiểm tra trước lúc thay tổ. Các transaction xác nhận biên bản F07 vẫn chưa được viết lại.
- Lịch sử legacy vẫn giữ; `referee_id` đơn lẻ không cấp quyền tác nghiệp. Khi đã có publication/crew mới, không dùng cờ cũ để cho người bị thay xuất hiện trở lại trong lịch hiện tại.

## 4. File và API

| Phần | File chính |
|---|---|
| DTO dùng chung | [matchOperationReadiness.ts](../packages/shared/src/matchOperationReadiness.ts), [export](../packages/shared/src/index.ts) |
| Scheduling đọc/khóa | [repository mới](../services/match-service/src/scheduling/repositories/matchOperationReadinessRepository.ts), [repository hiện có](../services/match-service/src/scheduling/repositories/schedulingRepository.ts) |
| Chữ ký lịch | [tiện ích thuần](../services/match-service/src/scheduling/services/refereeScheduleSignature.ts), [service phân công](../services/match-service/src/scheduling/services/refereeAssignmentService.ts): tách đúng công thức cũ, không đổi thuật toán |
| Readiness/quyền | [service](../services/match-service/src/services/matchOperationReadinessService.ts), [authorization](../services/match-service/src/scheduling/authorization.ts), [controller](../services/match-service/src/controllers/matchOperationReadinessController.ts), [routes](../services/match-service/src/routes/matchRoutes.ts) |
| Tác nghiệp hiện có | [clock](../services/match-service/src/repositories/matchClockRepository.ts), [match controller](../services/match-service/src/controllers/matchController.ts), [lineup controller](../services/match-service/src/controllers/lineupController.ts), [card controller](../services/match-service/src/discipline/controllers/disciplineController.ts), [portal](../services/match-service/src/services/refereePortalService.ts) |
| Tournament gate | [tournamentService.ts](../services/tournament-service/src/services/tournamentService.ts) |
| Auth | [internalRoutes.ts](../services/auth-service/src/account/routes/internalRoutes.ts): chỉ thêm `accountStatus` vào API nội bộ đã có; không đổi RBAC/session |
| BTC frontend | [API readiness](../apps/web-client/src/api/matchOperationReadiness.ts), [BtcTournamentWorkspace](../apps/web-client/src/components/BtcTournamentWorkspace.tsx) |
| Trọng tài frontend | [API context](../apps/web-client/src/api/refereePortal.ts), [OperationPage](../apps/web-client/src/components/referee/RefereeOperationPage.tsx), [helper quyền/clock](../apps/web-client/src/components/referee/refereeOperation.ts), [thông báo lỗi](../apps/web-client/src/api/client.ts) |
| Kiểm thử | [readiness unit](../services/match-service/tests/matchOperationReadiness.test.cjs), [portal unit](../services/match-service/tests/refereePortal.test.cjs), [frontend tests](../apps/web-client/scripts/refereePortal.test.cjs), [QA harness](../scripts/qa-match-operation-readiness.cjs) |

API mới:

- GET `/internal/tournaments/:tournamentId/match-operation-readiness`: trusted service, Tournament dùng làm gate.
- GET `/tournaments/:tournamentId/fixtures/operation-readiness`: BTC đúng giải, qua prefix Gateway hiện có; không thêm proxy trùng.
- GET `/matches/:matchId/operation-readiness`: đọc theo quyền trận.
- GET `/matches/:matchId/referee-context`: bổ sung `readiness`; giữ các trường cũ.
- GET Auth `/internal/users/:id/organizational-access`: bổ sung `accountStatus`, giữ đường dẫn và các trường cũ.

**Không migration, không enum database mới, không service runtime mới.** Giữ source/layout Bước 1–5, SMTP, dev đăng ký, môi trường 15173; không thay thuật toán lập lịch/phân công.

## 5. QA, sao lưu và checkpoint

- Dump custom của bốn database tại [backup riêng](../backups/match-operation-prompt-03-20261126-001/); đã phục hồi thành database QA mới. Không ghi đè dump hoặc database cũ, không reset/drop/truncate/volume removal.
- Các bộ QA `sfl_prompt03_qa_{tournament,match,scheduling,discipline}_20261126_001/002/003` được giữ lại. Auth nội bộ QA chỉ đọc dữ liệu tài khoản thật bằng kết nối READ ONLY; Gateway đăng nhập qua Auth thật. Organization chỉ đọc dữ liệu đội/cầu thủ và xác minh theo API hiện có.
- Chỉ tiến trình QA dùng `node:test` Date để kiểm tra trước/sau giờ của lịch đã có. Không đổi giờ máy, điều lệ, lịch chính thức hoặc bỏ guard. Đồng hồ/lineup/phân công/bản quy tắc của ca kiểm thử được ghi trong DB QA qua API thật. Worker gửi thông báo/email QA không được khởi chạy.
- Lượt 001 dừng vì script chưa gửi trusted header khi đọc Organization. Lượt 002 đã START thành công nhưng script kẹt do wrapper thử nghiệm của `pg.Pool.connect` không giữ callback API. Đã dừng đúng tiến trình QA được xác minh, sửa script và chạy mới lượt 003 PASS; không dừng container chính thức để che lỗi.
- [Checkpoint trước](../output/match-operation-prompt-03/checkpoint-before/manifest.json): 51 đường dẫn đã có thay đổi từ các prompt trước; HEAD `27fa2bd9fef76f23bc6cb16b939f124735c8cea0`, SHA-256 manifest `faf3e369adc8817a5eae5f5e3d3ff100e77b4c48becf8a2e7976023bb974bd19`.
- [Checkpoint sau](../output/match-operation-prompt-03/checkpoint-after/manifest.json): bản sao source/diff/manifest, không reset/stash/checkout hoặc commit gộp thay đổi cũ.
- [Hash trước](../output/match-operation-prompt-03/database-before.json), [hash sau](../output/match-operation-prompt-03/database-after.json). Ca kiểm thử không làm thay đổi bốn database chính thức.
- [Đối chiếu source](../output/match-operation-prompt-03/source-preservation.json): 51 đường dẫn đã thay đổi từ trước vẫn tồn tại; 39 giữ nguyên byte, 12 thay đổi trong phạm vi Prompt 3. Giữ nguyên byte các thay đổi trước đó ở App, MatchOperationsPanel, TournamentDetailPanel và những phần điều lệ Prompt 2; không reset hoặc ghi đè chúng.

Script full yêu cầu bộ database QA vừa phục hồi với run ID mới; không chạy lại full trên bộ đã có trận đang thi đấu. Chế độ `--verify-concurrent-publication` dùng bộ QA đã START; không tác động trận chính thức.

### Bản chạy chính thức

- [BTC — giải kết hợp](http://localhost:5173/btc?manageTournament=9f765a91-b8ab-4716-a083-0cf8a113db1b); cần đăng nhập tài khoản BTC quản lý giải.
- [Trọng tài — trang chuẩn bị đã kiểm tra](http://localhost:5173/referee/matches/8b8a61e2-4b83-4c8c-962e-580b4a594106/operation); cần đúng tài khoản được phân công.
- [API runtime](../output/match-operation-prompt-03/runtime-api-proof.json): vòng tròn 12 trận và knockout 15 trận chưa công bố tổ nên Bước 7 chưa mở; kết hợp 31 trận có 2 tổ công bố, 1 nháp và 28 chưa phân công, mở Bước 7 nhưng Bước 6 chưa hoàn thành.
- [Container/image/context](../output/match-operation-prompt-03/runtime-containers.json): Compose `student-football-league`, context/Compose chính thức tại workspace hiện tại, web 5173. Không sử dụng môi trường 15173. Chỉ bốn thành phần thay đổi được build; lượt cuối cập nhật Match và web sau kiểm tra số liệu.
- [Đối chiếu database cuối](../output/match-operation-prompt-03/official-database-proof.json): toàn bộ bảng trong bốn database nghiệp vụ chính thức giữ nguyên số dòng và hash so với trước QA, sau khi build và đọc runtime. Clock trận tương lai vẫn NOT_STARTED, phiên bản 0; bản ghi LINEUP_CONFIRMED nhưng chưa có đội hình vẫn được giữ và không thể START.
- [Kiểm tra trình duyệt](../output/match-operation-prompt-03/browser-verification.json): DOM/accessibility của stepper BTC và trang chuẩn bị trọng tài tại cổng 5173, viewport 715px không tràn chiều ngang. Chỉ đọc gate/nhãn, không chuyển workflow, công bố hoặc bắt đầu trận chính thức. Đăng nhập Auth bình thường; không ghi cookie/mật khẩu vào bằng chứng.
- **NOT TESTED giao diện:** toàn bộ nội dung tab Bước 6/7, nhiều kích thước desktop/mobile và đối chiếu ảnh đầy đủ. Không coi kiểm tra DOM là nghiệm thu trực quan toàn bộ.

## 6. Phần chưa nghiệm thu

- F02: roster giải, vòng đời nộp/chỉnh đội hình, deadline, toàn bộ validation và tính nguyên tử khi đội hình thay đổi. Guard cơ bản trong Prompt 3 không giải quyết toàn bộ F02. Trận chính thức cũ LINEUP_CONFIRMED nhưng 0 lineups được giữ nguyên và bị chặn bắt đầu.
- F03/F04: toàn bộ state machine, hiệp, bù giờ/đồng hồ và tạm hoãn. Prompt 3 chỉ đưa guard giờ bắt đầu vào đường START thực tế và giữ quy tắc Prompt 2.
- F05–F09, F11–F15: sự kiện/thay người/biên bản/BXH/kết thúc giải/kỷ luật/realtime đầy đủ. Không chạy trận tương lai chính thức hoặc chèn tỷ số để lấy PASS.
- Mất kết nối/failover giữa database; thao tác thực tế bằng tài khoản BTC+REFEREE; nhiều trình duyệt đồng thời; trận hoàn chỉnh từ captain lineup đến kết quả/BXH: **NOT TESTED E2E**.
- Các quyết định điều lệ còn thiếu trong [ma trận Prompt 2](./MATCH_RULES_MATRIX.md#5-các-quyết-định-thực-sự-còn-cần-btc-xác-định) không được tự điền trong Prompt 3.

**Dừng sau F01/F10 và quyền liên quan. Không triển khai Prompt 4–5.**
