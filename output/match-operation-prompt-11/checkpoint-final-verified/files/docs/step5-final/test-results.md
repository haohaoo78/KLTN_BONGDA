# Test case và kết quả Giai đoạn 9

## Bằng chứng runtime

| ID | Test | Kết quả | Bằng chứng |
|---|---|---|---|
| RT-01 | Mở app localhost | PASS | Public app trả 200; browser render bình thường |
| RT-02 | Đăng nhập BTC development | PASS | Thành công vào `/btc`; user có 7 giải được phân công |
| RT-03 | Quản lý giải đúng scope | PASS | Chọn giải `95f79e55-e6f0-5177-a2e2-d9fe62760dcd`; UI và API cùng dữ liệu |
| RT-04 | Đọc sơ đồ Bước 4 qua API | PASS | 7 fixture KO; phiên bản diagram khớp snapshot Step 5 |
| RT-05 | Đọc snapshot Step 5 qua API | PASS | revision 9; `scheduleByFixture` rỗng, chưa công bố |
| RT-06 | Validate backend thật qua Gateway | PASS | `POST /api/schedules/engine/test/validate` → HTTP 200, 5 issues, 0 warnings |
| RT-07 | Validate không ghi state | PASS | revision vẫn 9 sau request; chỉ chạy API validator stateless |
| RT-08 | Không session không đọc được manager snapshot | PASS | GET manager snapshot với `credentials: omit` → 401 |
| RT-09 | Public projection không lộ nháp | PASS | GET public → 200; không draft/autoPreview/published fixtures trong state |
| RT-10 | UI tiến độ/empty state | PASS | 7 tổng, 0 lịch, 7 thiếu, 10 vấn đề, công bố disabled; ảnh lưu kèm |
| RT-11 | Giữ fixture và nhánh B4 | PASS | 7 fixture vẫn nguyên, có nguồn thắng cho bán kết/chung kết; không mutation |

Issues RT-06 phản ánh state trống: chưa có ngày trong tuần, khung giờ, thời lượng/config xác nhận. Không phải bằng chứng rằng hệ thống không thể lập lịch sau khi BTC cấu hình nguồn lực.

## Chưa kiểm thử thực tế

| Nhóm | Các ca chưa chạy |
|---|---|
| Thể thức | Vòng tròn, kết hợp; BYE, bảng/vòng/lượt; format × manual/auto đầy đủ |
| Nguồn lực | Nhiều địa điểm/sân, lịch lặp/ngoại lệ, blackout, capacity, thiếu sân, đổi thiết lập khi có lịch |
| Lập lịch | Manual save/edit, auto preview, partial, timeout/search cap, xung đột đội/sân, candidate, đồng giờ, chọn ưu tiên |
| Phương án | Viền đỏ trên cả ba view, customize nhiều lần, xóa đơn/nhiều/hủy, khôi phục draft gốc, kiểm tra và invalidation |
| Khóa | Riêng/nhiều/toàn bộ, tập phụ thuộc, bảo toàn khi chạy lại, stale revision, mở khóa |
| Đồng bộ | Reload sau mutation, nhiều tab, concurrent update, API error/idempotency |
| Công bố | Lịch thiếu/lỗi/warning, atomic success/failure, public projection, chuyển Step 6, handoff payload |
| Reset | Reset snapshot và kiểm chứng Step1–4 không đổi |
| Security | BTC không được phân công, viewer, production gate, public data redaction |
| UI/UX | Timeline occupancy, modal trung tâm vấn đề, modal công bố, responsive, keyboard/empty/error/loading states |
| Ca đặc biệt | KO 32 đội còn thiếu 4 fixture theo snapshot gốc – chưa tìm thấy snapshot/IDs trong dữ liệu đã đọc |

Tất cả các hàng trên là **NOT TESTED**, không phải PASS hoặc FAIL. Việc thực hiện các mutation cần quy trình rollback an toàn trên snapshot thử nghiệm chuyên biệt; không chạy reset nhằm tránh làm mất trạng thái server đang có.

