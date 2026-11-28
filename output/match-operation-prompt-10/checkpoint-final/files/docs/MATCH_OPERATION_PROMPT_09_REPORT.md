# Prompt 9 — BXH, đội đi tiếp, thống kê và kỷ luật (F09, F12)

Ngày 28/11/2026, UTC+7. Phạm vi là các projection từ kết quả/sự kiện chính thức; không triển khai quyết định hành chính và kết thúc giải của Prompt 10. Giữ năm backend service, PostgreSQL riêng theo miền, SSE và Outbox hiện có.

## 1. Những phần đã sửa

### Một cách tính BXH

- [competitionProjectionRepository](../services/match-service/src/repositories/competitionProjectionRepository.ts) là đầu vào chung của `recalculateStandings`, `listStandings`, `getFixtureGroupStandings` và xác định đội đi tiếp. Dùng lại [rankHybridGroup](../services/match-service/src/services/hybridQualification.ts); không thay thuật toán bốc thăm, ghép cặp, sinh fixture hoặc lập lịch.
- Chỉ tính trận thuộc fixture đã công bố, kết quả `APPROVED`, trạng thái `VERIFIED/LOCKED`. Không tính tỷ số live, `PENDING` hoặc `REJECTED`. Đọc điểm thắng/hòa/thua và thứ tự tiêu chí từ phiên bản điều lệ gắn với draw; không quay về 3/1/0 hoặc điều lệ đang sửa.
- Đối đầu cần khai báo chính xác metric. `HEAD_TO_HEAD` không tự có nghĩa là cả điểm, hiệu số và bàn thắng đối đầu. Khi chưa đủ các lượt đối đầu chính thức, nhóm hòa còn chưa xác định; không lấy tiêu chí phía sau để vượt qua phần thiếu này.
- Fair-play chỉ sử dụng trọng số đã khai báo có cấu trúc. Thiếu policy không được biến thành các số 0. Bổ sung các trường cần thiết vào form bổ sung điều lệ có phiên bản hiện có, không thêm trang điều lệ hay sửa các bản đã công bố.
- Biên bản bốc thăm phân hạng dùng audit/người chứng kiến hiện có, gắn fingerprint kết quả và thẻ. Reload/retry không bốc lại; kết quả thay đổi khiến biên bản cũ hết hiệu lực áp dụng, nhưng lịch sử vẫn được giữ.
- Đọc bảng và thống kê bằng snapshot transaction nhất quán trong Match DB. Các giao diện công khai/BTC bỏ việc tự sort lại theo thứ tự cứng. Nhóm chưa phân hạng hiển thị chưa xác định, không tự gán thứ hạng bằng chỉ số dòng.

### Đội đi tiếp và sửa kết quả

- Vòng tròn giữ một bảng, một/hai lượt; trả đội đứng đầu khi đủ kết quả và đã giải quyết thứ hạng.
- Kết hợp giữ nguồn group/rank và fixture hiện có. Khi đủ kết quả chính thức, điền đúng nguồn A1/B2 tương ứng, không sinh lại trận. Không điền từ kết quả nháp hoặc tự bốc thăm lại khi quy tắc yêu cầu `REDRAW`.
- Knockout tiếp tục dùng cơ chế truyền winner/loser hiện có, gồm tranh hạng ba. BYE không được tạo tỷ số, bàn thắng hoặc trận đã đấu.
- Đính chính tính lại thành tích từ nguồn; không cộng/trừ delta nhiều lần. Nếu ảnh hưởng đội đi tiếp đã xác lập hoặc trận phụ thuộc đã công bố/có hoạt động, từ chối áp dụng tự động, giữ hồ sơ yêu cầu chờ xử lý và giữ nguyên kết quả/đội/lịch/phân công.
- Sửa route Gateway bị thiếu cho danh sách và thao tác xét đính chính. Người được phân công `FINALIZE` gửi yêu cầu chuyên môn; BTC có thẩm quyền xử lý yêu cầu. Không cho quyền quản lý giải tự thay thế phân công trọng tài.

### Thống kê và kỷ luật

