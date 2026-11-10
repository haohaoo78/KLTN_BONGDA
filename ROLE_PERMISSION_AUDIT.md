# ROLE_PERMISSION_AUDIT

## 1. Phạm vi kiểm tra

- Chỉ kiểm tra, báo cáo và lập danh sách thiếu sót; chưa sửa code, chưa sửa database và chưa thay đổi Docker / ENV / SMTP.
- Kiểm tra dựa trên các file/service đang có trong repo: `packages/shared/src/index.ts`, `apps/web-client/src/App.tsx`, `services/auth-service/src/account/**`, `services/tournament-service/src/**`, `services/organization-service/src/**`, `services/match-service/src/**`.
- Kết quả dưới đây là báo cáo thực trạng dựa trên code đang chạy và API hiện có, không phải giả định.

## 2. Vai trò và chức năng 6 vai trò

| Vai trò | Mô tả nghiệp vụ | Trạng thái hiện tại | Ghi chú |
|---|---|---|---|
| ADMIN | Quản lý tài khoản, quyền, trường, giám sát hệ thống | Có cơ sở hạ tầng rõ ràng | Có `UserRole.ADMIN`, `requireRoles(UserRole.ADMIN)`, menu quản lý tài khoản và yêu cầu vai trò trong app |
| BTC | Quản lý giải trong trường được cấp, duyệt yêu cầu, quản lý trận và hiệu lực tổ chức | Có logic quản lý/ủy quyền tương đối rõ | Phải có quyền theo trường và khai báo management assignment trong tournament |
| TEAM_CAPTAIN | Quản lý đội, nộp yêu cầu, quản lý cầu thủ/thành viên | Có cơ chế yêu cầu và kiểm tra `TEAM_CAPTAIN` | Rule-guard thường dựa trên `team.captainId` hoặc access service |
| PLAYER | Tham gia đội, yêu cầu vai trò, xem thông tin liên quan | Có luồng đăng ký vai trò `PLAYER` | Cần kiểm tra quyền cập nhật hồ sơ và ràng buộc đội |
| REFEREE | Xem/điều phối trận được phân công, nhập kết quả | Có middleware `assertCanManageMatch` và kiểm tra `refereeIsAssignedToMatch` | Hạn chế rõ ràng theo trận được phân công |
| VIEWER | Xem dữ liệu công khai | Có menu và quyền xem | Không có quyền quản trị hệ thống |

### Kết luận ngắn

- Các vai trò cơ bản xuất hiện rõ trong shared types và frontend role navigation.
- Phân quyền tầng API và middleware đã có cấu trúc nhất quán theo `requireGatewayUser` + `requireRoles` + `requireTournamentManager` / `assertCanManageTeam` / `assertCanManageMatch`.
- Tuy nhiên, vẫn có điểm mơ hồ hoặc thiếu đầy đủ theo yêu cầu nghiệp vụ về lịch sử khóa/mở khóa, xóa mềm, vai trò theo trường và luồng duyệt kết quả MATCH hoàn chỉnh.

## 3. Ma trận phân quyền hiện trạng

| Chức năng | ADMIN | BTC | TEAM_CAPTAIN | PLAYER | REFEREE | VIEWER |
|---|---|---|---|---|---|---|
| Quản lý tài khoản toàn hệ thống | Có | Không | Không | Không | Không | Không |
| Duyệt yêu cầu vai trò | Có | Có (theo trường / scope) | Không | Không | Không | Không |
| Quản lý trường | Có | Không | Không | Không | Không | Không |
| Tạo / quản lý giải đấu | Có | Có (nếu được gán quyền quản lý giải) | Không | Không | Không | Không |
| Quản lý đội | Có | Có nếu trường/đội tương ứng | Có nếu là đội trưởng | Có nếu là thành viên của đội | Không | Không |
| Xem thông tin đội công khai | Có | Có | Có nếu thuộc đội | Có nếu thuộc đội | Có nếu có quyền liên quan | Có |
| Nhập kết quả trận | Có | Có nếu BTC quản lý trận | Không | Không | Có nếu được giao trận | Không |
| BTC duyệt kết quả | Có | Có | Không | Không | Không | Không |
| Xem dữ liệu công khai | Có | Có | Có | Có | Có | Có |
| Quản lý một tài khoản cá nhân | Có hoặc chính chủ | Không | Không | Không | Không | Không |

### Ghi chú về ma trận

