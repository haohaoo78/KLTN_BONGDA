# Bước 5 – Vấn đề và kết quả kiểm tra

## 1. Phân loại bằng chứng

| Loại | Kết quả tại audit | Bằng chứng/giới hạn |
|---|---|---|
| Source inspection | PASS | Đọc component Step5 local, settings, planner, validator, storage, API-mode ScheduleManagementPanel, stepper/workflow, docs hiện có. Đây là rà soát source, không phải kiểm thử mọi nhánh. |
| Browser smoke – load Step5 | PASS một phần | Mở step 5 trên `localhost:5173`; thấy header, 8-stepper, view toggles, sơ đồ và side panel. Chỉ đọc, không thay state. |
| Browser fixture/state | PASS quan sát | Tournament `95f79e55-e6f0-5177-a2e2-d9fe62760dcd`: 12 fixtures, 8 đội, 2 bảng, 0 sân, 0/12 lịch; cảnh báo thiếu sân. State không đại diện giải KO 32 đội. |
| 9 tổ hợp thể thức × method | NOT TESTED trong lượt audit | Không thay cấu hình hoặc tạo/công bố state mới theo chỉ thị chỉ kiểm kê. |
| Manual candidate/save/edit/lock/delete | NOT TESTED trong lượt audit | Source inspection thấy handlers; không thao tác ghi trong lượt audit. |
| Auto planner | NOT TESTED trong lượt audit | Source inspection thấy bounded planner; không chạy thuật toán trong lượt audit. |
| Publish/reset | NOT TESTED trong lượt audit | Không ghi localStorage/reset trong lượt audit. |
| API/DB integration | NOT TESTED | Không gọi mutation, không truy DB. Tài liệu QA có lịch sử kiểm tra cũ nhưng ghi nhận các giới hạn theo từng mốc. |
| KO 32 / 4 fixture cụ thể | NOT VERIFIED | Snapshot hiện tại không có IDs hoặc fixture stage KNOCKOUT cần thiết. |

Một lượt thao tác trước đó trong hội thoại từng thử schedule cục bộ trên bộ fixture vòng tròn, nhưng state hiện tại đã khác (0 sân, 0/12); không tính lần đó là kiểm chứng lặp lại/ổn định của bản hiện tại.

## 2. Các vấn đề cần AI thiết kế tiếp xem xét

### Đầu vào kiểm thử không khớp ca 32 đội KO

Trong localStorage cùng origin quan sát được: tournament hiện tại có 12 group fixtures; key test của giải draw demo khác có fixture records nhưng stage map đang GROUP-only. Search source không thấy bốn ID cần điều tra. Không đủ cơ sở phân biệt resource infeasibility, pattern parser/fallback, dependency ordering hay planner search cap.

### Hai UX paths không đồng nhất

Local/test branch có redesigned calendar/list/automatic planning; API branch còn `ScheduleManagementPanel` dạng legacy. Người dùng có thể thấy giao diện khác theo giải/trạng thái/cờ test/origin dù tài khoản BTC giống nhau. Đây là rủi ro UX chính mà audit hiện trạng phát hiện.

### Lập lịch thủ công và issue explanation

- Candidate hợp lệ được lọc trước, nhưng không có candidate thì nguyên nhân tổng hợp/đường dẫn sửa có thể thiếu cụ thể.
- Candidates sắp theo traversal, không phải gợi ý ưu tiên theo công bằng/ít ảnh hưởng.
- Panel có date/venue/time và end preview, nhưng không có recommendation ranking transparent.
- Không thấy trung tâm issues với action “mở fixture”, “mở venue”, “mở constraint”.
- Chỉnh fixture có focused validation; source dependants được rà, nhưng policy xử lý các child đã khóa/đã công bố cần xem từng handler; không thay đổi official schedule ở local published state.

### Lập lịch tự động

- Bounded search có thể trả PARTIAL/TIMEOUT; timeout không chứng minh vô nghiệm.
- Search cap trên số lựa chọn mỗi fixture, node và thời gian có thể bỏ nghiệm có ở nhánh thấp hơn.
- Cần đảm bảo stage order/source semantics với nhiều nguồn rank và qualifier cross-group.
- Proposal có apply partial, hủy proposal, chạy lại; không có rollback tự động sau apply. Việc hủy preview không xóa các entries đã apply.
- Current configuration panel supports phase/group/round but not date/batch scope promised in earlier prompt.

### Sân/công suất

- Venue entity hiện gộp sân với location/travel zone text; không model riêng địa điểm.
- Lịch availability theo weekday + from/to + blackout, chưa biểu diễn rõ nhiều giờ riêng theo từng ngày lặp phức tạp hoặc external reservation confirmation.
- Capacity là cộng giờ khả dụng lý thuyết và tổng occupied minutes sơ bộ; không chứng minh được cấu hình có thể schedule do xung đột team/dependency.
- Không có khai báo thuê/đặt sân ngoài app; đúng là không tự khẳng định venue đã được xác nhận.

### Công bằng/thời lượng

