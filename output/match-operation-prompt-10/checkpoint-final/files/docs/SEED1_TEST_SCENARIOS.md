# Seed 1 — Kịch bản kiểm thử thủ công

Tài liệu này mô tả dữ liệu Seed 1 trên Docker development hiện tại. Seed chuẩn bị trạng thái ban đầu; người kiểm thử tự thao tác trên giao diện. Không chạy seed bằng `scripts/test-seeds/Run-TestSeed.ps1` trên stack này vì script đó tạo/xóa stack isolated.

## Đăng nhập

Frontend: <http://localhost:5173>. Các tài khoản `dataset.*` trong bảng dùng mật khẩu **`Demo@123456`**. Đây là mật khẩu demo development, không dùng production.

| Tài khoản | Vai trò | Dữ liệu ban đầu | Tôi cần thao tác | Kết quả mong đợi |
|---|---|---|---|---|
| `dataset.player0612@football.local` (P01) | Cầu thủ | IUH Warriors; PENDING A và B | Mở Lời mời tham gia giải, chấp nhận A | A thành ACCEPTED; B tự INVALIDATED; captain nhận thông báo |
| `dataset.player0613@football.local` (P02) | Cầu thủ | IUH Warriors; PENDING A và B | Từ chối A | A thành DECLINED; B vẫn PENDING |
| `dataset.player0616@football.local` (P03) | Cầu thủ | ACCEPTED A; PENDING C; C không trùng lịch | Chấp nhận C | C thành ACCEPTED; quyền tham gia cả A và C được giữ |
| `dataset.player0617@football.local` (P04) | Cầu thủ | PENDING A/B/C; A và B trùng, C không trùng | Chấp nhận B | B thành ACCEPTED; A thành INVALIDATED; C vẫn PENDING |
| `dataset.player0618@football.local` (P05) | Cầu thủ | PENDING A/B | Từ chối từng lời mời | Mỗi lời mời thành DECLINED riêng; không đổi lời mời còn lại trước khi thao tác |
| `dataset.player0619@football.local` (P06) | Cầu thủ | PENDING A | Không cần thao tác ở bước này | Lời mời còn hiệu lực để captain thử gửi trùng |
| `dataset.player0620@football.local` (P07) | Cầu thủ | ACCEPTED A; chưa có lời mời B | Không cần thao tác ở bước này | Captain không gửi được lời mời vào B do A/B trùng lịch |
| `dataset.player0611@football.local` (P08) | Cầu thủ | Có lời mời DECLINED A; trước đó có lịch sử lời mời bị hủy | Captain gửi lại lời mời A, sau đó đăng nhập P08 và chấp nhận lời mời mới | Lời mời mới được tạo riêng; không sửa lịch sử lời mời cũ |
| `dataset.player0602@football.local` | Cầu thủ | ACCEPTED trong draft A của IUH Warriors; chưa có yêu cầu rút mới | Vào Giải đấu đã xác nhận → A → Chi tiết → Yêu cầu rút xác nhận; nhập lý do | Yêu cầu chờ; vẫn thuộc roster và giữ claim cho đến khi captain quyết định |
| `dataset.player0241@football.local` | Cầu thủ | Lịch sử rút trước đây; hiện ACCEPTED trong hồ sơ `REVISION_REQUIRED` của IUH Demo Club 13 ở giải B | Vào Giải đấu đã xác nhận → B → Chi tiết → Yêu cầu rút xác nhận | Có thể thử gửi yêu cầu rút; đây không phải fixture PENDING sạch |
| `dataset.player0002@football.local` | Cầu thủ | ACCEPTED trong hồ sơ APPROVED của IUH Demo Club 01 ở Seed 1 mở rộng; chưa có yêu cầu rút | Vào Lời mời dự giải và mở hồ sơ | Không có form xin rút tự nguyện; hồ sơ APPROVED không đổi |
| `dataset.captain31@football.local` | Đội trưởng | IUH Warriors; A/B/C; roster A có ít nhất 11 cầu thủ ACCEPTED, đủ điều lệ | Mở Quản lý roster; thử gửi trùng P06, mời P07 vào B, gửi lại P08 | Chặn trùng PENDING; chặn P07 theo lịch A; cho gửi lại P08 sau DECLINED |
| `dataset.captain13@football.local` | Đội trưởng | IUH Demo Club 13; hồ sơ PENDING ở A và B | Mở hồ sơ, xem danh sách cầu thủ và thao tác cập nhật trong giới hạn còn cho phép | BTC chỉ xem phiên bản hiện hành; hồ sơ chưa có quyết định |
| `dataset.captain01@football.local` | Đội trưởng | IUH Demo Club 01; hồ sơ APPROVED và một yêu cầu rút đội PENDING để BTC thử queue | Mở chi tiết hồ sơ và lịch sử yêu cầu | Yêu cầu vẫn PENDING; không có quyết định được seed sẵn |
| `dataset.btc01@football.local` | BTC IUH | Được phân công các giải demo IUH; giải Seed 1 hiện hành có hồ sơ đã duyệt/từ chối/cần bổ sung | Mở BTC → chọn giải → xem danh sách hồ sơ và xử lý thao tác đang được mở | Trạng thái thay đổi theo quyết định của BTC; không có thao tác nào được seed xử lý thay |

