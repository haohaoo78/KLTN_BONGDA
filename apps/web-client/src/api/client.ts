export const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
export const NOTIFICATION_REALTIME_EVENT = "sfl:notification-created";

type ApiErrorBody = {
  error?: {
    message?: string;
    code?: string;
    details?: Record<string, unknown>;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const AuthApiError = ApiError;

function friendlyApiMessage(status: number, code: string | undefined, message: string): string {
  if (code === "INVALID_CREDENTIALS") return "Email hoặc mật khẩu không chính xác.";
  if (code === "EMAIL_NOT_VERIFIED") return "Email chưa được xác minh. Hãy kiểm tra hộp thư của bạn.";
  if (status === 0) return "Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.";
  if (status === 401) return "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 403) return "Bạn không có quyền thực hiện thao tác này.";
  if (status === 404) return "Không tìm thấy dữ liệu yêu cầu.";
  if (status === 408 || status === 429) return "Yêu cầu đang bận hoặc quá thời gian. Vui lòng thử lại sau.";
  if (status >= 500) return "Hệ thống đang gặp sự cố. Vui lòng thử lại sau.";
  if (code === "VALIDATION_ERROR") return "Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại các trường.";
  if (code === "TEAM_TOURNAMENT_DATE_CONFLICT") return "Không thể duyệt đội: đội này đã được duyệt ở một giải khác có lịch thi đấu trùng.";
  if (code === "TOURNAMENT_TEAM_LIMIT_REACHED") return "Đã đủ số đội tối đa được duyệt cho giải này.";
  if (code === "INSTITUTION_TEAM_LIMIT_REACHED") return "Trường của đội đã đủ chỉ tiêu được duyệt trong giải này.";
  if (code === "REGISTRATION_NOT_PENDING" || code === "REGISTRATION_ALREADY_DECIDED" || code === "REGISTRATION_DECISION_CONFLICT") {
    return "Hồ sơ đã được cập nhật bởi thao tác khác. Hãy tải lại danh sách và kiểm tra trạng thái trước khi quyết định tiếp.";
  }
  if (code === "REGISTRATION_DECISION_SYNC_PENDING") return "Quyết định đang được đồng bộ. Hãy tải lại danh sách sau ít phút.";
  if (code === "REGISTRATION_ROSTER_REQUIRED") return "Đội chưa gửi roster cho giải nên chưa thể duyệt hồ sơ.";
  // Keep the authoritative scheduling reason (fixture, lock, resource or constraint)
  // instead of labelling every business rejection as a stale-data conflict.
  if (code && (code.startsWith("SCHEDULE_") || code.startsWith("PUBLISHED_SCHEDULE_")
    || ["OFFICIAL_VENUE_REQUIRED", "OFFICIAL_FIXTURE_REQUIRED", "PUBLISHED_FIXTURES_REQUIRED", "STALE_OFFICIAL_DIAGRAM", "VENUE_CONFLICT", "VENUE_UNAVAILABLE", "VENUE_NOT_ACTIVE"].includes(code))) {
    return message || "Lịch chưa đáp ứng điều kiện nghiệp vụ. Kiểm tra sân, thời gian và các trận liên quan.";
  }
  if (code?.startsWith("REFEREE_") && message) return message;
  if (status === 409) return "Dữ liệu đã thay đổi hoặc bị xung đột. Hãy tải lại rồi thử lại.";
  return message || "Không thể hoàn tất yêu cầu. Vui lòng thử lại.";
}

async function parseJson<T>(res: Response): Promise<T | undefined> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    if (!res.ok) return undefined;
    throw new ApiError(502, friendlyApiMessage(502, "INVALID_SERVER_RESPONSE", ""), "INVALID_SERVER_RESPONSE");
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, friendlyApiMessage(0, "NETWORK_ERROR", ""), "NETWORK_ERROR");
  }

  if (!res.ok) {
    const body = await parseJson<ApiErrorBody>(res.clone());
    throw new ApiError(
      res.status,
      friendlyApiMessage(res.status, body?.error?.code, body?.error?.message ?? res.statusText),
      body?.error?.code,
      body?.error?.details,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await parseJson<T>(res)) as T;
}
