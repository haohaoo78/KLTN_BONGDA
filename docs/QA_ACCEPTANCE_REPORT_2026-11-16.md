# Kiểm thử nghiệm thu SFTMS (16/11/2026)

## Luồng E2E chạy trên Docker và database thật

Đã tạo giải kiểm thử liên trường riêng `[E2E TEST] Inter-school Full Workflow 2026-11-16` (`e01e44ac-9bd9-4e36-a9e0-2b517389e4b1`) bằng BTC IUH. Dùng hai đội fixture sẵn có: SFL Demo North (IUH) và SFL Demo South (HUTECH), mỗi đội có 7 thành viên. Không xóa/reset database, volume hay dữ liệu giải/đội có sẵn.

| Bước | Kết quả xác minh |
|---|---|
| Mở đăng ký giải liên trường, 7-a-side | Đạt; cho phép cả IUH và HUTECH theo phạm vi giải. |
| Gửi lời mời và cầu thủ phản hồi | 14 lời mời tạo qua API; 14/14 cầu thủ đăng nhập tài khoản riêng và xác nhận. |
| Nộp hồ sơ đội | 2 đội gửi hồ sơ cùng roster đã xác nhận, 7 cầu thủ/đội. |
| BTC xét duyệt | BTC IUH xem hàng chờ và duyệt 2/2 hồ sơ; trạng thái được lưu `APPROVED`. |
| Đóng đăng ký, chốt roster | Chuyển trạng thái giải `REGISTRATION_CLOSED` → `ROSTER_LOCKED`; cả hai đội hiện đủ điều kiện, 7/7 cầu thủ. |
| Chia bảng | Preview → lưu draft → xác nhận → công bố; draw lưu ở `PUBLISHED`, một bảng, hai trường khác nhau. |
| Lập lịch | Tạo một trận vòng tròn; sân SFL Demo Stadium và trọng tài Demo Referee được gán. Lịch đã `PUBLISHED`, trọng tài thấy lịch trong `/api/my/schedules`. |
| Điều hành và xác nhận trận | Hai đội xác nhận đội hình; trọng tài chuyển trạng thái, ghi tỷ số 2–1 và nộp biên bản; BTC duyệt biên bản. Trận `VERIFIED`, kết quả và report `APPROVED`. |
| Bảng xếp hạng và kết thúc | IUH/HUTECH lần lượt có 3/0 điểm; giải chuyển `COMPLETED`. |

Trạng thái cuối được đọc lại từ API: giải `COMPLETED`, 2 hồ sơ `APPROVED`, draw `PUBLISHED`, lịch `PUBLISHED`, trận `VERIFIED`, kết quả 2–1 và report `APPROVED`.

## Lỗi phát hiện và sửa trong lượt chạy

- Xác nhận/công bố bản chia bảng gây HTTP 500 do PostgreSQL suy luận `$1` thành `text` và `character varying` trong cùng biểu thức. Ép kiểu rõ ràng trong câu `UPDATE` ở [drawWorkflowRepository.ts](../services/tournament-service/src/repositories/drawWorkflowRepository.ts); build và xác nhận/công bố lại thành công.
- Fixture generation và kiểm tra cấu hình khi tạo lịch gọi Tournament service mà không gửi khóa gateway nội bộ. Bổ sung header cho các lời gọi ở [fixtureGenerationService.ts](../services/match-service/src/services/fixtureGenerationService.ts) và [schedulingService.ts](../services/match-service/src/scheduling/services/schedulingService.ts); build Docker lại và các bước tạo fixture/lịch chạy thành công.
- Cửa sổ đăng ký trước đây được lưu theo UTC dù người dùng nhập ngày địa phương UTC+7. Đã chuẩn hóa ngày bắt đầu/kết thúc thành ranh giới ngày `+07:00` khi tạo kỳ đăng ký và giữ nguyên timestamp có múi giờ do client gửi. Bổ sung unit test cho cả ngày đơn và timestamp tường minh; giải E2E vẫn giữ nguyên dữ liệu lịch sử.
- Luồng trận yêu cầu xác nhận đội hình trước khi trọng tài chuyển sang `IN_PROGRESS`, và trận phải `FINISHED` trước khi ghi kết quả. Lượt test đi đúng thứ tự; các điều kiện được backend áp dụng.
- Rà soát tiếp phát hiện trước đó API vẫn cho đặt `IN_PROGRESS` trước giờ kickoff. Đã thêm chặn ở match service: chỉ chuyển sang `IN_PROGRESS` khi match có giờ thi đấu và giờ đó đã tới. Unit test kiểm tra sát trước/đúng/sau kickoff; kiểm thử API tạo trận tương lai tạm thời nhận HTTP 409 `MATCH_KICKOFF_NOT_REACHED`, sau đó xóa trận tạm qua API.

