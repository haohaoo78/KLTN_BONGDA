# Prompt 10 — Quản lý trận, ngoại lệ và kết thúc giải

Ngày 28/11/2026. Phạm vi: tích hợp Bước 7–8 vào workspace BTC hiện hữu; không thiết kế lại Bước 1–6, không kết thúc giải demo đang chạy, không đổi điều lệ đã công bố.

## Đã triển khai

- Thêm [MatchAdministrationWorkspace](../apps/web-client/src/components/MatchAdministrationWorkspace.tsx) vào Bước 7: thống kê, lọc, danh sách trận có tên đội, detail tabs, roster/diễn biến/tổ trọng tài/biên bản/sự cố/lịch sử. BTC xem tiến trình nhưng không có công cụ thao tác chuyên môn.
- Thêm các API summary/manage/detail/incident/decision và các API Tournament start/complete; Gateway giữ xác thực session, service kiểm tra quyền BTC theo giải hoặc REFEREE được phân công có `RECORD_EVENT`.
- Hồ sơ sự cố và quyết định có version, idempotency, lý do/căn cứ, snapshot trước/sau, lịch sử append-only. Quyết định chỉ hiện/được lưu khi điều lệ có policy tương ứng; thiếu căn cứ vẫn cho lưu hồ sơ, không tự áp xử thua/hủy/hoãn/công nhận.
- Hoãn/tạm dừng ghi clock trong Match transaction. Durable Outbox đồng bộ hold state tới Scheduling và tạo notification in-app idempotent; hủy vô hiệu công bố tổ trọng tài. Tiếp tục giữ dữ liệu clock và lấy lease Scheduling trước Match; chỉ CONTINUE được phép đi qua trạng thái hold để giải phóng.
- Sửa nguồn điều lệ ở Tournament start/complete: quy tắc được đọc từ Tournament repository sở hữu, không gọi nhầm Match Service. Start/complete bị chặn nếu phiên bản điều lệ chưa công bố `BTC_CONFIRM`.
- Bước 8 hiển thị blocker, tiến độ, BXH, nhà vô địch và hồ sơ mở. Chỉ kết quả APPROVED/decision hợp lệ/BYE được coi là đã giải quyết. Completion dùng fence bền vững ở Match và Discipline qua các transaction riêng, không giả transaction xuyên database.
- Deadline khiếu nại/kháng nghị lấy riêng từ policy đã công bố và snapshot bất biến. Thiếu anchor/window thì từ chối tạo hồ sơ liên quan; không lấy `updated_at`, không mặc định 24 giờ hay lấy hạn khiếu nại làm hạn kháng nghị.

## Migration và an toàn dữ liệu

- [Match migration](../services/match-service/src/db/matchAdministrationMigration.ts): version 30, thêm case/decision/outbox/replay và completion fence.
- Cùng migration module: Scheduling 1014 thêm operation state/revision; Discipline 1005 thêm deadline snapshot, review history và completion fence.
- Migration additive, transactional, idempotent; không sửa migration cũ, không xóa/backfill nghiệp vụ. [Backup trước P10](../backups/match-operation-prompt-10-20261128-001/manifest.json) gồm Match, Scheduling, Discipline, Tournament, Team; archive có SHA-256 và được kiểm tra đọc.
- QA chỉ ghi vào database clone từ backup. [QA lượt 011](../output/match-operation-prompt-10/qa-api-011.json) xác nhận năm database chính thức không thay đổi trong suốt các test API.

## Kết quả kiểm thử

| Hạng mục | Kết quả |
|---|---|
| Typecheck toàn workspace | PASS |
| Production build toàn workspace | PASS; Vite cảnh báo bundle JavaScript lớn hơn 500 kB, không làm fail build |
| Match tests | PASS: 274, SKIP: 34 (các test opt-in yêu cầu DB), FAIL: 0 |
| Tournament tests | PASS: 44, SKIP: 20 (DB opt-in), FAIL: 0 |
| Frontend referee regression | PASS: 39/39 |
| QA API/PostgreSQL | PASS: 21 nhóm; gồm API auth, ownership, locale đội, blocker policy, hoãn→Outbox→tiếp tục, clock/schedule, complaint deadline và xác nhận database chính thức giữ nguyên |
| Docker Compose config | PASS |
| Docker build/deploy chính thức | PASS; toàn bộ compose profile apps chạy lại, không xóa volume |
| Health/runtime | PASS: 9 containers running, 8 healthchecks healthy; web-client không khai báo healthcheck riêng |
| Migrations | PASS: Match 30, Scheduling 1014, Discipline 1005 đã có trong ledger |
| Image/source/frontend | PASS: 9 compiled file hashes và 2 asset HTTP hashes khớp build context; ports 5173/8080/3001–3006 đúng |
| Browser `/btc` | NOT TESTED về màn hình quản trị: phiên browser hiện có tài khoản `REFEREE · TEAM_CAPTAIN · VIEWER`, không có BTC. Trang tải bundle chính thức; manager UI chưa được bấm qua session BTC trên browser này. |

QA phủ một lượt schedule công bố và một tài khoản không thuộc tổ; không chứng minh mọi tổ hợp capability, tất cả trạng thái tranh chấp hay notification tới người dùng thật. Notification endpoint không hoạt động trong QA; job được kiểm tra idempotency/state và không gửi email. Không chạy mutation trên các giải demo chính thức.

Runtime [proof](../output/match-operation-prompt-10/runtime-verification-final.json) so sánh DB trước triển khai với hiện trạng: Match/Scheduling/Discipline chỉ đổi migration ledger như dự kiến. Hai bảng Tournament `tournament_player_participation_claims` và `tournament_registration_reservations` đổi digest nhưng giữ 678/40 dòng; đây là reconciliation nền có sẵn khi service khởi động, đã quan sát cùng cơ chế ở Prompt 9, không phải migration hay reset. Cổng web đang phục vụ bundle mới tại `http://localhost:5173`.

## Giới hạn chưa nghiệm thu

- Chưa fault-injection toàn bộ các điểm giữa hai completion fence và trạng thái Tournament; retry/lock đã có kiểm thử logic nhưng không chứng minh mọi sự cố phân tán.
- Chưa kiểm thử end-to-end quyết định xử thua/hủy/đá lại theo điều lệ riêng đã công bố của các giải đang chạy. Các policy thiếu tiếp tục chặn quyết định; không sửa điều lệ demo để làm test xanh.
- Chưa xác minh notification delivery đến người dùng thật, email không thuộc phạm vi; chưa kiểm thử đa client thật cùng lúc hoặc quy trình khiếu nại/kháng nghị hoàn chỉnh đến kết quả.
- Không có đủ căn cứ để đặt timeout đội đến muộn, tỷ số xử thua, thời hạn khiếu nại, mức treo giò hoặc quyết định kết thúc tự động. BTC phải công bố policy phiên bản hợp lệ trước khi các chức năng phụ thuộc được phép.
- Bước 7/8 chưa được xem là nghiệm thu toàn bộ vòng đời điều hành giải chỉ dựa trên unit/API/build.

## Checkpoint

HEAD được giữ nguyên; checkpoint là bản bảo toàn working tree và patch, không phải Git commit. Checkpoint trước P10: [manifest](../output/match-operation-prompt-10/checkpoint-before/manifest.json). Checkpoint sau P10: [manifest](../output/match-operation-prompt-10/checkpoint-after/manifest.json), [source-preservation](../output/match-operation-prompt-10/source-preservation-final.json).
