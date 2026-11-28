# Ma trận ràng buộc lập lịch

`Code` nghĩa là thấy được implement trong source/tài liệu. `Runtime` nghĩa là thực sự gọi API/UI trong lượt nghiệm thu. Chỉ cột Runtime mới là bằng chứng chạy thực tế.

| Ràng buộc | Manual | Automatic | Đổi nguồn lực | Khóa | Công bố | Runtime GĐ9 |
|---|---|---|---|---|---|---|
| Trong khoảng ngày giải, ngày khả dụng | Code | Code | Code | Code | Code | NOT TESTED |
| Ngày trong tuần, khung giờ | Code | Code | Code | Code | Code | API validate phát hiện cấu hình thiếu; chưa thử candidate |
| Sân active, đúng loại sân | Code | Code | Code | Code | Code | NOT TESTED bằng cấu hình nguồn lực đầy đủ |
| Blackout và khoảng chiếm dụng sân | Code | Code | Code | Code | Code | NOT TESTED |
| Hai trận trùng sân | Code | Code | Code | Code | Code | NOT TESTED |
| Xung đột đội / đội tiềm năng | Code | Code | Code | Code | Code | NOT TESTED |
| Nghỉ tối thiểu, travel buffer | Code | Code | Code | Code | Code | NOT TESTED |
| Số trận tối đa mỗi đội/ngày | Code | Code | Code | Code | Code | NOT TESTED |
| Trận nguồn trước trận phụ thuộc | Code | Code | Code | Code | Code | Quan sát được source thắng ở UI; chưa tạo lịch để thử validator |
| BYE bị loại khỏi fixture cần xếp | Code | Code | n/a | n/a | Code | Không có BYE ở snapshot KO 8 đội; NOT TESTED |
| Cụm đồng giờ bắt buộc | Code | Code | Code | Code | Code | NOT TESTED |
| Version sơ đồ/snapshot và CAS | Code | Code | Code | Code | Code | Đọc version; race/stale write NOT TESTED |
| Bảo toàn lịch khóa/chính thức khi chạy lại | Code | Code | Code | Code | Code | NOT TESTED |
| Warnings và mục tiêu chất lượng | Code | Code | Code | Code | Code | 0 warning ở state rỗng; không đại diện ca warning |

## Use Case được đối chiếu

Use Case mục 6 yêu cầu kiểm tra trùng sân/đội/trọng tài, không chồng thời gian kể cả overlap một phần, nghỉ tối thiểu mặc định 30 phút (BTC có thể tăng, không giảm), ghi lý do và thông báo khi chỉnh sau công bố, và chỉ công bố khi kiểm tra bắt buộc đạt. Code audit Step 5 mô tả nghỉ mặc định của snapshot seed có thể khác (24 giờ) nên phải lấy giá trị từ điều lệ/thiết lập giải cụ thể; không coi default fixture là quy tắc hệ thống thống nhất.

Nguồn: [Use Case mục 6](../Usecase_da_chinh_sua_v2.md), [audit scheduling logic](../step5-audit/03_SCHEDULING_LOGIC.md), [kiến trúc test data](../TEST_DATA_ARCHITECTURE.md).

## Mapping giao diện Prompt 9A và trạng thái runtime

Giao diện mới chỉ thay vị trí hiển thị: Công đoạn 1 tập trung nguồn lực và khả dụng sân; Công đoạn 2 gom thông số cơ bản, còn ràng buộc thể thức/objectives/capacity chuyên sâu trong disclosure “Thiết lập nâng cao”. Toàn bộ mapping chức năng trước/sau nằm trong [prompt9a-function-retention.md](./prompt9a-function-retention.md).

| Miền ràng buộc | Mapping mới | Runtime Prompt 9A |
|---|---|---|
| Fixture/version/đội/BYE/nguồn phụ thuộc từ Bước 4 | Không chỉnh; validator tiếp tục dùng snapshot Bước 4 | PASS quan sát 12 fixture vòng tròn/8 đội; KO, mixed, BYE chưa chạy |
| Ngày, thứ, giờ, sân, blackout, khoảng chiếm dụng | Công đoạn 1 trình bày khả dụng; Công đoạn 2 trình bày thời lượng | PASS UI; 2 sân hiện hữu chưa xác nhận nên capacity vẫn 0 |
| Rest, travel, max per day, max rounds, simultaneity | Cơ bản ở Công đoạn 2; phần chuyên sâu giữ trong advanced | PASS quan sát giá trị cơ bản và nguồn; chưa lưu/validate lịch |
| Hard constraints, source provenance, soft objectives | Điều lệ/đề xuất/BTC phân biệt ở controls; advanced vẫn giữ objectives | PASS quan sát điều lệ 60 phút/hiệp tổng và fields đề xuất; chưa bấm xác nhận |
| Shared manual/automatic validator, dependency cluster, partial solution | Không đổi UI/back-end nghiệp vụ của công đoạn 3–5 | NOT TESTED |
| Simulation/customize/delete/check/lock/version/publication | Không đổi API hoặc trạng thái | NOT TESTED |
| Persistence DB/preset/refresh | Công đoạn 1 dùng cùng Match Service routes | PASS trong development snapshot: save 2→3, add+bulk QA 3→4, edit QA 4→5, preset v0→v1; GET/reload xác nhận. CRUD bảng `/venues` chính thức và config edit NOT TESTED |
| Draft UI khi chuyển bước | Công đoạn 1/2 dùng cùng setup editor; shell giữ editor mounted khi chuyển stage | PASS browser: thay tạm 10→11 phút và 08:00→08:30 giữ nguyên qua stage 1↔2, 1→3→1; sau reload state tạm mất, dữ liệu đã lưu khôi phục |

Phân tích read-only thật qua giao diện trả 12 trận, nhu cầu 17.6 giờ sân, 0 sân xác nhận, 0 giờ lý thuyết. Không đánh giá solver khả thi khi chưa khai báo/ xác nhận nguồn lực. Build/typecheck không được tính là test nghiệp vụ.