## Kiểm tra khác đã chạy

- Docker Desktop Engine/Compose hoạt động; các service liên quan sau build ở trạng thái khỏe.
- 6/6 tài khoản theo vai trò đăng nhập/dashboard API được xác minh trước lượt E2E; VIEWER bị từ chối endpoint `/api/users` với HTTP 403.
- Chạy unit tests Match lần mới nhất: **52 pass, 0 fail, 4 skipped** khi bật PostgreSQL integration suite; 4 test skip cần fixture/DB chuyên biệt khác. Tournament **10 pass, 0 fail, 1 skipped**. Luồng E2E bên trên đã kiểm chứng persistence thật qua API/database.
- Build/typecheck các workspace đã được xác minh ở lượt trước; ở các lượt gần nhất build lại `tournament-service`, `match-service` và web thành công. Sau triển khai, Tournament (3003), Match (3005), API Gateway (8080) đều trả `status: ok`; Web (5173) trả HTTP 200.
- Siết nghiệp vụ phân công tổ trọng tài: backend chỉ nhận các vị trí được hỗ trợ, quyền xác nhận kết quả cuối phải thuộc `REFEREE`; Web không tạo vị trí giả khi đã hết chức danh. Unit tests kiểm tra chức danh giả/không hỗ trợ và quyền cuối gán sai. Match và Web đã được build lại trong Docker; migrations one-shot chạy xong, không reset dữ liệu hoặc volume.
- Chuẩn hóa thành phần modal dùng chung: eyebrow trung tính thay cho nhãn cố định “Thao tác tài khoản”, giữ focus trong hộp thoại bằng bàn phím, đưa focus về nút mở khi đóng, có viền focus dễ nhận biết và bố cục mobile. Cỡ chữ nhãn/giá trị nhập/trợ giúp/lỗi form được tăng đồng bộ. Browser smoke check trên tài khoản demo mở trang “Tài khoản của tôi” và modal lịch sử; tiêu đề, mô tả, nút đóng và trạng thái rỗng hiển thị đúng. Không lưu thay đổi hồ sơ.
- Tối ưu UI hồ sơ đăng ký giải: đội trưởng có bộ lọc cầu thủ theo từ khóa, vị trí và trạng thái lời mời, chọn nhanh cầu thủ đủ điều kiện; BTC có thẻ hồ sơ rõ trạng thái, tổng hợp kết quả lọc, modal xác nhận duyệt/từ chối/yêu cầu bổ sung và ô lý do bắt buộc cho hai quyết định cuối. Modal chi tiết hiện trạng thái tải riêng cho lịch sử và roster. Web `typecheck`, production build, Docker image build và khởi động lại container Web đều thành công; trang trả HTTP 200. Docker Compose giữ database/volume hiện tại; các migration jobs one-shot chạy xong.

## Phạm vi còn thiếu

- Đây là một lượt E2E API/database, không phải E2E UI trên trình duyệt. Chưa xác minh mọi cập nhật realtime/hiển thị trên từng màn hình.
- Chỉ chạy một trận vòng tròn 2 đội; chưa kiểm thử E2E loại trực tiếp, giải kết hợp, BYE, nhiều trận, va chạm lịch, đổi kết quả hoặc xử lý đội rút lui trong lượt này. Các thuật toán có unit/integration test riêng như nêu trên.
- Giải E2E đã hoàn tất bằng cách mô phỏng trạng thái trận trên lịch tương lai trước khi bổ sung chốt kickoff; đây là dữ liệu thử nghiệm lịch sử, không phải trận đã diễn ra. Kiểm tra API mới xác nhận thao tác tương tự bị từ chối HTTP 409 `MATCH_KICKOFF_NOT_REACHED`. Không dùng giải `[E2E TEST]` để công bố như một giải thực.
- Chưa kích hoạt email thật; các tài khoản demo đã xác thực sẵn. Không gửi email hoặc thay đổi cấu hình SMTP.
- Giải `[E2E TEST]` và các hồ sơ/invitation/trận liên quan được giữ lại trong database để người dùng có thể xem lại. Đây là dữ liệu test được gắn nhãn rõ ràng.

## Kết luận

Một luồng nghiệp vụ trọng tâm đã đi xuyên từ cầu thủ xác nhận lời mời đến kết thúc giải bằng API và database thật, đồng thời phát hiện/sửa hai lỗi backend đang chặn chia bảng và lập lịch. Kết quả này xác nhận luồng vừa chạy được trong fixture hai đội; chưa đủ để kết luận toàn bộ hệ thống đã sẵn sàng production hoặc thương mại hóa.