## Kiểm tra bổ sung Prompt 9A – 23/11/2026

| ID | Ca kiểm tra | Kết quả | Bằng chứng |
|---|---|---|---|
| P9A-01 | Năm công đoạn và chỉ hiện nội dung stage đang chọn | PASS | Browser hiển thị đúng 5 nhãn; chuyển Công đoạn 1/2 đổi panel tại chỗ, không có modal bao ngoài |
| P9A-02 | Công đoạn 1: danh mục sân và địa điểm | PASS | Runtime hiển thị trực tiếp 1 địa điểm, 2 sân gốc 7 người, tìm kiếm/lọc/checkbox/menu; sau ca CRUD snapshot có thêm sân QA development |
| P9A-03 | Mẫu giờ, weekday, blackout và summary | PASS UI | Mẫu giờ, nhiều khoảng, thứ, ngày loại trừ và summary hiển thị; chưa áp dụng mẫu giờ lên sân |
| P9A-04 | Công đoạn 2 hai cột, thông số điều lệ/đề xuất, nâng cao thu gọn | PASS | Điều lệ 30×2 và nghỉ 60 phút khóa; 10/15/15 phút và 1 trận/ngày gắn nguồn đề xuất; advanced collapsed |
| P9A-05 | Backend setup analysis | PASS | Từ “Tính lại” gọi API analysis trong giao diện; 12 trận, nhu cầu 17.6 giờ, 0 sân xác nhận, 0 giờ khả dụng lý thuyết; có nguyên nhân và hướng xử lý |
| P9A-06 | Typecheck và production build web-client | PASS | `corepack pnpm --filter @sfl/web-client typecheck` và `corepack pnpm --filter @sfl/web-client build` đều thành công; Vite báo bundle JS khoảng 1.19 MB |
| P9A-07 | Ảnh giao diện hai công đoạn | PASS | [Stage 1](./screenshots/prompt9a-final-stage1.png) và [Stage 2](./screenshots/prompt9a-final-stage2.png) chụp từ browser thật sau khi chạy source mới trên Vite |
| P9A-08 | Lưu snapshot nguồn lực hiện có | PASS | Bấm “Lưu và tiếp tục”; Match Service trả thành công. GET đọc revision 3 (từ 2), 1 địa điểm/2 sân/0 lịch; reload khôi phục đủ sân |
| P9A-09 | Lưu preset danh mục dùng lại | PASS | Preset ban đầu v0/rỗng; bấm “Lưu danh mục dùng lại”; GET trả v1, 1 địa điểm/2 sân; sau reload banner preset còn hiện |
| P9A-10 | Thêm sân trong workflow Step 5, lưu và reload | PASS (development snapshot) | Tạo `Sân QA 9A` / `QA9A-01` tại địa điểm sẵn có; lưu snapshot, GET revision 4 xác nhận 3 sân; reload vẫn thấy sân. Không gọi CRUD bảng venue chính thức |
| P9A-11 | Áp dụng mẫu hàng loạt | PASS (development snapshot) | Chỉ chọn sân QA, áp dụng hai khoảng 07:00–11:30 và 13:30–17:30; lưu. API xác nhận hai sân gốc vẫn chỉ 07:00–11:30 |
| P9A-12 | Chỉnh sửa sân và lưu | PASS (development snapshot) | Đổi tên sân QA thành “Sân QA 9A đã chỉnh sửa”; Match Service báo lưu thành công, GET revision 5 xác nhận tên và khoảng giờ; reload khôi phục. Sân QA được giữ trong snapshot để BTC xem lại |
| P9A-13 | Chỉnh thiết lập riêng, CRUD venue chính thức, reset/reopen/preset nạp vào giải | NOT TESTED | Không chỉnh điều lệ/đề xuất hoặc gọi API `/venues`; không reset hoặc nạp preset vào giải |
| P9A-14 | Lịch thủ công/tự động, ba thể thức, khóa/công bố và stale version | NOT TESTED | Runtime hiện vòng tròn 12 trận; không sinh lịch, khóa, reset hoặc công bố |
| P9A-15 | Giữ chỉnh sửa chưa lưu khi chuyển công đoạn | PASS | Trên browser Vite, sửa giờ nghỉ 10→11 và giờ sân 08:00→08:30; chuyển 1↔2 và 1→3→1 vẫn giữ giá trị. Khôi phục giá trị ban đầu, reload: nhận lại 10 và 08:00 đã lưu; sân QA trong snapshot vẫn còn |
| P9A-16 | Rebuild Docker sau sửa cuối | NOT TESTED | `docker compose --profile apps build web-client` không chạy được vì executable `docker` không có trong PATH môi trường hiện tại; thay vào đó đã xác nhận typecheck/build và kiểm tra browser trên Vite cổng 5175 |
| P9A-17 | Tải lại workspace sau sửa vòng lặp render | PASS | Reload trên browser Vite: 5 công đoạn hoạt động, 3 venue snapshot còn nguyên, không ghi nhận console error mới trong 1.2 giây quan sát |
| P9A-18 | Hàng sân và nhãn trạng thái không tràn | PASS | Browser Vite ở viewport 1280px: hàng dùng đủ 6 cột, `scrollWidth` không vượt `clientWidth`, nhãn “Chưa xác nhận” hiển thị đủ. Ở viewport CSS 625px, hàng chuyển bố cục 3 cột, status xuống dòng và vẫn không tràn. Ảnh: [danh sách sân sau sửa](./screenshots/prompt9a-venue-list-no-overflow.png) |
| P9A-19 | Production build sau chỉnh CSS | PASS | `corepack pnpm --filter @sfl/web-client build`; còn cảnh báo bundle JS khoảng 1.19 MB |
| P9A-20 | Thêm sân mở modal, không chèn form vào danh sách | PASS | Bấm “+ Thêm sân” mở dialog “Thêm địa điểm và sân”; không còn `.schedule-resource-form-inline`; modal có tiêu đề, mô tả, vùng cuộn riêng và nút lưu. Không lưu sân mới trong phép thử. Ảnh: [modal thêm sân](./screenshots/prompt9a-add-venue-modal.png) |
| P9A-21 | Trạng thái sân ở danh sách hai sân | PASS | Snapshot đúng hai sân gốc: cả hai nhãn “Chưa xác nhận” đều rộng 87px, nội dung 87px; hàng có `scrollWidth` bằng `clientWidth`. |
| P9A-22 | Menu thao tác không bị khung cắt ở sân đầu/cuối | PASS | Mở menu của từng sân trong browser: menu vươn ra ngoài mép nhóm nhưng “Xóa” vẫn hit-test được. Nhóm và danh sách chuyển sang overflow visible, danh sách không còn vùng cuộn lồng nhau. |
| P9A-23 | Đóng menu ba chấm linh hoạt | PASS | Browser: mở menu → click vùng ngoài (đóng), mở lại → Escape (đóng), mở lại → chọn “Xem chi tiết” (menu đóng, drawer mở). Đóng drawer bằng Escape; không thay đổi dữ liệu sân. |

