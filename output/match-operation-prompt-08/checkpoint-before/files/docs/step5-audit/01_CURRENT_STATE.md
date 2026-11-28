# Bước 5 – Kiểm kê hiện trạng

Ngày kiểm kê: 22/11/2026. Phạm vi là source hiện tại, tài liệu có trong repository và giao diện localhost đang mở. Đây là báo cáo kiểm kê, không phải xác nhận production-ready.

## Tóm tắt

Bước 5 hiển thị dưới tên **Lập lịch thi đấu** và kế thừa danh sách trận đã công bố ở Bước 4. Hiện có hai đường chạy khác nhau:

1. **Chế độ test cục bộ**: `DrawDemoScheduleWorkspace` dùng sơ đồ Bước 4 trong `localStorage`; lập lịch thủ công/tự động, kiểm tra, reset và công bố đều là thao tác trình duyệt. Không ghi DB. Đây là giao diện thiết kế lại có nhiều khả năng hơn.
2. **Chế độ nghiệp vụ API**: `ScheduleManagementPanel` gọi API Match/Scheduling thật, nhưng vẫn là màn hình quản lý cũ dạng form và danh sách. Nó không dùng chung toàn bộ workspace, lịch biểu và planner cục bộ.

Điều kiện chọn nhánh được đặt tại [BtcTournamentWorkspace.tsx](../../apps/web-client/src/components/BtcTournamentWorkspace.tsx): khi `drawTestEnabled` và trạng thái giải nằm trong `ROSTER_LOCKED`, `PREPARING`, `IN_PROGRESS`, `PAUSED`, bước 5 render workspace local; trường hợp khác render `ScheduleManagementPanel` mode `venues`. Bước 6 tương tự nhưng mode `referees`. Vì thế kết quả audit của UI phụ thuộc **origin, trạng thái giải và cờ test**, không chỉ phụ thuộc tài khoản BTC.

## Bằng chứng quan sát tại thời điểm audit

Trang BTC đang chia sẻ: giải **Seed 1 mở rộng — Vòng tròn · 12 hồ sơ / tối đa 8 / tối thiểu 4 · Kịch bản mới**, ID `95f79e55-e6f0-5177-a2e2-d9fe62760dcd`, origin `localhost:5173`.

- Stepper hiển thị đủ 8 bước; bước 4 hoàn thành, bước 5 đang thực hiện, bước 6–8 khóa.
- Bước 5 ghi rõ dữ liệu kiểm thử cục bộ; 12 fixtures từ Bước 4, 8 đội chính thức, 2 bảng, 1 lượt.
- Thống kê tại lúc quan sát: 12 trận, 0 đã lập lịch, 12 chưa lập lịch, 0 sân phù hợp hoạt động.
- Hướng dẫn thông minh: “Thêm sân phù hợp để bắt đầu”; công suất lý thuyết 0 giờ sân so với nhu cầu sơ bộ 20 giờ sân.
- Sơ đồ có 2 card bảng A/B, bộ lọc, zoom/toàn màn hình; bên cạnh là panel chi tiết chưa chọn trận.
- Không có lịch fixture nào được tìm thấy trong snapshot localStorage của giải này; state hiện tại không phải bằng chứng cho lần kiểm thử khác ở origin khác.

Chi tiết bố cục và ảnh chụp trạng thái bằng accessibility snapshot nằm tại [02_UI_UX.md](./02_UI_UX.md). Công cụ browser trả ảnh nhưng không có cơ chế lưu ảnh trả về thành file trong workspace; do đó thư mục `screenshots/` chưa có ảnh và báo cáo dùng wireframe văn bản.

## Bản đồ chức năng và mức hoàn thiện