- [officialStatisticsService](../services/match-service/src/services/officialStatisticsService.ts) lấy kết quả chính thức/sự kiện có hiệu lực. Cộng hiệp phụ một lần; không cộng luân lưu, không tính phản lưới vào thành tích ghi bàn người phản lưới, không gán bàn xử thua cho cầu thủ. Kết quả hành chính được nhận diện từ quyết định xử thua đã lưu.
- Nếu kết quả đã đính chính không khớp nguồn bàn thắng, trả danh sách cần đối chiếu và không gán bừa cầu thủ ghi bàn. Kiến tạo chưa được thu thập trả `null`; số trận cầu thủ chỉ dùng đội hình xác nhận và lần vào sân có dữ liệu. Thẻ có hiệu lực được giữ trong thống kê kể cả kết quả hành chính.
- [disciplineProjection](../services/match-service/src/discipline/services/disciplineProjection.ts) tái dựng án từ nguồn thẻ theo thứ tự trận/sự kiện và phiên bản quy tắc. Vàng tích lũy, vàng thứ hai và đỏ trực tiếp có policy riêng; không dùng thời điểm worker chạy để đếm tích lũy.
- Án theo số trận không dùng hạn kỹ thuật 365 ngày. Lưu trận đã chấp hành, phạm vi giai đoạn, trạng thái và lịch sử projection. Chỉ tính trận đã thực sự thi đấu, kết quả chính thức, thuộc phạm vi và cầu thủ không có tên trái án. Không tự tính BYE/hoãn/hủy/xử thua là đã chấp hành.
- Dùng lại `ISSUE_CARD/VOID_CARD`, thêm tác vụ `RECONCILE_RESULT` vào cùng Outbox. Mỗi phiên bản kết quả có khóa chống lặp; định danh tác vụ tách khỏi ID trận để không va unique constraint cũ. Worker ghi Discipline transaction rồi mới ack, có retry và audit, không giả transaction chung hai database.
- Chưa đồng bộ hoặc thiếu policy: eligibility trả chưa xác định/lý do và chặn đăng ký cầu thủ phụ thuộc, không trả chắc chắn đủ điều kiện. Đội trưởng, trọng tài và cầu thủ đọc cùng trạng thái. Không chỉnh roster giải hoặc nghiệp vụ duyệt đội.

## 2. API

| API dưới `/api` | Thay đổi |
|---|---|
| `GET /tournaments/:id/standings` và `/:teamId` | Giữ path; trả cùng phép tính, group/rank, tên/logo thực và cảnh báo thiếu căn cứ. Giữ ID của dòng standings đã lưu. |
| `GET /tournaments/:id/fixtures/group-standings[/public]` | Giữ path; cùng số liệu, thêm hoàn tất bảng, fingerprint, vấn đề xếp hạng và đội đứng đầu vòng tròn nếu xác định được. |
| `POST /tournaments/:id/fixtures/ranking-lots` | Ghi audit bốc thăm phân hạng theo đúng nhóm hòa, thứ tự, người chứng kiến, lý do và fingerprint; quản lý đúng giải. Dùng lại modal hiện có. |
| `GET /tournaments/:id/statistics` | Thống kê từ kết quả chính thức; không lộ giải nháp hoặc dữ liệu CREW. |
| `POST /matches/:id/result-correction-requests`, `PUT /result-correction-requests/:id/review` | Giữ API, bổ sung routing Gateway bị thiếu và kiểm tra tác động. Retry xét hồ sơ đã quyết định trả trạng thái lỗi đã xử lý, không tính lại điểm thêm. |
| API squads/suspension hiện có | Chặn khi đang treo giò hoặc chưa xác minh được đồng bộ, giữ quyền tự xem/captain/referee/BTC. Án theo số trận có thể không có endDate. |

Nguồn quy tắc là snapshot điều lệ gắn với fixture và binding bổ sung đã công bố. Trường hợp legacy thiếu phiên bản không được tự lấy điều lệ mới nhất hoặc tự ghim từ một trận sang toàn bộ giải. Cần xác lập đúng phiên bản theo cơ chế bổ sung hiện có.

## 3. Migration và bảo toàn

- [competitionProjectionMigration.ts](../services/match-service/src/db/competitionProjectionMigration.ts): Match **29**, Discipline **1004**, versioned/transactional. Không sửa migration cũ; đã thử chạy hai lần trên database QA.
- Thêm metadata standings, fingerprint audit, nguồn kết quả, conflict projection và metadata Outbox; thêm metadata thẻ/án, lịch sử projection append-only, endDate nullable cho án theo số trận. Không backfill án cũ bằng giả định; án tự động cũ chưa rõ căn cứ cần đối chiếu có thẩm quyền.
- [Backup trước thay đổi](../backups/match-operation-prompt-09-20261128-001/manifest.json): Match, Scheduling, Discipline, Tournament, Team; archive custom có SHA-256 và kiểm tra danh mục restore. Không ghi đè bản backup/checkpoint trước.
- [Fingerprint trước](../output/match-operation-prompt-09/official-before.json), [sau](../output/match-operation-prompt-09/official-after.json) và [runtime](../output/match-operation-prompt-09/runtime-verification-final.json) ghi nhận kết quả triển khai. Chỉ kết luận bảo toàn theo các cột cũ đã so sánh, không tuyên bố schema bất biến.
- Khôi phục khi cần: phục hồi archive vào database **mới** để kiểm tra trước; không restore đè hoặc chạy down phá dữ liệu. Giữ image trước đó, không xóa volumes hay reset database.

