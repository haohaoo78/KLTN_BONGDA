# Nghiệm thu Bước 5 chính thức — 25/11/2026

## Truy cập

- [DEMO IUH League 2026 — đã công bố 12 lịch](http://localhost:5173/btc?manageTournament=248006af-5af3-4ff5-8486-47b80fc269b9).
- [DEMO Student Knockout Cup 2026 — xem giao diện 15 trận](http://localhost:5173/btc?manageTournament=d9fe5a04-5e71-41ec-b85c-f4567b294c68).
- [DEMO HCMC Student Champions Cup 2026 — xem giao diện 31 trận](http://localhost:5173/btc?manageTournament=9f765a91-b8ab-4716-a083-0cf8a113db1b).
- BTC quản lý: `dataset.btc01@football.local`, dùng thông tin đăng nhập hiện có. Không tạo hay đổi tài khoản/mật khẩu.
- [Thư viện ảnh trình duyệt thực tế](./gallery.html), [CSV lịch đã công bố](./final-lich-thi-dau-demo-iuh-league-2026.csv), [PDF từ lịch đã lưu](./business-schedule.pdf).

Sau tải lại giải IUH, luồng tiến trình hiện có có thể mở Bước 6 vì lịch đã công bố. Bấm **Lập lịch thi đấu → Kiểm tra & công bố** để xem trạng thái chính thức. Không triển khai hoặc thiết kế lại Bước 6.

## Kết quả thực tế

| Phần kiểm tra | Kết quả | Bằng chứng/phạm vi |
| --- | --- | --- |
| Công đoạn 1 — Sân & thời gian | PASS | Trình duyệt tạo hai sân thật, lưu khả dụng 08:00–14:00 ngày 01–07/12, xác nhận khả dụng; reload còn đúng cấu hình. |
| Công đoạn 2 — Điều kiện thi đấu | PASS | Lấy điều lệ thật, nghỉ đội 1.440 phút; một lần **Lưu và tiếp tục** lưu thành công; reload giữ dữ liệu. |
| Công đoạn 3 — Thủ công | PASS | Chọn trận → phương án hợp lệ → lưu → khóa → mở khóa → chỉnh sửa → lưu → khóa lại → reload. |
| Công đoạn 3 — Tự động | PASS | Hai lần preview COMPLETE: xếp 11 trận còn thiếu, giữ nguyên một trận đã khóa, tổng 12/12; hủy phương án không đổi database; lưu 12 DRAFT và reload. Không tự chuyển công đoạn. |
| Backend chặn dữ liệu sai | PASS | API thật trả 409 khi vừa mở khóa vừa đổi giờ, hoặc lưu lịch trùng; dữ liệu đã lưu giữ nguyên. Validator toàn bộ 12 lịch trả 0 lỗi trước công bố. |
| Công đoạn 4 — Kiểm tra & công bố | PASS | Công bố 12 PUBLISHED qua API thật; 11 khóa và một không khóa vẫn được công bố. Không yêu cầu trọng tài. Gọi lại trả publishedCount=0. |
| Reload và bảo vệ lịch chính thức | PASS | Sau đăng nhập phiên trình duyệt mới, 12 lịch và dấu công bố còn nguyên; nút công bố bị khóa; automatic-preview trả 409 PUBLISHED_SCHEDULE_IMMUTABLE. |
| In/PDF và xuất CSV | PASS | CSV chứa đủ 12 ID trận thật; PDF tạo từ trang kiểm tra bằng print media của Chrome; sau khi phát hiện lỗi popover cắt bảng, đã sửa riêng CSS in và kiểm tra lại đủ 12 hàng, 8 cột, một trang PDF. Đây là CSV, không phải XLSX. |
| Liên thông Bước 4 → 5 → 6 | PASS | Giữ nguyên 12 fixture/ID/cặp đấu của sơ đồ; Bước 6 mở và hiển thị 12/12 lịch chính thức, chưa có trọng tài. Chỉ kiểm tra đọc tại Bước 6. |
| UI ba thể thức và Bước 3/4 | PASS | Bundle cuối C6wyGf85: 69 ảnh trong runner chính; 21/19/19 kiểm tra theo thể thức, dữ liệu trước/sau không đổi, không lỗi JavaScript/API test. Mobile 390px không tràn ngang trong bốn công đoạn. |
| Xác thực/phân quyền | PASS trong phạm vi đã thử | Chưa đăng nhập: context 401. Tài khoản đội trưởng: context và sáu API lập lịch/ghi/công bố trả 403. |
| E2E ghi/công bố knockout và kết hợp | NOT TESTED | Hai giải này chỉ kiểm tra đọc/giao diện, không thay lịch/nguồn lực của người dùng. Thuật toán nguồn knockout UUID và ràng buộc có kiểm thử tự động riêng. |
| BTC khác không sở hữu giải | NOT TESTED | Chưa có phiên BTC độc lập thứ hai dùng cho phép thử quyền sở hữu. Không thay RBAC để chạy test. |
| Đối chiếu trực quan Step 5 tại cổng khôi phục | NOT TESTED | Môi trường 15173 vẫn chạy, nhưng giải ở đó chưa có bốc thăm/sơ đồ công bố và không có fixture; tài khoản BTC được tài liệu hóa trả 401. Không ghi dữ liệu hay thay tài khoản của môi trường khôi phục. Đã đối chiếu source/CSS checkpoint riêng. |

### Bằng chứng kiểm thử

- [Tổng hợp bốn công đoạn: 27 kiểm tra nghiệp vụ PASS](./business-summary.json).
- [QA trình duyệt cuối trên bundle đang triển khai](./final-readonly-browser-results.json), [tab chi tiết sơ đồ và bản in](./final-diagram-browser-results.json).
- [So sánh source/CSS với checkpoint](./static-ui-checkpoint-comparison.json); phần CSS in là ngoại lệ sửa lỗi có ghi rõ.

- [Thiết lập hai công đoạn đầu](./ui-setup-business-results.json).
- [Thủ công và khóa/mở khóa](./business-manual-results.json).
- [Tự động, hủy preview, lưu và reload](./business-automatic-results.json).
- [Công bố, idempotency, bảo vệ lịch và xuất dữ liệu](./business-publish-results.json).
- [Tiếp tục kiểm tra reload và danh sách Bước 6](./business-publish-reload-results.json).
- [Phân quyền API ghi](./rbac-mutations.json), [context ba thể thức và xác thực](./api-readback.json).
- [38 kiểm thử thuần, typecheck và production build](./monorepo-build-summary.json); [2 kiểm thử PostgreSQL biệt lập](./isolated-postgres-results.json).
- [Checkpoint, worktree, backup và fixture được bảo toàn](./preservation-audit.json).
- [Image/container/build context](./docker-deployment.json), [HTTP health và bundle đang phục vụ](./http-health.json).

Lượt runner công bố đầu tiên có `status: FAIL` sau tám kiểm tra đã PASS vì runner đợi workspace Bước 5 ngay sau reload, trong khi tiến trình hiện có mở Bước 6. Runner chỉ đọc tiếp theo đã kiểm tra đủ ba mục còn lại và PASS. Một lượt runner thủ công trước đó dừng do selector ô ghi chú; chạy lại trên dữ liệu đã lưu đã PASS. Các file failure được giữ làm lịch sử; không tính lỗi selector của runner là lỗi sản phẩm hoặc sửa JSON gốc thành PASS.

## Phần được giữ nguyên

- Workspace từ checkpoint `788015c`, bốn công đoạn, ba chế độ xem và các component con, form bên phải, trợ lý, lọc, khóa/mở khóa, in và xuất dữ liệu.
- CSS màn hình Bước 5 và bố cục chuẩn khôi phục. Có sửa riêng `@media print` để bảng không bị popover cắt và bỏ trang trắng khi in; không thay layout màn hình. Controller có tên `OfficialScheduleWorkspace` chỉ điều phối dữ liệu rồi render workspace khôi phục; không dùng giao diện chính thức cũ làm nền.
- UI và thuật toán Bước 3/4 đã được xác nhận; không sinh lại cặp đấu. Fixture trước và sau toàn bộ kiểm thử IUH giống nhau.
- Nút Đóng/Mở đăng ký, tài khoản, quyền, dữ liệu cũ, môi trường khôi phục và backup.

## API và dữ liệu nghiệp vụ

Xem [tài liệu tích hợp](../STEP5_SMART_SETUP.md) để biết đầy đủ API.

- Context/fixture/điều lệ từ API chính thức. Giải kết hợp cần đủ GROUP và KNOCKOUT đã công bố.
- Setup-analysis, manual-candidates, validate, resources/preview và automatic-preview đều qua Match Service chính thức.
- Lưu nguồn lực dùng revision; lịch nháp dùng chữ ký phiên bản và transaction. Khóa và công bố là hai trạng thái riêng.
- `sfl_scheduling`: venues, tournament_schedule_resources, schedules, schedule_change_history. `sfl_match`: metadata thời gian/trạng thái của các trận đã có.
- Migration bổ sung **1008** thêm notes và slot_id; đã sao lưu toàn bộ PostgreSQL trước khi chạy. Không reset hoặc xóa volume.
- Preview chưa áp dụng ở React state; bản nháp đã lưu ở PostgreSQL. API lỗi hiển thị nguyên nhân, không chuyển sang snapshot/mock.
- Luồng chính thức không gọi `/schedules/engine/test/...` hoặc `/schedules/test-workflow/...`. Mã kiểm thử và checkpoint vẫn được giữ riêng.

### Lỗi cụ thể đã sửa

1. UI chính thức trước đó không dùng đầy đủ workspace khôi phục; đã chuyển sang render nguyên workspace và truyền bridge API chính thức.
2. Lần lưu nguồn lực đầu gửi revision 0 thay vì null; đã sửa hợp đồng CAS lần tạo mới, không bỏ kiểm tra phiên bản.
3. Tự lấy toàn bộ sân danh mục làm sân của giải; hiện chỉ sân BTC khai báo/chọn mới được gán.
4. Lệch giờ do Docker UTC; chuẩn hóa giờ Việt Nam ở biên API/database.
5. Nhãn vòng/lượt và nguồn knockout UUID chưa phù hợp adapter; chuẩn hóa projection, giữ nguyên ID và nguồn trận.
6. Vòng cuối của cả hai lượt bị gom đồng giờ và planner xếp lẫn lượt/vòng; sửa đúng thứ tự lượt → vòng, chỉ đồng giờ vòng cuối lượt cuối, thêm validator GROUP_ROUND_ORDER và test hồi quy.
7. Thông báo làm unmount workspace và mất preview; callback thông báo nay giữ workspace đang thao tác.
8. Thông báo lỗi 409 chung che nguyên nhân thiếu cấu hình; giữ thông điệp nghiệp vụ lập lịch thực tế.
9. Bảo đảm lưu nguyên tử, giữ notes/slot/khóa, chặn sửa lịch chính thức và công bố idempotent; không giả lập thành công.
10. Bản in bị popover 42px cắt bảng và workspace ẩn tạo thêm trang trắng: sửa riêng CSS print, bản in đủ 12 hàng và 8 cột trong một trang. CSS màn hình giữ nguyên checkpoint.

## File thay đổi trong tác vụ Bước 5

Các file đã có thay đổi từ nhiệm vụ trước được bảo toàn; danh sách này chỉ nêu phần tích hợp Bước 5:

- Frontend: [OfficialScheduleWorkspace.tsx](../../apps/web-client/src/components/OfficialScheduleWorkspace.tsx), [DrawDemoScheduleWorkspace.tsx](../../apps/web-client/src/components/DrawDemoScheduleWorkspace.tsx), [DrawDemoScheduleSettingsPanel.tsx](../../apps/web-client/src/components/DrawDemoScheduleSettingsPanel.tsx), [Step5SchedulePrintPreview.tsx](../../apps/web-client/src/components/Step5SchedulePrintPreview.tsx), [BtcTournamentWorkspace.tsx](../../apps/web-client/src/components/BtcTournamentWorkspace.tsx), [competition.ts](../../apps/web-client/src/api/competition.ts), [client.ts](../../apps/web-client/src/api/client.ts), [schedule-setup.css — chỉ media print](../../apps/web-client/src/components/schedule-setup.css).
- Match Service: [schedulingEngineController.ts](../../services/match-service/src/scheduling/controllers/schedulingEngineController.ts), [schedulingRoutes.ts](../../services/match-service/src/scheduling/routes/schedulingRoutes.ts), [scheduling model](../../services/match-service/src/scheduling/models/scheduling.ts), [schedulingRepository.ts](../../services/match-service/src/scheduling/repositories/schedulingRepository.ts), [schedulingService.ts](../../services/match-service/src/scheduling/services/schedulingService.ts), [migrate.ts](../../services/match-service/src/db/migrate.ts).
- Shared: [automaticSchedulePlanner.ts](../../packages/shared/src/automaticSchedulePlanner.ts), [scheduleConstraintValidation.ts](../../packages/shared/src/scheduleConstraintValidation.ts).
- Tests: [officialScheduling.test.cjs](../../services/match-service/tests/officialScheduling.test.cjs), [officialScheduleDraft.integration.test.cjs](../../services/match-service/tests/officialScheduleDraft.integration.test.cjs), [schedulingEngine.test.cjs](../../services/match-service/tests/schedulingEngine.test.cjs).
- Tài liệu và bằng chứng tại thư mục này; không chỉnh CSS màn hình hoặc thiết kế Bước 6 trong tác vụ.

## Docker đã chạy và cách chạy lại

Cổng chính thức **5173**, project `student-football-league`, build context `T:\DO AN\BONG DA`. Web đang phục vụ `index-C6wyGf85.js`, CSS `index-Ch64zp9Y.css`. Match image `cfa727c567fd…`, Web image `25b54042779b…`. Chín container runtime/infrastructure đều running; tám container có healthcheck đều healthy, Web không khai báo Docker healthcheck nhưng HTTP 200. Cổng khôi phục 15173 giữ bundle `index-DZeovdeQ.js`.

Các lệnh đã dùng để build/khởi động phần thay đổi (chạy tại root dự án, giữ `.env` hiện có):

```powershell
corepack pnpm run typecheck
corepack pnpm run build
docker compose --profile apps config --quiet
docker compose --profile apps build match-service web-client
docker compose --profile apps run --rm --no-deps match-migrate
docker compose --profile apps up -d --no-deps match-service web-client
```

Migration đã áp dụng có version guard, không chạy seed. Không dùng down -v/reset/xóa image. Backup trước thay đổi: [backup-before-step5-official-20261125-001.sql](../../backup-before-step5-official-20261125-001.sql), được giữ nguyên (5.752.014 byte; chưa thử restore SQL).

## Giới hạn còn lại

- E2E ghi/công bố mới thực hiện trên giải IUH dành kiểm thử; knockout/kết hợp kiểm tra API đọc, giao diện và test thuật toán, chưa công bố lịch trên hai giải này.
- Planner tìm kiếm có giới hạn thời gian. Preflight với hai sân 08:00–22:00 từng TIMEOUT 10/12; với giờ khả dụng thực tế 08:00–14:00 và ưu tiên hoàn thành giải sớm, luồng trình duyệt đã COMPLETE 12/12, giữ nguyên điều lệ nghỉ 1.440 phút. Không coi TIMEOUT là chứng minh vô nghiệm hoặc báo thành công đủ trận.
- Ghi metadata Match và Scheduling nằm ở hai database: có transaction từng database và bù trừ lỗi thông thường, chưa kiểm thử kill tiến trình giữa hai commit. Không khẳng định distributed atomic commit.
- Máy in vật lý và renderer PDF độc lập chưa kiểm thử; bản PDF bàn giao được tạo bằng Chrome A4 ngang, một trang, 54.131 byte. Ảnh print-media cho thấy đủ tám cột và 12 hàng.
- Cảnh báo build: bundle JS lớn hơn 500 kB. Không phải lỗi build, chưa tối ưu bundle trong tác vụ này.
- Kiểm tra trực quan cổng khôi phục và quyền BTC khác chưa thực hiện được như bảng trên. Chưa tuyên bố toàn hệ thống production-ready.

Dừng tại đây để BTC nghiệm thu; không phân công trọng tài, triển khai thêm Bước 6 hoặc thay dữ liệu hai giải còn lại.