- `requireRoles(UserRole.ADMIN)` được dùng ở route quản lý tài khoản và thực hiện chỉnh sửa tài khoản trong `userRoutes.ts`.
- `role_applications` được phép review bởi `ADMIN` và `BTC` trong `userRoutes.ts`.
- `requireTournamentManager` chỉ cho `ADMIN` hoặc `BTC` có assignment hợp lệ tại `tournament-service`.
- `assertCanManageMatch` cho phép `ADMIN`, `BTC` quản lý trận theo giải được giao, hoặc `REFEREE` nếu được phân công cho trận.

## 4. Menu và dashboard theo vai trò

### 4.1 ADMIN

`apps/web-client/src/App.tsx` ghi nhận `ADMIN` có quyền tới:

- overview
- myAccount
- accounts
- roleApplications
- notifications
- tournaments
- matches
- standings
- teams
- institutions

Đây là quyền nhìn thấy chuyên nghiệp nhất và là cơ sở cho module quản lý tài khoản admin.

### 4.2 BTC

`roleNavigation.BTC` cho thấy:

- overview
- myAccount
- roleApplications
- notifications
- tournaments
- matches
- standings
- teams

Điểm đáng chú ý:

- BTC không thấy menu `accounts` và không có quyền quản lý tài khoản toàn hệ thống.
- BTC có quyền xem và duyệt yêu cầu vai trò theo phạm vi được giao.

### 4.3 TEAM_CAPTAIN / PLAYER / REFEREE / VIEWER

`App.tsx` cho thấy:

- TEAM_CAPTAIN: `overview`, `myAccount`, `roleApplications`, `notifications`, `teams`, `tournaments`, `matches`, `standings`
- PLAYER: tương tự `TEAM_CAPTAIN`, nhưng quyền quản lý đội chủ yếu dựa trên thành viên/đội liên quan
- REFEREE: `overview`, `myAccount`, `notifications`, `matches`, `tournaments`
- VIEWER: `overview`, `myAccount`, `roleApplications`, `notifications`, `tournaments`, `matches`, `standings`, `teams`

### Kết luận

- UI có phân quyền theo vai trò gần đúng với SRS.
- Tuy nhiên, UI không phải là bằng chứng duy nhất; quyền cần được kiểm tra ở backend. Hiện nay, phần lớn logic này đã được che chắn ở middleware/service.

## 5. Quan hệ Trường học – BTC – Giải đấu

### 5.1 Có cơ sở dữ liệu và logic

Trong `auth-service/src/account/repositories/userRepository.ts` có:

- `listBtcAssignedInstitutionIds(institutionIds: string[])`
- `hasOtherBtcAssignment(institutionId: string, excludingUserId: string)`

Các hàm này cho thấy có mô hình kiểm tra BTC theo trường và tránh gán trùng BTC cho một trường nếu không cần thiết.

Trong `tournament-service/src/middleware/requireTournamentManager.ts` có:

- `requireTournamentManager` kiểm tra `req.userRoles`
- nếu `ADMIN` => cho phép
- nếu `BTC` thì cần `hasTournamentAssignment(tournamentId, req.userId)`
- sau đó mới cho phép truy cập/điều hành quản lý giải

### 5.2 Đánh giá hiện trạng

- Mô hình “một trường có nhiều BTC” và “BTC quản lý giải trong phạm vi được cấp” là có nền tảng logic.
- Tuy nhiên, trong code đang khảo sát chưa có bằng chứng rõ ràng về UI/route cho “xem danh sách BTC của từng trường, gán/thu hồi liên kết trường” theo một workflow hoàn chỉnh, chuyên nghiệp và có audit log đầy đủ.
- Cần xác nhận rõ ràng: BTC là người tạo và tổ chức giải hay chỉ được gán theo giải; hiện code cho phép kiểm tra trên `tournamentId` assignment, không mặc định đồng bộ tất cả giải theo trường.

## 6. Luồng cơ bản: BTC tạo giải và quản lý giải

### Mức code hiện có

- `services/tournament-service/src/routes/tournamentRoutes.ts` hiển thị các route protected, trọng tâm là:
  - `GET /my/tournaments`
  - `GET /tournaments/:tournamentId/organizers`
  - `PUT /tournaments/:tournamentId/organizers/:userId`
  - `DELETE /tournaments/:tournamentId/organizers/:userId`
  - `POST /tournaments`
  - `PUT /tournaments/:id`
  - `DELETE /tournaments/:id`
  - `POST /tournaments/:tournamentId/registration-periods`
  - `POST /tournaments/:tournamentId/regulations`
  - `POST /groups`, `POST /draws`, etc.

