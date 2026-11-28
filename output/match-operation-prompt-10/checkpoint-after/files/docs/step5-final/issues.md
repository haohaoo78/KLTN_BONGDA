# Vấn đề đã sửa và còn tồn tại

## Đã sửa trong Giai đoạn 9

Không có thay đổi source code trong lượt nghiệm thu này vì chưa tái hiện được lỗi triển khai an toàn cần sửa. Không ghi nhãn PASS chỉ nhờ build hay source inspection.

## Còn tồn tại / cần quyết định

1. **Bằng chứng chưa đủ cho nghiệm thu toàn bộ:** chưa chạy các mutation chính của Step 5 và publication; không có đủ screenshots trạng thái yêu cầu.
2. **Tài liệu thiếu:** không tìm thấy SRS và nguyên văn kết quả Prompts 1–6; tài liệu audit ghi thiếu các prompt này.
3. **Inconsistent format metadata:** danh sách BTC/heading giải ghi “Vòng tròn”, nhưng dữ liệu draw và panel lập lịch là “Loại trực tiếp”; snapshot có 7 trận KO. Xác minh nguồn authoritative trước khi sửa metadata.
4. **Thiết lập rỗng:** modal báo 0 sân, 0 slot, thời lượng 0, 5 cấu hình chưa xử lý; phù hợp trạng thái thiếu setup nhưng giao diện tóm tắt thời lượng vòng bảng trong khi giải đang KO. Cần đánh giá logic stage-aware.
5. **10 issues trên khu vực Hoàn tất** dù danh sách trước mắt chỉ nêu ba issue và gợi ý xem toàn bộ. Cần kiểm tra UX issue grouping/detail khi có fixture cấu hình thực.
6. **Lỗi suite planner đã biết từ Giai đoạn 8:** hai test lỗi `minute-precise scan must keep the only earliest valid kickoff` và `candidate-search cutoff is reported as inconclusive`; chưa chạy lại trong lượt này, không rõ trạng thái hiện tại.
7. **Giới hạn kiến trúc đã ghi nhận:** endpoint/API là development test workflow, không thay production schedules lifecycle; chưa có workflow điều chỉnh lịch chính thức, thông báo người liên quan, hay tối ưu hóa kịch bản ảnh hưởng.
8. **Giao dịch phụ thuộc:** audit Giai đoạn 7 nêu xử lý nguyên tử theo cụm phụ thuộc khi delete/lock chưa hoàn thiện; chưa có bằng chứng sửa hoặc kiểm thử.
9. **Runtime data ownership:** flow test snapshots tách khỏi bảng lịch official; không được diễn giải sandbox publication là công bố production.

## Không làm trong lượt này

Không reset DB/volume/snapshot, không đổi SMTP, không chỉnh đội hoặc fixture, không tạo dữ liệu thay thế cho KO32, không công bố lịch thật, không triển khai thêm Bước 6.

## Cập nhật Prompt 9 – 23/11/2026

### Đã sửa trong phạm vi Bước 5

1. Bỏ lớp modal bao ngoài của workspace Bước 5; chia nội dung thành năm công đoạn chỉ hiển thị phần đang làm. Thiết lập venue và cấu hình thời gian chuyển sang màn hình tại chỗ. Lập tự động và review/công bố không còn modal lớn; modal còn lại dùng cho thao tác xem/sửa từng fixture.
2. Manual mode chuyển thẳng tới danh sách fixture chưa xếp, tránh picker modal lớn.
3. Route `GET /schedules/test-resource-presets` được đăng ký trước route động `GET /schedules/:id`; trước đó request bị coi là schedule UUID và trả 500. Sau migration, API GET trả 200.
4. API phân tích đề xuất mới làm mới giá trị system/calculated chưa được BTC xác nhận, giữ nguyên giá trị đã xác nhận hoặc đang BTC chỉnh; analysis hiện dùng candidate resources mà editor áp dụng. So sánh ngày được chuẩn hóa về `YYYY-MM-DD`, tránh so sánh sai với timestamp `YYYY-MM-DDT...`.
5. Sửa giá trị đề xuất thời lượng hiệp từ `(duration - halftime break) / 2` sang `duration / 2`, khớp validator quy định tổng hai hiệp bằng thời lượng trận. Lọc thông số theo các giai đoạn thực sự có trong fixture để không yêu cầu xác nhận cấu hình cho giai đoạn không tồn tại.
6. Khi giải chưa có trận được xếp, lưu nguồn lực mới thẳng vào snapshot Step 5 và bỏ phân tích ảnh hưởng không cần thiết. Khi đã có lịch thì vẫn gọi resource impact trước khi lưu.
7. Reset development chuyển sang DELETE snapshot phía backend có CAS revision. Preset sân/địa điểm ở bảng riêng; Bước 4 không bị reset.

