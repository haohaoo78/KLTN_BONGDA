**TÀI LIỆU KIẾN TRÚC TỔNG THỂ**

**SFTMS – Student Football Tournament Management System**

_Hệ thống quản lý giải bóng đá sinh viên cao đẳng – đại học_

|     |     |
| --- | --- |
| Phiên bản | 1.2 – Kiến trúc mục tiêu 5 services |
| Kiến trúc | Microservices theo miền nghiệp vụ |
| Công nghệ chính | React, Node.js, Nginx, PostgreSQL |
| Thành phần tùy chọn | RabbitMQ, Redis |
| Triển khai | Docker Compose – nhóm 02 thành viên |

# 1\. Mục đích và phạm vi

SFTMS số hóa quy trình tổ chức giải bóng đá sinh viên: quản lý tài khoản và quyền; trường, đội, cầu thủ và đăng ký; cấu hình giải và điều lệ; bốc thăm, sân và lịch; đội hình, diễn biến, biên bản và xác nhận kết quả; bảng xếp hạng, thống kê, kỷ luật, khiếu nại, thông báo và tra cứu công khai.

Tài liệu mô tả kiến trúc mục tiêu để thống nhất phát triển theo SRS. Tên service, event và trạng thái là quy ước kỹ thuật; phải được dùng nhất quán trong API, cơ sở dữ liệu và kiểm thử.

# 2\. Nguyên tắc thiết kế

- Service chỉ sở hữu và ghi dữ liệu thuộc miền nghiệp vụ của mình.
- REST dùng cho thao tác cần phản hồi ngay; RabbitMQ dùng cho tác vụ hậu xử lý hoặc nhiều bên cần nhận sự kiện.
- PostgreSQL là nguồn dữ liệu nghiệp vụ chính. Redis không thay thế database.
- Quyền, phạm vi tài nguyên và điều kiện chuyển trạng thái luôn được kiểm tra ở backend.
- Chỉ kết quả đã xác nhận hợp lệ mới được dùng để tính bảng xếp hạng và kỷ luật.
- Thao tác nhạy cảm có optimistic locking và audit log.

# 3\. Kiến trúc tổng thể

_Hình 1. Kiến trúc logic SFTMS. Các mũi tên thể hiện luồng request hoặc kết nối hạ tầng; không biểu thị mọi lời gọi REST giữa các service._

Kiến trúc mục tiêu đặt React sau Nginx reverse proxy và API Gateway. Runtime hiện tại dùng Express làm API Gateway; Nginx trong image web phục vụ frontend, chưa thay thế API Gateway. Backend xử lý nghiệp vụ và chỉ truy cập database thuộc quyền sở hữu của service mình. RabbitMQ chỉ bật khi event flow có publisher/consumer đáng tin cậy; Redis đang được auth dùng cho session và không bắt buộc cho các miền còn lại.

# 4\. Phân chia service và dữ liệu sở hữu

|     |     |     |     |
| --- | --- | --- | --- |
| #   | Service | Trách nhiệm chính | Dữ liệu sở hữu |
| 1   | Auth | Tài khoản, role, đăng nhập, xác minh email, password reset và refresh session | User, Role, UserRole, verification/reset records, RefreshSession |
| 2   | Organization | Trường, đội, cầu thủ, membership và đại diện đội | Institution, Team, Player, TeamMembership |
| 3   | Tournament | Giải, điều lệ, thời hạn đăng ký, điều kiện, phê duyệt, thể thức và danh sách tham dự | Tournament, Season, Regulation, Registration, Roster, Group, Draw |
| 4   | Match | Lịch, sân, trọng tài, trận, kết quả, BXH, đội hình, diễn biến và kỷ luật | Venue, Schedule, Match, MatchResult, Standing, Lineup, MatchEvent, Card, Suspension, Complaint, Decision |
| 5   | Notification | Thông báo trong ứng dụng, email giao dịch và trạng thái gửi | Notification, DeliveryLog, email delivery records |

Đây là ranh giới nghiệp vụ mục tiêu gồm năm service. Chi tiết mapping từ các database hiện tại, route tương thích và tiến độ chuyển đổi nằm trong [docs/REFACTOR_8_TO_5.md](./REFACTOR_8_TO_5.md). Tài liệu này mô tả đích kiến trúc; không khẳng định việc chuyển đổi runtime/dữ liệu đã hoàn tất.

**Trạng thái triển khai hiện tại:** Compose chạy năm backend runtime. Auth đã nhận user/profile APIs; Match đã nhận scheduling và discipline routes; Notification đang gửi email xác minh/reset theo yêu cầu nội bộ của Auth. Registration/roster vẫn nằm ở Organization. Auth/User và Match/Scheduling/Discipline vẫn dùng các database nguồn riêng, tất cả được giữ nguyên; chưa hoàn tất data consolidation hoặc full SRS acceptance.