- `requireTournamentManager` bảo vệ quyền chỉnh sửa/điều hành giải.

### Đánh giá

- Có luồng khởi tạo và quản lý giải ở service và route.
- Có cơ chế `created_by`/assignment và kiểm tra quyền quản lý được cấp. Đây là nền tảng phù hợp với mô hình “BTC quản lý giải trong phạm vi được cấp”, không phải “ADMIN phân công BTC vào từng giải” theo kiểu tùy ý.
- Tuy nhiên, tính chuyên nghiệp của workflow “nhiều BTC cùng phối hợp một giải” và “thu hồi quyền theo giải / trường / vai trò” cần kiểm tra thêm bằng UI và audit log thực tế để đảm bảo không nhầm lẫn giữa quyền trường, quyền giải và quyền BTC theo tài khoản.

## 7. Luồng trọng tài gửi kết quả và BTC duyệt

### Mức code hiện có

- `services/match-service/src/scheduling/authorization.ts` chứa các hàm:
  - `assertCanManageMatch(req, matchId)`
  - `assertCanManageTournament(req, tournamentId)`
  - `assertCanSubmitComplaintForTeam(req, teamId)`

- Trong logic này:
  - `ADMIN` được phép quản lý chung
  - `BTC` được phép nếu quản lý giải
  - `REFEREE` chỉ được phép nếu đã được phân công cho trận (`refereeIsAssignedToMatch`)

### Đánh giá

- Có cơ chế kiểm soát quyền “REFEREE chỉ nhập kết quả trận được phân công” và “BTC quản lý giải được phép duyệt/quản lý trận”.
- Tuy nhiên, trong phạm vi file khảo sát hiện tại, chưa thấy đủ bằng chứng về một state machine rõ ràng với các bước:
  1. referee submit match report
  2. system saves version + sender + timestamp
  3. pending BTC approval
  4. reject with reason + request revision
  5. approved result updates official standings
  6. versioning / amendment history

Nói cách khác: có kiểm soát quyền, nhưng chưa thấy một “luồng duyệt kết quả trận” hoàn chỉnh và rõ ràng như yêu cầu nghiệp vụ.

## 8. API, database và middleware liên quan

### 8.1 Auth service

File chính:

- `services/auth-service/src/account/routes/userRoutes.ts`
- `services/auth-service/src/account/controllers/userController.ts`
- `services/auth-service/src/account/repositories/userRepository.ts`
- `services/auth-service/src/account/repositories/roleApplicationRepository.ts`
- `services/auth-service/src/account/middleware/gatewayUser.ts`

Function chính:

- `requireGatewayUser()` xác thực x-user-id / x-user-email / x-user-roles
- `requireRoles()` ràng buộc quyền theo vai trò
- `requireSelfOrAdmin()` cho phép xem/chỉnh sửa tài khoản cá nhân hoặc admin
- `listUsers()` có filter `search`, `role`, `status`, `institutionId`
- `reviewRoleApplication()` có logic review Admin/BTC và update `user_roles`
- `listRoleApplications()` có filter `search`, `status`, `requestedRole`, `createdFrom`, `createdTo` và scope theo trường cho BTC

### 8.2 Tournament service

File chính:

- `services/tournament-service/src/routes/tournamentRoutes.ts`
- `services/tournament-service/src/middleware/requireTournamentManager.ts`

Function chính:

- `requireTournamentManager` xác thực `ADMIN` hoặc `BTC` được gán cho giải
- route quản lý giải, draw, regulation, registration period

### 8.3 Organization service

File chính:

- `services/organization-service/src/lib/teamAuthorization.ts`

Function chính:

- `assertCanManageTeam()`
- `assertCanManageTournament()`
- `assertCanViewTeam()`

### 8.4 Match service

File chính:

- `services/match-service/src/scheduling/authorization.ts`

Function chính:

- `assertCanManageMatch()` kiểm tra `ADMIN` / `BTC` / `REFEREE` theo assignment

### 8.5 Frontend role-based navigation

File chính:

- `apps/web-client/src/App.tsx`

Function chính:

- `roleNavigation` phân role -> sidebar/menu
- `roleLandingPaths` chuyển hướng sau login

## 9. Kết quả kiểm tra chức năng và phân loại hiện trạng

### 9.1 Đã hoàn thiện hoặc có nền tảng rõ

- 6 vai trò được định nghĩa thống nhất trong shared types.
- Auth middleware và gateway user context có kiểm tra quyền ở backend.
- Quản lý tài khoản admin có routes và repository thao tác.
- Duyệt yêu cầu vai trò có CRUD + review logic.
- Menu/role navigation có phân quyền ở frontend.
- BTC / tournament manager guard có route-level và service-level kiểm soát.
- REFEREE access được giới hạn theo trận được giao.

### 9.2 Có giao diện nhưng thiếu backend hoặc thiếu audit mạnh

- Trang quản lý tài khoản trong frontend có giao diện tương đối nhiều nhưng không đồng nhất với đầy đủ nghiệp vụ khóa/mở khóa, xóa mềm, audit history và quản lý quyền theo role detail như yêu cầu ban đầu.
- Với yêu cầu “lọc theo nhiều tiêu chí, xác thực backend, audit chi tiết” cần kiểm tra thêm endpoint và UI thực tế cho các state như `Bị khóa`, `Chưa xác minh`, `Bị từ chối`, `Ngừng hoạt động`.

### 9.3 Có backend nhưng thiếu giao diện hoặc workflow hoàn chỉnh

- `role_applications` review logic có backend nhưng cần UI/UX chuyên nghiệp hơn để thể hiện rõ trạng thái, lý do từ chối, nhân sự duyệt, trường và scope.
- `btc assignment` logic có backend nhưng thiếu workflow gắn trường + giải rõ ràng trong UI.
- `result approval` flow cho REFEREE -> BTC duyệt chưa hiện rõ trong code/hệ thống như một state machine có audit và versioned history.

### 9.4 Sai phân quyền / không đủ kiểm soát hoặc chưa rõ

- Có kiểm soát quyền trên route và middleware, nhưng không thấy một “last-admin protection” rõ ràng cho tài khoản quản trị cuối cùng trong toàn bộ module tài khoản.
- Có logic `hasOtherBtcAssignment`, nhưng chưa thấy workflow rõ ràng cho “thu hồi liên kết trường”, “thu hồi vai trò BTC”, “khóa tài khoản BTC” và “mất quyền quản lý giải” như 3 trạng thái riêng biệt.
- Tài khoản `ADMIN` có thể bị khóa/mở khóa nếu route cho phép và logic khác; cần xác nhận thêm về việc “không cho ADMIN tự khóa/xóa ADMIN cuối cùng” có được bảo vệ ở endpoint hay không.

### 9.5 Đang làm dở / chưa triển khai / cần xác nhận

- Luồng xóa mềm / vô hiệu hóa tài khoản, với kiểm tra “tài khoản liên kết đội, giải, trận, lịch sử” chưa xuất hiện đầy đủ trong code review.
- Luồng audit log chi tiết cho “ai thực hiện / dữ liệu trước / sau / lý do / thời gian / status” chưa đủ rõ trên toàn hệ thống.
- Luồng thông báo tới người dùng theo từng thay đổi role / khóa / mở khóa / vô hiệu hóa cần kiểm tra thêm vì nó liên quan tới `notification-service` và các event không được đọc kỹ ở mức toàn hệ thống.
- Luồng xác minh email, đổi email, yêu cầu cấp quyền và gửi email không phải lúc nào cũng theo cùng một quy trình theo business requirement.

## 10. Danh sách lỗi / thiếu sót / chờ xác nhận