Sau khi rebuild/reload, browser ghi lỗi SSE `GET /api/notifications/events` với `ERR_INCOMPLETE_CHUNKED_ENCODING`; không ảnh hưởng việc đọc các panel Step 5 nhưng cần điều tra riêng. Cấu hình nguồn lực hiện tại thiếu sân xác nhận nên chưa thể nghiệm thu hành vi lập lịch thực tế.

## Kịch bản KO quan sát

Runtime có một snapshot KO 8 đội, 7 fixtures, không phải ca KO 32 đội/4 fixture còn thiếu. Tên giải hiển thị là “Seed 1 mở rộng — Vòng tròn…” trong khi sơ đồ Step4 và panel Step5 ghi thể thức KO; cần làm rõ inconsistency này trước nghiệm thu. Không kết luận về bốn fixture trong báo cáo audit cũ.

## Kiểm tra Prompt 9B — giao diện năm công đoạn (23/11/2026)

| Hạng mục | Trạng thái | Bằng chứng / giới hạn |
|---|---|---|
| Web-client typecheck | PASS | `corepack pnpm --filter @sfl/web-client typecheck` |
| Web-client production build | PASS | `corepack pnpm --filter @sfl/web-client build`; Vite cảnh báo bundle JS khoảng 1.22 MB |
| Chuyển qua các công đoạn mà không gọi mutation | PASS – browser smoke | Trên `localhost:5175`, đã đọc các màn 1–5 của giải `95f79e55-e6f0-5177-a2e2-d9fe62760dcd`; không lưu, tạo lịch, khóa, reset hoặc công bố |
| Công đoạn 1: danh sách, cấu hình chung, khoảng ngày, lịch khả dụng | PASS – hiển thị | Tìm kiếm, loại sân, trạng thái, chọn sân, mẫu giờ, nhiều khung giờ, ngày trong tuần, ngoại lệ, lịch khả dụng và “Lưu và tiếp tục” hiện đúng. Chưa thử lưu trong lần này. |
| Công đoạn 2: form một cột, chỉnh trực tiếp, nâng cao thu gọn | PASS – hiển thị | Các ô có thể chỉnh sửa hoạt động trực tiếp; trường theo điều lệ ở chế độ chỉ đọc; panel nâng cao đóng mặc định; chỉ còn nút lưu chung. Chưa thử lưu/kiểm tra API. |
| Công đoạn 3: thông tin và nút tạo lịch | PASS – hiển thị | Hiển thị 12 fixture, 2 sân đang dùng, ngày giải; tạo tự động đang bị khóa đúng vì hai sân chưa xác nhận khả dụng. Không chạy thuật toán. |
| Công đoạn 4: empty state | PASS – hiển thị | Chưa có lịch thì chỉ hiện trạng thái trống và nút quay lại Công đoạn 3; không hiển thị sơ đồ như lịch hoàn chỉnh. |
| Công đoạn 5: tổng kết và chặn công bố | PASS – hiển thị | Hiển thị 12 tổng, 0 đã xếp, 12 còn thiếu; công bố bị khóa. Không bấm công bố. |
| Fresh-load checkbox không tự chọn sân; áp dụng riêng đúng sân | NOT TESTED – browser | Runtime giữ React state từ lần mở trước trong lúc HMR; sau reload phiên đăng nhập hết hạn và redirect về trang công khai. Kiểm tra nguồn cho thấy lựa chọn bắt đầu rỗng; chưa xác nhận bằng phiên mới. |
| Thêm/sửa/khóa/xóa sân và persistence sau reload | NOT TESTED | Không ghi thay đổi vào snapshot venue hiện có. |
| Lưu thông số Công đoạn 2; sinh lịch thủ công/tự động; xung đột; điều chỉnh và khóa | NOT TESTED | Không ghi snapshot hoặc gọi API mutation trong lần browser smoke. |
| Xem trước/in/PDF/Excel trên lịch có trận | NOT TESTED – runtime | Thành phần được typecheck/build; không có lịch đã xếp trong snapshot để kiểm tra bản xem trước hoặc tải file. Excel được tải dưới dạng CSV UTF-8, không phải XLSX. |
| Công bố lịch hợp lệ và từ chối lịch không hợp lệ; giữ dữ liệu sau reload | NOT TESTED | Không chạy publish hoặc đổi snapshot. Các ca cần môi trường/snapshot thử riêng để không thay đổi dữ liệu đang dùng. |

Trong browser smoke, sau khi phiên hiện hành hết hạn, các request nền ghi nhận HTTP 401 và reload mở trang công khai. Không tự đăng nhập lại. Trạng thái này không được tính là lỗi UI Step 5; các ca yêu cầu phiên đăng nhập sau đó vẫn NOT TESTED.
