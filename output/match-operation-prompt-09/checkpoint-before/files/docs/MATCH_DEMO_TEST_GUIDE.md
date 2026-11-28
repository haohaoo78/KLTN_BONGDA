# Hướng dẫn kiểm thử một trận sau phân công trọng tài

Kiểm tra ngày 27/11/2026 trên Docker chính thức tại [http://localhost:5173](http://localhost:5173). Kịch bản dùng tài khoản, roster, fixture, lịch và phân công hiện có trong PostgreSQL. Demo Mode chỉ thay đổi thời gian nghiệp vụ của một trận được phép; mọi thao tác gửi đội hình, ghi sự kiện và xác nhận kết quả vẫn ghi dữ liệu thật của giải DEMO.

**Hiện chưa thể thực hiện toàn bộ kịch bản chỉ bằng nút trên giao diện:** trận được chọn chưa được gắn quy tắc điều hành bổ sung; giải chưa khai mạc và luồng BTC không render nút khai mạc. Hai điểm này được chỉ rõ tại phần 3. Không tự điền quy tắc hoặc sửa trạng thái database để vượt điều kiện. Phần ghi xuyên suốt đã chạy qua API thật trên bản sao QA, không bắt đầu trận chính thức thay người dùng.

## 1. Tài khoản và cách mở phiên

Mật khẩu demo đã kiểm tra đăng nhập thành công: **`Demo@123456`**. Đây là mật khẩu của các tài khoản demo có sẵn theo [danh mục tài khoản](./DEMO_ACCOUNTS_AND_TESTING.md), không phải mật khẩu SMTP hoặc tài khoản cá nhân.

| Người thao tác | Email | Trang mở sau đăng nhập |
|---|---|---|
| BTC của giải | `dataset.btc01@football.local` | `/btc?manageTournament=9f765a91-b8ab-4716-a083-0cf8a113db1b` |
| Đội trưởng HITU Draw Demo Club 14 | `drawdemo.captain14@football.local` | `/team`, chọn **Lịch thi đấu** |
| Đội trưởng TDC Draw Demo Club 07 | `drawdemo.captain07@football.local` | `/team`, chọn **Lịch thi đấu** |
| Trọng tài chính Võ Tuấn Dũng | `dataset.captain02@football.local` | `/referee/assignments` |

Trọng tài có cả vai trò đội trưởng và trọng tài. Tài khoản này **không phải** đội trưởng của hai đội trong trận được chọn. Sau khi đăng nhập ở giao diện đội trưởng, bấm **Không gian trọng tài** trên thanh trên cùng để mở `/referee`; bấm **Không gian đội trưởng** để quay lại. Đăng nhập mặc định vẫn ưu tiên đội trưởng; không tự chọn hoặc thay đổi nhiệm vụ trong trận.

Để thử đồng thời bốn tài khoản, dùng bốn hồ sơ trình duyệt hoặc các trình duyệt khác nhau. Các tab trong cùng một hồ sơ dùng chung cookie; đăng nhập tài khoản khác sẽ đổi phiên của những tab đó. Nếu thử tuần tự, đăng xuất rồi đăng nhập đúng tài khoản ở mỗi bước. Không cần đăng nhập từng cầu thủ lại để xác nhận roster đã chốt.

## 2. Giải và trận phải chọn

- Giải: **DEMO HCMC Student Champions Cup 2026**.
- ID giải: `9f765a91-b8ab-4716-a083-0cf8a113db1b`.
- Trận: **HITU Draw Demo Club 14 – TDC Draw Demo Club 07**.
- ID trận: `8b8a61e2-4b83-4c8c-962e-580b4a594106`.
- Bảng A, lượt 1, vòng 1; **08:15 ngày 18/12/2026, Sân 3**, giờ Việt Nam.
- Hai đội có **20 cầu thủ trong roster chính thức** mỗi đội. Hai đội hình trận hiện đều rỗng.
- Fixture, lịch và tổ trọng tài đã công bố; trọng tài chính có quyền ghi/sửa sự kiện, quản lý biên bản và xác nhận cuối.
- Trận đang **Sắp diễn ra**; clock chưa bắt đầu. Giải đang **Chuẩn bị**.

Liên kết trực tiếp:

- [BTC quản lý giải](http://localhost:5173/btc?manageTournament=9f765a91-b8ab-4716-a083-0cf8a113db1b).
- [Trọng tài xem chi tiết](http://localhost:5173/referee/assignments/8b8a61e2-4b83-4c8c-962e-580b4a594106).
- [Trọng tài tác nghiệp](http://localhost:5173/referee/matches/8b8a61e2-4b83-4c8c-962e-580b4a594106/operation).
- [Biên bản của trận](http://localhost:5173/referee/reports/8b8a61e2-4b83-4c8c-962e-580b4a594106).

Không dùng trận `e45a599b-1377-4377-9016-3956cc4e0738` cho lần thử đầu: dữ liệu cũ của trận đó đang có trạng thái đã xác nhận đội hình nhưng chưa có đội hình tương ứng. Đây là trường hợp cần BTC mở lại chuẩn bị có lý do, không phải một trận mẫu sẵn sàng bắt đầu.

## 3. Các điều kiện còn thiếu trước khi thử

### 3.1. BTC bổ sung và gắn quy tắc điều hành

Đăng nhập BTC → quản lý đúng giải → Bước 1 **Thông tin & điều lệ** → mở **Luật thi đấu & quy tắc điều hành**.

1. Bấm **Thiết lập quy tắc điều hành**.
2. Chọn bộ luật thực sự áp dụng. Với giải 11 người, giao diện có profile IFAB; BTC phải xác nhận phiên bản và những lựa chọn của điều lệ.
3. Kiểm tra các nhóm **Đội hình**, **Thời gian**, **Thay người**, **Kỷ luật**, **Xác định kết quả**. Các trường đã xác định từ profile được tự điền; các lựa chọn của giải phải do BTC quyết định.
4. Điền **Lý do bổ sung** → **Lưu bản nháp bổ sung**.
5. Bấm **Công bố bản bổ sung …**.
6. Đánh dấu **Áp dụng cho … trận đủ điều kiện của sơ đồ chính thức** → **Áp dụng bản bổ sung cho trận**. Nếu có cảnh báo nguồn điều lệ cũ, đọc và chỉ xác nhận khi đúng phiên bản gốc.
7. Quay về chi tiết trận của trọng tài và tải lại. Phải thấy phiên bản bổ sung được gắn, các cảnh báo thiếu quy tắc liên quan biến mất.

**Điểm chặn hiện tại:** API đang trả thiếu bộ luật/phiên bản/nguồn; số xuất phát, tối thiểu, dự bị, thủ môn và số áo; số hiệp, thời lượng, nghỉ giữa hiệp, kiểu đồng hồ/bù giờ; quy tắc thay người và phân định hòa. Điều lệ gốc có thời lượng 90 phút nhưng chưa có bản bổ sung điều hành được gắn cho trận. Vì vậy nút **Gửi đội hình** và thao tác bắt đầu bị chặn đúng.

Không tự coi 20 cầu thủ roster là 20 người được đăng ký trong một trận. Không tự đặt hạn nộp đội hình, số dự bị hoặc giới hạn thay người. Những lựa chọn chưa có căn cứ phải được BTC xác định. Kịch bản đội hình 11 xuất phát + 2 dự bị dưới đây chỉ dùng khi cấu hình đã công bố cho phép.

### 3.2. BTC khai mạc giải

Điều kiện bắt đầu trận yêu cầu giải ở trạng thái **Đang diễn ra**. Demo Mode không đổi trạng thái này.

**Khoảng trống giao diện đã xác định:** [workspace BTC](../apps/web-client/src/components/BtcTournamentWorkspace.tsx) có component cho hành động chuyển trạng thái nhưng hiện chỉ render hành động công bố/mở đăng ký; không render hành động khai mạc ở Bước 6 hoặc 7. Không có nút “Bắt đầu giải” để hướng dẫn người dùng bấm trong luồng hiện tại. Không bổ sung lại chức năng đó trong nhiệm vụ này.

API nghiệp vụ hiện có là **PUT `/api/tournaments/:id`**, body `{"status":"IN_PROGRESS"}`, dùng phiên BTC quản lý giải. Kịch bản QA đã thực hiện qua API này và vẫn chịu validation/phân quyền. Nếu muốn thử tiếp trước khi sửa nút, có thể thực hiện **một lần** trong Console của trình duyệt đang đăng nhập BTC trên cổng 5173:

```javascript
const response = await fetch('/api/tournaments/9f765a91-b8ab-4716-a083-0cf8a113db1b', {
  method: 'PUT',
  credentials: 'include',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({status: 'IN_PROGRESS'})
});
console.log(response.status, await response.json());
```

Đây là thay đổi nghiệp vụ thật của **giải DEMO**, không phải thay đổi hiển thị. Chỉ tiếp tục nếu API trả thành công và tải lại thấy **Đang diễn ra**. Nếu API báo thiếu lịch/phân công/fixture, xử lý đúng thông báo; không sửa database hoặc điền trọng tài cũ để vượt gate. Nếu chỉ chấp nhận thao tác bằng giao diện, dừng ở đây và xử lý nút khai mạc trước.

## 4. Trọng tài mở Demo Mode trước khi hai đội lập đội hình

Đăng nhập trọng tài → **Lịch phân công** → đúng cặp HITU–TDC → **Xem chi tiết** → mở trang tác nghiệp. Không có thao tác chấp nhận/từ chối phân công.

1. Mở khung **Demo Mode** dưới thanh ba giai đoạn.
2. Bấm **Bật Demo Mode**.
3. Bấm **Đến mốc lập đội hình**.

**Mong đợi:** backend lưu phiên thời gian riêng của trận, không đổi ngày 18/12 hoặc sân. Trận vẫn chưa bắt đầu; hai đội hình vẫn rỗng. Nếu điều lệ quy định hạn gửi/sửa, mốc được đặt trước hạn sớm nhất một phút. Nếu không có hạn, một phút trước giờ đấu chỉ là mốc kiểm thử, không phải một hạn nộp mới.

Phải lập và gửi đội hình trước khi tiến qua hạn. Demo Mode không quay lùi thời gian. Khi chưa bắt đầu trận, có thể tắt để trở lại giờ thực rồi bật lại nếu cần thử lại; mọi dữ liệu đã lưu vẫn còn. Trong trận, không cho tắt hoặc quay lùi clock; hoàn tất trận rồi mới tắt.

## 5. Đội trưởng HITU lập và gửi đội hình

Đăng nhập `drawdemo.captain14@football.local` → `/team` → **Lịch thi đấu**.

1. Lọc đúng giải HCMC; nếu không thấy trận, bỏ bộ lọc ngày hiện tại hoặc chọn 18/12/2026.
2. Tìm HITU Draw Demo Club 14 – TDC Draw Demo Club 07 → **Chuẩn bị đội hình**.
3. Kiểm tra hai đội, ngày/sân, quy tắc, số cầu thủ đủ điều kiện và cảnh báo Demo Mode.
4. Tìm và chọn cầu thủ bằng nút **Xuất phát** hoặc **Dự bị** tại từng dòng roster. Có thể **Chuyển dự bị**, **Chuyển xuất phát** hoặc **Loại khỏi trận** để sửa trước khi gửi.

Một danh sách cụ thể có trong roster hiện tại:

- **11 xuất phát:** Đỗ Hải An (#1, GK); Hồ Nam Long (#2); Hoàng Thành Sơn (#20); Hoàng Huy Giang (#8); Nguyễn Dũng Khánh (#4); Bùi Long Bảo (#12); Hồ Bảo Vinh (#14); Phạm An Tài (#7); Võ Tuấn Dũng (#10); Phan Phát Quân (#9); Đỗ Tài Minh (#13).
- **2 dự bị:** Phạm Minh Hải (#19), Ngô Thịnh Việt (#3).

Giữ thủ môn ở vị trí **GK**, không chọn trùng người hoặc số áo. Chỉ dùng danh sách nếu backend vẫn xác định những cầu thủ đó đủ điều kiện và điều lệ cho phép số lượng này.

5. Bấm **Lưu nháp** → đóng/mở lại để kiểm tra danh sách vẫn còn.
6. Bấm **Gửi đội hình**.

**Mong đợi:** thông báo **Đã gửi đội hình cho trọng tài kiểm tra**; trạng thái **Đã gửi · chờ trọng tài kiểm tra**; có lịch sử gửi. Gửi không đồng nghĩa trọng tài đã kiểm tra. Nếu lỗi, đọc thông báo tại cầu thủ/trường; không bỏ cầu thủ ngoài roster vào bằng cách gọi API trực tiếp.

## 6. Đội trưởng TDC thực hiện tương tự

Đăng nhập `drawdemo.captain07@football.local` → **Lịch thi đấu** → cùng trận → **Chuẩn bị đội hình**.

- **11 xuất phát:** Trần Khoa Thịnh (#1, GK); Hoàng Thành Sơn (#16); Ngô Khang Khoa (#11); Lê Sơn Huy (#2); Đặng Quân Châu (#19); Hoàng Huy Giang (#4); Phạm An Tài (#3); Đặng Đạt Phát (#7); Phan Phát Quân (#5); Lê Giang Thành (#14); Bùi Long Bảo (#8).
- **2 dự bị:** Hồ Bảo Vinh (#10), Phan Châu Đạt (#17).

Những tên giống nhau giữa hai CLB là các hồ sơ người chơi khác nhau trong dữ liệu demo. Chọn trong đúng roster của đội đang đăng nhập, không tìm hoặc nhập UUID.

Bấm **Lưu nháp**, mở lại kiểm tra, rồi **Gửi đội hình**. Mong đợi giống HITU. Hai đội không phải nhập lại đăng ký tham gia giải hoặc xác nhận lời mời roster đã hoàn thành từ trước.

## 7. Trọng tài kiểm tra hai đội trước trận

Trở lại tài khoản trọng tài → trang tác nghiệp → **Trước trận**. Nếu vừa gửi mà chưa cập nhật, chờ đồng bộ hoặc tải lại.

1. Thấy hai đội song song, số xuất phát/dự bị, số áo và danh sách vừa gửi.
2. Kiểm tra HITU → **Xác nhận đã kiểm tra**.
3. Kiểm tra TDC → **Xác nhận đã kiểm tra**.
4. Nếu sai, dùng **Yêu cầu điều chỉnh**, nhập lý do. Đội trưởng sửa/gửi lại và trọng tài kiểm tra lại; không sửa thay đội bằng tài khoản trọng tài.
5. Nếu đội vắng, sân không an toàn hoặc có cầu thủ không đủ điều kiện, bấm **Ghi nhận & chuyển BTC**. Đây không phải nút xử thua. BTC xử lý trong Bước 7; vấn đề chưa giải quyết phải chặn bắt đầu.
6. Khi hai đội hợp lệ và đã kiểm tra, bấm **Xác nhận điều kiện bắt đầu trận**.

**Mong đợi:** trạng thái **Đã xác nhận đội hình**; đội trưởng không còn sửa bình thường. Backend kiểm tra lại roster, án treo giò, quy tắc, phiên bản và vấn đề chưa xử lý. Không chỉ tin vào checkbox của trình duyệt.

Sau đó mở Demo Mode → **Đến mốc kiểm tra trước trận** (nếu chưa qua mốc) → **Đến giờ bắt đầu trận**.

Để nút bắt đầu hoạt động phải đồng thời có:

- Sơ đồ và lịch chính thức; xác định đủ hai đội.
- Tổ trọng tài đã công bố, còn hiệu lực; tài khoản đang hoạt động và có quyền xác nhận cuối.
- Hai đội gửi đội hình hợp lệ, trọng tài đã kiểm tra, trạng thái sẵn sàng đúng.
- Quy tắc điều hành đầy đủ cho thao tác bắt đầu.
- Giải **Đang diễn ra**, trận chưa kết thúc/hoãn/hủy/khóa.
- Đã đến giờ theo thời gian nghiệp vụ backend; phiên bản clock hiện hành.

## 8. Bắt đầu và điều hành hiệp một

1. Bấm **Bắt đầu trận**.
2. Mong đợi tự chuyển sang **Điều hành trận đấu**; hiệp một, clock chạy, tỷ số ban đầu 0–0. Demo Mode không tự bấm thay thao tác này.
3. Để thử sự kiện mà không chờ, mở Demo Mode → **Tiến 1 phút**.
4. Bấm **Bàn thắng** → chọn HITU → chọn cầu thủ đang đá chính, ví dụ Hồ Nam Long (#2) → kiểm tra thời điểm đề xuất → **Lưu diễn biến**. Mong đợi tỷ số 1–0 và timeline có bàn thắng đúng người/đội/hiệp.
5. Bấm **Thẻ vàng** → chọn TDC và cầu thủ đang trong danh sách hợp lệ, ví dụ Hoàng Thành Sơn (#16) → **Lưu diễn biến**. Mong đợi timeline có thẻ, tỷ số vẫn 1–0.
6. Bấm **Thay người** → HITU → cầu thủ ra đang trên sân, ví dụ Hoàng Thành Sơn (#20) → cầu thủ vào là dự bị Phạm Minh Hải (#19) → **Lưu diễn biến**. Mong đợi người vào/ra được cập nhật cùng một lần lưu. Nếu chưa có quy tắc thay người hoặc hết quyền thay, backend phải từ chối với nguyên nhân.

Các nút khác hiện có gồm **Phản lưới nhà**, **Phạt đền**, **Thẻ đỏ**, **Thẻ vàng thứ hai**, **Chấn thương**, **Sự cố** theo quyền/pha. Thẻ vàng thứ hai chỉ thử với cầu thủ đã có một thẻ vàng hợp lệ. Phạt đền trong hiệp không phải lượt luân lưu. Không cố ý đuổi nhiều cầu thủ làm trận không đủ người trong lần thử cơ bản.

Với đồng hồ chạy liên tục, không dùng dừng tính giờ cho mỗi pha phạm lỗi. **Công bố bù giờ** chỉ có khi bộ luật cho phép; nhập số giây thực sự quyết định. **Tạm dừng thi đấu** cần lý do và có nghiệp vụ riêng, không dùng để thay thao tác kết thúc hiệp.

## 9. Kết thúc hai hiệp và trận

1. Demo Mode → **Đến cuối hiệp hiện tại**. Clock đạt thời lượng hiệp cộng bù giờ đã công bố, nhưng hiệp vẫn chưa tự kết thúc.
2. Bấm **Kết thúc hiệp**. Mong đợi **Nghỉ giữa hiệp**, tỷ số/sự kiện được giữ.
3. Demo Mode → **Đến hết thời gian nghỉ**. Sau đó bấm **Bắt đầu hiệp tiếp theo**.
4. Mong đợi hiệp hai, clock của hiệp mới bắt đầu; tổng thời gian thi đấu không cộng thời gian nghỉ. Có thể thử thêm sự kiện theo cùng cách.
5. Demo Mode → **Đến cuối hiệp hiện tại** → **Kết thúc hiệp**.
6. Khi hết hai hiệp, bấm **Kết thúc trận** nếu điều lệ cho phép tỷ số hiện tại.

Với kịch bản 1–0 ở vòng bảng, mong đợi **Kết thúc thi đấu**, clock dừng và chuyển sang **Sau trận**. Kết quả mới ở trạng thái chờ công nhận; **chưa cộng điểm chính thức chỉ vì bấm kết thúc**.

Trận này là vòng bảng, không dùng để thử luân lưu. Trận knockout hòa phải theo đúng phương thức điều lệ: thẳng luân lưu hoặc hiệp phụ rồi luân lưu. Những giải demo còn lại hiện chưa có tổ trọng tài đã công bố cho trận tương ứng để đưa vào kịch bản sau phân công này; không tự tạo phân công thay người dùng.

## 10. Hoàn tất biên bản và xác nhận kết quả

1. Tại **Sau trận**, kiểm tra tỷ số tự tổng hợp, đội hình và diễn biến; không nhập lại toàn bộ sự kiện hoặc gõ tổng tỷ số để thay bàn thắng đã lưu.
2. Nhập khán giả/thời tiết/ghi chú nếu có dữ liệu cần ghi nhận.
3. Trong kịch bản thường lệ, trọng tài hiện tại có cả quyền quản lý biên bản và xác nhận cuối: bấm **Xác nhận kết quả & biên bản** → đọc hộp thoại → **Xác nhận kết quả**.
4. Mong đợi biên bản và kết quả được công nhận; trang chi tiết biên bản đọc lại đúng dữ liệu. Tải lại trang để kiểm tra lưu bền vững.

Nếu có ngoại lệ cần BTC xử lý, đánh dấu **Hồ sơ ngoại lệ cần BTC xem xét**, bấm **Gửi biên bản**. BTC vào Bước 7 **Điều hành giải đấu**, chọn **Biên bản cần xem** → xem dữ liệu → **Duyệt kết quả chính thức**, **Yêu cầu chỉnh sửa** hoặc **Từ chối biên bản** theo thẩm quyền.

**Giới hạn:** đường xác nhận thường lệ đã chạy thành công trên bản sao QA trong lần này. Tính nguyên tử khi lỗi giữa các transaction, retry toàn bộ biên bản, người chuẩn bị khác người xác nhận và mọi nhánh ngoại lệ vẫn thuộc F07/F08; không coi ca thông thường PASS là đã nghiệm thu các phần đó. Một số chi tiết snapshot ở màn hình BTC cũ còn hiện mã rút gọn/trạng thái kỹ thuật, chưa sửa giao diện đó trong nhiệm vụ này.

Sau khi clock đã kết thúc, có thể bấm **Tắt Demo Mode**. Lịch sử kiểm thử và dữ liệu trận không bị xóa; không biến kết quả demo thành dữ liệu của giải khác.

## 11. Kiểm tra BXH và sơ đồ

BTC → quản lý cùng giải → Bước 4 **Sơ đồ thi đấu** → Bảng A → BXH/chi tiết bảng. Đồng thời có thể mở mục **Bảng xếp hạng** của hệ thống để đối chiếu.

Với trận duy nhất được công nhận 1–0 theo kịch bản này:

| Đội | Đã đấu | Thắng | Thua | Bàn thắng | Bàn thua | Hiệu số | Điểm |
|---|---:|---:|---:|---:|---:|---:|---:|
| HITU Draw Demo Club 14 | 1 | 1 | 0 | 1 | 0 | +1 | 3 |
| TDC Draw Demo Club 07 | 1 | 0 | 1 | 0 | 1 | -1 | 0 |

Các giá trị này đã đọc lại được từ API BXH bảng trên QA. Vòng bảng chưa hoàn tất thì **không tự đưa HITU vào tứ kết chỉ vì thắng một trận**; các ô nguồn đội đi tiếp trên nhánh vẫn chờ kết quả hợp lệ của bảng. API sơ đồ QA vẫn trả nhánh chờ đúng phạm vi đó.

Nếu kết quả chưa được công nhận, BXH chính thức không được cộng điểm. Đối chiếu cả màn hình và API khi số liệu khác nhau. F09 về nhiều đường BXH/tiêu chí xếp hạng, đính chính và đi tiếp phức tạp vẫn cần nghiệm thu riêng; lần này chỉ xác nhận trường hợp cơ bản trên.

## 12. Cấu hình và an toàn của Demo Mode

Backend chỉ bật khi **đồng thời**:

- `NODE_ENV` là `development` hoặc `test`.
- `MATCH_DEMO_MODE_ENABLED=true`.
- ID giải nằm trong `MATCH_DEMO_TOURNAMENT_IDS` và tên giải có tiền tố DEMO khi ghi.
- Người điều khiển là trọng tài đang được phân công chính thức và có quyền xác nhận cuối.

Production luôn từ chối API điều khiển dù đặt cờ true. Mặc định Compose tắt chức năng. Bản Docker cổng 5173 đang dùng [overlay Development](../output/demo-match-testing/compose.demo.yml) cho ba giải DEMO; từng trận vẫn mặc định **tắt** cho đến khi người dùng bấm bật.

Chạy lại cấu hình hiện tại từ thư mục gốc:

```powershell
docker compose -f docker-compose.yml -f output/demo-match-testing/compose.demo.yml --profile apps up -d --no-deps match-service web-client
```

Muốn tắt cấu hình toàn cục: hoàn tất trận đang kiểm thử và tắt phiên từng trận trước, sau đó chạy Compose không có overlay (hai biến mặc định false/rỗng). Không tắt toàn cục giữa trận: hệ thống sẽ báo cần khôi phục cấu hình thay vì âm thầm đưa đồng hồ về quá khứ.

Không đổi giờ hệ điều hành, cookie/session, SMTP hoặc lịch chính thức. Offset theo trận và lịch sử được lưu trong Match PostgreSQL, nên reload/restart không reset. API kiểm tra hai phiên bản, khóa Match và giữ lease đọc Scheduling; không giả định có transaction chung hai database. Tiến thời gian trong hiệp làm biểu mẫu sự kiện cũ hết phiên bản; mở lại biểu mẫu khi được báo xung đột.

Migration 27 chỉ thêm hai bảng thời gian demo và audit, không sửa bảng lịch/roster/điều lệ. Đã sao lưu bảy database tại [backup riêng](../backups/demo-match-testing-001/). Không xóa bảng, reset hoặc restore đè để hoàn tác; không quay lại image bỏ qua clock demo khi còn trận đang chạy bằng thời gian mô phỏng.

## 13. Kết quả kiểm chứng lần này

| Phần | Kết quả | Phạm vi |
|---|---|---|
| Đăng nhập BTC, hai đội trưởng, trọng tài | PASS | Auth thật trên 5173, tài khoản đang hoạt động |
| Fixture/lịch/tổ trọng tài/roster hiện có | PASS đọc | PostgreSQL và API chính thức; HITU/TDC mỗi đội 20 người |
| Gửi đội hình trên dữ liệu hiện tại trước bổ sung quy tắc | BLOCKED | Thiếu quy tắc, nút gửi bị chặn đúng; không tự sửa điều lệ |
| Khai mạc giải bằng nút BTC | FAIL giao diện | Hành động chuyển trạng thái có API nhưng chưa được render trong luồng hiện tại |
| Demo Mode, điều kiện quyền/Production, phiên bản, thời hạn đội hình | PASS API QA | Router thật, Auth thật, PostgreSQL bản sao; không fake Date |
| Hai đội gửi → review → START → bàn/thẻ/thay người → hai hiệp → kết thúc → biên bản | PASS API QA | Kịch bản thường lệ, quy tắc test được khai báo rõ trong bản sao; không sửa điều lệ chính thức |
| BXH bảng cập nhật 1–0 và nhánh còn chờ hoàn tất bảng | PASS API QA | Đọc lại sau công nhận, chưa nghiệm thu mọi tiêu chí/đính chính |
| Match tests | PASS | 258 PASS, 0 FAIL, 34 SKIP; SKIP không tính PASS |
| Frontend tests | PASS | 36 PASS; không tương đương thao tác browser toàn bộ trận |
| Typecheck toàn workspace; Docker build Match/web | PASS | Có cảnh báo kích thước bundle Vite còn tồn tại |
| Demo Mode hiển thị trên 5173 | PASS trình duyệt | Đã mở khung và thấy nút thật; viewport desktop 1440×1000 không tràn ngang |
| Toàn bộ luồng ghi bằng nhiều trình duyệt/mobile trên 5173 | NOT TESTED | Không ghi vào trận chính thức thay người dùng; thiếu hai điều kiện ở phần 3 |
| Luân lưu/hiệp phụ với Demo Mode, mọi ngoại lệ/thu hồi quyền khi đang mở | NOT TESTED | Không phải trận vòng bảng được chọn; các prompt trước có kiểm thử riêng, không tính thay ca này |

Log API đầy đủ: [QA 002](../output/demo-match-testing/qa-api-002.log). Lần 001 phát hiện Demo Mode tăng clock version trước trận khiến khóa áp dụng quy tắc; đã sửa để chỉ tăng clock version khi hiệp đã bắt đầu, rồi chạy lại trên bản sao mới. Không sửa gate quy tắc để cho test vượt qua. Các giá trị quy tắc QA (ví dụ hạn 30/15 phút, nghỉ 10 phút) chỉ là dữ liệu ca thử khai báo trong database QA, không phải quy định được tự áp dụng vào giải hiện tại.

## 14. Thành phần thay đổi

- [Demo time service](../services/match-service/src/services/matchDemoTimeService.ts), [nguồn thời gian nghiệp vụ](../services/match-service/src/services/matchOperationTime.ts), [controller](../services/match-service/src/controllers/matchDemoTimeController.ts), [migration 27](../services/match-service/src/db/matchDemoTimeMigration.ts).
- Tích hợp thời gian vào clock đọc/ghi/freeze, gate giờ bắt đầu, readiness, hạn đội hình và thời điểm sự kiện. Không thay state machine, thuật toán lập lịch hoặc luồng phân công.
- [Panel Demo Mode](../apps/web-client/src/components/referee/MatchDemoTimePanel.tsx), [API client](../apps/web-client/src/api/matchDemoTime.ts), cảnh báo trong editor đội hình; giữ bố cục trọng tài và các bước BTC.
- Hai biến cấu hình trong [Compose](../docker-compose.yml); overlay opt-in không thêm service/volume.
- [Unit tests](../services/match-service/tests/matchDemoTime.test.cjs) và các script/evidence QA trong [output](../output/demo-match-testing/).

Checkpoint trước: [manifest](../output/demo-match-testing/checkpoint-before/manifest.json). Source trước nhiệm vụ có 128 đường dẫn chưa commit, đã sao chép kèm hash/patch trước khi sửa. Giữ nguyên HEAD, không reset/stash/checkout hoặc gộp commit các thay đổi cũ.

### Bản Docker đã kiểm tra

[Release proof](../output/demo-match-testing/release-proof.json) xác nhận 9 container chạy, 8 có healthcheck đạt; Match đang ở Development, cờ Demo Mode bật cho đúng ba ID giải, nhưng từng phiên do trọng tài bật/tắt. Hash của bốn file backend biên dịch và bundle HTTP khớp build local. Bundle hiện tại: `/assets/index-BhEuQ05H.js`.

Đã so sánh **17 bảng nghiệp vụ** với bản sao backup trước nhiệm vụ: trận, đội hình, sự kiện, kết quả, biên bản, nhánh, binding quy tắc, lịch, phân công, điều lệ gốc, roster/đội/cầu thủ giữ nguyên. Không khẳng định mọi bảng trong toàn hệ thống hoàn toàn bất biến khi hệ thống đang hoạt động.

Audit mới có các lần bật/tắt và chuyển mốc thời gian của tài khoản trọng tài đang mở hệ thống. Giữ nguyên audit, không tự xóa hoặc quy người/tiến trình thực hiện khi chưa có bằng chứng. Kiểm tra cuối: phiên đang tắt, offset 0; trận vẫn SCHEDULED/NOT_STARTED, clock version 0, **0 cầu thủ trong đội hình trận**, chưa có kết quả do nhiệm vụ này tạo trên hệ thống chính thức.

[Ảnh desktop thực tế](../output/demo-match-testing/referee-demo-mode-desktop.png) và [ảnh khung trước trận](../output/demo-match-testing/referee-demo-mode.png) thể hiện Demo Mode cùng các điểm chặn hiện tại. Chúng không phải ảnh trận đã diễn ra. Toàn bộ build workspace cũng đã chạy thành công, không chỉ build hai image.

Trong 128 đường dẫn có sẵn ở checkpoint trước, **117 giữ nguyên hash**, 11 đường dẫn được tích hợp thời gian hoặc cập nhật tài liệu đúng phạm vi; không thiếu file cũ. [Checkpoint cuối](../output/demo-match-testing/checkpoint-final/manifest.json) bảo toàn working tree sau nhiệm vụ.