## Giải và roster lời mời

| Ký hiệu | Giải | ID | Lịch |
|---|---|---|---|
| A | Kiểm thử lời mời cầu thủ trùng lịch — Giải A | `12050c82-ca1e-5174-9f23-6065cf7b58b5` | Trùng với B |
| B | Kiểm thử lời mời cầu thủ trùng lịch — Giải B | `3b78de98-ed74-5980-83d9-6fee8237ed1c` | Trùng với A |
| C | Kiểm thử lời mời cầu thủ không trùng lịch — Giải C | Tạo ổn định theo khóa seed `sftms-player-invite-nonoverlap-c-2026` | Sau A/B, không giao nhau |

Đội thử nghiệm là **IUH Warriors**, trường IUH; captain `dataset.captain31@football.local`. A có ít nhất 11 cầu thủ đã xác nhận sẵn (đủ tối thiểu 7, tối đa 18 và có thủ môn). Các lời mời P01–P08 là phần kiểm thử riêng; trạng thái chờ của họ không làm roster đã xác nhận bị thiếu điều kiện.

Tài khoản `dataset.player0614@football.local` còn các lời mời PENDING từ bộ fixture overlap cũ; đây là dữ liệu lịch sử ngoài P01–P08, không dùng làm một trong tám kịch bản mới.

Đăng nhập P01–P08 bằng email ở bảng trên. Mở **Lời mời tham gia giải** để xem giải, trạng thái và phản hồi. Đội trưởng xem **Quản lý roster** để mời, xem số đã xác nhận và kiểm tra cầu thủ có thể chọn.

## Những trạng thái hồ sơ và yêu cầu rút

Trong giải Seed 1 mở rộng (`5b3e59ec-233b-5de2-8482-079e80e8c8d4`), database có hồ sơ `APPROVED`, `REJECTED`, `NEEDS_SUPPLEMENT`; hai giải A/B có hồ sơ lịch sử của IUH Demo Club 13. IUH Warriors có draft A chứa roster ACCEPTED. Lịch sử cũ được giữ nguyên; fixture để thử chặn rút sau APPROVED là `player0002`. `player0241` hiện thuộc hồ sơ `REVISION_REQUIRED`, không phải fixture PENDING sạch. Không đổi trạng thái cũ để làm test thành công.

Seed hiện tại **chưa có fixture an toàn cho ROSTER_LOCKED hoặc giải đã chia bảng/đang thi đấu**. Các yêu cầu rút cầu thủ trong bảng test mới chưa được tạo sẵn; người kiểm thử gửi chúng trên giao diện. Không dùng dữ liệu APPROVED/locked để ép API. Không tạo lịch/trận/kết quả giả chỉ để làm bảng dữ liệu trông đầy đủ. Các fixture hiện hữu được giữ nguyên, không reset hoặc seed đè trong lần triển khai này.

## Seed 1 — kiểm thử rút cầu thủ rồi rút đội

Chạy bổ sung bằng `pnpm run seed:test:withdrawals`. Seed này không xóa, reset hoặc cập nhật trạng thái hồ sơ cũ. Nó giữ các yêu cầu hiện có và chỉ thêm một yêu cầu rút đội `PENDING` cho IUH Demo Club 02 nếu đội chưa có yêu cầu đang chờ. Seed không tạo sẵn yêu cầu rút cầu thủ; cầu thủ phải tự gửi yêu cầu trên giao diện.

