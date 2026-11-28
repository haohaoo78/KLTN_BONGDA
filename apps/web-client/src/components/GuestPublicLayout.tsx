import { useEffect, useState } from "react";

export const guestNavigation = [
  { id: "overview", label: "Trang chủ" },
  { id: "tournaments", label: "Giải đấu" },
  { id: "matches", label: "Lịch & kết quả" },
  { id: "standings", label: "Bảng xếp hạng" },
  { id: "teams", label: "Đội bóng" },
] as const;

export type GuestSection = typeof guestNavigation[number]["id"];

export function GuestArrow() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function GuestBall({ size = 26 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.5" /><path d="m16 10 5.7 4.1-2.2 6.7h-7L10.3 14 16 10Zm0 0V3m5.7 11 6.5-2.2m-8.7 9 4.2 5.6m-11.2-5.6-4.2 5.6M10.3 14l-6.5-2.2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

function GuestBrand({ onHome }: { onHome: () => void }) {
  return <button className="guest-brand" type="button" onClick={onHome} aria-label="SÂN CỎ — Trang chủ">
    <svg className="guest-brand-symbol" viewBox="0 0 40 44" fill="none" aria-hidden="true"><path d="M20 2 37 8v13c0 9-7 16-17 21C10 37 3 30 3 21V8L20 2Z" stroke="currentColor" strokeWidth="1.7" /><path d="m20 12 7 5-2.7 8.3h-8.6L13 17l7-5Zm0 0V6m7 11 6 2m-8.7 6.3 4 5.7m-12.6-5.7-4 5.7M13 17l-6 2" stroke="currentColor" strokeWidth="1.5" /></svg>
    <span><strong>SÂN CỎ</strong><small>BÓNG ĐÁ SINH VIÊN</small></span>
  </button>;
}

export function GuestPublicHeader({ activeSection, onNavigate, onLogin, onRegister }: {
  activeSection: string;
  onNavigate: (section: GuestSection) => void;
  onLogin: () => void;
  onRegister: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [activeSection]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  function navigate(section: GuestSection) { setMenuOpen(false); onNavigate(section); }
  return <header className="guest-header">
    <div className="guest-header-inner">
      <GuestBrand onHome={() => navigate("overview")} />
      <nav id="guest-main-navigation" className={`guest-navigation${menuOpen ? " is-open" : ""}`} aria-label="Điều hướng công khai">
        {guestNavigation.map(item => <button key={item.id} type="button" onClick={() => navigate(item.id)} className={activeSection === item.id ? "is-active" : ""} aria-current={activeSection === item.id ? "page" : undefined}>{item.label}</button>)}
      </nav>
      <div className="guest-auth-actions">
        <a className="guest-login" href="#login" onClick={() => { setMenuOpen(false); onLogin(); }}>Đăng nhập</a>
        <a className="guest-button guest-button-primary" href="#login" onClick={() => { setMenuOpen(false); onRegister(); }}>Đăng ký</a>
      </div>
      <button className="guest-menu-toggle" type="button" aria-label={menuOpen ? "Đóng menu" : "Mở menu"} aria-expanded={menuOpen} aria-controls="guest-main-navigation" onClick={() => setMenuOpen(open => !open)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">{menuOpen ? <path d="m6 6 12 12M6 18 18 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}</svg>
      </button>
    </div>
  </header>;
}

export function GuestPublicFooter({ onNavigate }: { onNavigate: (section: GuestSection) => void }) {
  return <footer className="guest-footer">
    <div className="guest-footer-main">
      <div><GuestBrand onHome={() => onNavigate("overview")} /><p>Kết nối sân chơi, theo dõi đam mê.<br />Nền tảng bóng đá sinh viên tại TP. Hồ Chí Minh.</p></div>
      <nav aria-label="Liên kết cuối trang">{guestNavigation.filter(item => item.id !== "overview").map(item => <button key={item.id} type="button" onClick={() => onNavigate(item.id)}>{item.label}</button>)}</nav>
    </div>
    <div className="guest-footer-bottom"><span>© {new Date().getFullYear()} SÂN CỎ.</span><span>Bóng đá sinh viên · TP. Hồ Chí Minh</span></div>
  </footer>;
}

export function GuestSkeleton({ rows = 3, label = "Đang tải dữ liệu" }: { rows?: number; label?: string }) {
  return <div className="guest-skeleton" role="status" aria-label={label}><span className="sr-only">{label}</span>{Array.from({ length: rows }, (_, index) => <div className="guest-skeleton-row" key={index} aria-hidden="true"><i /><div><span /><span /></div></div>)}</div>;
}

export function GuestDataMessage({ title, children, error = false, onRetry }: { title: string; children?: React.ReactNode; error?: boolean; onRetry?: () => void }) {
  return <div className={`guest-data-message${error ? " is-error" : ""}`} role={error ? "alert" : undefined}>
    <span className="guest-data-icon" aria-hidden="true">{error ? "!" : <GuestBall />}</span>
    <div><h3>{title}</h3>{children ? <p>{children}</p> : null}</div>
    {onRetry ? <button className="guest-button guest-button-outline" type="button" onClick={onRetry}>Thử lại <GuestArrow /></button> : null}
  </div>;
}
