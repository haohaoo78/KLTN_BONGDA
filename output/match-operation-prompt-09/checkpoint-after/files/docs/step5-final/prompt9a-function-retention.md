# Đối chiếu bảo toàn nghiệp vụ – Prompt 9A

Ngày kiểm tra: 23/11/2026. Phạm vi: bố cục và giao diện Công đoạn 1–2 của Bước 5. Bước 3–5 và nghiệp vụ backend tiếp tục dùng luồng hiện có.

## Căn cứ đối chiếu

- Audit scheduling và kiến trúc: [03_SCHEDULING_LOGIC.md](../step5-audit/03_SCHEDULING_LOGIC.md), [04_ARCHITECTURE_AND_DATA.md](../step5-audit/04_ARCHITECTURE_AND_DATA.md), [05_ISSUES_AND_TEST_RESULTS.md](../step5-audit/05_ISSUES_AND_TEST_RESULTS.md).
- Bảng ràng buộc và chức năng đã nghiệm thu trước Prompt 9A: [constraint-matrix.md](./constraint-matrix.md), [functions-and-ui.md](./functions-and-ui.md), [architecture-and-api.md](./architecture-and-api.md).
- Source: `apps/web-client/src/components/DrawDemoScheduleSettingsPanel.tsx`, `ScheduleResourceManagerPanel.tsx`, `DrawDemoScheduleWorkspace.tsx`, `Step5WorkspaceShell.tsx`, `services/match-service/src/scheduling/routes/schedulingRoutes.ts`, `services/match-service/src/scheduling/controllers/schedulingEngineController.ts`, `packages/shared/src/scheduleSetupAnalysis.ts`.
- Storage/migration: `services/match-service/src/db/migrate.ts` – migration 1005 cho `match_schedule_test_snapshots`, migration 1006 cho `match_schedule_resource_presets` trong `sfl_scheduling`.

## Chức năng và quy tắc trước/sau

