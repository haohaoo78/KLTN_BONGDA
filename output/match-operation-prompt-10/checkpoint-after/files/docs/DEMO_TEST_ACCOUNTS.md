# Bộ dữ liệu kiểm thử hai giải đấu

Cập nhật và kiểm tra qua API/Docker ngày 17/11/2026. Đây là dữ liệu development. Không dùng cho production.

> Để tạo bộ dữ liệu riêng bắt đầu từ bước duyệt đội (8 hồ sơ IUH + 16 hồ sơ liên trường) mà không gửi email, xem mục **Bộ dữ liệu mới để bắt đầu từ bước BTC duyệt đội** trong [DEMO_MANUAL_TEST_GUIDE.md](./DEMO_MANUAL_TEST_GUIDE.md). Bộ dữ liệu cũ bên dưới vẫn được giữ nguyên.

## Bộ dữ liệu mới đã được tạo

- IUH: `IUH Student Cup 2026 — Bộ dữ liệu duyệt đội & chia bảng`, ID `146f17f0-e4ba-542f-b5e2-f86c1fae6f87`, 8/8 hồ sơ đang `PENDING`.
- Liên trường: `HCMC Inter-School Cup 2026 — Bộ dữ liệu duyệt đội & lập lịch`, ID `964289df-2710-56f6-ad72-937aef0a4d1c`, 16/16 hồ sơ đang `PENDING`, có đại diện 8 trường.
- BTC IUH: `dataset.btc01@football.local`; mật khẩu `Demo@123456`. Đăng nhập/API đã xác nhận tài khoản thấy cả hai giải.
- Mỗi hồ sơ có 14 cầu thủ và lời mời đã chấp nhận; tổng roster là 112 cho giải IUH và 224 cho giải liên trường. Seed không tạo email/thông báo gửi đi.
- Sân `SFL Demo Stadium` đang active. Notification service healthy. SMTP config trong `.env` vẫn có đủ host/user/password/from và giữ nguyên trong Docker Compose; không gửi thư kiểm thử.
- Chạy lại được seed mà không thêm trùng. Không chạy lại sau khi đã bắt đầu xét duyệt nếu muốn giữ trạng thái thao tác tay.

## Đăng nhập

- Ứng dụng: http://localhost:5173
- Mật khẩu các tài khoản seed và demo đã xác minh: `Demo@123456`. Riêng tài khoản legacy `viewer.pending@football.local` chưa xác minh được mật khẩu và để trống trong CSV.
- Tài khoản seed có `email_verified=true` trong database development để đăng nhập ngay; seed không gửi thư xác minh SMTP.
- Danh sách email, mật khẩu, vai trò, trường và CLB ở định dạng CSV: [DEMO_ACCOUNT_CREDENTIALS.csv](./DEMO_ACCOUNT_CREDENTIALS.csv) (716 tài khoản demo/test; không gồm tài khoản email cá nhân không dùng cho demo).

### Tài khoản kiểm thử thủ công đã giữ lại

| Thao tác | Email | Đội / giải | Trạng thái ban đầu |
|---|---|---|---|
| Tự đồng ý lời mời | `player.iuh@football.local` | IUH Eagles / IUH Cup – Thử luồng đăng ký từ đầu (DEMO) | `PENDING` |
| Tự từ chối lời mời | `player.iuh2@football.local` | IUH Eagles / IUH Cup – Thử luồng đăng ký từ đầu (DEMO) | `PENDING` |
| Kiểm tra hồ sơ chờ BTC | `captain.demo@football.local` | SFL Demo North / IUH Cup – Thử luồng đăng ký từ đầu (DEMO) | Đội đăng ký `PENDING` |
| Xét hồ sơ | `btc.iuh@football.local` | BTC IUH | Có 1 hồ sơ chờ duyệt ở giải IUH Cup cũ |

Hai lời mời thủ công đã được xác minh lại sau khi tạo dữ liệu lớn và vẫn đang chờ phản hồi. Không phản hồi thay hai cầu thủ này.

