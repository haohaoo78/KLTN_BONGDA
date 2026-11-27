# Viewer, Team Captain và Player — kiểm tra tích hợp

Ngày kiểm tra: 27/11/2026. Phạm vi: luồng đọc dữ liệu đã công bố, trang theo dõi riêng của đội trưởng/cầu thủ, quyền xem dữ liệu cá nhân và hiển thị bảng xếp hạng trước khi có kết quả. Không sửa quy trình tạo giải, duyệt/chốt đội, bốc thăm, phân lịch hay phân công trọng tài.

## Nguồn dữ liệu và thay đổi

- Lịch công khai ghép fixture `PUBLISHED` của Match Service với schedule `PUBLISHED` của Scheduling theo `matchId`. Nhãn/biểu trưng đội lấy từ danh sách đội đã được duyệt của giải ở Organization Service; không tạo nhãn từ UUID và không dựa vào danh sách “đội của tôi”. Lịch nháp không xuất hiện.
- Bảng xếp hạng vòng tròn/vòng bảng dùng kết quả standings chính thức của Match Service và các tiêu chí xếp hạng đã ghim cho giải. Khi chưa có trận hoàn tất, đội vẫn xuất hiện với số liệu 0. Knockout giữ nguyên nguồn đội chưa xác định cho tới khi kết quả được công nhận.
- Trang giải công khai hiển thị sơ đồ đã công bố, bảng đấu, lịch đã công bố và kết quả APPROVED. Luồng trực tiếp đọc Match Service và SSE hiện có.
- Điều hướng đội trưởng tách `Giải đấu của đội tôi` và `Lịch của đội tôi` khỏi danh mục giải/lịch công khai. Phần giải của đội dùng hồ sơ đăng ký/roster hiện có và chỉ tổng hợp số trận, thành tích, vị trí bảng, trận gần nhất/kế tiếp và điều kiện đi tiếp khi dữ liệu chính thức cho phép.
- Không gian cầu thủ là chỉ đọc. Nó hiển thị lời mời của tài khoản, trạng thái đội đã được BTC duyệt, bảng/nhánh, lịch đã công bố, đội hình trận, kết quả được công khai và án treo giò của chính cầu thủ. Chức năng lập/chỉnh đội hình không được cấp cho PLAYER.
- Endpoint tra cứu treo giò cá nhân nay cần phiên đăng nhập có vai trò PLAYER và xác minh playerId thuộc chính userId. Internal ownership lookup thuộc Organization Service; Match Service không truy cập database Organization.
- Public schedule responses loại bỏ trường phân công trọng tài/thông tin quản trị và thêm tên/vị trí sân phục vụ hiển thị. Gateway cho phép ẩn danh đúng GET danh sách lịch; `manage`, các route chỉnh sửa và mọi mutation vẫn cần session/role.
- Danh sách giải frontend tải lại theo tài khoản/role hiện tại và lọc DRAFT cho người không phải BTC; điều này ngăn dữ liệu từ phiên BTC cũ tồn tại sau logout/login.
- Tên đội ở thẻ lịch tổng quan lấy từ đội đã duyệt công khai của các giải, không chỉ từ đội của tài khoản hiện tại. Trạng thái trận/giải, tiêu chí xếp hạng và thể thức trong trang công khai được Việt hóa; trang sơ đồ không in mã UUID rút gọn như tên trận.

## API được dùng

- `GET /api/tournaments/:id/fixtures/public`
- `GET /api/tournaments/:id/fixtures/group-standings/public`
- `GET /api/tournaments/:id/schedules`
- `GET /api/tournaments/:id/approved-teams`
- `GET /api/matches/:matchId/live-state`, `/api/matches/live`, các SSE route `/api/matches/live/stream` và `/api/matches/:matchId/stream`
- `GET /api/matches/:matchId/result` (chỉ kết quả đã APPROVED)
- `GET /api/tournament-invitations/my`
- `GET /api/players/:playerId/tournaments/:tournamentId/suspension` (chính cầu thủ đã xác thực)
- `GET/PUT /api/matches/:matchId/squads/:teamId` (đội trưởng; backend xác minh đội và trận)

