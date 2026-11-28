# Tiến độ hoàn thiện nghiệp vụ — 16/11/2026

Tài liệu này bổ sung trạng thái cho các hạng mục vận hành đang được xử lý. Đây là báo cáo dựa trên source hiện tại; không thay thế nghiệm thu chạy trên Docker/database thật.

## Đã triển khai trong source

- **Rút đội đã duyệt:** đội trưởng gửi yêu cầu; BTC được phân công cho giải quyết định duyệt/từ chối. Quyết định duyệt đồng bộ reservation phía Tournament trước khi ghi đăng ký `WITHDRAWN`. Trường hợp upstream lỗi được giữ trạng thái `PROCESSING`, cho phép BTC thử đồng bộ lại cùng quyết định. Yêu cầu được lưu lịch sử và có giao diện hai phía. Nếu danh sách đã khóa, hệ thống hiện từ chối rút đội để không làm sai lịch/bảng; chưa tự động xử lý walkover hoặc tái cấu trúc lịch.
- **Quyền xác nhận kết quả:** trọng tài có thẩm quyền được nộp kết quả thông thường để hệ thống duyệt và cập nhật bảng xếp hạng; trọng tài có thể đánh dấu ngoại lệ để chuyển BTC xem xét. Kết quả loại trực tiếp hòa cần có tỷ số hiệp phụ/luân lưu theo cấu hình mới được xác định đội thắng.
- **Quyết định ownership:** đăng ký giải/roster/lời mời tiếp tục nằm ở Organization trong giai đoạn chuyển tiếp; Tournament tiếp tục sở hữu thể lệ, cấu hình giải và reservation. Chưa chuyển dữ liệu liên service.

## Kiểm tra source

- `corepack pnpm -r run typecheck`: **pass**.
- `corepack pnpm -r run build`: **pass**. Bundle web 518.93 kB chưa nén; Vite phát cảnh báo vượt ngưỡng 500 kB.
- `corepack pnpm -r run test`: **pass, 50 pass / 0 fail / 22 skipped**. Các test bị skip phụ thuộc PostgreSQL/runtime hoặc integration cụ thể; không được tính là bằng chứng E2E.
- Trong shell hiện tại không tìm thấy lệnh `docker`; vì vậy không chạy được Compose, migration v18/v19 hoặc smoke test qua runtime trong lượt này.

## Chưa hoàn tất / chưa được chứng minh

1. **Rút đội sau khóa roster:** chưa triển khai giao dịch/qui trình liên service để cập nhật nhánh playoff, lịch, xử thua và thông báo các đội bị ảnh hưởng. Vì vậy đang chặn phê duyệt rút sau khi khóa roster.
2. **Sửa kết quả đổi đội thắng playoff:** backend tiếp tục từ chối thay đổi đội thắng sau khi đội đã đi tiếp (`BRACKET_WINNER_CHANGE_BLOCKED`). Cần cơ chế mở lại nhánh có audit, khóa toàn bộ trận phụ thuộc và đồng bộ lịch qua service boundary/outbox trước khi cho phép.
3. **Khiếu nại và bỏ cuộc:** hạn nộp khiếu nại đã được kiểm tra; quyết định xử thua trước giờ bóng lăn có audit. Luồng kháng nghị vừa được triển khai trong source nhưng chưa chạy migration/DB E2E; thông báo kháng nghị chưa có outbox.
4. **Phân quyền:** đã có kiểm tra role/ownership ở các tuyến rủi ro cao theo báo cáo nghiệm thu trước, nhưng chưa tạo/chạy ma trận đầy đủ cho mọi route × role × resource owner trong lượt này.
5. **Backup/restore, SMTP và production:** chưa diễn tập backup/restore; chưa xác minh email vào hộp thư ngoài; chưa kiểm tra tải, giám sát/alert hoặc production.
6. **Database:** hai migration mới về withdrawal là additive và đã biên dịch, nhưng chưa áp dụng vào PostgreSQL trong lượt này. Không có dữ liệu/volume nào bị xóa.

## Khuyến nghị thứ tự triển khai tiếp

1. Khởi động Docker và chạy migration + test tích hợp trên database kiểm thử, xác minh retry và quyền rút đội.
2. Thiết kế saga/outbox cho sửa kết quả playoff và rút đội sau chốt; giữ blocker hiện tại đến khi có thể hoàn tất liên service an toàn.
3. Chạy migration kháng nghị trên DB kiểm thử, kiểm tra xuyên API, rồi nối giao nhận thông báo qua outbox.
4. Sinh route authorization matrix tự động từ Gateway/backend routes và bổ sung probe role × ownership.
5. Thực hiện backup/restore drill, thư SMTP tới inbox thử nghiệm được chỉ định và kiểm thử tải/quan sát trước production.

## Bổ sung trong lượt tiếp tục

- Tournament cung cấp cấu hình kỷ luật tối thiểu qua endpoint nội bộ `GET /internal/tournaments/:tournamentId/discipline-policy`, chỉ chấp nhận internal gateway key. Match gọi API này; không đọc trực tiếp database Tournament.
- Khi đội trưởng/BTC nộp khiếu nại cho trận đã `FINISHED`, `VERIFIED` hoặc `LOCKED`, Match kiểm tra `complaintWindowHours` theo thời điểm trận kết thúc/xác nhận. Trận đã xác nhận ưu tiên thời điểm `verifiedAt` của biên bản. Quá hạn trả `409 COMPLAINT_WINDOW_CLOSED`; không xác minh được điều lệ thì API lỗi đóng an toàn.
- Bổ sung test biên deadline: đúng thời điểm hết hạn vẫn nhận, sau thời điểm đó bị quá hạn; kiểm tra cửa sổ 0 giờ và dữ liệu ngày/giờ sai.
- Kiểm tra sau thay đổi: Match build, Tournament build và Match test **43 pass / 0 fail / 16 skipped**. Các test PostgreSQL vẫn bị skip; Docker/migration chưa chạy được trong shell.

