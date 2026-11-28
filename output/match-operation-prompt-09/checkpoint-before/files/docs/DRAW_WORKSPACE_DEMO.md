# Giải demo giao diện Bốc thăm & chia bảng

> **Cập nhật 24/11/2026:** tài liệu dưới đây ghi lại workspace `DrawDemo*` và snapshot test, không phải luồng BTC chính thức hiện tại. Bước 3 chính thức dùng Tournament Service, Bước 4 dùng Match Service, Bước 5 dùng `OfficialScheduleWorkspace` và các bảng nghiệp vụ PostgreSQL. Snapshot trong tài liệu này vẫn được giữ riêng, không tự chuyển sang dữ liệu nghiệp vụ. Xem [TEST_DATA_ARCHITECTURE.md](./TEST_DATA_ARCHITECTURE.md) để biết trạng thái runtime và các giới hạn kiểm thử mới nhất.

## Vị trí và tài khoản

- Tài khoản BTC riêng `drawdemo.btc01@football.local` được phân công sẵn vào giải demo để nghiệm thu bộ dữ liệu 32 đội.
- Mật khẩu là giá trị hiện tại của `DEMO_ACCOUNT_PASSWORD` trong `.env` local; tài liệu không lưu mật khẩu.
- Mở **BTC → Giải đấu của tôi → HCMC University Draw Cup 2026 — 32 đội → Bước 3: Bốc thăm & chia bảng**.
- ID giải cố định: `8991a5a6-246e-5c1c-b096-cc3d40bb7a13`.
- Workspace Bước 3 mới không còn gắn với email hoặc ID giải demo: trong môi trường `development`/`test`, mọi BTC được phân công quản lý giải ở trạng thái `ROSTER_LOCKED` đều nhận cùng giao diện và component. Danh sách đội, điều lệ và cấu hình mặc định lấy theo giải đang mở. Middleware tiếp tục kiểm tra quyền sở hữu/phân công BTC.

## Dữ liệu được tạo

Seed tạo giải riêng `[DRAW-DEMO] HCMC University Draw Cup 2026 — 32 đội`, 32 CLB hợp lệ từ tám trường TP.HCM, mỗi trường có nhiều đội. Mỗi CLB có đội trưởng, 20 cầu thủ, logo demo dạng huy hiệu số, roster giải gồm 14 cầu thủ đã xác nhận, trong đó có thủ môn. Các hồ sơ của giải demo được đặt APPROVED và giải ở `ROSTER_LOCKED` để mở Bước 3. Seed dùng ID ổn định và không sửa các giải Seed 1 khác.

Tài khoản đội trưởng tương ứng là `drawdemo.captain01@football.local` đến `drawdemo.captain32@football.local`; tài khoản cầu thủ là `drawdemo.player0001@football.local` đến `drawdemo.player0640@football.local`. Tất cả tài khoản mới dùng mật khẩu được cấp qua biến `DEMO_ACCOUNT_PASSWORD` khi seed. 32 đội được chia trên tám trường, mỗi trường bốn đội; tài khoản, mã sinh viên, CLB và roster dùng ID riêng của fixture này. Chúng không cần đăng nhập để trải nghiệm giao diện BTC.

## Cấu hình thử Bước 3

Panel cấu hình chỉ được backend bật trong môi trường `development` hoặc `test`, cho giải đang `ROSTER_LOCKED` mà BTC hiện tại có quyền quản lý. Không kiểm tra email, tài khoản seed, tên hoặc ID giải. Production không bật panel. Cấu hình, bản nháp và kết quả kiểm thử được lưu trong localStorage theo ID giải, không ghi vào database. Danh sách đầu vào lấy từ toàn bộ đội chính thức đủ điều kiện của giải hiện tại, không cho thêm/bỏ đội trong panel.

Panel chỉ thay thể thức, số bảng, số lượt, suất đi tiếp và sức chứa bảng. Nhóm hạt giống, ràng buộc, phương thức, BYE và thao tác phân bổ thuộc workspace dùng chung. Đổi cấu hình có xác nhận xóa phần kết quả thử nghiệm phụ thuộc. Workspace dùng chung không gọi endpoint ghi cấu hình kiểm thử xuống database; các endpoint lưu cũ vẫn chỉ nhận fixture cô lập ban đầu.

### Workspace ngẫu nhiên và thủ công

