# Prompt 11 — Theo dõi trực tiếp và đồng bộ SSE (F15)

Ngày thực hiện: 28/11/2026. Phạm vi: dữ liệu công khai của trận đấu, luồng SSE hiện có và trình bày chi tiết trận dùng chung. Không tạo website/route live riêng, WebSocket, RabbitMQ hoặc runtime service mới.

## Kết quả

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Một trang chi tiết trận cho Viewer, BTC, đội trưởng và cầu thủ | PASS | Route `/matches/:matchId`, mở từ lịch chung, chi tiết giải và lịch cầu thủ. |
| Scoreboard, trạng thái, hiệp/clock, tabs, diễn biến và thống kê | PASS | Một component đọc API Match; không hardcode dữ liệu hoặc suy diễn thống kê chưa thu thập. |
| Vòng bảng và knockout/kết hợp | PASS | Dùng BXH fixture chính thức và bracket đã công bố; hybrid hiển thị cả hai. |
| Tên/logo đội | PASS | Lấy từ roster/team projection công khai; fallback chỉ là nhãn chờ xác định. |
| Trận FINISHED chưa công nhận | PASS | Public API chỉ trả tỷ số trên sân tổng hợp từ public events; không lộ result draft. Trạng thái REJECTED không hiển thị như pending. |
| Đội hình công khai | PASS | Chỉ sau khi trận bắt đầu và hai roster trận được xem xét/xác nhận; response allowlist loại actor metadata. |
| SSE snapshot, cursor và replay theo ID | PASS | Snapshot trả cursor; reconnect dùng Last-Event-ID/`after`; delivery giữ thứ tự, lọc trùng. |
| Backlog/retention gap | PASS | Trên 200 event, retention gap, cursor-ahead hoặc replay lỗi đều yêu cầu snapshot mới; kiểm thử 201 event trên QA. |
| Thu hồi quyền stream đang mở | PASS | Tournament/fixture được xác minh lại từng event và heartbeat; QA xác nhận stream kết thúc sau thu hồi. |
| Scheduling → Match realtime | PASS | Transactional outbox ở DB Scheduling, projection idempotent ở DB Match; QA xác nhận rollback, commit và retry. |
| Feed chung không lộ match ID | PASS | Feed wildcard chỉ gửi `live-feed.changed`; QA xác nhận không có ID trận trong payload. |
| Typecheck, build và Docker chính thức | PASS | Workspace typecheck PASS; Match Service test 279 PASS, 0 FAIL, 34 integration case SKIP; frontend/Match builds PASS; Docker proof PASS. |
| Sáu vai trò cùng xem một trận đang LIVE thật | NOT TESTED | Không tự bắt đầu hoặc thay đổi trận chính thức; hiện không có fixture công khai hoặc trận LIVE trên hệ thống. |

## Giao diện và API

- Lịch chung, lịch của đội trưởng, trang chi tiết giải và lịch cá nhân cầu thủ mở chung route `/matches/:matchId`; không dựng bản sao live theo vai trò. Trước khi có trận/event, scoreboard hiển thị VS/chưa có tỷ số và thống kê sự kiện ở trạng thái chưa thu thập, không giả lập 0–0.
- `GET /api/matches/live` chỉ trả trận thuộc giải và fixture đã công khai.
- `GET /api/matches/:matchId/live-state` trả public snapshot đã lọc, gồm `realtimeCursor`.
- `GET /api/matches/:matchId/stream` revalidate quyền công khai trong suốt kết nối; `/api/matches/live/stream` phát tín hiệu vô danh để client tải lại danh sách.
- `GET /api/matches/:matchId/result` chỉ trả kết quả APPROVED; khi trận FINISHED chưa được công nhận, thêm `pitchScore` tổng hợp từ sự kiện công khai và không trả dữ liệu biên bản/result draft.
- `GET /api/matches/:matchId/events` và `/lineups` giữ allowlist projection; đội hình chỉ công khai sau khi cả hai đội đủ điều kiện hiển thị.

## Thay đổi source

