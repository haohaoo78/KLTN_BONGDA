# 03 – Kết quả build và kiểm thử

Ngày kiểm tra: 2026-11-22. Các test database dùng UUID fixture tạm trong các database dev hiện có; từng test có cleanup riêng. Không reset DB, volume hoặc SMTP.

## Bảng kết quả

| Hạng mục | Kết quả | Bằng chứng/giới hạn |
|---|---|---|
| Shared TypeScript build | **PASS** | `pnpm --filter @sfl/shared build` |
| Tournament Service build | **PASS** | `pnpm --filter @sfl/tournament-service build` |
| Match Service build | **PASS** | `pnpm --filter @sfl/match-service build` |
| API Gateway typecheck + build | **PASS** | Hai lệnh package đều hoàn tất |
| Web Client typecheck + build | **PASS** | Vite build thành công; cảnh báo bundle JavaScript ~1.08 MB, không phải build failure |
| Tournament DB suite | **PASS – 48/48** | `RUN_TOURNAMENT_DB_INTEGRATION=1`; gồm concurrency/cleanup cho snapshot test mới |
| Match DB suite đã chọn | **PASS – 87, FAIL 0, SKIP 3** | Chạy scheduling, fixture structure, hybrid playoff và precreated bracket DB tests; 3 ca report/discipline không bật trong run này |
| Match scheduling concurrency + snapshot repository | **PASS – 2/2** | PostgreSQL scheduling DB; cùng sân cạnh tranh chỉ một lịch thành công; CAS hai writer; reset snapshot |
| Web automatic referee planner | **PASS – 9/9** | Shared implementation được test qua script của Web Client |
| Full Match DB suite với mọi cờ tích hợp | **FAIL ban đầu – 3 ca** | 1 ca lịch xung đột (đã sửa, focused test và selected suite sau sửa PASS); 2 ca ngoài phạm vi Step 3–5: discipline outbox không tạo card kỳ vọng và match-report review báo `REPORT_NOT_FOUND` |
| Migration Tournament 24 | **PASS** | Đã chạy `tournament-service migrate`, output schema current |
| Migration Match 1005 | **PASS** | Đã chạy `match-service migrate`, ba database Match báo current; migration snapshot ở scheduling DB |
| Health checks runtime hiện có | **PASS (health only)** | Gateway `:8080`, Web `:5173`, services `:3001/:3003/:3004/:3005/:3006` trả HTTP 200 |
| Build mới được deploy/rebuild vào runtime | **NOT TESTED** | `docker` không có trong PATH nên không thể xác nhận container đang dùng source vừa build |
| Frontend → Gateway → Backend → PostgreSQL với endpoint mới | **NOT TESTED** | Không xác nhận được runtime cập nhật; health 200 chỉ chứng minh tiến trình đang phục vụ |
| Browser E2E nhiều actor/tab/reload | **NOT TESTED** | Shared browser tab không khả dụng trong lượt kiểm tra cuối; chưa đăng nhập UI để xác nhận endpoint mới |
| API production gate/role bằng request end-to-end | **NOT TESTED** | Kiểm tra code path/typecheck; chưa chạy request qua runtime production-equivalent |

## Regression theo phạm vi

- Các API scheduling test được gọi trong suite qua shared validator/planner; integration xác nhận ghi lịch thực vẫn chống tranh chấp sân và thời gian nghỉ.
- Tournament integration chạy toàn bộ suite hiện có với DB flag bật và snapshot test mới.
- Chưa có E2E đăng ký → chốt danh sách → draw → fixture → schedule thật trên UI trong lần này. Không tuyên bố PASS cho luồng đó.
- Hai integration failure ngoài Step 3–5 được giữ nguyên để báo cáo; không được che bằng skip hoặc sửa dữ liệu hiện có.

## An toàn dữ liệu

- Migration là additive, versioned; không chạy seed, reset, `TRUNCATE`, xóa volume hoặc thay SMTP.
- DB tests tạo ID ngẫu nhiên và dọn hàng theo ID đã tạo; test snapshot reset chỉ xóa khóa tournament của fixture thử nghiệm.
- Không chạy Docker rebuild/up vì CLI chưa truy cập được trong terminal; không dừng hoặc restart container đang chạy.
