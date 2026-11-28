import { useMemo, useState } from "react";
import type { DemoFixture, DemoRefereeAssignment } from "../utils/drawTestStorage";
import type { AutoRefereeConfiguration, AutoRefereePreview } from "../utils/automaticRefereePlanner";

type Props = {
  fixtures: DemoFixture[];
  schedules: Record<string, { scheduledAt: string; venue: string }>;
  assignments: Record<string, DemoRefereeAssignment[]>;
  publishedFixtureIds: string[];
  policyMode: "BY_PERIOD" | "WHOLE_TOURNAMENT";
  policyRounds: string[];
  policyGroups: string[];
  policyDates: string[];
  running: boolean;
  error: string;
  onRun: (configuration: AutoRefereeConfiguration) => Promise<AutoRefereePreview | null>;
  onApply: (preview: AutoRefereePreview, configuration: AutoRefereeConfiguration) => Promise<boolean>;
  onCancel: () => void;
};

const objectiveLabels: Record<AutoRefereeConfiguration["objectives"][number], string> = {
  FEWEST_CANDIDATES: "Ưu tiên vị trí có ít ứng viên",
  UPCOMING: "Ưu tiên trận sắp diễn ra",
  EXPERIENCE: "Ưu tiên kinh nghiệm cho trận quan trọng",
  BALANCE: "Cân bằng khối lượng toàn giải",
  REST: "Tối ưu thời gian nghỉ",
  TEAM_REPEAT: "Hạn chế trọng tài lặp lại cùng đội",
  CREW_CONTINUITY: "Hạn chế thay đổi tổ không cần thiết",
};
const defaultObjectives: AutoRefereeConfiguration["objectives"] = ["FEWEST_CANDIDATES", "UPCOMING", "EXPERIENCE", "BALANCE", "REST", "TEAM_REPEAT", "CREW_CONTINUITY"];
const defaultConfiguration = (rounds: string[], groups: string[], dates: string[]): AutoRefereeConfiguration => ({ rounds, groups, dates, onlyUnassignedFixtures: false, onlyMissingSlots: true, method: "MIXED", objectives: [...defaultObjectives], maxRuntimeMs: 2500 });

