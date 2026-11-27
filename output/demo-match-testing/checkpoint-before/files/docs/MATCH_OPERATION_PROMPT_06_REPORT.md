# Prompt 6 — Sự kiện trận đấu và phối hợp tổ trọng tài

Ngày kiểm tra: **27/11/2026, UTC+7**. Tiếp nối [baseline](./MATCH_OPERATION_BASELINE.md), [ma trận luật](./MATCH_RULES_MATRIX.md) và [Prompt 5](./MATCH_OPERATION_PROMPT_05_REPORT.md).

**Đã triển khai lên Docker chính thức cổng 5173.** Không bắt đầu trận tương lai, thêm đội hình hoặc chèn sự kiện vào giải chính thức để kiểm thử. Chưa nghiệm thu toàn bộ phân hệ điều hành, luân lưu, kết quả hoặc án kỷ luật của các prompt sau.

## 1. Phạm vi được bảo toàn

- Giữ giao diện cam–đen, sáu route trọng tài, layout ba giai đoạn và khung đội hình / công cụ / diễn biến. Không dựng lại phân công BTC hoặc thay Bước 1–6.
- Giữ năm services, ownership PostgreSQL, Session cookie/Redis, SSE/LISTEN/NOTIFY và outbox hiện có. Không thêm runtime service, WebSocket hay RabbitMQ.
- Giữ lịch chính thức, phân công, roster, điều lệ công bố, SMTP, nút đăng ký dev, checkpoint 788015c và môi trường 15173.
- HEAD giữ nguyên **27fa2bd9fef76f23bc6cb16b939f124735c8cea0**. Không reset, stash, checkout hoặc commit gộp các thay đổi có trước.

## 2. Những lỗi đã sửa

### F05 — Sự kiện và thay người

- Một yêu cầu thay người ghi OUT + IN trong cùng transaction, dùng chung substitution ID và liên kết hai cầu thủ. API không còn nhận thao tác IN rời rạc.
- Tính trạng thái trên sân từ đội hình trận và chuỗi sự kiện có hiệu lực. Kiểm tra cầu thủ ra, cầu thủ vào, đội, truất quyền, tái nhập, số người thay và cơ hội thay theo bộ quy tắc đã ghim.
- Cùng một đợt thay nhiều người có thể dùng chung opportunity ID; backend kiểm tra cùng đội, hiệp và thời điểm. Thay lúc nghỉ giữa hiệp được phân biệt với cơ hội trong thời gian thi đấu. Quy tắc thêm người/cơ hội ở hiệp phụ chưa xác định thì chặn thao tác phụ thuộc.
- Cầu thủ dự bị chưa vào sân, đã thay ra hoặc bị truất quyền không được ghi bàn. Bàn phản lưới hưởng cho đối phương; penalty trong trận vẫn là sự kiện trong hiệp, không dùng làm lượt luân lưu.
- Phân biệt vàng, vàng thứ hai và đỏ trực tiếp. Người bị truất quyền bị loại khỏi trạng thái trên sân. Thẻ dự bị không tự giảm người đang thi đấu.
- Hỗ trợ chấn thương, rời sân tạm thời, trở lại sân và sự cố có mô tả. Sự cố không tự xử thua, đổi tỷ số hoặc đổi trạng thái hành chính.
- Futsal chỉ áp dụng khi giải chọn rõ bộ luật đó: thay luân phiên/tái nhập, giảm quân hai phút theo thời gian thi đấu, bổ sung người có thao tác rõ ràng; không tự cho người bị đuổi trở lại. Cảnh cáo trước trận được hướng dẫn ghi báo cáo/sự cố, không cộng thành thẻ vàng trong trận.
- START kiểm tra lại đội hình sau các sự kiện trước trận, gồm tối thiểu cầu thủ và thủ môn; không dùng trạng thái LINEUP_CONFIRMED để hợp thức hóa người đã bị truất quyền.

### F12 — Một nguồn thẻ chính thức

- Kiểm tra RECORD_EVENT trên POST /cards đã có từ thay đổi trước; được giữ nguyên và kiểm thử lại, gồm người chỉ có READ.
- POST /cards nay là adapter ghi sự kiện Match. Nó không gọi đường ghi Discipline trực tiếp. Trả event đã lưu và disciplineSync=PENDING, không giả trả một card chưa được tạo.
- Chỉ worker ISSUE_CARD / VOID_CARD chiếu sự kiện sang Discipline. Khóa advisory theo người/giải và event để tuần tự hóa các worker; unique source event / source card tiếp tục chống tạo trùng card và suspension khi retry.
- Sửa hoặc hủy thẻ tạo VOID_CARD cho nguồn cũ; sửa tạo ISSUE_CARD cho nguồn mới. Hủy nguồn thu hồi card và án phụ thuộc nguồn đó theo cơ chế hiện có.
- Không thiết kế lại việc tính án, reset thẻ qua giai đoạn hoặc thời điểm thi hành; đó vẫn thuộc Prompt 9. Không tuyên bố mọi tình huống án tích lũy đã nghiệm thu.