| # | Vấn đề | File / module liên quan | Mức độ | Hướng xử lý |
|---|---|---|---|---|
| 1 | Chưa nhìn thấy workflow xóa mềm/vô hiệu hóa tài khoản được thực hiện rõ ràng và an toàn với quan hệ nghiệp vụ | `services/auth-service/src/account/**` | Cần xác nhận | Thêm trường `deleted_at`, `deactivation_reason`, `disabled_by` và kiểm tra quan hệ đội/giải/trận trước khi vô hiệu hóa |
| 2 | Khóa/mở khóa tài khoản và phân biệt email-unverified / inactive / rejected / disabled chưa hợp nhất thành một model status rõ ràng | `userRepository.ts`, UI admin | Cần xác nhận | Tạo `account_status` / `status_reason` riêng, không gom tất cả vào `is_active` |
| 3 | Không thấy đầy đủ audit log cho người thực hiện, dữ liệu trước và sau, lý do, thời gian, kết quả | `userController.ts`, `roleApplicationRepository.ts`, UI history | Cần xác nhận | Tạo `account_audit_log` và lưu `actor_id`, `before`, `after`, `reason`, `at`, `outcome` |
| 4 | BTC assignment / school assignment có logic nhưng UI workflow và giới hạn theo trường / giải chưa được “professional” hóa và rõ ràng | `userRepository.ts`, `tournamentRoutes.ts`, `App.tsx` | Cần xác nhận | Cần màn hình riêng cho “liên kết BTC – trường”, “quản lý giải theo phạm vi”, “thu hồi quyền theo scope” |
| 5 | Luồng duyệt kết quả trận / BTC xác nhận có kiểm soát quyền nhưng chưa thấy full versioning / revision history theo yêu cầu | `match-service/src/scheduling/authorization.ts` | Cần xác nhận | Tạo model `match_report_revision` với `pending/approved/rejected/requested_changes` |
| 6 | Quyền “ADMIN cuối cùng” không thấy được kiểm soát đầy đủ trong admin CRUD | `userRoutes.ts`, `userController.ts`, `userRepository.ts` | Cần xác nhận | Thêm guard “không khóa/xóa admin cuối cùng nếu còn 1 admin active” |
| 7 | Thông báo tới người dùng theo từng thay đổi role/lock/unlock/disable chưa được kiểm tra đầy đủ ở hệ thống | `verificationEmailService.ts`, notification service | Chưa đủ bằng chứng | Cần xác nhận event + payload + retry + dead-letter handling |

## 11. Đánh giá cuối cùng

### Điều đã có

- Kiến trúc 5 service được giữ nguyên.
- Cấu trúc role và RBAC cơ bản rõ ràng.
- Các route/protected middleware dành cho admin/BTC/referee/tournament manager đã có.
- Hệ thống hiện có đủ “nền móng” để tiến tới module quản lý tài khoản chuyên nghiệp.

### Điều còn thiếu hoặc chưa rõ ràng

- Quy trình admin hoàn chỉnh: detail, edit, lock/unlock, disable, history, reason tracking, notification and audit log.
- Luồng soft-delete / deactivation theo business relationship.
- Workflow “role assignment + scope assignment + revoke + notification + session invalidation” đi sát yêu cầu thực tế.
- Luồng duyệt kết quả trận / versioned reports / BTC approval theo mô hình nghiệp vụ đầy đủ.

### Mức độ sẵn sàng

- Mức “cơ sở hạ tầng RBAC và role model có sẵn”: khá tốt.
- Mức “module quản lý tài khoản chuyên nghiệp theo yêu cầu nghiệp vụ”: chưa đạt đầy đủ theo yêu cầu ban đầu.
- Mức “luồng trọng tài/BTc duyệt kết quả theo quy trình audit đầy đủ”: cần triển khai hoặc xác nhận thêm.

## 12. Kết luận

Dự án hiện có nền tảng phân quyền và role model hợp lý theo 6 vai trò, nhưng không phải lúc nào cũng “đủ mạnh” theo từng nghiệp vụ: tài khoản admin, BTC, referee, và quyền cấp/thu hồi role cần tiếp tục kiểm tra với logic business đầy đủ và audit log rõ ràng. Tại thời điểm khảo sát hiện tại, hệ thống có cơ sở dữ liệu, route và middleware tốt, nhưng vẫn còn các khoảng trống quan trọng cần xác nhận và xây dựng thêm trước khi coi là module quản trị tài khoản và quyền hoàn chỉnh.

## 13. Tình trạng theo yêu cầu "chỉ kiểm tra và báo cáo"

- Đã kiểm tra và lập báo cáo.
- Chưa sửa code.
- Chưa sửa database.
- Chưa đổi SMTP/ENV.
- Chưa reset data.
- Đang chờ xác nhận để đi sang giai đoạn triển khai/khắc phục code nếu người dùng muốn tiếp tục.

## 14. Cập nhật RBAC ngày 2026-11-06

Phần audit ban đầu ở trên phản ánh trạng thái trước đợt chỉnh sửa RBAC. Các thay đổi đã triển khai sau đó:

| Vai trò | Quyền hiện tại sau điều chỉnh |
|---|---|
| ADMIN | Quản lý tài khoản/trường; xem giải, đội, trận và dữ liệu liên quan; gửi yêu cầu tạm dừng trận. Không có quyền tạo/chỉnh sửa giải, duyệt đăng ký, lập lịch, phân công trọng tài, cập nhật kết quả hoặc sửa đội/thành viên. |
| BTC | Tạo và điều hành giải khi có role BTC; mọi thao tác giải, đăng ký, lịch và trận đều phải kiểm tra assignment theo từng giải. Không có quyền sửa thông tin CLB hoặc thành viên CLB. |
| TEAM_CAPTAIN | Chỉ thao tác trên đội có `captain_id` trùng tài khoản; tạo/cập nhật đội, quản lý thành viên, gửi đăng ký giải và cập nhật roster riêng theo từng cặp đội–giải. |

Các điểm đã sửa:

- Tournament manager middleware và API kiểm tra assignment không còn cấp quyền quản lý giải chỉ vì role ADMIN. Middleware phân giải `tournamentId` cho thao tác điều lệ/kỳ đăng ký theo ID tài nguyên; nếu không xác định được phạm vi, trả `TOURNAMENT_SCOPE_REQUIRED` thay vì thông báo nhầm quyền system administrator.
- Organization yêu cầu BTC có assignment tournament cho quyết định đăng ký/roster và TEAM_CAPTAIN là đại diện hợp lệ cho mọi thay đổi đội/thành viên/roster. Trạng thái trường, owner và trạng thái hệ thống không thể được đổi qua form đại diện đội.
- Match/Scheduling kiểm tra BTC theo giải được phân công; referee tiếp tục bị giới hạn theo trận được giao. ADMIN không còn được dùng API điều hành trận/lịch.
- ADMIN gửi yêu cầu tạm dừng; BTC của giải xem xét. Khi BTC chấp thuận, trận chuyển sang `POSTPONED`. Lịch cũ có thể hủy và trận hoãn có thể được xếp lịch/phát hành lại. Yêu cầu và quyết định được lưu trong Match database.
- Team registration và roster vẫn là dữ liệu riêng theo tournament; club/team và membership là dữ liệu Organization, không tạo bản sao membership giữa các giải.

Kiểm thử sau triển khai cần xác nhận trên demo: ADMIN bị từ chối các API mutation nghiệp vụ; BTC được phép trên giải assigned và bị từ chối giải khác; TEAM_CAPTAIN chỉ sửa được đội sở hữu. Thành công typecheck/build/healthcheck không thay thế các kiểm thử quyền này. Không có migration nào xóa hoặc sửa dữ liệu giải/đội hiện có; migration mới chỉ tạo bảng yêu cầu tạm dừng.

Giới hạn còn lại: giao diện đại diện đội hiện có API gửi roster nhưng cần kiểm thử quy trình cập nhật roster theo từng giải trên dữ liệu live; giao diện/lifecycle resume sau khi BTC chấp thuận cần xác nhận theo cách vận hành lịch của BTC.

## 15. Phạm vi trường và quota đăng ký giải