- `services/match-service/src/realtime/matchRealtime.ts`: cursor/replay có phát hiện gap, giao event tuần tự có revalidation, wildcard redaction, outbox dispatcher và retention.
- `services/match-service/src/db/matchRealtimeOutboxMigration.ts`: migrations Match 31 và Scheduling 1015.
- `services/match-service/src/controllers/matchController.ts`, `services/match-service/src/services/lineupService.ts`, `services/match-service/src/repositories/lineupRepository.ts`, `services/match-service/src/repositories/matchRepository.ts`: public live/result/event/lineup projections và fixture visibility.
- `apps/web-client/src/components/LiveMatchCenterPanel.tsx`, `apps/web-client/src/components/PublicMatchDetailView.tsx`, `apps/web-client/src/components/PlayerParticipationWorkspace.tsx`, `apps/web-client/src/components/PublicTournamentCompetitionPanel.tsx`, `apps/web-client/src/components/TournamentDetailPanel.tsx`, `apps/web-client/src/App.tsx`, `apps/web-client/src/api/competition.ts`, `apps/web-client/src/App.css`: cùng route chi tiết, tabs/responsive, kết nối/reconnect, tên/logo, lọc và fallback đối soát.
- `docs/API_ROUTING.md`, `docs/MATCH_OPERATION_BASELINE.md`: API và baseline Prompt 11.

## Kiểm thử

- `corepack pnpm run typecheck`: PASS.
- `corepack pnpm --filter @sfl/match-service test`: **279 PASS, 0 FAIL, 34 SKIP**; các integration cases vốn yêu cầu test database được bỏ qua trong suite mặc định.
- `corepack pnpm --filter @sfl/match-service build`: PASS.
- `corepack pnpm --filter @sfl/web-client build`: PASS; Vite có cảnh báo bundle JavaScript trên 500 kB (1.45 MB minified), không chặn build.
- QA DB riêng: `sfl_prompt11_qa_match_20261128_001` và `sfl_prompt11_qa_scheduling_20261128_001`, khôi phục từ snapshot đã giữ lại trước Prompt 8. **PASS**: rollback không tạo outbox, commit tạo một event, retry idempotent, SSE delivery, replay theo thứ tự, access revoke, wildcard redaction và sync-required ở 201 event.
- Trình duyệt `http://localhost:5173/team` → **Lịch thi đấu**: PASS cho các tab lọc, bộ lọc và empty state. Không có fixture được công khai; API trả bundle rỗng cho các giải dev đang mở đăng ký.
- Dữ liệu chính thức được sao lưu trước migration tại `backups/match-operation-prompt-11-20261128-002/`; `output/match-operation-prompt-11/database-before-migration.json` chứa fingerprint chỉ đọc để so sánh sau triển khai.

## Docker và checkpoint

Official Compose build/deploy: **PASS** trên cổng `5173`, Match API `3005`. 9 containers running, 8 healthchecks healthy. Match Service, API Gateway và Web Client đang chạy đúng image build; 6 compiled artifact hashes và 2 frontend assets khớp source. Health endpoints và public live-list API thành công; hiện có 0 trận LIVE. Match migration **31**, Scheduling **1015** đã áp dụng.

Fingerprint sau rollout chỉ khác hai hàng migration ledger (Match/Scheduling tăng đúng một phiên bản). Không có thay đổi ngoài dự kiến trong bảng nghiệp vụ của các database Match/Scheduling/Auth/User/Team/Tournament/Discipline.

Bằng chứng cuối tại `output/match-operation-prompt-11/runtime-verification-final-ui.json`; snapshot trước migration tại `output/match-operation-prompt-11/database-before-migration.json`; backup đủ 7 database tại `backups/match-operation-prompt-11-20261128-002/`. Checkpoint source đầy đủ, không phải Git commit, lưu tại `output/match-operation-prompt-11/checkpoint-final-release/`.

## Giới hạn

- Không bắt đầu trận hoặc ghi bàn, thẻ, thay người lên các giải đang chạy để chứng minh UI live.
- Kiểm tra trực tiếp tab chi tiết trận trên fixture công khai và kiểm tra đồng thời mọi vai trò trên trận LIVE thật còn NOT TESTED vì hiện không có fixture công khai/LIVE; SSE/replay/thu hồi quyền/backlog đã kiểm thử trên clone QA.
- Tên/logo/timeline/clock dùng dữ liệu thực; vị trí chiến thuật không được tự suy ra nếu roster không có dữ liệu vị trí.
- Build/healthcheck không thay thế việc BTC, trọng tài, đội trưởng, cầu thủ và Viewer cùng nghiệm thu một trận live.