### Chống ghi trùng và đính chính

- operationId + hash nội dung + actor, kiểm tra trong khóa Match row. Retry cùng thao tác trả cùng sự kiện; dùng lại ID với nội dung khác trả conflict. Hai sự kiện hợp lệ cùng loại/cùng phút nhưng khác ID vẫn được giữ.
- expectedClockVersion kiểm tra mốc thời gian; expectedRevision kiểm tra đính chính. UI tải lại trạng thái khi conflict, không tự gửi lại thao tác đã đổi nghĩa.
- PUT đính chính tạo phiên bản thay thế và soft-void phiên bản cũ trong một transaction. Cặp thay người được thay cả hai bản ghi. logical sequence giữ vị trí trong chuỗi sự kiện dù có event ID mới.
- Sửa sự kiện hiệp đã kết thúc được kiểm chứng bằng END_PERIOD audit. Không cho thời điểm vượt mốc kết thúc hiệp đã lưu; không đoán hiệp của dữ liệu legacy thiếu metadata.
- Replay toàn chuỗi trước commit: hủy/sửa làm bàn thắng, thẻ vàng thứ hai hoặc thay người phía sau mất hợp lệ thì trả EVENT_CHAIN_INVALID kèm event ID. Không tự bỏ qua sự kiện phía sau.
- Audit append-only lưu actor, lý do, snapshot và quan hệ phiên bản. Không xóa cứng lịch sử. SSE ghi cùng transaction, chỉ tới người xem sau commit.

## 3. Giao diện và API

Các nút sự kiện mở một modal; lấy đội, số áo, tên cầu thủ và clock thật. Thay người có hai ô chọn và một lần lưu. Chỉnh sửa mở lại modal với dữ liệu cũ, lý do bắt buộc; cầu thủ được chọn theo trạng thái trước sự kiện gốc, kể cả hiện đã thay ra. Timeline có icon, đội, cầu thủ, pha, thời điểm và nhãn nội bộ.

| API | Thay đổi |
|---|---|
| POST /match-events | operationId, pair thay người, phạm vi PUBLIC/CREW, kiểm tra chuỗi |
| PUT /match-events/:id | Mới: EDIT_EVENT, expectedRevision, correctionReason, thay thế nguyên tử |
| DELETE /match-events/:id | EDIT_EVENT; hủy cả pair; kiểm tra phụ thuộc; retry an toàn |
| POST /cards | Giữ path; adapter canonical event, phản hồi event + PENDING |
| GET /matches/:id/referee-context | Đọc cả sự kiện nội bộ theo quyền phân công |
| GET /matches/:id/events và live-state | Chỉ sự kiện PUBLIC có hiệu lực |
| GET biên bản công khai | Lọc sự kiện CREW khỏi snapshot công khai |

Không bắt người dùng nhập UUID. Các mã thao tác/phiên bản do frontend quản lý. Không có workflow mọi sự kiện phải chờ trọng tài chính duyệt; người có RECORD_EVENT được ghi theo phân công đã công bố.

## 4. Database và phục hồi

- Migration Match **25**, [source](../services/match-service/src/db/matchEventWorkflowMigration.ts), thêm metadata thao tác, pair, phiên bản, supersedes, logical sequence, visibility và bảo vệ lịch sử. Bổ sung có transaction và ledger; không sửa migration đã áp dụng, không tạo kho sự kiện thứ hai.
- Không thêm bảng vào Scheduling hoặc Discipline, không đổi ownership database.
- Đã sao lưu bảy database liên quan vào [backup riêng](../backups/match-operation-prompt-06-001/). QA dùng database phục hồi mới cho mỗi lượt, prefix sfl_prompt06_qa_; không drop/reset bộ QA cũ.
- Phương án phục hồi: giữ backup và image trước triển khai; nếu cần khôi phục dữ liệu, phục hồi vào database mới để đối chiếu, không restore đè dữ liệu người dùng. Migration bổ sung không yêu cầu xóa cột hoặc dữ liệu để quay lại code trước đó; phải đánh giá tương thích event mới trước khi đổi image.

## 5. Kết quả kiểm thử

