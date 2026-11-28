# Bước 5 – Kiến trúc và dữ liệu

## 1. Hai luồng kiến trúc

```text
BTC Workspace
  ├─ test-enabled + local origin + trạng thái cho phép
  │    ├─ API read: getDrawManagement → danh sách eligible teams
  │    ├─ localStorage: Step3 allocation / Step4 fixtures / Step5 resources & schedule
  │    ├─ scheduleConstraintValidation (browser module)
  │    ├─ automaticSchedulePlanner (async bounded planner trên main thread)
  │    └─ storage event + BroadcastChannel cho tabs cùng origin
  └─ normal/API mode
       ├─ ScheduleManagementPanel
       ├─ Gateway APIs → Match/Scheduling service → DB riêng của Match/Scheduling
       └─ publication/schedule reads qua API, không truy cập DB service khác
```

Điều kiện nhánh ở [BtcTournamentWorkspace.tsx](../../apps/web-client/src/components/BtcTournamentWorkspace.tsx) dòng ~544–552. Không có backend planner được gọi bởi test path. Backend thật vẫn nằm trong Match/Scheduling, đúng ownership được nêu ở [API_ROUTING.md](../API_ROUTING.md) và hướng dẫn dự án.

## 2. State test cục bộ

`DrawTestState` gồm tournamentId, config/draw publication, fixtures, publication timestamps, `completedSteps`, `step5` và `currentStep`. Local key có namespace `sfl.draw.test-state.v1.<tournamentId>`. `step5` gồm:

- snapshot key và schedule draft map;
- published schedule map, version, actor/time, versions list;
- resources (dates, weekdays, slots, blocked dates, group/KO timings, venues, constraints);
- auto config/preview;
- referee policy/resources/models/crews/assignments/signatures/published data.

Đây là một key/object step5 legacy chứa cả lịch và trọng tài. Reset Step5 thay object này bằng default (xóa cả referee downstream); reset Step6 xóa các field referee, giữ lịch.

`writeDrawTestState` ghi localStorage, phát CustomEvent và BroadcastChannel; subscribe cũng nghe browser `storage`. Hỗ trợ reload/đồng bộ tabs cùng trình duyệt/origin, không đồng bộ thiết bị, profile browser hoặc origin khác. Guard test origins chỉ cho localhost, loopback, `.test`, `.localhost`; đây không phải security boundary chống người dùng sửa localStorage.

## 3. Snapshot và versioning

`demoDiagramSnapshotKey` serialize draw publication time, allocation, fixture IDs/stage/group/round/leg/team/source/BYE. Step5 state chỉ dùng khi snapshot key trùng; khi Bước 4 thay đổi, Step5 khởi tạo rỗng. Lịch publish lưu map snapshot, schedule version và lịch sử phiên bản. Không có concurrent transaction mạnh giữa các browser contexts; signature mới nhất giúp phát hiện thay đổi trước apply/publish trong cùng local storage, lock là client-scoped.

## 4. Nguồn dữ liệu

| Dữ liệu | Test workspace | API/DB path |
|---|---|---|
| Danh sách đội | `getDrawManagement` API đọc eligibleTeams; tên/trường dùng trong display | API Organization/Tournament tùy route. |
| Điều lệ và fixture đầu vào | props giải + draw test state/snapshot; fixtures là dữ liệu local publish Bước 4 | Match fixtures được lấy qua API; API Match quản lý fixture, Tournament quản lý draw/regulation. |
| Sân/slot/config | `DemoScheduleResources` localStorage | CRUD/API Scheduling backend. |
| Lịch draft/locked/preview | map trong localStorage | API schedule rows trong Scheduling DB. |
| Lịch official test | published map/version trong localStorage, chỉ viewer cùng origin nếu code consumer đọc đúng state | API schedule `PUBLISHED` và projection vào Match. |
| Trọng tài | chung step5 local object, resource profile có thể virtual/account references | API/DB thật, referee assignment thuộc Match/Scheduling domain. |

Không tìm thấy mock list đội hardcoded trong `DrawDemoScheduleWorkspace`; đội lấy từ API read hoặc IDs fixtures kết hợp map. Các fixtures local vẫn là bản test, không có giá trị authoritative ngoài origin.