| Chức năng | Thực thi hiện tại | Dữ liệu | Mức đánh giá | Giới hạn chính |
|---|---|---|---|---|
| Nạp sơ đồ đầu vào | Test đọc fixtures/published allocation từ draw test state; lấy danh sách đội đủ điều kiện qua API `getDrawManagement`. API mode tải trận/lịch thật. | API đọc + localStorage hoặc API/DB | Hoạt động theo từng nhánh | Không có một adapter thống nhất cho cả hai nhánh. |
| Cấu hình sân/thời gian | Modal thêm/sửa sân, ngày hoạt động, khung giờ, ngày nghỉ, timing, ràng buộc. | localStorage ở workspace mới; API cũ ở nhánh thật | UI và logic test hoạt động | Không chứng minh việc đặt sân ngoài đời; chưa ghi vào DB ở mode mới. |
| Lập lịch thủ công | Sơ đồ → drawer bên phải → ngày/sân/giờ hợp lệ → lưu. | localStorage | Đã có logic client | Danh sách ứng viên không xếp hạng theo “tốt nhất”; thiếu test E2E đa dạng. |
| Lập lịch tự động | Phạm vi/mục tiêu → bounded DFS/backtracking → preview một phần/toàn phần → áp dụng vào draft chung. | localStorage | Đã có thuật toán client | Giới hạn tìm kiếm có thể không tìm ra nghiệm; không phải solver tối ưu toàn cục. |
| Kiểm tra lịch | Validator dùng chung cho manual, auto, sửa, cụm cuối và công bố test. | localStorage | Đã có code | Một số constraint chỉ có nếu cấu hình bật; chưa có chứng cứ tất cả luật từ điều lệ được map đầy đủ. |
| Khóa/mở khóa/xóa lịch nháp | Theo từng fixture; lịch công bố readonly. | localStorage | Đã có code | Chưa thấy chức năng khóa hàng loạt. |
| Công bố lịch | Kiểm tra đủ trận, validator và snapshot; lưu phiên bản local, chuyển Bước 6. | localStorage/BroadcastChannel | Mô phỏng trình duyệt | Không phải công bố chính thức, không bảo đảm liên máy/actor khác origin. |
| API scheduling thật | Tạo, kiểm tra xung đột, sửa/công bố/hủy lịch theo từng match; backend Match/Scheduling sở hữu persistence. | API + DB | Đang có nghiệp vụ nền cũ | Giao diện không phải workspace mới; công bố hàng loạt có thể từng phần. |
| Đồng bộ sang Step 6 | Test dùng chung object `step5`, tách các field schedule/referee; API path dựa trên workflow/API. | localStorage hoặc API | Có hai cơ chế | State local cũ vẫn giữ trường lịch và referee trong cùng `step5`. |

## Kiến trúc thực tế liên quan

- Frontend: [DrawDemoScheduleWorkspace.tsx](../../apps/web-client/src/components/DrawDemoScheduleWorkspace.tsx), [DrawDemoScheduleSettingsPanel.tsx](../../apps/web-client/src/components/DrawDemoScheduleSettingsPanel.tsx), [DrawDemoAutomaticSchedulePanel.tsx](../../apps/web-client/src/components/DrawDemoAutomaticSchedulePanel.tsx), [DrawDemoFixtureWorkspace.tsx](../../apps/web-client/src/components/DrawDemoFixtureWorkspace.tsx).
- Logic thuần frontend: [scheduleConstraintValidation.ts](../../apps/web-client/src/utils/scheduleConstraintValidation.ts), [automaticSchedulePlanner.ts](../../apps/web-client/src/utils/automaticSchedulePlanner.ts).
- State test: [drawTestStorage.ts](../../apps/web-client/src/utils/drawTestStorage.ts).
- API/DB path cũ: [ScheduleManagementPanel.tsx](../../apps/web-client/src/components/ScheduleManagementPanel.tsx) gọi các API trong [competition.ts](../../apps/web-client/src/api/competition.ts); backend nghiệp vụ thuộc Match Service theo hướng dẫn dự án.

## Mốc tài liệu và giới hạn đối chiếu

Repository không có file SRS độc lập mang tên SRS; tài liệu yêu cầu chức năng gần nhất có [Usecase_da_chinh_sua_v2.md](../Usecase_da_chinh_sua_v2.md), cùng các tài liệu draw/scheduling và QA. Các prompt 1–8, 3B, 4B nguyên văn không được tìm thấy thành bộ tài liệu versioned trong `docs/`; vì vậy đối chiếu prompt cụ thể chỉ dựa vào yêu cầu được lưu trong hội thoại, trạng thái source và các ghi chú triển khai, không tuyên bố kiểm toán từng câu prompt được lưu trong repo.

Các ghi nhận lịch sử hiện hữu ở [PROJECT_STATUS_OVERVIEW.md](../PROJECT_STATUS_OVERVIEW.md) mục 5.46–5.49 và [DRAW_WORKSPACE_DEMO.md](../DRAW_WORKSPACE_DEMO.md) phải đọc như các mốc theo ngày/origin. Báo cáo này ưu tiên source và trình duyệt tại ngày audit; không mặc nhiên coi kết quả cũ là trạng thái hiện tại.