[Kết quả API/PostgreSQL lượt 005](../output/match-operation-prompt-06/qa-api-005.json): **24 PASS, 0 FAIL**. Các lượt trước được giữ nguyên; lượt 001 dừng vì ca kiểm thử dùng anonymous trong khi Gateway yêu cầu đăng nhập, đã sửa harness sang tài khoản ngoài tổ, không nới xác thực.

| Nghiệp vụ | Kết quả | Bằng chứng/phạm vi |
|---|---|---|
| Bàn thường, phản lưới, penalty trong trận | PASS | API thật, event PostgreSQL; score projection/unit |
| Dự bị chưa vào sân, đã thay ra, bị đuổi ghi bàn | PASS | API từ chối theo chuỗi thực |
| Thay người nguyên tử, lỗi giữa OUT và IN | PASS | Trigger gây lỗi chỉ trong QA; event/audit/SSE không tăng |
| Thay luân phiên, tái nhập theo luật chọn rõ | PASS | QA futsal và unit; không đổi loại sân 5 chính thức |
| Vàng thứ hai, đỏ trực tiếp, giảm người | PASS | API; pre-match GK bị đuổi chặn START |
| Retry/double-click, hai thao tác cùng phút | PASS | API concurrent, operation ID; không gộp sự kiện hợp lệ |
| Sửa/void, version, chuỗi phụ thuộc | PASS | Goal hiệp cũ, card, thay người; outbox và reload |
| READ ghi thẻ; BTC+REFEREE vượt capability | PASS | API READ-only + test authorization đa role |
| Hai trọng tài ghi cùng trận | PASS | Hai session thật; cùng danh sách event sau commit |
| Nội bộ/công khai | PASS | Incident CREW không xuất hiện ở API timeline công khai |
| Ba thể thức / 5–7–11 người | PASS có phạm vi | API trên fixture/lịch sẵn có của ba bản sao QA; không nghiệm thu toàn giải |
| Thay thế/thu hồi khi đang mở trang | PASS regression / NOT TESTED E2E P6 | Test quyền và hook xóa context; API replacement đã chạy P5; không đổi crew của trận thật đang tác nghiệp |
| Modal thay người và chỉnh sửa | PASS component test | Một POST chứa pair; PUT giữ hiệp gốc, lý do và version; chưa thao tác live trên browser chính thức |
| Typecheck / production build | PASS | Toàn workspace; Vite vẫn cảnh báo chunk lớn, không phải lỗi build |
| Match tests | PASS | **239 PASS, 0 FAIL, 34 SKIP**, tổng 273; SKIP không được tính PASS |
| Frontend tests | PASS | **31 PASS, 0 FAIL**, gồm modal và phân quyền |
| Docker / health / source provenance | PASS | 9 running, 8 healthy; 3 compiled hashes và HTTP bundle khớp local build |

QA sử dụng API nghiệp vụ qua Gateway, đăng nhập Auth thật, PostgreSQL phục hồi và host Match riêng. Thời gian dài được điều khiển bằng Node test timer qua IPC của harness, không thêm endpoint test hoặc nới thời điểm bắt đầu production. Không gửi SMTP trong QA.

## 6. Kiểm tra hệ thống chính thức

