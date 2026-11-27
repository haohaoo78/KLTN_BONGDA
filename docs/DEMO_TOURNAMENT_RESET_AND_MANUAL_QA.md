# Reset dữ liệu demo và kịch bản kiểm thử thủ công

Ngày kiểm tra: **27/11/2026 (UTC+7)**. Môi trường: Docker development tại **http://localhost:5173**.

Tài liệu này phản ánh trạng thái PostgreSQL và giao diện BTC sau khi reset. Không có thao tác nghiệp vụ nào chạy sau giai đoạn chờ duyệt. Các bước từ xét duyệt trở đi là hướng dẫn để BTC tự thực hiện.

## 1. Trạng thái sau reset

| Giải | ID | Thể thức | Hồ sơ chờ BTC duyệt | Roster đã nộp / lời mời cầu thủ đã chấp thuận | Hạn mức |
|---|---|---|---:|---:|---:|
| DEMO IUH League 2026 | 248006af-5af3-4ff5-8486-47b80fc269b9 | Vòng tròn, 5 người, một bảng, hai lượt | 4 | 40 / 40 | 4 đội |
| DEMO HCMC Student Champions Cup 2026 | 9f765a91-b8ab-4716-a083-0cf8a113db1b | Kết hợp, 11 người, 4 bảng | 20 | 400 / 400 | 16 đội, tối đa 2 đội/trường |
| DEMO Student Knockout Cup 2026 | d9fe5a04-5e71-41ec-b85c-f4567b294c68 | Loại trực tiếp, 7 người | 16 | 224 / 224 | 16 đội |

Cả ba giải đang ở trạng thái **Đang mở đăng ký**, bước workflow 2 (**Xét duyệt & chốt danh sách**). Thời gian đăng ký hiển thị trên BTC là 24/11/2026–30/11/2026. Mỗi giải vẫn có điều lệ đã công bố, gồm các phiên bản cũ và phiên bản chính thức v2; không có điều lệ nào bị sửa hoặc công bố lại.

Trong dữ liệu đội bóng, 40 hồ sơ đều ở PENDING và 664 lời mời cầu thủ gắn với các hồ sơ này ở trạng thái ACCEPTED. Đây là xác nhận tham gia của cầu thủ. Cờ xác minh hồ sơ học sinh trong bảng roster được giữ nguyên, không được đổi thành đã xác minh bởi lần reset này.

Các dữ liệu đã reset theo đúng ba ID:

- Xóa quyết định BTC sau khi nộp, yêu cầu bổ sung/xem xét lại, khóa roster, phiên bản bốc thăm và phiên trực tiếp, fixtures/bracket, lịch, cấu hình/đội trọng tài của giải, đội hình trận, sự kiện, biên bản, kết quả, BXH, dữ liệu kỷ luật, thông báo và cache thuộc các giải.
- Mỗi giải hiện có 0 trận, 0 lịch, 0 phân công trọng tài, 0 cấu hình nguồn lực theo giải và 0 dữ liệu trận đấu sau Bước 2.
- Giữ nguyên tài khoản, mật khẩu, trường, đội, cầu thủ, roster đã nộp, lời mời đã được chấp thuận, điều lệ, venue dùng chung, availability dùng chung, referee profiles và dữ liệu các giải khác.
- Không gửi email, không duyệt đội, không chốt roster, không tạo bốc thăm, sơ đồ, lịch hoặc phân công.

### Lưu ý riêng cho giải HCMC

Giải có **20 hồ sơ chờ duyệt nhưng chỉ có 16 suất và tối đa 2 đội/trường**. Không thể duyệt cả 20 đội rồi chốt hợp lệ. Danh sách theo thứ tự nộp hiện tại:

| Trường | Thứ tự hồ sơ | Giới hạn |
|---|---|---:|
| Cao đẳng Công Thương TP.HCM | HITU 14 → HITU 22 → HITU 06 | 2 |
| Cao đẳng Giao thông Vận tải | HCMCT 08 → HCMCT 24 → HCMCT 16 | 2 |
| HUTECH | HUTECH 02 → HUTECH 18 → HUTECH 10 | 2 |
| IUH | IUH 01 → IUH 17 → IUH 09 | 2 |
| Cao Thắng | Cao Thắng 05 → Cao Thắng 21 | 2 |
| Cao đẳng Công nghệ Thủ Đức | TDC 07 → TDC 23 | 2 |
| UEF | UEF 03 → UEF 19 | 2 |
| UEH | UEH 04 → UEH 20 | 2 |

Để đạt 16 đội, duyệt tối đa hai đội ở mỗi trường và xử lý bốn hồ sơ thứ ba theo quyết định BTC. Trang chi tiết hiện có **Duyệt hồ sơ**, **Yêu cầu bổ sung** và **Từ chối**; không có nút riêng để chuyển một hồ sơ PENDING sang “Chờ suất”. Nếu backend tự đưa hồ sơ vượt hạn mức vào chờ suất, xác nhận lại bộ đếm. Nếu vẫn PENDING, cần có quyết định cuối hợp lệ trước khi chốt; không gọi API ngoài giao diện để ép trạng thái.

## 2. Bản sao lưu

Đã tạo sáu bản sao PostgreSQL dạng custom-format trước khi reset và xác minh SHA-256 cùng khả năng đọc archive bằng pg_restore. Manifest và các file nằm tại [thư mục sao lưu](../backups/demo-tournament-review-reset-20261127/).

Các database: sfl_team, sfl_tournament, sfl_match, sfl_scheduling, sfl_discipline, sfl_notification. Bản sao là dữ liệu trước reset, không ghi đè. Các câu lệnh reset kèm trong thư mục có guard đếm hàng để tránh chạy lại trên trạng thái đã reset.

## 3. Tài khoản kiểm thử

Mật khẩu development dùng cho các tài khoản demo dưới đây: **Demo@123456**. Không dùng mật khẩu này ở môi trường production.

| Vai trò | Email | Ghi chú |
|---|---|---|
| BTC | dataset.btc01@football.local | Đã đăng nhập thành công trên Docker; có quyền BTC, tài khoản ACTIVE |
| Đội trưởng IUH | drawdemo.captain01@football.local | IUH Draw Demo Club 01 |
| Đội trưởng HCMC | drawdemo.captain14@football.local | HITU Draw Demo Club 14 |
| Đội trưởng đối thủ HCMC | drawdemo.captain07@football.local | TDC Draw Demo Club 07 |
| Đội trưởng loại trực tiếp | drawdemo.captain17@football.local | IUH Draw Demo Club 17; chọn cặp thực tế sau khi công bố nhánh |
| Cầu thủ | drawdemo.player0001@football.local | Thành viên IUH Draw Demo Club 01; lời mời đã ACCEPTED trong cả ba giải |
| Trọng tài | dataset.captain02@football.local | Tài khoản ACTIVE, có REFEREE và TEAM_CAPTAIN, đã có referee profile; không nhầm với drawdemo.captain02 |

Ba referee profile đang có trong Scheduling database tương ứng dataset.captain01, dataset.captain02 và haohaao78@gmail.com. Mật khẩu của haohaao78@gmail.com chưa được xác minh cho kịch bản này. dataset.referee01@football.local có role REFEREE nhưng hiện chưa có referee profile; dùng dataset.captain02 làm tài khoản trọng tài mẫu.

Đăng nhập BTC tại http://localhost:5173/#login, sau đó mở **Giải đấu** và chọn một giải. Liên kết trực tiếp:

- [BTC — IUH League](http://localhost:5173/btc?manageTournament=248006af-5af3-4ff5-8486-47b80fc269b9)
- [BTC — HCMC Champions Cup](http://localhost:5173/btc?manageTournament=9f765a91-b8ab-4716-a083-0cf8a113db1b)
- [BTC — Student Knockout Cup](http://localhost:5173/btc?manageTournament=d9fe5a04-5e71-41ec-b85c-f4567b294c68)
- [Trang Viewer công khai](http://localhost:5173/)

Trong một hồ sơ trình duyệt, đăng xuất trước khi đổi tài khoản vì các tab dùng chung session cookie. Có thể dùng các hồ sơ trình duyệt riêng cho BTC, hai đội trưởng, cầu thủ và trọng tài.

## 4. Kịch bản kiểm thử theo thứ tự

### Bước A — BTC xét duyệt và chốt danh sách

**Trường hợp:** kiểm tra hồ sơ hợp lệ, thứ tự FIFO, yêu cầu bổ sung/từ chối và giới hạn suất.

1. BTC mở một trong ba liên kết quản lý ở trên. Trên đầu trang phải thấy **Thông tin & điều lệ — Hoàn thành** và **Xét duyệt & chốt danh sách — Đang thực hiện**. Các bước sau đang khóa.
2. Trong **Xét duyệt đăng ký đội**, bấm **Chờ duyệt**. Hồ sơ hiển thị tên đội, trường, đại diện, số cầu thủ đã nộp và số lời mời đã chấp thuận. Bấm **Xem chi tiết yêu cầu** để xem roster.
3. IUH: phải thấy 4 hồ sơ, mỗi hồ sơ có 10 cầu thủ đã xác nhận. Student Knockout: 16 hồ sơ, mỗi roster có 14 người. HCMC: 20 hồ sơ, mỗi roster có 20 người; danh sách chia thành hai trang.
4. Để kiểm thử yêu cầu bổ sung, chọn một hồ sơ hợp lệ khi còn trong thời hạn, bấm **Yêu cầu bổ sung**, nhập nội dung cụ thể và một hạn tương lai, rồi bấm **Gửi yêu cầu bổ sung**. Đăng xuất BTC, đăng nhập đội trưởng tương ứng, mở **Giải đấu của đội tôi** → hồ sơ của giải → chỉnh sửa/nộp lại. Đăng nhập lại BTC, kiểm tra lịch sử và duyệt lại sau khi trạng thái về chờ duyệt. Đây là thay đổi dữ liệu thật và là nhánh tùy chọn.
5. Để kiểm thử từ chối, mở hồ sơ thứ ba vượt chỉ tiêu của trường HCMC, bấm **Từ chối**, nhập lý do rồi bấm **Xác nhận từ chối**. Chỉ từ chối khi BTC thực sự muốn giải phóng hồ sơ đó. Bốn đội vượt chỉ tiêu là HITU 06, HCMCT 16, HUTECH 10 và IUH 09 theo thứ tự nộp hiện tại.
6. Duyệt các hồ sơ hợp lệ theo thứ tự hàng chờ: mở hồ sơ đến lượt → **Duyệt hồ sơ** → **Xác nhận duyệt đội**. Mong đợi bộ đếm **Đã duyệt** tăng, hồ sơ chuyển khỏi **Chờ duyệt**, roster được chuyển qua quy trình chính thức. HCMC dừng ở tối đa 16 đội, không vượt 2 đội/trường.
7. Khi BTC đã hoàn tất quyết định cho hồ sơ cần xử lý và không còn hồ sơ PENDING ảnh hưởng đến việc chốt, bấm **Đóng đăng ký (Test)**. Nút này chỉ hiện ở DEV/TEST nhưng thay đổi trạng thái nghiệp vụ thật sang đóng đăng ký. Không bấm trước khi đội nào còn cần bổ sung đã gửi lại.
8. Vào bước **Xét duyệt & chốt danh sách**, kiểm tra điều kiện và bấm **Chốt danh sách**. Mong đợi trạng thái roster đã khóa, snapshot roster tồn tại và Bước 3 được mở. Nếu thông báo số hồ sơ chưa có quyết định, quay lại hàng chờ và xử lý hết trước.

Để kiểm tra đồng bộ, đăng nhập một đội trưởng đã duyệt tại /team → **Giải đấu của đội tôi**. Trạng thái hồ sơ phải là **Đã duyệt**, nhưng trạng thái này không có nghĩa giải đã thi đấu. Đăng nhập cầu thủ tại /player để xem giải/đội và lời mời đã chấp thuận.

### Bước B — Bước 3: Bốc thăm & chia bảng

Ba phương thức đang hiển thị trong cấu hình Bước 3 là **Bốc thăm trực tiếp**, **Bốc thăm ngẫu nhiên** và **Sắp xếp thủ công**. Có thể dùng ba giải để thử ba phương thức một lần:

| Giải | Phương thức gợi ý cho lượt test | Cấu trúc bắt buộc theo điều lệ |
|---|---|---|
| IUH League | Bốc thăm ngẫu nhiên | Một bảng A duy nhất, 4 đội, thi đấu hai lượt |
| Student Knockout Cup | Bốc thăm trực tiếp | Một nhánh knockout 16 đội; không chia nhiều bảng |
| HCMC Champions Cup | Sắp xếp thủ công | Bảng A–D, mỗi bảng 4 đội; hai đội đầu bảng vào tứ kết |

BTC mở **Bốc thăm & chia bảng**, chọn đúng phương thức, kiểm tra giới hạn/khả thi rồi thực hiện. Với bốc thăm trực tiếp, nếu chưa có lịch buổi lễ thì nhập thời gian, múi giờ, địa điểm và thông báo → **Công bố lịch bốc thăm** → đến giờ bấm **Bắt đầu bốc thăm** → bấm **Bốc lá thăm tiếp theo** cho từng lượt. Sau lượt cuối, hệ thống công bố kết quả và hiện **Chuyển ngay đến Sơ đồ thi đấu**. Đội được đặt xuống bảng/nhánh theo từng lượt.

Mong đợi sau công bố: kết quả có phiên bản chính thức trong hệ thống; tải lại trang vẫn thấy nguyên thứ tự. Không dùng danh sách bốc thăm lịch sử trước reset. Nếu phương thức trực tiếp hoàn tất, dùng nút chuyển tiếp đang hiển thị.

Để có cặp mẫu xác định cho lần kiểm thử đầu: ở HCMC xếp HITU Draw Demo Club 14 và TDC Draw Demo Club 07 vào Bảng A, cùng hai đội hợp lệ khác; hai đội này sẽ gặp nhau một lần ở vòng bảng. Ở IUH, Club 01 và Club 09 thuộc cùng bảng duy nhất và sẽ gặp nhau hai lượt; chọn trận lượt đầu hiển thị sau khi Bước 4 sinh sơ đồ. Với knockout trực tiếp, cặp R16 phụ thuộc kết quả từng lượt bốc; chọn một trận R16 thực tế trên nhánh sau khi công bố, không dùng match ID cũ.

### Bước C — Bước 4: Sơ đồ thi đấu

Mở **Sơ đồ thi đấu**. Cấu trúc được tạo từ kết quả Bước 3. Kiểm tra tên đội, bảng, vòng, nhánh và các vị trí nguồn trước khi bấm **Xác nhận & công bố sơ đồ thi đấu**.

Số trận dự kiến sau khi 16 đội HCMC được duyệt:

| Thể thức | Kết quả sơ đồ mong đợi |
|---|---:|
| IUH: 4 đội, vòng tròn hai lượt | 12 trận |
| Knockout: 16 đội, một lượt | 15 trận: 8 vòng đầu, 4 tứ kết, 2 bán kết, 1 chung kết |
| HCMC: 4 bảng × 4 đội một lượt + knockout 8 đội | 24 vòng bảng + 7 knockout = 31 trận |

Mong đợi sau công bố: Bước 5 được mở và đọc đúng các fixture mới. Mọi ID trận cũ đã bị reset; các trận mới chỉ xuất hiện sau khi người dùng công bố sơ đồ. Viewer trước lúc công bố không được thấy draft.

### Bước D — Bước 5: Lập lịch

Workspace có bốn công đoạn: **Sân & thời gian**, **Điều kiện thi đấu**, **Tạo & điều chỉnh lịch**, **Kiểm tra & công bố**.

1. Ở **Sân & thời gian**, thêm/chọn nguồn lực của giải, khai báo ngày và khung giờ thật, đánh dấu khả dụng sân rồi bấm **Lưu cấu hình sân**.
2. Ở **Điều kiện thi đấu**, đối chiếu thời lượng và thời gian nghỉ với điều lệ v2. Lịch tổ chức ghi trong điều lệ: IUH 01–07/12, Knockout 08–17/12, HCMC 18–31/12/2026. Không nhập thời lượng hoặc nghỉ bằng 0 nếu cần giá trị dương.
3. Ở **Tạo & điều chỉnh lịch**, bấm **Tạo lịch tự động**. Nếu lịch còn thiếu, mở trận ở Danh sách trận / Lịch theo ngày/sân / Sơ đồ thi đấu, chỉnh thủ công, rồi **Lưu nháp**. Kết quả chạy thuật toán không tự công bố lịch.
4. Ở **Kiểm tra & công bố**, xem số đã xếp/chưa xếp, cảnh báo xung đột, sân/ngày/giờ. Chỉ khi mọi trận bắt buộc đã được xếp và Match Service trả trạng thái hợp lệ mới bấm **Công bố lịch**. Sau tải lại, lịch phải còn trên trang BTC, đội trưởng và Viewer.

**Điều kiện dữ liệu hiện tại:** ba giải đang có 0 tournament schedule resources và 0 schedules. Scheduling database có 14 venue dùng chung nhưng tên/địa chỉ gồm nhiều giá trị placeholder và bốn mục gắn nhãn QA; bảng khả dụng venue hiện có 0 hàng. Các venue này được giữ lại theo yêu cầu. Trước khi chạy lịch, BTC cần chọn hoặc nhập địa điểm thực có thể xác minh và lưu khung khả dụng ở Bước 5. Chưa thể đánh dấu khả năng tạo lịch trên dữ liệu hiện tại là PASS.

Các giá trị lập lịch đang ghi trong điều lệ đã công bố:

| Giải | Tổng thời lượng / nghỉ giữa hiệp | Nghỉ tối thiểu cùng đội | Chuyển tiếp sân | Khung giờ / dự kiến |
|---|---|---:|---:|---|
| IUH | 2 × 20 phút / 10 phút | 1.440 phút | 15 phút | 08:00–22:00; dự kiến 2 sân, tối đa 10 giờ/ngày |
| Knockout | 2 × 25 phút / 10 phút | 1.440 phút | 15 phút | 08:00–22:00; dự kiến 2 sân, tối đa 10 giờ/ngày |
| HCMC | 2 × 45 phút / 15 phút; knockout hòa có 2 × 15 phút hiệp phụ | 1.440 phút | 20 phút | 08:00–22:00; dự kiến 2 sân, tối đa 10 giờ/ngày |

### Bước E — Bước 6: Phân công trọng tài

Sau khi lịch được công bố, mở **Phân công trọng tài**. Tab lần lượt là **Đội ngũ trọng tài**, **Cấu hình trọng tài**, **Phân công**, **Công bố & theo dõi**.

1. Trong **Đội ngũ trọng tài**, bấm **+ Thêm trọng tài**, tra cứu dataset.captain02@football.local và thêm vào giải. Tài khoản có referee profile và capability theo cấu hình; nó là tài khoản khác với drawdemo.captain02@football.local.
2. Trong **Cấu hình trọng tài**, chọn mẫu gợi ý phù hợp rồi **Lưu cấu hình**. Kiểm tra ai được xác nhận cuối; không suy số lượng trọng tài từ thể thức nếu cấu hình chưa yêu cầu.
3. Trong **Phân công**, chọn từng fixture thật và điền các vị trí thủ công. Hệ thống chỉ đọc trận đã có lịch công bố. Lưu các phân công, xử lý xung đột rồi mở **Công bố & theo dõi**.
4. Chọn các trận hợp lệ và bấm **Công bố phân công**. Mong đợi trọng tài thấy trận trong /referee/assignments sau đăng nhập, không cần chấp nhận lời mời. Match vẫn giữ đúng ngày, giờ và sân từ Bước 5.

Sau reset, không còn đội trọng tài theo giải, cấu hình theo giải, phân công nháp hoặc công bố. Ba referee profile dùng chung không bị xóa.

### Bước F — Chuẩn bị đội hình, trọng tài và Demo Mode

**Đây là điểm chặn đã xác minh, cần giải quyết trước khi có thể bắt đầu trận.** Cả ba giải hiện có 0 bản bổ sung trong regulation_operation_rules. Điều lệ chính thức v2 còn được giữ nguyên, nhưng Match Service yêu cầu một bản quy tắc điều hành có phiên bản, nguồn luật/ấn bản HTTPS và các trường đội hình/đồng hồ cần thiết. Không tự chọn futsal cho IUH chỉ vì giải 5 người.

Sau khi fixtures chính thức đã được công bố, BTC có thể dùng mục **Luật thi đấu & quy tắc điều hành** trong **Thông tin & điều lệ** để tạo bản bổ sung phiên bản, công bố và áp dụng vào các fixture đủ điều kiện. Bản bổ sung không ghi đè điều lệ v2. Các điều lệ hiện nêu số cầu thủ xuất phát/dự bị và thời lượng; các giá trị còn thiếu như nguồn luật phù hợp với IUH 5 người, số cầu thủ tối thiểu, quy định số áo và một số quy tắc thay người/kỷ luật cần căn cứ hợp lệ của BTC.

Nếu chưa có bản bổ sung đã công bố và gắn với trận, đăng nhập đội trưởng rồi vào /team → **Lịch của đội tôi** → trận → **Chuẩn bị đội hình**. Expected UI là danh sách roster thật cùng cảnh báo trong **Quy tắc áp dụng và thời hạn**; **Gửi đội hình** bị khóa với các mục thiếu. Đây là BLOCKED đúng validation, không phải dữ liệu đội/cầu thủ bị mất. Đừng gọi API trực tiếp để bỏ qua.

Khi quy tắc đã được công bố/gắn và trận có lịch cùng trọng tài công bố:

1. Đội trưởng của đội A mở trận → **Chuẩn bị đội hình**, chọn người roster vào **Xuất phát** hoặc **Dự bị**, kiểm tra số lượng theo điều lệ, **Lưu nháp** rồi **Gửi đội hình**.
2. Đăng xuất và đăng nhập đội trưởng đội B của chính trận đó, làm tương tự.
3. Đăng nhập dataset.captain02@football.local → **Không gian trọng tài** → **Lịch phân công** → trận → **Vào trận** → **Trước trận**. Kiểm tra hai danh sách, xử lý yêu cầu điều chỉnh nếu cần và xác nhận điều kiện bắt đầu.
4. Trong panel **Demo Mode**, bấm **Bật Demo Mode**, rồi dùng **Đến mốc lập đội hình**, **Đến mốc kiểm tra trước trận** và **Đến giờ bắt đầu trận** khi phù hợp. Demo Mode được bật toàn cục cho đúng ba ID trong môi trường NODE_ENV=development; từng trận bắt đầu ở trạng thái tắt và phải do trọng tài được phân công bật. Nó giữ nguyên lịch chính thức và không bỏ qua validation.
5. Khi đủ điều kiện, bấm **Bắt đầu trận**. Đồng hồ/clock do backend điều khiển. Dùng **Tiến 1 phút** khi muốn thử sự kiện; không dùng Demo Mode để đổi lịch thi đấu.

### Bước G — Điều hành, biên bản và kết quả

Trong trang tác nghiệp trọng tài, thực hiện **Trước trận → Điều hành trận đấu → Sau trận**. Chọn sự kiện bằng modal; cầu thủ lấy từ đội hình trận, không nhập UUID:

- Bàn thắng: chọn đội và cầu thủ đang đủ điều kiện; tỷ số cập nhật từ sự kiện.
- Thẻ vàng/đỏ: chọn đúng cầu thủ và kiểm tra lý do/trạng thái.
- Thay người: chọn một cầu thủ đang thi đấu và một dự bị đủ điều kiện, lưu cả cặp một lần.
- Hiệp: Demo Mode đưa thời gian tới cuối hiệp; trọng tài tự bấm **Kết thúc hiệp**, chờ nghỉ và **Bắt đầu hiệp tiếp theo**. Hệ thống không tự chốt hiệp chỉ vì timer đạt thời lượng.
- Kết thúc trận: sau khi kết thúc thời gian đúng quy tắc, bấm **Kết thúc trận**; trạng thái FINISHED chưa tự động công nhận BXH.
- Sau trận: kiểm tra biên bản tổng hợp và bấm **Xác nhận kết quả & biên bản** nếu trọng tài được cấu hình quyền cuối. Trường hợp ngoại lệ chuyển BTC xử lý tại Bước 7.

Ví dụ nghiệp vụ theo thể thức:

| Giải | Kiểm thử một trận | Kết quả mong đợi |
|---|---|---|
| IUH vòng tròn | Tỷ số hòa, ví dụ 1–1 | Hòa được giữ; không hiệp phụ/luân lưu; BXH tính sau khi kết quả được xác nhận |
| Knockout 7 người | Kết quả hòa sau hai hiệp | Luân lưu trực tiếp, không hiệp phụ; đội thắng đi tiếp |
| HCMC kết hợp | Hòa ở vòng bảng rồi một trận knockout hòa | Vòng bảng giữ hòa; knockout đá hiệp phụ 15+15, rồi luân lưu nếu vẫn hòa |

Đây là kịch bản điều kiện theo nội dung điều lệ; các lần ghi sự kiện/kết quả trên ba giải chưa được chạy sau lần reset này. Cần lặp cho đủ 12 trận IUH, 15 trận knockout và 31 trận HCMC để có thể kết thúc cả ba giải.

### Bước H — BXH, sơ đồ và kết thúc giải

- IUH: sau khi mọi trận hợp lệ đã được xác nhận, kiểm tra bảng A cuối cùng; đội đứng đầu theo toàn bộ tiêu chí điều lệ là vô địch.
- Knockout: kiểm tra đội thắng từng vòng trong nhánh và đội thắng chung kết.
- HCMC: xác nhận top 2 từng bảng vào tứ kết, theo dõi nhánh knockout và đội thắng chung kết.
- Viewer tại trang công khai chỉ nên thấy kết quả đã công bố/xác nhận. Trọng tài và BTC đối chiếu cùng mã fixture mới; đội trưởng kiểm tra **Lịch của đội tôi**; cầu thủ kiểm tra /player.
- Bước **Tổng kết giải đấu** chỉ sẵn sàng khi tất cả trận có trạng thái VERIFIED/LOCKED; sau đó nút **Kết thúc giải đấu** đổi trạng thái tournament sang COMPLETED.

**Giới hạn giao diện tổng kết:** code hiện đọc standings, sắp theo điểm và hiệu số, đồng thời render teamId trong hàng xếp hạng. Nó chưa chứng minh thứ tự đủ các tiêu chí điều lệ khi hòa điểm/hiệu số, và màn tổng kết không tự lấy đội thắng nhánh cho knockout/hybrid. Xác nhận nhà vô địch bằng sơ đồ knockout và kết quả chung kết đã công nhận; coi màn tổng kết là trạng thái hoàn tất giải, không phải bằng chứng duy nhất của đội vô địch.

## 5. Các điểm BLOCKED / NOT TESTED sau reset

| Phần | Trạng thái | Lý do |
|---|---|---|
| Sao lưu và reset có phạm vi | PASS | Sáu dump đã so SHA-256 và đọc archive; reset theo sáu database sở hữu |
| Ba giải ở bước BTC duyệt | PASS | UI Docker hiển thị 4, 20 và 16 hồ sơ Chờ duyệt; roster/lời mời đúng số |
| Điều lệ và tài khoản | PASS | Giữ 3 điều lệ, 6 phiên bản; tài khoản, trường, đội, cầu thủ, trọng tài không bị reset |
| B3/B4/B5/B6 sau reset | NOT TESTED | Chưa thực hiện bốc thăm, sinh sơ đồ, lập lịch hoặc phân công theo đúng yêu cầu |
| Tạo lịch ngay từ dữ liệu vừa reset | BLOCKED cho tới khi cấu hình sân | Có 14 venue dùng chung nhưng không có venue availability; nhiều bản ghi là placeholder/QA, cần BTC xác minh địa điểm thật |
| Đội trưởng gửi đội hình / START_MATCH | BLOCKED bởi quy tắc | Không có operation-rule supplement đã công bố; Match Service sẽ chặn các trường đội hình/nguồn luật chưa xác định |
| Khai mạc giải qua giao diện BTC | FAIL giao diện hiện tại | API trạng thái tồn tại, nhưng BtcTournamentWorkspace chỉ render hành động mở đăng ký; chưa render nút chuyển PREPARING sang IN_PROGRESS |
| Bàn thắng, biên bản, kết quả và BXH trên ba giải sau reset | NOT TESTED | Không tạo dữ liệu trận thử hoặc kết quả thay người dùng |
| Kết thúc giải / xác định vô địch trên ba giải | NOT TESTED | Cần hoàn tất và công nhận toàn bộ trận; tổng kết knockout/hybrid có giới hạn nêu trên |

Nếu BTC chọn tiếp tục bằng API sau khi toàn bộ lịch và phân công cần thiết đã công bố, API hiện có là PUT /api/tournaments/{tournamentId} với body {"status":"IN_PROGRESS"} trong phiên đăng nhập BTC. Đây là chuyển trạng thái nghiệp vụ thật; service vẫn kiểm tra quyền và readiness. Không gửi lệnh này trước khi lịch/phân công đạt readiness. Lần reset và lần kiểm tra này không gọi API chuyển trạng thái.

## 6. Kiểm tra hệ thống sau reset

- Docker: web-client tại cổng 5173; API Gateway và năm service đều đang chạy, các container có healthcheck đều healthy.
- GET http://localhost:5173/api/health trả status ok.
- BTC đăng nhập thành công và đọc trang quản lý HCMC hiển thị 20/20 Chờ duyệt; IUH 4/4 và Knockout 16/16 cũng đã kiểm tra trên giao diện.
- Không chạy build/typecheck vì lần này chỉ reset dữ liệu và kiểm tra đọc; không sửa source code hoặc migration.
- Không bấm thao tác nghiệp vụ sau bước reset. Các bước trên cần BTC tự thực hiện.

Kịch bản đơn trận trong [MATCH_DEMO_TEST_GUIDE.md](./MATCH_DEMO_TEST_GUIDE.md) dùng fixture cũ HITU 14–TDC 07. ID trận cũ đã bị xóa trong lần reset này; sử dụng tài liệu hiện tại và chọn fixture mới sau khi công bố sơ đồ.
