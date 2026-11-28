# Prompt 8 — Biên bản và xác nhận kết quả (F07, F08)

Ngày: **28/11/2026, UTC+7**. Bản triển khai chính thức: [Biên bản trọng tài](http://localhost:5173/referee/reports). Phạm vi là tổng hợp, lưu nháp, gửi, yêu cầu bổ sung và công nhận kết quả; không triển khai Prompt 9–10 hoặc nghiệm thu toàn bộ giải đấu.

## 1. Kết quả chính

- Giữ một không gian tác nghiệp, ba giai đoạn và giao diện cam–đen. Giai đoạn **Sau trận** hiển thị kết quả, thống kê, timeline, thông tin bổ sung và thao tác theo quyền. Không nhập lại tỷ số hoặc mở lại trận để chuẩn bị biên bản.
- `MANAGE_REPORT` chuẩn bị và gửi bản nộp. `FINALIZE` cùng chỉ định final authority xác nhận bản nộp thông thường, kể cả khi không có `MANAGE_REPORT`. Một người có đủ hai quyền chuẩn bị và công nhận trong một thao tác. Người hỗ trợ không bị ép chuyển mọi biên bản sang BTC.
- BTC tiếp tục xử lý hồ sơ có ngoại lệ. Biên bản thông thường không được công nhận bằng API review của BTC. Giữ API yêu cầu đính chính kết quả; tác động chi tiết sau đính chính tiếp tục thuộc Prompt 9–10.
- Xác nhận thông thường cập nhật biên bản, kết quả `APPROVED`, trận `VERIFIED`, BXH hiện có, nguồn thắng knockout và sự kiện realtime bền vững trong **một transaction Match**. Lỗi tại bước ghi kết quả hoặc bước realtime cuối cùng rollback toàn bộ.
- Phiên bản và mã thao tác chống ghi đè/retry/double-click. Retry đã commit trả lại kết quả đã xử lý, không mắc `REPORT_EXISTS`. Không tự retry thao tác cũ khi version conflict.
- Bản nộp đóng băng tên đội, giải, sân/lịch, tổ trọng tài, cầu thủ, sự kiện, clock, tỷ số từng giai đoạn và ghi chú. Trang lịch sử đọc đúng lần nộp được chọn. Dữ liệu cũ thiếu trường hiển thị thiếu căn cứ, không lấy dữ liệu hiện tại thay thế.

Căn cứ nghiệp vụ: [Use Case cập nhật — Quy tắc xác nhận kết quả trận đấu](./Usecase_da_chinh_sua_v2.md#quy-tắc-xác-nhận-kết-quả-trận-đấu-cập-nhật-nghiệp-vụ), [baseline](./MATCH_OPERATION_BASELINE.md), [ma trận quy tắc](./MATCH_RULES_MATRIX.md). Không đưa quy trình BTC duyệt mọi trận từ tài liệu cũ trở lại.

## 2. API và tính nhất quán

| API dưới `/api` | Hợp đồng |
|---|---|
| `POST /match-reports` | Giữ path. `action=SAVE_DRAFT` hoặc `SUBMIT`; `expectedVersion` và UUID `operationId`. Version ban đầu là 0. Server tự tổng hợp tỷ số/đội hình/sự kiện; trường tỷ số client không quyết định kết quả. |
| `POST /match-reports/:id/confirm` | Mới: final authority hiện hành; `expectedVersion>=1`, UUID `operationId`; `decision=APPROVE` hoặc `REQUEST_CHANGES` cùng lý do 5–2000 ký tự. Không cần quyền chuẩn bị biên bản để xác nhận bản nộp của người hỗ trợ. |
| `PUT /match-reports/:id/review` | Giữ path và quyền quản lý đúng giải; chỉ xử lý ngoại lệ. Nhận metadata version/mã thao tác tương thích. |
| `GET /matches/:id/report/manage`, `GET /matches/:id/referee-context`, `GET /my/schedules/workspace` | Đọc version, draft, bản nộp, lịch sử và trạng thái thực. Không tạo API danh sách trùng chức năng. |
| `GET /matches/:id/report` | Chỉ dữ liệu công khai được phép; bỏ draft, review history và nội dung nội bộ/CREW khỏi projection công khai. |

Legacy caller của đường submit/review có thể chưa gửi cặp concurrency để giữ tương thích. Luồng frontend mới luôn gửi cả hai; endpoint confirm mới bắt buộc cả hai. Khi đã dùng operation ID, đổi nội dung với cùng ID bị chặn. Giới hạn thời tiết **100**, ghi chú **2000** ký tự; khán giả là số nguyên không âm trong phạm vi PostgreSQL integer.

Các thao tác trọng tài kiểm tra lại phân công/capability đang công bố dưới **Scheduling lease hiện có**. Match row lock và transaction chỉ thuộc `sfl_match`; Scheduling được đọc dưới cơ chế riêng, không giả định transaction xuyên database. Context từ Tournament/Organization/Auth qua API hiện có. Phiên bản kết quả được kiểm tra lại với sự kiện đã ghi; không lấy tỷ số tự nhập làm nguồn chính thức.

Realtime dùng `match_realtime_events` và PostgreSQL NOTIFY trong transaction. Notification chỉ được chuyển sau commit; retry không phát thêm một lần công nhận. Không thêm RabbitMQ, WebSocket, service hoặc DB ownership mới.

## 3. Migration, backup và dữ liệu được bảo toàn

Migration Match **28**: [matchReportWorkflowMigration.ts](../services/match-service/src/db/matchReportWorkflowMigration.ts).

- Thêm version, draft, `requires_organizer_review`, trạng thái `DRAFT`, version trên review và bảng receipt `match_report_operations`.
- Trigger bảo vệ prefix lịch sử bản nộp và cấm sửa/xóa review/receipt. Không sửa các migration đã áp dụng, không backfill hoặc tự đổi nội dung biên bản cũ. Biên bản legacy mặc định cần review như trước để tránh tự phân loại lại thành thông thường.
- Migration transactional/versioned; chạy hai lần trên QA chỉ có một ledger entry. Đã chạy trên database chính thức.
- [Backup trước migration](../backups/match-operation-prompt-08-20261128-001/manifest.json) chứa custom dump của Match, Scheduling, Discipline, Tournament, Team; từng archive có SHA-256 và đã kiểm tra `pg_restore --list`. Không ghi đè backup cũ.
- [Đối chiếu trước](../output/match-operation-prompt-08/official-before.json) / [sau migration](../output/match-operation-prompt-08/official-after.json): **105 bảng**, so sánh theo chính các cột cũ; thay đổi duy nhất là ledger Match từ 27 lên 28. Nội dung nghiệp vụ cũ không đổi. Các cột bổ sung có default mới nên phép đối chiếu này không tuyên bố schema bất biến.
- [Runtime proof](../output/match-operation-prompt-08/runtime-verification.json): hệ thống chính thức hiện có **0 biên bản, 0 operation receipt** sau lần reset dữ liệu trước đó. Không tạo kết quả giả hoặc bắt đầu trận tương lai để làm trang đầy dữ liệu.

Phục hồi an toàn: dùng backup để restore **vào database mới** trước khi đối chiếu; không restore đè các DB đang dùng. Giữ image cũ và schema bổ sung khi cần đánh giá rollback code. Sau khi đã có bản nộp/receipt mới, phải đánh giá tương thích trước khi chạy code cũ; không có migration down phá dữ liệu.

## 4. Kiểm thử thực tế

### API/PostgreSQL QA

[QA lượt 003](../output/match-operation-prompt-08/qa-api-003.json): **17 PASS, 0 FAIL**. Dùng bản phục hồi riêng có prefix `sfl_prompt08_qa_`, router/service thực và session Auth hợp lệ. Năm database nghiệp vụ chính thức được fingerprint trước/sau QA; không ghi nghiệp vụ vào chúng. Auth đăng nhập tạo session Redis bình thường, không bypass RBAC. Thời gian QA được điều khiển trong host test, không thêm endpoint bỏ gate trong production.

| Nghiệp vụ | Kết quả | Bằng chứng/phạm vi |
|---|---|---|
| Lưu nháp, đọc lại, không cập nhật BXH | PASS | Trận giữ FINISHED, kết quả giữ PENDING, standings không đổi |
| Một trọng tài chuẩn bị và công nhận | PASS | Report APPROVED + result APPROVED + match VERIFIED, cùng transaction |
| Người hỗ trợ gửi, final authority xác nhận | PASS | MANAGE_REPORT chỉ tạo PENDING thường lệ; final authority chỉ có FINALIZE vẫn xác nhận được |
| Yêu cầu người chuẩn bị bổ sung | PASS | Giữ bản nộp cũ, lý do/version/audit; bản gửi lại được công nhận |
| MANAGE_REPORT không FINALIZE, BTC ngoài tổ | PASS | API từ chối; thêm unit cho BTC+REFEREE ngoài tổ |
| Hồ sơ ngoại lệ | PASS | Không đi qua xác nhận thường lệ; BTC yêu cầu sửa, người chuẩn bị nộp lại; giữ lịch sử |
| Version conflict, double-click, retry | PASS | Hai request song song cùng operation trả cùng kết quả; hash khác bị chặn; không tạo kết quả chính thức thứ hai |
| Fault injection trước ghi kết quả và cuối transaction | PASS | Report/result/match/standings/receipts rollback; không có SSE công nhận |
| SSE sau commit | PASS | Một cập nhật sau công nhận, không có sự kiện do transaction thất bại |
| Snapshot/append-only | PASS | Đổi dòng đội hình/sự kiện hiện tại trong QA không làm đổi snapshot; trigger chặn sửa lịch sử |
| Restart host QA và đọc lại | PASS | Report/version/result/history giữ chính xác |
| Nguồn thắng knockout | PASS | Đi tiếp chỉ sau công nhận; bảo toàn luồng hiện có |
| Giới hạn weather/notes, JSONB score | PASS | 100/2000 và so sánh 6 trường score không phụ thuộc thứ tự key JSONB |

Lượt QA 001 được giữ trong evidence: phát hiện so sánh `JSON.stringify` khác thứ tự key PostgreSQL JSONB khiến báo stale giả. Đã sửa so sánh từng trường và thêm regression test. Lượt 002 có 15 ca PASS; lượt 003 mở rộng thêm rollback cuối transaction và final authority không cần MANAGE_REPORT. Không che kết quả chạy cũ hoặc nới điều kiện để test qua.

### Test, build và triển khai

| Kiểm tra | Kết quả |
|---|---|
| Match suite | **262 PASS, 0 FAIL, 34 SKIP**, tổng 296 — [log](../output/match-operation-prompt-08/backend-tests-release.log) |
| Referee frontend suite | **39 PASS, 0 FAIL** — [log cuối](../output/match-operation-prompt-08/frontend-tests-release.log) |
| Workspace typecheck | PASS — [log](../output/match-operation-prompt-08/typecheck.log) |
| Workspace production build | PASS — [log](../output/match-operation-prompt-08/build.log); frontend sau thay đổi cuối [log](../output/match-operation-prompt-08/web-build-release.log) |
| Compose config / Match và Web build / migration / up | PASS — [build](../output/match-operation-prompt-08/docker-build.log), [migration](../output/match-operation-prompt-08/migration.log), [Web build cuối](../output/match-operation-prompt-08/docker-web-release.log), [Web up cuối](../output/match-operation-prompt-08/docker-web-release-up.log) |
| Runtime nguồn đang phục vụ | PASS — 9 running, 8 có healthcheck đều healthy; 5 compiled Match hashes và 2 HTTP assets khớp local; [proof](../output/match-operation-prompt-08/runtime-verification.json) |
| Trình duyệt chính thức | PASS — đăng nhập trọng tài thật, `/referee/reports`, bộ lọc/empty state tiếng Việt; viewport 1280 không tràn ngang |
| Trình duyệt dữ liệu biên bản QA | PASS có phạm vi — frontend chính thức 5173, chỉ request nghiệp vụ của tab kiểm tra chuyển tới API QA thật; danh sách 3 biên bản, lọc approved còn 2, chi tiết, chọn lần nộp 1/2 đổi đúng ghi chú, Sau trận chỉ xem sau công nhận. Đã bỏ route interception; không tạo frontend hoặc route production thứ hai. |
| In/PDF | PASS có phạm vi — cùng component/CSS, frozen report từ API QA, Chrome xuất PDF 3 trang có nội dung thật; đã mở và kiểm tra ba trang. Chưa in giấy hoặc chạy trọn thao tác hộp thoại print trên mọi trình duyệt. |

Ảnh thực tế:

- [Cổng chính thức — danh sách sau reset](../output/match-operation-prompt-08/browser-official-reports.png).
- [Danh sách QA](../output/match-operation-prompt-08/browser-report-list.png), [bản nộp lịch sử](../output/match-operation-prompt-08/browser-report-history.png), [Sau trận](../output/match-operation-prompt-08/browser-after-match.png). Các ảnh QA dùng API/database QA; không được hiểu là dữ liệu đã công nhận trên giải chính thức.
- [PDF trang 1](../output/match-operation-prompt-08/browser-export-pdf.png), [trang 2](../output/match-operation-prompt-08/pdf-verified-page2.png), [trang 3](../output/match-operation-prompt-08/pdf-verified-page3.png). Lỗi trắng trang do specificity CSS print đã sửa; không thay tiện ích in Bước 5.

### NOT TESTED và vấn đề còn lại

- **34 test opt-in SKIP** được giữ nguyên; không tính thành PASS. Chưa nghiệm thu toàn bộ luồng qua nhiều tài khoản/trình duyệt từ đội hình đến kết quả trong cùng phiên thao tác UI; phần ghi biên bản/xác nhận đầy đủ được kiểm chứng qua API QA và component tests.
- Retry mô phỏng gửi lại sau commit và request đồng thời đã PASS; **chưa cắt kết nối TCP thật đúng thời điểm response bị mất**, chưa fault giữa Scheduling commit và Match commit trên hai host độc lập.
- Chưa nghiệm thu mọi hồ sơ ngoại lệ hành chính, claim/appeal và đính chính có tác động dây chuyền đến giải đã đi tiếp; không sửa các API đó trong Prompt 8.
- **F09 còn tồn tại**: bảng standings tổng hiện có vẫn theo 3/1/0, trong khi group standings đọc quy tắc điều lệ riêng. Prompt 8 bảo đảm thời điểm/transaction công nhận, không tuyên bố đã thống nhất mọi tiêu chí BXH, thống kê hoặc giải đấu hoàn chỉnh.
- Chưa nghiệm thu mobile thực với biên bản dài; thay viewport qua browser host lần trước không đổi được kích thước thực, nên ảnh có tên mobile không được dùng làm bằng chứng mobile PASS.
- Vite vẫn cảnh báo chunk >500 KB. Không refactor bundle ngoài phạm vi.
- Một số biên bản legacy thiếu context/name không thể tái dựng đúng quá khứ; UI báo rõ thiếu dữ liệu và giữ snapshot cũ, không tự backfill.

## 5. File có thay đổi

### Backend

- [matchReportRepository.ts](../services/match-service/src/repositories/matchReportRepository.ts) — transaction, version, receipt, snapshot, final authority/exception review.
- [lineupRepository.ts](../services/match-service/src/repositories/lineupRepository.ts) — giữ phần lineup/event, delegate nghiệp vụ biên bản sang repository chuyên trách trong cùng service.
- [lineupService.ts](../services/match-service/src/services/lineupService.ts), [lineupController.ts](../services/match-service/src/controllers/lineupController.ts), [matchRoutes.ts](../services/match-service/src/routes/matchRoutes.ts), [match.ts](../services/match-service/src/models/match.ts) — quyền, API, metadata tương thích.
- [matchReportWorkflowMigration.ts](../services/match-service/src/db/matchReportWorkflowMigration.ts), [migrate.ts](../services/match-service/src/db/migrate.ts) — migration 28.
- [matchReportWorkflow.test.cjs](../services/match-service/tests/matchReportWorkflow.test.cjs), [matchReportAuthority.test.cjs](../services/match-service/tests/matchReportAuthority.test.cjs) — regression/authorization.

### Frontend

- [RefereeAfterMatchPanel.tsx](../apps/web-client/src/components/referee/RefereeAfterMatchPanel.tsx), [RefereeOperationPage.tsx](../apps/web-client/src/components/referee/RefereeOperationPage.tsx) — Sau trận, lưu/gửi/xác nhận/preview.
- [RefereeReportDocument.tsx](../apps/web-client/src/components/referee/RefereeReportDocument.tsx), [reportDocumentModel.ts](../apps/web-client/src/components/referee/reportDocumentModel.ts), [RefereeReportsPage.tsx](../apps/web-client/src/components/referee/RefereeReportsPage.tsx) — tài liệu dùng chung, snapshot, hai route report hiện có, bộ lọc/in.
- [RefereeShared.tsx](../apps/web-client/src/components/referee/RefereeShared.tsx), [referee-portal.css](../apps/web-client/src/components/referee/referee-portal.css) — nhãn DRAFT/PENDING và style report/print có scope.
- [competition.ts](../apps/web-client/src/api/competition.ts), [client.ts](../apps/web-client/src/api/client.ts), [MatchOperationsPanel.tsx](../apps/web-client/src/components/MatchOperationsPanel.tsx), [refereePortal.test.cjs](../apps/web-client/scripts/refereePortal.test.cjs) — contract, lỗi REPORT cụ thể, hàng chờ BTC chỉ ngoại lệ, component tests.

### Tài liệu và công cụ QA

- [baseline](./MATCH_OPERATION_BASELINE.md), [API routing](./API_ROUTING.md), báo cáo này.
- [checkpoint](../scripts/checkpoint-match-reports.cjs), [backup](../scripts/backup-match-reports.cjs), [restore QA](../scripts/prepare-match-reports-qa.cjs), [QA runner](../scripts/qa-match-reports.cjs), [cases](../scripts/qa-match-reports-cases.cjs), [QA host](../scripts/qa-reports-runtime.cjs), [database proof](../scripts/proof-match-reports.cjs), [runtime proof](../scripts/verify-match-reports-runtime.cjs), [render report QA](../scripts/render-match-report-qa.cjs). Công cụ không được mount vào route production.

## 6. Checkpoint và chạy lại

HEAD giữ **a886a08f9830373e76edf6c89bd09168cf9a88b6**. Không reset/stash/checkout hoặc commit gộp. [Checkpoint trước](../output/match-operation-prompt-08/checkpoint-before/manifest.json) bảo toàn 1160 đường dẫn nguồn; SHA-256 manifest `7462f3d3a00bc9fd2365c785c90ca3f808a4d7ad29d14fec9e04c78f9f28a3bb`. [Checkpoint sau](../output/match-operation-prompt-08/checkpoint-after/manifest.json) lưu source, manifest/hash và patch; [đối chiếu source](../output/match-operation-prompt-08/source-preservation.json) ghi rõ những đường dẫn thay đổi và giữ nguyên. Đây là checkpoint file, không phải Git commit mới.

Hệ thống hiện có overlay Demo Mode được triển khai từ trước. Giữ nguyên overlay khi chạy lại, không thay env hoặc cổng đối chiếu:

```powershell
docker compose -f docker-compose.yml -f output/demo-match-testing/compose.demo.yml --profile apps config --quiet
docker compose -f docker-compose.yml -f output/demo-match-testing/compose.demo.yml --profile apps build match-service web-client
docker compose -f docker-compose.yml -f output/demo-match-testing/compose.demo.yml --profile apps run --rm --no-deps match-migrate
docker compose -f docker-compose.yml -f output/demo-match-testing/compose.demo.yml --profile apps up -d --no-deps match-service web-client
docker compose -f docker-compose.yml -f output/demo-match-testing/compose.demo.yml --profile apps ps
```

Script QA không được chạy lại cùng run ID vì evidence/DB có chống ghi đè. Muốn chạy vòng mới phải chọn suffix mới và phục hồi QA riêng trước; không trỏ runner vào database chính thức. Không dùng `down -v`, seed ghi đè hoặc reset.

**Dừng sau Prompt 8.** F07/F08 đã có code, API QA và kiểm chứng deployment nêu trên; chưa tuyên bố toàn bộ phân hệ trọng tài hoặc kết thúc giải production-ready.
