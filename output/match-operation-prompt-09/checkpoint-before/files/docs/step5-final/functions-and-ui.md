# Chức năng và giao diện Step 5

> Phần “Đã quan sát trực tiếp” bên dưới là ảnh chụp lịch sử Giai đoạn 9 (22/11/2026), không mô tả bố cục runtime mới nhất. Cập nhật Prompt 9A ngày 23/11/2026 được ghi riêng ở cuối.

## Đã quan sát trực tiếp

- BTC workspace liệt kê giải được phân công; nút quản lý mở đúng giải và workflow 8 bước.
- Bước 5 mở modal lớn “Lập lịch thi đấu”. Trên ngoài modal có nút cùng tên và thống kê độc lập.
- Modal có khu vực Chuẩn bị tổ chức, hai thẻ riêng “Sân & địa điểm” và “Thiết lập”, gợi ý hệ thống, hai phương thức “Lập lịch thủ công”/“Lập lịch tự động”, tabs “Sơ đồ thi đấu”/“Lịch trực quan”/“Danh sách”, bộ lọc, sơ đồ và khu vực Hoàn tất lịch.
- Snapshot fixture được giữ từ Bước 4: 7 trận KO (4 tứ kết, 2 bán kết, 1 chung kết); nguồn thắng được biểu diễn theo mã trận. Không sinh thêm fixture trong lượt kiểm tra.
- Khu vực Hoàn tất hiển thị 7 tổng, 0 đã lưu, 0 khóa, 0 giả lập, 7 thiếu, 10 vấn đề và nút công bố bị khóa do thiếu cấu hình/lịch.

## Đối chiếu yêu cầu

Source hiện có manual candidates, planner, customize, simulation plan, validate, lock, reset snapshot và sandbox publication. Tài liệu Giai đoạn 7–8 mô tả các luồng; không xem danh sách source như bằng chứng runtime.

Từ góc nhìn BTC mới, giao diện trình bày được hai cách lập lịch và trạng thái thiếu tài nguyên. Trong ảnh thực tế, setup state mặc định có 0 sân/0 khung giờ/0 phút cho thời lượng và hiển thị “Vòng bảng” 0 phút dù snapshot đang là KO; đây là dấu hiệu cấu hình chưa được khởi tạo/đồng bộ và có thể gây khó hiểu. Chưa đánh giá responsive, loading/error states, thao tác bảng đầy đủ hoặc khả năng sử dụng qua nhiều vai trò.

## Ảnh chụp

- [Workspace Step 5 thật – chưa lịch, KO 8 đội](./screenshots/step5-scheduling-workspace-actual.png)
- [Tiến độ Step 5 thật](./screenshots/step5-progress-actual.png)

Ảnh được chụp từ browser localhost sau đăng nhập BTC; đây không phải mockup. Modal đang mở trong ảnh đầu. Chưa có ảnh của các trạng thái giả lập, customize, xóa, kiểm tra có phương án, khóa hoặc công bố vì chưa thực hiện các mutation tương ứng.

## Cập nhật Prompt 9A – quan sát runtime 23/11/2026

