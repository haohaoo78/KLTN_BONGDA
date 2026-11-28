# Chạy dự án bằng Docker

## 1. Yêu cầu

- Cài **Docker Desktop** và bật Docker Engine.
- Mở PowerShell tại thư mục dự án.

## 2. Cấu hình lần đầu

```powershell
Copy-Item .env.example .env
```

Mở `.env` và kiểm tra các biến môi trường. Nếu cần đăng ký tài khoản hoặc đặt lại mật khẩu, điền `SMTP_USER` và `SMTP_PASS` bằng thông tin SMTP thật (Gmail nên dùng **App Password**, không dùng mật khẩu đăng nhập).

## 3. Build và chạy

```powershell
docker compose --profile apps up --build -d
docker compose ps
```

Lần đầu chạy sẽ tự tạo database, Redis, chạy migration và khởi động các service.

## 4. Truy cập

- Website: http://localhost:5173
- Kiểm tra API: http://localhost:8080/health

## 5. Xem log và dừng

```powershell
docker compose logs -f api-gateway
docker compose --profile apps down
```

Không dùng `down -v` nếu muốn giữ dữ liệu database và Redis.

## Gặp lỗi khi chạy lại

```powershell
docker compose --profile apps up --build -d
docker compose ps
```

Nếu lỗi liên quan SMTP, kiểm tra lại `SMTP_USER` và `SMTP_PASS` trong `.env`. Không commit hoặc chia sẻ file `.env`.
