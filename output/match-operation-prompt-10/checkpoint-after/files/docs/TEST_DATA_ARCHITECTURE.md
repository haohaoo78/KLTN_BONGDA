# Kiến trúc dữ liệu thử nghiệm Bước 3–5

## Cập nhật rà soát runtime — 24/11/2026

- Luồng BTC chính thức dùng `DrawWorkflowPanel` với API Tournament Service ở Bước 3, `FixtureDiagramPanel` với Match Service ở Bước 4 và `OfficialScheduleWorkspace` với API Match Service ở Bước 5. `DrawDemo*` còn được giữ cho workspace/test cô lập, nhưng không được chọn làm nguồn dữ liệu cho luồng BTC chính thức.
- Bước 5 chính thức lưu lịch vào `schedules`; migration Match Service 1007 bổ sung `is_locked` và bảng `tournament_schedule_resources` theo từng giải. Khóa lịch là cờ riêng, không dùng trạng thái PUBLISHED. Auto-preview chính thức chỉ đọc fixture đã công bố, nguồn lực đã lưu và lịch nghiệp vụ; không đọc snapshot test.
- Sau khi chạy Compose ngày 24/11/2026, migration 1007 đã áp dụng. Kiểm tra chỉ đọc thấy `schedules=0`, `match_schedule_test_snapshots=2`, `tournament_draw_versions=0`, `tournament_draw_test_snapshots=2`; không có thao tác chuyển snapshot sang bảng nghiệp vụ.
- Build Compose và healthcheck backend/Gateway thành công. Chưa thể xác nhận E2E tạo/công bố lịch: hiện cơ sở dữ liệu không có bản chia/fixture chính thức, và phiên trình duyệt đang là BTC VIEWER không được phân công quản lý giải.
- Một lần đăng nhập API bằng BTC demo có quyền quản lý đã đọc được B3 draw, B4 fixtures, B5 schedules và scheduling resources của giải được phân công. Các API trả 200 sau khi sửa dispatch `scheduling-resources`; dữ liệu nghiệp vụ vẫn là 0 draw version, 0 fixture, 0 schedule và chưa lưu resources, nên không chạy planner/lưu/công bố.
- Snapshot đã lưu của workspace test Bước 3–5 nằm trong PostgreSQL (`tournament_draw_test_snapshots`, `match_schedule_test_snapshots`). `localStorage` là cache và nguồn nhập một lần cho dữ liệu legacy; khi tải snapshot manager thất bại, giao diện phải dừng ở lỗi thay vì dùng state rỗng/cache thay thế.
- Các thao tác lưu nháp đã đặt tên rõ ràng và các thao tác công bố test quan trọng chờ API snapshot thành công trước khi cập nhật state hiển thị là đã lưu/công bố. Preview thuật toán chưa áp dụng vẫn là tạm thời.
- Bảng lịch thi đấu chính thức không bị thay đổi bởi workspace test. Reset trong workspace test chỉ nhắm snapshot test của đúng giải; không dùng reset database hoặc volume.

## Nguyên tắc

- Dùng cùng giao diện, API tính toán và quy tắc nghiệp vụ; dữ liệu test được lưu bằng snapshot riêng, không ghi vào bảng nghiệp vụ bốc thăm/lịch chính thức.
- Tournament Service là nguồn có thẩm quyền cho giải, điều lệ, danh sách đội đủ điều kiện và kết quả Bước 3–4. Match Service là nguồn có thẩm quyền cho lịch và trọng tài Bước 5.
- Match Service xác minh phiên bản sơ đồ và toàn bộ fixture qua API nội bộ Tournament Service. Không truy cập trực tiếp database của Tournament Service.
- Snapshot test được phân vùng theo tournament ID, gắn revision tăng dần và kiểm tra compare-and-swap để phát hiện ghi đồng thời.
- Frontend giữ localStorage làm cache tương thích/khôi phục dữ liệu legacy một lần; sau khi có snapshot server, server là nguồn chuẩn. Actor xem công khai chỉ nhận projection đã publish từ API, không đọc cache của BTC.
- Test API chỉ khả dụng ở development/test. `NODE_ENV=production` luôn làm API test trả 404; Match Service còn yêu cầu cờ `SCHEDULING_TEST_API_ENABLED`.

## Lưu trữ

| Miền | Service sở hữu | Bảng snapshot | Migration | Phạm vi |
|---|---|---|---:|---|
| Bốc thăm/chia bảng và sơ đồ | Tournament Service / `sfl_tournament` | `tournament_draw_test_snapshots` | 24 | Trạng thái test Bước 3–4, khóa theo tournament, revision CAS |
| Lịch và dữ liệu kiểm thử Bước 5 | Match Service / `sfl_scheduling` | `match_schedule_test_snapshots` | 1005 | Snapshot Step 5, gắn diagram version đã công bố |

Hai migration chỉ tạo bảng/index mới, chạy có version và transaction. Không xóa hay cập nhật dữ liệu giải hiện có. Reset trong UI gọi DELETE snapshot riêng của đúng giải; không reset database, volume, hay dữ liệu Bước 1–2. Reset Bước 5 chỉ xóa snapshot lịch.

## Hợp đồng API

Tournament Service qua Gateway:

