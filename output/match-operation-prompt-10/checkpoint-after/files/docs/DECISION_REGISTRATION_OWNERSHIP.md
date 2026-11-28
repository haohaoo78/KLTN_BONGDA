# Quyết định kiến trúc: ownership đăng ký giải và roster

Ngày: 16/11/2026  
Trạng thái: Chấp nhận cho kiến trúc chuyển tiếp; chưa thực hiện data migration.

## Quyết định

Giữ dữ liệu `team_registrations`, `rosters` và lời mời cầu thủ tại Organization Service trong giai đoạn hiện tại. Organization sở hữu quan hệ thành viên đội và hồ sơ đăng ký/roster; Tournament là nguồn có thẩm quyền cho cấu hình giải, cửa sổ đăng ký, eligibility, hạn mức, reservation và trạng thái khóa. Hai miền trao đổi qua API nội bộ có xác thực; không đọc chéo database.

Không chuyển dữ liệu vật lý ngay. Các database đang hoạt động có hồ sơ và ID được tham chiếu từ Match/Tournament; chuyển service trong cùng đợt xử lý nghiệp vụ sẽ tạo rủi ro duplicate, mất audit hoặc không nhất quán hai database.

## Vì sao

- Roster được chọn từ thành viên do Organization quản lý; quyền captain/member cũng được xác minh ở Organization.
- Tournament đã có reservation và kiểm tra kỳ đăng ký/giới hạn nhưng chưa là owner của application snapshot, invitation và history.
- Thay đổi ownership cần hợp đồng API mới, outbox/idempotency, backfill có đối soát, cutover, rollback và chạy song song có giới hạn. Chưa có bằng chứng vận hành để thực hiện an toàn.

## Hướng đích

Nếu chuyển ownership, thực hiện như dự án migration riêng: thiết kế schema/application API trong Tournament; tạo bản sao backfill theo ID ổn định; đối soát count, roster snapshot, trường, quyết định và version history; chạy dual-write qua outbox; so sánh read results; chuyển traffic; giữ Organization read-only đủ thời gian rollback. Chỉ xóa cấu trúc cũ sau backup/restore drill và nghiệm thu.

Trong thời gian chuyển tiếp, tài liệu kiến trúc phải mô tả đúng rằng registration/roster còn thuộc Organization. Đây là quyết định có chủ ý để bảo toàn dữ liệu, không phải khẳng định mục tiêu ownership đã được hoàn thành.

## Hệ quả

- Tất cả quyết định roster và đăng ký phải đi qua Organization API; Tournament chỉ được gọi qua hợp đồng API reservation/eligibility.
- Không thêm database access từ Tournament sang `sfl_team`.
- Việc từ chối một registration mutation nếu Tournament không thể xác minh quyền/eligibility là hành vi an toàn.
- Chưa hoàn thành yêu cầu mục tiêu “Tournament sở hữu registration/roster”; quyết định này hoãn việc chuyển dữ liệu cho tới khi có migration plan và backup/restore evidence.