### Tài khoản dữ liệu 30 CLB

- Đội trưởng: `dataset.captain01@football.local` đến `dataset.captain30@football.local`.
- BTC theo trường: `dataset.btc01@football.local` đến `dataset.btc10@football.local`.
- Cầu thủ 20 thành viên ban đầu: `dataset.player0001@football.local` đến `dataset.player0600@football.local`.
- Thành viên thứ 21 của từng đội: `dataset.extra.player01@football.local` đến `dataset.extra.player30@football.local`.
- Có 10 đội trưởng IUH; 20 đội trưởng còn lại điều hành CLB tại các trường khác. 10 BTC được gán IUH, HUTECH, UEF, UEH, Cao Thắng, HITU, TDC và HCMCT (hai trường đầu mỗi trường có 2 BTC; các trường còn lại mỗi trường 1 BTC).
- Mỗi CLB có 21 thành viên có tài khoản, MSSV, số áo và vị trí; tài khoản và thành viên được tạo ở đúng Auth/Organization service.
- Có 10 CLB IUH (`IUH Demo Club 01`–`10`) và 20 CLB liên trường (`Demo Club 11`–`30`) thuộc HUTECH, UEF, UEH, Cao Thắng, HITU, TDC và HCMCT.
- BTC giải: `btc.iuh@football.local`.

## Hai giải đang mở đăng ký

### IUH Student Cup 2026 – giải nội bộ

- ID: `f821fd29-65ba-46a6-9da8-61be9d451c5f`
- BTC: `btc.iuh@football.local`; IUH.
- Thời gian: 02–10/01/2027; bóng đá 7 người; vòng bảng kết hợp playoff.
- Hạn mức: 10 đội toàn giải, tối đa 10 đội IUH.
- 8 đội đã được BTC duyệt: `IUH Demo Club 01`–`08`.
- 1 hồ sơ bị từ chối để kiểm tra thông báo/lịch sử: `IUH Demo Club 09`.
- `IUH Demo Club 10`: 20 lời mời đã được cầu thủ chấp nhận, roster sẵn sàng nhưng chưa gửi hồ sơ.

### HCMC Inter-School Student Cup 2027 – giải liên trường

- ID: `ee52c17e-19fb-4bd5-9e12-1686b1168df4`
- BTC: `btc.iuh@football.local`; IUH.
- Thời gian: 16/01–07/02/2027; bóng đá 7 người; vòng bảng kết hợp playoff.
- Hạn mức: 24 đội toàn giải, tối đa 3 đội/trường.
- 16 đội đã được BTC duyệt: `Demo Club 11`–`26`.
- 4 đội bị từ chối để kiểm tra luồng: `Demo Club 27`–`30`.

Mỗi hồ sơ đã nộp lưu snapshot roster 20 cầu thủ; thành viên thứ 21 được thêm sau khi nộp để dữ liệu CLB có hơn 20 thành viên, không tự ý sửa snapshot lịch sử. Tổng cộng 600 lời mời thuộc hai giải đã được tạo qua API; từng cầu thủ đăng nhập bằng tài khoản của mình và gọi API phản hồi `ACCEPTED`. BTC duyệt/từ chối hồ sơ đội qua API. Không cập nhật trực tiếp database để giả lập việc đồng ý hoặc xét duyệt.

## Các bước kiểm thử

### Cầu thủ nhận lời mời

1. Đăng nhập `player.iuh@football.local` và mở mục **Lời mời tham gia giải**.
2. Xác nhận thông tin IUH Eagles và bấm **Đồng ý tham gia**.
3. Đăng nhập `player.iuh2@football.local` và bấm **Từ chối tham gia**.
4. Đăng nhập lại `captain.iuh@football.local`, mở IUH Eagles, kiểm tra hai phản hồi trên bảng lời mời.

### Đội trưởng xem roster đã xác nhận