## Bổ sung rà soát tiếp theo (16/11/2026)

- Giải kết hợp: chạy trực tiếp trên PostgreSQL hiện có các kiểm thử tạo playoff và snapshot đội vượt qua vòng bảng với 5, 6, 7, 8, 10, 12, 16 đội; kiểm tra nhiều bảng, tie-break, bốc thăm có nhân chứng và retry không sinh trùng. Tổng Match test lần trước: **51 pass, 0 fail, 4 skip**; lượt xác minh bổ sung sau khi tạo correction workflow: **52 pass, 0 fail, 4 skip**, bao gồm 2 integration test correction chạy trên PostgreSQL thật. Các test skip còn cần fixture/DB riêng cho kỷ luật và lịch xung đột.
- Đổi lịch: thêm lịch sử trước/sau dạng append-only, yêu cầu lý do khi sửa lịch đã công bố, lưu đổi giờ và thay đổi trạng thái trong transaction, khóa sửa khi trận đã bắt đầu/kết thúc, giữ lịch đã công bố trong lịch sử thay vì xóa. Đội trưởng hai đội và tổ trọng tài được thông báo; giao diện có form đổi/hủy và xem lịch sử. Migration lịch sử đã chạy idempotent trên database scheduling, không xóa dữ liệu.
- Rút hồ sơ đội: đội trưởng có thể rút hồ sơ `PENDING` hoặc `REVISION_REQUIRED`, phải ghi lý do; trạng thái/lịch sử được đồng bộ thay vì xóa hồ sơ. Đội đã duyệt bị chặn khỏi thao tác rút tức thời vì cần quy trình rút đội hậu duyệt và đánh giá tác động đến lịch/bảng.
- Khiếu nại/kỷ luật: danh sách khiếu nại giới hạn cho BTC được giao giải hoặc đội trưởng đúng đội; dữ liệu án treo và quyết định kỷ luật giới hạn theo BTC phụ trách giải. Quyết định khiếu nại không cho sửa lại sau khi đã chốt; từ chối bắt buộc có lý do.
- Kết quả: backend từ chối ghi đè trực tiếp kết quả đã duyệt (`RESULT_CORRECTION_REQUEST_REQUIRED`). Đã bổ sung hồ sơ yêu cầu sửa tỷ số có snapshot trước/sau, lý do, người yêu cầu/người duyệt và quyết định BTC; duyệt được thực hiện transactionally cùng việc cập nhật bảng xếp hạng. Có API và giao diện cho trọng tài có thẩm quyền gửi yêu cầu, BTC phụ trách giải xem/duyệt/từ chối. PostgreSQL integration kiểm tra cả chặn ghi đè và lưu/duyệt hiệu chỉnh: **2/2 pass**. Kết quả vòng bảng của giải kết hợp bị khóa sau khi snapshot đội đi tiếp; hiệu chỉnh knockout làm đổi đội thắng bị chặn an toàn, chưa có quy trình tái tính dây chuyền bracket/lịch cho trường hợp này.
- Migration bù version 11 thêm `tournament_id` và index cho bảng yêu cầu sửa kết quả; migration transactional/idempotent, đã chạy trên database hiện có và integration test sau migration đạt.
- Rà soát quyền API cho các route đã liên quan: Tournament management bắt buộc BTC và kiểm tra người tạo/được phân công; Match correction yêu cầu BTC phụ trách giải hoặc trọng tài có quyền kết quả trận; quyết định khiếu nại/discipline giới hạn BTC; scheduling mutation yêu cầu BTC và kiểm tra ownership; các endpoint nội bộ yêu cầu trusted gateway. Đây là rà soát source có trọng điểm, chưa phải penetration test toàn bộ API hoặc kiểm thử ma trận mọi role/IDOR.
- Kiểm tra kỹ thuật: sau các thay đổi mới nhất, `corepack pnpm -r run typecheck` và `corepack pnpm -r run build` đều thành công toàn workspace. Web build có cảnh báo bundle JS 510.57 KB chưa code-split, không làm build thất bại. Healthcheck HTTP hiện tại trả 200 cho Web, Gateway và cả năm backend theo lần kiểm tra trước. Root script `pnpm run build` không chạy vì gọi `pnpm` trực tiếp trong môi trường này; lệnh tương đương qua Corepack chạy đạt.
- Chưa thể xác minh Compose build/recreate hoặc backup/restore: Docker CLI/Compose và `pg_dump` không khả dụng trong shell được cấp. Các container đang phục vụ vẫn trả health 200, nhưng chưa được thay bằng image vừa build. Chưa triển khai production vì chưa có hạ tầng đích/secret/chiến lược backup-restore do người vận hành cung cấp.
