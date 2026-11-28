# Giai đoạn 8 – Hoàn tất lịch, kiểm tra và công bố

## Phạm vi hiện thực

- Thao tác công bố lịch của luồng kiểm thử Bước 5 chuyển sang endpoint Match Service có xác thực vai trò BTC, kiểm tra sơ đồ Bước 4 hiện hành, revision snapshot, fixture cần thi đấu, thiết lập, ràng buộc lịch và cảnh báo trước khi ghi.
- Ghi bản công bố trong một lần cập nhật snapshot có compare-and-swap. Lần gọi lặp trên cùng sơ đồ trả trạng thái đã công bố; xung đột phiên bản không ghi đè lịch mới hơn.
- Không cho endpoint lưu trạng thái thông thường tự tạo dấu công bố. Dữ liệu công bố không chứa phân công trọng tài. Thành công đặt vị trí quy trình Bước 6 và trả hợp đồng fixture, nguồn đội, thời gian, sân/địa điểm và khoảng chiếm dụng.
- Endpoint công khai chỉ phát hành fixture đã công bố và whitelist ngày giờ, sân, thời lượng; không phát hành lịch nháp, phương án giả lập, ghi chú nội bộ hay trạng thái xác thực.
- Khu vực Hoàn tất tổng hợp số trận, đã lưu, đã khóa, đang giả lập, còn thiếu, lỗi và cảnh báo; các lỗi được nhóm theo mã kiểm tra để tránh lặp danh sách cùng nguyên nhân. Modal xác nhận nêu phiên bản, khoảng thời gian, sân và cảnh báo.
- Trang chi tiết giải đấu trong môi trường kiểm thử ghép lịch đã công bố từ Match Service vào sơ đồ Bước 4 đang có.

## Giới hạn đã biết

- Đây vẫn là luồng dữ liệu thử nghiệm được lưu trong `match_schedule_test_snapshots`; không ghi lịch chính thức vào bảng `schedules` dùng cho trận thật, không tạo bảng công bố mới, không thay đổi dữ liệu giải/đội.
- Chưa có endpoint điều chỉnh phiên bản lịch chính thức, thông báo người liên quan, đánh dấu lại phân công trọng tài, cũng chưa thay đổi điều lệ hoặc lịch đã có kết quả.
- Báo cáo vấn đề dựa trên validator lịch dùng chung và mã nguyên nhân hiện có; chưa sinh kế hoạch tối ưu đối chiếu nhiều kịch bản hoặc tính toán ảnh hưởng dây chuyền mới.
- Hợp đồng bàn giao Bước 6 được trả từ giao dịch công bố và trạng thái Bước 6 được đặt trong snapshot thử nghiệm; chưa mở rộng nghiệp vụ phân công trọng tài.
- Kiểm tra giao diện công khai cần phiên đăng nhập/dữ liệu thử nghiệm đã công bố. Build/typecheck không thay cho nghiệm thu người dùng.

## Xác minh

- Match Service và web client typecheck/build: đạt.
- Match Service tests: 79 đạt, 22 bỏ qua do cần DB integration, 2 lỗi trong scheduling engine (`minute-precise scan...` và cảnh báo cutoff tìm kiếm). Chưa xác nhận hai lỗi này có từ trước vì không chạy baseline sạch.
- Docker `docker compose --profile apps up --build -d`: hoàn tất; postgres, redis, gateway và năm backend service healthy, web client đang chạy cổng 5173. Các migration jobs chạy lại theo cấu hình compose; không có reset database/volume hoặc dữ liệu đội.
- Chưa chụp ảnh màn hình nghiệm thu: trang hiện đang đăng xuất, báo 401 ở request yêu cầu xác thực và không có giải đấu hiển thị. Cần phiên BTC cùng giải kiểm thử có sơ đồ Bước 4 để chụp trung tâm vấn đề, modal công bố, trang công khai và hợp đồng Bước 6.