- Bỏ nội dung modal bao ngoài; trong vùng nội dung chính có thanh 5 công đoạn: Sân & thời gian, Điều kiện thi đấu, Tạo & điều chỉnh lịch, Kiểm tra & in lịch, Hoàn tất & công bố. Chọn stage chỉ đổi panel, không đổi fixture hoặc lịch.
- Công đoạn 1 dùng hai cột. Cột trái hiển thị danh mục địa điểm/sân, tìm kiếm, lọc loại bóng và trạng thái, chọn nhiều sân, xem chi tiết/chỉnh sửa qua menu. Cột phải có ngày giải, mẫu cả ngày/sáng/chiều/tối/cuối tuần/tùy chỉnh, nhiều khoảng giờ, thứ áp dụng, ngày nghỉ và áp dụng hàng loạt. Mẫu không tự xác nhận khả dụng.
- Runtime hiển thị 2 sân gốc 7 người tại 1 địa điểm, cả hai chưa xác nhận. Sau đó thử thêm `Sân QA 9A`, áp dụng mẫu hai khoảng giờ riêng cho sân thử, đổi tên và lưu; API/reload phục hồi sân QA trong snapshot. Ảnh [Công đoạn 1](./screenshots/prompt9a-stage1.png) và [sau lưu thử](./screenshots/prompt9a-stage1-persistence-test.png).
- Công đoạn 2 dùng hai cột: thời lượng và nghỉ/số trận mỗi ngày bên trái; công suất và gợi ý backend bên phải. Thiết lập nâng cao thu gọn. Ảnh [Công đoạn 2](./screenshots/prompt9a-stage2.png).
- Backend trả phân tích cho 12 trận: 17.6 giờ sân nhu cầu sơ bộ, 0 sân phù hợp đã xác nhận, 0 giờ sân lý thuyết. Đây là dữ liệu runtime; không suy ra khả năng lập lịch khi chưa có nguồn lực xác nhận.
- Snapshot resources và preset được lưu bằng API thật, đọc lại được sau reload. Thêm/chỉnh sân đã thử trong workflow snapshot development, không gọi CRUD bảng venue chính thức; sân QA vẫn được giữ để BTC kiểm tra. Các bước tạo/khóa/công bố lịch vẫn chưa chạy. Xem [ma trận giữ nghiệp vụ](./prompt9a-function-retention.md) và [test results](./test-results.md).

## Cập nhật Prompt 9B — rút gọn cả năm công đoạn (23/11/2026)

- Công đoạn 1 vẫn dùng hai cột và lịch khả dụng bên dưới. Cấu hình chung chỉ áp dụng cho sân được BTC tích chọn; các sân không tự được chọn. Nút duy nhất ở cuối trang là “Lưu và tiếp tục”. Lần lưu này chỉ đánh dấu khả dụng cho sân đang hoạt động có khoảng ngày nằm trong thời gian giải, có thứ và khung giờ hợp lệ. Backend tiếp tục kiểm tra lịch.
- Chi tiết sân dùng cùng form cho chế độ xem và sửa; trạng thái đang dùng/đã khóa, khả dụng theo sân, ngoại lệ, khóa và xóa được giữ lại. Bỏ các thống kê nguồn lực và nút xác nhận lặp lại khỏi màn hình chính.
- Công đoạn 2 chuyển thành một cột. Các ô chỉnh sửa được dùng trực tiếp; thông số điều lệ bị khóa. Một lần “Lưu và tiếp tục” ghi nhận các đề xuất hợp lệ sau kiểm tra; đề xuất không hợp lệ không được tự xác nhận. Phân tích nguồn lực và thiết lập chuyên sâu vẫn còn trong phần nâng cao.
- Công đoạn 3 có tóm tắt trận, sân đang dùng và ngày giải, nút “Tạo lịch tự động”, cùng lựa chọn lập thủ công hiện có. Thuật toán vẫn dùng fixture Bước 4, nguồn lực đã lưu và validator Match Service. Phương án tự động vẫn ở trạng thái đề xuất cho tới khi BTC xử lý trong danh sách.
- Công đoạn 4 mặc định là danh sách trận. Lịch trực quan và sơ đồ vẫn có thể chọn; trạng thái chưa có lịch không giả dạng lịch hoàn chỉnh. Bản xem trước dùng lịch đang lọc. “In lịch” và “Xuất PDF” mở hộp thoại in của trình duyệt; “Xuất Excel” tải CSV UTF-8 có thể mở bằng Excel, không phải tệp XLSX.
- Công đoạn 5 chỉ tổng kết số trận, số đã xếp, số còn thiếu và trạng thái kiểm tra. Công bố bị khóa khi còn trận thiếu, lỗi bắt buộc hoặc validator chưa kiểm tra xong. Không yêu cầu phân công trọng tài.

