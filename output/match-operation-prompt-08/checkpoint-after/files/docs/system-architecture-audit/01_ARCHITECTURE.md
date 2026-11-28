# 01 – Kiến trúc hiện trạng và thay đổi

## Kiến trúc ownership

| Thành phần | Trách nhiệm theo dự án | Liên quan đến thay đổi |
|---|---|---|
| Auth Service (`sfl_auth`, `sfl_user`) | Đăng nhập, danh tính, role | Gateway chuyển danh tính/role; không đổi auth hoặc SMTP |
| Organization Service (`sfl_team`) | Trường, CLB, đội, cầu thủ | Không truy cập trực tiếp từ thay đổi này |
| Tournament Service (`sfl_tournament`) | Giải, điều lệ, đăng ký, bốc thăm | Lưu snapshot test Bước 3–4; xác minh đội đủ điều kiện; cung cấp API nội bộ bản chia đã công bố |
| Match Service (`sfl_match`, `sfl_scheduling`, `sfl_discipline`) | Fixture, kết quả, lịch, sân, trọng tài, kỷ luật | Lưu snapshot test Bước 5 tại DB scheduling; kiểm tra lịch qua shared engine |
| Notification Service (`sfl_notification`) | Notification và SMTP thật | Không đổi cấu hình hoặc luồng email |
| API Gateway | Session, role forwarding, proxy | Cho phép public GET snapshot đã lọc; định tuyến draw-management sang Tournament và schedules sang Match |
| Web Client | UI và tương tác | Hydrate/cache snapshot, không còn coi localStorage là nguồn chuẩn cho manager/public state |

Không có service nào đọc trực tiếp database của service khác. Match Service gọi Tournament Service qua `TOURNAMENT_SERVICE_URL` và `INTERNAL_API_KEY` để xác thực diagram version và fixture đầu vào.

## Mô hình dùng chung và khác biệt test/production

- Component hiện có và shared validators/planners tiếp tục được dùng; API engine test chạy ở Match Service và gọi implementation trong `packages/shared`.
- Bản test tách bằng adapter snapshot trên server; các API test bị chặn trong production.
- Dữ liệu chính thức vẫn qua workflow nghiệp vụ hiện có và bảng chính thức; snapshot test không sửa các bảng đội, điều lệ, draw official, match hoặc schedule official.
- Việc kiểm soát API test không dựa riêng frontend: route yêu cầu BTC, Tournament Service kiểm tra quyền quản lý, Match Service gọi internal manager-access endpoint trước thao tác.

## Đã chuẩn hóa trong phạm vi này

1. Tournament Service có `tournament_draw_test_snapshots`, transaction/advisory lock, revision CAS và public projection bỏ dữ liệu riêng tư.
2. Match Service có `match_schedule_test_snapshots`, revision CAS và diagram version.
3. Với mọi thao tác tính/lưu Bước 5, Match Service tải sơ đồ Bước 4 đã công bố từ internal Tournament API rồi xác minh version và toàn bộ fixture trước khi chạy.
4. Manager hydration cần snapshot từ cả hai service; nếu tải lỗi thì báo lỗi, không âm thầm coi lịch rỗng.
5. Public detail khởi tạo rỗng, chỉ render dữ liệu đã publish qua API, không render cache của BTC khi API đang tải.
6. Event lịch sau commit được ghi trong Match database là nơi sở hữu realtime log; trước sửa, Scheduling repository gửi event bằng PoolClient của scheduling database làm rollback thao tác lịch.

## Chưa chuẩn hóa đầy đủ

- Phân bổ đội ngẫu nhiên/thủ công và sinh fixture demo còn logic ở `DrawDemoAllocationWorkspace.tsx` và `drawDemoFixtures.ts`.
- Một số component Bước 5 còn tự tính UI/validation cục bộ dù các API engine có sẵn; chưa có adapter thống nhất cho mọi thao tác.
- Giao diện test còn component/workspace riêng; chưa đạt yêu cầu một luồng UI hoàn toàn chung giữa data adapter test và production.
- Bước 6–8 mới được rà soát theo code hiện tại; chưa chuyển test state sang server trong giai đoạn này.
- Không thực hiện refactor toàn bộ service hoặc xóa API legacy vì có nguy cơ phá compatibility; cần migration từng endpoint với kiểm thử riêng.

## Bằng chứng source chính

- Tournament snapshot: `services/tournament-service/src/services/drawTestSnapshotService.ts`, `services/tournament-service/src/repositories/drawTestSnapshotRepository.ts`, `services/tournament-service/src/controllers/drawWorkflowController.ts`, `services/tournament-service/src/routes/tournamentRoutes.ts`.
- Match snapshot/API: `services/match-service/src/scheduling/controllers/schedulingEngineController.ts`, `services/match-service/src/scheduling/repositories/testSnapshotRepository.ts`, `services/match-service/src/scheduling/routes/schedulingRoutes.ts`.
- Shared scheduling rules: `packages/shared/src/scheduleConstraintValidation.ts`, `packages/shared/src/automaticSchedulePlanner.ts`, `packages/shared/src/refereeResourceValidation.ts`, `packages/shared/src/automaticRefereePlanner.ts`.
- Frontend adapter: `apps/web-client/src/utils/drawTestStorage.ts`, `apps/web-client/src/api/testWorkflow.ts`.