# 5\. Database ownership

_Hình 2. Ánh xạ service sang database/schema sở hữu._

Phương án triển khai gọn: một PostgreSQL instance trong Docker Compose, bên trong có database riêng cho từng service hoặc schema riêng kèm tài khoản/quyền truy cập tách biệt. Service khác không được ghi trực tiếp vào database/schema của service sở hữu.

|     |     |
| --- | --- |
| Dữ liệu tham chiếu | Quy tắc |
| Đội và mùa giải | Lưu teamId, seasonId làm tham chiếu logic; không tạo khóa ngoại xuyên database. |
| Trận và lịch | Scheduling lưu matchId; Match Operations lưu seasonId, groupId, homeTeamId, awayTeamId. |
| Kết quả và BXH | Standings nhận dữ liệu kết quả đã xác nhận qua event hoặc API được công bố. |
| Kỷ luật | Discipline lưu playerId, teamId, seasonId và sourceMatchId. |
| Thông báo | Notification lưu userId, eventType và objectId liên quan. |

# 6\. Giao tiếp giữa các service

## 6.1 REST – đồng bộ

- React → Nginx → service đích: tạo giải, duyệt hồ sơ, chốt đội hình, xác nhận kết quả.
- Match Operations gọi API được công bố để kiểm tra roster và tình trạng treo giò trước khi chốt đội hình.
- Scheduling kiểm tra sân, đội, trọng tài và khoảng nghỉ trước khi công bố lịch.
- Không tạo chuỗi gọi REST dài nếu bước tiếp theo có thể xử lý bằng event.

## 6.2 RabbitMQ – bất đồng bộ

_Hình 3. Luồng event. Các consumer nhận thông điệp độc lập; event được phát sau khi transaction nghiệp vụ commit._

|     |     |     |
| --- | --- | --- |
| Event | Nơi phát | Nơi nhận / mục đích |
| TeamRosterApproved | Tournament | Notification; các luồng cần biết roster đã duyệt |
| SchedulePublished | Match | Notification gửi lịch chính thức |
| MatchResultVerified | Match | Tính lại standings, cập nhật kỷ luật và thông báo |
| MatchResultCorrected | Match | Tính lại standings và trạng thái kỷ luật theo kết quả được sửa có thẩm quyền |
| DisciplinaryDecisionIssued | Match | Notification và Match khi cần áp dụng quyết định |
| TournamentCompleted | Tournament | Standings và Notification tổng kết giải |

Consumer phải idempotent, dùng eventId hoặc khóa nghiệp vụ để xử lý thông điệp lặp. Để giảm nguy cơ mất event sau khi ghi database, ưu tiên Transactional Outbox; nếu MVP chưa triển khai, phải ghi rõ giới hạn và có cơ chế retry/log.

# 7\. Xác thực và phân quyền

_Hình 4. Luồng xác thực. Refresh token được đặt trong cookie HttpOnly; backend vẫn xác minh quyền cho từng request._

|     |     |
| --- | --- |
| Thành phần | Quy định |
| Access token | JWT thời hạn ngắn; gửi theo cơ chế thống nhất giữa frontend và backend. |
| Refresh token | Lưu trong cookie HttpOnly; bật Secure khi dùng HTTPS và chọn SameSite phù hợp. |
| Cookie / CSRF | Không đọc token bằng JavaScript. Nếu dùng cookie cho request xác thực, triển khai CSRF protection phù hợp. |
| Mật khẩu | Băm bằng Argon2 hoặc bcrypt; không lưu mật khẩu rõ. |
| Role và scope | Role xác định nhóm quyền; scope giới hạn seasonId/teamId/matchId được phép thao tác. |
| Authorization | Mỗi service kiểm tra JWT, role, scope và trạng thái nghiệp vụ; không chỉ ẩn nút trên giao diện. |
| Audit log | Ghi actorId, action, entityType, entityId, thời gian, oldValue/newValue và lý do khi cần. |

JWT access token và scope ở bảng trên là kiến trúc mục tiêu, chưa phải trạng thái runtime: hệ thống hiện dùng Redis session cookie và opaque refresh token. Không tuyên bố đã đạt JWT cho đến khi triển khai và kiểm thử đầy đủ.

# 8\. Quy trình xác nhận kết quả trận

_Hình 5. Sequence xác nhận kết quả. Event chỉ phát sau khi kết quả được cập nhật thành công._

