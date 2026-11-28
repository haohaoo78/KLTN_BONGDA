import { FormEvent, useState } from "react";

export function AccountActivationPanel(props: {
  submitting: boolean;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    setError(null);
    await props.onSubmit(password);
    setPassword("");
    setConfirmation("");
  }

  return (
    <section className="login-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">KÍCH HOẠT TÀI KHOẢN</span><h2>Thiết lập mật khẩu</h2></div>
      </div>
      <p>Liên kết chỉ dùng một lần và hết hạn sau 24 giờ. Email sẽ được xác minh khi kích hoạt thành công.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <form className="login-form" onSubmit={(event) => void submit(event)}>
        <label className="field">Mật khẩu mới
          <input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <label className="field">Xác nhận mật khẩu
          <input type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
        </label>
        <button className="primary-button" disabled={props.submitting}>{props.submitting ? "Đang kích hoạt…" : "Kích hoạt tài khoản"} <span>↗</span></button>
      </form>
    </section>
  );
}
