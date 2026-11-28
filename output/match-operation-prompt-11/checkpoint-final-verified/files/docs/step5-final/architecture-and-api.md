# Kiến trúc và API Bước 5

## Ranh giới dịch vụ

Frontend `apps/web-client` gọi API Gateway `/api`; Gateway chuyển lịch tới Match Service. Match Service sở hữu lịch và snapshot test, kiểm tra vai trò BTC/quyền quản lý giải và gọi Tournament Service nội bộ để xác minh sơ đồ Bước 4, phiên bản và điều lệ. Các validator/planner dùng chung nằm trong `packages/shared`. Match Service không đọc trực tiếp database Tournament.

Snapshot test Bước 5 ở bảng `match_schedule_test_snapshots` thuộc `sfl_scheduling`, migration version 1005. Bản vẽ Bước 3–4 test thuộc Tournament Service/bảng `tournament_draw_test_snapshots`, migration 24. Hai dữ liệu tách khỏi bảng lịch và dữ liệu đội chính thức. Ghi snapshot dùng revision/CAS; test API bị tắt ở production và yêu cầu `SCHEDULING_TEST_API_ENABLED` ở môi trường phù hợp. `localStorage` là cache/hydration tương thích, không phải nguồn authoritative khi snapshot server có sẵn.

Các tuyên bố kiến trúc trên được đối chiếu source và tài liệu; lượt kiểm tra này chỉ xác thực trực tiếp một lần đọc/validate qua Gateway, không truy vấn DB trực tiếp để chứng minh toàn bộ transaction/ownership.

## API chính

| API | Mục đích | Bằng chứng trong lượt này |
|---|---|---|
| `GET /api/my/tournaments` | Giải BTC được phân công | PASS – trả danh sách 7 giải của tài khoản đã đăng nhập |
| `GET /api/tournaments/:id/draw-management/test-state` | Snapshot sơ đồ test Bước 4 | PASS – đọc 7 fixture KO và phiên bản sơ đồ |
| `GET /api/schedules/test-workflow/:tournamentId` | Snapshot Step 5 | PASS – revision 9, 0 lịch draft, 0 lịch khóa |
| `POST /api/schedules/engine/test/validate` | Validate snapshot stateless | PASS – 200, 5 issues, 0 warnings; revision không đổi |
| `GET /api/schedules/test-workflow/:tournamentId` không session | Kiểm tra bảo vệ manager read | PASS – 401 |
| `GET /api/schedules/test-workflow/:tournamentId/public` không session | Public projection | PASS – 200; không có draft, autoPreview hoặc fixture lịch công khai |
| `POST /api/schedules/engine/test/manual-candidates` | Sinh khung giờ thủ công | NOT TESTED |
| `POST /api/schedules/engine/test/automatic-preview` | Tính và lưu phương án giả lập | NOT TESTED – đây là thao tác ghi snapshot |
| `POST /api/schedules/engine/test/simulation/validate` | Kiểm tra phương án giả lập đã lưu | NOT TESTED |
| `PUT/DELETE /api/schedules/test-workflow/:tournamentId` | Lưu/khôi phục snapshot Step 5 | NOT TESTED |
| `POST /api/schedules/test-workflow/:tournamentId/publish` | Công bố sandbox và tạo hợp đồng Bước 6 | NOT TESTED |
| `GET /api/schedules/test-workflow/:tournamentId/public` | Projection lịch công khai test | NOT TESTED trong lượt này |

Không có OpenAPI schema được generate trong repo; route/controller là nguồn thực thi. Tài liệu routing là mô tả, không thay thế kiểm thử contract schema.

## Đối chiếu Prompt 9A – route và storage hiện hành

Các route được giữ nguyên khi thay layout; danh sách source hiện tại trong `services/match-service/src/scheduling/routes/schedulingRoutes.ts` gồm:

| API nhóm | Route | Vai trò |
|---|---|---|
| Danh mục sân | `GET/POST/PUT/DELETE /venues`, `GET /venues/:id` | Danh mục CRUD do Match Service sở hữu |
| Khả dụng sân | `GET /venues/:venueId/availability`, `POST/DELETE /venue-availability` | Availability/blackout theo sân |
| Preset dùng lại | `GET/PUT /schedules/test-resource-presets` | Preset manager-scoped; `GET` route đặt trước `GET /schedules/:id` |
| Snapshot test | `GET/PUT/DELETE /schedules/test-workflow/:tournamentId` | Đọc/lưu/reset snapshot theo revision/CAS |
| Setup analysis | `POST /schedules/engine/test/setup-analysis` | Phân tích điều kiện và capacity không tự ghi lịch |
| Manual/auto | `POST /schedules/engine/test/manual-candidates`, `/automatic-preview` | Candidate và phương án giả lập |
| Validate/impact | `POST /schedules/engine/test/validate`, `/simulation/validate`, `/resources/preview` | Validator và ảnh hưởng nguồn lực |
| Publish/reopen | `POST /schedules/test-workflow/:tournamentId/publish`, `/reopen` | Luồng development test, có kiểm tra backend |

Hai migration liên quan đến Prompt 7–9A trong `sfl_scheduling`: 1005 tạo `match_schedule_test_snapshots` (snapshot cô lập development, version/CAS), 1006 tạo `match_schedule_resource_presets` (manager ID, JSONB state, version, timestamp). Không có migration hoặc reset DB trong Prompt 9A.

### Runtime Prompt 9A

UI gọi Match Service phân tích setup: 12 fixture, 17.6 giờ sân ước lượng, 0 sân phù hợp đã xác nhận, 0 giờ sân lý thuyết; trả về blockers và gợi ý. Bấm “Lưu và tiếp tục” commit snapshot hiện có, revision 2→3. Bấm “Lưu danh mục dùng lại” gọi PUT preset, version 0→1. Sau đó tạo sân `Sân QA 9A`, áp dụng template hai khoảng chỉ cho sân này, và chỉnh tên sân; GET snapshot xác nhận revision 5, hai sân gốc vẫn giữ giờ 07:00–11:30, sân QA có 07:00–11:30 + 13:30–17:30, 0 lịch; reload phục hồi sân QA. QA venue được giữ trong snapshot development để BTC kiểm tra; không gọi CRUD chính thức `/venues`, không đụng đội/fixture, không khóa hoặc công bố.

Sau lần sửa cuối, giao diện source chạy qua Vite `localhost:5175`. Kiểm thử browser xác nhận state draft của khung giờ và thông số còn nguyên qua stage 1/2/3, còn reload khôi phục bản đã lưu. Typecheck và Vite production build đạt. Docker rebuild chưa chạy được trong môi trường hiện tại vì không tìm thấy lệnh `docker`; URL `localhost:5173` vẫn là runtime trước sửa cuối.

## Phân quyền và isolation

Các route được bảo vệ bởi Gateway session, role BTC và kiểm tra quyền sở hữu giải ở Match Service. Browser/API run dùng tài khoản `dataset.btc01@football.local`, giải ID `95f79e55-e6f0-5177-a2e2-d9fe62760dcd`, trong môi trường development. API GET/validate thành công xác nhận phiên BTC và scope được chấp nhận cho giải này. Không chạy negative authorization với tài khoản khác, không chứng minh mọi service/path đều enforce scope.

Ghi chú ở trên là lượt Giai đoạn 9 ngày 22/11/2026 (revision 9), không phải Prompt 9A. Prompt 9A không reset database, không đổi danh sách đội/fixture và không gọi seed, reset, generate-plan, lock hoặc publish. Các thao tác ghi Prompt 9A giới hạn trong development test snapshot và preset manager-scoped.