| Thứ tự | Tài khoản | Vai trò / dữ liệu ban đầu | Thao tác bạn tự làm | Kết quả cần thấy |
|---|---|---|---|---|
| 1 | `dataset.player0602@football.local` | IUH Warriors, lời mời `ACCEPTED` trong draft Giải A | Gửi yêu cầu rút; đăng nhập `dataset.captain31@football.local` để chấp thuận | Invitation thành `WITHDRAWN`, cầu thủ rời roster nháp, CLB vẫn còn |
| 2a | `dataset.player0241@football.local` | IUH Demo Club 13, lời mời `ACCEPTED` trong hồ sơ lịch sử `REVISION_REQUIRED` Giải B; yêu cầu rút chưa gửi | Gửi yêu cầu; đội trưởng `dataset.captain13@football.local` từ chối với lý do | Yêu cầu `REJECTED`, invitation vẫn `ACCEPTED`; hồ sơ vẫn `REVISION_REQUIRED` |
| 2b | `dataset.player0241@football.local` | Cùng lời mời B còn `ACCEPTED`; yêu cầu trước đã `REJECTED` | Gửi yêu cầu rút lần nữa; captain13 chấp thuận | Yêu cầu mới `APPROVED`, invitation thành `WITHDRAWN`; hồ sơ `REVISION_REQUIRED` vẫn cần xử lý theo yêu cầu BTC; ca này không chứng minh tổ hợp `PENDING + DRAFT_CHANGES` |
| 3 | `dataset.player0242@football.local` | IUH Demo Club 13, hồ sơ Giải A `REVISION_REQUIRED` | Gửi yêu cầu rút; captain13 xử lý | Roster chỉnh sửa được cập nhật và cần gửi lại nếu đủ điều lệ |
| 4 | `dataset.player0002@football.local` | IUH Demo Club 01, hồ sơ `APPROVED` | Mở lời mời/chi tiết giải, thử tìm thao tác xin rút | Không có thao tác rút tự nguyện mới; roster chính thức không đổi |
| 5 | `dataset.captain13@football.local` | IUH Demo Club 13, hồ sơ lịch sử Giải B | Sau khi thử ca cầu thủ, kiểm tra hành động rút hồ sơ theo trạng thái đang hiển thị | Hành động chỉ khả dụng nếu trạng thái hiện tại cho phép; lịch sử không bị ghi đè |
| 6a | `dataset.captain01@football.local` → `dataset.btc01@football.local` | IUH Demo Club 01, `APPROVED`, yêu cầu rút đội đang chờ có sẵn | BTC chấp thuận yêu cầu | Registration `WITHDRAWN`, giải phóng suất/quyền tham gia theo trạng thái giải |
| 6b | `dataset.captain02@football.local` → `dataset.btc01@football.local` | IUH Demo Club 02, `APPROVED`; seed thêm một yêu cầu rút đội `PENDING` riêng | BTC từ chối, nhập lý do | Registration vẫn `APPROVED`, yêu cầu thành `REJECTED` |

Tài khoản dùng mật khẩu `Demo@123456`. Sau khi captain từ chối bước 2a, player0241 có thể gửi yêu cầu mới vì yêu cầu cũ đã kết thúc; không cần tạo dữ liệu thay thế. Đội trưởng và BTC cần đăng xuất/đăng nhập lại giữa các vai trò.

Seed 1 chưa có registration `ROSTER_LOCKED` thật hoặc fixture đã chia bảng/đang thi đấu cho rút đội. Không sửa trực tiếp `locked_at`, lịch, bảng đấu hay kết quả để giả trạng thái. API BTC hiện chặn chấp thuận rút sau khi draw được xác nhận/công bố hoặc giải bắt đầu với `WITHDRAWAL_REQUIRES_COMPETITION_CHANGE_WORKFLOW`; các ca này cần workflow phối hợp Tournament/Match riêng.

### Luồng rút cầu thủ theo trạng thái

