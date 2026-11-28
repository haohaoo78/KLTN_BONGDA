# 02 – API, schema và luồng dữ liệu

## API test và bảo vệ quyền

| Service | Method/path (Gateway) | Quyền và xử lý |
|---|---|---|
| Tournament | `GET /api/tournaments/:id/draw-management/test-state` | BTC manager; trả snapshot riêng và revision |
| Tournament | `PUT /api/tournaments/:id/draw-management/test-state` | BTC manager; xác thực scope, payload/version, đội phải là đội đủ điều kiện; yêu cầu `expectedRevision` |
| Tournament | `DELETE /api/tournaments/:id/draw-management/test-state` | BTC manager; xóa snapshot test của đúng tournament |
| Tournament | `GET /api/tournaments/:id/draw-management/test-state/public` | Có/không session; yêu cầu quyền xem tournament; chỉ trả publication, fixture đã công bố và một projection giới hạn của live session |
| Tournament internal | `GET /internal/tournaments/:id/test-published-draw` | Chỉ trusted Gateway/service key; đòi Step 3 + Step 4 publication và trả diagram version/fixtures |
| Match | `GET /api/schedules/test-workflow/:id` | BTC role + xác minh manager access; trả snapshot nếu diagram version còn khớp |
| Match | `PUT /api/schedules/test-workflow/:id` | BTC manager; giới hạn payload, kiểm tra diagram version và canonical fixtures; revision CAS |
| Match | `DELETE /api/schedules/test-workflow/:id` | BTC manager; xóa snapshot lịch test của đúng tournament |
| Match | `GET /api/schedules/test-workflow/:id/public` | Trả lịch đã publish nếu snapshot gắn đúng diagram version; bỏ draft |
| Match | `POST /api/schedules/engine/test/validate` | BTC manager; gọi shared validator; trả lỗi bắt buộc và cảnh báo |
| Match | `POST /api/schedules/engine/test/manual-candidates` | BTC manager; chỉ trả lựa chọn ngày/sân/giờ hợp lệ theo engine |
| Match | `POST /api/schedules/engine/test/automatic-preview` | BTC manager; chạy shared planner; giới hạn `maxRuntimeMs` 100–30.000 ms |
| Match | `POST /api/schedules/engine/test/referee-preview` | BTC manager; shared referee planner |

`SCHEDULING_TEST_API_ENABLED` chỉ bật trong môi trường development/test; production bị chặn độc lập bởi `NODE_ENV`. Tournament test-state kiểm tra môi trường dev/test trong service. Các route mutation được bảo vệ tại service, không dựa nút frontend.

## Version consistency Bước 3 → 4 → 5

1. Tournament lưu draw publication và fixture diagram snapshot test.
2. Internal endpoint tạo `diagramVersion` từ publication timestamp, allocation và các trường fixture canonical.
3. Frontend đưa `tournamentId`, `diagramVersion`, fixtures và snapshot schedule vào Match API.
4. Match gọi internal Tournament endpoint bằng key dịch vụ.
5. Match từ chối nếu version khác hoặc danh sách fixture khác về ID, stage, bảng, vòng/lượt, đội/source hoặc BYE.
6. Bản lưu scheduling ghi `diagram_version`; khi GET phát hiện version cũ, trả `stale: true` và không dùng nó như lịch hiện hành.
7. Snapshot public chỉ trả schedule sau khi publication key trùng version được xác minh.

## Revision và đồng thời

Repository lấy transaction lock theo tournament ID (`pg_advisory_xact_lock`), đọc revision và so sánh với `expectedRevision`. Chỉ một cập nhật có cùng base revision thắng; request còn lại nhận 409 `TEST_WORKFLOW_REVISION_CONFLICT`. Reset xóa đúng hàng theo tournament. Cơ chế CAS đã được kiểm thử trực tiếp bằng hai ghi cạnh tranh trên PostgreSQL.

## Migration

- Tournament migration 24: thêm `tournament_draw_test_snapshots`, FK cascade tới tournament, JSONB state, revision > 0, actor và timestamps.
- Match migration 1005: thêm `match_schedule_test_snapshots` trong scheduling DB, diagram version, JSONB state, revision, actor và timestamps.
- Migration chạy theo version và transaction; không sửa migration đã áp dụng.
- Đã chạy migration command khi PostgreSQL localhost khả dụng. Kết quả hai service báo schema hiện hành. Không reset/truncate hoặc xóa volume.

## Gateway và frontend

Gateway định tuyến `/tournaments/.../draw-management` về Tournament Service; `/schedules/...` về Match Service. Public GET test snapshot được cho phép optional session trong Gateway. Frontend gọi qua `apps/web-client/src/api/testWorkflow.ts`; `drawTestStorage.ts` quản lý hydration, optimistic cache, queue theo service và revision.

Public component không sử dụng cache manager để render trong lúc load. Storage event/BroadcastChannel chỉ thông báo refresh; API public là dữ liệu hiển thị có thẩm quyền.

## Realtime lịch official

Scheduling DB và Match DB là hai pool. `schedulingRepository` commit schedule trước, sau đó `publishCommittedMatchUpdate` ghi event vào Match database và phát `pg_notify`. Như vậy event không làm hỏng transaction scheduling vì gửi nhầm pool. Phần event này là thông báo sau commit, không phải transaction phân tán; nếu event ghi thất bại, lịch vẫn commit và lỗi được log. E2E realtime trên các container chạy chưa được xác minh.
