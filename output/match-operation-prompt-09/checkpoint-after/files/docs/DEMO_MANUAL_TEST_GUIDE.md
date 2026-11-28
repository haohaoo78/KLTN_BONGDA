# Hướng dẫn kiểm thử thủ công hệ thống Sân Cỏ

Cập nhật 17/11/2026. Đây là dữ liệu development, không dùng cho production.

## Đăng nhập

- Mở [http://localhost:5173](http://localhost:5173). Mật khẩu tài khoản demo/seed: `Demo@123456`.
- Đăng xuất trước khi đổi vai trò để tránh dùng nhầm quyền phiên trước.
- Danh sách email, mật khẩu, vai trò, trường, CLB và ghi chú: [DEMO_ACCOUNT_CREDENTIALS.csv](./DEMO_ACCOUNT_CREDENTIALS.csv) (716 dòng tài khoản).
- Bỏ qua `viewer.pending@football.local`: mật khẩu chưa xác minh, để trống trong CSV.
- Tài khoản seed được đánh dấu đã xác minh email trong development; seed không gửi thư SMTP thật.

## Bản đồ tài khoản

| Vai trò | Đăng nhập | Việc kiểm tra |
|---|---|---|
| Khách/Viewer | `viewer.demo@football.local` | Xem giải công khai, điều lệ và thông tin được công bố; xác nhận không có quyền điều hành. |
| Admin | `admin.demo@football.local` | Quản lý trường/tài khoản/yêu cầu vai trò; không duyệt đội hay điều hành giải thay BTC. Đối chiếu `admin.hcm.demo@football.local`. |
| BTC IUH | `btc.iuh@football.local` | Quản lý giải do mình tổ chức, duyệt hồ sơ cấp đội; còn một hồ sơ chờ ở giải IUH cũ. |
| BTC trường khác | `dataset.btc01`–`dataset.btc10` + `@football.local` | 01 IUH, 02 HUTECH, 03 UEF, 04 UEH, 05 Cao Thắng, 06 HITU, 07 TDC, 08 HCMCT, 09 IUH, 10 HUTECH. Dùng kiểm tra giới hạn quyền. |
| Đội trưởng IUH | `dataset.captain01`–`dataset.captain10` + `@football.local` | CLB cùng số: 01–08 đã duyệt, 09 bị từ chối, 10 có roster đã đồng ý nhưng chưa nộp. |
| Đội trưởng liên trường | `dataset.captain11`–`dataset.captain30` + `@football.local` | CLB cùng số: 11–26 đã duyệt, 27–30 bị từ chối. |
| Cầu thủ đồng ý | `player.iuh@football.local` | Lời mời đang chờ ở IUH Eagles / IUH Cup cũ; tự bấm đồng ý. |
| Cầu thủ từ chối | `player.iuh2@football.local` | Lời mời đang chờ ở IUH Eagles / IUH Cup cũ; tự bấm từ chối. |
| Cầu thủ demo đã phản hồi | `dataset.player0001`–`dataset.player0600` và `dataset.extra.player01`–`dataset.extra.player30` + `@football.local` | Thành viên CLB; lời mời hai giải mới đã đồng ý. Không cần đăng nhập hàng trăm tài khoản. |
| Trọng tài | `referee.demo@football.local` | Xem dashboard/trận được phân công. Trống nếu chưa được phân công là đúng theo quyền. |

**Mật khẩu chung:** `Demo@123456`.

## Kịch bản theo vai trò

### 1. Viewer xem giải công khai

1. Đăng nhập `viewer.demo@football.local` → **Giải đấu**.
2. Tìm `IUH Student Cup 2026 - 10 Team Dataset` và `HCMC Inter-School Student Cup 2027 - 20 Team Dataset`.
3. Mở chi tiết, xem thời gian, thể thức, điều lệ và thông tin công khai.
4. Xác nhận không có nút duyệt đội, chốt roster, chia bảng hoặc quản lý.

### 2. Admin và phân quyền

1. Đăng nhập `admin.demo@football.local`, mở khu vực quản trị.
2. Kiểm tra màn hình trường, tài khoản và yêu cầu vai trò đang có dữ liệu.
3. Thử mở giải công khai. Admin không được quản lý giải hoặc duyệt đội chỉ vì có quyền admin.

### 3. Cầu thủ phản hồi lời mời

1. Đăng nhập `player.iuh@football.local` → **Thông báo** hoặc **Lời mời tham gia giải**.
2. Mở lời mời IUH Eagles trong `IUH Cup – Thử luồng đăng ký từ đầu (DEMO)`, kiểm tra rồi bấm **Đồng ý tham gia**.
3. Đăng xuất, đăng nhập `player.iuh2@football.local`, mở cùng lời mời và bấm **Từ chối tham gia**.
4. Đăng nhập `captain.iuh@football.local`, mở IUH Eagles và xác nhận hai phản hồi đã đồng bộ.
5. Kết quả đúng: cầu thủ tự phản hồi; BTC không duyệt từng cầu thủ.

### 4. Đội trưởng xem CLB và hồ sơ

- Thành viên: đăng nhập `dataset.captain01@football.local` → **Đội bóng của tôi** → IUH Demo Club 01. Mỗi CLB demo có 21 thành viên.
- Roster chưa gửi: đăng nhập `dataset.captain10@football.local`; IUH Demo Club 10 có 20 lời mời đã đồng ý ở IUH Student Cup nhưng chưa nộp. Có thể tự gửi để thử bước tiếp theo; thao tác này tạo hồ sơ chờ BTC.
- Hồ sơ được duyệt: `dataset.captain01@football.local` (IUH Cup) hoặc `dataset.captain11@football.local` (Inter-School Cup).
- Hồ sơ bị từ chối: `dataset.captain09@football.local` hoặc `dataset.captain27@football.local`; xem trạng thái, lý do và lịch sử.
- Snapshot đã nộp là lịch sử; thay đổi thành viên CLB không tự sửa roster đã gửi.

### 5. BTC xét hồ sơ đội

1. Đăng nhập `btc.iuh@football.local` → **Giải đấu của tôi** → chọn giải → **Xét duyệt đội**.
2. IUH Student Cup: lọc được duyệt/từ chối, mở chi tiết và kiểm tra trường, đội trưởng, roster, số lượng.
3. Inter-School Cup: kiểm tra 16 hồ sơ được duyệt và 4 hồ sơ bị từ chối.
4. Để thử quyết định thật, mở giải IUH cũ `IUH Cup – Thử luồng đăng ký từ đầu (DEMO)`; SFL Demo North của `captain.demo@football.local` đang chờ BTC.
5. Chỉ bấm **Duyệt**, **Từ chối** hoặc **Yêu cầu bổ sung** nếu muốn thay dữ liệu. Nhập lý do/nội dung theo yêu cầu form.
6. Đăng nhập lại đội trưởng để kiểm tra trạng thái và thông báo.
7. BTC quyết định cả hồ sơ đội; không có duyệt riêng từng cầu thủ.

### 6. BTC ngoài phạm vi

1. Đăng nhập `dataset.btc02@football.local` (BTC HUTECH), thử quản lý giải của `btc.iuh`.
2. Sửa/duyệt/chốt/chia bảng phải bị từ chối nếu BTC không được phân công vào giải.
3. Lặp lại với `dataset.btc01@football.local` (BTC IUH). Cùng trường không đồng nghĩa tự có quyền vào giải.

### 7. Trọng tài

Đăng nhập `referee.demo@football.local` → dashboard trận. Chỉ thao tác trận được phân công. Nếu chưa có trận, BTC cần lập lịch và phân công trước.

## Dữ liệu giải hiện có

| Giải | Dữ liệu ban đầu | Tài khoản chính |
|---|---|---|
| IUH Student Cup 2026 - 10 Team Dataset | Nội bộ IUH, mở đăng ký; 8 đội 01–08 duyệt, 09 từ chối, đội 10 chưa gửi. Bóng đá 7 người, vòng bảng + playoff. | BTC `btc.iuh`; captains 01–10. |
| HCMC Inter-School Student Cup 2027 - 20 Team Dataset | Liên trường, mở đăng ký; 16 đội 11–26 duyệt, 4 đội 27–30 từ chối; hạn mức 24 toàn giải, 3/trường. Bóng đá 7 người, vòng bảng + playoff. | BTC `btc.iuh`; captains 11–30. |
| IUH Cup – Thử luồng đăng ký từ đầu (DEMO) | Một hồ sơ đội chờ BTC và hai lời mời cầu thủ chờ phản hồi. | `captain.demo`, `btc.iuh`, `player.iuh`, `player.iuh2`. |

## Bộ dữ liệu mới để bắt đầu từ bước BTC duyệt đội

> Dữ liệu này được thêm riêng, không xóa/reset các giải, đội, tài khoản hoặc volume hiện tại. Seed bỏ qua bước gửi email: lời mời cho 14 cầu thủ mỗi đội được ghi sẵn là đã đồng ý để bạn bắt đầu ngay tại bước xét duyệt hồ sơ đội. Seed không tạo notification/email outbox. Cấu hình SMTP trong `.env`/Docker Compose không bị thay đổi; các luồng gửi email thật của ứng dụng vẫn giữ nguyên.

Chạy khi Docker Compose và các service đang hoạt động:

```powershell
docker compose --profile apps --profile approval-demo build tournament-service organization-service
docker compose --profile apps --profile approval-demo run --rm approval-workflow-demo-tournament-seed
docker compose --profile apps --profile approval-demo run --rm approval-workflow-demo-registration-seed
```

Hai seed có ID ổn định, chạy lại không tạo thêm giải/hồ sơ. Không chạy lại sau khi bạn đã bắt đầu thao tác duyệt nếu muốn giữ nguyên các quyết định thủ công. Seed chỉ thêm hai giải:

| Giải mới | Hồ sơ chờ BTC | Cấu hình để test |
|---|---:|---|
| `IUH Student Cup 2026 — Bộ dữ liệu duyệt đội & chia bảng` | 8 đội IUH | Nội bộ, 7 người, 2 bảng × 4 đội, 2 đội/bảng vào playoff. |
| `HCMC Inter-School Cup 2026 — Bộ dữ liệu duyệt đội & lập lịch` | 16 đội từ 8 trường (IUH 1, HUTECH 3, các trường còn lại 2 mỗi trường) | Liên trường, giới hạn 3 đội/trường, 4 bảng × 4 đội, 2 đội/bảng vào playoff. |

ID giải tương ứng: IUH `146f17f0-e4ba-542f-b5e2-f86c1fae6f87`; liên trường `964289df-2710-56f6-ad72-937aef0a4d1c`. BTC `dataset.btc01@football.local` đã đăng nhập được và thấy cả hai giải trong danh sách do mình tổ chức. Sân hoạt động để xếp lịch: `SFL Demo Stadium`.

Mỗi hồ sơ có snapshot 14 cầu thủ (7 đá chính gồm 1 thủ môn, 7 dự bị), danh tính/MSSV/số áo/vị trí và lời mời `ACCEPTED`. Roster vẫn ở trạng thái chờ xét theo hồ sơ; BTC chỉ duyệt cả đội, không có bước duyệt cầu thủ riêng. Toàn bộ hồ sơ ban đầu là `PENDING`; không tạo đội đã duyệt, bản chia bảng hay trận giả. Tài khoản đội trưởng là `dataset.captain01`–`08` cho giải IUH và `dataset.captain09`, `dataset.captain11`–`25` cho giải liên trường; BTC IUH được phân quyền hai giải là `dataset.btc01@football.local`. Mật khẩu chung `Demo@123456`.

Để kiểm thử:

1. Vào **Giải đấu của tôi**, mở một trong hai giải mới bằng tài khoản BTC `dataset.btc01@football.local`.
2. Ở bước **Xét duyệt đội**, lọc `Chờ duyệt`, mở chi tiết roster, rồi tự duyệt/từ chối/yêu cầu bổ sung hồ sơ đội.
3. Sau khi duyệt đủ đội, đóng đăng ký; qua **Chốt danh sách** và xác nhận roster.
4. Vào **Chia bảng / bốc thăm** để chia thủ công/ngẫu nhiên/theo hạt giống, xem trước rồi công bố.
5. Sang **Xếp lịch và phân công sân** để tạo lịch cho các trận vừa công bố. Ngày giải được đặt tương đối trong tương lai; cần có sân hoạt động và kiểm tra xung đột trước khi lưu/công bố.

Các đội trưởng có thể đăng nhập để xem hồ sơ và roster hiện có, nhưng không cần đăng nhập hàng trăm cầu thủ. Vì đây là fixture bắt đầu từ bước duyệt đội, seed ghi lời mời được đồng ý trực tiếp trong dữ liệu development; không dùng nó để kiểm thử luồng email/lời mời từ đầu.

## Chạy tiếp quy trình điều hành giải

Hai giải mới chưa được chạy hết các bước này. Dùng IUH Student Cup (8 đội duyệt) để thử trước.

1. Với `btc.iuh`, vào **Giải đấu của tôi** → quản lý IUH Student Cup.
2. Đóng nhận hồ sơ ở bước xét duyệt khi đã chấp nhận không nhận thêm đăng ký.
3. Sang **Chốt danh sách**, rà soát điều kiện/roster rồi xác nhận.
4. Sang **Chia bảng / bốc thăm**, xem trước, kiểm tra đủ đội, lưu/công bố nếu muốn.
5. Sang **Xếp lịch và phân công sân**; cần sân/khung giờ khả dụng. Kiểm tra xung đột đội, sân và thời gian nghỉ.
6. Sang **Phân công trọng tài**; chọn trọng tài hoạt động, không trùng lịch.
7. Trọng tài ghi nhận trận được giao và gửi biên bản; BTC kiểm tra ở bước theo dõi/duyệt biên bản.
8. Đối chiếu bảng xếp hạng/nhánh sau kết quả hợp lệ; kết thúc khi đủ điều kiện.

> Đóng đăng ký, chốt roster và công bố bảng/lịch có thể khóa hoặc thay đổi dữ liệu. Nếu chỉ xem, dừng trước khi xác nhận. Nếu sân/trọng tài trống, cần chuẩn bị dữ liệu cho bước kế tiếp; không coi đó là bước đã kiểm thử.

## Xác nhận thao tác thành công

Sau khi gửi lời mời, phản hồi, gửi hồ sơ, BTC quyết định hoặc chốt dữ liệu:

1. Kiểm tra thông báo và trạng thái trên màn hình vừa thao tác.
2. Đăng nhập vai trò phía bên kia để xác nhận dữ liệu đồng bộ.
3. Mở chi tiết/lịch sử để đối chiếu người thao tác, thời gian và lý do.

Không coi HTTP 200 là đủ nếu trạng thái phía còn lại hoặc lịch sử chưa cập nhật.

## Giới hạn đã biết

- Hai giải mới có 8 đội nội bộ và 16 đội liên trường được duyệt; 600 lời mời đã được từng tài khoản cầu thủ phản hồi qua API thật.
- Hai lời mời chờ và một hồ sơ đội chờ BTC được giữ cho kiểm thử thủ công.
- Chưa xác minh browser E2E toàn bộ chốt roster → chia bảng → lịch → trọng tài → trận → kết quả → xếp hạng → kết thúc trên hai giải mới. Đây là hướng dẫn chạy các bước, không phải tuyên bố đã kiểm thử xong.
- Dữ liệu demo có 8 trường: IUH, HUTECH, UEF, UEH, Cao Thắng, HITU, TDC, HCMCT.

Chi tiết seed: [DEMO_TEST_ACCOUNTS.md](./DEMO_TEST_ACCOUNTS.md). API và quy tắc roster: [TOURNAMENT_TEAM_REGISTRATION_WORKFLOW.md](./TOURNAMENT_TEAM_REGISTRATION_WORKFLOW.md).