Với **Ngẫu nhiên**, BTC tạo hoặc bốc thăm lại toàn bộ phương án, kiểm tra tính hợp lệ rồi có thể lưu/mở/hủy bản nháp. Với **Sắp xếp thủ công**, BTC có thể chọn/kéo đội vào ô, chuyển hoặc hoán đổi đội, gỡ đội, hoàn tác và lưu bản nháp chưa hoàn chỉnh. Bản nháp được giữ trong `localStorage` của trình duyệt này; khóa cấu hình được chuẩn hóa theo danh sách đội để việc mở lại không phụ thuộc thứ tự API trả về.

Với phương thức ngẫu nhiên/thủ công, **Công bố bảng đấu/kết quả phân nhánh** khóa workspace thử nghiệm, đánh dấu Bước 3 hoàn thành cục bộ và mở Bước 4. Với bốc thăm trực tiếp, lượt cuối tự công bố và sau màn hình kết quả 5 giây mở Bước 4. Không tạo trận hoặc thay đổi điều lệ, roster hay phiên bản chính thức.

**Reset dữ liệu kiểm thử** xóa bản nháp của cả ba phương thức, nhóm hạt giống/ràng buộc gắn với bản nháp, lịch và lịch sử bốc thăm, lượt bốc, kết quả công bố thử nghiệm, sơ đồ Bước 4, điểm giả lập và trạng thái hoàn thành. Cấu hình đang áp dụng và 32 đội chính thức được giữ nguyên. Reset có xác nhận và không gọi API ghi nghiệp vụ.

### Buổi lễ bốc thăm trực tiếp (bản trải nghiệm)

Chọn **Bốc thăm trực tiếp** trong panel cấu hình rồi áp dụng. Workspace hiển thị thông tin buổi lễ (tên, ngày, giờ, múi giờ, thông báo), danh sách đội chính thức trong cấu hình demo, seed/ràng buộc và sơ đồ vị trí dự kiến. Sau khi công bố lịch, màn hình đếm ngược; BTC phải chờ đến giờ và chủ động bấm **Bắt đầu bốc thăm**. Bộ chọn mô phỏng thời điểm có thể giả lập trước giờ hoặc đã đến giờ; bộ chọn kết nối mô phỏng mất kết nối/khôi phục.

Trong phiên, **Bốc lá thăm tiếp theo** khóa thao tác trong lúc hiệu ứng chạy, rồi hiển thị đội/vị trí, sơ đồ, tiến độ và lịch sử. BTC có thể tạm dừng/tiếp tục; không hoàn tác hoặc bốc lại lượt đã ghi. Tab quản lý và trang chi tiết người xem cùng origin đồng bộ qua localStorage, storage event và BroadcastChannel; người xem chỉ thấy lịch/phiên đang công khai hoặc kết quả đã công bố, không thấy bản nháp. Reload khôi phục trạng thái hiện tại. Đây là kiểm thử cùng trình duyệt, không đồng bộ đa thiết bị, không gửi thông báo thật và không phải công bố chính thức. Dữ liệu local chỉ được trình bày trên localhost hoặc hostname `.test`/`.localhost`.

Bước 4 đọc phân bổ thử nghiệm đã công bố, sinh cặp vòng tròn hoặc nguồn nhánh playoff tại client, cho xem trước/công bố local và đồng bộ khu vực Sơ đồ thi đấu của trang người xem. Không tạo fixtures trong match-service, không ghi database và không mở bước Lập lịch của hệ thống thật.

## Bước 5 và 6 — lập lịch / phân công trọng tài tách riêng

Sau khi công bố sơ đồ thử nghiệm ở Bước 4, bước **Lập lịch thi đấu** mở trước. Khi lịch được công bố thành công, giao diện chuyển sang bước **Phân công trọng tài**. Bước **Điều hành giải đấu** cũng mở sau khi lịch công bố, kể cả khi các vòng tương lai chưa được phân công. Cả hai bước sử dụng nguyên snapshot và component sơ đồ Bước 4; không có bảng danh sách trận lặp lại.

Ngày giờ, thời lượng, sân, ghi chú, chính sách và phân công trọng tài vẫn dùng khóa tương thích `step5` trong localStorage theo ID trận và snapshot của Bước 4. Giao diện và quyền Reset tách theo bước: Reset Bước 5 xóa lịch cùng dữ liệu trọng tài phụ thuộc; Reset Bước 6 chỉ xóa nguồn lực/phân công và giữ nguyên lịch đã công bố. Đây là dữ liệu kiểm thử cục bộ, không ghi database.

