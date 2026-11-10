# Hệ thống quản lý giải bóng đá sinh viên

Monorepo **Microservices** cho đồ án / khóa luận — quản lý giải đấu, đội bóng, lịch thi đấu và kết quả.

## Tech stack

Node.js 20 · TypeScript · Express · React (Vite) · PostgreSQL · Redis · Docker · GitHub Actions

## Cấu trúc nhanh

| Thư mục | Mô tả |
|---------|--------|
| `apps/api-gateway` | API Gateway |
| `apps/web-client` | Giao diện web |
| `services/*` | Năm backend service hiện tại: Auth, Organization, Tournament, Match, Notification |
| `packages/shared` | Shared types/constants |

Tổng quan kiến trúc hiện tại, cây source, API, database ownership và luồng giao tiếp: **[PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)**.
Mapping service, bảng dữ liệu, API và lộ trình chuyển đổi an toàn: **[docs/REFACTOR_8_TO_5.md](./docs/REFACTOR_8_TO_5.md)**.
API Gateway route ownership và tương thích endpoint: **[docs/API_ROUTING.md](./docs/API_ROUTING.md)**.
Chi tiết tiến độ và kiến trúc hiện tại: **[docs/PROJECT_STATUS_OVERVIEW.md](./docs/PROJECT_STATUS_OVERVIEW.md)**.
Kết quả audit và các cổng còn lại trước production: **[docs/PROJECT_AUDIT_AND_PLAN.md](./docs/PROJECT_AUDIT_AND_PLAN.md)**.
Tài khoản demo development và ma trận kiểm tra quyền: **[docs/DEMO_ACCOUNTS_AND_TESTING.md](./docs/DEMO_ACCOUNTS_AND_TESTING.md)**.

### Các miền nghiệp vụ mục tiêu

| Service | Trách nhiệm |
|---|---|
| Auth Service | Tài khoản, vai trò, đăng nhập, xác minh email, password reset |
| Organization Service | Trường, đội, cầu thủ, membership, đại diện đội |
| Tournament Service | Giải đấu, điều lệ, đăng ký, điều kiện, duyệt đội và danh sách tham dự |
| Match Service | Lịch, sân, trọng tài, trận đấu, kết quả, BXH và kỷ luật |
| Notification Service | Thông báo trong ứng dụng và email giao dịch |

**Trạng thái chuyển đổi:** Compose hiện chạy 5 backend runtime: Auth, Organization, Tournament, Match và Notification. Auth/User và Match/Scheduling/Discipline đã được hợp nhất ở runtime; dữ liệu vẫn nằm trong các database nguồn được giữ nguyên. Registration/roster vẫn thuộc Organization, chưa chuyển sang Tournament. Xem [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md); không xóa database nguồn trong giai đoạn này.

## Chạy toàn bộ hệ thống bằng Docker

```powershell
docker compose --profile apps up --build -d
docker compose ps
```

Compose reads the root `.env` automatically. The local `.env` in this workspace contains local SMTP settings; keep it private and never use development database passwords or application secrets in production. For a fresh checkout, copy `.env.example` to `.env` and provide real SMTP credentials before enabling account registration.

Giao diện: `http://localhost:5173`  
API Gateway: `http://localhost:8080/health`

Năm job migration là one-shot runners, không phải backend runtime thứ sáu trở đi. Auth migration runner nâng cấp cả `sfl_auth` và `sfl_user`; Match runner nâng cấp `sfl_match`, `sfl_scheduling` và `sfl_discipline`. Các database cũ được giữ nguyên và vẫn do runtime đích tương ứng sử dụng; không có thao tác gộp hoặc xóa dữ liệu.

Chạy migration thủ công sau khi build image (Compose sẽ khởi động PostgreSQL nếu cần):

```powershell
docker compose --profile apps run --rm auth-migrate
docker compose --profile apps run --rm tournament-migrate
docker compose --profile apps run --rm organization-migrate
docker compose --profile apps run --rm match-migrate
docker compose --profile apps run --rm notification-migrate
```

`auth-migrate` dùng cả `DATABASE_URL` và `ACCOUNT_DATABASE_URL`; `match-migrate` dùng `DATABASE_URL`, `SCHEDULING_DATABASE_URL` và `DISCIPLINE_DATABASE_URL`. Khi khởi động Compose bình thường, mỗi runtime tự chờ job migration sở hữu trước khi chạy.

Mỗi database lưu số phiên bản trong bảng `sfl_schema_migrations`. Migration nền tảng phiên bản 1 được áp dụng trong transaction, có khóa advisory để tránh hai runner cùng cập nhật một database. Trên database hiện hữu, nó chạy các câu lệnh schema có tính idempotent để tạo phần còn thiếu; không xóa bảng hoặc dữ liệu. Nếu schema cũ không tương thích, migration dừng và transaction được rollback thay vì tự ý chuyển đổi dữ liệu. Không chỉnh sửa migration đã áp dụng; thêm phiên bản mới cho các thay đổi schema về sau.

