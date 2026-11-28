# Bước 4 – Sơ đồ thi đấu: bàn giao kiểm thử 24/11/2026

## Phạm vi và phiên bản

Dùng giao diện [DrawDemoFixtureWorkspace](../../apps/web-client/src/components/DrawDemoFixtureWorkspace.tsx) từ checkpoint `788015cae222c227cffb8e726679cb7e92268b84`. [FixtureDiagramPanel](../../apps/web-client/src/components/FixtureDiagramPanel.tsx) chỉ cung cấp dữ liệu và thao tác API chính thức; không dùng giao diện cũ để hiển thị bản nháp.

- Cổng Docker chính thức: [localhost:5173/btc](http://localhost:5173/btc).
- [Vòng tròn – DEMO IUH League](http://localhost:5173/btc?manageTournament=248006af-5af3-4ff5-8486-47b80fc269b9).
- [Knockout – DEMO Student Knockout Cup](http://localhost:5173/btc?manageTournament=d9fe5a04-5e71-41ec-b85c-f4567b294c68).
- BTC quản lý: `dataset.btc01@football.local`; dùng thông tin đăng nhập demo hiện có.
- Frontend đang phục vụ bundle `index-Dnw_U8Dw.js`; image `sha256:2b72132923031e9db530bb0bc4b2ebbfee4731dca4103a6426527f4cc5cfa894`.
- Match Service: image `sha256:a104c8541ebba26cf98faec9b620e3f924cd645dcdc4cc837d929723cd35d667`, healthcheck healthy.
- Cả hai container có build directory `T:\DO AN\BONG DA`, không bind mount source khác.

## Giữ nguyên và khác biệt với checkpoint

Giữ tổng quan, bảng đấu, các tab Đội bóng/Vòng đấu/BXH/Đi tiếp, sơ đồ ghép cặp/toàn bộ vòng đấu, cây knockout, bộ lọc, chuyển vòng/lượt, zoom, fullscreen và popup chi tiết. Đối chiếu source xác nhận đủ **221/221 khối CSS `.draw-viz*`** được giữ; component Modal chung giống bản checkpoint.

Các khác biệt phục vụ chuyển sang nghiệp vụ thật:

1. Bỏ nút reset test và nhãn snapshot test trong luồng BTC chính thức; dùng Sinh sơ đồ/Lưu bản nháp/Kiểm tra/Công bố qua API Match Service.
2. Trận hiển thị mã UUID chính thức, rút gọn tám ký tự trên thẻ; ID đầy đủ được giữ trong API, tooltip và popup.
3. Quan hệ cây đấu dùng ID trận/nhánh thật. BXH, tỷ số, đội đi tiếp và vô địch lấy từ kết quả được duyệt; không tự gán đội thắng.
4. Sửa hai lỗi tương thích CSS trên luồng chính thức: popup trận phải nằm trên popup bảng; thẻ trận trong chế độ tất cả vòng phải giữ cách dàn khối như bản khôi phục.
5. Nginx yêu cầu tải lại SPA shell sau triển khai để tránh hiện bundle cũ.

Không thay đổi giao diện/luồng Bước 3 đã xác nhận. Thay đổi duy nhất tại vỏ điều hướng là refresh tiến độ khi Bước 4 lưu/công bố. Chưa triển khai Bước 5.

## Lỗi đã sửa

- Chặn sinh sơ đồ ở trạng thái `ROSTER_LOCKED` dù Bước 3 đã công bố.
- Luồng bản nháp còn hiển thị workspace cũ; giao diện khôi phục chỉ xuất hiện sau công bố.
- Backend sắp hạt giống lại sau khi đã có vị trí knockout chính thức từ Bước 3.
- Nhánh rỗng/BYE ở số đội không phải lũy thừa hai có thể tạo dư trận, hoặc chưa cập nhật đúng đội vào trận đã cấp ID trước.
- Đường nối cây đấu chỉ hiểu mã trận test, không hiểu UUID chính thức.
- BXH placeholder được thay bằng bảng tính từ kết quả chính thức; sửa phép đối đầu không được cộng trận của các đội khác cho đội đang xét.
- Popup chi tiết trận bị popup bảng che; thẻ trận bị CSS nút chung dàn ngang.

## Kết quả đã chạy

| Hạng mục | Kết quả | Bằng chứng/giới hạn |
|---|---|---|
| Typecheck frontend và Match Service | PASS | `tsc --noEmit` |
| Production build frontend/backend; Docker build/run | PASS | Chỉ rebuild web-client và Match Service; không chạy migration |
| Thuật toán vòng tròn, knockout, BXH, phân hạng | PASS | 39/39 unit tests |
| PostgreSQL: sinh/công bố nguyên tử, giữ ID, đội đi tiếp, BYE | PASS | 20/20 integration tests trên database riêng `sfl_step4_verify_20261124_001` |
| Bước 3 → Bước 4 vòng tròn | PASS | Nhận bốn đội đúng vị trí; 12 trận hai lượt; sinh lại không đổi ID |
| Vòng tròn: chi tiết bảng, bốn tab, lọc lượt, chuyển vòng, xem tất cả, popup trận | PASS | Chrome thật 1440×1000; ảnh bên dưới |
| Vòng tròn: API công bố, reload, public read, mở khóa Bước 5 | PASS | 12 trận PUBLISHED; API gọi lại giữ timestamp/ID; chưa thao tác lập lịch |
| Bước 3 → Bước 4 knockout | PASS | 16 đội; 15 trận; vòng đầu đúng P1–P2, P3–P4…; 14 đường nối |
| Knockout: lọc vòng, zoom, fullscreen, popup, reload | PASS | Cây và mã trận đọc lại đúng sau reload |
| Knockout: đọc/công bố lặp qua API | PASS | Sơ đồ đã được công bố; gọi lại không đổi ID/trạng thái |
| Nút công bố trên bản nháp chưa công bố trong UI | NOT TESTED đầy đủ | Bản nháp đã xem được; tại lượt kiểm thử cuối cả hai sơ đồ đã công bố, không mở lại/rollback để tạo tình huống test |
| API không đăng nhập/đội trưởng | PASS | Không đăng nhập 401; đội trưởng manage/validate/publish đều 403 |
| BTC khác không sở hữu giải | NOT TESTED | Tài khoản BTC thứ hai trong danh mục không đăng nhập được (401); không đổi mật khẩu/quyền để ép test |
| Luồng chính thức không gọi test APIs | PASS | Theo dõi request trình duyệt, không gọi test-state/test-configuration/engine-test |
| API mất kết nối không fallback dữ liệu giả | PASS | Chặn request trong context Chrome kiểm thử riêng; hiển thị lỗi kết nối, không thay 15 trận đã tải bằng dữ liệu giả; không sửa API/server |
| Giải kết hợp trên Docker chính thức | NOT TESTED | Giải `9f765a91-b8ab-4716-a083-0cf8a113db1b` chưa có kết quả Bước 3 công bố. Không tự duyệt/chốt/bốc thăm thay BTC |
| Cập nhật BXH/đội đi tiếp với trận đã thi đấu qua toàn bộ UI điều hành | NOT TESTED | Demo chính thức chưa thi đấu; logic và lưu/khôi phục đội đi tiếp đã chạy trong database kiểm thử riêng |
| Đối chiếu source/CSS với checkpoint | PASS | Checkpoint worktree vẫn trỏ `788015c`; 221 khối CSS giữ nguyên |
| Đối chiếu trực quan Bước 4 tại cổng khôi phục | NOT TESTED | Truy vấn chỉ đọc: snapshot khôi phục có `step3:false`, `step4:false`, 0 fixtures. Bước 4 khóa; lần đăng nhập Chrome độc lập cuối trả 401. Không thay dữ liệu hoặc cấu hình môi trường khôi phục |

Không có lỗi FAIL chưa xử lý trong các bài kiểm tra đã chạy cuối cùng. Các mục NOT TESTED vẫn là giới hạn nghiệm thu; không kết luận toàn bộ ba thể thức đã E2E PASS.

Chi tiết request và kết quả trình duyệt: [final-browser-results.json](./final-browser-results.json). Các lần chạy sớm có lỗi popup đã sửa; dùng kết quả **final** làm bằng chứng hiện tại.

## Ảnh trình duyệt thực tế

[Mở thư viện ảnh](./gallery.html).

| Nội dung | Ảnh |
|---|---|
| Tổng quan vòng tròn | [01](./01-round-robin-overview.png) |
| Đội trong bảng | [02](./02-teams.png) |
| Sơ đồ ghép cặp | [03](./03-pairings.png) |
| BXH từ dữ liệu thật, chưa có trận thi đấu | [04](./04-standings.png) |
| Đi tiếp theo thể thức vòng tròn | [05](./05-qualifiers.png) |
| Toàn bộ vòng đấu | [06](./06-all-rounds.png) |
| Popup trận vòng tròn | [07](./07-match-detail.png) |
| Tổng quan knockout | [08](./08-knockout-overview.png) |
| Popup trận knockout | [09](./09-knockout-match.png) |
| Bộ lọc vòng knockout | [10](./10-knockout-round-filter.png) |
| Cây knockout khi fullscreen/thu nhỏ | [11](./11-knockout-fullscreen.png) |
| Sơ đồ knockout đã công bố | [13](./13-knockout-published.png) |
| Lỗi kết nối API hiển thị rõ | [15](./15-api-error-visible.png) |

## File và API thay đổi trong phần Bước 4

Frontend:

- [DrawDemoFixtureWorkspace.tsx](../../apps/web-client/src/components/DrawDemoFixtureWorkspace.tsx)
- [FixtureDiagramPanel.tsx](../../apps/web-client/src/components/FixtureDiagramPanel.tsx)
- [BtcTournamentWorkspace.tsx](../../apps/web-client/src/components/BtcTournamentWorkspace.tsx): callback refresh tiến độ Bước 4.
- [competition.ts](../../apps/web-client/src/api/competition.ts): đọc BXH bảng và kiểm tra cấu trúc.
- [nginx.conf](../../apps/web-client/nginx.conf): cache SPA shell.

Match Service:

- [matchController.ts](../../services/match-service/src/controllers/matchController.ts), [matchRoutes.ts](../../services/match-service/src/routes/matchRoutes.ts).
- [matchRepository.ts](../../services/match-service/src/repositories/matchRepository.ts).
- [fixtureGenerationService.ts](../../services/match-service/src/services/fixtureGenerationService.ts).
- [knockoutBracket.ts](../../services/match-service/src/services/knockoutBracket.ts), [hybridQualification.ts](../../services/match-service/src/services/hybridQualification.ts).
- [knockoutBracket.test.cjs](../../services/match-service/tests/knockoutBracket.test.cjs), [hybridQualification.test.cjs](../../services/match-service/tests/hybridQualification.test.cjs), [precreatedKnockoutFixtures.integration.test.cjs](../../services/match-service/tests/precreatedKnockoutFixtures.integration.test.cjs).

API bổ sung: `POST /api/tournaments/:id/fixtures/validate`, `GET /api/tournaments/:id/fixtures/group-standings`. Các API generate/manage/publish/public và xác định đội đi tiếp hiện có được tái sử dụng.

Không thêm migration hoặc bảng nghiệp vụ. Dùng các bảng Match hiện có: `matches`, `match_fixture_generations`, `match_bracket_slots`, nguồn/đội đi tiếp và biên bản phân hạng. Điều lệ và kết quả Bước 3 do Tournament Service cung cấp qua API; không đọc chéo database giữa các service.

## Bảo toàn và chạy lại

Đã sao lưu trước kiểm thử: [backup-before-step4-fixtures-20261124-001.sql](../../backup-before-step4-fixtures-20261124-001.sql), 5.282.688 byte. Không reset database, xóa volume/image hoặc thay checkpoint/môi trường khôi phục. Database kiểm thử chỉ chứa schema và dữ liệu do từng bài test tạo; không sao chép dữ liệu người dùng vào đó.

```powershell
corepack pnpm --filter @sfl/web-client --filter @sfl/match-service typecheck
docker compose --profile apps build match-service web-client
docker compose --profile apps up -d --no-deps match-service web-client
docker compose ps match-service web-client
```

Dừng tại Bước 4 để người dùng kiểm tra. Các mục NOT TESTED cần dữ liệu/phiên đối chiếu phù hợp; không tự thay đổi Bước 3, bước lập lịch hoặc môi trường khôi phục để hoàn tất chúng.
