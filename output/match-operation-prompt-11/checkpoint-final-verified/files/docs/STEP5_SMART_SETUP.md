# Bước 5 – Lập lịch thi đấu chính thức

## Workspace và nguồn dữ liệu

Luồng BTC chính thức sử dụng nguyên workspace khôi phục từ checkpoint `788015c`: bốn công đoạn Sân & thời gian, Điều kiện thi đấu, Tạo & điều chỉnh lịch, Kiểm tra & công bố. `OfficialScheduleWorkspace` chỉ điều phối dữ liệu; `DrawDemoScheduleWorkspace` và các component con giữ giao diện, ba chế độ xem, form bên phải, trợ lý, công cụ in/PDF/CSV.

Tên kiểu dữ liệu `Demo*` được giữ để tương thích component và thuật toán dùng chung; trong luồng chính thức chúng là view model của API nghiệp vụ, không phải nguồn dữ liệu giả. Khởi tạo và lưu nghiệp vụ không đọc/ghi `drawTestStorage`, localStorage, snapshot test hoặc API engine/test. Mã test và môi trường khôi phục được giữ riêng.

Match Service lấy kết quả chia bảng công bố từ Tournament Service và fixture đã công bố trong database Match. Giải kết hợp cần đủ cả hai stage GROUP và KNOCKOUT. ID trận, nhánh, nguồn đội và quan hệ bảng được giữ nguyên. Điều lệ được ghim theo bản dùng sinh sơ đồ; client không được thay điều lệ authoritative.

## API chính thức

Tất cả đường dẫn dưới đây đi qua Gateway, JWT và kiểm tra quyền quản lý giải tại Match Service:

| API | Mục đích |
| --- | --- |
| GET `/api/tournaments/:id/schedules/context` | Fixture, điều lệ, nguồn lực, lịch, khóa, trạng thái công bố và chữ ký phiên bản thật |
| GET/PUT `/api/tournaments/:id/scheduling-resources` | Đọc/lưu cấu hình theo revision |
| POST `/api/venues`, PUT `/api/venues/:id` | Danh mục sân thật; chỉ sân BTC khai báo được gán vào giải |
| POST `/api/tournaments/:id/schedules/setup-analysis` | Phân tích thiết lập, công suất và đề xuất theo điều lệ |
| POST `/api/tournaments/:id/schedules/manual-candidates` | Ngày/giờ/sân hợp lệ cho trận chính thức |
| POST `/api/tournaments/:id/schedules/validate` | Kiểm tra toàn bộ hoặc trận đang điều chỉnh |
| POST `/api/tournaments/:id/schedules/resources/preview` | Ảnh hưởng khi sửa nguồn lực |
| POST `/api/tournaments/:id/schedules/automatic-preview` | Phương án từ thuật toán hiện có; chưa lưu lịch |
| PUT `/api/tournaments/:id/schedules/draft` | Lưu nguyên tử lịch nháp, ghi chú, khung giờ, khóa/mở khóa |
| POST `/api/tournaments/:id/schedules/publish` | Kiểm tra và công bố toàn bộ; gọi lại không công bố trùng |

Phương án chưa áp dụng và lựa chọn lọc có thể giữ trong React state. Hủy phương án không sửa lịch đã lưu. Thông báo thông thường không làm unmount workspace và mất preview.

## Lưu trữ và bảo vệ

Database `sfl_scheduling` lưu danh mục `venues`, cấu hình JSON nghiệp vụ `tournament_schedule_resources`, lịch `schedules` và `schedule_change_history`. Cấu hình mới dùng revision `null`; lần cập nhật sau dùng revision hiện tại. Lịch nháp dùng `baseSignature` để chặn ghi đè phiên khác.

Migration bổ sung 1008 thêm `schedules.notes` và `schedules.slot_id`, có default tương thích dữ liệu cũ. Không chỉnh migration đã áp dụng. Backup toàn bộ PostgreSQL đã tạo trước migration; không reset database hoặc volume.