- `matchPlayMinutes` cộng dự phòng extra-time/penalty vào thời gian kết thúc dùng cho nghỉ; điều này bảo thủ, nhưng cần đối chiếu quy tắc timing từng loại đấu.
- Số giờ kết thúc hiển thị dùng play duration; occupancy thêm prep/transition/turnaround. UI phải phân biệt rõ “kết thúc trận” và “sân sẵn sàng”.
- Một số constraints chỉ bật required theo cờ; cần map provenance từng rule từ regulation, system suggestion hay BTC choice.
- Chưa thấy thống kê venue utilization theo % hoặc ngày/tuần đầy đủ; fairness chủ yếu warnings và planner objective.

### Lock, publish, API compatibility

- LocalStorage lock không thay thế server-side lock; bất kỳ user có quyền devtools có thể sửa test state.
- Test publication không phải public API; actor viewer khác origin/browser profile không đảm bảo nhận state.
- API-mode component vẫn có luồng publish schedules và bulk publish drafts; test path publish version snapshot riêng. Có hai semantics “publish”.
- API bulk publish loop cập nhật từng draft, có rủi ro kết quả từng phần nếu request giữa chừng lỗi; cần kiểm tra backend transaction/logging trước khi tuyên bố atomic.
- `getCompletedWorkflowSteps` Step5/Step6 tính completion toàn giải, trong khi nghiệp vụ referee per-period cho phép completion theo đợt; không khóa Step7 là yêu cầu riêng nhưng frontend completion badge có thể vẫn incomplete.

### Tên vòng knockout

Component sơ đồ có helper `knockoutRoundLabel`; source dùng số vòng/mã fixture và map nhãn vòng. Chưa kiểm thử toàn bộ quy mô 32 đội trên UI, nên không xác nhận nhãn round 2…5 tương ứng chính xác “vòng 1/16, tứ kết…” cho mọi kích thước và BYE.

## 3. Test case knockout cần bổ sung dữ liệu mới nhất

Đối với mỗi fixture `TEST-KO-R2-M7`, `R3-M4`, `R4-M2`, `R5-M1`, cần ghi lại:

- snapshot Step4 nguyên bản và nguồn home/away;
- resources (ngày bắt đầu/kết thúc, allowed weekdays, slots, sân hoạt động/availability/blackouts, duration, rests/travel);
- lịch đã áp dụng 27 fixture, locked flags;
- auto scope/config/objectives, `selectedFixtureIds`, `scheduledFixtureIds`, `searchLimitReached`, `exploredNodes`, elapsed;
- candidate generation count cho từng fixture và `validateSchedulePlan` issue codes của mọi candidate;
- trạng thái source fixtures và dependent chain.

Không có những dữ liệu trên trong lượt đọc được; **chưa kết luận lỗi cụ thể**.

## 4. Ma trận kiểm thử đề xuất cho đợt tiếp theo

| Ca | Manual | Auto | Config/validation | Trạng thái hiện tại |
|---|---:|---:|---:|---|
| 3 format × 3 method | ✓ | ✓ | ✓ | Chưa chạy trong audit này |
| Chẵn/lẻ; BYE; nguồn rank | ✓ | ✓ | ✓ | Chưa chạy đầy đủ |
| Trùng sân / team / rest / travel | ✓ | ✓ | ✓ | Validator có code; E2E chưa xác nhận |
| Knockout child trước source | ✓ | ✓ | ✓ | Code có check; KO fixture case chưa xác minh |
| Final round simultaneous thiếu sân | ✓ | ✓ | ✓ | Code + UI cluster có; chưa chạy lượt này |
| Locked fixture / ngoài scope | — | ✓ | — | Source giữ; chưa test thực tế lượt này |
| Thay venue làm lịch lỗi | ✓ | ✓ | ✓ | Code pre/post issues; chưa test lượt này |
| Candidate không tồn tại vs search timeout | ✓ | ✓ | ✓ | status phân biệt; chưa đo false infeasible |
| Lưu/reload/multi-tab | ✓ | ✓ | — | storage event/BroadcastChannel có; chưa test hiện tại |
| Publish schedule không trọng tài | — | — | ✓ | test branch thiết kế độc lập; chưa test lượt này |
| API production permission + ownership | n/a | n/a | n/a | Cần integration/E2E backend riêng |

## 5. Tài liệu tham chiếu

- [DRAW_WORKSPACE_DEMO.md](../DRAW_WORKSPACE_DEMO.md): mô tả nguồn lực, planner và QA từng mốc.
- [PROJECT_STATUS_OVERVIEW.md](../PROJECT_STATUS_OVERVIEW.md): mục 5.46–5.49, 32 đội/119 fixtures và giới hạn nghiệm thu/tách bước.
- [REFACTOR_8_TO_5.md](../REFACTOR_8_TO_5.md): ranh giới microservice, migration và dữ liệu.
- [Usecase_da_chinh_sua_v2.md](../Usecase_da_chinh_sua_v2.md): Use Case hiện có, không phải đặc tả riêng Bước 5.

## Kết luận

Source có một workspace test khá đầy đủ cho scheduling thủ công/tự động, constraint checks, calendar/list và publish local. Màn nghiệp vụ API thật còn đường UI cũ song song. Browser state ở giải đang mở cho thấy 12 trận vòng tròn chưa có sân/lịch. Không đủ dữ liệu để chẩn đoán 4 fixture knockout. E2E của các thao tác scheduling, nhiều thể thức, race, API permissions và actor synchronization chưa được chạy trong lượt audit này; không đánh dấu đạt dựa trên việc code có tồn tại.
