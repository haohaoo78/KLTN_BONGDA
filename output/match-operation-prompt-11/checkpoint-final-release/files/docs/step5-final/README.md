# Bước 5 – Báo cáo nghiệm thu và cải thiện Prompt 9A

Ngày kiểm tra: 23/11/2026. Backend/Gateway development đang chạy sẵn; browser kiểm tra phiên bản source mới qua Vite `localhost:5175`. Trang `localhost:5173` đang mở là runtime trước lần sửa cuối.

> Đây là báo cáo nghiệm thu có giới hạn bằng chứng. Các trạng thái `NOT TESTED` không được suy ra thành PASS từ source, build hoặc healthcheck. Không reset DB/volume, SMTP, đội đã chốt hoặc snapshot lịch trong lượt kiểm tra này.

## Kết quả nhanh

- Đã chỉnh giao diện theo 5 công đoạn; Công đoạn 1 có danh mục sân và thời gian trực tiếp, Công đoạn 2 hiển thị thông số cơ bản cùng phân tích nguồn lực hai cột. Bố cục Công đoạn 2 được sửa sau khi xem ảnh thật vì CSS cũ còn ép nội dung vào cột menu 230px.
- Đã kiểm tra giao diện mới trên `localhost:5175` trong phiên BTC cho giải `95f79e55-e6f0-5177-a2e2-d9fe62760dcd`; runtime có 12 fixture vòng tròn, 8 đội, 2 sân gốc chưa xác nhận và 1 sân QA được tạo riêng trong snapshot development.
- Phân tích backend thật trả về 12 trận, nhu cầu sơ bộ 17.6 giờ sân, 0 sân phù hợp được xác nhận và 0 giờ sân lý thuyết. Công bố/lập lịch bị chặn do nguồn lực và đề xuất chưa xác nhận.
- Typecheck `@sfl/web-client` và production build Vite đạt; build cảnh báo bundle JavaScript khoảng 1.19 MB. Docker rebuild sau lần sửa cuối chưa chạy được vì lệnh `docker` không có trong PATH; bản Vite từ source đang chạy để BTC xem tại `http://localhost:5175/?manageTournament=95f79e55-e6f0-5177-a2e2-d9fe62760dcd`.
- Ảnh giao diện thật: [Công đoạn 1 mới](./screenshots/prompt9a-final-stage1.png), [Công đoạn 2 mới](./screenshots/prompt9a-final-stage2.png), [danh sách sân không còn tràn](./screenshots/prompt9a-venue-list-no-overflow.png), [modal thêm sân](./screenshots/prompt9a-add-venue-modal.png), [Công đoạn 1 sau thử lưu](./screenshots/prompt9a-stage1-persistence-test.png). Đã kiểm chứng snapshot save revision 2→3, preset v0→v1, tạo sân QA và áp dụng hai khoảng giờ hàng loạt riêng cho sân QA (revision 4), chỉnh sửa tên và lưu (revision 5), rồi reload xác nhận dữ liệu còn trong snapshot. Sân QA được giữ trong snapshot development để BTC xem lại; hai sân gốc không đổi. Không sinh lịch, khóa hoặc công bố.
- Kiểm tra bổ sung: chỉnh hai trường chưa lưu ở công đoạn 1/2, chuyển qua lại và qua công đoạn 3 rồi quay về; mọi giá trị tạm vẫn còn. Sau reload, các giá trị chưa lưu trở về dữ liệu backend đã lưu, trong khi venue QA vẫn tồn tại. Không phát sinh mutation backend trong phép thử này.
- Báo cáo này không tuyên bố đạt toàn bộ Giai đoạn 9 hoặc các ca nghiệp vụ chưa chạy.

## Tài liệu

- [Kiến trúc và API](./architecture-and-api.md)
- [Ma trận ràng buộc](./constraint-matrix.md)
- [Danh sách chức năng và giao diện](./functions-and-ui.md)
- [Test case và kết quả](./test-results.md)
- [Vấn đề đã sửa và còn tồn tại](./issues.md)
- [Hợp đồng dữ liệu bàn giao Bước 6](./step6-handoff-contract.md)
- [Ảnh chụp thực tế](./screenshots/)
- [Thiết kế lại UI/UX Prompt 9](./prompt9-ui-ux-redesign.md)
- [Đối chiếu bảo toàn nghiệp vụ Prompt 9A](./prompt9a-function-retention.md)

## Tài liệu đầu vào chưa có trong workspace

`docs/Usecase_da_chinh_sua_v2.md`, tài liệu audit và báo cáo Prompt 7–8 hiện có đã được đọc. Workspace không lưu SRS riêng và không có đầy đủ nguyên văn kết quả Prompt 1–6; báo cáo Giai đoạn 7 cũng ghi rõ các prompt đầu không được version-control. Vì vậy việc đối chiếu những tài liệu thiếu không thể được tuyên bố hoàn tất.

## Cập nhật giao diện Prompt 9B (23/11/2026)

Giao diện năm công đoạn đã được rút gọn theo yêu cầu mới; kết quả kiểm tra typecheck/build và browser smoke, cùng các ca nghiệp vụ chưa chạy, được ghi tại [test-results.md](./test-results.md). Chưa tạo lịch, reset snapshot hoặc công bố trong lượt này. Workspace không có tài liệu SRS riêng.