### Còn tồn tại / chưa nghiệm thu

- Snapshot giải hiện vẫn có 25 phút/hiệp dù điều lệ yêu cầu tổng 60 phút. Phân tích read-only đề xuất 30 phút/hiệp; phải được BTC mở thiết lập, xem lại và lưu. Không tự ghi đè snapshot hiện có.
- Chưa có sân/địa điểm xác nhận khả dụng, vì vậy tự động/thủ công chưa thể tạo lịch thực tế. Thông tin địa điểm dạng văn bản “SFL Demo Stadium · Khuôn viên IUH” trên giải chưa đủ để tự tạo một venue ID/khả dụng.
- POST lưu preset, POST lưu nguồn lực, reset dev, manual/automatic scheduling, lock, publish và reload sau mutation chưa được chạy để tránh thêm/xóa dữ liệu trong giải đang dùng. Không đánh dấu PASS.
- Viewport mobile, error stream notifications và nhiều tab chưa nghiệm thu. SSE `/api/notifications/events` có `ERR_INCOMPLETE_CHUNKED_ENCODING` sau khi restart container; cần kiểm tra riêng.
- Bản runtime quan sát là 12 fixture vòng tròn, 8 đội. Không kiểm thử thể thức loại trực tiếp/hỗn hợp hoặc dữ liệu KO 32 đội trong lượt này.

## Cập nhật Prompt 9A – 23/11/2026

### Đã sửa

1. Tổ chức Bước 5 thành 5 công đoạn tại nội dung chính; Công đoạn 1 hiển thị quản lý sân và mẫu giờ trực tiếp, Công đoạn 2 đặt thông số và phân tích nguồn lực thành hai cột. Không thay đổi API nghiệp vụ của các công đoạn còn lại.
2. Ảnh runtime phát hiện CSS của shell cấu hình vẫn dành 230px cho menu phụ đã bỏ, làm ép hai cột vào vùng rất hẹp. Đã chuyển shell cấu hình sang chiều rộng đầy đủ và chụp lại ảnh sau khi recreate web-client.

### Còn tồn tại / chưa kiểm thử

1. Đã lưu snapshot hiện có (revision 2→3), preset hiện có (v0→v1), tạo `Sân QA 9A`, áp dụng mẫu hàng loạt cho riêng sân QA (revision 4), chỉnh tên/lưu (revision 5), GET/reload xác nhận. Hai sân gốc giữ nguyên. QA venue được giữ trong snapshot development; chưa gọi CRUD bảng `/venues` chính thức.
2. Phân tích backend cho 12 trận báo nhu cầu 17.6 giờ sân, 0 sân đã xác nhận và 0 giờ sân khả dụng; cần nguồn lực được BTC xác nhận trước khi kiểm tra lập lịch.
3. Sau khi reload trang quan sát thấy lỗi SSE `GET /api/notifications/events` → `ERR_INCOMPLETE_CHUNKED_ENCODING`. Đây là lỗi thông báo ngoài phạm vi thay đổi giao diện, chưa điều tra.
4. Build Vite thành công nhưng còn cảnh báo bundle JavaScript khoảng 1.19 MB.
5. Chưa kiểm thử chỉnh thông số cơ bản/đề xuất và reload, CRUD venue API chính thức, các thể thức KO/hỗn hợp, hoặc mutation tạo/khóa/công bố lịch.
6. Lỗi làm mất bản nháp khi đổi công đoạn đã được khắc phục: setup component được giữ mounted; đổi tab cấu hình chỉ đổi nội dung, không nạp lại draft. Đã thử trên browser: giá trị 11 phút và 08:30 vẫn còn sau chuyển 1↔2 và 1→3→1; reload bỏ các thay đổi chưa lưu, dữ liệu backend đã lưu được khôi phục.
7. Đã ổn định vòng lặp cập nhật không cần thiết khi danh sách fixture được tạo lại mỗi render. Fixture list dùng memo và nhánh không có trận đang chọn không gọi state setter khi state đã rỗng.
8. Docker CLI không có trong PATH ở môi trường hiện tại. Lệnh build container sau sửa cuối chưa chạy; typecheck, build Vite và browser runtime source đã chạy trên cổng 5175. URL 5173 là container/runtime trước sửa cuối.
9. Đã sửa lỗi tràn hàng sân: quy tắc CSS 5 cột ghi đè lưới 6 cột, khiến status bị nén và menu chồng lên checkbox. CSS scope theo workspace nay giữ đủ sáu cột ở màn rộng; màn hẹp xếp status xuống hàng riêng. Browser kiểm tra tại 1280px và CSS 625px đều không tràn.
10. Biểu mẫu thêm/chỉnh sân trước đây được chèn dưới danh sách. Đã chuyển vào modal dùng chung; form cuộn bên trong dialog, còn danh sách bên dưới không bị đẩy dài. Kiểm tra mở modal thật, không lưu thay đổi trong lượt này.
11. Menu ba chấm từng bị cắt bởi `overflow:hidden` của nhóm sân và `overflow:auto` của danh sách con. Đã bỏ clip/scroll lồng ở workspace sân, nâng z-index cho hàng có menu mở; kiểm tra cả hai sân: toàn bộ sáu hành động, gồm “Xóa”, hiển thị và click target còn trong menu.
12. Menu ba chấm đã hỗ trợ đóng khi click ra ngoài, nhấn Escape hoặc chọn một thao tác. Browser xác nhận đủ ba đường đi; lựa chọn “Xem chi tiết” đóng menu trước khi mở drawer.