- **Giải cấp trường:** `SINGLE_INSTITUTION` gắn với đúng trường tổ chức; API đăng ký lấy trường từ hồ sơ đội và từ chối câu lạc bộ trường khác.
- **Giải liên trường:** lưu bậc `UNIVERSITY`/`COLLEGE`, chế độ cho phép toàn bộ trường thuộc bậc đã chọn hoặc allowlist trường cụ thể, hạn mức mặc định theo trường và ngoại lệ từng trường ngay trong cấu hình từng giải.
- Đội trưởng chỉ gửi hồ sơ cho đội do mình đại diện. Organization xác minh trường hoạt động và gọi Tournament Service để kiểm tra giải, phạm vi, thời gian cùng hạn mức; hồ sơ vẫn được gắn với `tournament_id`, không chuyển đến BTC của trường đội.
- Reservation được serialize theo giải trong Tournament DB. Reservation pending/approved cùng hồ sơ đang chờ/đã duyệt được tính vào quota toàn giải và quota trường; từ chối/rút/xóa nhả chỗ. Trạng thái reservation đồng bộ khi Organization lưu hoặc xét duyệt hồ sơ.
- BTC chỉ xem/lọc hồ sơ của giải được phân công; API hỗ trợ lọc theo trường, trạng thái và tên đội/trường. Màn xét duyệt hiển thị pending/approved và hạn mức theo trường.
- Migration mới là additive: Tournament migration v6 thêm cấu hình scope, limit và reservation; Organization migration v11 lưu snapshot trường của hồ sơ và index đếm quota. Không xóa hay ghi đè registrations hiện tại.
- Đã có cấu hình API, kiểm soát backend và giao diện tương ứng. Sau triển khai, Tournament migration v6 và Organization migration v11 đã được xác nhận trong database; cả hai service, API Gateway và web-client đều chạy/healthy, các endpoint health trả HTTP 200.
- Không có giải đang mở đăng ký để kiểm thử hai scope trên dữ liệu live. `DEMO_ACCOUNT_PASSWORD` chưa được cấu hình trong `.env`, nên lần kiểm tra này không thực hiện đăng nhập TEAM_CAPTAIN hoặc tạo/duyệt hồ sơ demo. Quota đồng thời và luồng duyệt/từ chối vẫn cần test end-to-end khi có dữ liệu/credential phù hợp.
- Không reset database hoặc xóa volume; không tạo dữ liệu demo trong lần triển khai này. Typecheck/build/healthcheck và migration thành công không chứng minh đầy đủ nghiệp vụ.
- Không tìm thấy tài liệu SRS riêng trong workspace; đã cập nhật [Usecase_da_chinh_sua_v2.md](./docs/Usecase_da_chinh_sua_v2.md) và [API_ROUTING.md](./docs/API_ROUTING.md). Cần hợp nhất nội dung vào SRS chính thức nếu nhóm có bản quản lý bên ngoài workspace.

### Xác nhận live sau triển khai

- Bản đăng ký trường/bậc đào tạo và quota đã được build/deploy vào Docker. Compose config hợp lệ; migrations v6/v11 hoàn tất; các service Tournament/Organization, API Gateway và web-client hoạt động.
- Không có giải `OPEN_REGISTRATION` tại thời điểm kiểm tra; `DEMO_ACCOUNT_PASSWORD` không được cấu hình trong `.env`. Vì vậy, không thể kiểm thử hồ sơ đăng ký nội bộ/liên trường, đồng thời hoặc xét duyệt trên tài khoản demo ở lần này.
- Kiểm tra API không đăng nhập: `GET /api/tournaments/registration-options` và `POST /api/tournaments` trả `401`. Kiểm tra DB chỉ đọc xác nhận vẫn có 7 đội và 2 hồ sơ đăng ký đã duyệt.
- Migrations chỉ bổ sung cấu hình/reservation và snapshot/index trường; không xóa dữ liệu hiện có. Không chạy seed, không tạo hoặc duyệt hồ sơ mới.

- ADMIN, BTC và TEAM_CAPTAIN đăng nhập thành công qua API Gateway bằng tài khoản demo.
- ADMIN đọc danh sách tài khoản thành công (`GET /api/users?limit=1`, tổng 53); các request tạo đội, giải và trận bị từ chối `403`.
- BTC đọc đăng ký và lịch quản lý của giải được phân công (`200`); cùng các endpoint trên của giải ngoài phạm vi bị từ chối `403`. BTC tạo đội bị từ chối `403`.
- TEAM_CAPTAIN đọc được đội của mình (1 đội); tạo giải và truy cập API danh sách tài khoản bị từ chối `403`.
- Kiểm tra giao diện đăng nhập ADMIN: menu quản lý tài khoản/yêu cầu hiển thị và dashboard hiện tổng số 53 tài khoản.
- Trong kiểm thử, phát hiện `GET /api/users` lỗi `500` do truy vấn nhóm chưa bao gồm `account_profiles.profile_data`. Đã sửa `GROUP BY` trong `userRepository.ts`, build/deploy lại Auth Service; API và dashboard trả dữ liệu thành công.
- Xác nhận Match database có bảng `match_pause_requests` và hai index tra cứu/giới hạn yêu cầu đang chờ.

Các kiểm tra trên chỉ đọc dữ liệu hoặc xác nhận quyền; không duyệt đăng ký, không thay đổi roster/lịch/trận và không tạo yêu cầu tạm dừng trên dữ liệu demo. Vì vậy, quy trình ghi nhận và duyệt yêu cầu tạm dừng, cũng như cập nhật roster theo giải, chưa được kiểm thử mutation end-to-end.