export function DrawDemoAutomaticRefereeAssignmentPanel(props: Props) {
  const [configuration, setConfiguration] = useState(() => {
    const rounds = [...new Set(props.fixtures.map((fixture) => fixture.round))];
    const groups = [...new Set(props.fixtures.map((fixture) => fixture.groupName ?? "Knockout"))];
    const dates = [...new Set(props.fixtures.map((fixture) => props.schedules[fixture.id]?.scheduledAt?.slice(0, 10)).filter((date): date is string => Boolean(date)))];
    return defaultConfiguration(
      props.policyMode === "BY_PERIOD" ? rounds.filter((item) => props.policyRounds.includes(item)) : rounds,
      props.policyMode === "BY_PERIOD" && props.policyGroups.length ? groups.filter((item) => props.policyGroups.includes(item)) : groups,
      props.policyMode === "BY_PERIOD" && props.policyDates.length ? dates.filter((item) => props.policyDates.includes(item)) : dates,
    );
  });
  const [preview, setPreview] = useState<AutoRefereePreview | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const rounds = useMemo(() => [...new Set(props.fixtures.map((fixture) => fixture.round))]
    .filter((item) => props.policyMode === "WHOLE_TOURNAMENT" || props.policyRounds.includes(item))
    .sort((a, b) => a.localeCompare(b, "vi", { numeric: true })), [props.fixtures, props.policyMode, props.policyRounds]);
  const groups = useMemo(() => [...new Set(props.fixtures.map((fixture) => fixture.groupName ?? "Knockout"))]
    .filter((item) => props.policyMode === "WHOLE_TOURNAMENT" || !props.policyGroups.length || props.policyGroups.includes(item))
    .sort(), [props.fixtures, props.policyGroups, props.policyMode]);
  const dates = useMemo(() => [...new Set(props.fixtures.map((fixture) => props.schedules[fixture.id]?.scheduledAt?.slice(0, 10)).filter((date): date is string => Boolean(date)))]
    .filter((item) => props.policyMode === "WHOLE_TOURNAMENT" || !props.policyDates.length || props.policyDates.includes(item))
    .sort(), [props.fixtures, props.policyDates, props.policyMode, props.schedules]);
  const toggle = (key: "rounds" | "groups" | "dates", value: string) => setConfiguration((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] }));
  const prioritizedObjectives = configuration.objectives.length ? configuration.objectives : defaultObjectives;
  const moveObjective = (index: number, direction: -1 | 1) => setConfiguration((current) => {
    const next = [...current.objectives]; const target = index + direction;
    if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target], next[index]];
    return { ...current, objectives: next };
  });
  const onGenerate = async () => {
    setApplyError(""); setPreview(null);
    const result = await props.onRun(configuration);
    if (result) setPreview(result);
  };

  return <section className="step5-auto-referee-panel">
      <div className="panel-heading panel-heading-wrap"><div><span className="eyebrow">PHÂN CÔNG TỰ ĐỘNG · BẢN NHÁP CỤC BỘ</span><h3>Phạm vi và phương pháp</h3><p>Thuật toán chỉ xét các trận đã có lịch, không đổi lịch, mô hình hoặc phân công đã khóa/đã công bố. Chính sách hiện tại: {props.policyMode === "BY_PERIOD" ? "theo vòng/đợt" : "toàn giải"}.</p></div><span className="status-pill">Không tự động công bố</span></div>
    <div className="step5-auto-referee-config">
      <label>Phương thức<select value={configuration.method} onChange={(event) => setConfiguration((current) => ({ ...current, method: event.target.value as AutoRefereeConfiguration["method"] }))}><option value="CREW">Theo tổ trọng tài</option><option value="INDIVIDUAL">Theo từng cá nhân</option><option value="MIXED">Kết hợp tổ và cá nhân</option></select></label>
      <label>Vị trí cần xử lý<select value={configuration.onlyMissingSlots ? "MISSING" : "ALL"} onChange={(event) => setConfiguration((current) => ({ ...current, onlyMissingSlots: event.target.value === "MISSING" }))}><option value="MISSING">Chỉ vị trí còn thiếu</option><option value="ALL">Tối ưu lại vị trí chưa khóa trong phạm vi</option></select></label>
      <label>Trận trong phạm vi<select value={configuration.onlyUnassignedFixtures ? "UNASSIGNED" : "SCOPE"} onChange={(event) => setConfiguration((current) => ({ ...current, onlyUnassignedFixtures: event.target.value === "UNASSIGNED" }))}><option value="SCOPE">Tất cả trận phù hợp phạm vi</option><option value="UNASSIGNED">Chỉ trận chưa có phân công</option></select></label>
      <label>Giới hạn tính toán<select value={configuration.maxRuntimeMs} onChange={(event) => setConfiguration((current) => ({ ...current, maxRuntimeMs: Number(event.target.value) }))}><option value={500}>0,5 giây</option><option value={1500}>1,5 giây</option><option value={2500}>2,5 giây</option><option value={5000}>5 giây</option></select></label>
    </div>
    <div className="step5-auto-referee-scopes">
      <fieldset><legend>Vòng thi đấu · bỏ chọn hết để lấy mọi vòng</legend><div className="step5-referee-rounds">{rounds.map((round) => <label key={round}><input type="checkbox" checked={configuration.rounds.includes(round)} onChange={() => toggle("rounds", round)} />{round}</label>)}</div></fieldset>
      <fieldset><legend>Bảng / giai đoạn · bỏ chọn hết để lấy tất cả</legend><div className="step5-referee-rounds">{groups.map((group) => <label key={group}><input type="checkbox" checked={configuration.groups.includes(group)} onChange={() => toggle("groups", group)} />{group}</label>)}</div></fieldset>
      <fieldset><legend>Ngày thi đấu · bỏ chọn hết để lấy mọi ngày</legend><div className="step5-referee-rounds">{dates.map((date) => <label key={date}><input type="checkbox" checked={configuration.dates.includes(date)} onChange={() => toggle("dates", date)} />{new Date(`${date}T12:00:00`).toLocaleDateString("vi-VN")}</label>)}{!dates.length ? <small>Chưa có ngày lịch thi đấu.</small> : null}</div></fieldset>
    </div>
    <details className="step5-schedule-statistics"><summary>Mức độ ưu tiên mục tiêu · kéo thứ tự bằng nút lên/xuống</summary><ol className="step5-auto-objectives">{prioritizedObjectives.map((objective, index) => <li key={objective}><span>{index + 1}. {objectiveLabels[objective]}</span><button type="button" className="text-button" disabled={index === 0} onClick={() => moveObjective(index, -1)}>Lên</button><button type="button" className="text-button" disabled={index === prioritizedObjectives.length - 1} onClick={() => moveObjective(index, 1)}>Xuống</button></li>)}</ol></details>
    <div className="step5-auto-referee-actions"><button className="button button-primary" type="button" disabled={props.running || applying} onClick={() => void onGenerate()}>{props.running ? "Đang tìm phương án…" : "Tạo đề xuất phân công"}</button>{preview ? <button className="button button-secondary" type="button" disabled={applying || props.running} onClick={() => { setPreview(null); setApplyError(""); props.onCancel(); }}>Hủy đề xuất</button> : null}</div>
    {props.error ? <p className="form-error" role="alert">{props.error}</p> : null}
    {applyError ? <p className="form-error" role="alert">{applyError}</p> : null}
    {preview ? <section className="step5-auto-referee-results">
      <div className="panel-heading panel-heading-wrap"><div><span className={`status-pill ${preview.status === "COMPLETE" ? "status-success" : "status-warning"}`}>{preview.status === "COMPLETE" ? "Đề xuất đầy đủ" : preview.status === "TIMEOUT" ? "Hết giới hạn tìm kiếm" : preview.status === "NO_TARGETS" ? "Không có trận phù hợp" : "Đề xuất một phần"}</span><p>{preview.targetFixtureIds.length} trận trong phạm vi · {preview.changedFixtureIds.length} trận được đề xuất · {preview.elapsedMs} ms · {preview.exploredNodes.toLocaleString("vi-VN")} bước tìm kiếm</p></div><span>{preview.missing.length} vị trí còn thiếu</span></div>
      <div className="step5-demo-stats"><article><strong>{preview.targetFixtureIds.length}</strong><span>Trận trong phạm vi</span></article><article><strong>{preview.targetFixtureIds.length - new Set(preview.missing.map((item) => item.fixtureId)).size}</strong><span>Trận đủ vị trí sau đề xuất</span></article><article><strong>{new Set(preview.missing.map((item) => item.fixtureId)).size}</strong><span>Trận còn thiếu</span></article><article><strong>{Object.values(preview.proposedAssignmentsByFixture).flat().filter((row) => row.refereeId).length}</strong><span>Vị trí đã có phân công</span></article></div>
      {preview.missing.length ? <div className="step5-auto-referee-missing"><strong>Vị trí còn thiếu và nguyên nhân</strong>{preview.missing.slice(0, 24).map((item) => <p key={`${item.fixtureId}-${item.positionId}-${item.slotIndex}`}><b>{item.fixtureId} · {item.positionId} #{item.slotIndex + 1}:</b> {item.reason}</p>)}{preview.missing.length > 24 ? <small>Còn {preview.missing.length - 24} vị trí khác.</small> : null}</div> : null}
      <div className="step5-schedule-statistics-grid"><section><h4>Khối lượng trọng tài</h4>{preview.refereeWorkload.map((item) => <p key={item.refereeId}>{item.refereeName}: <b>{item.assignments}</b> trận</p>)}{!preview.refereeWorkload.length ? <p>Chưa có vị trí được phân công.</p> : null}</section><section><h4>Khối lượng tổ</h4>{preview.crewWorkload.map((item) => <p key={item.crewId}>{item.crewName}: <b>{item.assignments}</b> vị trí</p>)}{!preview.crewWorkload.length ? <p>Không có tổ trong đề xuất.</p> : null}</section><section><h4>Kiểm tra / cảnh báo</h4>{preview.warnings.map((item) => <p className="schedule-objective-warning" key={item}>{item}</p>)}{!preview.warnings.length ? <p>Không phát hiện cảnh báo bổ sung.</p> : null}</section></div>
      <div className="step5-auto-referee-actions"><button className="button button-primary" type="button" disabled={applying || props.running || preview.status === "NO_TARGETS" || !preview.changedFixtureIds.length} onClick={() => { setApplying(true); setApplyError(""); void props.onApply(preview, configuration).then((ok) => { if (ok) { setPreview(null); props.onCancel(); } else setApplyError("Dữ liệu lịch, nguồn lực hoặc bản nháp đã thay đổi. Hãy tạo lại đề xuất mới nhất."); }).finally(() => setApplying(false)); }}>Áp dụng vào bản phân công nháp</button><span>Áp dụng không công bố phân công. Vị trí khóa hoặc đã công bố luôn được giữ nguyên.</span></div>
    </section> : null}
  </section>;
}