Giới hạn: hạn khiếu nại hiện neo vào trạng thái/biên bản được lưu. Nếu giải cần mốc chính xác từ còi kết thúc, cần ghi nhận `finalWhistleAt` riêng từ giao diện trọng tài và duy trì mốc này qua mọi lần cập nhật trận. Luồng kháng nghị và walkover vẫn chưa được triển khai.

## Bổ sung xử lý đội bỏ cuộc — 16/11/2026

- BTC được xử thua trận chưa bắt đầu (trạng thái `SCHEDULED` hoặc `LINEUP_CONFIRMED`) qua `POST /matches/:matchId/forfeit`; chỉ đội thuộc trận mới được chọn là đội bỏ cuộc, cần lý do 10–2000 ký tự.
- Match lấy `forfeitPolicy` và tỷ số xử thua từ API chính sách nội bộ Tournament. `NO_AUTOMATIC_RESULT` bị từ chối; `WALKOVER` và `ORGANIZER_DECISION` áp dụng tỷ số đã cấu hình.
- Kết quả chính thức, chuyển trận sang `VERIFIED`, cập nhật bảng xếp hạng, tiến đội thắng playoff và bản ghi audit `match_forfeit_decisions` được ghi trong một transaction của Match DB. Quyết định lặp lại giống hệt từ cùng người được trả lại idempotently; quyết định khác bị xung đột.
- Bổ sung giao diện BTC cho trận chưa bắt đầu, yêu cầu nhập đội bỏ cuộc và căn cứ, xác nhận trước khi áp dụng. API kiểm tra quyền BTC được phân công ở backend.
- Bổ sung migration Match v12 (chỉ thêm bảng/index, không sửa migration cũ).
- Xác minh sau chỉnh sửa: Match build, Tournament build và Web Client typecheck **thành công**. Chưa thể áp dụng migration hoặc kiểm tra transaction trên PostgreSQL vì Docker CLI không khả dụng trong môi trường hiện tại.

Giới hạn: thông báo cho đội trưởng hai bên và đội ngũ trọng tài chưa được gửi; chưa có màn hình lịch sử quyết định xử thua sau khi BTC rời trang. `NO_AUTOMATIC_RESULT` vẫn cần quy trình ra quyết định riêng theo điều lệ, chưa hỗ trợ nhập quyết định tỷ số thủ công.

## Lịch sử xử thua và thông báo

- Endpoint BTC `GET /tournaments/:tournamentId/forfeit-decisions` trả lại audit các quyết định xử thua đã lưu; Gateway chuyển đúng service Match và yêu cầu session.
- Sau khi transaction kết quả thành công, Match tìm captain của hai đội qua Organization internal API và gửi thông báo trong ứng dụng qua Notification. Đây là gửi best-effort sau commit: nếu dịch vụ thông báo lỗi, kết quả không bị rollback; lỗi được ghi log. Chưa có outbox/retry đảm bảo giao nhận.
- Giao diện BTC hiện danh sách audit gồm giải, đội bị xử thua, tỷ số, căn cứ, thời điểm và người quyết định.
- Xác minh cuối lượt này: Match build **pass**, Gateway typecheck **pass**, Web Client typecheck **pass**, Match tests **43 pass / 0 fail / 16 skipped**. Docker migration v12 và E2E PostgreSQL chưa chạy.

## Kháng nghị khiếu nại — 16/11/2026

- Bổ sung migration Discipline version `1003` tạo `complaint_appeals`; dùng namespace version riêng để tránh đụng số với Match khi hai DB được cấu hình chung. Mỗi hồ sơ có tối đa một kháng nghị, quyết định/nhận xét và người/thời điểm xử lý được lưu độc lập.
- Đội trưởng thuộc đội khiếu nại có thể nộp kháng nghị trong khoảng thời gian bằng `complaintWindowHours` kể từ quyết định BTC. Chỉ người nộp hồ sơ ban đầu được gửi kháng nghị; backend kiểm tra vai trò, quyền đội, trạng thái đã quyết định, mốc thời gian và chống gửi trùng.
- BTC được phân công có hàng đợi, xem nội dung/chứng cứ và chấp thuận hoặc bác với lý do bắt buộc. Chấp thuận ghi snapshot quyết định cũ trong cùng transaction rồi mở lại hồ sơ khiếu nại ở trạng thái `UNDER_REVIEW`; kết quả thi đấu không tự đổi. Việc thay đổi tỷ số vẫn đi theo luồng yêu cầu đính chính riêng.
- Gateway yêu cầu session cho các endpoint kháng nghị; Match kiểm tra quyền sở hữu giải/đội. Đã thêm API và giao diện BTC xử lý hàng đợi kháng nghị cùng danh sách khiếu nại mở. Endpoint và hàm API để đội trưởng gửi/xem trạng thái kháng nghị đã có; form ở giao diện đội trưởng chưa được nối.
- Kiểm tra: Match tests **44 pass / 0 fail / 16 skipped**, Gateway typecheck **pass**, Web Client typecheck **pass**. Chưa chạy PostgreSQL migration hoặc E2E vì Docker CLI không có trong môi trường shell hiện tại.