| Chức năng / quy tắc đã có | Vị trí trước Prompt 9A | Vị trí/hiển thị sau Prompt 9A | Bảo toàn logic và dữ liệu | Runtime 23/11 |
|---|---|---|---|---|
| Năm bước của luồng lập lịch | Nội dung workspace rải trong modal lớn và các card | Thanh 5 công đoạn; chỉ hiện panel công đoạn đang chọn | Không đổi state machine, API hoặc nghiệp vụ công đoạn 3–5 | PASS: thanh và hai panel hiện đúng |
| Sân, địa điểm, loại bóng, trạng thái, tìm kiếm/lọc, chi tiết/chỉnh sửa | Panel quản lý sân mở từ card riêng | Trực tiếp trong cột trái Công đoạn 1; lọc tên/địa điểm, loại bóng và trạng thái; sân phù hợp được ưu tiên | Tái sử dụng `ScheduleResourceManagerPanel`, luồng CRUD trong snapshot development; không tự đặt sân | PASS trong test snapshot: tạo QA, đổi tên, lưu và reload; không gọi CRUD bảng `/venues` chính thức |
| Lịch khả dụng theo sân, thứ, nhiều khoảng giờ, ngày loại trừ, ngoại lệ/blackout | Chỉnh theo từng form sân và trang thời gian | Mẫu giờ cả ngày/sáng/chiều/tối/cuối tuần/tùy chỉnh, ngày trong tuần và ngày nghỉ ở cột phải; form chi tiết sân tiếp tục giữ ngoại lệ riêng | Mẫu giờ không tự đánh dấu khả dụng đã xác nhận; thay đổi sân vẫn cần BTC xác nhận | PASS: mẫu và điều khiển xuất hiện; bulk apply chỉ thử trong draft chưa lưu |
| Khả dụng hàng loạt nhiều sân | Sao chép hồ sơ khả dụng theo panel riêng | Checkbox từng sân + “Áp dụng cho sân đã chọn” | Gọi cùng model `venues`, `availabilityProfiles`, `allowedWeekdays`; từng sân được bỏ xác nhận sau khi đổi giờ | PASS cho 1 sân QA: mẫu cả ngày tạo 2 khoảng, lưu revision 4; hai sân gốc không đổi |
| Danh mục sân/địa điểm tái sử dụng | Preset quản lý riêng | Banner dùng lại được đặt trong màn Công đoạn 1; preset vẫn ở Match Service DB | Route `GET/PUT /schedules/test-resource-presets`, bảng manager-scoped, version CAS; không dùng localStorage làm nguồn có thẩm quyền | PASS: bấm “Lưu danh mục dùng lại”; GET sau đó trả v1, 1 địa điểm/2 sân; reload vẫn hiện preset |
| Ngày giải và giới hạn điều lệ | Trang con thời gian; một số giá trị hiển thị tách rời | Ngày chính thức hiện bên cạnh mẫu sân; ngày xếp trận kế thừa trong Công đoạn 2 | API vẫn chặn vượt thời gian giải; không nới điều lệ | PASS: hiển thị 19–27/05/2027; chưa ghi ngày |
| Số hiệp, phút/hiệp, nghỉ giữa hiệp, chuẩn bị sân, chuyển tiếp | Bảy mục điều hướng rời | Hiển thị cơ bản tại Công đoạn 2 cùng timeline đá/kết thúc/chiếm sân | Kế thừa điều lệ, provenance giữ nguyên; trường bắt buộc khóa; đề xuất vẫn cần BTC xác nhận | PASS: 30 phút × 2 theo điều lệ; timeline 100 phút theo draft đang tải |
| Nghỉ tối thiểu giữa trận, trận tối đa/đội/ngày | Trang điều kiện riêng | Hai cột trái dưới “Nghỉ và số trận mỗi ngày” | Hard constraint từ điều lệ vẫn khóa; giới hạn đề xuất vẫn chưa xác nhận | PASS: hiển thị 60 phút Điều lệ và 1 trận/ngày đề xuất |
| Di chuyển, vòng/ngày, hiệp phụ/penalty, đồng giờ vòng cuối, fairness nhánh | Các mục setup chuyên sâu | Nhóm Thiết lập nâng cao thu gọn; menu nhóm chuyên sâu mở đúng trang cũ | Không xóa trường hoặc bỏ logic; chỉ thay cách điều hướng | PASS source retained; runtime nâng cao chưa mở trong ảnh nghiệm thu |
| Điều kiện theo thể thức | Thiết lập theo phase | Nằm trong nhóm nâng cao và dùng fixture/stage Bước 4 làm nguồn | Vòng tròn, knockout, hỗn hợp vẫn lọc cấu hình theo fixture thực tế; không sửa Bước 4 | PASS: fixture vòng tròn; KO/hỗn hợp chưa thử ở runtime lượt này |
| Hard constraints và soft objectives | Backend/shared validator và planner | Dễ tiếp cận qua thiết lập cơ bản/nâng cao; phân tích nguồn lực được đặt cạnh thông số | Hard không chuyển thành warning; objectives chỉ xếp hạng phương án, không nới điều lệ | Source retention PASS; không chạy lịch sinh |
| Manual/automatic dùng validator chung | Match Service / shared package | Công đoạn 3 không đổi | Candidate, planner, validation và giới hạn tìm kiếm giữ nguyên | NOT TESTED trong lượt Prompt 9A |
| Giả lập, customize, xóa, kiểm tra, khóa/mở khóa, version/CAS | Các khu vực công đoạn 3–5 | Vẫn thuộc công đoạn hiện có; không thay API | Giữ trạng thái giả lập, bản nháp, lịch khóa và quy tắc stale version | NOT TESTED trong lượt Prompt 9A |
| Công bố, public projection, Bước 6 handoff | Công đoạn Hoàn tất/công bố và contract đã có | Công đoạn 5 giữ nguyên; không triển khai Bước 6 | Không đổi lịch chính thức hoặc payload bàn giao | NOT TESTED trong lượt Prompt 9A |
| Reset development | Nút reset của Bước 5 | Giữ ngoài luồng setup; DEV-only; không nằm trong nút lưu/tiếp tục | Xóa snapshot lịch có revision check; không đụng Bước 1–4, đội hoặc preset | NOT TESTED và không bấm trong lượt này |
| Save snapshot resources | Lưu thiết lập hiện có | Nút “Lưu và tiếp tục” ở cuối Công đoạn 1 | Commit qua Match Service, chỉ thông báo sau API; không đổi lịch hay fixture | PASS: save nguyên trạng revision 2→3; tạo/bulk QA revision 4; edit QA revision 5; GET/reload khôi phục đúng 3 sân, 0 lịch |
| Bản nháp đang chỉnh khi đổi công đoạn | Component từng bị tháo khỏi cây UI; section effect có thể nạp lại dữ liệu | Giữ setup component mounted khi ẩn; chuyển section không reset draft | Chỉ giữ state tạm trên UI, không tự lưu backend; reload vẫn lấy nguồn đã commit | PASS: nghỉ giữa hiệp 10→11 và giờ sân 08:00→08:30 vẫn còn khi chuyển 1↔2, 1→3→1; reload trả lại giá trị đã lưu |
| Cập nhật danh sách trận và lựa chọn sân | Fixture list được lọc lại khi render | Memo hóa fixture theo snapshot; tránh set state nếu trạng thái đã rỗng/không đổi | Không thay đổi tập fixture hoặc business rules; chỉ tránh cập nhật lặp | PASS: workspace hoạt động và chuyển công đoạn không lặp render |

