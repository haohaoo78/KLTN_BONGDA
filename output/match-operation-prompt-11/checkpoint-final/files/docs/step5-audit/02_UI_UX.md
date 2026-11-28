# Kiểm kê giao diện Bước 5

## 1. Wireframe quan sát được

```text
BTC → Giải đấu của tôi → Quản lý giải
┌ Thông tin giải · tiến độ workflow · stepper 8 bước ┐
│ 1 Thông tin │ 2 Chốt đội │ 3 Bốc thăm │ 4 Sơ đồ │ 5 Lập lịch │ 6 Trọng tài │ 7 Điều hành │ 8 Tổng kết │
└────────────────────────────────────────────────────┘
┌ BƯỚC 5 · DỮ LIỆU KIỂM THỬ CỤC BỘ ──────────────── [Bản lịch nháp] [Reset test] ┐
│ Lập lịch thi đấu · giải · thể thức · số trận từ Bước 4                           │
├ Thời gian giải │ Thể thức │ Đội chính thức │ Snapshot sơ đồ                      ┤
├ Tổng trận │ Đã lập lịch │ Chưa lập lịch │ Sân phù hợp đang hoạt động             ┤
├ Việc tiếp theo đề xuất + giờ sân lý thuyết / nhu cầu + CTA                       ┤
├ Sân & địa điểm │ Thiết lập │ Kiểm tra lịch          [Lập lịch tự động] [Kiểm tra] ┤
├ [Thủ công] [Tự động]                       [Sơ đồ] [Lịch trực quan] [Danh sách]   ┤
├ Cấu hình auto nếu chọn AUTO                                                      ┤
├ Tìm trận | Giai đoạn | Bảng | Vòng | Ngày | Sân | Trạng thái | Xóa lọc          ┤
├ Sơ đồ dùng chung Bước 4                          │ Panel chi tiết trận            ┤
│ zoom/fullscreen; click card mở form             │ ngày → sân → giờ → ghi chú    │
├ Tiến độ lịch / Kiểm tra & công bố                                               ┤
└─────────────────────────────────────────────────────────────────────────────────┘
```

Đây là wireframe của nhánh test hiện tại, không đại diện cho `ScheduleManagementPanel` API cũ.

## 2. Giao diện chính

Tệp: [DrawDemoScheduleWorkspace.tsx](../../apps/web-client/src/components/DrawDemoScheduleWorkspace.tsx), phần render bắt đầu khoảng dòng 853.

### Header, tóm tắt và hướng dẫn

- Nhãn “BƯỚC 5 · DỮ LIỆU KIỂM THỬ CỤC BỘ”, tên “Lập lịch thi đấu”, tên giải, thể thức và số fixtures kế thừa Bước 4.
- Badge “Bản lịch nháp” hoặc “Đã công bố · vN”; nút “Reset dữ liệu test Bước 5”.
- Bốn thông tin đọc-only: thời gian giải, thể thức, số đội chính thức và version snapshot sơ đồ.
- Bốn thẻ thống kê: tổng trận, đã lịch, chưa lịch, số sân hoạt động đúng loại bóng.
- Khối “Việc tiếp theo đề xuất” đổi theo điều kiện: thêm sân; xác nhận phương án; lập lịch; kiểm tra/công bố; hoặc chuyển Bước 6. Hiện công suất lý thuyết và nhu cầu sơ bộ, kèm lời nhắc công suất lý thuyết không bảo đảm tìm thấy lịch khả thi.

### Toolbar và chế độ

- Nút mở modal **Sân & địa điểm · số sân**, **Thiết lập**, **Kiểm tra lịch**.
- Nút mở phương thức tự động và nút mở tab Kiểm tra & công bố.
- Chọn **Lập lịch thủ công** hoặc **Lập lịch tự động**.
- Ba chế độ **Sơ đồ thi đấu**, **Lịch trực quan**, **Danh sách**; chỉ render chế độ chọn. Ba view đọc cùng `visibleEntries`/state lịch.
- Khi công bố, chỉnh sửa và nút auto bị khóa; xem sơ đồ/lịch/danh sách tiếp tục dùng dữ liệu lịch chính thức.

## 3. Các view

### Sơ đồ

`DrawDemoFixtureWorkspace` được tái sử dụng ở chế độ diagram-only, read-only về cấu trúc trận. Tìm kiếm/lọc ngoài workspace tác động vào tập trận hiển thị. Sơ đồ có zoom giảm/tăng, mặc định, toàn màn hình, legend trạng thái; fixture được bấm để mở panel Bước 5. Không tạo lại trận. Vòng tròn vẫn có hai chế độ sơ đồ ghép cặp/toàn bộ vòng đấu; bảng và vòng lọc áp vào sơ đồ.

