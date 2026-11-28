# Hướng dẫn dự án SFTMS

## Kiến trúc hiện tại

Chỉ có năm backend service trong `services/`:

1. `auth-service`: đăng nhập, tài khoản, vai trò, xác minh email, đặt lại mật khẩu và `/users/**`.
2. `organization-service`: trường, đội và cầu thủ.
3. `tournament-service`: giải đấu, điều lệ và kỳ đăng ký.
4. `match-service`: trận đấu, kết quả, bảng xếp hạng, lịch, sân, trọng tài và kỷ luật.
5. `notification-service`: thông báo trong ứng dụng và gửi email SMTP thật.

`apps/api-gateway` và `apps/web-client` là ứng dụng biên/client, không phải backend service. Redis dùng cho session. Không thêm runtime service ngoài năm miền trên nếu không có yêu cầu nghiệp vụ rõ ràng.

## Database và migration

Database hiện được giữ riêng để bảo toàn dữ liệu cũ; không xóa hoặc gộp database/volume khi chỉ hợp nhất source code:

- Auth: `sfl_auth`, `sfl_user`.
- Organization: `sfl_team`.
- Tournament: `sfl_tournament`.
- Match: `sfl_match`, `sfl_scheduling`, `sfl_discipline`.
- Notification: `sfl_notification`.

Compose có năm one-shot migration jobs, mỗi job thuộc một runtime service. `auth-migrate` nâng cấp cả hai Auth databases; `match-migrate` nâng cấp cả ba Match databases. Chúng không phải runtime services. Migration phải versioned, transactional, an toàn khi chạy lại và không được xóa dữ liệu hiện có. Không chỉnh sửa migration đã áp dụng; thêm phiên bản mới.

## Email

Email đăng ký, xác minh và reset luôn dùng SMTP provider thật, ở development lẫn production. Không đưa Mailpit, mock delivery hoặc giả lập thành công vào luồng nghiệp vụ. Secrets chỉ lấy từ `.env` local/deployment secret store; không ghi secrets vào source, log hoặc tài liệu.

## Quy ước thay đổi

- Giữ API paths đang được Gateway và frontend sử dụng, trừ khi có lý do kỹ thuật và migration tương thích.
- Giữ ownership rõ: service không truy cập trực tiếp database service khác.
- Kiểm tra xác thực, role và quyền sở hữu ở service; không chỉ dựa vào giao diện/Gateway.
- Dùng model, repository, service, controller, middleware và route theo pattern sẵn có.
- Cập nhật tài liệu nghiệp vụ/kiến trúc liên quan và nêu rõ các giới hạn chưa được kiểm thử.
- Không tuyên bố production-ready chỉ dựa trên typecheck, build hoặc healthcheck.

## Build, chạy và kiểm thử

```powershell
pnpm install
pnpm run typecheck
pnpm run build
docker compose --profile apps config --quiet
docker compose --profile apps up --build -d
docker compose ps
```

Build riêng service:

```powershell
pnpm --filter @sfl/auth-service build
pnpm --filter @sfl/organization-service build
pnpm --filter @sfl/tournament-service build
pnpm --filter @sfl/match-service build
pnpm --filter @sfl/notification-service build
```

Migration thủ công và tài liệu triển khai: xem [README.md](./README.md), [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md), [trạng thái dự án](./docs/PROJECT_STATUS_OVERVIEW.md) và [bản đồ refactor](./docs/REFACTOR_8_TO_5.md).

## Cập nhật UI/UX (06/11/2026)

### Cải thiện giao diện
- **Đăng nhập**: Đã nâng cấp panel đăng nhập với gradient background, shadow, border-radius lớn hơn, input focus effects
- **Thông báo**: Đã cải thiện notification bell button với hover effect, pagination buttons với style chuyên nghiệp
- **Nút bấm**: Đã thêm shadow, hover animation, border-radius cải thiện cho primary-button và button-secondary
- **Form inputs**: Đã thêm focus states với box-shadow và border-color transitions

### BTC Tournament Workspace
- Đã có sẵn 2 tab: "Giải đấu hiện hành" và "Giải đấu do tôi tổ chức"
- Đã thêm CSS chuyên nghiệp cho tabs, filters, list items, pagination
- Tabs có selected state với background màu xanh lá
- List items có hover effects và selected state
- Filters có grid layout responsive

### Backend fixes
- **Tournament scope error**: Đã sửa middleware `requireTournamentManager` để xử lý các route không có tournamentId trực tiếp trong path:
  - `/groups/:id` → query từ bảng groups
  - `/draws/:id` → query từ bảng draws
  - `/regulation-versions/:id` → query từ bảng regulation_versions
- Đã điều chỉnh routes để ensure tournamentId luôn có trong path hoặc body/query cho các mutations
- Các route mutation (POST/PUT/DELETE) giờ đều đi qua `requireTournamentManager` với tournamentId rõ ràng