## Cập nhật gộp Công đoạn 4–5 — 24/11/2026

- Thanh tiến độ của workspace lập lịch hiện có bốn công đoạn. Công đoạn 4 mang tên “Kiểm tra & công bố”; nội dung rà soát, lịch theo ngày/sân, sơ đồ, bản in/PDF/CSV và tóm tắt công bố nằm cùng công đoạn.
- Công đoạn 3 giữ phương án tự động ở cùng màn, không tự chuyển bước sau khi chạy. Nút “Tiếp tục” chỉ bật khi đủ lịch đã lưu, không còn phương án giả lập chưa xác nhận và Match Service không trả lỗi bắt buộc. Lập thủ công tiếp tục mở danh sách/biểu mẫu ngay trong Công đoạn 3.
- Công đoạn 4 hiển thị lịch đã lưu, ở chế độ chỉ xem; chỉnh sửa đi qua nút “Quay lại điều chỉnh”. Nút xuất dữ liệu được ghi “Xuất CSV”; không tạo XLSX.
- Shell bốn công đoạn này hiện thuộc `DrawDemoScheduleWorkspace` development-only. Luồng live dùng `ScheduleManagementPanel` riêng, chưa được chuyển sang cùng shell bốn công đoạn.
- Kiểm tra UI qua browser trên giải development `95f79e55-e6f0-5177-a2e2-d9fe62760dcd`: 4 công đoạn hiển thị; snapshot development có 8 nháp/12 trận và 4 thiếu; “Tiếp tục” bị khóa. Chạy thử tự động trả 0/4 do ràng buộc nguồn lực, ở lại Công đoạn 3 và giữ 8 nháp. Công đoạn 4 đọc 8 lịch đã lưu và khóa chỉnh sửa trong chế độ rà soát.
- API production trả 0 match, 0 schedule và 0 sân hoạt động cho các giải được tài khoản demo phân công. Vì vậy không có dữ liệu thật để hoàn tất publish/reload qua bảng lịch chính thức. Snapshot development vẫn tách khỏi bảng lịch chính thức; không reset/xóa dữ liệu và không dùng snapshot làm lịch official.
- Web-client typecheck và production build PASS; build vẫn cảnh báo bundle JavaScript trên 500 kB. Luồng công bố qua API production chưa được nghiệm thu.

## Cập nhật bố cục Stage 3–4 — 24/11/2026

- Stage 3 có ba chỉ số (tổng trận, sân khả dụng, đã xếp/tổng), trạng thái lịch, nút tự động/thủ công và danh sách nhóm thu gọn theo bảng/vòng. Chọn trận ở danh sách, lịch ngày/sân hoặc sơ đồ mới mở drawer “Điều chỉnh trận đấu” trượt từ mép phải; trận được chọn có viền nổi bật. Lưu gọi luồng Match Service của workspace development.
- Stage 4 đưa kết quả validation và năm chỉ số lên đầu, danh sách vẫn nhóm theo bảng/vòng, bộ lọc hỗ trợ giai đoạn/bảng/vòng/từ ngày/đến ngày/sân/trạng thái. In/PDF/CSV được đặt trong menu nhỏ cạnh tabs; CSV vẫn là CSV UTF-8.
- Browser check trên snapshot development: 4 công đoạn; 12 fixtures `TEST-*`, 8 bản nháp, 4 trận chưa xếp; Stage 3 tiếp tục disabled do validator; Stage 4 có lỗi cụ thể về xác nhận thông số và thời gian chiếm dụng vượt khung. Chọn trận từ calendar và sơ đồ bảng mở chi tiết chỉ đọc ở Stage 4. Chọn trận ở Stage 3 rồi đổi từ danh sách sang lịch ngày/sân vẫn giữ đúng trận đã viền nổi bật.
- Desktop được kiểm tra trong trình duyệt; drawer dùng modal trượt từ bên phải và phần lịch dùng toàn bề ngang khi drawer đóng. Không kiểm thử xuất tệp, in, mobile/tablet, hoặc chỉnh/lưu một lịch hợp lệ vì snapshot có lỗi cấu hình/khả dụng.
- Sửa lỗi danh sách tràn viền: các hàng grid của nhóm lịch không còn co thấp theo `max-height`; từng nhóm giữ chiều cao theo nội dung, danh sách cuộn dọc. Bảng dùng layout cố định, nội dung ô tự xuống dòng. Browser đo chiều rộng cuộn ngang bằng chiều rộng khung (475 px), còn tổng danh sách cuộn dọc (2,563 px trong khung cao 584 px).