Vòng tròn hiển thị nhóm/bảng, card đội/trận, lượt nghỉ nếu có. Knockout hiển thị các vòng và nguồn đội/đường nhánh. Kết hợp hiển thị bảng và cây theo component Bước 4. Trong các nhánh giải đã công bố thật, component có thể khác theo mode test/API; audit không khẳng định public viewer dùng chung nguồn state local test.

### Lịch trực quan

- Chia theo ngày rồi theo lane sân.
- Mỗi event có vị trí ngang theo giờ bắt đầu, chiều rộng tương ứng phút chiếm dụng; thể hiện mã trận/vòng và thời lượng chiếm sân.
- Bấm event mở panel chi tiết trận chung.
- Nếu không có lịch, hiển thị empty state.
- Không có weekly grid riêng; “Lịch trực quan” hiện là trục ngày/sân theo state. Không có địa điểm grouping sâu hơn venue.

### Danh sách

Bảng đọc chung source với sơ đồ: mã trận (click), giai đoạn/bảng/vòng/lượt, đội hoặc nguồn đội, ngày/giờ/kết thúc dự kiến, sân, trạng thái. Tìm kiếm/bộ lọc phía trên áp vào danh sách. Đây là view được người dùng yêu cầu, không phải bảng dư thừa dưới sơ đồ.

## 4. Panel lập lịch thủ công

Panel phải mở sau khi chọn fixture. Ban đầu hiện thông báo chọn trận; mã trận, đội/nguồn, bảng, vòng, giai đoạn là chỉ đọc. Khi đã có lịch và không ở trạng thái edit, panel hiển thị ngày, giờ bắt đầu/kết thúc theo thời lượng trận, sân/địa điểm, phút thi đấu/phút sân bị chiếm và ghi chú.

Khi tạo/sửa: ba dropdown theo thứ tự **ngày khả dụng → sân khả dụng → giờ hợp lệ**. Đổi ngày xóa sân/giờ phụ thuộc; đổi sân xóa giờ. Giờ chỉ lấy từ ứng viên đã được kiểm tra, có label khung giờ, bắt đầu và kết thúc. Có duration summary, ghi chú, lỗi lưu, nút lưu và các nút thao tác lịch hiện có (sửa, xóa, khóa/mở khóa); published/locked chặn form. Ghi chú nhập tự do.

Nếu điều lệ yêu cầu vòng cuối đồng giờ, có khối xếp cụm: chọn bảng, chọn giờ chung, lưu toàn cụm; nếu không bật hoặc không có nhiều trận vòng cuối thì không render.

## 5. Lập lịch tự động

Component [DrawDemoAutomaticSchedulePanel.tsx](../../apps/web-client/src/components/DrawDemoAutomaticSchedulePanel.tsx) chỉ xuất hiện khi chọn AUTO:

- Phạm vi: toàn giải, vòng bảng, knockout theo fixtures hiện có; multi-select bảng/vòng; checkbox “Chỉ lập lịch các trận chưa có giờ”; số trận trong phạm vi.
- Mục tiêu có thể sắp ưu tiên: hoàn thành sớm, sử dụng sân, công bằng sân/giờ, nghỉ, cân bằng nghỉ nhánh, sân trung tâm. Hai mục tiêu nhánh/sân trung tâm chỉ hiện khi có knockout.
- “Tạo đề xuất lịch”/“Chạy lại”, “Hủy đề xuất”, “Áp dụng phần đã bố trí vào bản nháp”. Có loading/error state.
- Kết quả báo COMPLETE/PARTIAL/TIMEOUT/INFEASIBLE/NO_TARGETS, số trận, thời gian ms, bước tìm, giới hạn tìm kiếm, danh sách tối đa 20 trận thiếu và lý do/cảnh báo.
- Bấm một fixture ở sơ đồ khi AUTO mở panel xem đề xuất; không chỉnh trực tiếp trong panel.

UI hiện không có lựa chọn phạm vi theo ngày hoặc đợt độc lập dù prompt yêu cầu ngày/đợt; source `AutoScheduleConfiguration` và panel chỉ dùng phase/groups/rounds/onlyUnscheduled.

## 6. Modal sân, thời gian và ràng buộc

Mở chủ động từ toolbar; component [DrawDemoScheduleSettingsPanel.tsx](../../apps/web-client/src/components/DrawDemoScheduleSettingsPanel.tsx). Header nêu dữ liệu lưu trên trình duyệt, không DB. Ba nhãn điều hướng **Thời gian**, **Sân**, **Ràng buộc**; chỉ một section hiển thị. Có nút đóng/lưu; dữ liệu draft chỉ áp dụng qua callback sau validation. Không có nhiều wizard bắt buộc.

### Thời gian