Khóa lịch và công bố là hai trạng thái độc lập. Trận khóa không được đổi ngày/giờ/sân trong cùng yêu cầu mở khóa. Lịch đã công bố không được chạy lại tự động hoặc đổi nguồn lực qua workspace này. Không bắt buộc khóa mọi trận hoặc có trọng tài trước công bố.

Backend kiểm tra sân/đội trùng, thời gian nghỉ, khoảng ngày, giờ khả dụng, thời lượng, blackout, thứ tự lượt/vòng và trận nguồn knockout/vòng bảng. Hai lượt được sắp theo lượt rồi vòng; quy định đồng giờ vòng cuối chỉ áp dụng vòng cuối của lượt cuối. Giờ nghiệp vụ Việt Nam được chuẩn hóa trước khi lưu timestamptz để tránh lệch khi Docker chạy UTC.

Lưu nháp và công bố dùng transaction trong database lập lịch. Metadata trận trong `sfl_match` được cập nhật bằng transaction riêng với bù trừ khi có lỗi thông thường. Đây không phải distributed two-phase commit; không khẳng định an toàn tuyệt đối khi tiến trình bị tắt giữa hai commit. Thông báo trong ứng dụng được gửi sau commit; lỗi thông báo không đảo ngược công bố và không gọi SMTP.

## Phạm vi và kết quả kiểm thử

Xem [báo cáo và ảnh thực tế](./step5-official-qa-20261125/README.md). Build hoặc healthcheck không được coi là E2E PASS. Các bài kiểm thử PostgreSQL ghi dữ liệu chỉ chạy trong hai database QA riêng có guard tên; các thao tác giao diện ghi dữ liệu chỉ dùng giải DEMO IUH dành cho kiểm thử. Không thay đổi môi trường khôi phục hoặc thiết kế Bước 6.

Planner có giới hạn thời gian và số nút tìm kiếm. TIMEOUT/PARTIAL phải hiển thị đúng số trận và lý do, không được báo đã xếp đủ. Việc thu hẹp giờ khả dụng thực tế hoặc đổi thứ tự mục tiêu không được nới các ràng buộc điều lệ.

## Quy tắc phân định và kiểm thử hai thể thức (25/11/2026)

Công đoạn 2 và API nguồn lực kế thừa phương thức phân định từ điều lệ đã công bố:

- Vòng bảng/vòng tròn: dự phòng hiệp phụ và luân lưu bằng 0, không cộng vào thời lượng trận.
- `PENALTIES_ONLY`: dự phòng hiệp phụ bằng 0, không hiển thị ô nhập hiệp phụ. Không lấy `extraTimeMinutes` cũ nếu phương thức không áp dụng hiệp phụ.
- `EXTRA_TIME_THEN_PENALTIES`: kế thừa thời lượng hiệp phụ hợp lệ từ điều lệ. Nếu điều lệ thực sự thiếu thời lượng, báo lỗi điều lệ; không tự đặt 20 phút hoặc bắt BTC sửa mâu thuẫn ở form lập lịch.
- Giá trị 0 hợp lệ của dự phòng hoặc thời gian di chuyển không bị thay bằng đề xuất chưa xác nhận khi tải lại.

API chuẩn hóa các khoản dự phòng xác định được từ điều lệ trước validation. Các sai lệch thật về thời lượng hiệp, nghỉ tối thiểu, sân, thời gian và xung đột vẫn bị chặn. Profile của giai đoạn có lịch khóa hoặc công bố được bảo toàn; không âm thầm thay thời lượng lịch đã chốt.

[Kiểm thử thực tế và ảnh hai giải](./step5-decision-qa-20261125/report.html): knockout đã lưu/công bố 15 trận; kết hợp đã lưu đủ 31 trận và xác minh trạng thái công bố từ phiên khác. Kết hợp cần 9 lượt tạo/lưu với bộ lọc hiện có do giới hạn tìm kiếm 15 giây; không coi TIMEOUT là không khả thi hoặc báo đã xếp đủ khi còn thiếu. Kiểm tra độc lập không phát hiện xung đột sân, đội tiềm năng hoặc trận nguồn; nghỉ tối thiểu 1440 phút. Không thay thuật toán, API paths, schema, dữ liệu điều lệ hoặc môi trường khôi phục trong lượt sửa này.

