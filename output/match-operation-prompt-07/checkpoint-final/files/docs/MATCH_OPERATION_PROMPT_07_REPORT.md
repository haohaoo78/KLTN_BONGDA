# Prompt 7 — Hiệp phụ, luân lưu và kết thúc thi đấu (F06)

Ngày thực hiện: **27/11/2026 (UTC+7)**. Phạm vi: phân định sau hai hiệp, từng lượt luân lưu và chuyển sang Sau trận; không nghiệm thu thay cho toàn bộ nghiệp vụ biên bản, kỷ luật hoặc công nhận kết quả của các prompt tiếp theo.

## 1. Bảo toàn

- Giữ route `/referee/matches/:matchId/operation`, giao diện cam–đen, ba giai đoạn, scoreboard, đội hình và timeline. Panel luân lưu chỉ render ở `PENALTIES`; không tạo route/service hoặc giao diện thử nghiệm trong runtime.
- Giữ Bước 1–6, lịch, phân công, roster và các phiên bản điều lệ đã công bố. Không bắt đầu trận tương lai trong hệ thống chính thức, không sửa giải sân 5 thành futsal.
- HEAD giữ `27fa2bd9fef76f23bc6cb16b939f124735c8cea0`; checkpoint nguồn là bản sao kèm hash/patch, không commit gộp các thay đổi trước đó. [Checkpoint trước](../output/match-operation-prompt-07/checkpoint-before/manifest.json): 114 đường dẫn, bao gồm script checkpoint mới; toàn bộ 113 đường dẫn nguồn từ cuối Prompt 6 được giữ.
- Sao lưu bảy database liên quan tại [backup Prompt 7](../backups/match-operation-prompt-07-001/). Không reset/drop database, volume, image, checkpoint 788015c hoặc môi trường 15173.

## 2. Nghiệp vụ đã bổ sung

### Phân định và clock

Backend lấy phương thức từ phiên bản quy tắc của chính trận. Vòng bảng/vòng tròn cho phép hòa kết thúc hòa; thời lượng hiệp phụ còn lưu trong điều lệ không tự bật hiệp phụ. Knockout thắng trong hai hiệp kết thúc ngay; hòa mới theo `PENALTIES_ONLY` hoặc `EXTRA_TIME_THEN_PENALTIES`. API chặn bỏ qua hiệp phụ, hiệp phụ/luân lưu trái điều lệ, kết thúc loạt chưa có đội thắng và bàn chưa xác định được hiệp.

Kết thúc qua clock lưu actual end, kết quả từng giai đoạn, đội thắng dự kiến và `PENDING` trong cùng transaction Match với `FINISHED`/`ENDED`. Không gọi duyệt biên bản, cập nhật BXH hoặc điền đội đi tiếp tại thao tác này.

### Từng lượt luân lưu

- Thiết lập đội sút trước theo kết quả tung đồng xu thực tế; hệ thống không tự chọn.
- Tính danh sách từ đội hình trận và sự kiện có hiệu lực. IFAB/VFF lấy người trên sân hoặc tạm rời sân cuối thời gian thi đấu; futsal có cả dự bị, loại người bị đuổi hoặc đã rời trận do chấn thương. Ngoại lệ không thể tiếp tục phải được trọng tài ghi rõ, không suy từ ghi chú tùy ý.
- Kiểm tra cân bằng bắt buộc IFAB/VFF; futsal cho giữ số người hoặc giảm về số đối phương. Không cho tùy ý cắt cả hai đội xuống số lượng bất kỳ.
- Sút luân phiên, kiểm tra chu kỳ cầu thủ, số lượt ban đầu từ luật đã ghim, kết thúc sớm, lượt bổ sung và điều kiện bằng số lượt. Không nhận thêm lượt khi đã có đội thắng.
- Đá lại giữ người/lượt, không cộng lượt và bàn của lần bị thay thế. Đính chính cần EDIT_EVENT, reason và version; replay từ đầu, chặn thay đổi làm các lượt sau mất hợp lệ. Hủy dữ liệu lượt cuối giữ lịch sử.
- Thay thủ môn theo quyết định thực tế: kiểm tra người hợp lệ, dự bị chưa sử dụng/quyền thay còn lại hoặc người đã loại để cân bằng; thủ môn bị đuổi chỉ thay bằng người còn đủ điều kiện. Người cũ không trở lại. Chu kỳ người thay kế thừa lượt thủ môn cũ khi cần.
- Mã thao tác + hash + actor chống retry/double-click; khóa Match row và Scheduling lease hiện có xử lý xung đột clock/phân công. READ không ghi; RECORD_EVENT ghi lượt; EDIT_EVENT đính chính; FINALIZE thiết lập/quyết định đá lại/thay thủ môn/kết thúc.
- Snapshot và audit PostgreSQL là nguồn chính thức; không lưu nghiệp vụ bằng localStorage. SSE chỉ phát sau commit.