Lịch và phân công trọng tài có vòng đời tách biệt. Bước 5 chỉ công bố khi mọi trận thực tế có lịch hợp lệ, qua ràng buộc bắt buộc và gắn snapshot sơ đồ Bước 4. Cảnh báo tối ưu được hiển thị để BTC xác nhận; không cần phân công trọng tài. Khi công bố, bản lịch chính thức cục bộ được khóa và giao diện tự chuyển sang Bước 6. Việc đó không đánh dấu giải đang diễn ra.

Trong tab này, nút **Nguồn lực trọng tài** mở cửa sổ quản lý riêng, không xổ thêm form dưới sơ đồ. Có thể tra cứu danh sách tài khoản REFEREE đang hoạt động bằng API chỉ đọc của Match/Auth; thao tác thêm chỉ liên kết hồ sơ cục bộ, không tạo user, cấp role hoặc sửa tài khoản. Hồ sơ ảo được đánh dấu rõ, không thể đăng nhập và chỉ dùng để thử cấu hình khi tài khoản thật chưa đủ. Nguồn lực, cấp độ, kinh nghiệm, chuyên môn bóng 5/7/11, vị trí, ngày/giờ khả dụng, thời gian không khả dụng, giới hạn trận/ngày và trạng thái nhiệm vụ lưu trong `localStorage` theo tournament ID và snapshot Bước 4.

Mô hình vị trí có số lượng, bắt buộc/tùy chọn, cấp độ/kinh nghiệm tối thiểu, nhiệm vụ, quyền thao tác và thẩm quyền xác nhận kết quả; có thể áp dụng mặc định, theo giai đoạn/nhóm hoặc override theo trận. Mẫu tổ tách biệt với tổ thực tế; thành viên tổ lưu theo cá nhân và vị trí, không cho cùng một người giữ hai vị trí trong cùng tổ. Ràng buộc trung lập và giới hạn điều hành cùng đội có mức bắt buộc hoặc ưu tiên. Module [refereeResourceValidation.ts](../apps/web-client/src/utils/refereeResourceValidation.ts) kiểm tra tư cách, tình trạng nhiệm vụ theo thời hạn áp dụng, loại bóng, vị trí, kinh nghiệm, khung khả dụng, thời gian bận, trùng lịch, nghỉ/di chuyển, giới hạn mỗi ngày và trung lập trên toàn khoảng làm nhiệm vụ (chuẩn bị, thi đấu gồm dự phòng hiệp phụ/luân lưu và chuyển tiếp). Dữ liệu đánh giá/sự cố/quyết định nhiệm vụ mới có cấu trúc lưu và nhãn xác minh; chưa có quy trình đánh giá sau trận hoàn chỉnh và phản ánh chưa xác minh không tự động đình chỉ.

Phân công thủ công dùng cùng sơ đồ Bước 4 làm giao diện chính; không thêm danh sách trận. Chọn trận mở panel có lịch chỉ đọc, tính chất trận, mô hình vị trí và trạng thái từng nhiệm vụ. Có thể chọn theo cá nhân hoặc theo tổ, nhưng chỉ một form được mở tại một thời điểm. Danh sách người/tổ khả dụng được lọc trước theo tư cách tham gia, trạng thái nhiệm vụ theo ngày, chuyên môn/vị trí, cấp độ, kinh nghiệm, khung khả dụng, khoảng bận, xung đột lịch, thời gian nghỉ/di chuyển, giới hạn số trận và trung lập. Tổ chỉ được chọn khi mọi vị trí bắt buộc và thành viên đều hợp lệ; có thể thay thành viên trước khi lưu.

