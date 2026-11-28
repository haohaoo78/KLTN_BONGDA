# Baseline điều hành giải và trận đấu - Sân Cỏ

**Phiên bản:** 0.1 - Prompt 0, ngày 26/11/2026, múi giờ Asia/Ho_Chi_Minh (UTC+7).

**Bổ sung Prompt 2 — 26/11/2026:** xem mục 14 và [MATCH_RULES_MATRIX.md](./MATCH_RULES_MATRIX.md). Các phần hiện trạng Prompt 0 dưới đây được giữ làm lịch sử; trạng thái triển khai mới được ghi riêng, không thay các quyết định nghiệp vụ chưa xác định bằng giả định.

**Bổ sung Prompt 3 — 26/11/2026:** F01/F10 đã sửa và kiểm tra trên QA; xem mục 15 và [báo cáo Prompt 3](./MATCH_OPERATION_PROMPT_03_REPORT.md). Bản Docker chính thức 5173 đã cập nhật; chưa nghiệm thu E2E toàn bộ trận đấu.

**Bổ sung Prompt 4 — 26–27/11/2026:** đã triển khai đội hình theo trận và gate F02; xem mục 16, [ma trận quy tắc](./MATCH_RULES_MATRIX.md#9-bổ-sung-prompt-4--đội-hình-và-chuẩn-bị-trước-trận) và [báo cáo Prompt 4](./MATCH_OPERATION_PROMPT_04_REPORT.md). Nghiệp vụ ghi được kiểm thử trên bản sao PostgreSQL QA; không tạo đội hình hoặc bắt đầu trận tương lai trong database chính thức.

**Bổ sung Prompt 5 — 27/11/2026:** đã củng cố gate START/chuyển hiệp, clock theo phiên bản quy tắc, thời gian sự kiện theo pha và dừng clock khi hoãn/hủy trận. Xem mục 17 và [báo cáo Prompt 5](./MATCH_OPERATION_PROMPT_05_REPORT.md). Docker chính thức 5173 đã cập nhật, không bắt đầu trận người dùng; chưa nghiệm thu sự kiện/luân lưu/kết quả đầy đủ.

**Trạng thái:** đã rà soát tài liệu, source hiện tại, schema/migrations, Docker và dữ liệu nghiệp vụ bằng truy vấn chỉ đọc. **Chưa nghiệm thu E2E luồng thi đấu.** Tài liệu này ghi nhận hiện trạng và các quyết định đã có; không tự phê duyệt các quy tắc còn thiếu.

**Bổ sung Prompt 8 — 28/11/2026:** F07/F08 có transaction công nhận nguyên tử, retry/version, người chuẩn bị và final authority, snapshot lịch sử và in/PDF. Xem mục 21 và [báo cáo Prompt 8](./MATCH_OPERATION_PROMPT_08_REPORT.md). Các phát hiện ban đầu dưới đây là lịch sử; không đọc chúng thay cho kết quả/giới hạn cập nhật.

## 1. Phạm vi, checkpoint và cách đọc bằng chứng

### 1.1. Ranh giới của Prompt 0

Chỉ bổ sung tài liệu baseline này. Không sửa source/runtime, UI, điều lệ, roster, lịch, phân công hoặc kết quả; không build/restart container, chạy migration, seed, reset hay xóa dữ liệu/volume. Không gửi email và không bắt đầu một trận tương lai để kiểm thử.

Checkpoint tham chiếu của source:

- HEAD: **27fa2bd9fef76f23bc6cb16b939f124735c8cea0**, commit ngày **26/11/2026 10:40:20 +07:00**, nội dung “phân công trọng tài”.
- Working tree có **33 đường dẫn thay đổi/chưa track sẵn từ trước**, gồm frontend trọng tài, API đọc trọng tài, tài liệu và bằng chứng QA. Baseline dựa trên **working tree**, không chỉ HEAD.
- Các thay đổi có trước được giữ nguyên. Không commit gộp, stash, reset hoặc phục hồi source về checkpoint cũ.
- Checkpoint giao diện **788015c** và môi trường đối chiếu cổng **15173** là tài sản cần bảo toàn; không dùng dữ liệu của môi trường đó để thay dữ liệu nghiệp vụ hiện tại.
- Cổng hệ thống chính thức đang xem: [http://localhost:5173/referee](http://localhost:5173/referee).
- Bảng số liệu bên dưới là các lần đọc riêng trong buổi rà soát, không phải snapshot nguyên tử của cả tám database. Truy vấn có mốc máy chủ **2026-11-26 05:44:31 UTC**; các lần đọc bổ sung thực hiện sau đó. Không suy ra dữ liệu bất biến nếu người dùng tiếp tục thao tác.

Dấu vân tay một số file đang sửa sẵn trước Prompt 0, SHA-256:

| File | SHA-256 trước khi viết baseline |
|---|---|
| [App.tsx](../apps/web-client/src/App.tsx) | CC62FCF99EBAA453CCA4B9800F390A634E99943F0E866151192C05141FE7E7C3 |
| [RefereeOperationPage.tsx](../apps/web-client/src/components/referee/RefereeOperationPage.tsx) | 7EEBC407614A40C0622B3FA62E95B0EA3F86A5028B59156C7DFB9C93E897CC9A |
| [refereePortalService.ts](../services/match-service/src/services/refereePortalService.ts) | A46FD755A36C32823FCEFBFF410839429786795291E87E3881CCC2FB647D4638 |

### 1.2. Nhãn bằng chứng

| Nhãn | Ý nghĩa |
|---|---|
| CODE | Đã đọc nhánh xử lý/validation/repository thực tế; không đồng nghĩa đã chạy nghiệp vụ |
| DB | Đã đọc PostgreSQL thực bằng transaction READ ONLY; không ghi thử |
| RUN | Đã đọc container, code biên dịch hoặc trạng thái trình duyệt đang chạy |
| HIST | Bằng chứng của một lần QA trước, có ngày và giới hạn riêng |
| NOT TESTED | Chưa thực hiện ca nghiệp vụ trong Prompt 0 |
| FAIL - CODE/DB | Có mâu thuẫn cụ thể giữa code, schema hoặc yêu cầu; chưa nhất thiết đã gửi request ghi để tái hiện |

Một bài unit test, typecheck, build, HTTP health 200 hoặc một hàng database tồn tại không thay thế E2E. Không lấy báo cáo QA cũ để gán PASS cho phiên bản hiện tại.

### 1.3. Nguồn nội bộ và giới hạn đọc

Đã lập danh mục toàn bộ cây tài liệu; có **45 Markdown**, **1 DOCX**, **10 PDF**, **8 HTML**, cùng JSON, ảnh và log QA trong [docs/](./). Ngoài ra có hai DOCX ở gốc dự án. Không tìm thấy tài liệu độc lập có tên SRS; phần yêu cầu chức năng/phi chức năng nằm trong tài liệu Use Case.

Nguồn yêu cầu chính đã đối chiếu:

- [Usecase_da_chinh_sua_v2.md](./Usecase_da_chinh_sua_v2.md): yêu cầu 3.1.2, UC 3.4.21-34, trạng thái 3.5, quy tắc 3.6, bổ sung 3.7 và các cập nhật sau.
- [DOCX Use Case gốc](../Usecase_da_chinh_sua_v2.docx), [DOCX Use Case bổ sung](./Usecase_bo_sung_theo_quy_trinh_TO_DOI_MAU_DO%20%281%29.docx): đọc nội dung XML văn bản, đối chiếu các yêu cầu roster, trọng tài, kết quả, kỷ luật.
- [Kiến trúc bản Markdown](./SFTMS_Kien_truc_tong_the_ban_gon_so_do_ro_rang.md), [DOCX kiến trúc](../SFTMS_Kien_truc_tong_the_ban_gon_so_do_ro_rang.docx), [PROJECT_OVERVIEW.md](../PROJECT_OVERVIEW.md), [README.md](../README.md), [AGENTS.md](../AGENTS.md), [ROLE_PERMISSION_AUDIT.md](../ROLE_PERMISSION_AUDIT.md).
- [API_ROUTING.md](./API_ROUTING.md), [PROJECT_STATUS_OVERVIEW.md](./PROJECT_STATUS_OVERVIEW.md), [REFACTOR_8_TO_5.md](./REFACTOR_8_TO_5.md), [quyết định ownership](./DECISION_REGISTRATION_OWNERSHIP.md).
- [Quy trình đăng ký/roster](./TOURNAMENT_TEAM_REGISTRATION_WORKFLOW.md), [rút đội](./TEAM_WITHDRAWAL_WORKFLOW.md), [draw](./DRAW_WORKFLOW.md), [lập lịch](./STEP5_SMART_SETUP.md).
- Đã rà nội dung liên quan trong các tài liệu audit, tiến độ, test data và QA tại [step5-audit/](./step5-audit/), [step5-final/](./step5-final/), [system-architecture-audit/](./system-architecture-audit/) và các báo cáo ngày 11-25/11.
- Các báo cáo [Bước 4](./step4-official-qa-20261124/README.md), [Bước 5](./step5-official-qa-20261125/README.md), [phân công](./step6-assignment-qa-20261125/report.html), [công bố trọng tài](./step6-publication-qa-20261125/report.html), [QA trọng tài 26/11](../output/referee-portal-qa-20261126/) được xem là lịch sử bằng chứng.

Ảnh, JSON fixture và PDF in lịch trong thư mục QA không phải văn bản luật hoặc dữ liệu nghiệp vụ hiện hành. Không tuyên bố đã nghiệm thu lại từng ảnh/PDF lịch, bố cục DOCX, mọi log/JSON hay toàn bộ màn hình qua việc rà văn bản. Những mục đó không được dùng để kết luận một ca thi đấu đã PASS.

**Xung đột tài liệu cần lưu ý:** UC 3.4.25-26 và DOCX cũ còn mô tả BTC duyệt kết quả thường lệ; phần “Quy tắc xác nhận kết quả trận đấu (cập nhật nghiệp vụ)” tại 3.7 đã đổi sang trọng tài có thẩm quyền cuối xác nhận trận bình thường. Giữ quyết định cập nhật này. Tài liệu kiến trúc tám miền/RabbitMQ là mô tả cũ/định hướng, không phải số service hoặc broker đang chạy. Tài liệu Bước 5 cũ có năm công đoạn và snapshot test không thay thế workspace chính thức bốn công đoạn.

## 2. Căn cứ bên ngoài và phạm vi áp dụng

Ngày truy cập: **26/11/2026**. Ngày crawl hoặc ngày đăng lại không phải ngày hiệu lực. Một quy tắc chỉ trở thành quy tắc xử lý của giải khi xác định đúng bộ luật, phiên bản, phạm vi và điều lệ đã công bố.

### 2.1. Danh mục nguồn đã kiểm tra

| Mã | Nguồn chính thức | Phiên bản/phát hiện | Cách sử dụng |
|---|---|---|---|
| L1 | [IFAB Documents](https://www.theifab.com/documents/), [Circular 32](https://downloads.theifab.com/downloads/circular-32?l=en) | IFAB đang niêm yết **2026/27**; Circular 32 ngày **31/03/2026** nêu hiệu lực **01/07/2026**, có điều khoản chuyển tiếp cho giải bắt đầu trước đó | Căn cứ bóng đá theo IFAB; xác định phiên bản giải áp dụng. Không tự áp toàn bộ vào sân 5/7 |
| L2 | [IFAB Law 3](https://www.theifab.com/laws/latest/the-players/), [General Modifications](https://www.theifab.com/laws/latest/general-modifications/) | Có các phạm vi và điều kiện cho thay đổi tổ chức thi đấu | BTC không có quyền tùy ý sửa mọi điều của luật; phải nằm trong phạm vi cho phép |
| L3 | [IFAB Law 5](https://www.theifab.com/laws/latest/the-referee/), [Law 7](https://www.theifab.com/laws/latest/the-duration-of-the-match/), [Law 10](https://www.theifab.com/laws/latest/determining-the-outcome-of-a-match/) | Đã đọc các phần quyền trọng tài, thời gian và phân định kết quả | Tham chiếu cho thẩm quyền, hiệp/bù giờ, phân biệt bàn trong trận với luân lưu |
| L4 | [VFF - văn bản 7 người được user dẫn](https://vff.org.vn/luat-van-ban/luat-bong-da-7-nguoi-do-uy-ban-the-duc-the-thao-ban-hanh/) | **492/QĐ-UBTDTT, 13/04/2001** | Nguồn lịch sử; không gắn nhãn “mới nhất” |
| L5 | [VFF - Luật thi đấu bóng đá 7 người](https://vff.org.vn/luat-van-ban/luat-thi-dau-bong-da-7-nguoi/), [bản sách VFF do VietFootball công bố](https://www.vietfootball.vn/public/tailieu/Lu%E1%BA%ADt%20thi%20%C4%91%E1%BA%A5u%20B%C3%B3ng%20%C4%91%C3%A1%207%20ng%C6%B0%E1%BB%9Di%20%28b%E1%BA%A3n%20in%20s%C3%A1ch%20final%29.pdf) | **433/QĐ-LĐBĐVN, 22/08/2023**, bản sách 82 trang. Trang chủ VFF có liên kết bộ luật mới hơn; [VFF xác nhận việc ban hành tháng 8/2023](https://vff.org.vn/32-doi-bong-tham-du-giai-bong-da-vpl-s5/) | Văn bản mới hơn 2001 đã xác minh. Chưa xác minh được một văn bản sửa đổi sau 2023 hoặc toàn bộ tình trạng thay thế pháp lý của văn bản 2001 |
| L6 | [VFF - văn bản 5 người được user dẫn](https://vff.org.vn/luat-van-ban/luat-bong-da-5-nguoi-do-uy-ban-the-duc-the-thao-ban-hanh/) | **480/QĐ-UBTDTT-TT.II, 13/06/1998**, gồm 18 luật và phụ lục | Văn bản lịch sử; chưa đủ căn cứ coi là bản mới nhất cho mọi giải sân 5 |
| L7 | [AFC - danh mục luật trọng tài](https://www.the-afc.com/en/about_afc/downloads.html), [FIFA Futsal Laws 2026-27 do DFB lưu hành](https://assets.dfb.de/uploads/000/341/436/original_Futsal_Laws_of_the_Game_2026-2027_EN.pdf?1795013310=) | Sách FIFA **2026-27**, trang đầu ghi hiệu lực **22/10/2026**; AFC cũng niêm yết 2026-27. Tệp AFC trả 403 qua công cụ, bản DFB đọc được | **Chỉ áp dụng khi giải thực sự chọn futsal**. Không chọn 2025-26 là “mới nhất” chỉ vì các bài viết cũ còn dẫn nó |
| L8 | [Điều lệ Thanh Niên Sinh viên Việt Nam lần III - Cúp THACO 2025, bản UEH lưu](https://sport.ueh.edu.vn/wp-content/uploads/2024/10/Dieu-le-Thanh-Nien-sinh-vien-2025-da-nen.pdf) | Bản ban hành ký ngày **16/10/2024**, 11 trang scan, đã đọc ảnh của đủ 11 trang; không dùng mã số viết tay chưa đọc chắc làm căn cứ | Ví dụ điều lệ sinh viên xác minh được, chỉ áp cho giải và mùa đó |
| L9 | [UEH công bố điều lệ UEH League 2026](https://sport.ueh.edu.vn/ueh-league/ueh-league-2026-cong-bo-dieu-le-giai-bong-da-sinh-vien-ueh/) | Bài chính thức của UEH nêu sân 7 và hai hiệp 30 phút | Chứng minh điều lệ sinh viên có thể khác ví dụ lịch sử; không nhập quy định của UEH vào giải DEMO |

Liên kết IFAB gốc [laws/latest/](https://www.theifab.com/laws/latest/) trả 404 khi tra cứu; đã dùng danh mục và các trang luật con chính thức. PDF toàn bộ IFAB 2026/27 khoảng 23 MB vượt giới hạn đọc của công cụ; đã đọc Circular 32, bản thay đổi và các điều luật con liên quan. Không tuyên bố đã đối chiếu từng điều trong cả cuốn luật.

Đối với L5, bản 2023 khác nội dung 2001, ví dụ cách xử lý việt vị và điều kiện số cầu thủ. Không được dùng các con số hoặc điều luật của hai bản lẫn nhau. Các mốc/chi tiết phải được gắn đúng phiên bản khi triển khai.

Đối với L8, các mục 10-13 và 16 có quy định riêng về xếp hạng, trận hòa loại trực tiếp, thời lượng, thay người và khiếu nại. Đó là điều lệ riêng, không tạo ra mặc định toàn hệ thống. Những mốc trong bản scan cần được đối chiếu thông báo sửa đổi của chính mùa giải trước khi vận dụng.

### 2.2. Phân loại quy tắc

| Loại | Ví dụ/phạm vi | Nguyên tắc baseline |
|---|---|---|
| Luật thi đấu bắt buộc sau khi xác định bộ luật | Thẩm quyền chuyên môn trọng tài; cầu thủ hợp lệ; cách ghi bàn; xử lý truất quyền; luân lưu khác bàn trong trận | Lấy từ đúng luật/phiên bản; phần mềm hỗ trợ ghi nhận, không tự thay quyết định chuyên môn |
| Điều lệ được phép cấu hình | Thể thức, điểm/xếp hạng, điều kiện đi tiếp, thời lượng được phép điều chỉnh, phương thức phân định, kỷ luật giải, khiếu nại | Dùng phiên bản điều lệ đã công bố trong giới hạn luật; thiếu thì ghi chưa xác định |
| Quy trình phần mềm đã thống nhất | BTC phân công thủ công có gợi ý; không có nhận/từ chối nhiệm vụ; một người xác nhận cuối; bản nháp không tác động BXH | Đây là quyết định sản phẩm/Use Case, không ghi là điều IFAB bắt buộc |
| Quyết định thực tế của người tổ chức/trọng tài | Thời điểm được phép nộp/chỉnh đội hình, xử lý trận gián đoạn, ngoại lệ, chứng cứ | Không âm thầm chọn giá trị hoặc tự phán quyết |

Các nguyên tắc luật liên quan trực tiếp:

- Theo L3, trọng tài có thẩm quyền điều khiển trận và lập báo cáo; trách nhiệm xác nhận trong phần mềm phải gắn người được phân công. BTC xử lý ngoại lệ theo thẩm quyền đã quy định, không trở thành người duyệt chuyên môn thường lệ.
- Theo Law 7 tại L3, bù giờ thuộc từng hiệp và quyết định trọng tài; phần mềm không tự cắt trận khi đồng hồ đạt một con số.
- Theo Law 10 tại L3, luân lưu là thủ tục phân định sau trận; không cộng số quả luân lưu vào bàn thắng/hiệu số/thống kê ghi bàn của thời gian thi đấu.
- L2 cho phép một số điều chỉnh theo đối tượng/phạm vi có thẩm quyền; không suy ra mọi giải sinh viên đều được BTC sửa luật tùy ý.
- Không suy ra footballFormat=5 là futsal. Chưa xác định hệ luật thì chưa thể chốt đồng hồ dừng/chạy, timeout, thay người trở lại hay lỗi tổng hợp.

## 3. Kiến trúc và hợp đồng dữ liệu hiện hành

### 3.1. Ownership giữ nguyên

| Runtime | Database đang sở hữu | Dữ liệu liên quan |
|---|---|---|
| Auth :3001 | sfl_auth, sfl_user | Tài khoản, trạng thái hoạt động/xác minh, vai trò, xác thực, cấp quyền REFEREE và hướng dẫn truy cập |
| Organization :3004 | sfl_team | Trường/CLB/cầu thủ, đăng ký đội, roster theo giải, lời mời đã chấp nhận, hồ sơ bổ sung/rút |
| Tournament :3003 | sfl_tournament | Giải, điều lệ có phiên bản, tiêu chí xếp hạng, roster đã chốt, draw đã công bố, trạng thái giải |
| Match :3005 | sfl_match, sfl_scheduling, sfl_discipline | Fixture/BYE/nguồn đi tiếp, lịch và sân, tổ trọng tài, đội hình trận, đồng hồ, sự kiện, kết quả, biên bản, BXH, thẻ/kỷ luật/khiếu nại |
| Notification :3006 | sfl_notification | Thông báo, SMTP thật và sổ trạng thái/idempotency gửi thư |

[API Gateway](../apps/api-gateway/src/index.ts) :8080 và web :5173 là lớp biên. PostgreSQL là nguồn chính thức; Redis dùng session. Không tạo service mới hoặc gộp/xóa database để sửa đồng bộ.

Organization vẫn sở hữu đăng ký/roster là quyết định chuyển tiếp đã ghi trong tài liệu ownership, không phải lý do để Match đọc thẳng database Organization. Match dùng API của Organization/Tournament; ba database nội bộ Match được tiếp cận qua pool/repository đúng miền.

### 3.2. API liên quan đã có

Các đường dẫn sau được gọi qua tiền tố /api tại Gateway, trừ /internal chỉ dành cho service tin cậy.

| Nhóm | API hiện tại | Giới hạn/ghi chú |
|---|---|---|
| Lịch và nguồn lực chính thức | GET /tournaments/:id/schedules/context; PUT /tournaments/:id/schedules/draft; POST /tournaments/:id/schedules/publish; GET/PUT /tournaments/:id/scheduling-resources | Fixture chính thức, validation và signature; không dựa snapshot test |
| Trợ lý lập lịch | POST /tournaments/:id/schedules/automatic-preview, /validate, /setup-analysis, /manual-candidates | Phương án chưa áp dụng không phải lịch công bố |
| Đội ngũ/cấu hình trọng tài | /tournaments/:id/referee-team; /account-lookup; GET/PUT /configuration | BTC có quyền quản lý giải; Auth cấp thêm REFEREE mà giữ vai trò cũ |
| Phân công | GET/PUT /tournaments/:id/referee-team/assignments/:matchId; POST .../:matchId/suggestions | Chọn người thủ công, cho nháp thiếu; không cấp quyền từ nháp |
| Công bố/thay thế | POST .../assignments/publish; POST .../:matchId/replace; GET .../:matchId/history; POST .../:matchId/resend-email | Phiên bản, lý do, khóa người, signature và outbox |
| Trọng tài | GET /my/schedules/workspace; GET /matches/:matchId/referee-context | Phân công có hiệu lực, thông tin tên đội/sân/điều lệ thật; context gọi hàm có thể khởi tạo hàng clock |
| Đội hình trận | POST /lineups; PUT /matches/:matchId/lineups/:teamId/confirm; DELETE /matches/:matchId/lineups/:teamId | TEAM_CAPTAIN đúng đội hoặc BTC đúng giải; xem F02 |
| Sẵn sàng/đồng hồ | PUT /matches/:id/referee-status; GET /matches/:matchId/clock; POST /matches/:matchId/clock-actions | referee-status chỉ nhận LINEUP_CONFIRMED; clock-actions có expectedVersion; xem F01-F04 |
| Sự kiện | POST /match-events; DELETE /match-events/:id | RECORD_EVENT / EDIT_EVENT; void có lý do và audit |
| Kết quả/biên bản | POST /match-results; POST /match-reports; GET /matches/:id/result/manage, /report/manage; PUT /match-reports/:id/review | Kết quả nháp PENDING; BTC review ngoại lệ; xem F07-F08 |
| Đính chính/xử thua | POST /matches/:id/result-correction-requests; PUT /result-correction-requests/:id/review; POST /matches/:id/forfeit | Audit, bảo vệ trận phụ thuộc; không sửa trực tiếp kết quả chính thức |
| BXH/nhánh | GET /tournaments/:id/standings, /bracket; GET /tournaments/:id/fixtures/group-standings; POST /tournaments/:id/knockout-stage/generate | Hai đường BXH chưa đồng nhất; API group-standings thuộc BTC |
| Kỷ luật | /cards, /suspensions, /complaints, /complaint-appeals, /disciplinary-decisions | Quyền, nguồn thẻ và điều lệ; xem F12-F14 |
| Công khai/trực tiếp | GET /matches/live, /matches/:id/live-state, /matches/:id/events, /lineups, /report; /matches/live/stream, /matches/:id/stream | Kết quả/biên bản chính thức được lọc; live là dữ liệu đang diễn ra |

Nguồn: [routes trận](../services/match-service/src/routes/matchRoutes.ts), [routes scheduling](../services/match-service/src/scheduling/routes/schedulingRoutes.ts), [routes kỷ luật](../services/match-service/src/discipline/routes/disciplineRoutes.ts), [API_ROUTING.md](./API_ROUTING.md).

Các API /schedules/engine/test và /schedules/test-workflow còn trong source để kiểm thử được giữ lại. Controller chặn khi production hoặc chưa bật cờ schedulingTestApiEnabled. Sự tồn tại của file/tên Demo không chứng minh luồng chính thức dùng dữ liệu giả. [OfficialScheduleWorkspace](../apps/web-client/src/components/OfficialScheduleWorkspace.tsx) là adapter API, tái sử dụng giao diện [DrawDemoScheduleWorkspace](../apps/web-client/src/components/DrawDemoScheduleWorkspace.tsx); không thay workspace đó trong chuỗi tác nghiệp.

### 3.3. Xác thực và phân quyền

Runtime hiện dùng **opaque session ID trong cookie HttpOnly**, lưu session ở Redis; không phải JWT access token. Gateway xác minh qua Auth, chuyển identity bằng header nội bộ; service kiểm tra khóa Gateway, role và quyền đối tượng.

- BTC phải là người quản lý đúng giải, xác minh bằng Tournament internal manager-access.
- Đội trưởng phải có quyền đúng đội qua Organization, và đội thuộc trận.
- Trọng tài phải có phân công đang có hiệu lực trên lịch PUBLISHED.
- Quyền tác nghiệp lấy từ cấu hình vị trí **đã công bố**, không từ dropdown đổi nhiệm vụ hay chỉ role REFEREE.
- Kế thừa cấu hình trước công bố: **trận > vòng > giai đoạn > giải**. Snapshot vị trí công bố là lịch sử nghiệp vụ hợp lệ.
- Có tương thích phân công cũ qua schedules.referee_id; đây là điểm cần kiểm soát khi đối chiếu luồng mới, không tự xóa trong baseline.

Nguồn: [sessionStore](../services/auth-service/src/services/sessionStore.ts), [Gateway session](../apps/api-gateway/src/middleware/session.ts), [middleware Match](../services/match-service/src/middleware/gatewayUser.ts), [authorization](../services/match-service/src/scheduling/authorization.ts).

### 3.4. Realtime, email và đồng bộ

| Thành phần | Hiện trạng chính xác | Khoảng trống |
|---|---|---|
| Trực tiếp trận | **SSE/EventSource**, PostgreSQL LISTEN/NOTIFY và match_realtime_events; không phải WebSocket | Cần kiểm thử reconnect, mất sự kiện, restart và nhiều client |
| Sự kiện trong Match DB | Ghi event log và pg_notify cùng transaction nghiệp vụ | Cần E2E rollback không phát dữ liệu chưa commit |
| Lịch ở Scheduling DB | Commit lịch rồi ghi/sync Match và phát sự kiện bằng transaction riêng; có bù trừ lỗi thông thường | Chưa có bảo đảm nguyên tử qua hai database khi tiến trình chết giữa commit |
| Sự kiện từ Scheduling sang realtime | publishCommittedMatchUpdate ghi Match event sau commit; lỗi được log | Nếu ghi event thất bại chưa có outbox bền vững để tự phát lại |
| Replay SSE | Last-Event-ID; tối đa 200 event/lần replay; retention 30 ngày | Chưa chứng minh client bắt kịp sau backlog lớn/khoảng trống retention |
| Thẻ phạt | Outbox ISSUE_CARD/VOID_CARD từ Match sang Discipline trong cùng runtime; retry/lease/idempotency | Đây là nhất quán sau, không phải commit đồng thời hai database |
| Phân công/email | Outbox và email-attempt; Notification dùng SMTP thật | SENT chỉ xác nhận provider tiếp nhận, không chứng minh thư vào Gmail |
| RabbitMQ | Không có broker/container, dependency hay consumer runtime được tìm thấy | Không tự thêm RabbitMQ vì tài liệu kiến trúc cũ từng đề cập |
| Redis | Session Auth | Không coi Redis là kho kết quả hoặc message broker đang triển khai |

Nguồn: [matchRealtime](../services/match-service/src/realtime/matchRealtime.ts), [worker kỷ luật](../services/match-service/src/discipline/services/matchEventDisciplineOutbox.ts), [worker email phân công](../services/match-service/src/scheduling/services/refereePublicationDelivery.ts), [useMatchFeedInvalidation](../apps/web-client/src/hooks/useMatchFeedInvalidation.ts), [Compose](../docker-compose.yml).

## 4. Dữ liệu thật và deployment đã quan sát

### 4.1. Các giải hiện có

| Giải | ID | Thể thức/cấu trúc thực tế | Roster đã chốt | Fixture/lịch công bố | Lịch khóa |
|---|---|---|---:|---:|---:|
| DEMO IUH League 2026 | 248006af-5af3-4ff5-8486-47b80fc269b9 | Sân 5, vòng tròn, 1 bảng, 4 đội, 2 lượt | 4 đội / 40 cầu thủ | 12 / 12 | 11 |
| DEMO Student Knockout Cup 2026 | d9fe5a04-5e71-41ec-b85c-f4567b294c68 | Sân 7, knockout, 16 đội | 16 / 224 | 15 / 15 | 14 |
| DEMO HCMC Student Champions Cup 2026 | 9f765a91-b8ab-4716-a083-0cf8a113db1b | Sân 11, 4 bảng, 16 đội; 24 trận bảng + 7 knockout | 16 / 320 | 31 / 31 | 31 |

Ba giải ở trạng thái **PREPARING**, điều lệ published_version=1 và có bản phân bổ PUBLISHED. Các con số này là dữ liệu DEMO nghiệp vụ thật trong PostgreSQL, không phải fixture mock.

Còn một giải tên **khong**, ID b9735eed-dc90-4c8b-9493-a247a7c3a841, trạng thái DRAFT nhưng đã có published_version=1 trong bảng rules; chưa có fixture. Không tự đổi trạng thái hoặc xóa giải này.

Roster Organization của giải kết hợp có 400 hàng vì gồm cả hồ sơ không còn thuộc danh sách chốt; snapshot chính thức chỉ có 320 cầu thủ. Đây là lý do phải lấy **roster đã chốt/điều chỉnh hợp lệ**, không lấy toàn bộ hàng roster hoặc toàn bộ thành viên CLB.

### 4.2. Những thông số đã được cấu hình, không phải luật chung

| Tham số | Vòng tròn | Knockout | Kết hợp |
|---|---:|---:|---:|
| Tổng thời gian hai hiệp chính thức (phút) | 40 | 50 | 90 |
| Nghỉ tối thiểu giữa hai trận của đội (phút) | 1440 | 1440 | 1440 |
| Phân định knockout lưu trong rules | PENALTIES_ONLY, không áp cho vòng tròn | PENALTIES_ONLY | EXTRA_TIME_THEN_PENALTIES |
| extra_time_minutes còn lưu | 15, không áp dụng | 15, không áp dụng theo phương thức | 30 |
| Điểm thắng/hòa/thua | 3/1/0 | 3/1/0, không dùng để xếp nhánh | 3/1/0 |
| Ngưỡng thẻ vàng / số trận treo | 3 / 1 | 3 / 1 | 3 / 1 |
| complaint_window_hours | 24 | 24 | 24 |
| Forfeit policy và tỷ số | WALKOVER, 3-0 | WALKOVER, 3-0 | WALKOVER, 3-0 |

Không sửa điều lệ đã công bố để “chuẩn hóa” các giá trị không áp dụng. [Bước 5 đã có normalizeScheduleDecisionTiming](./STEP5_SMART_SETUP.md): vòng bảng không cộng hiệp phụ/penalty; PENALTIES_ONLY không cộng hiệp phụ. Luồng đồng hồ/kết quả phải kiểm tra tương tự tại backend khi được triển khai tiếp.

Schema rules hiện chưa lưu định danh rõ bộ luật/phiên bản 5 người hay futsal, chính sách thay người/đội hình theo trận, bù giờ, giảm người trong trận và lỗi tổng hợp. Chưa đủ căn cứ tự áp chúng từ football_format.

### 4.3. Mức phát sinh dữ liệu tác nghiệp

- 58 trận: **57 SCHEDULED**, **1 LINEUP_CONFIRMED**.
- Hai hàng clock đều NOT_STARTED, không chạy, version=0.
- **0 lineups, 0 match_events, 0 match_results, 0 match_reports, 0 standings**.
- Discipline: **0 cards, 0 suspensions, 0 complaints, 0 appeals, 0 decisions**.
- Giải kết hợp có 3 thành viên đội ngũ trọng tài, 1 cấu hình đã lưu; 2 phân công trọng tài đang active trên **2 trận** ở lần đọc bổ sung.
- Có 4 hàng lịch sử công bố phân công, trong đó 1 đã void có audit; không tính bản lịch sử/void như một trận đang phân công.
- Notification ghi nhận 4 email phân công SENT; email hướng dẫn truy cập có 2 SENT và 5 FAILED. Không gửi lại email trong rà soát.
- Trình duyệt đang đăng nhập Võ Tuấn Dũng hiển thị 1 trận được giao, 1 sắp diễn ra, 0 đang đá, 0 hoàn thành; không có form tác nghiệp trên Tổng quan.

**Bất nhất hiện có:** trận e45a599b-1377-4377-9016-3956cc4e0738 ở LINEUP_CONFIRMED dù toàn bộ bảng lineups đang rỗng. Đây là bằng chứng dữ liệu của lỗ hổng kiểm tra phía server F02; không tự đổi trạng thái trận đó.

Các lịch đều ở tương lai so với ngày rà soát. Không biến NOT TESTED thành PASS bằng việc đổi ngày, chèn kết quả hoặc cho phép bắt đầu sớm.

### 4.4. Migration đã áp dụng

Đọc bảng sfl_schema_migrations của từng database, không chạy migration:

| Database | Các phiên bản đã ghi nhận |
|---|---|
| sfl_auth | 1 |
| sfl_user | 1-9 |
| sfl_team | 1-35 |
| sfl_tournament | 1-25 |
| sfl_match | 1-21 |
| sfl_scheduling | 1, 2, 3, 1005-1013 |
| sfl_discipline | 1, 2, 4, 5, 1003 |
| sfl_notification | 1-8 |

Không coi số thứ tự không liên tiếp là migration hỏng: các namespace được giữ tương thích dữ liệu cũ. Nếu cần thay schema sau này, thêm migration mới có transaction và kế hoạch phục hồi; không sửa migration đã áp dụng.

### 4.5. Docker đã kiểm tra chỉ đọc

Project **student-football-league**, build context gốc hiện tại qua [docker-compose.yml](../docker-compose.yml); 9 container running, 8 healthcheck có cấu hình healthy, web không có healthcheck. Có năm backend runtime; migration/seed jobs theo profile không phải service nghiệp vụ thứ sáu.

Dấu vân tay image từ nhãn container ở thời điểm rà soát:

| Container | com.docker.compose.image |
|---|---|
| web-client | sha256:15c4c3723f27f07957dd709906e708e34b2522f128e0c52d16badd06d6efc0a7 |
| match-service | sha256:4a55d7e33b2a31723cd9343c9652c7b28103ecfc125191e821ebfb97403b496c |
| tournament-service | sha256:4a7d45c45114c608991fe3b1a2cd2a705e5b055f5d19cfdf274998f107f23a84 |
| organization-service | sha256:fb8bb795b97071a27e652a892f911a232635e8ac648b081f11fe11226a54cef6 |
| auth-service | sha256:15fba0480f0ebc4e0bd995f177d5a178268274fbe214f2d47d0f8c9d3a7639ac |
| notification-service | sha256:70f44f23b43eeb5ee6cd9dfd92cbfe0418b6625095e6c45f8c3e67fbd5ff8231 |
| api-gateway | sha256:07489443eff7dccb65892387fba83c9c245c7cc1f2b0833b6468e607140431c8 |

Đã đọc riêng code đồng hồ biên dịch trong container: lỗi F01 tồn tại trong image đang chạy, không chỉ file TypeScript chưa triển khai. Không khẳng định toàn bộ file trong mọi image trùng working tree chỉ từ các hash nhãn trên.

## 5. Ma trận đối chiếu nghiệp vụ

Mức “Có một phần” nghĩa là đã có code/dữ liệu nền nhưng còn lỗi hoặc thiếu bằng chứng; không phải PASS chức năng hoàn chỉnh.

| # | Yêu cầu | Căn cứ | Dữ liệu/triển khai hiện tại | Mức độ | Điểm cần sửa/kiểm chứng |
|---|---|---|---|---|---|
| 1 | Dùng điều lệ thật, có phiên bản | UC 3.4.15, 3.7.3; L1-L9 | Rules, ranking criteria, regulation versions; fixture có regulation snapshot | CODE+DB | Gắn bộ luật/phiên bản và xác định nguồn hiệu lực trong tác nghiệp; không đổi điều lệ công bố |
| 2 | Ba thể thức liên thông từ draw đến lịch | UC 3.4.21-22 | 3 draw công bố, 4 generation stage, 58 fixture/schedule PUBLISHED | CODE+DB, HIST | Chưa có kết quả thật để nghiệm thu nhánh/BXH cuối |
| 3 | Công bố lịch đủ trận, không cần trọng tài | Quyết định Bước 5 đã chốt | Validator chính thức, lock riêng, draft signature; lịch thật đủ | CODE+DB, HIST | Giữ nguyên bốn công đoạn/ba view; regression sau thay đổi tác nghiệp |
| 4 | BTC thêm/cấu hình/phân công/công bố trọng tài | Prompt Bước 6, UC 3.4.23-24 | Team/config/draft/publication/history/outbox thật | CODE+DB, HIST | Hai trận active ở lần đọc; chưa kiểm thử quyền thi đấu với dữ liệu live |
| 5 | Không cần trọng tài nhận/từ chối nhiệm vụ | Quyết định sản phẩm đã chốt | Không có workflow chờ nhận; lịch cá nhân lấy active published assignment | CODE+RUN | Giữ nguyên |
| 6 | Lấy đúng roster đã chốt | UC roster, 3.6.8 | Snapshot có 40/224/320 cầu thủ; lineup service chỉ xác minh thành viên CLB + treo giò | Có một phần | F02: chặn cầu thủ CLB chưa đăng ký giải/đã rút |
| 7 | Đội trưởng nộp và xác nhận đội hình theo trận | UC 3.4.25; L2/L5/L7 tùy luật | API thêm từng người/xác nhận/xóa; chưa tìm thấy UI ghi đội hình trận hoặc hàm API ghi tương ứng trong frontend hiện tại | Có một phần | F02: lifecycle, min/max, thủ môn, số áo/trùng người, khóa và audit theo điều lệ |
| 8 | Xác nhận điều kiện trước trận tại server | Quyền FINALIZE; không chỉ UI | UI kiểm tra hai lineup; server nhận LINEUP_CONFIRMED không kiểm tra lại | FAIL - CODE/DB | F02; đã có trận ready nhưng lineups=0 |
| 9 | Bắt đầu trận đúng lịch, có tổ hợp lệ | UC; quyết định lịch chính thức | Code có hàm kiểm tra prerequisites nhưng truy vấn nhầm DB; guard kickoff nằm ở nhánh không tới | FAIL - CODE/DB+RUN | F01, F03 |
| 10 | Đồng hồ bền vững, hiệp hợp lệ | L3; UC điều hành | Clock persisted, expectedVersion, FOR UPDATE, pha hai hiệp/ET/penalty | Có một phần | F03-F04; thời lượng/phân định/state chưa được kiểm tra đủ server |
| 11 | Ghi bàn/thẻ/sự kiện đúng người và trạng thái | L3/L5/L7; UC 3.4.25 | IN_PROGRESS + clock chạy; player thuộc lineups; event audit/void | Có một phần | F05-F06: sân đang có mặt, bị đuổi, hiệp/bù giờ, chống lặp |
| 12 | Thay người nhất quán | Luật áp dụng và điều lệ | SUBSTITUTION_IN/OUT là hai sự kiện độc lập | Chưa đủ | F05: cặp vào/ra nguyên tử, trạng thái cầu thủ, số người/lượt theo luật |
| 13 | Hiệp phụ/luân lưu đúng thể thức | L3; decision method đã công bố | Frontend có điều kiện hiển thị; backend score chỉ kiểm tra số/tỷ số hòa chung | Có một phần | F03/F06: không cho group hoặc PENALTIES_ONLY nhận ET trái điều lệ |
| 14 | Biên bản tổng hợp, một người xác nhận cuối | Cập nhật UC 3.7; Prompt Bước 6 | Snapshot từng lần nộp; ordinary submit tự approve bằng hai transaction | Có một phần | F07-F08: nguyên tử, retry, người chuẩn bị và final authority |
| 15 | Chỉ kết quả xác nhận mới vào BXH | UC 3.6.10 | PENDING không vào; APPROVED cập nhật cùng transaction review | CODE | Chưa E2E trên dữ liệu thi đấu hiện tại |
| 16 | Tính điểm/xếp hạng theo điều lệ | UC 3.7.3 | Group standings có rules; standings tổng hardcode | FAIL - CODE | F09 |
| 17 | KO đi tiếp đúng nguồn và BYE | UC 3.4.27 | Stable IDs, nguồn winner/loser, BYE, advance sau approve | CODE+DB nền, HIST | Chưa thi đấu thật; regression đổi người thắng và trận phụ thuộc |
| 18 | Kết hợp chốt đội từ kết quả thật | Điều lệ đã công bố; UC | rankHybridGroup, qualifiers, skeleton nguồn bảng, lot-draw audit | CODE+DB nền | Chưa tự động hoàn tất E2E; phải kiểm tra đúng fixed-pairing/redraw và thời điểm resolve |
| 19 | Thống kê không lẫn live/chính thức | UC 9-11; L3 | Live aggregate từ event; BXH từ APPROVED; chưa có dữ liệu thi đấu | Có một phần | F06/F09: luân lưu, ET, goal/own goal, tiêu chí fair-play |
| 20 | Kỷ luật và treo giò theo giải | UC 3.4.28; luật/điều lệ | Outbox thẻ, ngưỡng rules, match-count ban, void thẻ | Có một phần | F12: hai vàng, hình phạt trong trận/giải, reset thẻ và rollback |
| 21 | Khiếu nại/kháng nghị đúng hạn/quyền | UC 3.4.29-30 | API scope, cửa sổ từ rules, appeal 1 lần, quyết định có lý do | CODE, DB chưa phát sinh | F13: mốc deadline, trạng thái, không tự sửa tỷ số |
| 22 | Hoãn/dừng/hủy có audit, không lệch clock/lịch | UC 3.4.33 | Pause request ADMIN/BTC và update POSTPONED | Có một phần | F14: đồng hồ, lịch, SSE, thông báo và quyền sau hoãn |
| 23 | Mở điều hành/kết thúc giải đúng nghiệp vụ | UC 3.7.2, 3.4.34 | Gate còn kiểm tra refereeId cũ; completion đòi report cho mọi trận | FAIL - CODE | F10-F11 |
| 24 | Live/reload/reconnect và quyền người thay thế | UC phi chức năng, Prompt Bước 6 | SSE + scoped routes + published crew snapshot | CODE+RUN đọc, HIST | F15: gap cross-DB, replay và thu hồi quyền đang mở |
| 25 | Một giao diện trọng tài chính thức | Quyết định UI mới nhất | Sáu route độc lập, overview không có công cụ tác nghiệp | RUN đọc Tổng quan + CODE, HIST | Giữ cam-đen; chưa kiểm chứng live/post bằng trận đã đá |

## 6. Ma trận phân quyền baseline

Đây là quyền đích theo quyết định đã chốt, đối chiếu code; những ngoại lệ/lỗ hổng hiện tại được ghi riêng, không được coi là quyền được phê duyệt.

| Thao tác | BTC đúng giải | Trọng tài có FINALIZE và final authority | Trọng tài hỗ trợ | Đội trưởng đúng đội | Công khai |
|---|---|---|---|---|---|
| Sửa lịch/sân | Theo Bước 5 và trạng thái cho phép | Không | Không | Không | Không |
| Cấu hình, lưu/công bố/thay thế tổ trọng tài | Có, có kiểm tra/audit | Không tự chọn nhiệm vụ | Không | Không | Không |
| Xem lịch trọng tài cá nhân/nội bộ | Theo phạm vi BTC | Chỉ trận đang được giao | Chỉ trận đang được giao | Theo dữ liệu được phép của đội | Chỉ lịch công khai |
| Nộp đội hình trận | Có can thiệp theo quyền hiện có, cần audit | Xem/kiểm tra; không giả làm đội trưởng | Xem theo nhiệm vụ | Đội mình, roster hợp lệ | Chỉ phần được công bố |
| Xác nhận sẵn sàng, điều khiển clock | Không tự suy từ BTC | Có khi đủ điều kiện server | Không, trừ cấu hình thực sự giao quyền cuối duy nhất | Không | Không |
| Ghi sự kiện | Không thay chuyên môn thường lệ | Theo RECORD_EVENT được cấu hình | Chỉ khi có RECORD_EVENT | Không | Không |
| Void/đính chính sự kiện | Theo quy trình ngoại lệ | Chỉ khi có EDIT_EVENT | Chỉ khi có EDIT_EVENT được cấu hình | Không | Không |
| Chuẩn bị biên bản | Theo ngoại lệ | Theo MANAGE_REPORT/cấu hình | MANAGE_REPORT nếu được giao | Không | Không |
| Xác nhận kết quả bình thường | Không cần BTC duyệt lại | Duy nhất người được giao FINALIZE cuối | Không | Không | Không |
| Giải quyết ngoại lệ, forfeit, correction, khiếu nại | Có căn cứ, lý do, audit | Báo cáo/yêu cầu theo phạm vi | Theo phạm vi báo cáo được giao | Gửi khiếu nại/kháng nghị đúng quyền | Không |
| Xem tỷ số/biên bản chính thức | Theo scope | Theo scope | Theo scope | Theo scope | Sau xác nhận/công bố phù hợp |

Các capability hiện có: **READ** (quyền đọc nội bộ), **RECORD_EVENT**, **EDIT_EVENT**, **MANAGE_REPORT**, **FINALIZE**. Không tạo thêm enum nhiệm vụ trong baseline. Các mã vị trí hiện có gồm REFEREE, ASSISTANT_REFEREE_1..4, FOURTH_OFFICIAL, MATCH_SECRETARY; cấu hình còn hỗ trợ vị trí tùy chỉnh.

**Điểm chưa khớp cần kiểm thử riêng:**

1. [assertCanManageMatch](../services/match-service/src/scheduling/authorization.ts) ưu tiên nhánh BTC trước kiểm tra capability. Một tài khoản đồng thời BTC+REFEREE có thể đi qua nhánh quản lý giải khi gọi route tác nghiệp yêu cầu REFEREE. Portal đọc mới thì kiểm tra phân công cá nhân riêng. Không mặc nhiên cho BTC quyền chuyên môn vì có nhiều role.
2. POST /cards chỉ gọi kiểm tra READ mặc định, khác POST /match-events yêu cầu RECORD_EVENT. Cần thống nhất server ở F12.
3. Người có MANAGE_REPORT nhưng không FINALIZE hiện bị ép gửi sang BTC; chưa có bước final authority xác nhận bản PENDING đã nộp bởi hỗ trợ. Xem F08.
4. Việc thêm một hồ sơ chưa kích hoạt vào đội ngũ khác với quyền tác nghiệp: Auth và kiểm tra eligibility phải tiếp tục chặn tài khoản không hợp lệ khi sử dụng hệ thống.

## 7. Vòng đời trận, kết quả và giải

### 7.1. Vòng đời đang lưu

    UNSCHEDULED -> SCHEDULED -> LINEUP_CONFIRMED -> IN_PROGRESS
       -> FINISHED -> VERIFIED -> LOCKED

    SCHEDULED / LINEUP_CONFIRMED / IN_PROGRESS -> POSTPONED
    POSTPONED -> SCHEDULED

Có thêm CANCELLED theo chuyển trạng thái được phép. Không đồng nhất:

- Khóa lịch is_locked với match.status=LOCKED.
- Công bố lịch PUBLISHED với công bố phân công.
- FINISHED với kết quả đã xác nhận.
- Trạng thái đồng hồ với trạng thái giải.

Kết quả: **PENDING / APPROVED / REJECTED**. Biên bản: **PENDING / APPROVED / REJECTED / REVISION_REQUIRED**, có submission snapshots và review history.

Clock:

    NOT_STARTED -> FIRST_HALF -> HALF_TIME -> SECOND_HALF -> REGULATION_COMPLETE
    REGULATION_COMPLETE -> ENDED
    hoặc -> EXTRA_TIME_FIRST_HALF -> EXTRA_TIME_HALF_TIME
         -> EXTRA_TIME_SECOND_HALF -> EXTRA_TIME_COMPLETE
         -> ENDED hoặc PENALTIES -> ENDED

PAUSE/RESUME giữ pha; version chống hai thiết bị ghi đè. Sơ đồ trên chỉ mô tả khả năng hiện tại của state machine, **không cấp phép** ET/penalty cho mọi trận. Luân lưu không nên được hiểu là một hiệp cộng vào bàn thắng thường.

### 7.2. Gate cần được bảo đảm khi triển khai

1. Fixture và lịch chính thức thuộc đúng draw/phiên bản; xác định hai đội thật.
2. Tổ đã công bố có hiệu lực, người dùng có tài khoản hợp lệ và đúng capability.
3. Đội hình lấy từ roster giải đã chốt + điều chỉnh được phép; đủ điều kiện luật/điều lệ, đã được đội xác nhận.
4. Server xác minh điều kiện sẵn sàng, giờ theo lịch và trạng thái giải/trận; không chỉ tin trạng thái LINEUP_CONFIRMED.
5. Mọi thao tác clock/event kiểm tra trạng thái và quy tắc áp dụng. Các trường hợp dừng/hoãn/hủy không được để clock tiếp tục chạy trái trạng thái.
6. Kết thúc thi đấu giữ FINISHED; kết quả nháp/biên bản chưa xác nhận không cập nhật BXH.
7. Trọng tài có thẩm quyền cuối xác nhận trận bình thường. Transaction xác nhận phải nhất quán biên bản, kết quả, trạng thái, BXH và nguồn đi tiếp; phát event sau commit.
8. Correction/forfeit/ngoại lệ không sửa âm thầm kết quả hay cặp đấu; giữ ID, lịch sử và kiểm tra toàn bộ ảnh hưởng.
9. Kết thúc giải chỉ khi mỗi trận đã có kết quả cuối hoặc quyết định xử lý hợp lệ và các vấn đề ngăn chặn đã được giải quyết theo điều lệ.

Các gate trên kết hợp Use Case/decision đã chốt và luật áp dụng; chưa xác định con số mới về giờ nộp đội hình, thời lượng, thay người hoặc khiếu nại.

## 8. Phát hiện cần xử lý theo thứ tự

Không có mục nào dưới đây đã được sửa trong Prompt 0.

### F01 - P0: Bắt đầu trận truy vấn nhầm database

- [applyMatchClockAction](../services/match-service/src/repositories/matchClockRepository.ts#L52) mở client từ Match pool, rồi SELECT schedules và schedule_referee_assignments bằng client đó.
- DB xác nhận hai bảng **không tồn tại trong sfl_match**; chúng nằm trong sfl_scheduling. Không có view/FDW cùng tên trong Match.
- Code biên dịch trong container đang chạy có cùng truy vấn.
- Khi vượt gate trạng thái để START_MATCH, đường này sẽ gặp lỗi relation missing. Không cần và không được chèn bảng lịch giả vào Match DB để che lỗi.
- Hướng sửa: dùng repository/pool của miền scheduling trong Match, xác định consistency/locking khi kiểm tra rồi bắt đầu. Giữ nguyên ownership/service hiện tại.
- Bằng chứng: CODE+DB+RUN. Chưa gọi POST START_MATCH trong Prompt 0.

### F02 - P1: Đội hình trận chưa có hàng rào nghiệp vụ đầy đủ

- [lineupService](../services/match-service/src/services/lineupService.ts#L66) kiểm tra thành viên CLB hiện tại và treo giò, chưa đối chiếu snapshot roster chốt của chính giải.
- [createLineup/confirm/delete](../services/match-service/src/repositories/lineupRepository.ts#L64) chưa khóa theo vòng đời trận, chưa bảo vệ roster trận đã xác nhận/đang đá/biên bản; thiếu validation đủ min/max, thủ môn, trùng số áo/cầu thủ theo luật và quy trình chỉnh sửa.
- PUT referee-status không xác minh lại hai đội hình. UI có kiểm tra nhưng API có thể nhận LINEUP_CONFIRMED với lineups rỗng; DB đã có ví dụ cụ thể.
- Frontend tìm thấy API đọc lineups, chưa tìm thấy thao tác ghi đội hình trận chính thức cho đội trưởng. Không đồng nhất form roster đăng ký giải với đội hình từng trận.
- Hướng sửa theo prompt sau: dùng roster chính thức qua API hiện có, validation theo bộ luật/điều lệ, state/version/audit và UI tái sử dụng phù hợp. Không tự đặt deadline.

### F03 - P1: Gate kickoff, trạng thái và phân định chưa nằm đủ ở backend clock

- Hàm [assertKickoffReached](../services/match-service/src/services/matchKickoff.ts) có sẵn, nhưng nhánh gọi trong [updateMatchInfo](../services/match-service/src/services/matchService.ts#L89) nằm sau lệnh chặn cập nhật IN_PROGRESS trực tiếp; API clock không gọi guard này.
- [transitionMatchClock](../services/match-service/src/services/matchClockWorkflow.ts) chỉ kiểm tra phase/running; chưa đọc stage, decision method, tỷ số hòa, trạng thái giải hoặc điều lệ.
- API clock không có hàng rào tổng quát chống thao tác trên POSTPONED/CANCELLED/VERIFIED theo trạng thái hiện tại nếu pha còn cho phép.
- Frontend ẩn ET theo method nhưng client API có thể yêu cầu trái cấu hình sau khi F01 được sửa.
- Giữ quyết định không bắt đầu sớm đã có; bổ sung thực thi server và kiểm thử âm, không nới validation để demo chạy.

### F04 - P1: Thời gian sự kiện chưa biểu diễn đúng hiệp và bù giờ

- Schema/service/frontend giới hạn minute trong 0..120; [eventMinuteForClock](../apps/web-client/src/components/referee/refereeOperation.ts) còn clamp về 120.
- Event chưa có phase, phút trong hiệp, phần bù giờ hay loại thời gian riêng cho luân lưu.
- Suy tỷ số hiệp một bằng cutoff tổng phút từ duration/2 sẽ phân loại sai bàn ở bù giờ hiệp một; bù giờ hiệp trước còn làm lệch phép suy hiệp tiếp theo.
- Clock chỉ có mô hình cộng thời gian và pause/resume; chưa có mô hình futsal timeout/effective time được xác lập. Không tự thêm các tính năng futsal nếu giải chưa áp dụng.
- Phải quyết định mô hình thời gian theo luật trước migration/API mới; không tự chọn giới hạn khác thay 120.

### F05 - P1: Sự kiện thay người, cầu thủ đang trên sân và chống lặp

- [createMatchEvent](../services/match-service/src/repositories/lineupRepository.ts#L161) chỉ kiểm tra player thuộc lineups; chưa kiểm tra đã vào sân/chưa vào sân/đã bị truất quyền.
- SUBSTITUTION_IN và SUBSTITUTION_OUT là hai bản ghi độc lập; thiếu cặp vào-ra nguyên tử và số lượt/người theo luật/điều lệ.
- Chưa thấy idempotency key riêng cho tạo event; retry sau timeout có thể ghi lặp.
- Điều kiện “clock đang chạy” áp cho tất cả loại sự kiện; cần xác định cách nhập thẻ/sửa sự kiện khi bóng ngoài cuộc hoặc trong giờ nghỉ theo bộ luật. Không tự cho mọi sự kiện đi qua khi pause.
- Hai thẻ vàng và truất quyền trong chính trận chưa được mô hình hóa rõ với thẻ đỏ trực tiếp.

### F06 - P1: Kết quả và thống kê chưa gắn đủ luật/phân đoạn

- [validateMatchScore](../services/match-service/src/services/matchResultValidation.ts) kiểm tra số nguyên 0..99, cặp ET/penalty và điều kiện hòa chung; không xác minh được phép ET/penalty ở giai đoạn/phương thức đó.
- Event PENALTY_GOAL đang được đếm như bàn thắng bình thường trong live score; không có loại lượt luân lưu riêng. Dễ lẫn luân lưu với penalty trong trận nếu dùng chung nút.
- Mặc định sau trận frontend lấy tổng goal event cho tỷ số chính thức; chưa tách bàn chính thức/ET khi có hiệp phụ. Backend chưa đối chiếu sự kiện với score hoặc buộc giải trình chênh lệch.
- Hướng sửa: thống nhất ý nghĩa các trường homeScore, extraTimeScore, penaltyScore và dữ liệu hiệp; luân lưu không vào GF/GA/vua phá lưới. Không tự sinh kết quả thắng thua.

### F07 - P1: Hoàn tất biên bản thường lệ chưa nguyên tử và retry chưa khép kín

- [submitMatchReport](../services/match-service/src/services/lineupService.ts#L166) gọi finalizeMatchReport rồi reviewMatchReport.
- [finalizeMatchReport](../services/match-service/src/repositories/lineupRepository.ts#L365) COMMIT PENDING trước; [updateMatchReport](../services/match-service/src/repositories/lineupRepository.ts#L476) mở transaction thứ hai để approve, cập nhật kết quả/BXH/nhánh.
- Transaction approve riêng đã có tính nguyên tử nội bộ, nhưng cả hành động thường lệ còn điểm dừng giữa hai transaction. Retry nộp lại PENDING gặp REPORT_EXISTS.
- Frontend còn lưu draft kết quả rồi gửi report bằng hai request; thông báo partial success đã có, nhưng không thay yêu cầu consistency của hành động xác nhận.
- Cần checkpoint và test fault injection trên database QA trước khi sửa; không mất submission snapshots.

### F08 - P1: Người chuẩn bị biên bản và người xác nhận cuối chưa nối đúng

- Controller ép requiresOrganizerReview khi người nộp có MANAGE_REPORT nhưng thiếu FINALIZE.
- Chưa có API để final authority xác nhận bản PENDING do hỗ trợ chuẩn bị; route review hiện chỉ BTC.
- Không được suy từ hạn chế hiện tại rằng mọi biên bản hỗ trợ phải BTC duyệt thường lệ. Giữ nguyên nguyên tắc trọng tài cuối xác nhận; cần làm rõ luồng ủy nhiệm chuẩn bị và ngoại lệ ở prompt riêng.
- [Chi tiết biên bản trọng tài](../apps/web-client/src/components/referee/RefereeReportsPage.tsx) còn hiển thị lineups/events/crew hiện tại; cần cho đối chiếu đúng lần submission khi có sửa đổi.
- Ghi chú UI thời tiết cho nhập 200 ký tự trong khi schema cơ sở weather VARCHAR(100); cần validation thống nhất nếu giữ trường này.

### F09 - P1: Hai đường BXH và tiêu chí chưa thống nhất

- [recalculateStandings](../services/match-service/src/repositories/matchRepository.ts#L50) tính cố định thắng 3/hòa 1/thua 0.
- [listStandings](../services/match-service/src/repositories/matchRepository.ts#L1849) xếp cố định points, goal_difference, goals_for.
- [getFixtureGroupStandings](../services/match-service/src/services/fixtureGenerationService.ts#L182) và rankHybridGroup có đọc rules/criteria theo published draw; khi thiếu criteria vẫn có fallback cố định.
- HEAD_TO_HEAD đang áp cả điểm/hiệu số/bàn đối đầu thành một gói; phải khớp nghĩa điều lệ và cách xử lý dữ liệu đối đầu chưa đủ.
- Điểm phạt fair-play trong repository có hệ số cố định, chưa tham số hóa/nguồn căn cứ theo giải.
- Giữ generator/BYE/IDs đang hoạt động; thống nhất nguồn quy tắc và một phép tính nghiệp vụ khi có prompt triển khai, không viết lại toàn bộ sơ đồ.

### F10 - P1: Gate điều hành và thống kê bước vẫn dựa trọng tài cũ

- [assertSchedulesReady](../services/tournament-service/src/services/tournamentService.ts#L588) yêu cầu mọi schedule có refereeId.
- Luồng công bố tổ mới lưu schedule_referee_assignments, không cập nhật cột referee_id của schedules.
- [BtcTournamentWorkspace](../apps/web-client/src/components/BtcTournamentWorkspace.tsx#L137) cũng tính hoàn tất Bước 6 bằng schedule.refereeId.
- Yêu cầu đã chốt cho phép công bố theo phạm vi, không bắt buộc cả giải xong trước khi một trận đủ điều kiện được tác nghiệp.
- Cần dùng readiness chính thức của tổ và phạm vi trận; làm rõ liên hệ trạng thái giải, tránh vòng khóa IN_PROGRESS -> Step 7. Không giả điền refereeId để làm badge xanh.

### F11 - P1: Bắt đầu/kết thúc giải và ngoại lệ chưa đồng bộ đầy đủ

- Match clock chưa thấy cập nhật trạng thái Tournament khi trận đầu bắt đầu; Tournament hiện chuyển qua API trạng thái riêng.
- [assertAllMatchesFinal](../services/tournament-service/src/services/tournamentService.ts#L609) đòi APPROVED result + APPROVED report cho mọi trận.
- Forfeit ghi kết quả chính thức/audit nhưng không tạo biên bản thi đấu; gate kết thúc chưa xét quyết định đó. Trận hủy/ngoại lệ cũng cần policy rõ.
- Gate hiện không kiểm tra đầy đủ khiếu nại/kháng nghị/quyết định đang mở để quyết định việc kết thúc giải theo điều lệ.
- Cần quy tắc hoàn tất theo trạng thái/quyết định được phép, không tự tạo report giả cho trận không đá.

### F12 - P1: Kỷ luật có nền thật nhưng còn lệch quyền và mô hình thẻ

- Outbox thực tế đã triển khai tại repository/worker; TODO “future discipline service” trong lineupService là comment cũ, không phải bằng chứng chưa có đồng bộ thẻ.
- POST /cards kiểm tra READ thay RECORD_EVENT. Có thể tạo card riêng không gắn event; cần ngăn quyền thấp hoặc hai đường ghi tạo dữ liệu không nhất quán.
- Chưa phân biệt đầy đủ thẻ vàng thứ hai, đỏ trực tiếp, thẻ trong luân lưu/nghỉ và truất quyền ngay trong trận so với án treo các trận sau.
- issueCard ghi card rồi lấy policy/tạo suspension ở thao tác tiếp theo; worker có retry nhưng cần test gián đoạn/concurrency và hoàn tác ngưỡng vàng.
- Có thời hạn kỹ thuật 365 ngày đi kèm án theo số trận; không được diễn giải thành quyết định treo một năm do luật.
- Án đã chốt ngưỡng theo giải phải được giữ; quy tắc reset thẻ qua giai đoạn và mức xử lý đỏ từng loại chưa xác định.

### F13 - P2: Deadline và quy trình khiếu nại chưa đủ căn cứ cho mọi giải

- Deadline hiện neo match.updatedAt hoặc report.verifiedAt; sau đó có thể khác mốc còi kết thúc thực tế.
- Appeal dùng lại complaintWindowHours từ lúc reviewedAt. Không có quy tắc riêng đã xác minh cho mọi giải.
- Backend có scope và audit, không tự thay tỷ số khi đơn được gửi/chấp nhận. Đây là phần cần giữ.
- Cần chốt mốc/đơn vị/thời hạn theo điều lệ; không áp ví dụ 24 giờ của DEMO hoặc ví dụ của giải sinh viên ngoài hệ thống thành mặc định bắt buộc.

### F14 - P1/P2: Hoãn, hủy và clock/lịch có thể lệch nhau

- [reviewMatchPauseRequest](../services/match-service/src/repositories/matchPauseRequestRepository.ts#L78) đổi match sang POSTPONED nhưng không dừng clock, đồng bộ schedule hoặc phát matchRealtime trong cùng xử lý.
- Các thao tác update thông thường và resume cần kiểm tra lại người có quyền, trạng thái và lịch đang công bố.
- Quyết định dừng tạm thời, hoãn đá tiếp, bỏ dở, hủy và xử thua không đồng nghĩa nhau; không dùng một nút hoặc một status thay tất cả.
- Thông báo forfeit là best-effort sau commit, chưa có outbox bảo đảm giao nhận.

### F15 - P2: Ranh giới nhất quán và dữ liệu công khai cần kiểm thử

- Lịch commit ở Scheduling, projection/realtime ở Match là hai transaction. Cần retry/outbox bền vững nếu muốn bảo đảm khi restart/timeout; không thêm service hay truy cập DB service khác.
- Match SSE replay giới hạn 200, retention 30 ngày; cần cách yêu cầu tải lại trạng thái khi vượt backlog.
- Public cards/suspension-check chưa thấy cùng gate visibility như public fixture; cần kiểm tra không lộ giải chưa công bố hoặc dữ liệu cá nhân không được phép.
- Thu hồi/thay thế tổ cần kiểm thử với trang đang mở, refresh, session còn sống và nhiều tài khoản. Không chỉ kiểm tra nút ẩn.
- Giao diện giữ state nháp sau SSE là tiện ích; không coi draft chưa lưu ở React là dữ liệu đã bền vững.

## 9. Các quyết định nghiệp vụ phải giữ nguyên

1. Giữ năm backend services, Gateway, một frontend chính thức và database hiện có.
2. Giữ giao diện trọng tài **cam-đen** cùng sidebar/header hiện tại; sáu route riêng:
   - /referee
   - /referee/assignments
   - /referee/assignments/:matchId
   - /referee/matches/:matchId/operation
   - /referee/reports
   - /referee/reports/:matchId
3. Overview chỉ tổng quan/lịch/thông báo; tác nghiệp có Trước trận -> Điều hành -> Sau trận, chỉ hiện phần đang dùng. Không đưa UI cũ trở lại.
4. BTC quyết định người được phân công, hệ thống chỉ lọc/gợi ý. Không tự gán; không có nhận/từ chối nhiệm vụ.
5. Vị trí và quyền lấy từ phân công chính trận; không có dropdown tự đổi nhiệm vụ. Có đúng một người xác nhận cuối theo cấu hình.
6. Trận bình thường do trọng tài cuối xác nhận; BTC xử lý ngoại lệ, khiếu nại hoặc quyết định hành chính có căn cứ/audit.
7. Giữ Bước 1-5, bốn công đoạn Bước 5, ba chế độ xem, thuật toán đã đúng và nút Đóng/Mở đăng ký DEV.
8. Khóa lịch, công bố lịch và công bố phân công là các trạng thái riêng. Không bắt khóa mọi trận hoặc có trọng tài trước công bố lịch.
9. Sử dụng API/PostgreSQL thật. Không thêm mock fallback, test panel, frontend cổng khác hoặc biến snapshot test thành dữ liệu chính thức.
10. Giữ snapshot nghiệp vụ hợp lệ: roster chốt, điều lệ, vị trí đã công bố, phiên bản phân công và lần nộp biên bản.
11. SMTP thật theo cấu hình hiện có; lỗi gửi không xóa dữ liệu đã lưu. Không gửi email chỉ do reload; không tự bật/tắt/đổi provider.
12. Không mở rộng VAR, video livestream, GPS, AI nhận diện cầu thủ hoặc service mới.

## 10. Điểm chưa xác định - không được hardcode thay BTC

| Quyết định còn thiếu/chưa đồng nhất | Dữ liệu hiện có | Cần xác nhận trước phần triển khai phụ thuộc |
|---|---|---|
| Bộ luật và edition áp dụng cho mỗi giải | Chỉ có football_format và nội dung điều lệ chung | 5 người ngoài trời hay futsal; bản VFF/IFAB và sửa đổi giải được phép |
| Hạn nộp/sửa đội hình, quyền mở lại | Chưa có cấu hình đầy đủ | Mốc/đơn vị, trường hợp trễ/ngoại lệ và audit |
| Số cầu thủ tối thiểu, dự bị, thủ môn, số áo trong trận | Có roster giải và isStarting | Ràng buộc theo luật đã chọn, khác với giới hạn đăng ký giải |
| Thay người/số lượt/quay lại sân | Chỉ event IN/OUT | Quy tắc theo luật/điều lệ, xử lý hiệp phụ và cầu thủ đã bị đuổi |
| Cách đếm đồng hồ, bù giờ và kết thúc hiệp | Clock tăng giây, pause/resume | Mô hình theo loại giải; quyền ghi bù giờ; không tự kết thúc |
| Ghi từng lượt luân lưu hay chỉ tổng tỷ số | Hiện chỉ có tổng penalty score | Phạm vi cần số hóa và quyền xác nhận; tách thống kê bàn trong trận |
| Chuẩn bị biên bản bởi hỗ trợ | MANAGE_REPORT và FINALIZE | Trọng tài cuối duyệt bản chuẩn bị như thế nào; ngoại lệ nào chuyển BTC |
| Phân công theo phạm vi và thời điểm mở điều hành | Step 6 cho công bố phạm vi, Tournament gate còn cả giải | Điều kiện giải và từng trận, không đòi công bố tất cả nếu không cần |
| Cộng/giảm điểm, fair-play, đối đầu bằng điểm | Có criteria code, thiếu tham số một số tiêu chí | Dùng đúng điều lệ; không thêm trọng số/tiêu chí mặc định ngầm |
| Hai vàng/đỏ, xóa thẻ qua vòng, thời gian phục án | Ngưỡng và suspensionMatches theo giải | Phân biệt xử lý trong trận và án tiếp theo; không tự đặt mức án |
| Trận hoãn/bỏ dở/không đủ người | Status và forfeit policy cơ bản | Đá tiếp/từ phút nào/đá lại/xử thua/thẩm quyền/chứng cứ |
| Mốc và hạn khiếu nại/kháng nghị | complaintWindowHours; hiện neo updatedAt/verifiedAt | Mốc bắt đầu riêng và điều kiện ngăn kết thúc giải |
| Thời điểm chuyển giải IN_PROGRESS/COMPLETED | API trạng thái và gate cũ | Tự động hay BTC xác nhận, nhất quán với trận đầu/cuối và ngoại lệ |

**30 phút nghỉ tối thiểu** đang là yêu cầu phần mềm trong UC 3.7.4 và validation Tournament, không phải quy tắc IFAB chung. Baseline không thêm mức mới và cũng không tự gỡ yêu cầu đã có. Nếu muốn thay đổi phải nêu quyết định nghiệp vụ và kiểm thử ảnh hưởng.

## 11. Thứ tự triển khai cho các prompt sau

Đây là kế hoạch, chưa phải các thay đổi đã thực hiện.

| Đợt | Phạm vi tập trung | Điều kiện kết thúc đợt |
|---|---|---|
| 1 | Xác lập bộ luật/edition và các tham số còn thiếu; chốt mâu thuẫn UC cũ/mới | Các quyết định áp dụng có nguồn/phiên bản; không tự sửa điều lệ đã công bố |
| 2 | F01/F10: kết nối đúng pool/readiness, mở tác nghiệp theo trận/phạm vi | API đọc/điều kiện bắt đầu đúng lịch, đúng crew; kiểm thử không ghi sai giải |
| 3 | F02: roster -> đội hình trận, validation và khóa theo trạng thái | Đội trưởng nộp, hai đội xác nhận, trọng tài kiểm tra; âm tính sai roster/scope/trùng |
| 4 | F03/F04/F14: state machine trận/clock/hiệp/hoãn theo luật | Multi-device/reload/version/không bắt đầu sớm/không resume trận hủy; dữ liệu bền |
| 5 | F05/F06/F12: sự kiện, thay người, thẻ và luân lưu | Không đếm lẫn, không lặp, không cho người đã ra/bị đuổi tác nghiệp trái luật; outbox retry |
| 6 | F07/F08: biên bản và xác nhận nguyên tử, retry/ngoại lệ | Một final authority; fault injection không để kết quả/BXH lệch; snapshot giữ nguyên |
| 7 | F09: thống nhất BXH, thống kê, qualifiers/knockout từ kết quả thật | Ba thể thức, tie-break theo điều lệ, BYE/nguồn thắng-thua, correction ảnh hưởng đúng |
| 8 | F11/F13: điều hành/kết thúc giải và quyết định ngoại lệ | Forfeit/hủy/complaint được xử lý theo policy; không cần report thi đấu giả |
| 9 | F15: realtime và nghiệm thu tích hợp | Restart/reconnect/mất mạng/backlog/RBAC, Docker chính thức và UI cam-đen giữ nguyên |

Nếu prompt sau thay thứ tự hoặc quyết định, phải ghi lý do, căn cứ, phạm vi ảnh hưởng và cập nhật revision baseline. Không âm thầm đánh dấu yêu cầu chưa rõ là đã thống nhất.

## 12. Kiểm thử, checkpoint và tiêu chí nghiệm thu

### 12.1. Những gì thực hiện trong Prompt 0

| Hạng mục | Kết quả | Giới hạn |
|---|---|---|
| Đối chiếu văn bản luật và phiên bản | Đã thực hiện | Tình trạng pháp lý đầy đủ VFF 5 người và mọi sửa đổi sau bản 7 người 2023 chưa xác định |
| Đọc source/routes/validation/repository/schema/migration | Đã thực hiện theo các miền trong baseline | Không phải phân tích bảo mật toàn bộ mọi route/tất cả dòng source |
| Đọc PostgreSQL chính thức | PASS - đọc READ ONLY | Không chạy mutation hoặc diễn tập phục hồi |
| API GET thật qua phiên trình duyệt hiện có | PASS - 5 request, lúc 15:25 +07:00 | Workspace trọng tài HTTP 200/1 trận; danh sách trận ba giải HTTP 200, total 12/15/31; live HTTP 200/0 trận. Giải kết hợp trả trang đầu 20/31, không suy là thiếu 11 trận |
| Container/health | PASS - trạng thái hiện tại | Không build/restart; không đồng nghĩa E2E |
| Đọc UI Tổng quan trọng tài trên trình duyệt đang chia sẻ | PASS - trạng thái đọc | Đúng tài khoản đang có 1 phân công; không nghiệm thu mọi màn hình |
| Bắt đầu trận/đá hiệp/ghi sự kiện/biên bản/BXH/knockout/kết thúc giải | NOT TESTED | Chưa có dữ liệu thi đấu; trận tương lai; F01 chặn đường bắt đầu |
| SMTP gửi/nhận mới | NOT TESTED | Chỉ đọc ledger; không gửi thư |
| Typecheck/build/unit/integration trong Prompt 0 | NOT RUN | Đây là đợt rà soát chỉ đọc; không lấy build cũ làm PASS mới |

Báo cáo trước 26/11 ghi 169 PASS / 34 SKIP cho bộ Match ở QA và 15 test frontend trọng tài; đó là **HIST**. Các test thuần transition/prerequisites không chứng minh đường START_MATCH dùng đúng database. Một số báo cáo 16/11 còn mô tả flow duyệt cũ; không tái sử dụng kết luận đó để bỏ qua lỗi đang có.

### 12.2. Bộ kiểm thử bắt buộc trước khi nghiệm thu triển khai tiếp

Chỉ ghi dữ liệu trên giải dành riêng cho QA và database QA được kiểm soát, không tự duyệt đội/sửa lịch các giải người dùng đang thao tác.

1. API Gateway/Auth: anonymous, sai role, sai BTC giải, sai đội, referee không được giao/bị thay thế, nhiều role, tài khoản bị khóa/hết session.
2. Roster/đội hình: người trong CLB nhưng ngoài roster giải; đã rút/treo giò; hai đội khác giải; duplicate/số áo; min/max/thủ môn; sửa sau khóa và race hai client.
3. Readiness: đã công bố lịch nhưng chưa công bố crew; crew nháp/void; công bố phạm vi; danh tính final authority duy nhất; chưa tới giờ.
4. Clock: toàn bộ transition hợp lệ/bất hợp lệ, ET/penalty theo stage/method/tỷ số, expectedVersion, reload, process restart, thời gian máy khách lệch.
5. Hiệp/bù giờ: sự kiện ở cuối từng hiệp, sau phút 120 nếu luật/diễn biến yêu cầu, không gán nhầm hiệp từ tổng phút.
6. Event: ghi bàn/own goal/penalty trong trận, từng lượt hoặc tổng luân lưu đúng phạm vi; chống double-click/retry; void có lý do; quyền RECORD_EVENT/EDIT_EVENT.
7. Thay người/thẻ: đúng người đang trên sân, cặp vào-ra nguyên tử, giới hạn luật, thẻ vàng thứ hai/đỏ trực tiếp, outbox issue/void/retry, đúng án của giải.
8. Biên bản: draft/reload, hỗ trợ chuẩn bị/final authority xác nhận, ngoại lệ BTC, sửa/nộp lại, timeout giữa các bước, kết quả và BXH đồng nhất khi lỗi.
9. Ba thể thức: RR một bảng một/hai lượt; KO có/không BYE; hybrid hoàn tất bảng -> xác định qualifiers -> đúng nhánh/nguồn; không chọn đội thắng khi chưa có kết quả.
10. BXH: điểm khác 3/1/0, đúng thứ tự tie-break, đối đầu thiếu/đủ, fair-play theo policy, lot draw có audit, không lấy PENDING/REJECTED.
11. Correction/ngoại lệ: đổi người thắng khi trận con chưa/chính thức có lịch/đã đá; không đổi ID; forfeit theo policy; hủy/hoãn/kết thúc giải.
12. Realtime: hai client nhận sau commit; rollback không phát; mất mạng/reconnect/backlog lớn; quyền người bị thay thế hết hiệu lực; không gửi email chỉ do mở trang.
13. UI: giữ sáu route, cam-đen, một giao diện; overview không có form tác nghiệp; ba giai đoạn không xổ cùng lúc; dữ liệu tên/trạng thái Việt hóa.
14. Regression Bước 1-6: lịch, sân, draw, fixture, roster và dev đăng ký giữ nguyên.
15. Typecheck, production build, API/integration tests, Compose config, build **chỉ service có thay đổi**, kiểm tra image/build context/routing và chạy thật cổng chính thức.

### 12.3. Checkpoint an toàn cho mỗi đợt

- Ghi HEAD + dirty paths/hash trước khi sửa; không commit lẫn công việc của người dùng.
- Chốt phạm vi file và quyết định liên quan mã Fxx; tạo checkpoint có thể khôi phục trước thay đổi.
- Trước migration hoặc mutation có rủi ro: backup phù hợp, kiểm tra đọc/khôi phục trên bản sao, migration bổ sung transactional và chạy lại an toàn.
- Ghi số liệu/IDs và signature trước-sau cho phần cần giữ; không làm mới tất cả dữ liệu để test dễ hơn.
- Chạy test âm và lỗi giữa chừng cùng test thành công. Ca SKIP/NOT TESTED vẫn phải giữ nhãn.
- Sau mỗi màn hình/nghiệp vụ, kiểm tra trước khi tiếp tục; không sửa dàn trải để che lỗi.
- Cập nhật tài liệu/API thay đổi, ảnh runtime cần thiết và bảng PASS/FAIL/NOT TESTED. Build/health không đủ tiêu chí hoàn thành.

## 13. Kết luận baseline

Hệ thống đã có dữ liệu chính thức cho điều lệ, roster chốt, draw, fixture, lịch và phân công; frontend trọng tài mới và nhiều nền tảng tác nghiệp đã tồn tại. **Chưa có bằng chứng một trận ở dữ liệu hiện tại đi xuyên suốt đến kết quả/BXH/nhánh chính thức.**

Lỗi ưu tiên đầu là START_MATCH đọc nhầm database, gate đội hình chỉ chắc ở frontend, gate Tournament còn dựa refereeId cũ, và hai phép tính BXH chưa thống nhất. Phải xử lý có phạm vi và kiểm thử theo các prompt triển khai tiếp theo.

Prompt 0 dừng tại tài liệu này. Không thay đổi nghiệp vụ chưa xác định, không sửa giao diện và không thao tác ghi vào dữ liệu giải đấu.

**Kiểm tra bảo toàn cuối lượt:** so sánh SHA-256 của cả 33 đường dẫn đã thay đổi/chưa track từ trước cho kết quả không có file nào đổi. File thêm vào repo trong Prompt 0 chỉ là baseline này. Các file PDF/ảnh luật tải để đọc nằm trong thư mục tạm ngoài repo. Không build, migration hoặc gửi email.

## 14. Bổ sung triển khai Prompt 2 — nền quy tắc có phiên bản

**Ngày:** 26/11/2026. Các mục 1–13 mô tả lần rà soát Prompt 0; không dùng số PASS cũ để nghiệm thu bản mới. Kết quả dưới đây tiếp nối [Prompt 1](./MATCH_OPERATION_PROMPT_01_REPORT.md).

### 14.1. Cập nhật đối chiếu mục 2

Đã đọc lại IFAB 2026/27 trên trang chính thức, Luật 3/7/10 của sách VFF 433/QĐ-LĐBĐVN ngày 22/08/2023, sách FIFA Futsal 2026/27 hiệu lực 22/10/2026; tìm lại thông báo VFF/VietFootball nhưng chưa xác minh được văn bản sửa đổi bộ luật 7 người sau 2023. Không gắn nhãn văn bản 5 người năm 1998 là mới nhất. Không tự chọn futsal cho giải IUH sân 5.

Chi tiết nguồn, điều khoản, các giới hạn triển khai và ma trận giá trị: [MATCH_RULES_MATRIX.md](./MATCH_RULES_MATRIX.md). Sách luật là căn cứ cho profile được BTC chọn rõ; điều lệ riêng vẫn quyết định những nội dung luật cho phép lựa chọn.

### 14.2. Quyết định kỹ thuật nối tiếp mục 9

- Giữ năm services, session cookie/Redis, SSE và PostgreSQL LISTEN/NOTIFY; không thêm broker/service/route giao diện song song.
- Quy tắc là dữ liệu có phiên bản. Tournament sở hữu bản bổ sung gắn điều lệ gốc; Match sở hữu bản áp dụng bất biến và lịch sử từng trận. Không truy cập database chéo service.
- Dùng snapshot điều lệ **nghiệp vụ** đã gắn draw chính thức, kể cả draw đã lưu trữ. Không dùng snapshot test hoặc điều lệ hiện tại làm fallback khi bản gốc lỗi/thiếu.
- Rà soát thực tế phát hiện draw vòng tròn và knockout cũ không lưu snapshot điều lệ, fixture cũng không có version. API đọc báo nguồn chưa xác định thay vì crash hay giả định v1. Bản bổ sung mới có thể lưu căn cứ điều lệ hiện có tại thời điểm tạo; khi áp dụng cho trận thiếu nguồn, BTC phải xác nhận rõ căn cứ này. Audit phân biệt `VERSIONED_SUPPLEMENT_BASE` với `DRAW_SNAPSHOT`; không sửa draw/fixture lịch sử.
- Bản bổ sung mới cần lý do, quyền BTC đúng giải, revision kỳ vọng và công bố có audit. Công bố không tự thay quy tắc các trận đang có.
- Áp dụng cho trận là quyết định rõ ràng của BTC, có danh sách trận/revision. Chặn luồng thông thường khi đã có dữ liệu tác nghiệp hoặc đã xác nhận sẵn sàng. Lịch, đội, ID và phân công giữ nguyên.
- Một resolver dùng chung kiểu dữ liệu/validation cho frontend, Tournament và Match. Match API và `referee-context` trả cùng bản áp dụng; guard backend dùng bản đó.
- Chưa xác định lưu `null`; chỉ chặn thao tác cần trường đó. Thiếu thay người/kỷ luật không tự chặn thao tác đồng hồ có đủ căn cứ. Các hạn đội hình không bắt buộc nếu điều lệ chưa đặt.
- Bảo toàn giao diện trọng tài, Bước 1–5, cấu hình phân công, nút đăng ký dev, SMTP và môi trường 15173. Chỉ thêm nhóm thu gọn trong màn hình điều lệ hiện có và thông tin nguồn quy tắc trong chi tiết trận.

### 14.3. Trạng thái các điểm chưa xác định ở mục 10

Đã có nơi lưu và cung cấp phiên bản cho bộ luật/loại hình/nguồn, giới hạn đội hình trận, thời gian/đồng hồ, thay người, kỷ luật, hòa theo giai đoạn và khiếu nại. **Có mô hình dữ liệu không có nghĩa BTC đã quyết định các giá trị còn thiếu hoặc các engine tác nghiệp đã được nghiệm thu.**

Ba giải demo vẫn dùng điều lệ v1 như trước. Chưa tạo/công bố/áp dụng bản bổ sung trên dữ liệu chính thức. Các quyết định thật cần BTC: bộ luật sân 5; bộ luật/edition và điều chỉnh hợp lệ của từng giải; dự bị, số áo, nghỉ giữa hiệp, hạn/quyền đội hình nếu có; chính sách hòa vòng bảng, thay người được lựa chọn, kỷ luật/xóa thẻ, fair-play và mốc/thủ tục khiếu nại. Không tự bổ sung 30/60 phút, số trận treo giò, tỷ số xử thua hay thời gian hiệp phụ để test vượt qua.

### 14.4. Code và database

| Phần | Thay đổi |
|---|---|
| [Mô hình dùng chung](../packages/shared/src/matchOperationRules.ts) | Profile luật có nguồn, dữ liệu nullable, validation, resolver theo giai đoạn, danh sách quy tắc thiếu theo nghiệp vụ |
| [Migration Tournament 26](../services/tournament-service/src/db/matchOperationRulesMigration.ts) | Bảng `regulation_operation_rules`, FK điều lệ gốc, revision/audit, trigger chống sửa bản công bố |
| [Migration Tournament 27](../services/tournament-service/src/db/matchOperationRulesBaseMigration.ts) | Bổ sung `base_snapshot` nullable vào bảng mới và trigger bảo vệ; phục vụ quyết định bổ sung căn cứ cho draw cũ, không backfill dữ liệu lịch sử |
| [Repository Tournament](../services/tournament-service/src/repositories/matchOperationRulesRepository.ts) / [controller](../services/tournament-service/src/controllers/matchOperationRulesController.ts) | Lưu nháp/công bố/đọc đúng snapshot; kiểm tra quyền, trạng thái, số liệu và revision |
| [Migration Match 22](../services/match-service/src/db/matchOperationRulesMigration.ts) | Bảng append-only `match_operation_rule_bindings`, không ghi đè dữ liệu cũ |
| [Resolver/áp dụng Match](../services/match-service/src/services/matchOperationRulesService.ts) / [controller](../services/match-service/src/controllers/matchOperationRulesController.ts) | API nguồn quy tắc, transaction áp dụng rõ phạm vi, bảo vệ trận đã tác nghiệp, quyền đọc và kiểm tra backend |
| [Điều lệ hiện tại](../apps/web-client/src/components/TournamentDetailPanel.tsx) / [nhóm trường](../apps/web-client/src/components/MatchOperationRulesSection.tsx) | Một khu vực thu gọn trong màn hình hiện có; không đưa phương thức bốc thăm/hạt giống trở lại |
| [API frontend](../apps/web-client/src/api/matchOperationRules.ts) / [chi tiết trọng tài](../apps/web-client/src/components/referee/RefereeMatchDetailPage.tsx) | Đọc/lưu API thật; hiển thị nguồn và bản áp dụng của trận |
| Guards và policy | Nối resolver vào clock, xác nhận đội hình, sự kiện, tỷ số/biên bản; policy có matchId đọc bản gốc của trận thay vì điều lệ mutable mới nhất |
| Build context | Loại `output/` và `backups/` khỏi Docker context để không đưa bản sao database/bằng chứng QA vào image build |

### 14.5. Kiểm chứng mới và điểm còn giữ lại

- Typecheck toàn workspace: **PASS**.
- Tournament suite: **44 PASS / 20 SKIP / 0 FAIL**, gồm 16 test quy tắc mới.
- Match suite: **185 PASS / 34 SKIP / 0 FAIL**, gồm 9 test guard mới. Các test database opt-in còn SKIP; không gán PASS.
- Frontend trọng tài: **21/21 PASS**; production build PASS, còn cảnh báo bundle lớn có từ trước.
- API/PostgreSQL QA: lưu nháp, công bố, công bố lại idempotent, revision cũ, áp dụng/đọc lại, bản nháp mới không đổi trận đã pin, thiếu quy tắc, sai format, RBAC, chặn trận sẵn sàng, trigger bất biến và so sánh dữ liệu: **PASS**. Xem [log có tên từng ca](../output/match-operation-prompt-02/qa-api-checks.json).
- Tổng ba lượt API/DB QA: **31 ca PASS** (19 + 4 + 8). [Kiểm tra compiled](../output/match-operation-prompt-02/qa-final-source-checks.json) xác nhận áp dụng/idempotency; [kiểm tra nguồn lịch sử](../output/match-operation-prompt-02/qa-legacy-source-checks.json) xác nhận đọc thiếu nguồn, bắt buộc BTC xác nhận trước áp dụng, lưu căn cứ mới và không sửa draw/fixture cũ. Không suy ra E2E thi đấu từ các ca này.
- QA dùng hai database mới từ dump, Auth/Gateway thật, không dùng endpoint test hoặc sửa bảng điều lệ đã công bố. Scheduling chỉ được kết nối READ ONLY phục vụ kiểm tra quyền. Hash các bảng nghiệp vụ Tournament/Match chính thức trước/sau QA bằng nhau.
- Sao lưu hai database trước migration: `backups/match-operation-prompt-02-20261126-001/`. Đã restore vào database QA mới và kiểm chứng. Không ghi đè backup hoặc database chính thức.
- Docker chính thức 5173 đã build/cập nhật Tournament, Match và frontend; migration Tournament 26/27, Match 22 có trên database. Chín container runtime chạy, tám healthcheck healthy; bundle HTTP khớp hash bản build cuối. [API runtime](../output/match-operation-prompt-02/runtime-api-proof.json) xác nhận 12/15/31 trận và frontend/backend cùng bản quy tắc của trận được phân công.
- Đối chiếu cuối có hoạt động dữ liệu mới: thêm hai giải cùng dữ liệu phụ thuộc; 584 participation claims và 36 reservations chỉ đổi `updated_at`. Không suy đoán tác nhân và không ghi đè. [Đối chiếu từng khóa](../output/match-operation-prompt-02/official-row-preservation.json) xác nhận không mất bản ghi cũ hoặc thay nội dung nghiệp vụ cũ; các bảng Match giữ nguyên. Vì vậy không ghi PASS “toàn database Tournament không đổi” cho lần kiểm tra cuối.
- Checkpoint source trước sửa: [manifest](../output/match-operation-prompt-02/checkpoint-before/manifest.json), SHA-256 `e7323bee9f291d4a019c2823fb35386653b04298125c69f4f930dd2e1a3a7216`, HEAD `27fa2bd9fef76f23bc6cb16b939f124735c8cea0`. Lưu các thay đổi chưa commit; không reset/stash/checkout hoặc commit gộp thay đổi cũ.
- Checkpoint sau triển khai: [manifest](../output/match-operation-prompt-02/checkpoint-after/manifest.json), gồm bản sao source, diff và hash. Trong 24 đường dẫn có từ trước, 18 giữ nguyên byte, sáu sửa đúng phạm vi; không mất file. Chi tiết [bảo toàn source](../output/match-operation-prompt-02/source-preservation.json). HEAD không đổi; không gọi bản sao file là Git commit.
- Kiểm tra trình duyệt chính thức: đọc được nguồn điều lệ và phần còn thiếu trên trang chi tiết/tác nghiệp; chưa nghiệm thu thao tác toàn bộ form BTC qua trình duyệt hoặc bộ ảnh đầy đủ. Lưu/công bố/áp dụng được kiểm thử bằng API thật trên QA; không công bố cấu hình thay BTC ở ba giải đang sử dụng. [Bảng bàn giao và giới hạn](./MATCH_RULES_MATRIX.md#8-bàn-giao-bản-chạy-chính-thức).
- **NOT TESTED E2E:** trận hoàn chỉnh, thay người thực tế, tính kỷ luật/xóa thẻ, đồng hồ futsal, khiếu nại, BXH/nhánh sau kết quả. Các F01–F15 ở mục 8 vẫn cần xử lý theo prompt tương ứng. Guard quy tắc không sửa F01 đọc sai pool, F02 roster gate, F04/F05 event model, F07 transaction biên bản, F09 BXH hoặc F12/F13 tính kỷ luật/khiếu nại. Không bắt đầu trận tương lai hay chèn kết quả để che các lỗi đó.

Prompt 2 dừng ở nền quy tắc và phiên bản; chưa thực hiện các đợt điều hành tiếp theo.

## 15. Bổ sung Prompt 3 — F01/F10 và mở tác nghiệp theo trận

Các mục 1–13 giữ lại hiện trạng lịch sử Prompt 0; xem [báo cáo Prompt 3](./MATCH_OPERATION_PROMPT_03_REPORT.md) cho code, API, cơ chế khóa và bằng chứng mới.

- **F01: PASS trên API/PostgreSQL QA.** START_MATCH dùng Scheduling repository/pool đọc và khóa lịch/tổ công bố; Match repository/pool chỉ ghi trận/clock. Không có `schedules`/`schedule_referee_assignments` giả trong Match DB.
- **Nhất quán:** giữ Scheduling parent row FOR SHARE qua Match commit; các đường ghi lịch/tổ dùng FOR UPDATE và kiểm tra lại trạng thái trận sau khóa. Hai transaction độc lập, không coi là transaction xuyên database hoặc two-phase commit. HTTP thay người đồng thời đã được quan sát chờ khóa, rồi bị chặn sau khi thao tác clock commit. Fault injection mất kết nối/failover vẫn NOT TESTED.
- **F10: PASS API QA.** Tournament và BTC sử dụng readiness từ tổ công bố mới, không `schedule.refereeId`. Nháp không hoàn thành Bước 6. Một phạm vi có trận hợp lệ đủ mở trang chuẩn bị/Bước 7, không cần phân công toàn giải. Bắt đầu trận vẫn cần giải IN_PROGRESS, đúng người/quyền, đội hình và giờ đấu.
- **Quyền:** BTC+REFEREE không vượt kiểm tra phân công/capability. Các endpoint clock/sẵn sàng/sự kiện/tỷ số/gửi biên bản/ghi thẻ dùng quyền chuyên môn và khóa Scheduling. Quyền xử lý ngoại lệ của BTC theo endpoint quản lý hiện có được giữ. Tài khoản đang hoạt động được xác minh qua Auth; không sửa session/RBAC hoặc cấp role để test.
- **F02/F03:** thêm guard cơ bản cho đội hình trước khi sẵn sàng/bắt đầu và gọi guard kickoff trong đường clock thật. Không coi đây là hoàn thiện F02 hoặc toàn bộ F03–F04; không sửa trạng thái các trận cũ để vượt điều kiện.
- **Kiểm thử:** 203 PASS/34 SKIP Match, 44 PASS/20 SKIP Tournament, 23 PASS frontend; 20 ca API/PostgreSQL QA PASS (16 đầy đủ, 2 đồng thời và 2 đọc tiến độ). Typecheck và production build PASS. QA dùng bốn database phục hồi riêng, account/Auth/Gateway thật, thời điểm kiểm thử chỉ được điều khiển trong tiến trình QA. Các bảng nghiệp vụ chính thức giữ nguyên hash qua QA và lần đọc runtime cuối.
- **Runtime chính thức:** Auth, Match, Tournament và web đã build/cập nhật; 9 container runtime running, 8 healthcheck healthy; bundle HTTP trùng SHA-256 bản build cuối. API đọc đúng 12/15/31 trận của ba thể thức. Stepper BTC thực tế hiển thị 2/31 tổ đã công bố, chưa hoàn thành Bước 6, Bước 7 mở với 2 trận chuẩn bị, Bước 8 khóa. Trận tương lai không được START, trận cũ sẵn sàng nhưng đội hình trống cũng bị chặn. Chỉ kiểm tra DOM/gate trong trình duyệt, chưa nghiệm thu ảnh/toàn bộ tab hay E2E trận đấu. Bằng chứng trong [báo cáo](./MATCH_OPERATION_PROMPT_03_REPORT.md#bản-chạy-chính-thức).
- **Migration:** không có trong Prompt 3. Bảo toàn năm services, database ownership, SSE/PG NOTIFY, giao diện hiện tại, Bước 1–5, dev đăng ký, SMTP và môi trường đối chiếu.
- **Checkpoint:** [trước](../output/match-operation-prompt-03/checkpoint-before/manifest.json), [sau](../output/match-operation-prompt-03/checkpoint-after/manifest.json); giữ HEAD và các thay đổi chưa commit. Không tạo Git commit gộp.

**Chưa nghiệm thu E2E một trận hoàn chỉnh.** Dừng tại Prompt 3; không tự triển khai đội hình, clock/sự kiện, biên bản/BXH của các prompt tiếp theo.

## 16. Bổ sung Prompt 4 — đội hình theo trận và F02

**Ngày:** 26–27/11/2026, UTC+7. Các mục lịch sử ở trên không phải kết quả nghiệm thu bản mới. Phạm vi này tiếp nối nền quy tắc Prompt 2 và khóa/quyền Prompt 3; không triển khai tiếp clock, thay người, biên bản hoặc BXH.

### 16.1. Nguồn roster và ranh giới nghiệp vụ

- Organization cung cấp API nội bộ chỉ đọc roster hiện hành của đúng đội/giải. Match không đọc database Organization. Danh sách ứng viên là roster giải cùng snapshot hồ sơ đăng ký đã nộp, không phải toàn bộ thành viên CLB.
- Điều kiện bao gồm hồ sơ đội đã được duyệt, cầu thủ còn trong roster hiện hành, có trong danh sách đã nộp, xác nhận tham gia còn hiệu lực, không bị từ chối và chưa rời CLB. Match kiểm tra thêm treo giò cho ngày của chính trận đấu.
- Kiểm tra dữ liệu thực tế ghi nhận 664 dòng roster có đánh giá từng người `PENDING`/`is_verified=false`, dù hồ sơ đội đã được duyệt thống nhất. Không sửa quy trình duyệt hoặc tự đổi các cờ này. Quyết định duyệt cả hồ sơ, danh sách đã nộp và xác nhận của cầu thủ là các căn cứ đang có; đánh giá `REJECTED` vẫn bị loại.
- Giữ nguyên đăng ký đội, duyệt đội, roster đã chốt và các thay đổi roster hợp lệ. API nguồn không ghi dữ liệu vào những bảng đó.

### 16.2. Vòng đời đội hình và quyền

| Hành động | Người được phép | Kiểm tra và tác động |
|---|---|---|
| Lưu nháp / gửi đội hình | Đội trưởng hiện tại của đúng đội trong trận | Match `SCHEDULED`, fixture và lịch chính thức, trạng thái giải phù hợp, revision đúng, roster và quy tắc hiện hành |
| Xem hai đội / điều kiện dữ liệu | Trọng tài được phân công với `READ`; BTC đúng giải | Không cấp quyền chỉ bằng role REFEREE hoặc BTC |
| Kiểm tra tại sân / yêu cầu điều chỉnh | Người có `FINALIZE` theo phân công chính thức | Không đồng nhất đội trưởng gửi với trọng tài đã kiểm tra; yêu cầu điều chỉnh có lý do và lịch sử |
| Xác nhận trận sẵn sàng | Người xác nhận cuối hợp lệ | Hai đội đã gửi, dữ liệu hợp lệ, trọng tài đã kiểm tra, không còn vấn đề mở; kiểm tra trong transaction khóa chính trận |
| Ghi nhận vấn đề trước trận | Người có `RECORD_EVENT` của trận | Đội chưa có mặt, thiếu/người không hợp lệ, sân không bảo đảm hoặc vấn đề khác; chuyển BTC, không tự xử thua/đặt thời gian chờ |
| Xử lý vấn đề / mở lại chuẩn bị | BTC quản lý đúng giải | Lý do bắt buộc, audit; không mở lại sau khi clock/sự kiện đã bắt đầu; không tự xác nhận lại sẵn sàng |

- Trạng thái đội hình dùng `DRAFT`, `SUBMITTED`, `CHANGES_REQUESTED` cùng metadata kiểm tra. Không thêm enum nhiệm vụ trọng tài.
- **Gửi đội hình không tự tạo thời điểm khóa mới.** Khi trận vẫn `SCHEDULED` và còn trong thời hạn điều lệ, đội trưởng được sửa; mọi lần lưu sửa bỏ xác nhận cũ, cần gửi/kiểm tra lại. Trận `LINEUP_CONFIRMED` khóa đường chỉnh đội hình thông thường. Người có thẩm quyền yêu cầu điều chỉnh hoặc BTC mở lại có lý do theo quy trình trước trận.
- Hạn nộp/sửa chỉ áp dụng khi phiên bản điều lệ thực sự quy định. Giá trị chưa xác định không được thay bằng 30/60 phút. Mô tả tự do về thẩm quyền sửa sát giờ chưa được suy diễn thành quyền vượt hạn; thao tác hết hạn bị chặn và có thể ghi nhận vấn đề cho BTC.
- Một đường ghi nhất quán: lưu cả danh sách, legacy POST/confirm/DELETE đều qua cùng service, Match row lock, transaction, `expectedRevision` và history. Không cho xóa đội hình đang thi đấu bằng API trước trận.

### 16.3. F02 và kiểm tra lại trước START

`PUT /matches/:id/referee-status` không tin trạng thái từ frontend. Backend kiểm tra hai đội, roster/treo giò, số lượng/số áo/thủ môn theo quy tắc áp dụng, bản đã gửi và kiểm tra, phiên bản nguồn, phân công và trạng thái trận. Generic PUT cập nhật trận cũng không được dùng để đi vòng gate này.

START_MATCH gọi lại cùng kiểm tra dữ liệu dưới khóa Match và lease Scheduling đã có từ Prompt 3. Án treo giò phát sinh sau khi sẵn sàng làm START bị chặn. Không dùng một transaction PostgreSQL để giả định khóa được cả Match, Scheduling và Organization; nguồn roster đọc bằng API được kiểm tra mới, chưa nghiệm thu fault/race giữa commit của các service độc lập.

Trận `e45a599b-1377-4377-9016-3956cc4e0738` trên hệ thống chính thức vẫn `LINEUP_CONFIRMED` nhưng không có lineup. API trả `inconsistent=true`, chặn sẵn sàng/START và cung cấp xử lý mở lại có thẩm quyền. **Không tự sửa trạng thái, tạo cầu thủ hoặc điền đội hình cho trận này.**

### 16.4. Giao diện, dữ liệu và migration

- Đội trưởng mở **Chuẩn bị đội hình** từ danh sách lịch hiện có: thông tin hai đội, quy tắc trận, roster đủ/không đủ điều kiện, tìm kiếm, xuất phát/dự bị, số áo/vị trí, lỗi và lịch sử. Lưu/gửi qua API thật. Không tạo form trong hồ sơ đăng ký.
- Trọng tài giữ sáu route, layout cam–đen và ba giai đoạn. Trước trận hiển thị hai đội, trạng thái gửi/kiểm tra, cầu thủ và vấn đề cần xử lý. Không bắt nhập lại roster thay đội trưởng.
- BTC xử lý ngoại lệ trong màn hình quản lý trận hiện có. Không tạo route thử nghiệm hoặc frontend thứ hai.
- SSE và tải định kỳ dùng lại cơ chế hiện có. Phần nhập chưa lưu được bảo vệ khi có phản hồi tải chậm; cảnh báo thay đổi từ xa chỉ xuất hiện khi dữ liệu nguồn thực sự đổi.
- Migration Match **23** thêm `match_squads`, `match_squad_history`, `match_preparation_issues`; lịch sử append-only. Constraint số áo nền cho phép số nguyên dương, giới hạn cụ thể do phiên bản quy tắc quyết định. Không backfill trận cũ hoặc sửa migration đã áp dụng.
- Đã sao lưu năm database nghiệp vụ tại [backup Prompt 4](../backups/match-operation-prompt-04-20261126-001/) và phục hồi thành database QA riêng trước khi áp dụng migration. Không thay environment 15173, SMTP, nút đăng ký dev hoặc volume.

### 16.5. Kết quả kiểm chứng và giới hạn

- **PASS:** 32 ca API/PostgreSQL QA trên database riêng, gồm roster thực, sai đội/giải/người, cầu thủ đã rút/ngoài roster/treo giò, trùng người/số áo, thiếu người/thủ môn, lưu/reload, hai client cùng revision, legacy API, gửi khác kiểm tra, yêu cầu điều chỉnh, ngoại lệ BTC, dữ liệu không nhất quán và START kiểm tra lại. [Kết quả từng ca](../output/match-operation-prompt-04/qa-api-003.json).
- **PASS:** Match 215 test, frontend 27 test; Organization 5 test. Match 34 và Organization 14 bài opt-in **SKIP**. Unit kiểm tra profile 5/7/11, không dùng một số lượng cố định cho mọi giải.
- **PASS:** typecheck toàn workspace, production build, Docker Organization/Match/frontend và migration 23. Bản chính thức chạy cổng 5173; bundle HTTP khớp bản build. Chi tiết container và kiểm tra trình duyệt trong [báo cáo Prompt 4](./MATCH_OPERATION_PROMPT_04_REPORT.md).
- **PASS bảo toàn nội dung:** trong QA, năm database chính thức không đổi hash. Sau khởi chạy Organization, cơ chế reconciliation có sẵn cập nhật `updated_at` của 584 participation claims và 36 reservations. So sánh với bản phục hồi xác nhận đủ bản ghi và nội dung nghiệp vụ không đổi; không ghi PASS toàn bộ hash Tournament sau khởi chạy. Các bảng nghiệp vụ Match/Scheduling/Discipline/Team giữ nguyên; ba bảng mới chính thức vẫn trống.
- Kiểm tra màn hình BTC có lưu lại vị trí đang xem: `current_step` từ 4 sang 7 và `updated_at` cho giải kết hợp. So sánh toàn dòng chỉ ra đúng hai trường này đổi; không thay cờ hoàn thành hoặc trạng thái nghiệp vụ. Xem [đối chiếu điều hướng](../output/match-operation-prompt-04/workflow-row-comparison.json).
- **NOT TESTED:** gửi đội hình đầy đủ qua API cho profile 5/7, nhiều trình duyệt tương tác ghi cùng lúc, mất mạng/reconnect SSE, race thay roster giữa các service và toàn bộ trận đấu đến kết quả/BXH. Không bỏ SKIP hoặc suy ra PASS từ build.
- Trận chính thức đang kiểm tra vẫn thiếu quy tắc đội hình đã công bố/áp dụng. UI/API chặn gửi và sẵn sàng đúng điều kiện; không tự bổ sung điều lệ của giải người dùng để nghiệm thu giao diện.
- Checkpoint [trước](../output/match-operation-prompt-04/checkpoint-before/manifest.json), [sau](../output/match-operation-prompt-04/checkpoint-after/manifest.json), [đối chiếu bảo toàn source](../output/match-operation-prompt-04/source-preservation.json). Giữ HEAD và những thay đổi chưa commit, không commit gộp/reset/stash.

**Dừng trong phạm vi Prompt 4. Chưa nghiệm thu toàn bộ luồng điều hành trận đấu.**

## 17. Bổ sung Prompt 5 — F03, F04 và phần clock của F14

Ngày 27/11/2026, UTC+7. Giữ các mục trước làm lịch sử. Chi tiết source, API, kết quả và giới hạn ở [báo cáo Prompt 5](./MATCH_OPERATION_PROMPT_05_REPORT.md).

### 17.1. Gate và state machine

- Dùng chính state machine Match và các phase clock hiện có. Mỗi thao tác xác minh lại crew/capability dưới lease Scheduling, sau đó Match transaction/row lock và `expectedVersion`. Không dùng transaction PostgreSQL thông thường để giả định khóa nhiều database.
- START kiểm tra fixture/hai đội, lịch công bố/giờ thi đấu, phân công còn hiệu lực, quyền FINALIZE, đội hình hiện hành đã gửi/kiểm tra, điều kiện sẵn sàng và trạng thái giải/trận. Giữ gate Prompt 3–4, không có cờ bắt đầu sớm hoặc tự bắt đầu theo lịch.
- Bắt đầu/kết thúc thực tế có timestamp riêng. Không bắt đầu trùng, bỏ qua hiệp, kết thúc trước thời lượng hoặc resume trạng thái đã kết thúc/hoãn/hủy. Giữ các guard xử lý hòa theo phiên bản điều lệ; chi tiết phân định tiếp tục ở Prompt 7.
- Khi 409/version conflict hoặc mất quyền, frontend tải lại trạng thái chính thức và thông báo, không tự retry hành động cũ.

### 17.2. Clock và thời gian sự kiện

- Backend lưu mili giây tích lũy, timestamp chạy, thời điểm bắt đầu pha, actual start/end và mức bù giờ riêng từng hiệp. Ghi trong cùng pha rebase anchor để không cộng lặp; phần giây lẻ không mất khi Pause/Resume hoặc restart.
- CONTINUOUS khác STOPPED theo EffectiveMatchRules. Không dừng đồng hồ chạy liên tục cho gián đoạn thông thường. Có thao tác tạm dừng thi đấu riêng với lý do. Không tự coi giải sân 5 là futsal.
- Bù giờ tối thiểu không được giảm; không chuyển bù giờ giữa hai hiệp. Nghỉ không cộng vào thời gian chơi. Hiển thị thời gian dự kiến/đã nghỉ; không tự kết thúc hiệp hoặc tự bắt đầu hiệp kế. Không suy một thời gian nghỉ tối thiểu mới từ giới hạn tối đa của luật.
- Frontend dùng snapshot backend và delta monotonic, không gọi API từng giây. SSE vẫn dùng PostgreSQL LISTEN/NOTIFY và durable log; reconnect tải lại/replay, chỉ phát cập nhật đã commit.
- F04: bỏ trần phút 120 bằng migration mới. Sự kiện mới lưu pha thực tế, giây trong hiệp, phút hiển thị, bù giờ và sequence. Backend chặn sai pha/phiên bản/thời điểm tương lai. Hiệp một 45+3 vẫn FIRST_HALF; đơn vị thời gian hiệp phụ không bị clamp.
- Dữ liệu cũ thiếu pha không được suy diễn/backfill thành một hiệp cụ thể. Clock đang chạy theo mô hình cũ thiếu căn cứ bị gắn `reviewRequired`, không reset. Tỷ số hiệp một của dữ liệu sự kiện không đủ căn cứ được giữ chưa xác định.

### 17.3. Gián đoạn và migration

Các đường đổi trạng thái trận hiện có sang POSTPONED/CANCELLED và repository duyệt yêu cầu hoãn dừng clock trong cùng Match transaction, giữ thời gian/pha/dữ liệu. Trận đã chơi một phần không được đưa về SCHEDULED bằng thao tác thông thường để reset. Workflow quyết định đá tiếp/đình chỉ/toàn giải vẫn thuộc Prompt 10; không triển khai thêm ở đây.

Migration Match **24** thêm metadata clock/event và `match_clock_action_history` append-only; transactional, versioned, chạy lại an toàn. Không sửa migration cũ. Backup bảy database liên quan được giữ riêng, QA dùng bản phục hồi mới cho mỗi lần chạy, không ghi đè/drop dữ liệu QA cũ hoặc database chính thức.

### 17.4. Nghiệm thu và giới hạn

- **PASS 27 ca API/PostgreSQL QA**, [kết quả 007](../output/match-operation-prompt-05/qa-api-007.json): START đúng/sai điều kiện, quyền sau thay thế, hai hiệp/bù giờ/nghỉ, Pause khác tạm dừng, clock futsal được chọn rõ ràng, 45+3 đúng pha, form lỗi thời, hai clock action đồng thời, restart tiến trình thực, hai SSE client/replay/rollback, hoãn/hủy và audit append-only.
- Thời gian dài được điều khiển bằng Node test timer trong host QA riêng qua IPC; không thay giờ hệ thống, không thêm endpoint test hoặc nới gate production. Không gửi SMTP; nguồn đọc/lưu vẫn là API nghiệp vụ và PostgreSQL bản phục hồi.
- **PASS:** Match **226**, frontend **29** bài; Match **34 SKIP** được giữ nguyên nhãn. Typecheck/build toàn workspace, Docker Match/frontend, migration 24 và runtime chính thức đã kiểm tra.
- [Đối chiếu triển khai](../output/match-operation-prompt-05/official-runtime-proof.json) xác nhận cột nghiệp vụ cũ của năm database không đổi; lịch sử clock chính thức **0 dòng**, trận tương lai vẫn NOT_STARTED v0. Bundle HTTP và code container khớp bản build. Không tự bổ sung điều lệ hoặc đội hình cho các giải người dùng.
- Browser chính thức đã kiểm tra chuyển giai đoạn, scoreboard ở trận chưa bắt đầu, gate bị chặn, SSE sau reload và không tràn ngang ở kích thước đã quan sát. **NOT TESTED:** thao tác clock/form sự kiện tương tác trên browser của một trận đang chạy; mobile/touch hoàn chỉnh do viewport/emulation không ổn định. Không dùng các ảnh thử mobile để kết luận PASS.
- **NOT TESTED trong P5:** API đầy đủ profile 7 người, luồng Admin yêu cầu/BTC duyệt hoãn, fault/race đổi lịch/phân công với clock, restart container giữa trận thật và toàn bộ luân lưu/kết quả. Giữ cơ chế khóa Prompt 3 và các guard cần thiết; không tuyên bố hoàn thành nghiệp vụ của các prompt sau.
- Checkpoint [trước](../output/match-operation-prompt-05/checkpoint-before/manifest.json), [sau](../output/match-operation-prompt-05/checkpoint-after/manifest.json), [bảo toàn source](../output/match-operation-prompt-05/source-preservation.json). Giữ HEAD và thay đổi chưa commit, không commit gộp/reset/stash.

**Dừng tại Prompt 5. Chưa nghiệm thu toàn bộ phân hệ điều hành trận đấu.**

## 18. Prompt 6 — Sự kiện, thay người nguyên tử và nguồn thẻ

Cập nhật 27/11/2026. [Báo cáo chi tiết](./MATCH_OPERATION_PROMPT_06_REPORT.md), [QA API/PostgreSQL](../output/match-operation-prompt-06/qa-api-005.json), [runtime chính thức](../output/match-operation-prompt-06/official-runtime-proof.json).

- **F05 đã sửa trong phạm vi kiểm thử:** một request thay người ghi OUT/IN nguyên tử, liên kết pair; projection cầu thủ trên sân, dự bị, thay ra, rời sân tạm thời và truất quyền. Kiểm tra số người/cơ hội thay, tái nhập và bộ luật ghim theo trận; không dùng một giới hạn cho cả 5/7/11.
- Bàn thường, phản lưới, penalty trong hiệp được kiểm tra theo trạng thái tham gia. Vàng thứ hai khác đỏ trực tiếp. Thẻ khi tạm dừng/nghỉ không bị chặn chỉ vì clock không chạy. Futsal chỉ được áp dụng khi điều lệ chọn rõ; hỗ trợ trường hợp giảm quân/bổ sung tiêu chuẩn, chưa nghiệm thu mọi ngoại lệ lợi thế/DOGSO.
- **F12:** guard RECORD_EVENT đã có từ thay đổi trước được giữ và kiểm thử lại. POST /cards chuyển sang canonical Match event; nguồn chiếu duy nhất sang Discipline là ISSUE_CARD / VOID_CARD. Khóa worker theo người/giải và event; unique source tiếp tục chống lặp card/án khi retry. Quy tắc án dài hạn/qua giai đoạn vẫn thuộc Prompt 9.
- POST có operationId/hash/actor trong khóa Match row; hai thao tác hợp lệ cùng phút không bị gộp. PUT đính chính cần EDIT_EVENT, expectedRevision và lý do; thay phiên bản nguyên tử, giữ logical sequence. DELETE soft-void cả pair khi cần. Replay chuỗi chặn sửa/hủy làm sự kiện phía sau mất hợp lệ; audit append-only.
- Sửa hiệp cũ dựa mốc END_PERIOD trong clock history, không tự đoán phase/time. Không sửa sự kiện khi biên bản chờ duyệt/đã duyệt. Backend kiểm tra crew/capability tại từng thao tác, kể cả BTC+REFEREE. Không có bước duyệt mọi event bởi trọng tài chính.
- Giữ layout Prompt 5. Modal lấy cầu thủ/số áo từ đội hình thật, một lần lưu thay người; chỉnh sửa có lý do/phiên bản. Timeline có icon, đội/cầu thủ/pha và phạm vi PUBLIC/CREW; API/biên bản công khai lọc sự kiện nội bộ. SSE chỉ có dữ liệu commit.
- Migration Match **25** bổ sung metadata và bảo vệ lịch sử; versioned/transactional, thử chạy lại trên QA. Không sửa migration cũ, không thêm event store hoặc đổi ownership.
- **PASS:** 24 nhóm API/PostgreSQL QA; Match 239 PASS / 34 SKIP / 0 FAIL; frontend 31 PASS; typecheck/build và Docker chính thức. Ba thể thức dùng fixture/lịch thật trong bản sao riêng. QA có lỗi chèn IN có kiểm soát để chứng minh rollback event, audit và SSE.
- Sao lưu bảy DB; năm DB nghiệp vụ chính thức được fingerprint trước/sau. Cột dữ liệu cũ không đổi; trận tương lai vẫn NOT_STARTED v0; không thêm đội hình/sự kiện giả vào giải chính thức. 9 container running / 8 healthcheck healthy; bundle và ba hash compiled khớp source.
- Browser chính thức đọc/gate/điều hướng bàn phím đã kiểm tra. **NOT TESTED đầy đủ:** modal live trên browser/mobile, timeout thật/hai browser, reconnect nhiều tab sau rollout (HTTP SSE 200 nhưng badge còn “Đang đồng bộ” tại lúc quan sát); pointer qua công cụ có intercept. Các ngoại lệ futsal và mọi án/reset thẻ chưa nghiệm thu phải tiếp tục ghi rõ, không tính là PASS toàn luật.
- Checkpoint source trước/sau giữ nguyên HEAD và toàn bộ thay đổi có trước; xem [bằng chứng](../output/match-operation-prompt-06/). Không commit gộp, reset, stash, xóa database/volume hoặc sửa môi trường khôi phục.

**Dừng tại Prompt 6; Prompt 7–10 và nghiệm thu toàn bộ điều hành trận đấu chưa được triển khai tiếp.**

## 19. Bổ sung Prompt 7 — F06, ngày 27/11/2026

Phần này cập nhật trạng thái sau Prompt 6; nội dung rà soát lịch sử được giữ nguyên. Xem [báo cáo Prompt 7](./MATCH_OPERATION_PROMPT_07_REPORT.md) và [ma trận quy tắc](./MATCH_RULES_MATRIX.md).

- Đã triển khai nguồn từng lượt luân lưu tại Match, có phiên bản/idempotency/audit. Không dùng tổng penalty nhập tay làm căn cứ kết thúc trận.
- Quyết định theo stage và nguồn điều lệ đã ghim. Nhánh ALLOW_DRAW kết thúc hòa; hai phương thức knockout hiện có được kiểm tra thứ tự, không tự dùng thời lượng ET còn dư.
- Tỷ số `homeScore/awayScore` là hai hiệp chính; ET là bàn tăng thêm; tổng sau thi đấu cộng ET một lần; shootout riêng biệt. Kết thúc clock lưu `PENDING` + FINISHED/ENDED + actual end nguyên tử. Không tự công nhận kết quả, cập nhật BXH hoặc điền đội đi tiếp.
- Migration Match 26 bổ sung bảng trạng thái/audit shootout và metadata kết quả. Dữ liệu legacy không được đoán pha hoặc đổi phiên bản điều lệ. Thiếu căn cứ thì chặn phụ thuộc, giữ dữ liệu để đối chiếu.
- Giao diện giữ một route tác nghiệp và ba giai đoạn; panel chỉ ở PENALTIES; Sau trận tổng hợp tỷ số từ backend. Backend kiểm tra capability/phân công mỗi thao tác theo cơ chế khóa hiện có.
- F06 đã có code và kiểm thử luật/API; phạm vi E2E và kết quả triển khai chính xác nằm trong báo cáo. Không đồng nghĩa F07–F15 hoặc toàn bộ phân hệ đã hoàn thành.
- Các ngoại lệ chưa tự động giải quyết: DECLARED_RULES thiếu quy trình shootout; không còn người đủ điều kiện; thủ môn chấn thương lúc đá lại đang chờ; xử lý hành chính khi không thể tiếp tục; kết quả legacy thiếu mốc pha/lượt cần đối chiếu có thẩm quyền. Không tự xử thua.

## 20. Demo Mode theo trận và kịch bản kiểm thử ngày 27 tháng 11 năm 2026

- [Hướng dẫn thao tác theo tài khoản](./MATCH_DEMO_TEST_GUIDE.md) dùng trận HITU Club 14 – TDC Club 07 hiện có, roster 20 người mỗi đội và trọng tài được công bố. Tài khoản đã kiểm tra qua Auth thật.
- Dữ liệu chính thức của trận vẫn chưa gửi đội hình; thiếu bản quy tắc điều hành được gắn và giải còn PREPARING. Nút khai mạc chưa render trong luồng BTC hiện tại; ghi nhận khoảng trống, chưa sửa thêm nghiệp vụ đó.
- Bổ sung nguồn thời gian riêng từng trận `matchOperationNow`: áp dụng cho hạn đội hình, readiness, kickoff, clock và thời điểm sự kiện. Auth/session, SMTP, outbox, lease và audit vẫn dùng giờ thực. Các prompt tiếp theo phải giữ cùng nguồn thời gian khi xử lý thao tác phụ thuộc clock.
- Demo Mode chỉ opt-in Development/Test, whitelist ID giải DEMO và người được phân công có FINALIZE. Production luôn từ chối. Các mốc chỉ tiến thời gian, không tự xác nhận đội hình, bắt đầu/kết thúc hiệp, công nhận kết quả hoặc sửa lịch. Trước khi tắt cấu hình toàn cục phải hoàn tất/tắt phiên, tránh đưa clock đang chạy về quá khứ.
- Migration Match 27 thêm trạng thái và audit thời gian demo; không tạo kho nghiệp vụ sự kiện thứ hai. Bản backup riêng và checkpoint nguồn được giữ trong hướng dẫn.
- API/PostgreSQL QA đã chạy kịch bản thường lệ từ gửi đội hình đến công nhận biên bản và đọc BXH cơ bản. Không đồng nghĩa F07/F08/F09, mọi nhánh ngoại lệ hoặc toàn bộ trận qua trình duyệt đã nghiệm thu. Không sửa điều lệ chính thức hoặc bắt đầu trận người dùng thay cho kiểm thử.

## 21. Prompt 8 — Biên bản và xác nhận kết quả F07/F08

Ngày 28/11/2026. [Báo cáo triển khai và kiểm chứng](./MATCH_OPERATION_PROMPT_08_REPORT.md).

- `MANAGE_REPORT` chuẩn bị/lưu nháp/gửi; `FINALIZE` cùng final authority xác nhận thường lệ. Người hỗ trợ gửi không tự chuyển BTC, người xác nhận chỉ có FINALIZE vẫn duyệt được bản nộp của người hỗ trợ. Một người đủ quyền không phải thêm người hoặc bước duyệt.
- F07: khóa Match rồi report, operation receipt + expectedVersion, snapshot bản nộp; report APPROVED/result APPROVED/match VERIFIED/BXH/nguồn thắng và durable realtime event cùng Match transaction. Lỗi trước ghi result hoặc ở cuối publish rollback toàn bộ. Retry đã commit trả receipt; không phát SSE trước commit/nhân đôi kết quả.
- Scheduling vẫn sở hữu lịch/tổ trọng tài; đọc phân công/capability hiện hành dưới lease hiện có. Không tạo transaction giả xuyên database, không sao chép quyền để bỏ qua thay thế/thu hồi. Trường hợp completed cho phép đi qua gate quyền để repository trả retry đã xử lý, không cho mở lại trận/ghi kết quả thông thường.
- F08: thêm POST `/match-reports/:id/confirm` cho xác nhận/yêu cầu bổ sung. BTC review chỉ ngoại lệ. Giữ result-correction-requests; tác động chi tiết tiếp tục Prompt 9–10.
- Lưu nháp PostgreSQL không tác động BXH. Bản nộp đóng băng context, đội hình, sự kiện, clock, shootout, ghi chú; lịch sử chọn đúng lần nộp. Dữ liệu legacy thiếu thông tin không dùng trạng thái hiện tại thay quá khứ. Trigger append-only bảo vệ history/receipt.
- Migration Match **28** bổ sung metadata/report operation, giữ legacy cần review và không sửa snapshot cũ. Backup năm DB và đối chiếu 105 bảng: chỉ ledger migration đổi từ 27 lên 28, nội dung các cột nghiệp vụ cũ giữ nguyên.
- QA PostgreSQL lượt 003: **17 PASS**; Match **262 PASS / 34 SKIP**, frontend **39 PASS**; typecheck/build/Compose deployment PASS. Cổng chính thức 5173: 9 running, 8 healthy; 5 compiled backend hashes và 2 HTTP assets khớp build. Bản chính thức hiện chưa có biên bản sau reset; không tự tạo dữ liệu live để chụp ảnh.
- Trình duyệt đã kiểm tra danh sách, lọc, chi tiết, chọn snapshot cũ/mới và Sau trận từ API QA với cùng frontend chính thức; in PDF 3 trang từ frozen report thật. Chưa nghiệm thu mọi thao tác ghi qua nhiều trình duyệt/mobile hoặc cắt TCP thật đúng lúc mất response.
- **F09 vẫn còn**: standings tổng theo 3/1/0 khác đường group standings theo điều lệ. Prompt 8 chỉ củng cố công nhận/transaction và tích hợp nguồn hiện có; không tuyên bố thống nhất toàn bộ BXH/thống kê/kỷ luật hoặc hoàn tất giải.

Giữ toàn bộ giới hạn chi tiết trong báo cáo; dừng Prompt 8, không tự triển khai Prompt 9–10.

## 22. Prompt 9 — BXH, đội đi tiếp, thống kê và kỷ luật F09/F12

Ngày 28/11/2026. [Báo cáo và giới hạn nghiệm thu](./MATCH_OPERATION_PROMPT_09_REPORT.md), [QA API/PostgreSQL](../output/match-operation-prompt-09/qa-api-015.json).

- F09: dùng chung một phép tính thành tích/xếp hạng giữa standings lưu, hai API BXH và xác định đội đi tiếp. Đọc đúng phiên bản điều lệ, không 3/1/0 hoặc sort cố định; chỉ fixture công bố và kết quả APPROVED/VERIFIED–LOCKED. Hiệp phụ cộng một lần, penalty riêng.
- HEAD_TO_HEAD có metric khai báo; chưa đủ các lượt đối đầu thì không vượt qua bằng tiêu chí sau. Fair-play phải có trọng số rõ. Thiếu policy trả thứ hạng chưa xác định, không tự đặt trọng số. Các trường bổ sung nằm trong cơ chế điều lệ có phiên bản hiện có.
- Audit bốc thăm phân hạng gắn fingerprint kết quả/thẻ, không random khi đọc hoặc retry, không dùng lại biên bản cũ sau thay đổi kết quả. Giữ lịch sử đã có.
- Vòng tròn một bảng, một/hai lượt; kết hợp tự điền đúng nguồn group/rank của nhánh hiện có khi đủ căn cứ. Knockout giữ topology/ID và truyền winner/loser hiện có. Không gán đội từ PENDING hoặc tạo tỷ số cho BYE.
- Đính chính tính lại từ nguồn và có guard ảnh hưởng qualifier/trận phụ thuộc đã công bố. Nếu có xung đột, rollback thay đổi kết quả/nhánh, giữ yêu cầu để BTC xử lý; không tự thay lịch/phân công. Sửa routing Gateway bị thiếu cho yêu cầu đính chính.
- Thống kê chính thức có API theo kết quả APPROVED và sự kiện còn hiệu lực; không trộn live, own goal, penalty shootout hoặc phân bổ bàn hành chính cho cầu thủ. Chưa thu thập kiến tạo trả null. Đính chính lệch nguồn ghi bàn được đánh dấu cần đối chiếu.
- F12: tái dựng án từ card source theo thời gian trận và rule snapshot. Vàng tích lũy/vàng thứ hai/đỏ trực tiếp khác nhau; reset/phạm vi/luân lưu/nhiều án cần policy. Án theo số trận không dùng hạn 365 ngày; chỉ tính trận thực sự thi đấu đủ điều kiện là đã chấp hành.
- Cùng Outbox ISSUE_CARD/VOID_CARD thêm RECONCILE_RESULT và khóa chống lặp theo phiên bản. Discipline commit trước ack, retry không nhân đôi card/án. Eligibility khi chưa đồng bộ là chưa xác định và chặn người phụ thuộc, không fallback chắc chắn đủ điều kiện.
- Migration Match **29**, Discipline **1004**: bổ sung metadata, audit và conflict/outbox; versioned/transactional, không sửa migration/án/điều lệ cũ. Đã backup năm DB; giữ môi trường khôi phục, dữ liệu đăng ký và mọi thay đổi source có trước.
- **PASS:** 17 nhóm QA API/PostgreSQL, Match 272 PASS / 34 SKIP, frontend 39 PASS; typecheck/production build. Năm DB nghiệp vụ chính thức không đổi fingerprint trong QA. Chi tiết Docker, source/image và bảo toàn sau migration ở báo cáo.
- **Giới hạn đã biết:** fixture 5 đội với một bán kết BYE thiếu nguồn loser cho một phía tranh hạng ba; không tự tạo đối thủ/kết quả. REDRAW và chính sách so sánh chéo bảng riêng chưa có workflow tự động hoàn chỉnh. Các hành động hành chính/void kết quả/giải quyết nhánh đã công bố thuộc Prompt 10. Không đánh dấu toàn bộ F09/F12 hoặc điều hành giải hoàn tất mọi ngoại lệ.

Dừng Prompt 9; không tự triển khai Prompt 10. Giữ các mục rà soát lịch sử phía trên và đọc mục này cùng báo cáo kiểm chứng.