| Hồ sơ | Thao tác | Kết quả mong đợi |
|---|---|---|
| DRAFT | Cầu thủ gửi yêu cầu; captain chấp thuận | Invitation thành `WITHDRAWN`, cầu thủ bị gỡ khỏi draft, roster tính lại; đội vẫn thuộc CLB |
| PENDING | Cầu thủ gửi yêu cầu; captain chấp thuận | Request `APPROVED`, invitation `WITHDRAWN`, registration vẫn `PENDING`, snapshot/version đã nộp giữ nguyên; mở draft `DRAFT_CHANGES` riêng với roster đã gỡ cầu thủ; BTC không thể duyệt snapshot cũ. Captain bổ sung roster rồi gửi lại hợp lệ để cập nhật version mới |
| PENDING | Captain từ chối với lý do | Request `REJECTED`, invitation vẫn `ACCEPTED`, claim vẫn hoạt động |
| NEEDS_REVISION / NEEDS_SUPPLEMENT | Captain chấp thuận | Gỡ khỏi roster chỉnh sửa; hồ sơ tiếp tục cần cập nhật; không tự từ chối/rút đội |
| APPROVED / ROSTER_LOCKED / giải đang khóa roster | Cầu thủ thử gửi hoặc captain thử chấp thuận | UI ẩn thao tác mới; backend trả xung đột; roster và claim không bị thay đổi |

Sau khi captain chấp thuận, nếu Tournament Service tạm thời không nhận được lệnh giải phóng claim, yêu cầu vẫn giữ lịch sử `APPROVED`; captain có nút **Đồng bộ lại quyền tham gia** để chạy lại an toàn.

### Thao tác trên giao diện

1. Đăng nhập cầu thủ có invitation `ACCEPTED`, mở **Lời mời dự giải**, nhập lý do và bấm **Gửi yêu cầu rút khỏi giải**. Khi gửi xong, màn hình ghi rõ cầu thủ vẫn thuộc roster và còn giữ quyền ở giải trùng lịch.
2. Đăng nhập captain của đội, mở **Quản lý giải đấu → chọn đội/giải → tab Yêu cầu rút**. Xem lý do, chọn **Chấp nhận rút** hoặc **Từ chối**. Từ chối phải nhập ít nhất 5 ký tự.
3. Với hồ sơ `PENDING`, khi chấp thuận registration phải tiếp tục là **Chờ BTC duyệt (PENDING)**. Hệ thống tạo `DRAFT_CHANGES` riêng, giữ nguyên snapshot/version đã nộp, chuyển captain tới tab roster và bỏ cầu thủ đã rút khỏi bản nháp. Nháp vẫn lưu được khi thiếu điều lệ, nhưng nút **Gửi lại hồ sơ** bị khóa và nêu thiếu quân số/thủ môn. BTC không thể duyệt snapshot cũ khi bản nháp đang mở. Khi hợp lệ, gửi lại tạo version mới, đóng `DRAFT_CHANGES` và registration tiếp tục PENDING.
4. Với hồ sơ `APPROVED` hoặc giải đã khóa roster, không có form tạo yêu cầu mới. Thử POST trực tiếp tới `/api/tournament-invitations/{invitationId}/withdrawal-requests` phải nhận HTTP 409, không thay đổi invitation, roster hoặc claim.

Các email trong phần đầu của tài liệu là tài khoản Seed 1 development hiện có. Do những fixture cầu thủ đã được thao tác trong các vòng kiểm thử trước, chúng không đảm bảo tất cả đều còn ở trạng thái ban đầu; kiểm tra cột trạng thái trước khi dùng và không chạy reset toàn Seed 1.

## Fixture bổ sung đã tạo trên database đang chạy (2026-11-20)

Seed `withdrawal-stage-fixtures-seed` bổ sung các hồ sơ độc lập, không ghi đè hồ sơ lịch sử:

| Fixture | Đội trưởng / đội | Giải | Dữ liệu ban đầu | Dùng để kiểm tra |
|---|---|---|---|---|
| PENDING sạch (fixture đã dùng E2E) | `dataset.captain14@football.local` / IUH Demo Club 14 | Giải A (`12050c82-ca1e-5174-9f23-6065cf7b58b5`) | Ban đầu 8 cầu thủ ACCEPTED, PENDING; sau E2E ngày 20/11/2026: P0262 đã rút, hồ sơ v2 được BTC duyệt, 7 cầu thủ | Đã hoàn tất luồng rút → DRAFT_CHANGES → lưu nháp/tải lại → gửi lại → BTC duyệt; không còn là fixture PENDING sạch để lặp lại |
| PENDING + DRAFT_CHANGES hợp lệ | `dataset.captain15@football.local` / IUH Demo Club 15 | Giải C (`ffa6a2b7-cda0-5b48-ae72-4d67cb36a273`) | Snapshot đã nộp có 8; jersey 8 đã rút khỏi bản nháp; roster nháp còn 7 | Lưu nháp và gửi lại nếu vẫn đạt điều lệ |
| PENDING + DRAFT_CHANGES thiếu GK | `dataset.captain16@football.local` / IUH Demo Club 16 | Giải B (`3b78de98-ed74-5980-83d9-6fee8237ed1c`) | Snapshot đã nộp có 8; thủ môn jersey 1 đã rút khỏi bản nháp; roster nháp còn 7, thiếu GK | Lưu nháp được; gửi lại bị chặn do thiếu thủ môn |
| DRAFT | `dataset.captain14@football.local` / IUH Demo Club 14 | Giải C | Draft riêng với 8 cầu thủ đã xác nhận | Rút trước khi nộp và kiểm tra điều lệ |

