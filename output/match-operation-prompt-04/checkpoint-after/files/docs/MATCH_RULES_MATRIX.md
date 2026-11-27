# Ma trận quy tắc điều hành trận đấu — Prompt 2

Ngày kiểm tra: **26/11/2026 (UTC+7)**. Đọc cùng [baseline](./MATCH_OPERATION_BASELINE.md) và [báo cáo Prompt 1](./MATCH_OPERATION_PROMPT_01_REPORT.md). Đây là nền cấu hình và phiên bản, **không phải nghiệm thu toàn bộ luồng thi đấu**.

## 1. Căn cứ và phạm vi

| Mã | Văn bản được đối chiếu | Phạm vi, giới hạn xác minh |
|---|---|---|
| IFAB26 | [IFAB 2026/27](https://www.theifab.com/laws/latest/), [Luật 3](https://www.theifab.com/laws/latest/the-players/), [Luật 7](https://www.theifab.com/laws/latest/the-duration-of-the-match/), [thay đổi 2026/27](https://www.theifab.com/law-changes/latest/) | Trang chính thức hiện ghi 2026/27, có bổ sung sau AGM. Chỉ mã hóa các điểm được kiểm chứng dưới đây; không tuyên bố triển khai trọn bộ luật/protocol. Phiên bản đã lưu không tự cập nhật khi trang `latest` đổi mùa. |
| VFF7 | [VFF](https://vff.org.vn/luat-van-ban/luat-thi-dau-bong-da-7-nguoi/), [sách VFF do VietFootball công bố](https://www.vietfootball.vn/public/tailieu/Lu%E1%BA%ADt%20thi%20%C4%91%E1%BA%A5u%20B%C3%B3ng%20%C4%91%C3%A1%207%20ng%C6%B0%E1%BB%9Di%20%28b%E1%BA%A3n%20in%20s%C3%A1ch%20final%29.pdf) | **433/QĐ-LĐBĐVN, 22/08/2023**, 82 trang; đã đọc quyết định và Luật 3, 7, 10. Tìm lại VFF/VietFootball chưa xác minh được văn bản sửa đổi bộ luật sau 2023. Thông báo sửa điều lệ riêng VPL không mặc nhiên sửa luật chung. Không dùng văn bản 492/2001 thay cho bộ này. |
| FUT26 | [FIFA Futsal 2026/27 do DFB lưu hành](https://assets.dfb.de/uploads/000/341/436/original_Futsal_Laws_of_the_Game_2026-2027_EN.pdf), [AFC](https://www.the-afc.com/en/about_afc/downloads.html) | Sách FIFA 199 trang, hiệu lực **22/10/2026**. Chỉ chọn khi giải xác định là futsal; số cầu thủ trên sân không tự xác định bộ luật. |
| FIVE | [VFF — văn bản 5 người lịch sử](https://vff.org.vn/luat-van-ban/luat-bong-da-5-nguoi-do-uy-ban-the-duc-the-thao-ban-hanh/) | 480/QĐ-UBTDTT-TT.II, 13/06/1998. Chưa đủ căn cứ coi là phiên bản hiện hành cho mọi giải sân 5. Không tạo profile tự động từ văn bản này. |
| REG | Điều lệ phiên bản gắn với draw chính thức của từng trận | Tournament sở hữu; Match lấy bằng API nội bộ, có thể đọc đúng draw đã lưu trữ, không đọc database Tournament. Điều lệ sinh viên khác chỉ là tham khảo theo baseline, không sao chép số liệu vào giải hiện tại. |
| SW | [Use Case](./Usecase_da_chinh_sua_v2.md), baseline §9 | Các yêu cầu quản lý/phân quyền, không gắn nhãn luật IFAB/VFF cho quy tắc riêng của phần mềm. |

## 2. Các giá trị đã công bố được bảo toàn

Đã đọc lại API chính thức ngày 26/11. **Không công bố hay áp dụng bản bổ sung cho ba giải trong tác vụ này.**

| Giải / ID | Thể thức, số người | Điều lệ gốc | Phân định hòa knockout | Thời lượng chính / hiệp phụ đang lưu |
|---|---|---|---|---|
| DEMO IUH League 2026 — `248006af-5af3-4ff5-8486-47b80fc269b9` | Vòng tròn, sân 5 | v1 | Trường legacy lưu luân lưu; không tự áp dụng cho vòng tròn | 40 / 15 phút; số 15 không tự có hiệu lực ở vòng tròn |
| DEMO Student Knockout Cup 2026 — `d9fe5a04-5e71-41ec-b85c-f4567b294c68` | Knockout, sân 7 | v1 | Luân lưu trực tiếp | 50 / 15 phút; thời lượng hiệp phụ hiệu dụng bằng 0, không sửa số đang lưu |
| DEMO HCMC Student Champions Cup 2026 — `9f765a91-b8ab-4716-a083-0cf8a113db1b` | Kết hợp, sân 11 | v1 | Hiệp phụ rồi luân lưu | 90 / 30 phút; vòng bảng cần quy tắc hòa riêng |

Cả ba đang có 3/1/0 điểm; 3 thẻ vàng tích lũy, nghỉ 1 trận; thời hạn khiếu nại 24 giờ; nghỉ tối thiểu 1.440 phút; xử thắng theo điều lệ 3–0. Đây là **giá trị điều lệ hiện có**, không phải mặc định luật chung do Prompt 2 đặt ra. Trình tự xếp hạng hiện có: điểm, hiệu số, bàn thắng, đối đầu, fair-play, bốc thăm. Trọng số fair-play chưa có căn cứ cấu trúc.

**Khoảng trống lịch sử được xác minh:** draw đã công bố của giải vòng tròn (`f3adb69c-6f43-4b7d-963f-25b72c0e8862`) và knockout (`de77439f-020c-44f6-b5e6-96eb44f0f637`) không chứa `fixtureRegulationSnapshot`; bản sinh fixture tương ứng cũng có `regulation_version = NULL`. Draw giải kết hợp (`9f91fb85-89cd-4bdc-90af-83117ec691a5`) có snapshot v1. Việc cả ba giải hiện có điều lệ v1 **không chứng minh** hai draw cũ đã dùng phiên bản đó. Không backfill draw/fixture hoặc suy đoán lịch sử.

Đối với hai draw thiếu nguồn, API đọc trả trạng thái chưa xác định (`MISSING_DRAW_SNAPSHOT`, phiên bản và quy tắc gốc `null`). BTC có thể công bố bản bổ sung chứa bản điều lệ gốc do server đọc và lưu tại thời điểm tạo, rồi **xác nhận rõ việc dùng bản này làm căn cứ cho các trận cũ được chọn**. Khi áp dụng, Match lưu `VERSIONED_SUPPLEMENT_BASE` cùng người, thời điểm và lý do; đây là căn cứ bổ sung có thẩm quyền, không phải khôi phục giả một snapshot lịch sử.

## 3. Ma trận quy tắc

`null` = chưa xác định. Các trường mới không nhận ngầm giá trị 0/30/60 hay sao chép từ một giải khác.

| Quy tắc | Căn cứ / loại | Giá trị và cách lấy | Sở hữu | Nghiệp vụ dùng / điểm chưa xác định |
|---|---|---|---|---|
| Loại hình, bộ luật, edition, nguồn | IFAB26/VFF7/FUT26/REG | BTC chọn rõ một profile hoặc khai báo văn bản khác bằng HTTPS, edition và loại hình | Tournament | Mọi nghiệp vụ; thiếu thì báo theo thao tác, không chặn bốc thăm/lịch |
| Điều chỉnh được phép | REG và thẩm quyền theo luật | Ghi căn cứ, nội dung, lý do trong bản bổ sung | Tournament | Không dùng ô ghi chú để ghi đè ràng buộc cố định của profile |
| Số cầu thủ trên sân / tối thiểu | Luật 3 | IFAB: 11/7; VFF7: 7/4; futsal: 5/3. Minimum futsal có ngoại lệ giảm người tạm thời phải xử lý ở đợt điều hành | Tournament → Match | Đội hình, bắt đầu/tiếp tục; không dùng `maxPlayersPerTeam` của roster |
| Thủ môn | Luật 3 | Một thủ môn trên sân theo profile đã chọn | Tournament → Match | Xác nhận đội hình; validator đội hình đầy đủ thuộc F02 |
| Dự bị một trận | Luật 3 + REG | BTC xác định; profile kiểm tra trần IFAB 15, VFF7 13, futsal 9 cho phạm vi giải chính thức được chọn | Tournament | Không suy ra từ 10/14/20 cầu thủ đăng ký giải |
| Số áo | REG | Không trùng hoặc không trùng trong khoảng 1–99, chọn rõ | Tournament | Đội hình; không tự suy luật số áo từ format |
| Hạn nộp / chỉnh đội hình | REG | Phút trước giờ đấu hoặc null; không gán 30/60 | Tournament | Chỉ áp dụng khi quy định có căn cứ; thực thi đầy đủ ở F02 |
| Thay đổi sát giờ | REG | Thẩm quyền và căn cứ bằng nội dung cấu hình | Tournament | Chưa tạo quy trình xét ngoại lệ mới trong Prompt 2 |
| Số hiệp | Luật 7 | Hai theo ba profile kiểm chứng; engine hiện hỗ trợ hai hiệp | Tournament → Match | Không nhận cấu hình nhiều hiệp giả là đã hỗ trợ |
| Thời lượng hiệp | Luật 7 + REG | Lấy tổng thời lượng gốc / hai sau khi bộ luật được chọn; có thể ghi rõ nhưng phải khớp tổng đã công bố. Trần thông thường IFAB 45, VFF7 35, futsal 20 | Tournament → Match | Không tự đặt thời lượng cho giải chưa rõ luật; giảm thời gian phải có căn cứ điều lệ/thỏa thuận theo luật |
| Nghỉ giữa hiệp | Luật 7 + REG | BTC ghi đúng điều lệ, trần profile tương ứng 15/10/15 phút | Tournament | Không dùng tổng thời gian đặt sân làm thời gian nghỉ pháp định |
| Đồng hồ / bù giờ | Luật 7 | IFAB/VFF7 chạy liên tục và trọng tài bù giờ; futsal thời gian thực tế | Tournament → Match | Metadata và guard đã dùng chung; state machine/đồng bộ đầy đủ F03/F04 chưa nghiệm thu |
| Hội ý | FUT26 Luật 7 | Futsal một lần mỗi hiệp, 60 giây; không có quyền hội ý tương tự theo profile IFAB/VFF7 | Tournament | Công cụ tác nghiệp hội ý chưa triển khai trong Prompt 2 |
| Thay người giới hạn | Luật 3 + REG | Profile IFAB cho giải chính thức: số thay do cơ quan có thẩm quyền/điều lệ xác định, trần năm; không tự điền năm người/ba cơ hội cho giải sinh viên. IFAB có phạm vi “other matches” khác; trường hợp này cần khai báo căn cứ riêng, không mặc định dùng profile giải chính thức. VFF7 quy định tối đa bảy cầu thủ, bốn cơ hội trong thời gian thi đấu | Tournament → Match | Các thời điểm nghỉ không đếm như cơ hội trong thời gian thi đấu; nguyên tử IN/OUT ở F05 |
| Thay luân phiên / tái nhập | FUT26 hoặc ngoại lệ được phép | Futsal luân phiên, được tái nhập; VFF7 không tái nhập. IFAB tái nhập cần ghi căn cứ cho phép; không ngầm bật | Tournament → Match | Luân phiên không nhận giới hạn số lần/cơ hội mâu thuẫn |
| Thay thêm khi hiệp phụ | Luật 3 + REG | Null nếu chưa quy định; chỉ hiện khi điều lệ có hiệp phụ | Tournament | Không tự thêm một suất khi chưa có quy định |
| Vàng thứ hai / đỏ trực tiếp | Luật 12 và REG | Mô hình tách số trận treo giò hai trường hợp; không lấy ngưỡng tích lũy làm mức phạt đỏ | Tournament | Chưa sửa toàn bộ tính kỷ luật F12; các giá trị chưa xác định vẫn null |
| Giảm người | Luật 3/12 | IFAB/VFF7 giảm người còn lại của trận; futsal có cơ chế hai phút theo tình huống bàn thắng/số người | Tournament | Không mô phỏng cơ chế futsal bằng một timeout chung; engine sự kiện cần đợt riêng |
| Tích lũy vàng / nghỉ trận | REG | Giữ số đang công bố trong base snapshot | Tournament → Match | Đã chuyển tra cứu có matchId sang đúng phiên bản của trận |
| Phạm vi / bắt đầu / xóa thẻ | REG | Trường riêng; null khi thiếu | Tournament | Không tự chọn toàn giải, giai đoạn hoặc tự xóa thẻ |
| Hòa vòng bảng/vòng tròn | REG, Luật 10 | Chọn cho phép hòa hoặc phương thức được điều lệ quy định; độc lập với knockout | Tournament → Match | Không chạy hiệp phụ/luân lưu do cờ knockout toàn giải |
| Knockout | REG gắn draw | Dùng `knockoutDecisionMethod` gốc | Tournament → Match | Backend chặn hiệp phụ nếu luân lưu trực tiếp; không bỏ qua hiệp phụ bắt buộc |
| Hiệp phụ | Luật 10 + REG | Thời lượng gốc, không tự gán 30 phút. Nếu chọn VFF7 mà điều lệ không khớp hai hiệp 10 phút thì báo mâu thuẫn | Tournament → Match | Không sửa trực tiếp số đang công bố để hợp thức hóa |
| Luân lưu | Luật 10 | Năm lượt ban đầu theo ba profile; chỉ có hiệu lực khi giai đoạn yêu cầu phân định | Tournament → Match | Chưa nghiệm thu ghi từng lượt/tách thống kê ở F06 |
| Xử thua | REG | Chính sách và tỷ số hiện có từ snapshot gốc | Tournament → Match | Không tạo tỷ số mặc định mới hoặc biên bản thi đấu giả |
| Điểm / thứ tự xếp hạng | REG | Giữ bản gốc gắn draw | Tournament → Match | Không sửa thuật toán BXH F09 trong Prompt 2 |
| Fair-play | REG | Trọng số/căn cứ riêng, null nếu thiếu | Tournament | Không tự dùng trọng số của giải khác |
| Khiếu nại / kháng nghị | REG | Giữ giờ khiếu nại gốc, thêm mốc tính và nội dung thẩm quyền; chưa tự đặt hạn kháng nghị | Tournament → Match | F13 còn cần quy trình và mốc chính thức, không coi trường mới là đã thực thi toàn bộ |
| Số trọng tài / quyền xác nhận | SW + cấu hình Bước 6 | Giữ snapshot phân công và capability hiện có | Match | Không thêm số trọng tài mặc định hoặc đổi enum |

## 4. Quy trình phiên bản và API

### Tournament là nguồn điều lệ

- Bảng bổ sung `regulation_operation_rules`, migration **26**; liên kết FK với đúng `(tournament_id, version)` của điều lệ gốc. Migration **27** bổ sung `base_snapshot` nullable và bảo vệ nội dung này bằng trigger bất biến; không sửa migration đã áp dụng hoặc backfill điều lệ/draw cũ.
- Bản nháp mới là một revision mới; bắt buộc lý do và `expectedRevision`. Không ghi đè nội dung bản cũ.
- Công bố lưu người/thời điểm; gọi lại cùng revision không tạo lần công bố khác. Trigger PostgreSQL chặn UPDATE/DELETE bản đã công bố.
- Không thay `tournament_rules.published_version`, nội dung điều lệ v1, draw, roster, fixture hoặc lịch của ba giải.
- GET `/tournaments/:id/regulation-operation-rules`: BTC đúng phạm vi thấy nháp; người xem chỉ thấy bản bổ sung đã công bố theo quyền xem giải.
- POST cùng đường dẫn: lưu bản nháp; POST `/:revision/publish`: công bố. Service kiểm tra session được Gateway xác thực, BTC, quyền quản lý giải, trạng thái và optimistic revision.
- GET nội bộ `/internal/tournaments/:id/match-rules-source?drawVersionId=…&supplementId=…`: đọc đúng snapshot nghiệp vụ trong draw đã công bố, kể cả draw đã lưu trữ. Draw không hợp lệ, bản bổ sung sai hoặc API lỗi trả lỗi thật. Draw cũ thiếu snapshot trả nguồn chưa xác định để màn hình vẫn đọc được và giải thích phần thiếu; không dùng điều lệ hiện tại làm fallback. Chỉ bản bổ sung được chọn rõ mới cung cấp căn cứ mới đã lưu trong `base_snapshot`.

### Match sở hữu bản áp dụng và lịch sử của trận

- Bảng mới `match_operation_rule_bindings`, migration Match **22**, append-only; chứa bản nguồn đầy đủ, revision, lý do, người và thời điểm áp dụng.
- GET `/tournaments/:id/fixtures/operation-rules`: kiểm tra các trận đủ điều kiện.
- POST `/tournaments/:id/fixtures/operation-rules/apply`: BTC chọn rõ danh sách, revision kỳ vọng từng trận và bản bổ sung đã công bố. Khóa hàng trận, transaction toàn bộ phạm vi, kiểm tra lại trạng thái/dữ liệu. Không cập nhật lịch hay cặp đấu.
- Với trận thiếu snapshot/version lịch sử, backend yêu cầu thêm `confirmLegacyBaseVersion = true`; thiếu xác nhận trả 409 `MATCH_RULES_BASE_CONFIRMATION_REQUIRED`. Giao diện chỉ hiện xác nhận này cho phạm vi có trận cần nó. Những trận không được chọn vẫn giữ nguồn chưa xác định.
- Không áp dụng luồng thường cho trận đã có đội hình, sự kiện, kết quả, biên bản, đồng hồ đã chạy/cập nhật hoặc trạng thái đã sẵn sàng/thi đấu.
- GET `/matches/:id/operation-rules` và `referee-context.operationRules` dùng chung resolver. Quyền đọc theo giải/phân công thật; trọng tài đã bị thay không có quyền đọc.
- Sau khi pin, đọc từ bản đã lưu trong Match. Tạo/công bố bản bổ sung mới không đổi ngầm các trận đã pin. Chưa pin thì báo thiếu quy tắc; không chọn ngầm bản bổ sung mới nhất.
- Guard trực tiếp đã nối ở xác nhận đội hình, bắt đầu hiệp phụ/luân lưu/đồng hồ, ghi sự kiện, kiểm tra tỷ số và xác nhận biên bản. Chính sách xử thua/kỷ luật/khiếu nại có matchId đọc base đúng phiên bản. **Không đồng nghĩa các state machine, kỷ luật, thay người và biên bản cũ đã được sửa hoàn chỉnh.**
- Sự kiện `match.rules.changed` đi qua PostgreSQL NOTIFY/SSE hiện có sau khi transaction commit; không thêm broker, WebSocket hay runtime service.

### Giao diện

Tận dụng [TournamentDetailPanel](../apps/web-client/src/components/TournamentDetailPanel.tsx), thêm mục thu gọn “Luật thi đấu & quy tắc điều hành”. Không tạo route điều lệ thứ hai hoặc đưa bốc thăm/hạt giống vào form. Trang chi tiết trọng tài hiển thị chính bản quy tắc của trận và nội dung còn thiếu, giữ bố cục cam–đen.

## 5. Các quyết định thực sự còn cần BTC xác định

1. **Giải IUH sân 5:** loại hình và bộ luật/văn bản cụ thể. Không suy ra futsal. Các giá trị tối thiểu, đồng hồ, thay người/hội ý phụ thuộc lựa chọn này.
2. **Giải sân 7 / sân 11:** xác nhận bộ luật/edition áp dụng và căn cứ cho các điều chỉnh thời lượng đã ghi trong điều lệ. Phần mềm cung cấp profile có nguồn; tác vụ này chưa công bố thay BTC.
3. Cho từng giải: dự bị một trận, chính sách số áo, nghỉ giữa hiệp, quyền/hạn đội hình nếu có, phương thức hòa vòng bảng, giới hạn thay người được phép lựa chọn và quyền thay thêm khi hiệp phụ.
4. Phạm vi/thời điểm thi hành kỷ luật, thẻ vàng thứ hai/đỏ trực tiếp, xóa thẻ giữa các giai đoạn, fair-play, mốc khiếu nại và thủ tục kháng nghị. Các giá trị đã công bố được giữ; chỉ bổ sung phần chưa xác định.

Đây là quyết định cấu hình theo giải. Không cần người dùng phê duyệt lại các con số bắt buộc đã có trong bộ luật được chọn. Không yêu cầu xác nhận thời hạn hoặc mức phạt do lập trình viên tự đặt.

## 6. Kiểm chứng và giới hạn

| Ca kiểm thử | Kết quả | Bằng chứng / giới hạn |
|---|---|---|
| Cùng sân 5, hai bộ luật khác nhau | PASS unit | Futsal có đồng hồ thực tế; bộ luật sân 5 khai báo riêng giữ đồng hồ liên tục, không tự chuyển loại hình. Chưa tạo hai giải mới trên DB chính thức |
| Luân lưu trực tiếp / hiệp phụ / hòa vòng bảng | PASS unit | Kiểm tra resolver và guard backend, không bắt đầu trận tương lai |
| Khác quy định thay người, số dự bị độc lập roster | PASS unit | Kiểm tra dữ liệu/validation; thao tác thay người trực tiếp NOT TESTED |
| Quy tắc thiếu | PASS unit + API QA | Null giữ nguyên, bản chưa áp dụng không bị thay bởi bản nháp mới nhất |
| Lưu nháp → công bố → áp dụng một trận → đọc lại | PASS API/PostgreSQL QA | Auth session thật, Gateway thật, controller/repository thật, hai database clone mới; không dùng endpoint test |
| Race/revision cũ, công bố lại, trigger bất biến | PASS API/DB QA | Ghi cũ bị 409, công bố lại giữ mốc, PostgreSQL từ chối sửa lịch sử |
| Draw cũ thiếu snapshot: đọc, xác nhận căn cứ và áp dụng | PASS — 8 ca API/DB QA | Đọc không crash; chưa xác nhận bị 409; xác nhận lưu được; các trận khác vẫn chưa xác định; draw/fixture cũ không bị backfill; trigger bảo vệ căn cứ đã công bố |
| RBAC và phạm vi phiên bản | PASS API QA | Anonymous/không có BTC/không có phân công bị chặn; bản không đúng format bị từ chối |
| Bảo toàn điều lệ/fixture/roster/lịch gốc | PASS đối chiếu hash | Các bảng nghiệp vụ gốc trong clone giữ nguyên; chỉ bổ sung bảng mới và log realtime. Database Tournament/Match chính thức không đổi qua QA |
| Cấu hình điều hành đầy đủ cho ba giải chính thức | NOT TESTED / CHƯA ÁP DỤNG | Không tự quyết định các quy tắc còn thiếu hoặc sửa điều lệ của người dùng |
| Trận thực: đội hình → clock → thay người → thẻ → luân lưu → biên bản → BXH | NOT TESTED E2E | F01–F15 còn phạm vi ở các prompt tiếp theo; không gán PASS từ build |

Các lượt QA gồm 19 ca ban đầu, 4 ca kiểm tra bản compiled cuối và 8 ca nguồn lịch sử, tổng **31 ca PASS**. Đây là các ca API/database, không phải 31 trận hoàn chỉnh. Log: [QA API](../output/match-operation-prompt-02/qa-api-checks.json), [bản compiled](../output/match-operation-prompt-02/qa-final-source-checks.json), [nguồn lịch sử](../output/match-operation-prompt-02/qa-legacy-source-checks.json), [Match tests](../output/match-operation-prompt-02/match-tests.txt), [Tournament tests](../output/match-operation-prompt-02/tournament-tests.txt), [frontend tests](../output/match-operation-prompt-02/web-tests.txt), [typecheck](../output/match-operation-prompt-02/typecheck-all.txt).

## 7. Migration và khôi phục an toàn

Ba migration (Tournament 26/27, Match 22) chỉ tạo bảng/index/trigger mới hoặc bổ sung cột nullable vào bảng mới; không UPDATE điều lệ hay dữ liệu thi đấu. Đã áp dụng trên hai database QA từ bản sao và kiểm tra trigger/round trip trước khi triển khai chính thức. Dump định dạng custom tại [thư mục sao lưu](../backups/match-operation-prompt-02-20261126-001/); đã phục hồi thành database QA mới, giữ nguyên bản dump.

Nếu cần quay lại code trước Prompt 2: dùng checkpoint source đã lưu, ngừng sử dụng API mới; giữ nguyên bảng bổ sung để bảo toàn audit. Không chạy down/reset/drop/truncate. Nếu cần phục hồi dữ liệu, khôi phục dump vào database mới, đối chiếu trước khi có quyết định chuyển kết nối; không ghi đè database chính thức tự động.

## 8. Bàn giao bản chạy chính thức

| Hạng mục | Kết quả sau triển khai |
|---|---|
| Typecheck toàn workspace | **PASS** |
| Tournament tests | **44 PASS / 20 SKIP / 0 FAIL**; 16 test quy tắc mới |
| Match tests | **185 PASS / 34 SKIP / 0 FAIL**; 9 test guard mới. Unit suite chạy với `DATABASE_URL`/`SCHEDULING_DATABASE_URL` riêng không thể kết nối; test DB opt-in vẫn SKIP. 31 ca API QA dùng PostgreSQL thật riêng biệt |
| Frontend trọng tài | **21 PASS / 0 FAIL** |
| Production build | **PASS** shared, Tournament, Match và frontend; frontend còn cảnh báo kích thước bundle, không phải lỗi build |
| Docker Compose | **PASS** config, build và cập nhật đúng ba thành phần thay đổi. Chín container runtime đang chạy; tám có healthcheck đều healthy; web phục vụ HTTP trên cổng 5173 |
| Image / build context | **PASS** build từ workspace hiện tại; bundle đang phục vụ khớp SHA-256 bản build cuối; không đưa backup/output vào context |
| API chính thức ba thể thức | **PASS** đọc 12/15/31 trận; RR/KO báo thiếu nguồn lịch sử; kết hợp đọc snapshot v1; không tự tạo bản bổ sung |
| Frontend / backend cùng quy tắc | **PASS** tài khoản trọng tài có phân công thật: `operation-rules` và `referee-context.operationRules` trả cùng nội dung. Trang chi tiết/tác nghiệp hiển thị đúng nguồn v1 và quy tắc còn thiếu |
| Kiểm tra UI đang chạy | **PASS đọc DOM** trên 5173, giữ trang trọng tài hiện tại, không tràn ngang ở viewport đã kiểm tra. **NOT TESTED** toàn bộ form bổ sung bằng thao tác trình duyệt của BTC, mọi kích thước màn hình hoặc ảnh chụp đầy đủ; lưu/công bố/áp dụng đã kiểm thử qua API QA |
| Dữ liệu chính thức | **PASS bảo toàn nội dung cũ**; không có bản bổ sung hoặc binding tự sinh. Toàn bộ bảng nghiệp vụ Match giữ nguyên hash. Tournament có dữ liệu mới trong thời gian kiểm tra; xem giới hạn bên dưới |

**Đối chiếu dữ liệu cuối:** không tuyên bố hash toàn database Tournament bằng bản đầu. Có thêm hai giải và các bản ghi phụ thuộc; 584 participation claims và 36 reservations chỉ đổi `updated_at`. Đối chiếu từng khóa với database phục hồi cho thấy không mất bản ghi cũ, không thay nội dung nghiệp vụ của các bản ghi cũ; điều lệ, draw, fixture, lịch và phân công đã có được giữ nguyên. Không xác định tác nhân tạo hai giải chỉ từ đối chiếu này và không khôi phục đè chúng. Chi tiết: [hash/tổng số](../output/match-operation-prompt-02/official-database-proof.json), [đối chiếu từng khóa](../output/match-operation-prompt-02/official-row-preservation.json).

Bằng chứng runtime: [API và bundle](../output/match-operation-prompt-02/runtime-api-proof.json), [container/image](../output/match-operation-prompt-02/runtime-containers.json), [Docker build](../output/match-operation-prompt-02/docker-release-build.txt), [migration](../output/match-operation-prompt-02/tournament-release-migration.txt), [khởi chạy](../output/match-operation-prompt-02/docker-release-up.txt).

Checkpoint source: [trước](../output/match-operation-prompt-02/checkpoint-before/manifest.json), [sau](../output/match-operation-prompt-02/checkpoint-after/manifest.json), [bảo toàn 24 đường dẫn có từ trước](../output/match-operation-prompt-02/source-preservation.json). Không có file gốc bị mất; 18 file giữ nguyên byte, sáu file được sửa trong phạm vi API/context/quy tắc và baseline. HEAD vẫn `27fa2bd9fef76f23bc6cb16b939f124735c8cea0`; checkpoint là bản sao file, diff và manifest SHA-256, không commit gộp các thay đổi chưa commit từ trước.

Truy cập hệ thống chính thức: [Tổng quan trọng tài](http://localhost:5173/referee), [BTC](http://localhost:5173/btc). Điều lệ đã công bố của ba giải chưa bị tự bổ sung. **Dừng ở Prompt 2**; các quyết định ở mục 5 và F01–F15 của baseline vẫn cần các prompt tương ứng trước khi nghiệm thu luồng thi đấu.

## 9. Bổ sung Prompt 4 — đội hình và chuẩn bị trước trận

Cập nhật 26–27/11/2026. Các kết quả ở mục 8 thuộc Prompt 2 được giữ làm lịch sử. Xem [báo cáo Prompt 4](./MATCH_OPERATION_PROMPT_04_REPORT.md) và [baseline mục 16](./MATCH_OPERATION_BASELINE.md#16-bổ-sung-prompt-4--đội-hình-theo-trận-và-f02).

| Quy tắc / quyết định | Nguồn và giá trị áp dụng | Service sở hữu / sử dụng | Trạng thái |
|---|---|---|---|
| Nguồn cầu thủ trận | Hồ sơ đội APPROVED, danh sách đã nộp, roster hiện hành, xác nhận tham gia còn hiệu lực; không lấy toàn CLB | Organization cung cấp API; Match kiểm tra khi đọc/lưu/gửi/kiểm tra/sẵn sàng/START | Đã triển khai, API QA PASS |
| Đánh giá cá nhân trong hồ sơ đã duyệt | Không tự yêu cầu từng dòng `APPROVED` nếu nghiệp vụ hiện hành duyệt cả hồ sơ; từng người REJECTED vẫn không hợp lệ | Organization | Không sửa luồng duyệt roster đã hoàn thành |
| Xuất phát, tối thiểu, dự bị, thủ môn | `startingPlayers`, `minimumPlayers`, `maxSubstitutes`, `goalkeepers` từ đúng EffectiveMatchRules; chưa xác định giữ null | Tournament sở hữu phiên bản; Match validate | Unit 5/7/11 PASS; API đầy đủ profile 11 PASS, profile 5/7 NOT TESTED |
| Số áo | Số nguyên dương, không trùng; `UNIQUE_1_99` mới giới hạn đến 99, `UNIQUE` không áp trần 99 tự đặt | Match | Unit và API QA PASS |
| Treo giò | Án còn hiệu lực theo ngày chính trận; không dùng ngày hiện tại để kết luận thay cho ngày trận tương lai | Match / Discipline database | API QA trước và sau sẵn sàng PASS; không viết lại engine kỷ luật F12 |
| Hạn gửi / sửa | `lineupSubmissionMinutes`, `lineupEditMinutes` nếu được quy định; null không sinh hạn mặc định | Phiên bản Tournament, Match enforce | API QA hạn được cấu hình PASS; không cập nhật điều lệ chính thức |
| Quyền thay đổi sát giờ | `lateLineupAuthority` hiện là mô tả tự do, chưa đủ để tự gán quyền API vượt hạn | BTC phải xác lập quy trình/quyền có căn cứ; Match chặn khi hết hạn | Chưa suy diễn quyền; có ghi nhận vấn đề/chuyển BTC. Chưa nghiệm thu ghi đè hạn theo mô tả tự do |
| Gửi khác kiểm tra | Đội trưởng gửi SUBMITTED; trọng tài có FINALIZE kiểm tra thực tế từng đội; hai bước riêng | Match | API QA PASS |
| Khóa đội hình | Gửi không tự khóa; còn SCHEDULED và trong hạn thì được sửa nhưng mất xác nhận cũ. LINEUP_CONFIRMED khóa chỉnh thông thường; trước trận cần yêu cầu điều chỉnh/mở lại hợp lệ | Match, dưới khóa trận và phiên bản | API QA PASS |
| Ngoại lệ tại sân | Ghi nhận vấn đề và quyết định BTC có lý do/audit; không tự chọn thời gian chờ hay tỷ số xử thua | Match | API QA PASS |
| F02 sẵn sàng | Hai đội xác định; mỗi đội có đội hình hợp lệ đã gửi/được kiểm tra; nguồn hiện hành; không vấn đề mở; người xác nhận đúng phân công; trạng thái phù hợp | Match + Scheduling repository trong cùng service | API QA PASS; không tự hợp thức hóa trận cũ |
| START kiểm tra lại | Dùng cùng dữ liệu đội hình/nguồn/treo giò tại thời điểm yêu cầu, cùng gate Prompt 3 | Match, đọc Organization bằng API | QA thay đổi án treo giò sau READY bị chặn; START hợp lệ trên QA PASS |

Lưu nháp không tự thành dữ liệu đã gửi hoặc dữ liệu công bố. Quy tắc thiếu chỉ chặn nghiệp vụ phụ thuộc: được lưu nháp chưa đủ số người, nhưng không được gửi đội hình chưa đủ căn cứ. Không đặt thêm hạn 30/60 phút, không tự chọn futsal cho sân 5 và không sửa điều lệ đã công bố của ba giải demo.

Backend sử dụng một đường ghi có transaction/revision cho cả bulk API và các API lineup cũ; frontend hiển thị cùng quy tắc của Match. Bảo toàn quyền READ/RECORD_EVENT/EDIT_EVENT/MANAGE_REPORT/FINALIZE và không tạo loại nhiệm vụ mới. Tranh chấp commit giữa các database/service độc lập và toàn bộ luồng thi đấu vẫn chưa nghiệm thu.