- [Truy cập tác nghiệp](http://localhost:5173/referee/matches/8b8a61e2-4b83-4c8c-962e-580b4a594106/operation).
- [Runtime proof](../output/match-operation-prompt-06/official-runtime-proof.json) xác nhận cột dữ liệu nghiệp vụ cũ trong năm database không đổi. Chỉ ledger/schema Match bổ sung theo migration 25. Lịch sử clock chính thức vẫn 0 dòng; trận tương lai vẫn NOT_STARTED v0, chưa có đội hình giả.
- [Release summary](../output/match-operation-prompt-06/release-summary.json): Match image 63f64d152c603aa5f993b58ec8585967a7fd0efd3e12deaffbc6ba88aa194366; frontend image 872bacf66408a6df639bdf2967c76a0d5bf69b4ac624afc63fba963b48b12026.
- Bundle /assets/index-Bp7S0xpv.js, SHA256 ed205578e771094b7a37e0aa9e17c500a77f84cfbe55aa7e71045967cb6c83c5.
- Browser thật đã reload, xem Trước trận và Điều hành; không có form sự kiện hoặc nút bắt đầu vượt điều kiện. [Ảnh trước trận](../output/match-operation-prompt-06/official-operation-pre.png), [ảnh khu vực điều hành chưa bắt đầu](../output/match-operation-prompt-06/official-operation-live.png).
- Điều hướng bằng bàn phím hoạt động. Click qua công cụ browser có lúc bị lớp header/portal intercept; ảnh full-page có vùng trắng lớn do trạng thái capture/viewport hiện tại. Không dùng những ảnh này để kết luận mobile hoặc toàn bộ thao tác pointer PASS.
- HTTP SSE chính thức trả 200 text/event-stream; badge trong browser vẫn hiển thị “Đang đồng bộ” tại thời điểm quan sát. **NOT TESTED đầy đủ:** reconnect nhiều tab/thiết bị trên browser chính thức sau rollout. QA và test hook không thay thế nghiệm thu transport browser.

## 7. Giới hạn còn lại

- **NOT TESTED E2E browser:** trận đang chạy, nhập toàn bộ modal trên điện thoại, timeout mạng thật và hai cửa sổ browser cùng tác nghiệp. Không bắt đầu trận tương lai để chụp hình thành công.
- Phạm vi thẻ hiện là cầu thủ đã có trong đội hình trận. Hệ thống chưa có danh sách đối tượng khu kỹ thuật chính thức theo trận; các đối tượng khác được ghi nhận bằng sự cố, không tạo hồ sơ/thẻ giả.
- **Chưa nghiệm thu** các ngoại lệ giảm quân futsal phức tạp như quyết định lợi thế rồi mới truất quyền sau bàn thắng, hoặc DOGSO của người ngoài sân. Không tuyên bố model hiện tại bao phủ mọi ngoại lệ FIFA 2026/27.
- Án treo giò qua nhiều trận/giai đoạn, reset thẻ, các trường hợp phân định và luân lưu chi tiết còn thuộc Prompt 7/9. Luồng duyệt biên bản và quyết định hành chính còn các vấn đề baseline đã nêu ở prompt sau.
- Đính chính bị chặn sau khi biên bản đang chờ duyệt/đã duyệt, hoặc thiếu lịch sử clock để kiểm chứng hiệp cũ. Cần quy trình có thẩm quyền, không sửa trực tiếp dữ liệu để vượt gate.

## 8. File thay đổi và checkpoint

Code chính: [projection dùng chung](../packages/shared/src/matchEventState.ts), [timing order](../packages/shared/src/matchTiming.ts), [event mutation repository](../services/match-service/src/repositories/matchEventMutationRepository.ts), [migration 25](../services/match-service/src/db/matchEventWorkflowMigration.ts), [lineup repository](../services/match-service/src/repositories/lineupRepository.ts), [lineup service](../services/match-service/src/services/lineupService.ts), [controller](../services/match-service/src/controllers/lineupController.ts), [routes](../services/match-service/src/routes/matchRoutes.ts), [clock gate](../services/match-service/src/repositories/matchClockRepository.ts), [model](../services/match-service/src/models/match.ts), [portal projection](../services/match-service/src/services/refereePortalService.ts), [discipline controller](../services/match-service/src/discipline/controllers/disciplineController.ts), [discipline service](../services/match-service/src/discipline/services/disciplineService.ts), [outbox](../services/match-service/src/discipline/services/matchEventDisciplineOutbox.ts).

Frontend: [workspace tác nghiệp](../apps/web-client/src/components/referee/RefereeOperationPage.tsx), [quyền và thời gian](../apps/web-client/src/components/referee/refereeOperation.ts), [nhãn](../apps/web-client/src/components/referee/RefereeShared.tsx), [API competition](../apps/web-client/src/api/competition.ts), [adapter cards](../apps/web-client/src/api/rest.ts), [nhãn timeline công khai](../apps/web-client/src/components/LiveMatchCenterPanel.tsx). Không đổi CSS/layout.

Tests/harness: [event unit](../services/match-service/tests/matchEventsWorkflow.test.cjs), [authorization regression](../services/match-service/tests/matchOperationReadiness.test.cjs), [frontend tests](../apps/web-client/scripts/refereePortal.test.cjs), [API QA](../scripts/qa-match-events.cjs), [QA host](../scripts/qa-events-runtime.cjs), [backup/restore riêng](../scripts/prepare-match-events-qa.cjs). Shared index và migration runner bổ sung export/gọi migration mới.

Checkpoint trước: [manifest](../output/match-operation-prompt-06/checkpoint-before/manifest.json), **103 đường dẫn**, SHA256 9dc55c5201e742cbfb32392f309f27d8de748fb3a43a935e77cf79bf866c6241. [Checkpoint sau](../output/match-operation-prompt-06/checkpoint-after/manifest.json) và [đối chiếu bảo toàn](../output/match-operation-prompt-06/source-preservation.json) giữ nguyên HEAD và các source ngoài phạm vi. Đây là checkpoint source/diff, không phải commit gộp thay đổi người dùng.

**Dừng ở Prompt 6.**