## 4. Kiểm thử thực tế

[QA API/PostgreSQL lượt 015](../output/match-operation-prompt-09/qa-api-015.json): **17 nhóm PASS**. Dùng database phục hồi riêng có prefix `sfl_prompt09_qa_`, các router/service chính thức và session Auth hợp lệ. Năm database nghiệp vụ chính thức giữ nguyên fingerprint sau toàn bộ QA. Không gửi SMTP trong QA.

| Phần | Kết quả và phạm vi thực sự kiểm chứng |
|---|---|
| Migration chạy lặp | PASS, giữ dữ liệu clock cũ; cả Match/Scheduling/Discipline chạy migration thực. |
| FINISHED chưa công nhận | PASS API: không vào cả hai API BXH. |
| Công nhận và retry | PASS API thực từ đội hình → thi đấu → biên bản; hai đường BXH trùng thành tích, không cộng điểm lặp. |
| Phân quyền đính chính | PASS API: trọng tài được giao gửi, BTC đúng giải xét; BTC không được giao/ngoài giải không vượt quyền. |
| Điểm 5/2/1, vòng tròn một/hai lượt | PASS API/repository PostgreSQL: bảng 0 trước kết quả, thành tích/đội đứng đầu đúng, ID fixture không đổi khi sinh lại. |
| Bốc thăm phân hạng | PASS API: audit giữ qua đọc lại/retry, fingerprint cũ bị từ chối khi kết quả thay đổi. |
| Kết hợp | PASS: kết quả PENDING cuối bảng không xác định đội đi tiếp; đủ APPROVED điền 8 nguồn A1/B2 đúng, không tạo fixture trùng. |
| Đính chính | PASS: tính lại điểm vòng tròn, retry không tăng điểm; thay qualifier/chung kết/tranh hạng ba đã công bố bị chặn, dữ liệu chính thức không đổi. |
| Knockout có BYE | PASS với 7 đội: không có kết quả giả cho BYE, winner/loser vào đúng chung kết/tranh hạng ba. Giới hạn 5 đội nêu bên dưới. |
| Outbox/treo giò | PASS PostgreSQL: pending không báo đủ điều kiện, vàng tích lũy, đỏ trực tiếp, vàng thứ hai, retry không trùng card/án, chấp hành theo trận và VOID tính lại. |
| Đội hình ngược | PASS API: án theo số trận không có endDate giả; roster thật của captain hiện không đủ điều kiện và lưu bị chặn, gỡ án khôi phục eligibility. |
| Thống kê | PASS API với một bàn ghi và kết quả công nhận thực; PASS unit cho hiệp phụ, luân lưu, phản lưới, tỷ số xử thua và assists chưa có dữ liệu. Không coi đây là E2E toàn bộ các loại bàn. |
| Build/test | Typecheck và production build toàn workspace PASS. Match **272 PASS / 34 SKIP / 0 FAIL** khi khai báo URL dummy cho unit không kết nối DB; frontend **39 PASS**. |

Các bảng phụ để phủ nhiều thể thức sử dụng fixture factory **chỉ trong QA** sau bước tạo điều lệ qua API. Những kết quả được chuẩn bị bằng factory không phải bằng chứng đã thao tác toàn bộ quy trình đăng ký/duyệt/bốc thăm/thi đấu qua trình duyệt. Riêng trận gốc kiểm tra approval sử dụng API thật gửi đội hình, clock, goal và biên bản. Điều khiển thời gian qua host QA, không sửa lịch hay bỏ gate chính thức.

### Docker và kiểm tra trình duyệt

