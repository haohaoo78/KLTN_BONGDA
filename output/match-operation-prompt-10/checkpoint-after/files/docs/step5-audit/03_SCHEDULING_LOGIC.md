# Bước 5 – Thuật toán và ma trận ràng buộc

## 1. Dữ liệu và nhịp xử lý

Trong workspace local test, fixtures được lấy nguyên từ state draw công bố Bước 4 và filter `bye`; không gọi sinh lại cặp đấu. Bản lịch là map fixture ID → scheduledAt, venue code/name, duration, notes, locked. `publishedScheduleByFixture` tách snapshot công bố khỏi draft; auto preview là state riêng cho tới khi áp dụng.

## 2. Thời lượng

`matchPlayMinutes = 2 × minutes/hiệp + nghỉ giữa hiệp + dự phòng hiệp phụ + dự phòng penalty`. `venueOccupiedMinutes = preparation + matchPlay + transition + sân turnaround`. Khoảng bận venue là kickoff trừ prep đến kickoff cộng play + transition + turnaround. Kết thúc trận dùng cho nghỉ đội là kickoff + matchPlay (không bao gồm sau trận chuyển tiếp/venue turnaround). Vì vậy giao diện hiển thị “kết thúc dự kiến” theo matchPlay, còn chiếm sân dài hơn; đây là phân biệt đúng nhưng cần diễn đạt thống nhất.

Trong state khởi tạo có default group 35 phút/hiệp, nghỉ 10, chuẩn bị 15, chuyển tiếp 15; knockout 40/hiệp, 20 phút hiệp phụ và 15 penalty; nghỉ tối thiểu default 24 giờ, tối đa một trận/đội/ngày, travel buffer 30 phút. Đây là fallback trong `emptyDemoStep5State`, không phải giá trị đã xác nhận trong điều lệ từng giải. `matchDurationMinutes` được đổi ra hai hiệp mặc định trong workspace; cần xác minh với rule semantics nếu regulation duration là tổng thời lượng gồm/không gồm nghỉ.

## 3. Sinh lựa chọn lịch thủ công

`getManualScheduleCandidates` duyệt ngày từ start đến end (guard tối đa 730 ngày), sân active đúng pitch type, weekday/window, khung giờ, blackout và slot. Kickoff được quét từng 15 phút để toàn khoảng chiếm sân nằm trong slot. Với từng candidate chạy validator đối với lịch đang có và focus fixture; hard issue loại candidate. Kết quả được sắp theo ngày/sân/slot traversal, không có scoring riêng nhằm đưa “phương án tốt nhất” đầu tiên.

UI cập nhật động ngày → sân → giờ; trước lưu đọc state mới nhất, sinh candidates lại và validate full plan. `withLocalScheduleLock` giảm race giữa tabs cùng trình duyệt; còn kiểm soát ở cấp client/origin, không tương đương transaction backend/đa thiết bị.

## 4. Validator dùng chung

`validateSchedulePlan` áp dụng cho manual, automatic preview/apply, edit, save cluster, config impact, lock và publish (các hàm caller quyết định focus/full plan). Với fixtures source, parser lấy match ID; recursive `potentialTeams()` lấy tập đội khả dĩ từ trận cha hoặc các trận vòng bảng của rank source. Nếu không giải được nguồn hoặc cycle, fallback toàn bộ đội. Do đó chưa biết tên đội vẫn có thể được so sánh theo tập khả năng, không tạo đội giả.

### Ma trận

| Ràng buộc | Manual candidates/save | Auto generation/apply | Sửa config | Lock fixture | Publish test | Ghi chú |
|---|---:|---:|---:|---:|---:|---|
| Trong khoảng ngày giải | ✓ | ✓ | ✓ revalidate impact | ✓ focused validation | ✓ full | Theo resources local. |
| Ngày tuần / ngày nghỉ | ✓ | ✓ | ✓ | ✓ | ✓ | `allowedWeekdays`, `blockedDates`. |
| Khung giờ global + sân | ✓ | ✓ | ✓ | ✓ | ✓ | Tính prep/transition/turnaround. |
| Sân active/đúng loại | ✓ | ✓ | ✓ | ✓ | ✓ | Loại 5/7/11, HOME_AWAY có kiểm tra homeTeam. |
| Blackout/bảo trì sân | ✓ | ✓ | ✓ | ✓ | ✓ | Overlap toàn khoảng sân. |
| Hai trận trùng sân | ✓ | ✓ | ✓ | ✓ | ✓ | So occupancy spans. |
| Xung đột đội/nguồn đội | ✓ | ✓ | ✓ | ✓ | ✓ | Set giao possible teams, chỉ trùng play intervals. |
| Nghỉ tối thiểu | ✓ | ✓ | ✓ | ✓ | ✓ | match end đến kickoff; travel buffer thêm nếu khác location/travelZone. |
| Max trận mỗi đội/ngày | ✓ | ✓ | ✓ | ✓ | ✓ | Dựa possible teams; đếm fixture cùng ngày. |
| Source match/ranking trước child | ✓ | ✓ | ✓ | ✓ | ✓ | Source match phải có lịch; child ≥ source end + nghỉ. |
| BYE không schedule | ✓ | ✓ | n/a | n/a | ✓ | BYE bị lọc khỏi fixture set. |
| Đồng giờ vòng cuối | ✓ nếu yêu cầu | ✓ | ✓ | ✓ | ✓ | Cùng kickoff, sân khác nhau; cluster UI có thể lưu nhiều trận. |
| Vòng tối đa/ngày | ✓ nếu cờ required | ✓ | ✓ | ✓ | ✓ | Không bắt buộc nếu flag tắt. |
| Chênh nghỉ knockout | HARD nếu required, nếu không warning | HARD objective nếu required | ✓ | ✓ | ✓ | Phụ thuộc config. |
| Mục tiêu sân/khung giờ công bằng | cảnh báo | scoring/warnings | warning | warning | không chặn | Central stage/priority, restricted slot, rotation, home-away chain là advisory ở utility. |
| Lịch đã khóa | UI chặn edit; validation không tự định nghĩa immutability | Auto giữ locked entries | Config chỉ cảnh báo/confirm affected | khóa flag | publish snapshot | Lock là lifecycle/UI+planner, không persistence server ở local mode. |

