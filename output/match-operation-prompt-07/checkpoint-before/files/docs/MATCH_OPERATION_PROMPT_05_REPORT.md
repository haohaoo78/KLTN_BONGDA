# Prompt 5 — Clock, các hiệp và gián đoạn trận đấu

**Ngày:** 27/11/2026, UTC+7. **Phạm vi:** F03, nền thời gian F04 và phần clock của F14. Tiếp nối [baseline](./MATCH_OPERATION_BASELINE.md), [ma trận quy tắc](./MATCH_RULES_MATRIX.md) và [Prompt 4](./MATCH_OPERATION_PROMPT_04_REPORT.md).

**Đã triển khai trên Docker chính thức cổng 5173. Chưa nghiệm thu toàn bộ luồng thi đấu, sự kiện, luân lưu và xác nhận kết quả.** Không bắt đầu trận tương lai trong database chính thức.

## 1. Những phần được giữ nguyên

- Năm backend services, ownership database, Session cookie/Redis, SSE và PostgreSQL LISTEN/NOTIFY.
- Sáu route trọng tài, sidebar/header cam–đen, ba giai đoạn trong cùng trang tác nghiệp. Bước 1–6 của BTC, lịch, phân công, roster và điều lệ công bố không bị thay đổi để làm kiểm thử vượt qua.
- Lease/khóa Scheduling và kiểm tra phân công/capability của Prompt 3; kiểm tra đội hình hiện hành của Prompt 4. Không tạo bảng lịch hoặc tổ trọng tài trong Match DB.
- Không thay SMTP, nút đăng ký dev, checkpoint `788015c`, môi trường 15173 hoặc các bản backup cũ.

## 2. Thay đổi nghiệp vụ và dữ liệu

### F03 — bắt đầu và chuyển trạng thái

API clock giữ kiểm tra phân công đã công bố/còn hiệu lực và quyền `FINALIZE` của chính trận ở mỗi lần gọi. Dưới khóa Match, backend kiểm tra phiên bản, fixture/hai đội, trạng thái giải, kết quả đã khóa, lịch công bố, giờ thi đấu và đội hình đã gửi/được kiểm tra. Không có cơ chế tự bắt đầu khi đến giờ, không có cờ bỏ qua giờ.

`actualStartedAt` được lưu riêng với giờ trên lịch. Generic PUT và API trạng thái trọng tài không được dùng để bỏ qua clock workflow. Thao tác sai phiên bản trả 409; frontend tải trạng thái mới và yêu cầu người dùng kiểm tra, không tự gửi lại thao tác cũ.

Giữ state machine hiện có. Không bắt đầu hai lần, bỏ qua hiệp, resume luân lưu/trận đã kết thúc hoặc chuyển sang hiệp phụ/luân lưu trái điều lệ. Trận cần phân định thắng thua không được kết thúc khi chưa có căn cứ xác định đội thắng. Quy trình từng lượt luân lưu vẫn thuộc Prompt 7.

### Clock và từng hiệp

- Timestamp backend và số mili giây đã tích lũy là nguồn thời gian. Mỗi lần ghi clock đang chạy đều rebase đúng anchor, tránh cộng lặp hoặc mất phần giây lẻ.
- Lưu thời điểm bắt đầu pha, bắt đầu/kết thúc thực tế, tổng thời gian thi đấu và lịch sử thao tác. Nghỉ giữa hiệp không cộng vào thời gian thi đấu.
- `CONTINUOUS`: không cung cấp Pause cho bóng ra ngoài/phạm lỗi thông thường; sử dụng bù giờ đúng hiệp. `STOPPED`: có thao tác dừng tính giờ và resume.
- Tạm dừng thi đấu là thao tác riêng có lý do, khác dừng tính giờ thông thường. Không dùng Pause cho quyết định hoãn/hủy.
- Bù giờ thuộc hiệp hiện tại, không giảm mức tối thiểu đã công bố và không chuyển sang hiệp sau. Đồng hồ đạt thời lượng chỉ hiển thị thông tin; kết thúc hiệp vẫn cần thao tác trọng tài. Backend chặn kết thúc trước thời lượng và bù giờ tối thiểu.
- Luân lưu là pha riêng, không chạy như đồng hồ thi đấu. Chưa triển khai tình huống kéo dài hiệp để hoàn tất quả phạt đền hoặc chi tiết luân lưu của Prompt 7.