1.  Trọng tài nộp biên bản; Match Operations kiểm tra phân công, trạng thái trận và dữ liệu đầu vào, sau đó lưu ở trạng thái chờ duyệt.
2.  BTC kiểm tra biên bản. Khi xác nhận, backend kiểm tra quyền, scope, trạng thái hiện tại và version dữ liệu.
3.  Trong một transaction, cập nhật trạng thái và tăng version với điều kiện version khớp. Nếu không cập nhật được đúng một dòng, trả lỗi xung đột và yêu cầu tải lại.
4.  Sau commit, phát MatchResultVerified. Standings tính lại BXH; Discipline cập nhật dữ liệu kỷ luật; Notification gửi thông báo.
5.  Trận Locked không được sửa bằng luồng thông thường. Việc sửa do khiếu nại phải có thẩm quyền, lý do và audit log.

Nguyên tắc: kết quả trọng tài vừa nhập hoặc biên bản còn chờ duyệt không được ảnh hưởng BXH.

# 9\. Trạng thái nghiệp vụ

## 9.1 Mùa giải

|     |     |
| --- | --- |
| Chuyển trạng thái | Điều kiện bắt buộc |
| Draft → OpenRegistration | Cấu hình và điều lệ hợp lệ; người thao tác có quyền. |
| OpenRegistration → RegistrationClosed | Đến hạn hoặc BTC đóng đăng ký. |
| OpenRegistration → Cancelled | Không đủ đội hợp lệ theo điều lệ; có quyết định của BTC. |
| RegistrationClosed → Drawn | Danh sách đội được duyệt và bốc thăm hoàn tất. |
| Drawn → Ongoing | Lịch hợp lệ, không có xung đột cứng và đã công bố. |
| Ongoing → Completed | Các trận bắt buộc đã đạt trạng thái kết thúc theo SRS. |
| Completed → Archived | Tổng kết và báo cáo theo quy trình đã hoàn tất. |

## 9.2 Trận đấu

|     |     |
| --- | --- |
| Trạng thái / chuyển tiếp | Quy tắc |
| Scheduled → LineupConfirmed | Đội hình hợp lệ; kiểm tra roster và treo giò. |
| LineupConfirmed → InProgress | Trọng tài được phân công bắt đầu trận. |
| InProgress → Finished | Trọng tài kết thúc trận và nộp biên bản. |
| InProgress → Abandoned | Trận bị bỏ dở; chờ quyết định xử lý có thẩm quyền. |
| Finished / Abandoned → Verified hoặc Awarded → Verified | BTC xác nhận kết quả hoặc quyết định hành chính hợp lệ. |
| Verified → Locked | Hết thời hạn khiếu nại và đáp ứng điều kiện khóa theo SRS. |
| Scheduled / LineupConfirmed → Postponed → Scheduled | BTC hoãn trận; lịch mới được xác lập và kiểm tra xung đột. |

Mỗi service chỉ thay đổi trạng thái thuộc miền mình sở hữu. Frontend không tự quyết định chuyển trạng thái; backend kiểm tra trạng thái hiện tại, điều kiện, quyền và version.

# 10\. Triển khai Docker Compose

_Hình 6. Triển khai trên một Docker Compose network; mỗi backend service có container riêng._

|     |     |     |
| --- | --- | --- |
| Container | Vai trò | Lưu bền vững |
| web | Phục vụ React build hoặc dev server trong môi trường phát triển | Không |
| nginx | Reverse proxy, routing, rate limiting; TLS theo môi trường | Không |
| 5 backend containers | Auth, Organization, Tournament, Match, Notification; mỗi service có image và cấu hình riêng | Dữ liệu chính nằm trong database do service sở hữu |
| postgres | Lưu database/schema của các service | Có; volume và backup |
| rabbitmq (tùy chọn) | Queue/event bất đồng bộ | Bật persistence cho queue cần thiết |
| redis (tùy chọn) | Cache/rate limit | Không phải nguồn dữ liệu chính |

Một Dockerfile cho mỗi service là lựa chọn rõ ràng và dễ triển khai độc lập. Docker Compose có thể chạy tất cả container trên cùng máy. Không bắt buộc tạo một PostgreSQL container cho mỗi service: database ownership được tách logic bên trong một PostgreSQL instance ở quy mô đồ án.

## 10.1 Yêu cầu vận hành tối thiểu

- Đặt cấu hình và secret trong biến môi trường; cung cấp .env.example không chứa secret thật.
- Health check cho PostgreSQL, RabbitMQ (nếu bật) và backend; cấu hình service phụ thuộc đúng thứ tự khởi động.
- Chạy migration có kiểm soát; không tự ý sửa schema thủ công trên môi trường dùng chung.
- Log lỗi có requestId; không ghi access token, refresh token hoặc mật khẩu vào log.
- Backup PostgreSQL định kỳ và kiểm thử khôi phục; volume không thay thế backup.

# 11\. Dữ liệu dẫn xuất và quy tắc xếp hạng

Standings chỉ tính từ kết quả đã Verified theo quy tắc điều lệ có phiên bản. Không cung cấp API chỉnh điểm/thứ hạng trực tiếp. Khi kết quả được sửa hợp lệ, tính lại từ dữ liệu nguồn thay vì cộng/trừ mù quáng.