Tournament database hiện có migration phiên bản 2 cho cấu hình phạm vi/trường, thể thức bóng đá và giải, giới hạn đội/cầu thủ, điều lệ có cấu trúc và thứ tự tiêu chí xếp hạng. Form tạo giải yêu cầu thông tin ban tổ chức, liên hệ, thời gian đăng ký/thi đấu và điều kiện tham gia. Backend lưu giải, kỳ đăng ký, điều lệ, trường được phép và tiêu chí xếp hạng trong cùng một transaction; lỗi ở một phần sẽ rollback toàn bộ lần tạo. Migration được áp dụng qua job `tournament-migrate` khi chạy Compose.

Trước khi nâng cấp production, sao lưu database. Không có migration rollback tự động vì rollback DDL có thể làm mất dữ liệu; phương án phục hồi là dừng ứng dụng, khôi phục bản backup đã xác minh, rồi triển khai lại phiên bản tương ứng. Khôi phục production cần được diễn tập riêng trên bản sao dữ liệu.

### Email SMTP thật

Mail xác minh tài khoản và đặt lại mật khẩu luôn được Notification gửi qua SMTP thật đến đúng địa chỉ người dùng nhập trong form; không có Mailpit hay hộp thư giả lập. Auth chỉ báo đăng ký thành công sau khi nhà cung cấp SMTP chấp nhận email, nếu gửi lỗi API trả lỗi để người dùng thử lại/gửi lại xác minh.

Cấu hình trong `.env` (không đưa file này vào Git):

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`
- `SMTP_USER`, `SMTP_PASS` (có thể để trống nếu nhà cung cấp không yêu cầu xác thực)
- `MAIL_FROM` (địa chỉ đã được nhà cung cấp xác thực; nếu bỏ trống, dùng `EMAIL_FROM` cũ hoặc `SMTP_USER`), `MAIL_FROM_NAME`
- `CLIENT_URL` (URL HTTPS của website)
- `CORS_ORIGIN` (origin website production)
- `NODE_ENV=production`, `COOKIE_SECURE=true`, và các secret mạnh `SESSION_SECRET`, `INTERNAL_API_KEY`
- `COMPOSE_PROFILES=apps`, `SEED_DEMO_USERS=false`

Thay cả `POSTGRES_PASSWORD` bằng một mật khẩu mạnh dùng ký tự URL-safe (ví dụ chuỗi hex ngẫu nhiên), vì giá trị này được dùng trong connection URL của từng service. `.env.example` để trống các thông tin SMTP thật; không bật luồng đăng ký đến khi đã điền cấu hình provider. Gmail yêu cầu bật xác minh 2 bước và dùng App Password; không dùng mật khẩu đăng nhập thông thường. Khi provider từ chối hoặc không liên lạc được, API trả lỗi thay vì báo gửi thành công.

Các file `.env` bị loại khỏi Git và Docker build context; chỉ các file mẫu `.env.example` được phép theo dõi. Tài khoản email dùng làm người gửi cần được provider cho phép gửi SMTP; với Gmail hãy dùng App Password. Kiểm thử đăng nhập SMTP không tự gửi thư; cần một địa chỉ nhận thật để xác nhận thư đăng ký được giao tới hộp thư ngoài.

```powershell
# Cập nhật các biến môi trường production trước khi chạy.
docker compose --profile apps up --build -d
```

Luồng tài khoản: đăng ký → email xác minh → đăng nhập. Tính năng quên mật khẩu gửi liên kết có hạn một giờ; token xác minh và reset được hash khi lưu, chỉ sử dụng một lần.

## Chạy từng phần khi phát triển

```powershell
pnpm install
pnpm run build
docker compose up -d postgres redis
pnpm dev:gateway
pnpm dev:web
```

Frontend dev server: `http://localhost:5173` (proxy API đến Gateway cổng 8080).

## Dừng hệ thống

```powershell
docker compose --profile apps down
```

Không thêm `-v` khi dừng nếu muốn giữ dữ liệu PostgreSQL/Redis.

### Sao lưu và khôi phục PostgreSQL

Sao lưu toàn bộ databases trong PowerShell:

```powershell
docker exec sfl-postgres pg_dumpall -U sfl > .\sfl-backup.sql
```

Khôi phục chỉ vào instance PostgreSQL đã chuẩn bị đúng user/database và đã sao lưu dữ liệu hiện có:

```powershell
Get-Content .\sfl-backup.sql -Raw | docker exec -i sfl-postgres psql -U sfl
```

Không lưu bản sao lưu chứa dữ liệu cá nhân trong Git. Quy trình khôi phục trên chưa được thử với bản dump production.

## CI

Push/PR lên `main` hoặc `develop` → workflow `.github/workflows/ci.yml` (install, lint, typecheck, build, validate compose).

## License

Dự án học thuật — điều chỉnh license theo quy định trường/khoa.