Đã đối chiếu lại [IFAB Luật 7, trang phiên bản hiện hành](https://www.theifab.com/laws/latest/the-duration-of-the-match/): khoảng nghỉ do điều lệ quy định; bù giờ được tính cho từng hiệp, mức tối thiểu đã thông báo không được giảm. Không biến khoảng nghỉ tối đa của luật thành một thời gian chờ tối thiểu mới. Profile VFF 7 người và FIFA Futsal tiếp tục dùng căn cứ/phiên bản đã ghi ở Prompt 2. Không tự coi sân 5 là futsal.

### F04 — thời gian sự kiện

Loại bỏ giới hạn phút 120 ở đường ghi backend/frontend và thay constraint bằng migration mới. Sự kiện mới lưu `phase`, `periodElapsedSeconds`, `minute`, `addedTimeSeconds`, `eventSequence`. Backend kiểm tra thời điểm thuộc pha clock thực tế và không vượt thời gian chính thức; form cũ của hiệp trước hoặc phiên bản clock cũ bị từ chối.

Ví dụ API QA: bàn thắng phút 48 trong hiệp một lưu `FIRST_HALF`, 2.880 giây, bù giờ 180 giây; hiển thị **45+3**, không bị chuyển sang hiệp hai. Unit test kiểm tra hiệp phụ phút **121**, không clamp về 120. Các sự kiện cùng thời điểm có sequence ổn định.

Danh sách trọng tài và màn hình theo dõi dùng chung cách sắp xếp/nhãn thời gian. Snapshot biên bản lưu thêm metadata; tỷ số hiệp một được xác định theo pha. Với bàn thắng lịch sử chưa có pha, dữ liệu hiệp một được giữ chưa xác định, không suy diễn từ tổng phút. Không nghiệm thu lại toàn bộ nghiệp vụ sự kiện hoặc biên bản trong prompt này.

### F14 — phần clock

Các đường thay trạng thái trận hiện có sang `POSTPONED`/`CANCELLED`, bao gồm repository duyệt yêu cầu hoãn, dừng clock trong cùng transaction Match, giữ pha/thời gian/sự kiện và ghi lịch sử. Không tự reset trận đã chơi một phần về lịch mới; cần quyết định đá tiếp có thẩm quyền.

Không xây thêm workflow đình chỉ/đá tiếp/quyết định hành chính. Metadata gián đoạn phân biệt dừng tính giờ, tạm dừng thi đấu và quyết định hoãn/hủy; không thêm một state machine trận thứ hai. Phần hành chính, bao gồm tác động của quyết định toàn giải, tiếp tục ở Prompt 10.

## 3. Migration và bảo vệ dữ liệu

Migration Match **24** trong [matchClockTimingMigration.ts](../services/match-service/src/db/matchClockTimingMigration.ts): thêm metadata clock, bảng `match_clock_action_history` append-only, metadata/sequence sự kiện và nới constraint phút. Transaction, advisory lock và migration ledger bảo đảm chạy lại an toàn. Không sửa migration đã áp dụng.

Clock đang hoạt động theo mô hình cũ mà thiếu căn cứ được trả `reviewRequired`, không tự gán hiệp hoặc reset thời gian. GET clock chỉ đọc, không tạo clock chạy cho một trận lịch sử.

- [Backup riêng của Prompt 5](../backups/match-operation-prompt-05-20261127-001/): Tournament, Match, Scheduling, Discipline, Team; bổ sung Auth/User cho QA tài khoản, không ghi đè dump trước.
- Các lần QA dùng database mới `sfl_prompt05_qa_*_20261127_001` đến `007`; những bản có ca kiểm thử đã chạy được giữ nguyên, không drop/reset/reseed đè.
- [Đối chiếu sau triển khai](../output/match-operation-prompt-05/official-runtime-proof.json) xác nhận đủ bản ghi và tất cả cột nghiệp vụ cũ của năm database không đổi. Chỉ migration ledger và các cột/bảng bổ sung được loại khỏi so sánh cột cũ.
- Bảng lịch sử clock chính thức có **0 dòng**, trận đang xem vẫn `SCHEDULED`, `NOT_STARTED`, version 0; không tạo đội hình hoặc bắt đầu trận chính thức.

Phục hồi khi có sự cố: giữ bản source trước và dừng thao tác ghi bị ảnh hưởng; ưu tiên sửa tiến. Phục hồi dump chỉ vào database mới để đối chiếu, không restore đè database chính thức. Không chạy migration xuống hoặc xóa audit. Nếu đã phát sinh clock mô hình mới, không chạy code cũ lên các trận đó mà chưa đánh giá tương thích.

## 4. Kết quả kiểm thử

### API/PostgreSQL QA

[Lần nghiệm thu 007](../output/match-operation-prompt-05/qa-api-007.json): **27 PASS, 0 FAIL**. [Bộ chạy QA](../scripts/qa-match-clock.cjs) dùng API nghiệp vụ, phiên đăng nhập Auth bình thường, source router thật và PostgreSQL phục hồi riêng. Đồng hồ thử nghiệm được điều khiển bằng IPC/Node test timer **chỉ trong tiến trình QA** để kiểm tra khoảng thời gian dài; không thêm test endpoint hoặc tùy chọn bỏ validation vào production. Notification không được chạy/gửi SMTP trong QA này; không có giả lập gửi thành công.

| Hạng mục | Kết quả | Bằng chứng / giới hạn |
|---|---|---|
| Migration 24, chạy lại, giữ hàng/cột cũ | PASS | API QA và đối chiếu chính thức |
| START đúng điều kiện; trước giờ; giải chưa bắt đầu | PASS | Đội hình thật đã gửi/kiểm tra trong QA; không nới gate |
| Tài khoản ngoài tổ, BTC không có phân công, người bị thay thế | PASS | Gọi API trực tiếp, bị chặn; thay thế trước khi khóa sẵn sàng |
| Bắt đầu trùng, bỏ qua hiệp, kết thúc sớm/sai trạng thái | PASS | 409, không tăng version khi thất bại |
| Hai hiệp, nghỉ giữa hiệp, bù giờ riêng từng hiệp | PASS | Không tự kết thúc; không cộng thời gian nghỉ |
| Dừng tính giờ khác tạm dừng thi đấu | PASS | IFAB và futsal được chọn rõ ràng trong bản QA |
| Pause/Resume futsal; không bù giờ thông thường | PASS | Giữ giây lẻ và thời gian dừng |
| Phase/phút sự kiện, form sai hiệp/clock version | PASS | API ghi 45+3; unit bổ sung phút 121 và thứ tự ổn định |
| Hai client gửi cùng expectedVersion | PASS | Một 200, một 409; không tự ghi đè |
| Reload/restart tiến trình Match | PASS | Đổi PID thực tế, đọc lại cùng DB, giữ mili giây và actual start |
| Hai kết nối SSE, reconnect/replay, rollback | PASS | Chỉ dữ liệu commit có trong log và đến client |
| POSTPONED/CANCELLED dừng clock | PASS | API BTC thật trong QA, không xóa đội hình/thời gian |
| Lịch sử append-only | PASS | UPDATE audit bị database từ chối |
| Bảo toàn năm database chính thức trong QA | PASS | Hash trước/sau bằng nhau |
| Luồng Admin tạo → BTC duyệt yêu cầu hoãn | NOT TESTED | Repository đã nối freeze; ca API P5 dùng đường BTC đổi trạng thái trận hiện có |
| API clock đầy đủ với giải 7 người | NOT TESTED | Policy VFF 7 người đã unit test; API đầy đủ P5 dùng IFAB 11 và futsal 5 được chọn riêng trong QA |
| Hiệp phụ/luân lưu đến xác nhận kết quả | NOT TESTED | Có unit guard/chuyển pha; luân lưu chi tiết thuộc Prompt 7 |
| Restart container khi đang thi đấu thật; mất mạng browser khi nhập sự kiện | NOT TESTED | Chỉ restart tiến trình QA và kiểm tra SSE riêng; không bắt đầu trận chính thức để thử |
| Race sửa lịch/phân công với clock trong bản P5 | NOT TESTED | Giữ lease Prompt 3; P5 đã chạy hai clock action đồng thời và kiểm tra quyền sau thay thế, chưa chạy lại toàn bộ fault/race liên service |

Các lần QA 001–006 có lỗi chuẩn bị bộ thử hoặc lỗi cleanup: chọn sai tổ, tài khoản chưa biết mật khẩu, thay người sau khóa, trùng lịch, thiếu xác nhận điều lệ lịch sử, đường đóng pool không tồn tại. Backend từ chối đúng nghiệp vụ; đã sửa bộ chạy theo API hợp lệ, không gỡ validation. Lần 006 hoàn tất 27 ca nhưng cleanup lỗi; lần 007 hoàn tất và đóng tiến trình thành công. Giữ log cũ để truy vết.

### Typecheck, unit và build

| Kiểm tra | Kết quả |
|---|---|
| Typecheck toàn workspace | PASS — [log](../output/match-operation-prompt-05/typecheck-workspace-002.log) |
| Match tests | PASS — **226**, **34 SKIP**, **0 FAIL** — [log](../output/match-operation-prompt-05/match-tests-004.log) |
| Frontend trọng tài | PASS — **29**, **0 FAIL** — [log](../output/match-operation-prompt-05/web-tests-005.log) |
| Production build toàn workspace | PASS — [log](../output/match-operation-prompt-05/build-workspace-002.log); còn cảnh báo bundle lớn |
| Compose config, build Match/frontend, migration và khởi chạy | PASS — [build](../output/match-operation-prompt-05/docker-build.log), [migration](../output/match-operation-prompt-05/docker-migration.log), [up](../output/match-operation-prompt-05/docker-up.log) |
| API/routing/image chính thức | PASS — [bằng chứng](../output/match-operation-prompt-05/official-runtime-proof.json), [hash code container](../output/match-operation-prompt-05/container-code-sha256.txt) |

[Tóm tắt bản chạy](../output/match-operation-prompt-05/release-summary.json): **9 container đang chạy**, **8 health check healthy**; frontend không khai báo health check. Ba module clock/shared trong container khớp SHA-256 bản build local; asset frontend HTTP cũng khớp. Build context là workspace chính thức hiện tại theo Compose, không phải worktree/cổng đối chiếu.

34 bài opt-in SKIP không được tính là đã chạy. Build đầu phát hiện đường import runtime CommonJS của shared chưa được Vite xử lý; đã chuyển các tiện ích frontend sang đường source TypeScript dùng chung như pattern hiện có, không đổi kiến trúc/package hoặc thêm bản sao thuật toán.

## 5. Kiểm tra giao diện thực tế

Truy cập [trang tác nghiệp chính thức](http://localhost:5173/referee/matches/8b8a61e2-4b83-4c8c-962e-580b4a594106/operation), tài khoản trọng tài đang có phân công. Kiểm tra bằng trình duyệt thật trên 5173:

- Trước trận hiển thị hai đội, tổ trọng tài, điều lệ và dữ liệu đội hình còn thiếu; nút sẵn sàng/START bị chặn đúng.
- Chọn giai đoạn Điều hành chỉ hiển thị scoreboard, đội hình, công cụ và timeline. Trận chưa bắt đầu không có form/nút ghi sự kiện được phép dùng. Không hiển thị đồng thời form Trước/Sau trận.
- Có trạng thái SSE **Đang đồng bộ** sau reload. Trình duyệt có một số request gián đoạn đúng lúc thay container, sau đó tải lại API thành công.
- Đo DOM không tràn ngang tại các chiều rộng CSS đã quan sát. [Ảnh Trước trận](../output/match-operation-prompt-05/official-operation-pre.png), [ảnh Điều hành ở trạng thái chưa bắt đầu](../output/match-operation-prompt-05/official-operation-live.png).
- Bố cục ba cột ở màn hình rộng, vùng phụ thành tab dưới breakpoint mobile được giữ trong cùng component/CSS. **NOT TESTED nghiệm thu mobile/touch hoàn chỉnh**: emulation/viewport của trình duyệt tích hợp không ổn định và thao tác tab bị timeout; không lấy các ảnh thử mobile làm bằng chứng PASS.
- **NOT TESTED thao tác clock/form sự kiện tương tác trên một trận đang chạy trong browser**: các ca ghi P5 chạy qua API QA; không bắt đầu trận tương lai hoặc bổ sung điều lệ thật để tạo điều kiện UI test.

Ba giải chính thức vẫn thiếu bộ quy tắc điều hành đã công bố/áp dụng và đội hình của trận đang xem. Đây là điều kiện bị chặn đã được báo ở Prompt 2–4; không tự thay đổi điều lệ của người dùng. Trận lịch sử sẵn sàng nhưng thiếu đội hình vẫn được giữ để BTC xử lý đúng thẩm quyền.

## 6. File và API

Không thêm route tương đương. `POST /matches/:matchId/clock-actions` mở rộng action `SUSPEND_PLAY`, `DECLARE_ADDED_TIME`, thêm `reason`/`addedTimeSeconds`. GET clock/context trả metadata mới. `POST /match-events` thêm phase, thời điểm trong hiệp và expected clock version; API đọc/snapshot trả metadata thời gian. Các path cũ được giữ nguyên.

| Nhóm | File |
|---|---|
| Shared | [matchTiming](../packages/shared/src/matchTiming.ts), [exports](../packages/shared/src/index.ts) |
| Clock/domain | [repository](../services/match-service/src/repositories/matchClockRepository.ts), [workflow](../services/match-service/src/services/matchClockWorkflow.ts), [kickoff](../services/match-service/src/services/matchKickoff.ts), [model](../services/match-service/src/models/match.ts), [controller](../services/match-service/src/controllers/matchController.ts) |
| Migration | [migration 24](../services/match-service/src/db/matchClockTimingMigration.ts), [runner](../services/match-service/src/db/migrate.ts) |
| Event time | [timing service](../services/match-service/src/services/matchEventTiming.ts), [lineup service](../services/match-service/src/services/lineupService.ts), [repository](../services/match-service/src/repositories/lineupRepository.ts), [controller](../services/match-service/src/controllers/lineupController.ts), [card minute validation](../services/match-service/src/discipline/services/disciplineService.ts) |
| Freeze trạng thái | [match repository](../services/match-service/src/repositories/matchRepository.ts), [match service](../services/match-service/src/services/matchService.ts), [pause request repository](../services/match-service/src/repositories/matchPauseRequestRepository.ts) |
| UI/API | [RefereeOperationPage](../apps/web-client/src/components/referee/RefereeOperationPage.tsx), [helpers](../apps/web-client/src/components/referee/refereeOperation.ts), [Portal](../apps/web-client/src/components/referee/RefereePortal.tsx), [refresh](../apps/web-client/src/components/referee/useRefereeRefresh.ts), [SSE hook](../apps/web-client/src/hooks/useMatchFeedInvalidation.ts), [CSS](../apps/web-client/src/components/referee/referee-portal.css), [API DTO](../apps/web-client/src/api/competition.ts) |
| Dùng chung thời gian | [LiveMatchCenterPanel](../apps/web-client/src/components/LiveMatchCenterPanel.tsx), [legacy validator](../apps/web-client/src/components/MatchOperationsPanel.tsx) — chỉ đồng bộ thời gian/giới hạn phút, không thiết kế lại |
| Kiểm thử | [clock tests](../services/match-service/tests/matchClockWorkflow.test.cjs), [timing tests](../services/match-service/tests/matchClockTiming.test.cjs), [frontend tests](../apps/web-client/scripts/refereePortal.test.cjs), [QA runner](../scripts/qa-match-clock.cjs), [QA host](../scripts/qa-clock-runtime.cjs) |

## 7. Checkpoint và chạy lại

Giữ HEAD `27fa2bd9fef76f23bc6cb16b939f124735c8cea0` và mọi thay đổi chưa commit. [Checkpoint trước](../output/match-operation-prompt-05/checkpoint-before/manifest.json) sao lưu 87 đường dẫn source có sẵn, SHA-256 manifest `f84b42e01b342bf585a53f83823c3cf0d60ccf15c9cbba2c287e111a1ff2c6fb`. [Checkpoint sau](../output/match-operation-prompt-05/checkpoint-after/manifest.json) và [đối chiếu source](../output/match-operation-prompt-05/source-preservation.json) lưu toàn bộ working source liên quan/diff. Đây là checkpoint file, không phải commit gộp thay đổi của người dùng.

Chỉ build/khởi chạy hai thành phần đã đổi; không restart Organization hoặc Auth/Tournament:

```powershell
docker compose --profile apps build match-service web-client
docker compose --profile apps run --rm --no-deps match-migrate
docker compose --profile apps up -d --no-deps match-service web-client
docker compose --profile apps ps
```

**Dừng tại Prompt 5.** Chi tiết sự kiện/thay người, phân định/luân lưu, biên bản/kết quả và quyết định hành chính vẫn cần các prompt tiếp theo; không tuyên bố toàn bộ phân hệ đã hoàn thành.