### Hợp đồng tỷ số

| Trường | Ý nghĩa |
|---|---|
| `homeScore`, `awayScore` | Bàn trong hai hiệp chính, gồm bù giờ đúng hiệp |
| `homeExtraTimeScore`, `awayExtraTimeScore` | **Bàn tăng thêm** trong hai hiệp phụ; null nếu không đá hiệp phụ |
| Tổng sau thi đấu | Hai hiệp chính + bàn tăng thêm hiệp phụ, đúng một lần |
| `homePenaltyScore`, `awayPenaltyScore` | Tổng lượt luân lưu thành công, riêng biệt; null nếu không có loạt hoàn tất |
| `winner_team_id` | Đội thắng dự kiến của kết quả `PENDING`; chưa phải suất đi tiếp chính thức |
| `score_source`, `finished_at` | Nguồn `EVENTS_V1` và thời điểm kết thúc thực tế |

Loạt sút lưu riêng khỏi sự kiện bàn thắng trong trận nên không vào hiệu số, vua phá lưới hoặc số bàn trận. Phạt đền trong hiệp vẫn dùng `PENALTY_GOAL`. Bỏ giới hạn kỹ thuật 99 không có căn cứ thi đấu; giữ kiểm tra số nguyên không âm trong phạm vi PostgreSQL integer.

Form Sau trận đọc tỷ số tổng hợp, không yêu cầu nhập lại. POST kết quả và duyệt biên bản kiểm tra lại sự kiện/pha/lượt sút trong khóa Match. Kết quả legacy không bị chuyển đổi hoặc đoán hiệp; thiếu lịch sử giai đoạn thì thao tác phụ thuộc phải đối chiếu có thẩm quyền.

## 3. API và dữ liệu

| API | Nội dung |
|---|---|
| GET `/matches/:matchId/shootout` | Workspace theo quyền xem trận, danh sách và điều kiện hiện tại |
| POST `/matches/:matchId/shootout/actions` | SETUP/KICK/RETAKE/CORRECT/VOID_LAST/ELIGIBILITY/REPLACE_KEEPER; expectedVersion, expectedClockVersion, operationId |
| GET `/matches/:matchId/referee-context` | Bổ sung shootout projection, dùng chung đội hình/tên cầu thủ thật |
| GET `/matches/:matchId/live-state` | Tỷ số từng giai đoạn và lượt sút; kết quả chính thức vẫn chỉ trả khi APPROVED |
| POST clock-actions / match-results | Giữ paths; kết thúc nguyên tử và validation theo nguồn sự kiện |

Migration Match **26**: [matchShootoutMigration.ts](../services/match-service/src/db/matchShootoutMigration.ts). Bảng `match_shootouts` giữ trạng thái canonical; `match_shootout_history` giữ phiên bản/thao tác và snapshot trước/sau, trigger cấm sửa/xóa audit. Thêm ba cột kết quả tương thích ngược, không sửa dữ liệu cũ; không thêm bảng sang database khác.

Nếu cần quay lại image trước: giữ nguyên dữ liệu và schema bổ sung, đánh giá thao tác ghi trên trận đã có shootout trước khi đổi code. Muốn phục hồi đối chiếu phải restore vào database mới, không restore đè dữ liệu người dùng.

## 4. Căn cứ luật

