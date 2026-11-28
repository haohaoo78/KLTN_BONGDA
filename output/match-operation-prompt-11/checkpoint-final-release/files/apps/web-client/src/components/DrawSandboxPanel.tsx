import { useMemo, useState } from "react";
import { Modal } from "./Modal";

type Format = "ROUND_ROBIN" | "KNOCKOUT" | "MIXED";
type Method = "LIVE" | "RANDOM" | "MANUAL";
type Team = { id: string; name: string; short: string; school: string; pot: number };
type Group = { name: string; teams: Team[] };
type Draft = { selected: string[]; format: Format; method: Method; groupCount: number; legs: number; qualifiers: number; allocation: "BALANCED" | "TOP_UP_FIRST"; thirdPlace: boolean; seeded: boolean; separateSchools: boolean; assignments: Record<string, number>; pots: Record<string, number>; liveAt?: string; resultGroups?: string[][] };

const schoolNames = ["ĐH Công nghiệp TP.HCM", "ĐH Kinh tế TP.HCM", "ĐH Sư phạm TP.HCM", "ĐH Bách khoa TP.HCM", "ĐH Tôn Đức Thắng", "ĐH Văn Lang", "ĐH Giao thông Vận tải", "CĐ Công thương"];
const clubNames = ["Warriors", "Phoenix", "United", "Falcons"];
const teams: Team[] = schoolNames.flatMap((school, schoolIndex) => clubNames.map((club, clubIndex) => {
  const index = schoolIndex * clubNames.length + clubIndex;
  return { id: `sandbox-team-${index + 1}`, name: `${school.split(" ").slice(1, 3).join(" ")} ${club}`, short: `${schoolIndex + 1}.${clubIndex + 1}`, school, pot: Math.floor(index / 8) + 1 };
}));
const initial: Draft = { selected: teams.slice(0, 16).map((team) => team.id), format: "MIXED", method: "RANDOM", groupCount: 4, legs: 1, qualifiers: 2, allocation: "BALANCED", thirdPlace: false, seeded: true, separateSchools: true, assignments: {}, pots: Object.fromEntries(teams.map((team) => [team.id, team.pot])) };
const storageKey = "sfl.draw.sandbox.v1";
const formatNames: Record<Format, string> = { ROUND_ROBIN: "Vòng tròn", KNOCKOUT: "Loại trực tiếp", MIXED: "Vòng bảng · loại trực tiếp" };
const methodNames: Record<Method, string> = { LIVE: "Bốc thăm trực tiếp", RANDOM: "Bốc thăm ngẫu nhiên", MANUAL: "Sắp xếp thủ công" };