## Cập nhật gộp Công đoạn 4–5 — 24/11/2026

### Đã sửa

1. Workspace lập lịch dùng bốn công đoạn; rà soát và công bố ở cùng Công đoạn 4. Stage 3 giữ nguyên sau khi chạy tự động, tiếp tục bị khóa đến khi mọi lịch được lưu và Match Service xác nhận hợp lệ.
2. Stage 3 giữ danh sách, lịch ngày/sân, sơ đồ và thao tác thủ công để điều chỉnh. Stage 4 đọc lịch đã lưu, không cho sửa/xóa/khóa tại màn rà soát; cung cấp “Quay lại điều chỉnh” và nút chính “Công bố lịch”.
3. Stage 4 sau khi công bố nằm lại ở Bước 5 để hiện trạng thái; callback tự chuyển sang Bước 6 đã bị bỏ khỏi luồng sandbox.
4. Tiện ích xuất được ghi “Xuất CSV”; bản tải hiện là CSV UTF-8.
5. Danh sách Stage 3 được phân nhóm bảng/vòng; khung điều chỉnh là modal trượt từ mép phải, chỉ mở khi chọn trận, đồng thời làm nổi viền trận đó trong cả ba view. Stage 4 đưa validation/tổng quan lên đầu, bổ sung lọc ngày theo khoảng và đặt in/PDF/CSV trong menu nhỏ cạnh tabs.
6. Sửa lỗi bảng trận tràn viền: đặt hàng nhóm theo `max-content`, giữ bảng trong khung với layout cố định và cho chữ tự xuống dòng. Kiểm tra browser xác nhận không còn tràn ngang; danh sách dài cuộn dọc.

### Kiểm thử và giới hạn