- [IFAB 2026/27, Luật 10](https://www.theifab.com/laws/latest/determining-the-outcome-of-a-match/): pool cuối trận, cân bằng số người, chu kỳ, lượt bổ sung, đá lại và thủ môn. Hiệp phụ theo điều lệ, mỗi hiệp không quá 15 phút. Chỉ áp dụng khi trận chọn đúng profile.
- [VFF 433/QĐ-LĐBĐVN ngày 22/08/2023, sách do VietFootball công bố](https://www.vietfootball.vn/public/tailieu/Lu%E1%BA%ADt%20thi%20%C4%91%E1%BA%A5u%20B%C3%B3ng%20%C4%91%C3%A1%207%20ng%C6%B0%E1%BB%9Di%20%28b%E1%BA%A3n%20in%20s%C3%A1ch%20final%29.pdf), trang in 42–45: hiệp phụ hai hiệp 10 phút nếu điều lệ chọn; quy trình luân lưu 7m. Không thay bằng văn bản 2001.
- [FIFA Futsal 2026/27](https://cdn4.sportngin.com/attachments/document/4be7-2198169/Futsal_Laws_of_the_Game_2026-2027_EN.pdf), hiệu lực 22/10/2026, trang in 68–71: dự bị được tham gia, giảm số người tùy chọn, hiệp phụ mỗi hiệp tối đa 5 phút. Bản tài liệu FIFA trên mirror; URL DFB trong baseline không truy cập được bằng web tool lượt này.

DECLARED_RULES chưa có quy trình shootout xác định thì chặn phụ thuộc, không lấy IFAB/futsal làm mặc định. Không thêm away-goals hoặc thể thức phân định mới.

## 5. Kiểm chứng và giới hạn

Các ca ghi nghiệp vụ chỉ chạy trên các bộ PostgreSQL phục hồi có prefix `sfl_prompt07_qa_`, qua Gateway/session Auth và router nghiệp vụ thật. Thời gian được điều khiển trong host QA qua IPC Node test timer; không thêm endpoint test hoặc nới giờ bắt đầu trong production.

Hai fixture hiệp phụ bổ sung chỉ tồn tại ở bản sao QA: seed Match/slot/Scheduling với đội và roster thật từ bản sao, dùng nguyên nguồn điều lệ hybrid đã công bố; sau đó thực hiện phân công, ghim bổ sung luật, đội trưởng gửi đội hình, trọng tài kiểm tra, START/chuyển hiệp/luân lưu bằng API. **Đây là kiểm thử API trên fixture QA có kiểm soát, không phải E2E sinh suất knockout từ kết quả vòng bảng được duyệt.** Không sửa snapshot điều lệ hoặc xác nhận kết quả giả để đưa đội đi tiếp.

Kết quả cuối: [QA API lượt 006](../output/match-operation-prompt-07/qa-api-006.json), **21 PASS, 0 FAIL**. Các lượt trước được giữ nguyên: 001 sai kỳ vọng HTTP 400/409 của harness; 003 fixture QA thiếu slot; 005 chờ mã trận trên kênh tổng hợp cố ý ẩn mã trận. Không nới validation/auth hoặc đổi kênh realtime production để làm test vượt qua.

| Nghiệp vụ / kiểm tra | Kết quả | Phạm vi thực tế |
|---|---|---|
| Vòng tròn, vòng bảng kết thúc hòa | PASS | API/PostgreSQL bản sao, đúng ALLOW_DRAW; chặn ET/shootout |
| Knockout thắng trong hai hiệp | PASS | Fixture/lịch sẵn có trong QA, FINISHED/PENDING; chưa đi tiếp |
| PENALTIES_ONLY, cấm ET trái phương thức | PASS | API trên bản sao giải knockout 7 người |
| EXTRA_TIME_THEN_PENALTIES, cấm bỏ hiệp | PASS | Hai fixture QA bổ sung, dùng bản điều lệ hybrid gốc; hiệp phụ 15+15 phút |
| Bàn ET cộng đúng một lần | PASS | 1–1 hiệp chính + 1–0 ET = 2–1 tổng; public live API cùng kết quả |
| Kết thúc sớm / lượt bổ sung | PASS | Loạt 3–0 kết thúc sớm; sau 5–5 thêm cặp 1–0 thành 6–5 |
| Dự bị không hợp lệ, lặp người, cân bằng | PASS | API IFAB/VFF; unit pool futsal không bằng nhau và chu kỳ độc lập |
| Futsal từng lượt qua API với hai pool khác số lượng | NOT TESTED | Projection/unit PASS; chưa tạo fixture futsal cần phân định qua luân lưu trong lượt API này |
| Thẻ trong luân lưu | PASS | Vàng trong trận không cộng sang loạt; vàng thứ hai trong loạt truất quyền; cần cập nhật pool trước ghi tiếp |
| Thay thủ môn / kế thừa chu kỳ | PASS có phạm vi | API IFAB: dự bị chưa dùng, thủ môn đã sút; người mới không được sút ngay trong chu kỳ đó. Chưa nghiệm thu mọi ngoại lệ thủ môn |
| Đính chính / đá lại / chặn sau có đội thắng | PASS | API, audit append-only, replay, version; không xóa lịch sử |
| Double-click / retry / phiên bản cũ | PASS | Hai request cùng thao tác trả cùng version và một lượt; dữ liệu khác/stale bị chặn |
| READ ghi / capability / tài khoản ngoài tổ | PASS | API READ-only từ chối ghi; kiểm tra quyền hiện tại theo Scheduling lease |
| SSE chỉ phát sau commit | PASS | Kênh đúng trận; một update cho request retry, lỗi không tạo update; kênh tổng hợp vẫn redacted |
| Reload / restart giữa loạt | PASS | Restart PID host QA, đọc lại đúng toàn bộ attempt/version/next state |
| FINISHED chưa cập nhật BXH/nhánh | PASS | So sánh standings và slot; kết quả PENDING, actual end và clock dừng |
| Frontend panel và hợp đồng thao tác | PASS component | Chỉ PENALTIES; READ không có công cụ; chọn người gửi API với hai version + operation ID; không nhập tổng penalty để vượt gate |
| Trình duyệt thao tác luân lưu đầy đủ / mobile | NOT TESTED | Trận chính thức chưa thi đấu; tab browser tích hợp mở ở trạng thái chưa đăng nhập. Không tạo dữ liệu live để chụp hình |
| Match tests | PASS | [Log cuối](../output/match-operation-prompt-07/backend-tests-final.log): **255 PASS, 0 FAIL, 34 SKIP**, tổng 289 |
| Frontend tests | PASS | [Log cuối](../output/match-operation-prompt-07/frontend-tests-last.log): **36 PASS**, 0 FAIL |
| Typecheck / production build | PASS | [Typecheck](../output/match-operation-prompt-07/typecheck-final.log), [workspace build](../output/match-operation-prompt-07/build-release.log), [web build cập nhật nhãn](../output/match-operation-prompt-07/web-build-stage-labels.log); cảnh báo Vite chunk lớn còn tồn tại |
| Docker / health / nguồn code | PASS | 9 running / 8 healthy; migration 26; bốn compiled hashes và bundle HTTP khớp local |
| Bất biến tuyệt đối mọi cột database trong lúc hệ thống chạy | FAIL kiểm tra nghiêm ngặt | Ba bảng Tournament đổi fingerprint; đã đối chiếu và phân loại riêng ở mục 7, không restore đè |

SKIP không được tính PASS. Trạng thái luật/gate và giao diện thiếu quy tắc được kiểm tra bổ sung bằng unit test; không gọi là E2E đầy đủ.

## 6. File và checkpoint

[Danh mục đầy đủ 39 đường dẫn thay đổi trong Prompt 7](../output/match-operation-prompt-07/source-preservation.json). Các nhóm chính:

| Nhóm | File |
|---|---|
| Projection tỷ số / lượt sút | [matchOutcome.ts](../packages/shared/src/matchOutcome.ts), [matchOperationRules.ts](../packages/shared/src/matchOperationRules.ts), shared index |
| Lưu trữ và kết thúc | [matchShootoutRepository.ts](../services/match-service/src/repositories/matchShootoutRepository.ts), [matchOutcomeRepository.ts](../services/match-service/src/repositories/matchOutcomeRepository.ts), clock/result/lineup repositories, validation và services liên quan |
| API / migration | [matchShootoutController.ts](../services/match-service/src/controllers/matchShootoutController.ts), routes/context/live-state controllers, [migration 26](../services/match-service/src/db/matchShootoutMigration.ts) và migrate runner |
| Giao diện | [RefereeShootoutPanel.tsx](../apps/web-client/src/components/referee/RefereeShootoutPanel.tsx), [RefereeOperationPage.tsx](../apps/web-client/src/components/referee/RefereeOperationPage.tsx), helper clock actions, CSS, chi tiết/biên bản và live panel dùng đúng tổng tỷ số |
| Hợp đồng client | [matchShootout.ts](../apps/web-client/src/api/matchShootout.ts), refereePortal/competition types |
| Kiểm thử / tài liệu | Unit Match, component tests, bốn script checkpoint/backup/QA tái sử dụng, baseline và rules matrix |

HEAD không đổi. Đã kiểm tra **43 file có thay đổi từ trước nằm ngoài phạm vi P7 đều giữ nguyên hash**, không có file trước checkpoint bị mất. Script triển khai dùng một lần được lưu trong [implementation-tools](../output/match-operation-prompt-07/implementation-tools/); không thay bộ test/fixture cũ.

[Checkpoint cuối](../output/match-operation-prompt-07/checkpoint-final/manifest.json) chứa source của toàn bộ 128 đường dẫn chưa commit, kèm working/index patch và SHA-256. Checkpoint sau triển khai trước đó cũng được giữ nguyên. Đây là checkpoint bảo toàn working tree, không phải commit gộp các thay đổi có trước. Đã kiểm tra whitespace bằng git diff --check.

## 7. Docker chính thức và bảo toàn dữ liệu

- Địa chỉ: [hệ thống chính thức 5173](http://localhost:5173/referee), [trang tác nghiệp hiện có](http://localhost:5173/referee/matches/8b8a61e2-4b83-4c8c-962e-580b4a594106/operation).
- [Release proof cuối](../output/match-operation-prompt-07/release-summary-final.json): chỉ rebuild/recreate Match và web; **9 running / 8 healthy**. Match image `f42351fc48b28c361185b15003841363dcac16ba9de4b2e40e52db64c5b6955c`; web image `6d2c02f601180a3b4676e807aebec16f4ea6c1e58459c91ed5fce9b6b5eb461b`.
- Bundle `/assets/index-C7Egt5fF.js`, SHA256 `a1fdc216c7901ef31a4913546fbbde48e5af2891c764c712ade0f8c4d0652eea`, khớp build local. Bốn file biên dịch cốt lõi trong container khớp hash source build.
- [Runtime proof cuối](../output/match-operation-prompt-07/official-runtime-proof-final.json): migration 26; clock history chính thức vẫn **0**; bảng shootout và history **0 dòng**; trận tương lai vẫn SCHEDULED/NOT_STARTED v0, không có lineup giả. API chưa đăng nhập 401, tài khoản ngoài tổ 403. Số fixture ba thể thức vẫn 12 / 15 / 31.
- Kiểm tra hash tuyệt đối ban đầu [không PASS](../output/match-operation-prompt-07/official-runtime-proof.json): `tournament_player_participation_claims`, `tournament_registration_reservations`, `tournament_workflow_state` đổi fingerprint trong lúc kiểm tra hệ thống đang hoạt động.
- Phục hồi **riêng Tournament vào database audit mới**, so sánh chỉ đọc với backup: [audit](../output/match-operation-prompt-07/background-update-audit.json) xác định claims/reservations chỉ đổi `updated_at`; workflow đổi `updated_at`/`current_step`. [Delta điều hướng](../output/match-operation-prompt-07/navigation-delta.json) ghi nhận HCMC từ bước đang xem 7 sang 6, cùng actor cũ. Không đủ bằng chứng quy người/tiến trình ghi; không tự hoàn tác lựa chọn giao diện này.
- Kiểm chứng cuối so sánh lại các cột nghiệp vụ với backup: **các cột khác của ba bảng trên và toàn bộ bảng cũ còn lại không đổi**, trừ ledger migration dự kiến. Không sửa nội dung điều lệ, đội, roster, lịch, phân công, trạng thái trận/kết quả để làm test vượt qua. Không tuyên bố mọi cột hoàn toàn bất biến.

Chạy lại bằng Compose hiện có:

```powershell
docker compose --profile apps config --quiet
docker compose --profile apps build match-service web-client
docker compose --profile apps run --rm --no-deps match-migrate
docker compose --profile apps up -d --no-deps match-service web-client
docker compose ps
```

**Dừng đúng Prompt 7. Không triển khai Prompt 8–10.**

### Chưa nghiệm thu ngoài phạm vi

- Quy trình công nhận/đính chính biên bản đầy đủ thuộc Prompt 8; án treo giò/tích lũy/xóa thẻ thuộc Prompt 9.
- Ngoại lệ không còn người nào đủ điều kiện luân lưu, thủ môn chấn thương đúng lúc quả đá lại đang chờ, quyết định đình chỉ hoặc loạt không thể tiếp tục: cần xử lý có thẩm quyền; không tự xử thua hoặc chọn đội thắng.
- Chưa nghiệm thu thao tác luân lưu trực tiếp trên điện thoại và nhiều browser đang thi đấu thật. Không bắt đầu trận tương lai để tạo ảnh giao diện.