Tài khoản cầu thủ: `dataset.player0261`–`dataset.player0280` thuộc Club 14; `dataset.player0281`–`dataset.player0300` thuộc Club 15; `dataset.player0301`–`dataset.player0320` thuộc Club 16 (thêm hậu tố `@football.local`). Mật khẩu seed dự kiến: `Demo@123456`. Club 14 jersey 2 (`dataset.player0262`) phù hợp thử rút nhưng vẫn giữ thủ môn. Club 16 jersey 1 (`dataset.player0301`) là thủ môn đã rút khỏi DRAFT_CHANGES.

Seed hoàn tất thành công và giữ nguyên hồ sơ đã tồn tại. Hai tài khoản fixture ban đầu trả HTTP 401; sau đó đặt lại mật khẩu có chọn lọc chỉ cho `dataset.captain14@football.local` và `dataset.player0262@football.local` (đều đã xác minh thuộc `demo_account_registry`). Cả hai đăng nhập UI thành công bằng `Demo@123456`. Tài khoản demo khác không bị đổi mật khẩu.

### Kết quả E2E thực tế — PENDING, rút cầu thủ, chỉnh sửa và BTC duyệt (20/11/2026)

Đã thực hiện trên giao diện thật, kết nối API và database hiện tại; fixture là IUH Demo Club 14 / Giải A. Tài khoản: `dataset.player0262@football.local` (P0262), `dataset.captain14@football.local` (Captain14), `dataset.btc01@football.local` (BTC IUH); mật khẩu demo cả ba: `Demo@123456`.

| Bước | Kết quả thực tế | Trạng thái |
|---|---|---|
| P0262 gửi yêu cầu rút khỏi roster đang PENDING | Yêu cầu được tạo; cầu thủ vẫn ở snapshot roster | PASS — E2E |
| Captain14 từ chối, P0262 gửi yêu cầu mới, Captain14 chấp thuận | Lần đầu thành REJECTED; lần hai được chấp thuận. Registration vẫn PENDING, P0262 được gỡ khỏi bản chỉnh sửa nhưng snapshot nộp BTC được giữ | PASS — E2E |
| Roster sau rút thiếu suất đá chính theo điều lệ | Giao diện báo 7/7 cầu thủ đã xác nhận nhưng chưa đủ 7 suất đá chính vì còn một cầu thủ dự bị; không tự chuyển sang NEEDS_REVISION | PASS — E2E |
| Captain14 đổi vai trò cầu thủ đã xác nhận, lưu nháp, tải lại | Hoàng Huy Giang chuyển từ dự bị sang đá chính; lựa chọn còn nguyên sau khi tải lại; trạng thái hiển thị PENDING + DRAFT_CHANGES | PASS — E2E |
| Gửi lại hồ sơ | Backend trả registration cùng ID, trạng thái PENDING, phiên bản 2; không tạo hồ sơ trùng | PASS — E2E/API |
| Xem lịch sử từ BTC | BTC thấy snapshot v1 (8 cầu thủ), sự kiện DRAFT_CHANGES (7), và lần gửi v2 (7) | PASS — E2E |
| BTC duyệt | BTC duyệt thành công phiên bản roster 7 cầu thủ; danh sách chuyển Đã duyệt 1, còn 7/8 suất | PASS — E2E |

Kiểm tra API sau khi gửi lại cho thấy lịch sử gồm v1 `SUBMITTED` (8 cầu thủ, P0262 còn trong snapshot), sự kiện `PLAYER_WITHDRAWAL_ACCEPTED` (7 cầu thủ, P0262 không còn trong draft), và v2 `RESUBMITTED` (7 cầu thủ, P0262 không còn). Sau khi duyệt, UI cập nhật số liệu từ hồ sơ: 1 đội đã duyệt, 0 chờ duyệt, roster gửi gồm 7 cầu thủ. Hồ sơ là fixture demo; không tác động các đội người dùng khác.