Phân công có thể thiết lập theo vòng/đợt, nhóm/bảng hoặc ngày, hoặc toàn giải. Với chính sách theo đợt, các vòng ngoài phạm vi không bị tính là thiếu; BTC chọn vòng bắt buộc, và có thể giới hạn thêm theo bảng/ngày. Bản nháp lưu riêng từng trận, cho phép để trống vị trí, sửa, xóa, khóa từng vị trí hoặc khóa trận. Kiểm tra lại trước khi ghi localStorage; lưu nháp không công bố. Trạng thái đủ chỉ tính từ các vị trí bắt buộc. Nếu nguồn đội knockout chưa xác định và có quy tắc trung lập bắt buộc, có thể lưu nháp nhưng đánh dấu cần xác minh và không cho công bố. Khi lịch hoặc nguồn lực đổi, chữ ký dữ liệu báo cần xác minh lại; lệnh xác minh chạy lại bộ kiểm tra trước khi cập nhật chữ ký. Công bố chỉ nhận phân công đủ vị trí bắt buộc, đúng phiên bản lịch/sơ đồ, không có lỗi bắt buộc hoặc yêu cầu xác minh còn mở. Phân công đã công bố chỉ đọc; cập nhật hồ sơ/tổ không ghi đè lịch sử công bố.

Phương thức tự động có các phạm vi vòng, bảng/giai đoạn và ngày thi đấu, giới hạn trận chưa phân công hoặc vị trí còn thiếu, cùng ba kiểu bố trí: theo tổ, theo cá nhân hoặc kết hợp. BTC sắp xếp mức ưu tiên (vị trí ít ứng viên, trận sắp diễn ra, kinh nghiệm trận quan trọng, cân bằng khối lượng, nghỉ, lặp đội và tính liên tục của tổ). Chính sách theo vòng/đợt giới hạn phạm vi theo những vòng đã chọn; toàn giải chỉ chạy khi chính sách cho phép.

Planner chạy trong Web Worker, giới hạn tối đa 5 giây và dùng backtracking có chặn nút tìm kiếm. Mọi ứng viên được kiểm tra qua [refereeResourceValidation.ts](../apps/web-client/src/utils/refereeResourceValidation.ts); không nới lỏng ràng buộc. Chế độ theo tổ chỉ xét tổ có mẫu/vị trí khớp, thành viên khác nhau và mọi thành viên qua kiểm tra. Tổ/cá nhân đã khóa, trận khóa và phân công đã công bố được giữ nguyên; các trận ngoài phạm vi cũng không bị thay đổi. Kết quả một phần giữ các vị trí hợp lệ và nêu trận/vị trí thiếu cùng nguyên nhân. Nguồn đội chưa xác định với trung lập bắt buộc được gắn `NEEDS_RECHECK`, có thể nằm trong bản nháp nhưng chưa thể công bố.

Kết quả tự động chỉ là preview cho đến khi BTC bấm **Áp dụng vào bản phân công nháp**. Trước khi ghi, ứng dụng so sánh chữ ký lịch/nguồn lực/phân công và chạy lại planner; nếu dữ liệu đổi ở tab khác, thao tác bị từ chối. Áp dụng gộp vào cùng `refereeAssignmentsByFixture` với thao tác thủ công và cập nhật chữ ký nguồn lực/lịch; không công bố và không ghi database. Có thể tạo lại hoặc hủy preview. Dữ liệu phân công thủ công/tự động, khóa vị trí/trận và trạng thái công bố lưu localStorage/BroadcastChannel theo giải và snapshot Bước 4. Mọi loại phân công chỉ được công bố sau khi lịch tương ứng đã công bố. Có thể tiếp tục phân công/công bố các vòng chưa tới mà không mở khóa lịch thi đấu.

Trang xem giải chỉ đọc `publishedScheduleByFixture` của đúng snapshot Bước 4; không lấy `scheduleByFixture` chứa lịch nháp. Trọng tài chỉ được đưa sang sơ đồ người xem từ `publishedRefereeAssignmentsByFixture` sau khi công bố phân công. LocalStorage/BroadcastChannel đồng bộ trong cùng trình duyệt/origin; không thay thế realtime hoặc quy trình chính thức. Một trận có lịch chính thức nhưng chưa có trọng tài là trạng thái hợp lệ; trong giao diện kiểm thử, trạng thái điều hành chỉ sẵn sàng khi các vị trí bắt buộc của trận đó đã được công bố.

### Cấu hình và kiểm tra lập lịch thủ công

Ba hộp thoại Cấu hình thời gian, Quản lý sân và Ràng buộc lập lịch chỉ mở khi BTC chủ động chọn. Cấu hình được lưu trong trình duyệt. Khung giờ có nhãn ưu tiên/bình thường/hạn chế; nhãn này tạo cảnh báo, còn các giới hạn ngày, giờ, sân, loại sân, thời gian sân bị chiếm, trùng sân/đội, thời gian nghỉ/di chuyển, trận nguồn, BYE, số trận/ngày và các giới hạn được đánh dấu bắt buộc mới chặn lựa chọn. Mỗi trận dùng timing profile vòng bảng hoặc knockout; giờ kết thúc trận và toàn bộ khoảng chiếm sân được tính riêng.