function readSaved(): Draft | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Draft>;
    if (!Array.isArray(value.selected) || !["ROUND_ROBIN", "KNOCKOUT", "MIXED"].includes(value.format ?? "")) return null;
    return { ...initial, ...value } as Draft;
  } catch { return null; }
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function DrawSandboxPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => readSaved() ?? initial);
  const [tab, setTab] = useState<"setup" | "draw" | "result">("setup");
  const [search, setSearch] = useState("");
  const [drawn, setDrawn] = useState<string[]>([]);
  const [liveState, setLiveState] = useState<"WAITING" | "LIVE" | "PAUSED" | "COMPLETED" | "DISCONNECTED">("WAITING");
  const [viewer, setViewer] = useState("BTC");
  const [notice, setNotice] = useState("");
  const selectedTeams = useMemo(() => draft.selected.flatMap((id) => { const team = teams.find((candidate) => candidate.id === id); return team ? [team] : []; }), [draft.selected]);
  const knockoutOnly = draft.format === "KNOCKOUT";
  const groupCount = knockoutOnly ? 1 : Math.max(1, Math.min(draft.groupCount, Math.floor(selectedTeams.length / 2) || 1));
  const groups = useMemo<Group[]>(() => {
    const result = Array.from({ length: groupCount }, (_, index) => ({ name: `Bảng ${String.fromCharCode(65 + index)}`, teams: [] as Team[] }));
    if (draft.method === "RANDOM" && draft.resultGroups) {
      result.forEach((group, index) => { group.teams = (draft.resultGroups?.[index] ?? []).map((id) => teams.find((team) => team.id === id)).filter((team): team is Team => Boolean(team)); });
      return result;
    }
    if (["MANUAL", "LIVE"].includes(draft.method) && Object.keys(draft.assignments).length) {
      for (const team of selectedTeams) {
        const target = draft.assignments[team.id];
        if (Number.isInteger(target) && result[target]) result[target].teams.push(team);
      }
      return result;
    }
    const order = draft.seeded && draft.format !== "KNOCKOUT"
      ? [...selectedTeams].sort((left, right) => (draft.pots[left.id] ?? left.pot) - (draft.pots[right.id] ?? right.pot) || left.name.localeCompare(right.name))
      : shuffle(selectedTeams);
    if (draft.allocation === "TOP_UP_FIRST") order.forEach((team, index) => result[Math.min(groupCount - 1, Math.floor(index / Math.ceil(order.length / groupCount)))].teams.push(team));
    else order.forEach((team, index) => result[index % groupCount].teams.push(team));
    if (draft.separateSchools && groupCount > 1 && result.some((group) => new Set(group.teams.map((team) => team.school)).size !== group.teams.length)) {
      const assigned = new Set<string>();
      const reordered = shuffle(selectedTeams);
      result.forEach((group) => { group.teams = []; });
      for (const team of reordered) {
        const target = result.find((group) => group.teams.length < Math.ceil(selectedTeams.length / groupCount) && !group.teams.some((item) => item.school === team.school));
        if (target && !assigned.has(team.id)) { target.teams.push(team); assigned.add(team.id); }
      }
      for (const team of reordered) if (!assigned.has(team.id)) result.sort((a, b) => a.teams.length - b.teams.length)[0]?.teams.push(team);
    }
    return result;
  }, [draft, groupCount, selectedTeams]);
  const groupIssues = groups.flatMap((group) => {
    const issues: string[] = [];
    if (group.teams.length < 2) issues.push(`${group.name} cần ít nhất 2 đội.`);
    if (draft.separateSchools && !knockoutOnly && groupCount > 1 && new Set(group.teams.map((team) => team.school)).size !== group.teams.length) issues.push(`${group.name} có hai đội cùng trường.`);
    return issues;
  });
  const bracketSize = 2 ** Math.ceil(Math.log2(Math.max(selectedTeams.length, 2)));
  const groupMatchCount = groups.reduce((total, group) => total + (group.teams.length * (group.teams.length - 1) / 2) * draft.legs, 0);
  const playoffTeamCount = groups.reduce((sum, group) => sum + Math.min(draft.qualifiers, group.teams.length), 0);
  const playoffBracketSize = 2 ** Math.ceil(Math.log2(Math.max(playoffTeamCount, 2)));
  const playoffMatches = Math.max(0, playoffTeamCount - 1) + (draft.thirdPlace && playoffTeamCount >= 4 ? 1 : 0);
  const matches = knockoutOnly ? Math.max(0, bracketSize - 1) + (draft.thirdPlace && selectedTeams.length >= 4 ? 1 : 0) : draft.format === "MIXED" ? groupMatchCount + playoffMatches : groupMatchCount;
  const byes = knockoutOnly ? bracketSize - selectedTeams.length : draft.format === "MIXED" ? Math.max(0, playoffBracketSize - playoffTeamCount) : 0;
  const groupRounds = Math.max(...groups.map((group) => Math.max(1, group.teams.length % 2 ? group.teams.length : group.teams.length - 1)), 1) * draft.legs;
  const roundCount = knockoutOnly ? Math.log2(bracketSize) : draft.format === "MIXED" ? groupRounds + Math.log2(playoffBracketSize) : groupRounds;
  const assignedCount = draft.method === "MANUAL" && !knockoutOnly ? Object.keys(draft.assignments).filter((id) => draft.selected.includes(id)).length : selectedTeams.length;
  const validCount = selectedTeams.length >= 4 && selectedTeams.length <= 32;
  const liveNotStarted = Boolean(draft.liveAt && new Date(draft.liveAt).getTime() > Date.now());

  function update(patch: Partial<Draft>) { setDraft((current) => ({ ...current, ...patch, resultGroups: undefined })); setDrawn([]); setLiveState("WAITING"); setNotice(""); }
  function saveDraft() { localStorage.setItem(storageKey, JSON.stringify(draft)); setNotice("Đã lưu bản nháp Sandbox trên trình duyệt này."); }
  function resetScenario() {
    if (!window.confirm("Đặt lại cấu hình và kết quả Sandbox hiện tại? Dữ liệu giải thật không bị ảnh hưởng.")) return;
    localStorage.removeItem(storageKey); setDraft(initial); setDrawn([]); setLiveState("WAITING"); setTab("setup"); setNotice("Đã đặt lại riêng kịch bản Sandbox.");
  }
  function makeDraw() {
    if (!validCount || groupIssues.length || (draft.method === "MANUAL" && !knockoutOnly && assignedCount !== selectedTeams.length)) return;
    if (draft.method === "LIVE") { setLiveState("LIVE"); setDrawn([]); setTab("draw"); setNotice("Phiên bốc thăm mô phỏng đã bắt đầu."); return; }
    setDrawn(selectedTeams.map((team) => team.id));
    if (draft.method === "RANDOM") setDraft((current) => ({ ...current, resultGroups: groups.map((group) => group.teams.map((team) => team.id)) }));
    setTab("result"); setNotice(draft.method === "RANDOM" ? "Đã tạo phương án ngẫu nhiên trong Sandbox." : "Đã dựng sơ đồ từ phân bổ thủ công.");
  }
  function revealNext() {
    const next = selectedTeams.find((team) => !drawn.includes(team.id));
    if (!next) { setLiveState("COMPLETED"); return; }
    const target = groups.slice().sort((a, b) => a.teams.length - b.teams.length)[0];
    setDraft((current) => ({ ...current, assignments: { ...current.assignments, [next.id]: Math.max(0, groups.indexOf(target)) } }));
    const nextDrawn = [...drawn, next.id]; setDrawn(nextDrawn);
    if (nextDrawn.length === selectedTeams.length) setLiveState("COMPLETED");
  }
  function moveTeam(teamId: string, direction: -1 | 1) {
    const from = selectedTeams.findIndex((team) => team.id === teamId); const to = from + direction;
    if (to < 0 || to >= selectedTeams.length) return;
    const next = [...selectedTeams]; [next[from], next[to]] = [next[to], next[from]];
    update({ selected: next.map((team) => team.id) });
  }

  return <Modal open={open} onClose={onClose} eyebrow="SANDBOX · DỮ LIỆU MÔ PHỎNG" title="Chia bảng & sơ đồ thi đấu" description="Trải nghiệm 3 thể thức × 3 phương thức. Mọi thao tác chỉ lưu trong trình duyệt, không ghi vào giải chính thức." className="draw-sandbox-modal">
    <div className="draw-sandbox-topline"><span className="draw-sandbox-safe"><span aria-hidden="true">●</span> Sandbox tách biệt dữ liệu thật</span><label className="draw-field draw-sandbox-viewer"><span>Góc nhìn</span><select value={viewer} onChange={(event) => setViewer(event.target.value)}><option value="BTC">Ban tổ chức</option><option value="CLUB">Trưởng CLB</option><option value="PLAYER">Cầu thủ</option><option value="REFEREE">Trọng tài</option><option value="PUBLIC">Khán giả</option></select></label></div>
    <div className="draw-sandbox-tabs" role="tablist" aria-label="Các phần Sandbox">
      {([["setup", "1. Thiết lập"], ["draw", "2. Phân bổ"], ["result", "3. Kết quả & xem thử"]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}
    </div>
    {notice ? <p className="draw-sandbox-notice" role="status">{notice}</p> : null}
    {tab === "setup" ? <div className="draw-sandbox-layout">
      <div className="draw-sandbox-config">
        <div className="draw-sandbox-section-title"><div><span className="eyebrow">CẤU HÌNH KỊCH BẢN</span><h3>Giải mô phỏng</h3></div><span className="draw-sandbox-chip">{selectedTeams.length} đội được chọn</span></div>
        <div className="draw-sandbox-form-grid">
          <label className="draw-field"><span>Thể thức</span><select value={draft.format} onChange={(event) => update({ format: event.target.value as Format })}>{Object.entries(formatNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="draw-field"><span>Phương thức phân bổ</span><select value={draft.method} onChange={(event) => update({ method: event.target.value as Method })}>{Object.entries(methodNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {!knockoutOnly ? <>
            <label className="draw-field"><span>Số bảng</span><input type="number" min={1} max={16} value={draft.groupCount} onChange={(event) => update({ groupCount: Math.max(1, Math.min(16, Number(event.target.value) || 1)) })} /></label>
            <label className="draw-field"><span>Phân bổ đội</span><select value={draft.allocation} onChange={(event) => update({ allocation: event.target.value as Draft["allocation"] })}><option value="BALANCED">Cân bằng số đội</option><option value="TOP_UP_FIRST">Lấp đầy bảng trước</option></select></label>
            <label className="draw-field"><span>Số lượt vòng tròn</span><select value={draft.legs} onChange={(event) => update({ legs: Number(event.target.value) })}><option value={1}>Một lượt</option><option value={2}>Hai lượt</option></select></label>
          </> : null}
          {draft.format !== "ROUND_ROBIN" ? <>
            <label className="draw-field"><span>Số đội đi tiếp mỗi bảng</span><input type="number" min={1} max={8} value={draft.qualifiers} onChange={(event) => update({ qualifiers: Math.max(1, Math.min(8, Number(event.target.value) || 1)) })} /></label>
            <label className="draw-check"><input type="checkbox" checked={draft.thirdPlace} onChange={(event) => update({ thirdPlace: event.target.checked })} /><span>Có trận tranh hạng ba</span></label>
          </> : null}
          {!knockoutOnly ? <><label className="draw-check"><input type="checkbox" checked={draft.seeded} onChange={(event) => update({ seeded: event.target.checked })} /><span>Sử dụng nhóm hạt giống</span></label><label className="draw-check"><input type="checkbox" checked={draft.separateSchools} onChange={(event) => update({ separateSchools: event.target.checked })} /><span>Ưu tiên tách đội cùng trường</span></label></> : null}
          <label className="draw-field draw-sandbox-live-time"><span>Thời gian bốc thăm trực tiếp</span><input type="datetime-local" value={draft.liveAt ?? ""} onChange={(event) => update({ liveAt: event.target.value })} /></label>
        </div>
        <div className="draw-sandbox-stats"><article><strong>{selectedTeams.length}</strong><span>Đội tham gia</span></article>{!knockoutOnly ? <article><strong>{groupCount}</strong><span>Bảng dự kiến</span></article> : null}<article><strong>{roundCount}</strong><span>Vòng dự kiến</span></article><article><strong>{matches}</strong><span>Trận dự kiến</span></article>{byes > 0 ? <article><strong>{byes}</strong><span>Suất BYE</span></article> : null}</div>
        <div className="draw-sandbox-seedings"><div className="draw-sandbox-section-title"><div><span className="eyebrow">NHÓM HẠT GIỐNG</span><h3>Phân pot</h3></div><span className="muted">Không quá {groupCount} đội mỗi pot</span></div>{selectedTeams.filter((team) => draft.seeded).map((team) => <label key={team.id} className="draw-sandbox-seed-row"><span><strong>{team.name}</strong><small>{team.school}</small></span><select aria-label={`Pot của ${team.name}`} value={draft.pots[team.id] ?? team.pot} onChange={(event) => update({ pots: { ...draft.pots, [team.id]: Number(event.target.value) } })}>{Array.from({ length: Math.max(1, Math.ceil(selectedTeams.length / groupCount)) }, (_, index) => <option key={index + 1} value={index + 1}>Pot {index + 1}</option>)}</select></label>)}</div>
      </div>
      <aside className="draw-sandbox-team-pool"><div className="draw-sandbox-section-title"><div><span className="eyebrow">BỘ DỮ LIỆU GỐC</span><h3>32 đội mô phỏng</h3></div><button type="button" className="text-button" onClick={() => update({ selected: selectedTeams.length === 32 ? [] : teams.map((team) => team.id) })}>{selectedTeams.length === 32 ? "Bỏ chọn hết" : "Chọn cả 32"}</button></div><input aria-label="Tìm đội mô phỏng" placeholder="Tìm đội hoặc trường" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="draw-sandbox-team-list">{teams.filter((team) => `${team.name} ${team.school}`.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi"))).map((team) => <label key={team.id} className="draw-sandbox-team-option"><input type="checkbox" checked={draft.selected.includes(team.id)} onChange={(event) => update({ selected: event.target.checked ? [...draft.selected, team.id] : draft.selected.filter((id) => id !== team.id) })} /><span><strong>{team.name}</strong><small>{team.school} · Pot {draft.pots[team.id] ?? team.pot}</small></span><small>{team.short}</small></label>)}</div><p className="form-help">Chọn 4–32 đội. Dữ liệu này không lấy từ database.</p></aside>
    </div> : null}
    {tab === "draw" ? <div className="draw-sandbox-draw-view"><div className="draw-sandbox-section-title"><div><span className="eyebrow">{methodNames[draft.method].toLocaleUpperCase("vi")}</span><h3>{formatNames[draft.format]} · {selectedTeams.length} đội</h3></div><span className={`draw-sandbox-live-status ${liveState.toLowerCase()}`}>{liveState === "WAITING" ? liveNotStarted ? "Chưa tới giờ" : "Chưa bắt đầu" : liveState === "LIVE" ? "Đang diễn ra" : liveState === "PAUSED" ? "Tạm dừng" : liveState === "COMPLETED" ? "Hoàn tất" : "Mất kết nối"}</span></div>
      {draft.method === "MANUAL" ? <div className="draw-sandbox-manual-list">{selectedTeams.map((team, index) => <div className="draw-sandbox-manual-row" key={team.id}><span className="draw-sandbox-number">{index + 1}</span><div><strong>{team.name}</strong><small>{team.school}</small></div>{knockoutOnly ? <small>Hạt giống {index + 1}</small> : <select aria-label={`Bảng của ${team.name}`} value={draft.assignments[team.id] ?? ""} onChange={(event) => update({ assignments: { ...draft.assignments, [team.id]: Number(event.target.value) } })}><option value="" disabled>Chọn bảng</option>{groups.map((group, groupIndex) => <option key={group.name} value={groupIndex}>{group.name}</option>)}</select>}<button type="button" onClick={() => moveTeam(team.id, -1)} aria-label={`Đưa ${team.name} lên`}>↑</button><button type="button" onClick={() => moveTeam(team.id, 1)} aria-label={`Đưa ${team.name} xuống`}>↓</button></div>)}</div> : draft.method === "LIVE" ? <div className="draw-sandbox-live-stage"><div className="draw-sandbox-ball" aria-hidden="true">⚽</div><strong>{liveState === "WAITING" ? liveNotStarted ? "Chưa đến thời gian bốc thăm đã đặt" : "Sẵn sàng mở phiên bốc thăm" : liveState === "COMPLETED" ? "Đã bốc đủ đội" : liveState === "PAUSED" ? "Phiên đang tạm dừng" : liveState === "DISCONNECTED" ? "Đang mô phỏng mất kết nối" : `Đã bốc ${drawn.length} / ${selectedTeams.length} đội`}</strong><p>Góc nhìn hiện tại: {viewer === "BTC" ? "Ban tổ chức điều hành" : viewer === "PUBLIC" ? "Khán giả theo dõi" : viewer === "CLUB" ? "Trưởng câu lạc bộ" : viewer === "PLAYER" ? "Cầu thủ" : "Trọng tài"}</p><div className="draw-sandbox-live-actions">{liveState === "WAITING" ? liveNotStarted ? <button type="button" className="secondary-button" onClick={() => { const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16); update({ liveAt: now }); }}>Mô phỏng đã đến giờ</button> : <button className="primary-button" type="button" onClick={() => { setLiveState("LIVE"); setDrawn([]); }}>Bắt đầu phiên</button> : null}{liveState === "LIVE" ? <><button className="primary-button" type="button" onClick={revealNext} disabled={drawn.length >= selectedTeams.length}>Bốc đội tiếp theo</button><button type="button" className="secondary-button" onClick={() => setLiveState("PAUSED")}>Tạm dừng</button><button type="button" className="text-button" onClick={() => setLiveState("DISCONNECTED")}>Mô phỏng mất kết nối</button></> : null}{liveState === "PAUSED" || liveState === "DISCONNECTED" ? <button className="primary-button" type="button" onClick={() => setLiveState("LIVE")}>Kết nối lại & tiếp tục</button> : null}{liveState === "COMPLETED" ? <button className="secondary-button" type="button" onClick={() => { setDrawn([]); setLiveState("WAITING"); setDraft((current) => ({ ...current, assignments: {} })); }}>Chạy kịch bản mới</button> : null}</div></div> : <div className="draw-sandbox-random-stage"><p>{draft.method === "RANDOM" ? "Phương án ngẫu nhiên sẽ chia đội theo số bảng và ràng buộc đã chọn." : "Gán đội vào bảng thủ công ở danh sách bên dưới; có thể đổi vị trí bất kỳ lúc nào."}</p><button className="primary-button" type="button" onClick={makeDraw} disabled={!validCount || groupIssues.length > 0}>{draft.method === "RANDOM" ? "Tạo phương án ngẫu nhiên" : "Xem kết quả phân bổ"}</button></div>}
      {draft.method === "LIVE" && drawn.length ? <div className="draw-sandbox-revealed"><h4>Kết quả đã bốc</h4>{groups.map((group) => <section key={group.name}><strong>{group.name}</strong>{group.teams.map((team) => <span key={team.id}>{team.name}</span>)}</section>)}</div> : null}
      {draft.method === "LIVE" && liveState !== "WAITING" && liveState !== "COMPLETED" ? <div className="draw-sandbox-viewer-controls"><span>Trạng thái người xem</span><span className="status-pill">{viewer === "PUBLIC" ? "Đang theo dõi" : "Chỉ xem"}</span><button type="button" className="text-button" onClick={() => setViewer("PUBLIC")}>Mở góc nhìn khán giả</button></div> : null}
    </div> : null}
    {tab === "result" ? <div className="draw-sandbox-results"><div className="draw-sandbox-section-title"><div><span className="eyebrow">KẾT QUẢ MÔ PHỎNG · KHÔNG CHÍNH THỨC</span><h3>{formatNames[draft.format]} · {methodNames[draft.method]}</h3></div><span className="draw-sandbox-chip">{matches} trận dự kiến · {byes} BYE</span></div>
      {!validCount ? <p className="form-error">Cần chọn từ 4 đến 32 đội.</p> : null}{groupIssues.length ? <div className="draw-sandbox-validation"><strong>Cần xử lý cấu hình</strong>{groupIssues.map((issue) => <p key={issue}>{issue}</p>)}</div> : null}
      {knockoutOnly ? <div className="draw-sandbox-bracket">{Array.from({ length: Math.max(1, roundCount) }, (_, roundIndex) => { const matchCount = bracketSize / 2 ** (roundIndex + 1); const byeCount = bracketSize - selectedTeams.length; return <div className="draw-sandbox-round" key={roundIndex}><strong>{roundIndex === roundCount - 1 ? "Chung kết" : roundIndex === roundCount - 2 ? "Bán kết" : `Vòng ${roundIndex + 1}`}</strong>{Array.from({ length: matchCount }, (_, matchIndex) => { const firstRoundTeamOffset = matchIndex < byeCount ? matchIndex : byeCount + (matchIndex - byeCount) * 2; const firstRoundOpponentOffset = matchIndex < byeCount ? -1 : firstRoundTeamOffset + 1; return <article key={matchIndex}><span>{roundIndex === 0 ? selectedTeams[firstRoundTeamOffset]?.name ?? "BYE" : `Thắng trận ${matchIndex * 2 + 1}`}</span><i>vs</i><span>{roundIndex === 0 ? firstRoundOpponentOffset < 0 ? "BYE · miễn vòng" : selectedTeams[firstRoundOpponentOffset]?.name ?? "BYE" : `Thắng trận ${matchIndex * 2 + 2}`}</span></article>; })}{draft.thirdPlace && roundIndex === roundCount - 1 && selectedTeams.length >= 4 ? <article><span>Thua bán kết 1</span><i>vs · tranh hạng ba</i><span>Thua bán kết 2</span></article> : null}</div>; })}</div> : <div className="draw-sandbox-groups">{groups.map((group) => <section key={group.name}><header><strong>{group.name}</strong><span>{group.teams.length} đội · {Math.max(0, group.teams.length * (group.teams.length - 1) / 2) * draft.legs} trận</span></header>{group.teams.map((team, index) => <article key={team.id}><span>{index + 1}</span><div><strong>{team.name}</strong><small>{team.school}</small></div>{draft.seeded ? <small>Pot {draft.pots[team.id] ?? team.pot}</small> : null}</article>)}{group.teams.length % 2 ? <p className="draw-sandbox-rest">Lịch vòng tròn có 1 đội nghỉ mỗi lượt</p> : null}{draft.format === "MIXED" ? <footer>Đi tiếp: {Math.min(draft.qualifiers, group.teams.length)} đội</footer> : null}</section>)}</div>}
      {draft.format === "MIXED" ? <div className="draw-sandbox-playoff"><h4>Sơ đồ loại trực tiếp</h4><div className="draw-sandbox-bracket-slots">{groups.flatMap((group) => Array.from({ length: Math.min(draft.qualifiers, group.teams.length) }, (_, index) => <span key={`${group.name}-${index}`}>{index === 0 ? "Nhất" : index === 1 ? "Nhì" : `Hạng ${index + 1}`} {group.name}</span>))}</div><p>{byes} suất BYE theo số đội vượt qua vòng bảng. Cặp đấu được quyết định sau khi xác định đội đi tiếp.</p></div> : null}
      <div className="draw-sandbox-footer"><span>Phân bổ đội: {selectedTeams.length} · Đã bốc: {draft.method === "LIVE" ? drawn.length : drawn.length || selectedTeams.length}</span><span>Góc nhìn: {viewer}</span><span>Trạng thái: {liveState === "COMPLETED" || draft.method !== "LIVE" ? "Mô phỏng hoàn tất" : "Bản xem trước"}</span></div>
    </div> : null}
    <div className="draw-sandbox-actions"><div><button type="button" className="text-button" onClick={resetScenario}>Đặt lại kịch bản Sandbox</button><button type="button" className="secondary-button" onClick={saveDraft}>Lưu bản nháp Sandbox</button><button type="button" className="text-button" onClick={() => { const saved = readSaved(); if (saved) { setDraft(saved); setNotice("Đã mở bản nháp Sandbox đã lưu."); } else setNotice("Chưa có bản nháp nào được lưu trên trình duyệt này."); }}>Mở bản nháp</button></div><div>{tab !== "setup" ? <button type="button" className="secondary-button" onClick={() => setTab(tab === "result" ? "draw" : "setup")}>Quay lại</button> : null}<button type="button" className="primary-button" onClick={() => { if (tab === "setup") setTab("draw"); else if (tab === "draw" && draft.method !== "LIVE") setTab("result"); else setTab("result"); }}>Tiếp tục</button></div></div>
  </Modal>;
}