## Tăng thời gian tìm kiếm, chặn công bố thiếu trận và tải PDF (25/11/2026)

Giới hạn lập lịch tự động hiện thống nhất 120.000 ms giữa frontend, parser API và shared planner. Cấu hình frontend cũ 15 giây được nâng theo giới hạn ứng dụng khi đọc, giữ nguyên phạm vi và thứ tự ưu tiên BTC. Nginx chỉ tăng `proxy_read_timeout`/`proxy_send_timeout` lên 150 giây cho route chính thức `/api/tournaments/:id/schedules/automatic-preview`; các route khác giữ nguyên.

Thuật toán tìm một phương án đủ trận hợp lệ trước khi tối ưu theo thứ tự ưu tiên hiện có. Các thời điểm chắc chắn vi phạm trận nguồn, điều kiện đi tiếp, thời gian nghỉ hoặc thứ tự lượt/vòng được loại trước khi dò từng phút. Chỉ nhánh chọn một đại diện mỗi bucket dừng sau phương án hợp lệ đầu tiên; nhánh tối ưu vẫn giữ chính sách đại diện hiện có. Một phương án đủ số trận chỉ được giữ sau kiểm tra toàn bộ ràng buộc; tối ưu không được ghi đè phương án hoàn chỉnh bằng phương án chưa hợp lệ. Tác vụ có nhường xử lý để nhận hủy và vẫn giữ lịch khóa/công bố, lịch ngoài phạm vi. Việc hết giới hạn không đồng nghĩa không còn tài nguyên hoặc cấu hình bất khả thi.

Công bố kiểm tra toàn bộ ID trận bắt buộc từ sơ đồ chính thức và các hàng lịch đã lưu trong database, kể cả lúc người dùng lọc một phần danh sách. BYE cấu trúc được loại trừ, còn trận knockout chưa xác định đội vẫn bắt buộc có lịch. Lịch rỗng/thiếu, ngày/sân/thời lượng chưa hợp lệ hoặc hàng lịch trùng đang hoạt động bị chặn; kiểm tra lại trong transaction. Trạng thái đã công bố được suy từ đúng tập ID, không chỉ so số hàng. Không buộc khóa tất cả trận hoặc phân công trọng tài. Lưu nháp từng phần vẫn được phép.

Nút **Xuất PDF** hiện tải file PDF thật từ các dòng đang xem, tách khỏi **In lịch**. PDF A4 ngang dùng canvas 300 DPI, có tiếng Việt, xuống dòng đầy đủ, lặp tiêu đề và phân trang. Không cần dependency hoặc API mới. Đây là PDF dạng ảnh nên không tìm kiếm/copy văn bản; CSV UTF-8 vẫn giữ dữ liệu văn bản. Nếu tạo file thất bại, hiển thị lỗi; không giả lập thành công hoặc tự chuyển về hộp thoại in.

[Báo cáo kiểm chứng](./step5-runtime-pdf-qa-20261125/report.html): typecheck/build toàn bộ PASS, 65 kiểm thử thuần và 2 kiểm thử PostgreSQL cô lập PASS; engine của image Docker mới tạo đủ 31 trận trong một lần chạy trong RAM bằng dữ liệu API thật. Nút tải PDF thực tế trên Docker đã kiểm tra hai file 15/31 trận và xem mọi trang bằng Chrome. Không ghi lại lịch đã công bố để thử thuật toán; vì cả ba giải demo đều đã công bố, luồng HTTP tạo/lưu mới trên một giải chưa công bố là NOT TESTED trong lượt này. Không reset database, volume hoặc thay đổi môi trường khôi phục.