- Đã áp dụng migration Match 29 / Discipline 1004 trên hệ thống chính thức. **9 container running, 8 healthcheck healthy**; web-client không khai báo healthcheck riêng. [Runtime cuối](../output/match-operation-prompt-09/runtime-verification-final.json) xác nhận 10 compiled backend hashes, 2 asset HTTP và ID image đang chạy khớp bản vừa build; build context đúng workspace hiện tại.
- Đối chiếu **106 bảng** theo cột cũ: chỉ ledger migration Match và Discipline thay đổi. Không có projection conflict, discipline job pending hoặc projection history mới trong database chính thức; dữ liệu QA ở database riêng.
- Đã reload trang biên bản trọng tài thật ở cổng 5173. Phát hiện và sửa thêm lỗi toast BXH khi giải chưa bốc thăm: API đọc standings trả danh sách rỗng trước khi có published draw, còn phép tính cho luồng ghi vẫn chặn thiếu nguồn. Test hồi quy bổ sung và [GET thực trên cả ba giải](../output/match-operation-prompt-09/official-read-api.json) PASS; sau reload không còn toast 409 này.
- Trang biên bản hiện rỗng đúng với dữ liệu chính thức sau reset. Không tạo trận, sự kiện, biên bản hoặc thay đổi tiến trình giải để làm giao diện có dữ liệu. Không coi việc mở trang rỗng này là E2E thao tác đầy đủ qua browser.

Lượt test đầu thiếu `SCHEDULING_DATABASE_URL`/`DISCIPLINE_DATABASE_URL` nên 5 file unit không khởi tạo được; đã chạy lại đủ 306 bài với URL dummy không thể kết nối, giữ 34 bài opt-in ở trạng thái SKIP. Các log QA trước lượt 015 được giữ nguyên, gồm lỗi fixture factory/validation và các lỗi thật đã sửa: unique tác vụ kết quả, routing đính chính và phép so sánh UUID/text ở gate đồng bộ. Không đổi validation nghiệp vụ để làm các fixture QA hợp lệ.

## 5. Giới hạn còn lại

- **FAIL/ngoại lệ đã phát hiện:** với 5 đội theo cách phân bổ BYE hiện có, một bán kết tự qua nhánh nên không có đội thua để điền một phía tranh hạng ba. Skeleton trận hạng ba còn chờ. Không tự tạo đối thủ, tỷ số hoặc quyết định huy chương. Chưa sửa thuật toán phân bổ BYE theo giới hạn Prompt 9; cần xác lập cách xử lý trường hợp này bằng quy định/ngoại lệ có thẩm quyền.
- **CHƯA HỖ TRỢ tự động:** điều lệ yêu cầu `REDRAW` sau vòng bảng; hệ thống chặn/ghi vấn đề, không tự áp nhánh cố định. Không triển khai một quy trình bốc thăm lại mới trong Prompt 9.
- **NOT TESTED E2E:** UI nhập và xử lý bốc thăm phân hạng trên nhiều browser/mobile; fair-play và từng metric đối đầu trên nhiều trận nhập tay; bốc thăm lại, so sánh đội giữa bảng theo chính sách riêng chưa có trong mô hình hiện tại; toàn bộ vòng đời hành chính void kết quả/đổi qualifier đã công bố; kết thúc giải.
- **NOT TESTED fault/race đầy đủ:** restart đúng khoảng Discipline commit–Outbox ack, lỗi mạng qua nhiều service khi đổi roster/án/phân công đồng thời. Retry có kiểm thử lặp tác vụ, không đồng nghĩa mọi lỗi phân tán đã nghiệm thu.
- Quy tắc án, reset/chuyển thẻ, thẻ luân lưu hoặc nhiều án đồng thời còn thiếu/chưa có cấu trúc phải được bổ sung có phiên bản, không suy ra mức án từ bộ luật hoặc thời hạn kỹ thuật. Không sửa điều lệ công bố của ba giải demo để làm kiểm thử PASS.
- Kết quả bị đính chính lệch nguồn bàn thắng được đánh dấu cần đối chiếu, không tự chia lại thành tích cầu thủ. Các quyết định xử lý ảnh hưởng đã công bố thuộc workflow BTC, tiếp tục ở Prompt 10.

Không tuyên bố toàn bộ giải đấu hoặc F09/F12 đã nghiệm thu mọi ngoại lệ chỉ dựa trên build/healthcheck. Dừng trong phạm vi Prompt 9.

## 6. Chạy lại và checkpoint

