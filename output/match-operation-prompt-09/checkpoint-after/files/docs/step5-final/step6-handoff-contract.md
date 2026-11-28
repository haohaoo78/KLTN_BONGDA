# Hợp đồng dữ liệu bàn giao Bước 6

Tài liệu này ghi nhận hợp đồng từ luồng publication sandbox đã có trong Match Service. Đây là mô tả dữ liệu cần bàn giao, không phải triển khai phân công trọng tài.

## Nguồn và version

- `tournamentId`
- `scheduleVersion` tăng theo lần công bố
- `diagramSnapshotKey` / version sơ đồ Bước 4 được công bố cùng lịch
- `publishedAt`, `publishedBy`
- `fixtureId` ổn định từ danh sách fixture Step 4; không sinh lại khi bàn giao

## Trường mỗi fixture

| Field | Nội dung |
|---|---|
| `fixtureId` | ID trận ổn định |
| `stage`, `group`, `round`, `leg` | Giai đoạn, bảng, vòng, lượt |
| `homeTeamId`, `awayTeamId` | Đội đã xác định nếu có |
| `homeSource`, `awaySource` | Nguồn đội nếu còn là qualifier/winner source |
| `scheduledAt` | Thời gian bắt đầu có timezone/ISO |
| `durationMinutes` | Thời lượng thi đấu dự kiến |
| `venue`, `location` | Sân và địa điểm |
| `occupiedFrom`, `occupiedUntil` | Khoảng chiếm dụng sân gồm chuẩn bị/chuyển tiếp/turnaround |

Endpoint sandbox publication trả `handoff: { scheduleVersion, fixtures }` và state chuyển `currentStep: 6`. Kiểm thử thực tế contract này trong Giai đoạn 9: **NOT TESTED**. Không khẳng định dữ liệu đã được lưu trong lịch production hoặc Bước 6 đã được triển khai.