Sân có lịch khả dụng, ngày hoạt động, thời gian bảo trì, chuyển tiếp, loại sân, vùng di chuyển, cờ sân trung tâm, giai đoạn ưu tiên và tùy chọn gắn sân nhà. Chế độ tập trung hoặc sân nhà–sân khách không thay đổi đội nhà/khách hay cặp đấu đã công bố. Xoay tua sân/giờ, sân trung tâm, chuỗi nhà/khách và cân bằng nghỉ là cảnh báo; ràng buộc chênh lệch nghỉ knockout chỉ chặn khi BTC bật bắt buộc.

Nếu bật Vòng cuối bảng phải cùng giờ, các trận cuối được nhóm theo bảng và có workspace lưu cụm: cùng ngày/giờ bắt đầu, mỗi trận dùng một sân riêng, toàn bộ cụm được kiểm tra và ghi localStorage nguyên tử. Giao diện báo số sân cần và số sân hoạt động phù hợp nếu không tìm được phương án. Module scheduleConstraintValidation dùng chung cho lựa chọn ngày/sân/giờ, kiểm tra trước khi lưu, sửa lịch, kiểm tra toàn bộ và công bố thử nghiệm. Thay đổi cấu hình không xóa lịch: hệ thống nêu trận bị ảnh hưởng và yêu cầu BTC xác nhận giữ lịch để xử lý.

Thống kê thu gọn gồm lịch theo ngày, sân, bảng, vòng, số trận theo từng đội, thời gian nghỉ ngắn nhất/dài nhất và cảnh báo mục tiêu công bằng. Lập lịch thủ công và tự động dùng chung `scheduleConstraintValidation`; cả hai chỉ lưu vào localStorage và chưa gọi API ghi hoặc database.

### Lập lịch tự động

Trong tab **Lập lịch thi đấu**, chọn **Lập lịch tự động** để mở cấu hình riêng. Phạm vi gồm toàn giải, vòng bảng/knockout, bảng, vòng và chỉ các trận chưa xếp. Có thể đổi thứ tự ưu tiên sáu mục tiêu; các mục tiêu chỉ xếp hạng phương án, không nới lỏng ràng buộc bắt buộc. Bộ lập lịch giữ nguyên trận khóa và trận ngoài phạm vi, không sinh hoặc sửa fixtures, loại BYE, tạo đề xuất ngày–sân–giờ và kiểm tra lại toàn bộ lịch trước khi BTC áp dụng vào cùng bản nháp thủ công. Đề xuất có thể hủy/chạy lại; không tự công bố.

Tìm kiếm bị giới hạn tối đa 15 giây và số nhánh/ứng viên. Kết quả `PARTIAL`/`TIMEOUT` nêu từng trận chưa bố trí; `TIMEOUT` hoặc đã chạm giới hạn không chứng minh cấu hình bất khả thi. Nguồn đội knockout được kiểm tra theo các trận nguồn; suất thứ hạng vòng bảng chờ đến sau khi các trận vòng bảng liên quan hoàn tất. Mã nguồn fixtures thử nghiệm có cả ID nhóm số như `TEST-1-R1-L1-M1` và ID knockout chữ.

Planner phân công trọng tài có test cục bộ riêng, bao gồm cá nhân, tổ và kết hợp, tổ dùng chung thành viên, vị trí khóa, trọng tài đình chỉ, nguồn knockout chưa xác định, phạm vi theo ngày/vòng/bảng và loại sân bóng 5/7/11. Chạy: `corepack pnpm --filter @sfl/web-client test:referee-planner`. Các ca này kiểm tra thuật toán và module ràng buộc; chưa thay thế E2E trên giao diện với tài khoản BTC.

## Chạy seed bổ sung

Từ thư mục gốc trên Windows:

```powershell
./scripts/test-seeds/Seed-DrawWorkspaceDemo.ps1
```

Lệnh chỉ rebuild/start Compose và chạy seed theo từng service. Không dùng `down -v`, không xóa volume/database. Seed không phát email.

## Khôi phục riêng dữ liệu demo