1. Đăng nhập `dataset.captain10@football.local`.
2. Mở `IUH Demo Club 10`, xem thành viên và trạng thái mời trong IUH Student Cup.
3. CLB có 21 thành viên. 20 cầu thủ trong lời mời đã xác nhận; thành viên thứ 21 được thêm sau khi tạo snapshot giải, nên chưa nằm trong lời mời/roster của giải.
4. Roster 20 người của CLB đã xác nhận nhưng chưa gửi BTC; có thể dùng để kiểm tra UI trước bước nộp hồ sơ.

### BTC kiểm tra giải mới

1. Đăng nhập `btc.iuh@football.local`.
2. Mở **Giải đấu của tôi** → IUH Student Cup hoặc HCMC Inter-School Student Cup → bước **Xét duyệt đội**.
3. Lọc trạng thái `Đã duyệt`/`Bị từ chối`, mở chi tiết và kiểm tra trường, đội trưởng, 20 cầu thủ cùng trạng thái hồ sơ.
4. Tại giải liên trường, kiểm tra 16 đội được duyệt và 4 hồ sơ bị từ chối.
5. Giải IUH cũ còn một hồ sơ đang chờ: `captain.demo@football.local` / SFL Demo North. Đây là hồ sơ dành cho thao tác BTC thủ công; không xử lý tự động.

## Trạng thái đã đối chiếu

- Auth DB: 717 tài khoản tổng; trong đó bộ dữ liệu mới có 630 PLAYER, 30 TEAM_CAPTAIN và 10 BTC; tài khoản được đánh dấu xác minh email trong môi trường demo.
- Organization DB: 30 CLB demo, mỗi CLB có 21 thành viên; tổng cộng 630 thành viên demo liên kết tài khoản.
- Invitation DB, hai giải mới: 600 `ACCEPTED`.
- IUH Student Cup: 8 `APPROVED`, 1 `REJECTED`; đội thứ 10 chưa nộp hồ sơ.
- HCMC Inter-School Student Cup: 16 `APPROVED`, 4 `REJECTED`.
- Giải IUH cũ: còn đúng 1 hồ sơ `PENDING` của SFL Demo North; hai lời mời cầu thủ thủ công còn `PENDING`.
- API đọc của BTC trả đúng tên giải và số hồ sơ theo trạng thái; mọi phản hồi lời mời và quyết định đăng ký ở trên được thực hiện qua API thật.

## Giới hạn hiện tại

- Backend chưa có trạng thái/API lưu hồ sơ đăng ký đội `DRAFT`. Vì vậy `IUH Demo Club 10` là roster được xác nhận nhưng chưa nộp, không phải hồ sơ nháp đã lưu. Không giả lập hồ sơ nháp bằng ghi database.
- Snapshot đăng ký đã gửi trước đó vẫn giữ 20 cầu thủ; thành viên thứ 21 của từng CLB là thành viên CLB mới được thêm sau đó và không tự động chèn vào hồ sơ giải.
- Bộ dữ liệu dùng 8 trường đang có trong catalog nội bộ (IUH, HUTECH, UEF, UEH, Cao Thắng, HITU, TDC, HCMCT); danh mục hiện chưa có HCMUTE, OU, TDTU hoặc HCMUS.
- Đã kiểm tra số liệu lời mời, hồ sơ và API các vai trò đội trưởng/cầu thủ/BTC. Chưa chạy quy trình chia bảng, sinh lịch, phân công trọng tài và thi đấu trên hai giải mới.
- `IUH Registration Limit Validation - Closed` là fixture bổ sung đã đóng sau khi kiểm tra giới hạn 2 đội/trường; hai hồ sơ bị từ chối có audit trail. Dùng giải mang tên chính thức bên trên để kiểm tra nghiệp vụ chính.
- CSV có một tài khoản legacy `viewer.pending@football.local` chưa đăng nhập được bằng mật khẩu chung; bỏ qua tài khoản này khi kiểm thử đăng nhập. Các tài khoản mới `dataset.btc01`–`10` và `dataset.extra.player01`–`30` đã đăng nhập thử thành công.