## Cập nhật lập lịch kết hợp Stage 3 — 24/11/2026

- Bỏ nút/chế độ “Lập lịch thủ công”; Stage 3 luôn hiện ba chế độ xem khi có fixtures. Chọn một trận mở form ngày/giờ/sân bên phải. Nút duy nhất “Tạo lịch tự động” chuyển xuống dưới khu vực xem lịch; phần nâng cao chỉ chỉnh phạm vi/mục tiêu và không còn nút chạy thứ hai.
- Chạy tự động tiếp tục tạo preview; không tự ghi đè lịch đã lưu. Mặc định scope chỉ lấy trận chưa xếp, cấu hình có thể cho phép xem xét các lịch chưa khóa; planner vẫn đóng băng trận khóa. Trước khi chạy, form đang chỉnh dở phải được lưu hoặc hủy.
- Lưu chỉnh sửa, khóa và mở khóa ở workspace development nay đợi commit CAS tới API test-workflow trong Match Service. Khóa được lưu riêng trong `DemoScheduleEntry.locked`; trạng thái công bố vẫn là `schedulePublishedAt`/`publishedAt`. Backend test-workflow hiện có guard cấm sửa/xóa entry đã khóa.
- Trạng thái trên danh sách/calendar/diagram có nhãn và biểu tượng: khóa xanh, đang chỉnh sửa/chưa lưu cam, đã xếp chưa khóa trung tính, chưa xếp đỏ, phương án chưa lưu cam; Stage 4 tổng hợp thêm số trận khóa. Công bố không yêu cầu tất cả trận phải khóa.
- Browser xác nhận đúng một nút “Tạo lịch tự động”, không có nút “Lập lịch thủ công”, nút nằm dưới danh sách; chọn trận mở form. Run bị disabled vì chưa có sân khả dụng đã xác nhận. Form hiện lỗi nguồn lực và nút lưu disabled; không thực hiện mutation.
- **Giới hạn official:** thao tác trên vẫn thuộc development test-workflow snapshot API. Luồng live `ScheduleManagementPanel` chưa được tích hợp với thuật toán này; schema/API live chưa cung cấp cờ khóa lịch riêng. Không tuyên bố khóa, auto scheduling hoặc publish đã nghiệm thu trên lịch official. Read-only GET snapshot hiện trả revision 11, 0 lịch nháp và 3 sân. Tài liệu handoff trước ghi revision 92/8 bản nháp; nguyên nhân khác biệt chưa xác định. Không chủ động gọi reset hoặc mutation. Vì client trước đây tự khởi tạo snapshot khi lệch phiên bản sơ đồ, không thể loại trừ side effect từ effect cũ; effect này nay đã được sửa để giữ snapshot cũ và chuyển sang chỉ đọc.
- Phân biệt nguồn dữ liệu: workspace bốn công đoạn trong `DrawDemoScheduleWorkspace` vẫn gọi endpoint snapshot development, không ghi lịch chính thức. Luồng live trong `ScheduleManagementPanel` chưa được chuyển sang shell này. API production của giải demo hiện không có trận/lịch/sân hoạt động, nên publish chính thức và tải lại vẫn **NOT TESTED**.
- Sau thay đổi bố cục, web-client typecheck và production build đều PASS; build cảnh báo bundle JS khoảng 1.23 MB.