```powershell
./scripts/test-seeds/Reset-DrawWorkspaceDemo.ps1
```

Lệnh `draw-demo-reset` được giới hạn vào ID cố định của giải demo. Nó đặt lại roster fixture giải này, cấu hình thử, các bản chia nháp và phiên bốc đã đóng; sau đó tạo lại 32 hồ sơ APPROVED. Nếu bản chia đã xác nhận/công bố hoặc phiên đang chạy, reset dừng an toàn. Các tài khoản, CLB và mọi dữ liệu của những giải khác được giữ nguyên.

## Nghiệm thu Bước 5–6 — 21/11/2026

| Kiểm tra | Kết quả | Bằng chứng/giới hạn |
| --- | --- | --- |
| `@sfl/web-client` typecheck | PASS | `corepack pnpm --filter @sfl/web-client typecheck` |
| Frontend production build | PASS | `corepack pnpm --filter @sfl/web-client build`; Vite còn cảnh báo bundle chính lớn hơn 500 kB. |
| Planner trọng tài tự động | PASS | 9/9 ca unit test qua `test:referee-planner`: cá nhân/tổ/kết hợp, thành viên tổ dùng chung, vị trí khóa, đình chỉ, trung lập chưa xác định, phạm vi và chuyên môn 5/7/11. |
| Smoke test giao diện BTC | PASS một phần | Trang giải demo hiển thị 32 đội và 119 fixtures từ Bước 4; xác nhận có ba tab và lựa chọn phân công thủ công/tự động. Chưa thao tác publish. |
| Lịch và nguồn lực của bộ test hiện tại | NOT TESTED | LocalStorage tại origin test đang có 0 sân, 0 hồ sơ trọng tài và 119 trận chưa lập lịch. Do đó không thể xác nhận lịch chính thức hoặc phân công hợp lệ trong bộ dữ liệu này. |
| 3 thể thức × các luồng Bước 3 → 4 → 5 | NOT TESTED | Không chạy lại/công bố lại cấu hình Bước 3/4 trong nghiệm thu này; không thay đổi bản công bố hiện có. |
| E2E công bố lịch/phân công, actor trọng tài, chuyển Bước 6, nhiều tab và reset | NOT TESTED | Chưa có bộ lịch/nguồn lực đủ điều kiện trên origin này. Các phần localStorage không tạo bảo mật backend và chưa được nghiệm thu đa thiết bị. |
| Docker/API/database | NOT TESTED | Lượt này không chạy mutation API, migration hoặc Docker. Không có xác nhận runtime Docker mới. |

Phân biệt kết quả: unit test planner đã chạy; typecheck/build chỉ xác minh tĩnh và đóng gói; smoke test giao diện chỉ xác minh trang/controls đang hiển thị, không phải E2E nghiệp vụ. Không được coi những hàng `NOT TESTED` là đạt. Bộ dữ liệu Bước 5 hiện tại **chưa có lịch chính thức hoặc phân công trọng tài để giữ lại**; trạng thái đã quan sát là 0/119 lịch và 0/119 phân công.

## Tái cấu trúc Bước 5–7 thành các bước độc lập — 22/11/2026

- Web typecheck/build: PASS; referee planner: 9/9 PASS. Match Service build: PASS; test suite: 65 PASS / 0 FAIL / 21 SKIPPED. Ba test mới xác minh gate bắt đầu trận cho đội, lịch công bố và trọng tài cuối.
- Reset Bước 5 giữ nguyên Bước 3–4 nhưng xóa toàn bộ lịch và dữ liệu trọng tài phụ thuộc; Reset Bước 6 chỉ xóa dữ liệu trọng tài. Hai thao tác có hộp thoại xác nhận và chỉ hoạt động trên dữ liệu local test.
- E2E các luồng chuyển bước và ba thể thức: NOT TESTED. Bản browser tại `localhost:5173` sau reload vẫn cho thấy stepper 7 bước; artifact frontend chưa được xác nhận chạy trong Docker. Không chạy Compose/migration hoặc sửa database trong lần thay đổi này.
- Giới hạn bắt đầu trận: Match Service kiểm tra đội đã xác định, lịch chính thức và một người có quyền xác nhận kết quả. Backend schema hiện chưa lưu toàn bộ vị trí bắt buộc theo referee model cục bộ, nên chưa thể đối chiếu toàn bộ cấu hình mô hình tại tầng database.
