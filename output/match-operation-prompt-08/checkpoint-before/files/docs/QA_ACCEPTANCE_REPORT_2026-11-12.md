# Báo cáo kiểm chứng hệ thống SFTMS (12/11/2026)

## Phạm vi lượt kiểm tra

Đây là kiểm tra kỹ thuật và smoke test trên stack Docker/database đang chạy. Không reset database, không xóa volume, không thay đổi SMTP, không tạo email mời mới và không thay đổi hồ sơ/giải demo đang có.

## Kết quả đạt

| Hạng mục | Kết quả |
|---|---|
| Docker runtime | PostgreSQL, Redis, API Gateway, Web Client và cả năm backend service đang chạy; PostgreSQL/Redis/backend/Gateway báo `healthy`. |
| Health endpoint | Web `5173`, Gateway `8080`, Auth `3001`, Tournament `3003`, Organization `3004`, Match `3005`, Notification `3006` đều trả HTTP 200. |
| Đăng nhập và dashboard theo role | ADMIN, BTC, TEAM_CAPTAIN, PLAYER, REFEREE, VIEWER: 6/6 đăng nhập HTTP 200 và endpoint dashboard tương ứng HTTP 200. |
| Kiểm tra RBAC âm | VIEWER gọi `/api/users` nhận HTTP 403. |
| Unit test Tournament | 7/7 đạt: thời hạn đăng ký theo ngày/múi giờ và điều kiện khóa roster cấp đội. |
| Organization integration trên PostgreSQL `sfl_team` | 5/5 đạt: quyền phản hồi lời mời, snapshot roster chỉ nhận cầu thủ đã đồng ý, gửi lại hồ sơ, MSSV trùng, quyết định BTC đồng thời và retry outbox. Fixture ngẫu nhiên được dọn trong `finally`. |
| Match test trên PostgreSQL | 22/22 đạt: số trận vòng tròn cho 5, 6, 7, 8, 10, 12, 16 đội; đội hình tổ trọng tài; cạnh tranh đặt cùng sân và thời gian nghỉ. Fixture lịch được dọn bằng transaction. |
| Typecheck | Tất cả 8 workspace package/service đã chạy riêng và đạt. |
| Build | Tất cả 8 workspace package/service đã build riêng và đạt; Web production build thành công. |

Các test chỉ chạy tuần tự theo đúng package; không dùng kết quả test unit thay cho nghiệm thu toàn nghiệp vụ.

## Giới hạn chưa nghiệm thu

- Chưa chạy một giải mới từ tạo giải đến kết thúc qua giao diện/API. Dữ liệu hiện có có giải demo `IN_PROGRESS`; các lời mời cầu thủ của fixture đang ở trạng thái `ACCEPTED`. Dùng lại các bản ghi đó để giả lập lại luồng sẽ làm thay đổi dữ liệu đang được giữ.
- Không gửi lời mời mới trong lượt này vì cấu hình bắt buộc dùng SMTP thật; gửi có thể phát thư ra ngoài. Chưa kiểm tra giao nhận email vào mailbox nhận thật.
- Chưa nghiệm thu qua trình duyệt các thao tác kéo thả chia bảng, công bố lịch, phân công trọng tài, gửi biên bản và cập nhật bảng xếp hạng xuyên service.
- Các test hiện có chưa bao phủ đầy đủ bracket loại trực tiếp/kết hợp, BYE, đội rút lui, sửa kết quả đã kéo theo nhánh, khiếu nại, khôi phục backup, tải đồng thời và kiểm thử hiệu năng.
- Lệnh tổng `pnpm run typecheck` / `pnpm run build` lỗi do script workspace gọi `pnpm` không có trong PATH của tiến trình con trên Windows. Chạy trực tiếp từng package bằng Corepack đã thành công; nguyên nhân môi trường script chưa được sửa trong lượt này.

## Kết luận

Stack và các thành phần đã kiểm tra đang hoạt động; luồng lời mời/đăng ký cấp service có kiểm thử PostgreSQL đạt. Đây chưa phải nghiệm thu end-to-end của một giải thực tế và chưa đủ bằng chứng để gọi hệ thống sẵn sàng thương mại. Cần một giải và đội fixture tách biệt, cùng mailbox thử nghiệm được chỉ định, để hoàn thành luồng gửi email và vận hành xuyên giao diện mà không tác động dữ liệu demo hiện tại.