Route chi tiết được ghi trong [API_ROUTING.md](./API_ROUTING.md).

## File được cập nhật trong phạm vi này

- `apps/api-gateway/src/index.ts` — cho phép ẩn danh đúng GET lịch đã công bố; các route quản trị không đổi.
- `apps/web-client/src/App.tsx`, `apps/web-client/src/App.css` — phân tách điều hướng captain/player, lọc DRAFT theo session/role và nạp danh mục tên đội đã duyệt.
- `apps/web-client/src/api/competition.ts` — typed reads cho fixture, lịch, bảng xếp hạng, lời mời và treo giò cá nhân.
- `apps/web-client/src/components/LiveMatchCenterPanel.tsx` — lịch công khai ghép fixture và lịch đã công bố; lịch đội tôi giới hạn theo đội captain.
- `apps/web-client/src/components/MyTeamTournamentsPanel.tsx` — tổng quan giải của đội, thứ hạng/thành tích lấy từ dữ liệu công nhận.
- `apps/web-client/src/components/PlayerParticipationWorkspace.tsx` — workspace Player chỉ đọc.
- `apps/web-client/src/components/PublicTournamentCompetitionPanel.tsx`, `apps/web-client/src/components/TournamentDetailPanel.tsx` — sơ đồ, standings, trạng thái tiếng Việt và bỏ mã UUID trên thẻ trận.
- `services/match-service/src/controllers/matchController.ts`, `services/match-service/src/controllers/lineupController.ts`, `services/match-service/src/routes/matchRoutes.ts` — ranh giới đọc công khai theo giải/fixture và standings nhóm công khai.
- `services/match-service/src/scheduling/controllers/schedulingController.ts`, `services/match-service/src/scheduling/services/schedulingService.ts` — projection lịch công khai và ánh xạ giải không công khai về 404.
- `services/match-service/src/discipline/controllers/disciplineController.ts`, `services/match-service/src/discipline/routes/disciplineRoutes.ts`, `services/organization-service/src/controllers/teamController.ts`, `services/organization-service/src/routes/teamRoutes.ts` — giới hạn tra cứu treo giò theo player đang đăng nhập.
- `docs/API_ROUTING.md`, `docs/VIEWER_PLAYER_CAPTAIN_AUDIT.md` — hợp đồng route, bằng chứng kiểm thử và giới hạn còn lại.

## Hướng dẫn kiểm tra bằng tài khoản demo hiện có

Các tài khoản dùng trong môi trường local/Docker đã được provision cho QA; mật khẩu demo `Demo@123456`.

| Vai trò | Tài khoản | Nội dung kiểm tra |
|---|---|---|
| BTC/Viewer | `dataset.btc01@football.local` | Danh sách giải và lịch công khai; quyền BTC hiện có vẫn giữ nguyên |
| Team Captain/Viewer | `drawdemo.captain01@football.local` | Giải đấu của đội tôi, roster hiện có, lịch chỉ gồm các trận của đội mình |
| Player/Viewer | `drawdemo.player0001@football.local` | Lời mời đã xác nhận, tư cách, lịch cá nhân và đội hình trận chỉ đọc |
| REFEREE/Team Captain/Viewer | `dataset.captain02@football.local` | Xác minh chuyển vai trò/điều hướng không làm mất không gian trọng tài; đội này không có đăng ký trong ba giải DEMO |

Ba giải đã dùng để đối chiếu:

- DEMO HCMC Student Champions Cup 2026 — `9f765a91-b8ab-4716-a083-0cf8a113db1b`.
- DEMO Student Knockout Cup 2026 — `d9fe5a04-5e71-41ec-b85c-f4567b294c68`.
- DEMO IUH League 2026 — `248006af-5af3-4ff5-8486-47b80fc269b9`.

Kiểm tra không ghi dữ liệu: đăng nhập lần lượt bằng Viewer/BTC, Captain và Player; mở **Lịch thi đấu**, **Bảng xếp hạng**, **Giải đấu của đội tôi**, **Lịch của đội tôi** hoặc **Giải đấu của tôi**. Chọn giải HCMC để thấy bảng A–D và standings 4×4 với số liệu ban đầu bằng 0; chọn giải IUH để xem thể thức vòng tròn; chọn Knockout để xem nhánh chưa xác định. Ở lịch riêng của captain, các trận phải có tên đội thật và chỉ thuộc đội đang quản lý. Ở mục Player, trạng thái cầu thủ phải khớp lời mời, đội hình trận và dữ liệu treo giò do API trả về.