- PASS: browser hiển thị đúng 4 công đoạn; bước Continue ở Stage 3 bị khóa khi snapshot có 8/12 trận đã lưu, 4 trận thiếu và lỗi validator. Tạo tự động trả 0/4 do cấu hình/nguồn lực không hợp lệ và vẫn ở Stage 3, không xóa 8 bản nháp. Stage 4 đọc các lịch đã lưu, cho lọc/xem, và chi tiết trận ở chế độ chỉ đọc. Đã kiểm tra chọn trận trong danh sách, lịch ngày/sân và sơ đồ; Stage 3 mở modal bên phải và giữ viền trận đang chọn khi chuyển sang calendar.
- PASS: Stage 4 hiển thị lỗi cụ thể, các chỉ số, bộ lọc gồm từ ngày/đến ngày và các tiện ích In lịch/Xuất PDF/Xuất CSV. Xem trước CSV lấy 8 lịch đã xếp trong snapshot (không click tải tệp hoặc mở hộp thoại in).
- PASS: desktop vùng hai cột 840 px: browse 554 px, panel 270 px, không chồng lấn.
- NOT TESTED: công bố lịch chính thức, tải lại lịch chính thức, và kiểm tra chặn công bố qua bảng lịch production. Tài khoản demo có 0 match, 0 schedule và 0 sân hoạt động trong các API production; các fixture `TEST-*` chỉ thuộc draw/schedule test snapshot nên không được dùng để tạo lịch official.
- Shell bốn công đoạn hiện chỉ nằm trong `DrawDemoScheduleWorkspace` development-only; luồng live vẫn dùng `ScheduleManagementPanel` riêng và chưa được chuyển sang cùng shell. Chưa hoàn tất việc gắn scheduler Step 3 vào bảng lịch official; không suy diễn snapshot `TEST-*` thành Match ID thật.
- Sau một lần thao tác browser với locator đã cũ, Match Service báo lưu cấu hình nguồn lực snapshot development; API hiện đọc revision 92, giữ 8 bản nháp, 0 lịch được công bố và 5 sân trong snapshot. Không có lịch/bản ghi production bị xóa hoặc công bố. Không reset database hay volume.
- Web-client typecheck và production build PASS; Vite tiếp tục cảnh báo bundle JavaScript khoảng 1.22 MB. Vì production dataset không có fixture/sân thật, chưa thể nghiệm thu toàn bộ “lập lịch → lưu → công bố → reload”.

## Cập nhật Stage 3 kết hợp auto/manual — 24/11/2026

### Đã sửa

1. Stage 3 không còn nút/chế độ lập lịch thủ công. Chọn fixture ở ba view mở editor; một nút chạy tự động đặt dưới vùng xem lịch. Advanced planner giữ cấu hình phạm vi nhưng không có nút chạy trùng.
2. Chỉnh lịch dở chưa lưu sẽ chặn chạy thuật toán và được tô cam. Trạng thái khóa lưu tách với trạng thái công bố; manual save/lock/unlock dùng commit API CAS trong test-workflow, backend test controller đã từ chối sửa/xóa entry khóa.
3. Nhãn/biểu tượng và màu trạng thái được đồng bộ trên danh sách, calendar, diagram; Stage 4 có thêm số trận bị khóa.

### Kiểm thử và giới hạn

- PASS: browser xác nhận đúng một nút auto, không có nút manual; auto đặt dưới vùng xem. Chọn trận mở form ở drawer phải. Các view vẫn nhóm trận và thể hiện trạng thái rõ.
- NOT TESTED: tạo/lưu lịch hợp lệ, lock/unlock có mutation, auto rerun giữ một trận khóa, reload khóa, và publish official. Snapshot đang mở không có lịch đã xếp; chưa có sân availability xác nhận nên nút auto và lưu thủ công disabled. Không chạy mutation để tránh ghi dữ liệu không hợp lệ.
- READ ONLY: GET `/schedules/test-workflow/:tournamentId` hiện trả revision 11, 0 entries đã xếp, 0 entries khóa, 3 sân và chưa công bố. Báo cáo trước đó từng ghi revision 92/8 bản nháp; trạng thái hiện tại khác biệt. Không chủ động gọi reset hoặc mutation; client trước đó có effect tự khởi tạo snapshot khi lệch phiên bản Bước 4, nên không thể loại trừ side effect từ effect đó. Đã sửa để không tự thay snapshot cũ và không cho chỉnh khi lệch version. Không xác định được nguyên nhân lịch sử của chênh lệch revision.
- Live schedule path vẫn dùng `ScheduleManagementPanel`; API/schema live chưa có cờ khóa lịch tách khỏi trạng thái công bố và chưa tích hợp planner này. Không tuyên bố production-ready. Không có migration mới trong lượt này.

## Lập lịch demo thành công — 24/11/2026

