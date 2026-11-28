# 04 – Khoảng trống và việc cần tiếp tục

## Chưa đạt yêu cầu kiến trúc

1. **Bước 3 còn nghiệp vụ trong React.** `DrawDemoAllocationWorkspace.tsx` thực hiện random, seed placement, giới hạn cùng trường, validate slot và điều khiển một phần buổi lễ. Cần chuyển calculation/validation sang Tournament Service hoặc package shared chạy ở service, rồi dùng API trong UI.
2. **Bước 4 test fixtures còn sinh ở browser.** `apps/web-client/src/utils/drawDemoFixtures.ts` tự sinh Berger/Round Robin, nguồn knockout và mã fixture. Cần chuyển sang Match Service/shared generator; chỉ lưu snapshot kết quả server trả về. Các fixture official hiện có service/backend khác nhưng chưa được chứng minh là cùng implementation với test path.
3. **Một số Bước 5 còn song song.** Automatic schedule/referee preview và candidate selection gọi backend/shared APIs, nhưng cấu hình, hiển thị, một phần validation/thống kê và thao tác tương tác còn nằm trong React. Cần bảo đảm mọi quyết định dùng để apply/publish được xác thực lại qua Match Service và loại bỏ validator client khỏi nguồn quyết định.
4. **Legacy persistence chưa được gom.** `tournament_draw_test_configs`, draw workflow draft/live session và snapshot mới cùng tồn tại. Cần đánh giá dữ liệu hiện hành, tương thích và kế hoạch chuyển đổi trước khi xóa bảng/API cũ; không được xóa ở giai đoạn chuẩn hóa này.
5. **Trạng thái cross-service.** Tournament và Match snapshot là hai transaction độc lập. Khi diagram version đổi, Match trả snapshot stale; chưa có event/outbox tự động reset mọi downstream test state. Cần thêm luồng invalidation có idempotency hoặc tiếp tục buộc client tải lại và xử lý stale.
6. **Reset đồng thời nhiều tab.** Save có CAS; DELETE hiện idempotent nhưng không có tombstone revision. Reset đồng thời với một tab chưa từng có snapshot có thể gặp first-write race. Nên bổ sung tombstone/revision hoặc reset token trước khi coi reset đa tab là hoàn chỉnh.
7. **Realtime lịch official sau commit.** Match event được ghi trong Match DB sau scheduling commit. Đây là boundary đúng hơn việc dùng nhầm pool nhưng chưa có outbox transactional giữa hai DB; log event thất bại thì lịch đã commit. Cần outbox/retry nếu yêu cầu đảm bảo giao sự kiện.
8. **Quyền public snapshot lịch.** Public endpoint chỉ trả lịch test đã publish và diagram còn khớp; chưa chạy E2E kiểm tra đồng nhất với middleware visibility của Tournament detail trên nhiều vai trò.
9. **Bước 6–8.** Theo yêu cầu giai đoạn này chỉ chuẩn hóa phần đã có; state test của referee/operations/results chưa được chuyển toàn bộ sang server snapshots và chưa có kiểm thử end-to-end.

## Lỗi kiểm thử đang biết

- Hai test DB ngoài Bước 3–5 đã fail trong run rộng: discipline outbox không tạo card kỳ vọng; match report review báo `REPORT_NOT_FOUND`. Xem output trong log tạm của phiên chạy và bảng ở `03_TEST_RESULTS.md`. Cần điều tra riêng trong phạm vi kỷ luật/điều hành.
- Web bundle phát cảnh báo kích thước chunk; build vẫn thành công. Có thể tách code theo route/component sau, không ảnh hưởng nghiệp vụ.
- Không xác nhận được Docker runtime dùng image mới. Không coi service health 200 là bằng chứng deploy.

## File thay đổi trong phần chuẩn hóa này

- Gateway/API: `apps/api-gateway/src/index.ts`.
- Frontend adapter/view: `apps/web-client/src/api/testWorkflow.ts`, `apps/web-client/src/utils/drawTestStorage.ts`, `apps/web-client/src/components/BtcTournamentWorkspace.tsx`, `apps/web-client/src/components/TournamentDetailPanel.tsx`, `apps/web-client/src/components/DrawDemoFixtureWorkspace.tsx`, `apps/web-client/src/components/DrawDemoAllocationWorkspace.tsx`, `apps/web-client/src/components/DrawDemoScheduleWorkspace.tsx`.
- Tournament snapshot: `services/tournament-service/src/db/migrate.ts`, `services/tournament-service/src/repositories/drawTestSnapshotRepository.ts`, `services/tournament-service/src/services/drawTestSnapshotService.ts`, `services/tournament-service/src/controllers/drawWorkflowController.ts`, `services/tournament-service/src/routes/tournamentRoutes.ts`.
- Match snapshot and authority checks: `services/match-service/src/db/migrate.ts`, `services/match-service/src/scheduling/repositories/testSnapshotRepository.ts`, `services/match-service/src/scheduling/controllers/schedulingEngineController.ts`, `services/match-service/src/scheduling/routes/schedulingRoutes.ts`.
- Realtime DB boundary correction: `services/match-service/src/realtime/matchRealtime.ts`, `services/match-service/src/scheduling/repositories/schedulingRepository.ts`.
- Tests: `services/tournament-service/tests/drawTestSnapshot.integration.test.cjs`, `services/match-service/tests/scheduleTestSnapshot.integration.test.cjs`, and `apps/web-client/scripts/automaticRefereePlanner.test.mjs`.
- Documentation: `docs/TEST_DATA_ARCHITECTURE.md`, `docs/system-architecture-audit/`.

## Trình tự khuyến nghị trước khi nghiệm thu

1. Build và triển khai services/Gateway/Web vào môi trường DEV hiện tại, không chạy seed hoặc reset.
2. Dùng manager thật gọi GET/PUT/DELETE snapshot qua Gateway; kiểm tra role sai, tournament không thuộc BTC và production gate trả kết quả từ chối.
3. Bằng UI, tạo allocation test, publish Step 3–4, đổi fixture/version giả lập hợp lệ, rồi xác nhận Match từ chối snapshot stale; reload và mở actor viewer để xác minh chỉ dữ liệu publish xuất hiện.
4. Bằng Bước 5, lưu/reload lịch, cạnh tranh hai tab, publish snapshot test và reset; xác minh bản official trong database không đổi.
5. Chuyển allocation/fixture generator sang service/shared và gom test persistence legacy trước khi đánh dấu kiến trúc “thống nhất hoàn tất”.