- `GET/PUT/DELETE /api/tournaments/:id/draw-management/test-state` – BTC có quyền quản lý giải; tải/lưu/xóa snapshot; PUT yêu cầu `expectedRevision`.
- `GET /api/tournaments/:id/draw-management/test-state/public` – chỉ projection công khai sau xác minh quyền xem giải; loại bỏ allocation draft và điều khiển nội bộ.
- `GET /internal/tournaments/:id/test-published-draw` – Match Service gọi bằng `x-gateway-internal-key`, nhận diagram version và fixture đã công bố để đối chiếu.

Match Service qua Gateway:

- `GET/PUT/DELETE /api/schedules/test-workflow/:tournamentId` – BTC phải có quyền quản lý giải; dữ liệu có `diagramVersion`, state version và revision CAS.
- `GET /api/schedules/test-workflow/:tournamentId/public` – chỉ trả lịch đã công bố, đúng diagram version hiện hành.
- `POST /api/schedules/engine/test/validate`
- `POST /api/schedules/engine/test/manual-candidates`
- `POST /api/schedules/engine/test/automatic-preview`
- `POST /api/schedules/engine/test/referee-preview`
- `POST /api/schedules/engine/test/setup-analysis` – xác minh nguồn điều lệ qua Tournament Service, tính công suất sơ bộ và chạy tìm kiếm bounded không ghi lịch.
- `POST /api/schedules/engine/test/resources/preview` – kiểm tra danh mục địa điểm/sân, các lịch bị ảnh hưởng, lịch bị khóa và điều kiện cần BTC xác nhận; endpoint không di chuyển hoặc lưu lịch.
- `POST /api/schedules/engine/test/setup-analysis` – lấy điều lệ/context từ Tournament Service, phân tích công suất giờ sân và chạy tìm kiếm bounded trên Match Service; chỉ trả kết quả, không lưu lịch.

Các API tính toán trên dùng implementation từ `packages/shared`; Match Service xác thực role, quyền sở hữu tournament, diagram version, danh sách/mã fixture và giới hạn payload trước khi xử lý. Preview không tự ghi lịch chính thức.

Bước 5 smart setup dùng internal test-draw API của Tournament Service để lấy tournament context/rules phiên bản hiện hành; không tin rules do client gửi. Chi tiết nguồn dữ liệu, provenance, giới hạn điều lệ và cách phân loại capacity/search được mô tả trong [STEP5_SMART_SETUP.md](./STEP5_SMART_SETUP.md).

### Snapshot nguồn lực thi đấu

`step5.resources` lưu riêng địa điểm, hồ sơ lịch khả dụng và sân. Một sân có `locationId` và `availabilityProfileId`; nhiều sân có thể chia sẻ một hồ sơ. Hồ sơ lưu các thứ hoạt động, một hoặc nhiều khoảng giờ trong ngày và ngoại lệ bảo trì. Sân mới/legacy chưa được BTC xác nhận được xem là **chưa khả dụng**; bộ sinh lựa chọn thủ công và tự động loại sân đó ra.

Modal nguồn lực chỉnh một bản nháp frontend, sau đó gọi API phân tích impact. Nếu lịch hiện có bị ảnh hưởng, BTC phải xác nhận danh sách trận và hướng xử lý trước khi snapshot được lưu bằng `PUT /api/schedules/test-workflow/:tournamentId` cùng revision CAS. API không tự xóa, dời hoặc mở khóa lịch. Nếu lịch đã công bố, thay đổi nguồn lực bị từ chối; cần quy trình điều chỉnh lịch riêng. Các lịch bị ảnh hưởng vẫn được giữ nguyên để BTC xử lý.

Các field nguồn lực mới là phần mở rộng tương thích của JSON snapshot (`locations`, `availabilityProfiles`, `locationId`, `availabilityProfileId`, `availableSlots`, `availabilityConfirmed`); không cần migration DB vì không thêm bảng nghiệp vụ. Giới hạn còn lại: luồng này quản lý **snapshot test server-side**, không phải CRUD venue chính thức cho dữ liệu production.

## Đồng bộ frontend

`apps/web-client/src/utils/drawTestStorage.ts` phục vụ hydration, cache, event đồng bộ giữa tab và hàng đợi lưu snapshot. Thao tác công bố test và lưu nháp tường minh dùng commit có kiểm tra revision trước khi cập nhật cache chia sẻ. Nếu không tải được snapshot manager, giao diện hiển thị lỗi và không dùng cache như nguồn thay thế. Public detail khởi tạo trạng thái rỗng rồi tải projection từ server để tránh thoáng hiển thị dữ liệu manager-only; lỗi khác 404 được hiển thị thay vì giả định không có dữ liệu.

## Giới hạn còn lại

- Một số phần tạo phân bổ/chia bảng và sinh fixture test vẫn ở frontend (đặc biệt `DrawDemoAllocationWorkspace` và `generateDemoFixtures`). Chưa đáp ứng đầy đủ yêu cầu chuyển toàn bộ business logic Bước 3–4 sang backend.
- Một số cấu hình/fixture test legacy vẫn được quản lý qua bảng test cũ `tournament_draw_test_configs` và workflow draw versions; cần hợp nhất/lập kế hoạch tương thích trước khi bỏ.
- Bước 6–8 chưa được chuẩn hóa dữ liệu thử nghiệm server-side trong phạm vi này.
- E2E qua trình duyệt → Gateway → service đang chạy → PostgreSQL chưa xác minh trên runtime đã rebuild; Docker CLI không có trong terminal của phiên này.