## 5. Đồng bộ các view / Bước 6

Sơ đồ, lịch trực quan, list, detail và review cùng đọc `visibleEntries`, tính toán từ `step5.scheduleByFixture` hoặc `publishedScheduleByFixture`; danh sách không có state copy riêng. Auto preview hiển thị overlay đến khi apply. Publish snapshot thành `publishedScheduleByFixture`; review tab và viewer phải chọn published map, không draft.

Trong test, `onSchedulePublished` gọi workflow UI để chuyển sang Step6; state test giữ `currentStep` numeric cũ (comment lưu mapping 4=draw, 5=fixtures, 6=scheduling, 7=referees, 8=operations), trong khi stepper nhìn thấy là 8 steps. Đây là compatibility shim, dễ nhầm chỉ số hiển thị và nội bộ.

Trong API mode, `getCompletedWorkflowSteps` suy ra step5 từ tất cả match có published schedule và stage công bố; step6 dựa schedule có refereeId. Đây là logic completion dạng toàn giải ở frontend. Tài liệu mới nói phân công có thể theo từng đợt/song song điều hành; cần xem xét logic completion để không vô tình coi step6 chưa xong là blocker ở step7. Source gate start match nằm Match Service và có giới hạn cấu hình vị trí bắt buộc đã ghi trong PROJECT_STATUS_OVERVIEW.

## 6. API thật và persistence

`ScheduleManagementPanel` gọi `createTournamentSchedule`, `updateTournamentSchedule`, get schedules/matches/venues, check conflicts, referee APIs. Backend Match/Scheduling sở hữu DB `sfl_scheduling`/`sfl_match`; theo `AGENTS.md`, không service nào được query trực tiếp DB service khác. Chức năng API thật có schedule status `DRAFT`, `PUBLISHED`, `CANCELLED`, `RESCHEDULED`, history và referee assignment; component legacy vẫn chứa cả mode venues/referees dù stepper đã tách.

Điểm cần lưu ý: test publish chỉ tạo dữ liệu local giả lập. Không gửi API mutation, không đồng bộ sang DB; cái gọi là “công bố thử nghiệm” chỉ chia sẻ localStorage cùng browser origin. Vì thế actor đăng nhập ở tab/origin khác có thể không thấy nếu đang dùng server port khác (5173 vs 5175), profile khác hoặc viewer component đọc API thay vì local test state.

## 7. Reset/rollback

- Reset Step5 local: `resetDrawTestStep5` thay Step5 state bằng rỗng và defaults, xóa draft, official test schedule, versions và referee phụ thuộc, giữ draw/fixtures Bước 3/4. UI xác nhận trước.
- Reset Step6 local: xóa referee resources/assignments/locks/publication fields, giữ schedule Bước5 chính thức.
- Cancel auto preview xóa preview; draft không thay đổi.
- Auto apply gộp entries vào draft; không thấy undo stack/rollback theo phương án. Hủy preview sau khi apply không khôi phục trạng thái trước apply.
- API path thay đổi/hủy lịch đi qua API cùng lịch sử lý do theo workflow hiện hữu; không phải cùng reset local test.

## 8. Sự phụ thuộc kiến trúc cũ

1. Component tên `DrawDemoScheduleWorkspace` xử lý cả Step5 và Step6 test.
2. Tên storage key/state property vẫn là `step5` cho cả schedule/referees sau khi tách bước.
3. State test workflow numeric có mapping legacy, còn `BtcTournamentWorkspace` giữ `visibleWorkflowStep` và API workflow mapping.
4. Production/API UI khác hẳn local redesign; không tái sử dụng cùng view component cho API mode.
5. `ScheduleManagementPanel` gộp chế độ venue/scheduling và referee trong một component có branch render.
6. API workflow step completion ở client suy ra từ toàn bộ fixture schedule/referee, không có domain-specific completion object independent.

Những điểm này không tự động đồng nghĩa sai nghiệp vụ, nhưng cần AI thiết kế lại nhận rõ các seam để không phá tương thích dữ liệu/test.