Giao diện E2E được chạy trước trên Vite dev cổng 5174 để quan sát HMR. Sau đó đã rebuild image Docker `student-football-league-web-client` và cập nhật container web-client trên cổng 5173. Không chạy migration, không reset database, không xóa volume, không đổi SMTP.

Đặt lại có chọn lọc hai tài khoản trên (development/test only):

```powershell
docker compose --profile apps --profile demo-dataset run --rm --no-deps -e DEMO_TEAM_COUNT=16 -e DEMO_ACCOUNT_PASSWORD=Demo@123456 -e DEMO_RESET_ACCOUNT_EMAILS=dataset.captain14@football.local,dataset.player0262@football.local tournament-demo-account-seed
```

`DEMO_RESET_ACCOUNT_EMAILS` chỉ cập nhật mật khẩu những tài khoản có đúng email và seed key tương ứng trong `demo_account_registry`; không cập nhật tài khoản khác.

Các fixture `NEEDS_REVISION`/`REVISION_REQUIRED` và `APPROVED` có sẵn trong Seed 1. Chưa tạo fixture `ROSTER_LOCKED` hoặc `ONGOING` trước/sau vòng bảng cuối: không có giải hiện tại ở các giai đoạn này; không giả mạo stage hoặc tạo trận/kết quả để ép dữ liệu.

Seed chạy bằng lệnh:

```powershell
docker compose --profile apps --profile demo-dataset run --rm --no-deps withdrawal-stage-fixtures-seed
```

Kiểm thử Organization Service với database hiện tại: `RUN_ORG_DB_INTEGRATION=1 corepack pnpm --filter @sfl/organization-service test`, 18/18 PASS, 0 failed, 0 skipped. Trong đó 5 ca unit thuần và 13 ca integration dùng PostgreSQL thật; các ca integration gồm đồng thời quyết định BTC, FIFO, outbox retry, quyền cầu thủ, rút cầu thủ PENDING/DRAFT_CHANGES và resubmit. Đây là kết quả unit/integration, tách biệt với E2E UI ở trên.

Nó không reset database hoặc xóa volume. Nếu đã có registration khác cho cùng đội/giải, seed dừng thay vì ghi đè.

## Làm lại riêng kịch bản

- Dữ liệu này dùng ID ổn định; chạy lại `pnpm run seed:test:player-overlap` chỉ bổ sung bản ghi còn thiếu, không xóa/reset database/volume.
- Seed chạy lại **không hoàn tác** phản hồi đã thao tác. Để làm lại một trường hợp, chạy `powershell -ExecutionPolicy Bypass -File scripts/test-seeds/Reset-Seed1PlayerScenario.ps1 -Player P01` (thay P01 bằng P02–P08). Script hoàn nguyên lời mời đúng cầu thủ và giải phóng claim qua Tournament Service nếu thao tác đã tạo claim; P07 chỉ thử thao tác bị chặn nên không cần reset.
- Reset giữ lịch sử lời mời. Với P08, lời mời mới được hủy và lời mời DECLINED ban đầu được giữ để thử gửi lại.

## Lệnh chuẩn bị dữ liệu

```powershell
corepack pnpm --filter @sfl/tournament-service build
corepack pnpm --filter @sfl/organization-service build
docker compose --profile apps --profile approval-demo run --rm --no-deps -e TEST_SEED_VARIANT=invite-overlap approval-workflow-demo-tournament-seed
docker compose --profile apps --profile demo-dataset run --rm --no-deps player-invitation-overlap-seed
docker compose --profile apps run --rm --no-deps -e SEED1_MANUAL_PASSWORD=Demo@123456 auth-service node services/auth-service/dist/db/seedSeed1ManualAccounts.js
```

Các lệnh trên không chạy migration mới, không xóa hồ sơ và không xóa volume. Chỉ chạy trên development/test.

## Fixture mới: Seed 1 mở rộng — xét duyệt 12 hồ sơ (20/11/2026)