Theo thứ tự tiêu chí trong SRS được cung cấp: tổng điểm; đối đầu trực tiếp; hiệu số bàn thắng bại; tổng bàn thắng; điểm fair play; bốc thăm. Khi từ ba đội trở lên bằng điểm, tạo bảng con gồm các đội liên quan và tính đối đầu trên các trận giữa họ. Cần có unit test cho hai đội bằng điểm, ba đội bằng điểm và trường hợp thiếu dữ liệu đối đầu.

# 12\. Yêu cầu phi chức năng và kiểm thử kiến trúc

|     |     |
| --- | --- |
| Nội dung | Cách xác minh |
| Trang lịch/BXH đáp ứng ngưỡng SRS | Đo response time và p95 với dữ liệu mục tiêu; kiểm tra index và phân trang. |
| Sinh lịch | Benchmark số đội, số bảng và số lượt theo dữ liệu SRS; kiểm tra xung đột sân/đội/trọng tài. |
| Bảo mật | Thử request thiếu role/scope; kiểm tra cookie HttpOnly, HTTPS, CSRF và giới hạn đăng nhập. |
| Đồng thời | Hai BTC xác nhận cùng biên bản: chỉ một cập nhật thành công; request còn lại nhận conflict. |
| Event lặp | Gửi lại MatchResultVerified; BXH và thẻ không bị tính hai lần. |
| Trận Locked | Request sửa thông thường bị từ chối và ghi audit log. |
| Tính đúng BXH | Kiểm thử đối đầu trực tiếp và bảng con nhiều đội bằng điểm. |
| Backup/restore | Diễn tập khôi phục database và đo thời gian phục hồi. |

# 13\. Cấu trúc mã nguồn đề xuất

Dùng monorepo để hai thành viên chia sẻ hợp đồng API/event nhưng vẫn tách service. Mỗi backend service có src/routes hoặc controllers, services, repositories, validators, middleware, events, tests, migrations và Dockerfile. Frontend nằm trong apps/web; cấu hình Nginx và Docker Compose nằm trong infrastructure/root.

# 14\. Ưu tiên triển khai MVP

1.  Authentication, cookie HttpOnly, role và scope.
2.  Quản lý giải, điều lệ, trường, đội, cầu thủ, hồ sơ và roster.
3.  Bốc thăm, lập lịch, sân/trọng tài và kiểm tra xung đột.
4.  Đội hình, sự kiện trận, biên bản, xác nhận và khóa kết quả.
5.  BXH, đối đầu, thống kê, thẻ và treo giò.
6.  Tra cứu công khai, khiếu nại, thông báo và báo cáo theo SRS.
7.  Redis, WebSocket và tối ưu vận hành chỉ thực hiện khi luồng cốt lõi ổn định.

# 15\. Quyết định kiến trúc

|     |     |
| --- | --- |
| Quyết định | Lý do / giới hạn |
| 5 service theo miền nghiệp vụ | Giảm độ phức tạp vận hành cho nhóm hai người nhưng vẫn giữ quyền sở hữu miền và dữ liệu rõ ràng. |
| Một PostgreSQL instance, tách database/schema | Giảm chi phí triển khai nhưng giữ quyền sở hữu dữ liệu. |
| Dockerfile riêng cho từng service | Build, test và triển khai service độc lập. |
| REST + một số domain event | REST cho phản hồi ngay; event cho hậu xử lý. |
| Redis/RabbitMQ tùy chọn theo MVP | Không làm tăng độ phức tạp nếu chưa cần; không thay PostgreSQL. |
| Không dùng Kubernetes/Event Sourcing | Vượt nhu cầu đồ án và làm tăng chi phí vận hành. |

# Kết luận

Kiến trúc mục tiêu SFTMS tách năm service nghiệp vụ, dùng React, Nginx/API Gateway và PostgreSQL làm nguồn dữ liệu chính; REST dùng cho thao tác đồng bộ, RabbitMQ chỉ triển khai khi event flow cần thiết và có thể kiểm thử. Docker Compose chạy các container trên một máy; mỗi service có image và cấu hình triển khai riêng nhưng không cần một máy chủ riêng. Runtime đang chuyển đổi từng bước; xem [PROJECT_OVERVIEW.md](../PROJECT_OVERVIEW.md) để biết phần nào đã được cutover. Tính đúng đắn phụ thuộc vào quyền sở hữu dữ liệu, state machine, xác nhận kết quả, tính idempotent của event, optimistic locking và audit log.

Ghi chú: tài liệu là kiến trúc mục tiêu dựa trên nội dung SRS được cung cấp. Trước khi nghiệm thu, cần đối chiếu tên trạng thái, điều kiện nghiệp vụ, API và các ngưỡng NFR với bản SRS chính thức của dự án.