- Nguyên nhân đầu: image Match Service cũ chạy validation setup cho cả `knockoutTiming.*` dù sơ đồ công bố có 12 trận `GROUP`, nên planner trả `INFEASIBLE` trước khi tìm giờ. Source đã lọc thông số theo giai đoạn; rebuild riêng Match Service cập nhật runtime, không chạy migration và không đụng volume.
- Nguyên nhân 409 tiếp theo: revision cache và một lần PUT lặp sau khi planner đã lưu preview có thể xung đột với cập nhật snapshot đồng thời. Client hiện GET revision mới trước khi chạy, xác minh lịch/nguồn lực/phương án vẫn khớp, và nhận snapshot preview từ API mà không gửi PUT dư. Nếu dữ liệu thật sự đổi ở tab khác, client dừng thay vì ghi đè.
- Một preview hợp lệ ban đầu bị nút lưu khóa vì chữ ký được so với resources đã normalize phía UI trong khi API ký snapshot resources thô. Đã đồng bộ kiểm tra chữ ký về đúng snapshot thô.
- PASS: Match Service validation của 12 trận vòng bảng trả 0 issue. Từ snapshot có sẵn 11 lịch khóa hợp lệ, thuật toán đã xếp trận còn thiếu `TEST-2-R3-L1-M2` vào 21/05/2027 09:38 tại `TEST-02`; preview là 1/1, Match Service kiểm tra 1 hợp lệ, 0 lỗi, 0 cảnh báo. Lịch được lưu/khóa; sau đó API trả 12/12 đã xếp, 12 khóa, 0 thiếu và 0 issue.
- PASS: sau reload, Stage 3 và Stage 4 tiếp tục hiển thị lịch; Stage 4 báo 12/12, 0 thiếu, 12 khóa, 3 sân và “Hợp lệ”. Snapshot là test-workflow; không ghi vào bảng lịch official.
- Quan sát ngoài thao tác chạy: sau reload, snapshot test có `schedulePublishedAt=2026-11-23T21:39:49.649Z`, giao diện hiển thị “Đã công bố (sandbox)”. Tôi không bấm Công bố trong lượt này, nên chưa xác định nguồn cập nhật cờ đó. Trạng thái công bố official không bị thay đổi.
- PASS: `corepack pnpm --filter @sfl/shared build`, `corepack pnpm --filter @sfl/match-service build`, web-client typecheck/build, và `node --test tests/schedulingEngine.test.cjs` (19/19). Ba test failures ban đầu đã được xử lý: test cửa sổ giờ trước đó ngắn hơn thời gian chiếm sân; test setup analysis thiếu provenance xác nhận; timeout thiếu cảnh báo rõ ràng.
- NOT TESTED: publish hoặc lưu vào các bảng lịch production, tải lại lịch official, và các thể thức knockout/kết hợp qua API chạy thật. Lượt này chỉ dùng giải demo vòng tròn và snapshot development. Build Vite vẫn cảnh báo bundle JS vượt 500 kB.

## Kiểm tra form Trợ lý lập lịch — 24/11/2026

- PASS: desktop browser hiển thị tiêu đề/mô tả mới, bốn thẻ thống kê, hai card theo tỷ lệ 65/35, dropdown bảng có tìm kiếm và checkbox, picker trận đóng mặc định, và một nút “Tạo lịch tự động”. Panel không có `select[multiple]`; `scrollWidth` không vượt `clientWidth`.
- PASS: danh sách trận lấy tên đội và fixture từ dữ liệu Bước 4 đang hiển thị; con số mục tiêu 2 khớp bộ lọc đã lưu (vòng Bảng A · Vòng 2). Dropdown mở và danh sách trận vẫn cuộn trong khung riêng.
- PASS: `corepack pnpm --filter @sfl/web-client typecheck`; `corepack pnpm --filter @sfl/web-client build`. Vite báo bundle JS khoảng 1.24 MB vượt ngưỡng 500 kB.
- FAIL: bấm “Tạo lịch tự động” trong giải demo, UI nhận HTTP 409 và báo dữ liệu đã thay đổi/xung đột. Không retry. GET chỉ đọc kế tiếp trả revision 17, 0 entry đã xếp, 0 entry khóa và có `autoPreview.status=INFEASIBLE`; không xác định được preview đó có phải từ lần bấm này hay là trạng thái có trước. Không sửa/xóa preview, lịch nháp, lịch khóa hoặc trạng thái công bố.
- NOT TESTED: ghi nhận thay đổi filter/priority vào API và chạy preview thành công; xác nhận “Đặt lại”/“Hủy phương án” qua backend; mobile/tablet; backend official, lưu lịch, khóa, công bố và tải lại. Form hiện gọi test-workflow development, không phải luồng lịch official. Không reset database hoặc volume.