“Sửa config” nghĩa source tính issues trước/sau rồi yêu cầu xác nhận giữ lịch bị ảnh hưởng; không tự xóa entries. Nó không tự động sửa các lịch xung đột.

## 5. Thuật toán tự động

`selectFixturesForAutomaticSchedule` lọc phase, groups, rounds, onlyUnscheduled và bỏ BYE. Đầu vào được sắp nhóm/bảng/vòng; dependency DFS topo đưa match source trước child. Planner chạy bounded DFS/backtracking trong worker, chọn candidate hợp lệ qua cùng validator, xếp score theo thứ tự objective cấu hình; lưu partial best. Giữ nguyên lịch khóa/ngoài phạm vi, target unlocked được gỡ để bố trí lại. Áp dụng kiểm tra signature của fixtures/entries/resources và chạy lại validation đầy đủ.

Giới hạn source: tối đa `maxRuntimeMs` clamp 500–15.000 ms, tối đa 1.200 nodes, tối đa 7 lựa chọn/trận, candidate generator tối đa 96 candidate, tối đa 2/bucket và 500 probes; thời điểm candidate auto lấy bước khoảng 30 phút. Đây là tìm kiếm giới hạn, không chứng minh tối ưu toàn cục. Status `TIMEOUT`/`searchLimitReached` được phân biệt với `INFEASIBLE`; nếu dừng do giới hạn thì UI nêu không thể kết luận bất khả thi. Một số nhánh có thể báo `INFEASIBLE` khi đã duyệt hết vùng lấy mẫu, nhưng không chứng minh không có nghiệm trên lưới thời gian khác.

Objectives hiện score theo thứ tự: hoàn thành giải sớm, venue use, fairness/rotation, rest, branch-rest, central venue. UI cho reorder. Không có một bộ tối ưu CP-SAT; planner là greedy scoring + DFS backtracking bounded. Auto preview cho phép apply partial; hủy preview không sửa lịch. Apply merge vào draft chung rồi revalidate; không tự publish.

## 6. Các điểm hạn chế cho thể thức

- **Vòng tròn:** fixtures vòng/leg được giữ nguyên. Có checker đồng giờ final round theo group. Không thấy logic đổi đội nhà/khách hoặc tạo cặp; cũng không thấy tối ưu xoay home-away nhiều lượt trong objective rõ ngoài warning chuỗi sân nhà/sân khách.
- **Knockout:** source ID được topo sort; candidate child bị chặn nếu nguồn chưa có lịch hoặc không đủ nghỉ. `potentialTeams` recursive khá bảo thủ và có thể làm giảm concurrency do giả định quá nhiều đội có thể gặp nhau. Khi source ID không match pattern hoặc dữ liệu nguồn thiếu, fallback mọi đội; có thể sinh false conflict, nhưng không trực tiếp chứng minh nguyên nhân 4 trận cụ thể.
- **Kết hợp:** group matches/rank sources được liên kết qua tên “Nhất/Nhì/Hạng N bảng”; validator yêu cầu các trận của bảng nguồn có lịch trước fixture playoff. Chưa xác minh việc qualification/tiebreaker ảnh hưởng toàn bộ fixtures nếu rules nguồn phức tạp hơn pattern text.

## 7. Trường hợp KO 32 đội, còn 4 fixture

Yêu cầu đề cập `TEST-KO-R2-M7`, `TEST-KO-R3-M4`, `TEST-KO-R4-M2`, `TEST-KO-R5-M1`. Search source không thấy các ID này. LocalStorage cùng origin hiện có fixture state của hai tournament: `95f79e55…` (12 fixtures, tất cả GROUP) và `8991a5a6…` (112 fixtures, tất cả stage GROUP theo shape hiện tại); không tìm thấy 32-team KO fixture snapshot hoặc entries cho bốn mã nêu trên. Giao diện đang mở là giải vòng tròn, 12 trận/0 lịch/0 sân. Do đó **không thể xác minh nguyên nhân cụ thể của bốn trận**; không thể kết luận thiếu nguồn lực thật hay planner limitation nếu thiếu snapshot/config.

Để tái hiện cần export an toàn từ localStorage đúng origin/tournament ID (snapshot fixtures, resources, scheduleByFixture, auto config/preview, time zone) hoặc mở đúng giải/fixture test trong trình duyệt. Không tạo dữ liệu thay thế trong báo cáo này.

## 8. Giải thích lỗi và công bằng

Manual không tìm candidate hiện có thể chỉ hiện thông điệp rỗng/chung từ UI, phụ thuộc `candidates` và `allValidationIssues`; API-style legacy trả lỗi service/API. Automatic preview nêu per-fixture missing reason, gồm source chưa xếp, bảng nguồn còn trận, thiếu sân đồng giờ, hoặc không có candidate trong vùng đã xét. Objective warnings được liệt kê nhưng không phải trung tâm xử lý có nút mở trực tiếp fixture/venue/config. Thống kê rest hiện dựa đội xác định; unresolved qualifier fairness chỉ có candidate possible sets trong constraint checks.
