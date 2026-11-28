# Prompt 1 — Kiểm tra và hoàn thiện giao diện trọng tài

**Ngày:** 26/11/2026. **Hệ thống:** [http://localhost:5173/referee](http://localhost:5173/referee).  
**Phạm vi:** kiểm tra sáu route hiện có, sửa dữ liệu đọc/hiển thị và làm mới quyền cá nhân. Không triển khai luồng thi đấu, không sửa các lỗi điều hành F01–F15 của [baseline](./MATCH_OPERATION_BASELINE.md).

## 1. Source và checkpoint

- Đã đọc toàn bộ [MATCH_OPERATION_BASELINE.md](./MATCH_OPERATION_BASELINE.md), kiểm tra HEAD, working tree và các diff có sẵn trước khi sửa.
- HEAD giữ nguyên: **27fa2bd9fef76f23bc6cb16b939f124735c8cea0**. Có **34 đường dẫn** thay đổi/chưa track lúc bắt đầu, gồm 33 đường dẫn từ trước và baseline Prompt 0.
- Checkpoint trước sửa: [manifest](../output/match-operation-prompt-01-qa-20261126/checkpoint-before/manifest.json), bản sao nguyên byte của 34 file và binary diff với HEAD. SHA-256 manifest: **ee4b20e18d5ce42faf8473668bc7a54f3c0b8a24d435e52671b0ca78df8ea7c2**.
- Checkpoint bàn giao: [manifest sau sửa](../output/match-operation-prompt-01-qa-20261126/checkpoint-after/manifest.json). Đây là checkpoint bằng file; không tạo Git commit gộp các thay đổi có sẵn của người dùng.
- Không reset, stash, checkout, đổi branch hoặc khôi phục checkpoint cũ. Không truy cập hay thay đổi môi trường đối chiếu cổng 15173.

## 2. Sáu route đang render

[App.tsx](../apps/web-client/src/App.tsx) chọn [RefereePortal.tsx](../apps/web-client/src/components/referee/RefereePortal.tsx); [refereeRoutes.ts](../apps/web-client/src/components/referee/refereeRoutes.ts) phân giải đúng sáu route. Không bổ sung route tương đương.

| Route | Component chính | Kết quả trình duyệt tại 5173 |
|---|---|---|
| `/referee` | [RefereeOverviewPage.tsx](../apps/web-client/src/components/referee/RefereeOverviewPage.tsx) | **PASS** — lời chào, bốn thống kê, trận sắp tới, lịch gần nhất, quy trình, thông báo thật; không có form tác nghiệp |
| `/referee/assignments` | [RefereeAssignmentsPage.tsx](../apps/web-client/src/components/referee/RefereeAssignmentsPage.tsx) | **PASS** — danh sách, logo/tên đội, bảng/vòng, ngày giờ/sân, nhiệm vụ và bộ lọc |
| `/referee/assignments/:matchId` | [RefereeMatchDetailPage.tsx](../apps/web-client/src/components/referee/RefereeMatchDetailPage.tsx) | **PASS** — hai đội, điều lệ công bố, tổ trọng tài, nhiệm vụ của mình, đội hình/trạng thái chưa nộp và liên kết tác nghiệp |
| `/referee/matches/:matchId/operation` | [RefereeOperationPage.tsx](../apps/web-client/src/components/referee/RefereeOperationPage.tsx) | **PASS phần giao diện đọc** — ba giai đoạn; chỉ hiện giai đoạn được chọn; trận tương lai không được bắt đầu trên UI |
| `/referee/reports` | [RefereeReportsPage.tsx](../apps/web-client/src/components/referee/RefereeReportsPage.tsx) | **PASS trạng thái rỗng thật** — hiện 0 biên bản, không tạo kết quả giả |
| `/referee/reports/:matchId` | [RefereeReportDetailPage](../apps/web-client/src/components/referee/RefereeReportsPage.tsx) | **PASS trạng thái chưa có biên bản** — đọc riêng, không hiện form gửi biên bản |

Đã kiểm tra sidebar, liên kết Tổng quan → lịch → chi tiết → tác nghiệp, breadcrumb quay lại, sidebar biên bản và liên kết quay lại khi bị từ chối quyền. Mỗi route có một tiêu đề chính. Cả sáu route không tràn ngang toàn trang tại viewport thực **1144 × 1288 CSS px**; bảng có vùng cuộn riêng. Nội dung chính không hiển thị UUID hoặc các mã trạng thái/quyền kỹ thuật đã kiểm tra.

## 3. Phần đã đúng và được giữ nguyên

- Giữ thiết kế cam–đen, sidebar/header, bố cục, bảng, card, font và CSS hiện tại. Không dựng lại Tổng quan hoặc ghép giao diện khác vào phía dưới.
- Giữ nguyên file [App.tsx](../apps/web-client/src/App.tsx), [RefereeOverviewPage.tsx](../apps/web-client/src/components/referee/RefereeOverviewPage.tsx), [RefereeOperationPage.tsx](../apps/web-client/src/components/referee/RefereeOperationPage.tsx), [RefereeReportsPage.tsx](../apps/web-client/src/components/referee/RefereeReportsPage.tsx), [refereeOperation.ts](../apps/web-client/src/components/referee/refereeOperation.ts), [refereeRoutes.ts](../apps/web-client/src/components/referee/refereeRoutes.ts) và [referee-portal.css](../apps/web-client/src/components/referee/referee-portal.css) so với checkpoint đầu Prompt 1.
- Ảnh chi tiết trận trước/sau có **cùng SHA-256**, cùng viewport: `9ac929c841c563f2fe882f0fcfaf67d1a22c266be8add0c41576d737c1df1264`. Đây là đối chiếu với giao diện đang chạy trước sửa, không phải chứng nhận đối chiếu ảnh mẫu gốc.
- Không có nhận/từ chối nhiệm vụ hoặc tự chọn nhiệm vụ. Nhiệm vụ và capability lấy từ vị trí đã công bố; giữ READ, RECORD_EVENT, EDIT_EVENT, MANAGE_REPORT, FINALIZE.
- Giữ session cookie HttpOnly/Redis, SSE/EventSource, PostgreSQL LISTEN/NOTIFY và outbox hiện có. Không bổ sung WebSocket, RabbitMQ, JWT hoặc service.
- Không thay đổi phân hệ BTC, Bước 1–5, nút Đóng/Mở đăng ký dev, SMTP, lịch chính thức, trạng thái trận hoặc kết quả.

## 4. Những lỗi đã sửa

### 4.1. API đọc thiếu cấu trúc trận và nguồn điều lệ áp dụng

API trọng tài gọi lookup trận cũ, trả thiếu stage, groupId, roundNumber, leg và metadata fixture. Vì vậy groupName bị null và giao diện có thể không xác định đúng điều lệ knockout.

[refereePortalService.ts](../services/match-service/src/services/refereePortalService.ts) nay tái sử dụng projection fixture **đã công bố** từ repository Match hiện có. Không thay generator, ID, lịch, cặp đấu hoặc repository tác nghiệp chung. Trận legacy giữ dữ liệu legacy thật; không lấy metadata từ fixture DRAFT.

Điều lệ đọc từ phiên bản nghiệp vụ đã gắn với draw/fixture công bố khi có; giữ đường tương thích hiện tại khi không có phiên bản đó. Đây là snapshot điều lệ nghiệp vụ hợp lệ, không phải snapshot test. Không ghi hoặc đổi điều lệ công bố.

### 4.2. Tên bảng/vòng và tìm kiếm

- Tìm kiếm xét cả groupName riêng, không phụ thuộc việc tên bảng có nằm trong chuỗi vòng hay không.
- Dùng cùng hàm trình bày bảng/vòng ở các vùng hiển thị liên quan, tránh lặp “Bảng A · Bảng A…”. Giữ nguyên chuỗi vòng đầy đủ từ backend để trang tác nghiệp/biên bản hiện có không bị mất tên bảng.

### 4.3. Dữ liệu cũ khi đổi trận hoặc quyền thay đổi

- Context được gắn với matchId: chuyển URL không hiển thị thoáng dữ liệu/lỗi của trận trước; response cũ không ghi đè response mới.
- Khi API trả 403 hoặc lỗi tải, xóa context riêng tư; không fallback sang dữ liệu cũ. Có thông báo không còn quyền truy cập và liên kết quay lại lịch cá nhân.
- Giữ SSE hiện có; bổ sung đọc lại khi tab trở lại, có focus, mạng trở lại và mỗi 30 giây khi tab đang hiển thị. Đây là kiểm tra đọc, không cấp quyền thay server hoặc thay cơ chế đồng bộ.
- Không gửi email, nhận nhiệm vụ hoặc ghi nghiệp vụ từ các lần refresh này.

## 5. File và API thay đổi

| File | Thay đổi trong Prompt 1 |
|---|---|
| [refereePortalService.ts](../services/match-service/src/services/refereePortalService.ts) | Bổ sung metadata fixture công bố và nguồn điều lệ có phiên bản cho API đọc |
| [RefereePortal.tsx](../apps/web-client/src/components/referee/RefereePortal.tsx) | Làm mới cá nhân, phản hồi mất quyền và liên kết quay lại |
| [useRefereeContext.ts](../apps/web-client/src/components/referee/useRefereeContext.ts) | State theo matchId, bỏ response cũ, xóa context khi lỗi/403 |
| [useRefereeRefresh.ts](../apps/web-client/src/components/referee/useRefereeRefresh.ts) | Hook mới, chỉ dùng cho portal trọng tài; SSE + focus/online/tab hiển thị |
| [RefereeAssignmentsPage.tsx](../apps/web-client/src/components/referee/RefereeAssignmentsPage.tsx) | Tìm kiếm theo bảng và nhãn bảng/vòng nhất quán |
| [RefereeShared.tsx](../apps/web-client/src/components/referee/RefereeShared.tsx) | Hàm trình bày bảng/vòng, không đổi bố cục |
| [RefereeMatchDetailPage.tsx](../apps/web-client/src/components/referee/RefereeMatchDetailPage.tsx) | Tái sử dụng nhãn bảng/vòng, không thay layout |
| [refereePortal.test.cjs — frontend](../apps/web-client/scripts/refereePortal.test.cjs) | Giữ 15 test có sẵn, bổ sung 6 test |
| [refereePortal.test.cjs — backend](../services/match-service/tests/refereePortal.test.cjs) | 7 unit test mới cho projection và phạm vi đọc |
| [Báo cáo này](./MATCH_OPERATION_PROMPT_01_REPORT.md) | Kết quả và giới hạn bàn giao |

**API giữ nguyên đường dẫn:** GET `/my/schedules/workspace`, GET `/matches/:matchId/referee-context`. Không thêm API trùng chức năng, migration, bảng, enum hoặc quyền mới. [API client](../apps/web-client/src/api/refereePortal.ts) và cơ chế xác thực không đổi.

## 6. Kết quả kiểm thử

| Hạng mục | Kết quả | Bằng chứng/giới hạn |
|---|---|---|
| Sáu route, sidebar, breadcrumb, liên kết qua lại | **PASS** | Trình duyệt thật, cổng 5173; [browser-checks.json](../output/match-operation-prompt-01-qa-20261126/browser-checks.json) |
| Bộ lọc giải + nhiệm vụ + trạng thái + khoảng ngày; tìm bảng; không khớp; Đặt lại | **PASS** | Thao tác trên danh sách thật; không ghi nghiệp vụ |
| UI 403 không còn dữ liệu trận và nút quay lại | **PASS** | Tài khoản hiện tại truy cập trận không được giao; API 403 thật |
| API thực qua Auth/Gateway | **PASS — 14/14** | [api-checks.json](../output/match-operation-prompt-01-qa-20261126/api-checks.json); đăng nhập thường, không bypass xác thực |
| Tài khoản có phân công; tài khoản REFEREE không còn phân công | **PASS API** | Võ Tuấn Dũng có 1 trận; Phan Phát Quân có 0 trận, không còn thấy trận đã bị thay thế |
| Người bị thay thế, trận của người khác, BTC không có role REFEREE, anonymous, ID sai | **PASS API** | 403 / 403 / 403 / 401 / 400 đúng trường hợp |
| Đọc lại ngày giờ/sân, vị trí và quyền đã công bố | **PASS** | GET lặp lại giữ scheduleId và assignment; UI reload đọc đúng dữ liệu |
| SSE Match và Notification sau triển khai | **PASS kết nối** | Hai EventSource mở được; [kiểm tra bổ sung](../output/match-operation-prompt-01-qa-20261126/browser-final-additional-checks.json). Không suy ra đã nghiệm thu phát/nhận mọi loại event |
| Mất quyền, response sai thứ tự, đổi capability khi context tải lại | **PASS unit/hook** | Kiểm thử tách biệt; dữ liệu giả chỉ nằm trong bài test, không trong runtime |
| Vai trò READ / RECORD_EVENT / final authority, 1–5 người trong tổ | **PASS unit/SSR** | Không tạo enum hoặc dropdown đổi nhiệm vụ |
| Frontend test | **PASS — 21/21** | [web-tests.txt](../output/match-operation-prompt-01-qa-20261126/web-tests.txt) |
| Match test suite | **176 PASS / 34 SKIP / 0 FAIL** | [match-tests.txt](../output/match-operation-prompt-01-qa-20261126/match-tests.txt); 7 test mới nằm trong số 176 PASS. Các bài integration chưa bật vẫn SKIP, không gán PASS |
| Typecheck frontend và Match | **PASS** | `corepack pnpm --filter @sfl/web-client typecheck`; `corepack pnpm --filter @sfl/match-service typecheck`; build Match cũng chạy tsc |
| Production build frontend và Match | **PASS** | [web-build.txt](../output/match-operation-prompt-01-qa-20261126/web-build.txt), [match-build.txt](../output/match-operation-prompt-01-qa-20261126/match-build.txt); Vite còn cảnh báo bundle lớn, không đổi cách đóng gói trong prompt này |
| Compose config, build, khởi chạy đúng hệ thống | **PASS** | Chỉ build/recreate web-client và match-service; 9 container running, 8 healthy; web không cấu hình healthcheck |

### Chưa kiểm chứng thực tế

| Ca kiểm thử | Kết quả | Lý do |
|---|---|---|
| BTC thay thế/thu hồi thật trong lúc trọng tài đang mở trang, kiểm tra nhiều client và event bị mất | **NOT TESTED E2E** | Không thay phân công đang sử dụng để tạo tình huống. Đã kiểm tra API người đã bị thay thế và unit/hook mất quyền; chưa thay thế được bài kiểm tra này |
| Trình duyệt với phân công hỗ trợ/READ-only thực đã công bố | **NOT TESTED** | Dữ liệu hiện có đang giao trọng tài chính; không tạo phân công mới chỉ để kiểm thử. Capability đã được test tách biệt |
| Giao diện tài khoản không có phân công trong phiên trình duyệt riêng | **NOT TESTED browser** | Đã kiểm tra API thật và empty state bằng SSR; giữ nguyên phiên trình duyệt của người dùng |
| Hết session thực, lỗi upstream/đứt mạng có chủ đích trên trình duyệt | **NOT TESTED browser** | Không đăng xuất/khóa tài khoản hiện tại hoặc làm gián đoạn service để tạo lỗi. Unit kiểm tra lỗi không fallback; anonymous API trả 401 |
| Biên bản thực đã gửi, gửi/sửa sự kiện và toast lưu thành công | **NOT TESTED E2E** | Không có trận đã hoàn tất/biên bản; không chèn dữ liệu giả hoặc bắt đầu trận tương lai |
| Luồng đầy đủ Trước trận → thi đấu → xác nhận kết quả → BXH/nhánh | **NOT TESTED** | Ngoài Prompt 1; các lỗi F01/F02/F03/F10 và những lỗi còn lại chưa được sửa |
| So khớp pixel với ảnh tham chiếu gốc | **NOT TESTED** | Không có tệp ảnh tham chiếu trọng tài gốc được cung cấp trong prompt này. Đã giữ CSS và đối chiếu ảnh trước/sau đang chạy |

## 7. Bảo toàn dữ liệu và deployment

Đã đọc **101 bảng** trong sáu database nghiệp vụ bằng transaction READ ONLY trước/sau. Dữ liệu Match, Scheduling, Discipline, Organization và Notification giữ nguyên digest; không phát sinh email do mở trang/reload. Các GET context dùng hai trận đã có clock từ trước; không tạo clock cho trận không được phép xem.

So sánh toàn bộ có 10 bảng Tournament thay đổi do **thêm giải `test`**, ID `da30f3d4-e8c0-4881-8410-2c347e3ca03a`, DRAFT, tạo lúc **09:42:19 UTC** trong khoảng kiểm tra. Tác vụ này không gọi API tạo giải. Không xóa hoặc sửa giải phát sinh đó. Khi loại riêng dữ liệu của giải mới, **cả 10 bảng giữ nguyên dữ liệu có trước**, kể cả lịch sử của những giải không còn trong danh sách hiện tại.

Bằng chứng: [so sánh toàn bộ](../output/match-operation-prompt-01-qa-20261126/database-comparison.json), [so sánh dữ liệu đã có, loại riêng giải phát sinh](../output/match-operation-prompt-01-qa-20261126/database-existing-tournaments-comparison.json). Đây là kiểm tra bảo toàn ở hai mốc, không phải backup database hoặc snapshot nguyên tử giữa các service. Auth/Redis có các phiên đăng nhập kiểm thử hợp lệ và không nằm trong phép so sánh dữ liệu giải.

Deployment qua [docker-compose.yml](../docker-compose.yml), project `student-football-league`, build context gốc hiện tại. Không chạy migration/seed/reset/down -v, không xóa image/volume/database.

| Thành phần | Dấu vân tay bản đang chạy |
|---|---|
| Web image, nhãn Compose | `sha256:235403ddb1167036452b09f14dd798a8a97b8774d2db1abf6b58e5940dfe4a03` |
| Match image, nhãn Compose | `sha256:fce869af5e6f9b49b44a1c0f49a16083e335453410f440bc190a4a9c1afdca3c` |
| Bundle web thực phục vụ | `/assets/index-CkTD8pan.js` — SHA-256 `1364b94f762ae0d4c784bd4cea06e4ef524ee87395edbc13a94af9ec8e08837a`, trùng file build local |
| Projection Match biên dịch trong container | SHA-256 `10613e43b24e4f14e47e9ec205896e16e8040f9c7ffedfe7c431955cdec44664`, trùng file build local |

[runtime-proof.json](../output/match-operation-prompt-01-qa-20261126/runtime-proof.json) ghi container, working directory, image và cổng; [web-runtime-proof.json](../output/match-operation-prompt-01-qa-20261126/web-runtime-proof.json) đối chiếu bundle HTTP. Image các service khác giữ nguyên. Health/build không thay thế E2E.

## 8. Ảnh giao diện thực tế

Các ảnh sáu route được chụp sau khi chạy image cuối trên cổng 5173. Ảnh dùng dữ liệu của tài khoản đang đăng nhập và hai đội thực; không thay dữ liệu theo ảnh mẫu.

- [Tổng quan](../output/match-operation-prompt-01-qa-20261126/01-overview.png).
- [Lịch phân công](../output/match-operation-prompt-01-qa-20261126/02-assignments.png).
- [Chi tiết trận](../output/match-operation-prompt-01-qa-20261126/03-match-detail.png); [ảnh trước sửa cùng viewport](../output/match-operation-prompt-01-qa-20261126/before-details-viewport.png).
- [Tác nghiệp — Trước trận](../output/match-operation-prompt-01-qa-20261126/04-operation-pre.png), [Điều hành — chưa bắt đầu](../output/match-operation-prompt-01-qa-20261126/04-operation-waiting.png), [Sau trận — chưa đủ điều kiện](../output/match-operation-prompt-01-qa-20261126/04-operation-post-not-ready.png).
- [Danh sách biên bản](../output/match-operation-prompt-01-qa-20261126/05-reports.png), [chi tiết khi chưa có biên bản](../output/match-operation-prompt-01-qa-20261126/06-report-detail.png).
- [Truy cập bị từ chối](../output/match-operation-prompt-01-qa-20261126/07-forbidden.png).

## 9. Các lỗi điều hành để lại cho prompt tiếp theo

Giữ nguyên phát hiện và quyết định trong baseline:

| Mã | Nội dung chưa giải quyết trong Prompt 1 |
|---|---|
| F01 | START_MATCH truy vấn sai database |
| F02 | Roster/đội hình và gate sẵn sàng phía backend |
| F03–F04 | Gate kickoff, trạng thái, hiệp/phân định và mô hình thời gian sự kiện |
| F05–F06 | Thay người, cầu thủ đang trên sân, chống lặp, tỷ số/luân lưu/thống kê |
| F07–F08 | Xác nhận biên bản nguyên tử, người chuẩn bị/người xác nhận, lịch sử submission |
| F09–F11 | BXH, readiness trọng tài và vòng đời giải/ngoại lệ |
| F12–F14 | Kỷ luật/quyền, thời hạn khiếu nại, hoãn/hủy và đồng bộ clock/lịch |
| F15 | Consistency/outbox/replay, public visibility và nghiệm thu thay thế nhiều client; cải thiện refresh UI không đồng nghĩa đã sửa toàn bộ F15 |

**Dừng tại Prompt 1. Chưa nghiệm thu hoàn thành toàn bộ phân hệ trọng tài hoặc luồng điều hành trận đấu.**