## API và dữ liệu giữ nguyên

Các route được khai báo trong Match Service vẫn giữ đường dẫn hiện có: `GET/POST/PUT/DELETE /venues`, `GET/POST/DELETE /venue-availability`, `GET/PUT /schedules/test-resource-presets`, `GET/PUT/DELETE /schedules/test-workflow/:tournamentId`, `POST /schedules/engine/test/setup-analysis`, `manual-candidates`, `automatic-preview`, `validate`, `simulation/validate`, `resources/preview`, và `POST /schedules/test-workflow/:tournamentId/publish`. Gateway tiếp tục route `/api/schedules/**` về Match Service. Quyền BTC/scope giải và kiểm tra backend không phụ thuộc kiểm tra UI.

Migration 1005 lưu snapshot workflow development theo `tournament_id`, `diagram_version`, `revision`, `state` trong `match_schedule_test_snapshots`. Migration 1006 lưu preset sân theo manager trong `match_schedule_resource_presets`, có JSONB state, version và thời điểm cập nhật. Không thay database ownership hay thay cấu trúc DB trong Prompt 9A.

## Giới hạn bằng chứng

- Mở trực tiếp trên Vite `localhost:5175` trong phiên BTC của giải `95f79e55-e6f0-5177-a2e2-d9fe62760dcd`; runtime hiện đọc 12 fixture vòng tròn, 8 đội. `localhost:5173` chưa được rebuild sau thay đổi cuối.
- Ảnh UI thật: [Công đoạn 1](./screenshots/prompt9a-final-stage1.png), [Công đoạn 2](./screenshots/prompt9a-final-stage2.png), [Công đoạn 1 với sân QA đã lưu](./screenshots/prompt9a-stage1-persistence-test.png).
- Công đoạn 2 gọi phân tích backend thật: 12 trận, nhu cầu 17.6 giờ sân, 0 sân 7 người xác nhận và 0 giờ sân lý thuyết. Đây là thiếu nguồn lực thực tế của snapshot; không phải lỗi tính đủ công suất.
- Đã bấm “Lưu và tiếp tục” cho snapshot hiện có, lưu preset v1, tạo `Sân QA 9A`, bulk apply mẫu giờ cho riêng sân QA, chỉnh tên và lưu lại. Match Service revisions tăng 2→3→4→5; API GET và reload xác nhận hai sân gốc giữ nguyên, sân QA có 2 khoảng giờ và 1 địa điểm. Không xác nhận khả dụng/đề xuất và không tạo lịch. QA venue vẫn nằm trong snapshot development để BTC kiểm tra tiếp; không reset/xóa snapshot.
- Các route CRUD danh mục chính thức `/venues` và `/venue-availability` chưa gọi; các thao tác thêm/sửa được thử trong JSON snapshot development. Không suy rộng kết quả này thành nghiệm thu production resource lifecycle.
- Hai thể thức knockout/hỗn hợp và toàn bộ mutation của Prompt 7–8 không được tuyên bố PASS trong lượt này.