- Ngày bắt đầu/kết thúc; checkbox ngày trong tuần.
- Một/nhiều slot: nhãn, giờ bắt đầu/kết thúc, priority; thêm/xóa slot.
- Ngày nghỉ/blocked date thêm/xóa.
- Profile riêng vòng bảng/knockout: phút mỗi hiệp, nghỉ giữa hiệp, chuẩn bị, chuyển tiếp, dự phòng hiệp phụ và penalty. Hiển thị tổng tính từ các trường.
- Ràng buộc: ngày phải theo thứ tự; cần ít nhất một ngày/slot; slot hợp lệ; thời lượng hiệp > 0.

### Sân

- Danh sách có tìm kiếm theo mã/tên/địa điểm; filter tất cả/đang hoạt động/ngừng hoạt động.
- Thêm/sửa sân trong form cùng modal; trường mã, tên, địa điểm, loại sân mặc định từ loại hình giải, trạng thái, weekday, giờ mở, chuyển tiếp/turnaround, travel zone, sân trung tâm, giai đoạn ưu tiên, sân nhà và khoảng không khả dụng (từ schema `DemoScheduleVenue`).
- Lưu bắt buộc mã/tên/địa điểm/ngày/khung giờ hợp lệ, mã duy nhất, khoảng blackout hợp lệ.
- Có xóa sân (nếu không làm mất validity liên quan) và xác nhận khi các lịch hiện tại bị ảnh hưởng; nguồn code phân tích issues trước/sau config, giữ lịch cũ nếu BTC xác nhận.
- Không có lựa chọn “đã đặt/đã thuê” hoặc xác nhận ngoài hệ thống; UI nhắc sân chưa được coi là đã đặt.
- Schema không tách entity “địa điểm tổ chức” khỏi sân độc lập; `location`/`travelZone` là thuộc tính text sân.

### Ràng buộc

Các trường trong local state gồm nghỉ tối thiểu đội, trận tối đa/đội/ngày, buffer di chuyển, giới hạn vòng/ngày và cờ bắt buộc, yêu cầu đồng giờ vòng cuối, chế độ tập trung/home-away, giới hạn chênh nghỉ knockout và cờ required, xoay tua sân/slot, sân trung tâm/giai đoạn ưu tiên. Form kiểm tra giá trị âm, cờ required phải có ngưỡng số dương. Các trường khác do schema hỗ trợ nhưng phần form cần đối chiếu source cụ thể khi thiết kế lại.

## 7. Kiểm tra và công bố

Tab **Kiểm tra và công bố** hiển thị tổng trận, đã lịch/thiếu, lỗi HARD và cảnh báo mục tiêu, khoảng ngày/địa điểm, preview công khai. Preview công khai giới hạn một phần entry, không phải toàn bộ lịch. Có nút công bố; disabled nếu không đủ lịch hoặc có config/constraint/hard objective issue. Cảnh báo không bắt buộc yêu cầu BTC xác nhận trong hộp thoại.

Khi publish test: đọc lại state mới, xác minh snapshot Bước 4 và signature; chạy validation lại; tạo version record, người/giờ công bố và copy `scheduleByFixture` sang `publishedScheduleByFixture`; remove referee names; ghi localStorage; callback chuyển sang Bước 6. Không cần và không kiểm tra phân công trọng tài.

## 8. Reset và các form API cũ

- Reset test Bước 5 có hộp thoại; gọi `resetDrawTestStep5`, xóa lịch, config/resources và dữ liệu referee downstream trong local state, giữ Bước 3/4. Tuy nhiên utility đặt `currentStep: 6` (vị trí nội bộ legacy cho step 5) chứ không rõ nghĩa step hiển thị, cần lưu ý tương thích.
- API mode `ScheduleManagementPanel` không phải UI thiết kế mới: quản lý sân/lịch và referee form chung, có form chọn giải/match, ngày/giờ/sân/trọng tài; filters theo từ khóa, trạng thái, referee; bảng schedules, bulk publish drafts, detail drawer, lịch sử đổi schedule/crew. Nó giữ persistence thật qua API.

## 9. Đánh giá UX thao tác

Tính toán ngày/sân/giờ hợp lệ giúp tránh tự dò thủ công. Các thông tin có thể kế thừa từ Bước 4 được giữ read-only. Tuy vậy BTC còn phải tự cấu hình thủ công nhiều trường nguồn lực/ràng buộc; một số giá trị mặc định được đề xuất chưa có provenance field rõ ràng (kế thừa điều lệ vs hệ thống đề xuất vs BTC nhập). Không có weekly/location calendar, bulk lock, hoặc hệ phân tích công suất lịch thực khả thi; capacity chỉ là tổng phút lý thuyết. Việc chỉnh venue có lịch cần tự đọc các issues để biết trận ảnh hưởng, không có trung tâm issues với nút điều hướng fixture được thấy trong source UI hiện tại.