Đây là giải riêng, không thay đổi fixture/giải cũ. Script `scripts/test-seeds/Reset-Seed1ReviewWorkflow.ps1` chỉ làm mới registration, roster, invitation và outbox thuộc giải ID `95f79e55-e6f0-5177-a2e2-d9fe62760dcd`. Script rebuild các service liên quan, không xóa volume hoặc reset database. Chạy lại script đặt lại mật khẩu chỉ cho BTC demo 01 và Captain 01–12; không sửa mật khẩu cầu thủ hay tài khoản ngoài danh sách.

| Tài khoản | Vai trò | Dữ liệu ban đầu | Tôi cần thao tác | Kết quả mong đợi |
|---|---|---|---|---|
| `dataset.btc01@football.local` | BTC IUH | Giải mở đăng ký, vòng tròn; 12 hồ sơ PENDING, 0 đội duyệt | Duyệt, từ chối hoặc yêu cầu bổ sung theo thứ tự; khi đủ 8 đội, kiểm tra tự chuyển hồ sơ còn lại vào chờ suất | Không vượt 8; hồ sơ đủ và chưa đủ bổ sung được phân biệt |
| `dataset.captain01@football.local` | Đội trưởng IUH Demo Club 01 | Hồ sơ PENDING; roster 14 người, đã xác nhận | Xem trạng thái/quyết định của BTC | Chỉ hồ sơ Club 01 hiện cho captain |
| `dataset.captain02@football.local` | Đội trưởng IUH Demo Club 02 | Hồ sơ PENDING; roster 14 người, đã xác nhận | Trả lời yêu cầu bổ sung khi đăng ký mở; thử lại sau khi đóng | Khi gửi lại hợp lệ lúc còn mở, không tự động duyệt; sau khi đóng, gửi lại bị chặn |
| `dataset.captain03@football.local` – `dataset.captain12@football.local` | Đội trưởng IUH Demo Club 03–12 | Mỗi đội có một hồ sơ PENDING, roster 14 người đã xác nhận | Tự thao tác hồ sơ tương ứng khi BTC xử lý | Dữ liệu độc lập; không seed sẵn quyết định |

Mật khẩu BTC và 12 captain: `Demo@123456` (hoặc giá trị `SEED_TEST_PASSWORD` nếu đặt trước khi chạy script). Tên giải: **Seed 1 mở rộng — Vòng tròn · 12 hồ sơ / tối đa 8 / tối thiểu 4 · Kịch bản mới**. Thời gian giải ở tương lai; kỳ đăng ký mở tới 14 ngày sau lúc seed.

Đăng nhập BTC tại `http://localhost:5173`, mở **Giải đấu → Giải đấu do tôi tổ chức → Quản lý giải**. Có thể mở trực tiếp `http://localhost:5173/btc?manageTournament=95f79e55-e6f0-5177-a2e2-d9fe62760dcd`. Danh sách theo thứ tự đăng ký: Club 01 được xử lý trước; các đội sau hiển thị “Chờ đến lượt” hoặc “Chưa đến lượt”.

Kịch bản: (1) trước 8 lượt duyệt, yêu cầu bổ sung cho một số hồ sơ; (2) duyệt đủ 8, kiểm tra hồ sơ PENDING và cần bổ sung vào bộ lọc Chờ suất; (3) captain bổ sung và gửi lại, hồ sơ đã hoàn thiện vẫn chờ suất; (4) đóng đăng ký bằng công cụ test và đọc cảnh báo xác nhận; hồ sơ chưa bổ sung bị từ chối có lịch sử, hồ sơ PENDING đầy đủ vẫn để BTC xét; (5) thử yêu cầu bổ sung mới và gửi lại từ captain sau khi đóng để xác nhận backend chặn; (6) chốt 4–8 đội sau khi đóng dù còn hồ sơ chờ chưa chọn. Dữ liệu bạn đã thao tác được giữ nguyên; chạy lại script để làm mới riêng fixture này.

Đã xác minh trên Docker ngày 20/11/2026: giải `OPEN_REGISTRATION`; 12/12 hồ sơ `PENDING`, 0 quyết định; 168 roster rows, 168 lời mời `ACCEPTED`, 0 lời mời đang chờ. BTC đăng nhập API thành công. Giao diện BTC hiển thị 12 chờ duyệt, 0 chờ suất, 0 cần bổ sung, 0 đã duyệt; mỗi roster có 14 cầu thủ. Không tự thao tác quyết định trên fixture mới để giữ nguyên trạng thái ban đầu cho kiểm thử thủ công.