## Cập nhật form Trợ lý lập lịch — 24/11/2026

- Công đoạn 3 hiển thị trực tiếp form “Trợ lý lập lịch · Match Service”: thống kê bốn mục, bộ chọn giai đoạn, bảng/vòng/lượt dạng dropdown tìm kiếm có checkbox, khoảng ngày theo thời gian giải, tùy chọn chỉ lấy trận chưa có lịch và danh sách trận cụ thể thu gọn có tìm kiếm.
- Mục tiêu tối ưu dùng danh sách card có nút tăng/giảm thứ tự; thứ tự cấu hình được gửi cùng yêu cầu preview hiện có. Nút “Đặt lại” chỉ đặt lại bộ lọc, “Hủy phương án” chỉ gọi luồng xóa preview, và chỉ còn một nút “Tạo lịch tự động” trong form.
- Số trận thuộc phạm vi dùng chung hàm chọn trận của thuật toán. Thống kê fixtures, sân khả dụng và khóa được lấy từ snapshot API test của workspace development. Luồng live trong `ScheduleManagementPanel` vẫn chưa dùng form này.
- Browser desktop xác nhận form không tràn ngang, hai cột khoảng 65/35, dropdown tìm kiếm mở đúng, danh sách trận thu gọn mặc định và không dùng `select[multiple]`. Auto preview được bấm trên giải demo nhưng API trả 409; không retry, reset, lưu nháp, khóa hoặc công bố.
- Typecheck và production build PASS; Vite vẫn cảnh báo bundle JavaScript vượt 500 kB. Không xác nhận được mobile bằng viewport browser trong lượt này; các bộ lọc lưu backend, thứ tự ưu tiên qua preview thành công, reset, hủy preview và lịch official chưa được kiểm thử đầu-cuối.

## Chạy lại lập lịch demo — 24/11/2026

- Lỗi ban đầu: Match Service container cũ hơn source. Với 12 fixture đều là vòng bảng, API vẫn chặn bốn provenance `knockoutTiming.*` chưa xác nhận. Rebuild riêng `match-service` đã làm validator bỏ qua đúng thông số knockout không áp dụng cho thể thức vòng tròn; validation sau rebuild trả 0 lỗi.
- Sửa race revision: trước khi chạy, client đọc revision mới nhất từ Match Service, so sánh bản nháp/nguồn lực/phương án để không ghi đè dữ liệu khác phiên, rồi nhận snapshot preview đã lưu từ API mà không gửi PUT trùng. Chữ ký preview được so với snapshot nguồn lực thô dùng cho thuật toán, không dùng bản chuẩn hóa của form.
- PASS end-to-end trên giải demo: trước thao tác đã có 11 lịch khóa hợp lệ và còn `TEST-2-R3-L1-M2`. Match Service tìm được lịch cho trận còn thiếu, kiểm tra trả 1 hợp lệ/0 lỗi/0 cảnh báo; BTC lưu và khóa trận này. Sau đó API trả 12/12 trận có lịch, 12 khóa, 0 thiếu, không có lỗi validation.
- PASS reload: tải lại workspace vẫn thấy 12/12 lịch, Công đoạn 3 sẵn sàng và Công đoạn 4 hợp lệ. Không gọi API lịch official; dữ liệu vẫn nằm trong snapshot `test-workflow`.
- Sau reload, API test snapshot hiện có `schedulePublishedAt` lúc `2026-11-23T21:39:49.649Z` và giao diện ghi “Đã công bố (sandbox)”. Trong lượt chạy này tôi không bấm “Công bố lịch”; không xác định được thao tác nào khác đã đặt cờ này. Bảng lịch official không được thay đổi.
- Web-client typecheck/build PASS; `schedulingEngine.test.cjs` PASS 19/19. Build vẫn cảnh báo bundle JavaScript trên 500 kB.