## Kết quả và giới hạn

| Kiểm tra | Trạng thái | Ghi chú |
|---|---|---|
| Typecheck toàn workspace | PASS | `pnpm run typecheck`; typecheck Gateway và Web chạy lại sau chỉnh sửa cuối |
| Build frontend | PASS | Vite build; còn cảnh báo chunk JS > 500 kB, không phải build error |
| Build API Gateway | PASS | TypeScript và Docker image; GET lịch công khai đi qua optional session |
| Build Match Service | PASS | TypeScript build |
| Build Organization Service | PASS | TypeScript build |
| Match Service unit suite | PASS | 258 PASS, 0 FAIL, 34 SKIP; chạy không nối database nghiệp vụ |
| Tên đội, lịch và sân trên Viewer | PASS | Đối chiếu API và UI Docker; không còn nhãn UUID |
| Trạng thái và mã trận công khai | PASS | Trạng thái giải/trận và tiêu chí xếp hạng đã Việt hóa; sơ đồ không in UUID rút gọn |
| Danh mục giải công khai | PASS | Captain/Viewer thấy 5 giải công khai, không thấy hai giải DRAFT; API công khai không trả DRAFT |
| Lịch công khai ẩn danh | PASS | HCMC trả 31/31 PUBLISHED, có tên/vị trí sân, không có referee/account fields; giải không công khai trả 404 |
| Bảng HCMC/kết hợp trước trận | PASS | API và UI trả 4 bảng × 4 đội, 16 hàng với số liệu 0; nhánh knockout hiển thị suất/chờ xác định |
| Bảng giải vòng tròn | PASS | UI/API trả một bảng × 4 đội và số liệu 0 |
| Sơ đồ knockout công khai | PASS | Nhánh 16 đội, ba vòng trước chung kết, tên đội thật, chưa tự điền đội thắng |
| Danh sách giải/lịch của captain | PASS | Ba giải được duyệt, thành tích 0 đúng dữ liệu, lịch đội chỉ có trận liên quan và tên đội thật |
| Trang Player | PASS | Player có 3 lời mời ACCEPTED/registration APPROVED; thấy 10 trận đã xếp, đối thủ và trạng thái đội hình, không có nút sửa |
| Quyền tra cứu án treo giò | PASS | Player tự tra cứu trả 200/false; tra cứu player khác trả 403 `PLAYER_SUSPENSION_FORBIDDEN` |
| Không gian Referee cho tài khoản nhiều role | PASS | `dataset.captain02@football.local` có link riêng và mở `/referee`; Match Service trả một trận được phân công thật |
| Xem roster đăng ký | PASS | Modal đội trưởng hiển thị roster 20/20 đã xác nhận trên hồ sơ đã duyệt; không ghi sửa |
| Lưu/gửi đội hình trận | FAIL | Modal đọc roster 10 cầu thủ, nhưng chặn gửi vì regulation snapshot thiếu nguồn/bộ luật, số đá chính/tối thiểu, dự bị, thủ môn và quy định số áo. Không tự điền quy tắc thay BTC |
| Thẻ/treo giò hiệu lực | PASS | Player demo hiển thị “Không có án treo giò hiệu lực”; chưa có case bị treo giò thật trong dữ liệu hiện tại |
| Tỷ số trực tiếp và thống kê cá nhân có sự kiện thật | NOT TESTED | Các trận demo sắp tới chưa diễn ra; không chèn kết quả/sự kiện giả |
| Docker chính thức | PASS | Gateway, Match, Organization và Web dùng image mới; cổng `5173`; database không bị ghi, volume không bị đụng tới |

Không có migration hoặc ghi dữ liệu nghiệp vụ trong lượt rà soát này. Không reset database/volume, không sửa nội dung điều lệ, lịch hay kết quả.