Hệ thống chính thức vẫn tại [http://localhost:5173](http://localhost:5173). Dùng cùng overlay Demo Mode đã có; không dùng cổng khôi phục 15173.

```powershell
corepack pnpm run typecheck
corepack pnpm run build
docker compose -f docker-compose.yml -f output/demo-match-testing/compose.demo.yml --profile apps config --quiet
docker compose -f docker-compose.yml -f output/demo-match-testing/compose.demo.yml --profile apps build match-service match-migrate tournament-service api-gateway web-client
docker compose -f docker-compose.yml -f output/demo-match-testing/compose.demo.yml --profile apps run --rm --no-deps match-migrate
docker compose -f docker-compose.yml -f output/demo-match-testing/compose.demo.yml --profile apps up -d --no-deps match-service tournament-service api-gateway web-client
```

[Checkpoint trước](../output/match-operation-prompt-09/checkpoint-before/manifest.json), [checkpoint sau](../output/match-operation-prompt-09/checkpoint-after/manifest.json), [đối chiếu source](../output/match-operation-prompt-09/source-preservation-final.json). Checkpoint là bản bảo toàn source đang làm việc và patch, **không phải Git commit**; giữ HEAD và các thay đổi có trước của Prompt 8, không commit gộp/reset/stash.

## 7. Tệp thay đổi trong Prompt 9

So với checkpoint đầu Prompt 9: **29 tệp có trước được sửa, 14 tệp mới**, không xóa tệp. Có **1.148 tệp có trước giữ nguyên hash**, gồm các component Sau trận/biên bản và repository xác nhận của Prompt 8. Danh sách đầy đủ cùng hash nằm trong đối chiếu source phía trên; danh sách này tách thay đổi Prompt 9 khỏi working tree chưa commit của Prompt 8.

| Nhóm | Tệp chính |
|---|---|
| Canonical BXH/qualifier | [competitionProjectionRepository](../services/match-service/src/repositories/competitionProjectionRepository.ts), [hybridQualification](../services/match-service/src/services/hybridQualification.ts), [matchRepository](../services/match-service/src/repositories/matchRepository.ts), [fixtureGenerationService](../services/match-service/src/services/fixtureGenerationService.ts) |
| Thống kê/policy | [officialStatisticsService](../services/match-service/src/services/officialStatisticsService.ts), [competitionPolicies](../services/match-service/src/services/competitionPolicies.ts), [matchOperationRules](../packages/shared/src/matchOperationRules.ts), [tournamentRepository](../services/tournament-service/src/repositories/tournamentRepository.ts) |
| Kỷ luật/eligibility | [disciplineProjection](../services/match-service/src/discipline/services/disciplineProjection.ts), [disciplineService](../services/match-service/src/discipline/services/disciplineService.ts), [Outbox worker](../services/match-service/src/discipline/services/matchEventDisciplineOutbox.ts), [disciplineRepository](../services/match-service/src/discipline/repositories/disciplineRepository.ts), [matchSquadService](../services/match-service/src/services/matchSquadService.ts), [readiness](../services/match-service/src/services/matchOperationReadinessService.ts) |
| API/migration | [Gateway](../apps/api-gateway/src/index.ts), [Match controller](../services/match-service/src/controllers/matchController.ts), [Match routes](../services/match-service/src/routes/matchRoutes.ts), [migration 29/1004](../services/match-service/src/db/competitionProjectionMigration.ts), [migration runner](../services/match-service/src/db/migrate.ts), model/controller Discipline và model Match |
| Frontend giữ layout | [FixtureDiagramPanel](../apps/web-client/src/components/FixtureDiagramPanel.tsx), [PublicTournamentCompetitionPanel](../apps/web-client/src/components/PublicTournamentCompetitionPanel.tsx), [TournamentDetailPanel](../apps/web-client/src/components/TournamentDetailPanel.tsx), [TournamentProgressSteps](../apps/web-client/src/components/TournamentProgressSteps.tsx), [PlayerParticipationWorkspace](../apps/web-client/src/components/PlayerParticipationWorkspace.tsx), [API client](../apps/web-client/src/api/client.ts), [competition API](../apps/web-client/src/api/competition.ts) |
| Test/tài liệu | [projection unit tests](../services/match-service/tests/competitionProjection.test.cjs), [hybrid tests](../services/match-service/tests/hybridQualification.test.cjs), [QA API cases](../scripts/qa-match-projections-cases.cjs), [baseline](./MATCH_OPERATION_BASELINE.md), [rules matrix](./MATCH_RULES_MATRIX.md), [API routing](./API_ROUTING.md); các script backup/restore/check/runtime đều giới hạn phạm vi và giữ bằng chứng cũ |
