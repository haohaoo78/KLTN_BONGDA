import { useCallback, useEffect, useRef, useState } from "react";
import { generateHybridPlayoffs, generateTournamentFixtures, getManagedTournamentFixtures, publishTournamentFixtureStructure,
  getHybridLotDrawHistory, getDrawManagement, getManagedMatchResult, getFixtureGroupStandings, validateTournamentFixtures,
  type DrawCandidate, type DrawVersion, type MatchResult, type HybridLotDrawAudit, type HybridLotDrawResolution, type Match,
} from "../api/competition";
import { ApiError } from "../api/client";
import { Modal } from "./Modal";
import { useDialog } from "./DialogProvider";
import { DrawDemoFixtureWorkspace, type OfficialFixtureData } from "./DrawDemoFixtureWorkspace";
import type { DemoPublishedAllocation, DemoFixture, DrawTestState } from "../utils/drawTestStorage";

type FixtureTournament = { id: string; name: string; status: string; competitionFormat?: "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT";
  rules?: { roundRobinLegs?: 1 | 2; advancingTeamsPerGroup?: number; competitionConfig?: { thirdPlaceMatch?: boolean } } | null };
type Props = { tournaments: FixtureTournament[]; teamNames: Map<string, string>; onNotice: (message: string) => void; onContinue?: () => void | Promise<void>; onOpenPublicView?: () => void };
type PendingLotDraw = HybridLotDrawResolution & { witnessed: boolean };

// Share preparation during overlapping loads (including React StrictMode).
// Match Service also serializes generation and preserves existing match IDs.
const fixturePreparations = new Map<string, ReturnType<typeof generateTournamentFixtures>>();

/** Data controller only. The restored workspace owns every Step 4 diagram and interaction. */
export function FixtureDiagramPanel({ tournaments, teamNames, onNotice, onContinue }: Props) {
  const { confirm } = useDialog();
  const tournamentId = tournaments[0]?.id ?? "";
  const tournament = tournaments.find((item) => item.id === tournamentId);
  const [drawVersion, setDrawVersion] = useState<DrawVersion | null>(null);
  const [drawTeams, setDrawTeams] = useState<DrawCandidate[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [fixtureStages, setFixtureStages] = useState<Awaited<ReturnType<typeof getManagedTournamentFixtures>>["stages"]>([]);
  const [bracket, setBracket] = useState<Awaited<ReturnType<typeof getManagedTournamentFixtures>>["bracket"]>([]);
  const [officialResults, setOfficialResults] = useState<Record<string, MatchResult>>({});
  const [tables, setTables] = useState<Awaited<ReturnType<typeof getFixtureGroupStandings>>["groups"]>([]);
  const [groupNames, setGroupNames] = useState<Map<string, string>>(new Map());
  const [lotDrawHistory, setLotDrawHistory] = useState<HybridLotDrawAudit[]>([]);
  const [lotDrawResolutions, setLotDrawResolutions] = useState<HybridLotDrawResolution[]>([]);
  const [pendingLotDraw, setPendingLotDraw] = useState<PendingLotDraw | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagramCheck, setDiagramCheck] = useState<{ valid: boolean; messages: string[] } | null>(null);
  const loadSequence = useRef(0);
  const pinned = drawVersion?.config.fixtureRegulationSnapshot as { competitionFormat?: FixtureTournament["competitionFormat"]; rules?: FixtureTournament["rules"] } | undefined;
  const format = pinned?.competitionFormat ?? tournament?.competitionFormat ?? "ROUND_ROBIN";
  const rules = pinned?.rules ?? tournament?.rules;
  const isHybrid = format === "GROUP_AND_KNOCKOUT";
  const regulationLegs = rules?.roundRobinLegs ?? 1;
  const load = useCallback(async () => {
    if (!tournamentId) return;
    const sequence = ++loadSequence.current;
    setLoading(true); setError(null); setDiagramCheck(null);
    try {
      let [bundle, draw] = await Promise.all([getManagedTournamentFixtures(tournamentId), getDrawManagement(tournamentId)]);
      if (sequence !== loadSequence.current) return;
      const published = draw.latestVersion?.status === "PUBLISHED" ? draw.latestVersion : draw.history.find((version) => version.status === "PUBLISHED") ?? null;
      let stages = bundle.stages.filter((stage) => stage.drawVersionId === published?.id);
      let currentMatches = stages.flatMap((stage) => stage.matches);
      setDrawVersion(published); setDrawTeams([...draw.eligibleTeams, ...draw.ineligibleTeams]); setFixtureStages(stages); setMatches(currentMatches);
      // Managed bundle is already scoped to its active draw by Match Service.
      setBracket(bundle.bracket); setGroupNames(new Map((published?.groups ?? []).map((group) => [group.id, group.name])));
      if (published && tournament && ["ROSTER_LOCKED", "PREPARING"].includes(tournament.status)) {
        const snapshot = published.config.fixtureRegulationSnapshot as { competitionFormat?: FixtureTournament["competitionFormat"]; rules?: FixtureTournament["rules"] } | undefined;
        const publishedFormat = snapshot?.competitionFormat ?? tournament.competitionFormat ?? "ROUND_ROBIN";
        const required = publishedFormat === "ROUND_ROBIN" ? ["GROUP"] : publishedFormat === "KNOCKOUT" ? ["KNOCKOUT"] : ["GROUP", "KNOCKOUT"];
        if (required.some((stage) => !stages.some((item) => item.stage === stage)) && !stages.some((stage) => stage.status === "PUBLISHED")) {
          const key = `${tournamentId}:${published.id}`;
          let preparation = fixturePreparations.get(key);
          if (!preparation) {
            const legs = publishedFormat === "KNOCKOUT" ? 1 : snapshot?.rules?.roundRobinLegs ?? tournament.rules?.roundRobinLegs ?? 1;
            preparation = generateTournamentFixtures(tournamentId, legs);
            fixturePreparations.set(key, preparation);
          }
          try { await preparation; }
          finally { if (fixturePreparations.get(key) === preparation) fixturePreparations.delete(key); }
          if (sequence !== loadSequence.current) return;
          bundle = await getManagedTournamentFixtures(tournamentId);
          if (sequence !== loadSequence.current) return;
          stages = bundle.stages.filter((stage) => stage.drawVersionId === published.id);
          currentMatches = stages.flatMap((stage) => stage.matches);
          setFixtureStages(stages); setMatches(currentMatches); setBracket(bundle.bracket);
          if (required.some((stage) => !stages.some((item) => item.stage === stage))) {
            throw new Error("Sơ đồ chưa có đủ các giai đoạn theo điều lệ. Vui lòng tải lại dữ liệu để thử lại.");
          }
        }
      }
      if (published) {
        const [standings, history] = await Promise.all([getFixtureGroupStandings(tournamentId), getHybridLotDrawHistory(tournamentId)]);
        if (sequence !== loadSequence.current) return;
        setTables(standings.groups); setLotDrawHistory(history.lotDraws);
      } else { setTables([]); setLotDrawHistory([]); }
      const results: Array<[string, MatchResult]> = [];
      const completed = currentMatches.filter((match) => ["VERIFIED", "LOCKED"].includes(match.status));
      for (let index = 0; index < completed.length; index += 12) {
        const batch = await Promise.all(completed.slice(index, index + 12).map(async (match) => {
          const { result } = await getManagedMatchResult(match.id);
          return result?.status === "APPROVED" ? [match.id, result] as [string, MatchResult] : null;
        }));
        results.push(...batch.filter((item): item is [string, MatchResult] => item !== null));
      }
      if (sequence === loadSequence.current) setOfficialResults(Object.fromEntries(results));
    } catch (failure) { if (sequence === loadSequence.current) setError(failure instanceof Error ? failure.message : "Không tải hoặc chuẩn bị được sơ đồ chính thức."); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [tournamentId, tournament?.status, tournament?.competitionFormat, tournament?.rules?.roundRobinLegs]);
  useEffect(() => { void load(); return () => { loadSequence.current += 1; }; }, [load]);

  const requiredStages = format === "ROUND_ROBIN" ? ["GROUP"] : isHybrid ? ["GROUP", "KNOCKOUT"] : ["KNOCKOUT"];
  const hasPublishedFixtures = requiredStages.every((stage) => fixtureStages.some((item) => item.stage === stage && item.status === "PUBLISHED"));
  const canGenerate = Boolean(drawVersion && tournament && ["ROSTER_LOCKED", "PREPARING"].includes(tournament.status) && !hasPublishedFixtures);
  async function generate() {
    if (!canGenerate || submitting) return;
    setSubmitting(true); setError(null); setDiagramCheck(null);
    try {
      const result = await generateTournamentFixtures(tournamentId, format === "KNOCKOUT" ? 1 : regulationLegs);
      await load();
      onNotice(result.alreadyGenerated ? "Đã đọc lại bản nháp đã lưu; giữ nguyên các mã trận." : "Đã sinh và lưu bản nháp sơ đồ vào Match Service.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Không sinh được sơ đồ."); }
    finally { setSubmitting(false); }
  }
  async function checkDiagram() {
    setSubmitting(true); setError(null);
    try { const result = await validateTournamentFixtures(tournamentId); setDiagramCheck({ valid: result.valid, messages: [result.message] }); return result.valid; }
    catch (failure) { const message = failure instanceof Error ? failure.message : "Không kiểm tra được sơ đồ."; setDiagramCheck({ valid: false, messages: [message] }); return false; }
    finally { setSubmitting(false); }
  }
  async function publishStructure() {
    if (submitting || hasPublishedFixtures || !matches.length) return;
    if (!await confirm({ title: "Xác nhận & công bố sơ đồ thi đấu?", description: "Công bố cấu trúc và danh sách trận chính thức từ kết quả Bước 3. Ngày, giờ và sân được thiết lập ở Bước 5.", confirmLabel: "Xác nhận & công bố" })) return;
    setSubmitting(true); setError(null);
    try {
      await publishTournamentFixtureStructure(tournamentId);
      await load();
      onNotice("Đã công bố sơ đồ và danh sách trận chính thức. Có thể chuyển đến Bước 5.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Không thể công bố sơ đồ."); }
    finally { setSubmitting(false); }
  }
  async function generatePlayoffs(resolutions = lotDrawResolutions) {
    if (!tournament || !isHybrid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await generateHybridPlayoffs(tournament.id, resolutions);
      const [fixtureResult, history] = await Promise.all([
        getManagedTournamentFixtures(tournament.id), getHybridLotDrawHistory(tournament.id),
      ]);
      const currentStages = fixtureResult.stages.filter((stage) => stage.drawVersionId === result.drawVersionId);
      setFixtureStages(currentStages);
      setMatches(currentStages.flatMap((stage) => stage.matches));
      setBracket(fixtureResult.bracket);
      setLotDrawHistory(history.lotDraws);
      setLotDrawResolutions([]);
      setPendingLotDraw(null);
      onNotice(result.alreadyGenerated
        ? `Nhánh playoff đã có sẵn gồm ${result.matches.length} trận; hệ thống giữ nguyên mã trận.`
        : `Đã xác nhận ${result.qualifications.length} đội đi tiếp và sinh nhánh playoff gồm ${result.matches.length} trận.`);
    } catch (playoffError) {
      if (playoffError instanceof ApiError && playoffError.code === "GROUP_LOT_DRAW_REQUIRED") {
        const groupId = playoffError.details?.groupId;
        const teamIds = playoffError.details?.tiedTeamIds;
        if (typeof groupId === "string" && Array.isArray(teamIds) && teamIds.every((id) => typeof id === "string")) {
          const tiedTeamIds = teamIds as string[];
          const existing = resolutions.find((item) => item.groupId === groupId
            && item.tiedTeamIds.length === tiedTeamIds.length
            && item.tiedTeamIds.every((id) => tiedTeamIds.includes(id)));
          setPendingLotDraw({
            groupId,
            tiedTeamIds,
            drawnOrder: existing?.drawnOrder ?? tiedTeamIds,
            witnessName: existing?.witnessName ?? "",
            reason: existing?.reason ?? "",
            witnessed: false,
          });
          return;
        }
      }
      setError(playoffError instanceof Error ? playoffError.message : "Chưa thể sinh nhánh playoff.");
    } finally {
      setSubmitting(false);
    }
  }


  function moveLotDrawTeam(teamId: string, direction: -1 | 1) {
    setPendingLotDraw((current) => {
      if (!current) return current;
      const from = current.drawnOrder.indexOf(teamId);
      const to = from + direction;
      if (to < 0 || to >= current.drawnOrder.length) return current;
      const drawnOrder = [...current.drawnOrder];
      [drawnOrder[from], drawnOrder[to]] = [drawnOrder[to], drawnOrder[from]];
      return { ...current, drawnOrder };
    });
  }

  function confirmLotDraw() {
    if (!pendingLotDraw || !pendingLotDraw.witnessed || pendingLotDraw.witnessName.trim().length < 2 || pendingLotDraw.reason.trim().length < 10) return;
    const { witnessed: _witnessed, ...resolution } = pendingLotDraw;
    const next = [...lotDrawResolutions.filter((item) => item.groupId !== resolution.groupId), resolution];
    setLotDrawResolutions(next);
    setPendingLotDraw(null);
    void generatePlayoffs(next);
  }

  const officialFixtureViewState: DrawTestState | null = drawVersion ? (() => {
    const orderedGroups = drawVersion.groups.map((group) => [...group.assignments].sort((a, b) => a.position - b.position));
    const teamIds = orderedGroups.flatMap((group) => group.map((assignment) => assignment.teamId));
    const slots = format === "KNOCKOUT" ? Array.from({ length: 2 ** Math.ceil(Math.log2(Math.max(2, teamIds.length))) }, (_, index) => orderedGroups[0]?.find((assignment) => assignment.position === index + 1)?.teamId ?? null) : teamIds;
    const slotByMatch = new Map(bracket.filter((slot) => slot.matchId).map((slot) => [slot.matchId!, slot]));
    const slotById = new Map(bracket.map((slot) => [slot.id, slot]));
    const maxRound = Math.max(1, ...bracket.map((slot) => slot.roundNumber));
    const label = (round: number) => round === maxRound ? "Chung kết" : round === maxRound - 1 ? "Bán kết" : round === maxRound - 2 ? "Tứ kết" : `Vòng ${2 ** (maxRound - round + 1)}`;
    const source = (slot: typeof bracket[number] | undefined, side: "home" | "away") => {
      const qualification = side === "home" ? slot?.homeQualification : slot?.awayQualification;
      if (qualification) return `${qualification.groupRank === 1 ? "Nhất" : qualification.groupRank === 2 ? "Nhì" : "Hạng " + qualification.groupRank} ${groupNames.get(qualification.groupId) ?? "bảng"}`;
      const parentId = side === "home" ? slot?.homeSourceSlotId : slot?.awaySourceSlotId;
      const parent = parentId ? slotById.get(parentId) : undefined;
      return parent ? `${(side === "home" ? slot?.homeSourceOutcome : slot?.awaySourceOutcome) === "LOSER" ? "Thua" : "Thắng"} trận ${(parent.matchId ?? parent.id).slice(0, 8).toUpperCase()}` : undefined;
    };
    const fixtures: DemoFixture[] = matches.map((match) => {
      const slot = slotByMatch.get(match.id);
      return { id: match.id, stage: match.stage ?? "GROUP", groupName: match.groupId ? groupNames.get(match.groupId) : undefined,
        round: slot ? slot.slotType === "THIRD_PLACE" ? "Tranh hạng ba" : label(slot.roundNumber) : `Vòng ${match.roundNumber ?? 1}`, roundNumber: match.roundNumber ?? 1,
        leg: match.leg ?? 1, homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId, homeSource: source(slot, "home"), awaySource: source(slot, "away") };
    });
    for (const slot of bracket.filter((slot) => !slot.matchId)) fixtures.push({ id: slot.id, stage: "KNOCKOUT", round: label(slot.roundNumber), roundNumber: slot.roundNumber,
      homeTeamId: slot.homeTeamId, awayTeamId: slot.awayTeamId, homeSource: source(slot, "home") ?? (slot.homeQualification ? undefined : "BYE"), awaySource: source(slot, "away") ?? (slot.awayQualification ? undefined : "BYE"), bye: true });
    const allocation: DemoPublishedAllocation = { method: drawVersion.method === "MANUAL" ? "MANUAL" : "RANDOM", format, teamIds, slots,
      teamsPerGroup: format === "KNOCKOUT" ? [slots.length] : orderedGroups.map((group) => group.length), groupCount: orderedGroups.length,
      qualifiersPerGroup: rules?.advancingTeamsPerGroup ?? 0, extraQualificationSlots: 0, publishedAt: drawVersion.publishedAt ?? drawVersion.createdAt };
    const publishedAt = hasPublishedFixtures ? fixtureStages.map((stage) => stage.publishedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null : null;
    return { version: 1, tournamentId, configuration: null, publication: allocation, fixtures, fixturesPublishedAt: publishedAt,
      directSession: null, completedSteps: { step3: true, step4: hasPublishedFixtures }, currentStep: 5, updatedAt: publishedAt ?? drawVersion.createdAt };
  })() : null;
  const details: OfficialFixtureData["details"] = {};
  for (const match of matches) details[match.id] = { status: match.status, result: officialResults[match.id] };
  for (const slot of bracket) details[slot.matchId ?? slot.id] = { ...details[slot.matchId ?? slot.id], position: slot.position,
    homeSourceId: bracket.find((parent) => parent.id === slot.homeSourceSlotId)?.matchId ?? slot.homeSourceSlotId ?? undefined,
    awaySourceId: bracket.find((parent) => parent.id === slot.awaySourceSlotId)?.matchId ?? slot.awaySourceSlotId ?? undefined,
    status: slot.matchStatus ?? (slot.status === "BYE" || !slot.matchId ? "BYE" : "UNSCHEDULED") };
  const qualifiers: OfficialFixtureData["qualifiers"] = {};
  for (const slot of bracket) for (const side of ["home", "away"] as const) {
    const source = side === "home" ? slot.homeQualification : slot.awayQualification;
    const teamId = side === "home" ? slot.homeTeamId : slot.awayTeamId;
    if (source && teamId) (qualifiers[groupNames.get(source.groupId) ?? ""] ??= {})[source.groupRank] = teamId;
  }
  const championSlot = bracket.find((slot) => slot.slotType === "STANDARD" && slot.roundNumber === Math.max(...bracket.map((item) => item.roundNumber)));
  const officialData: OfficialFixtureData = { busy: loading || submitting, error, check: diagramCheck, legs: regulationLegs, matchCount: matches.length, details, qualifiers,
    standings: Object.fromEntries(tables.map((group) => [group.name, group.standings])), canGenerate,
    championTeamId: championSlot?.matchId && officialResults[championSlot.matchId] ? championSlot.winnerTeamId ?? undefined : undefined,
    canQualify: isHybrid && tables.length > 0 && tables.every((group) => group.complete) && !Object.keys(qualifiers).length,
    onGenerate: generate, onCheck: checkDiagram, onPublish: publishStructure, onRefresh: load, onContinue, onQualify: () => generatePlayoffs() };
  return <>
    {officialFixtureViewState ? <DrawDemoFixtureWorkspace tournamentId={tournamentId} tournamentName={tournament?.name ?? "Giải đấu"} readOnly officialMode publishedState={officialFixtureViewState} teams={drawTeams} officialData={officialData} /> : <section className="panel workflow-phase-panel"><h2>Bước 4 · Sơ đồ thi đấu</h2><p>{loading ? "Đang tải kết quả Bước 3…" : error ?? "Bước 4 đang khóa. Cần công bố kết quả Bước 3."}</p></section>}
    {isHybrid && lotDrawHistory.length ? <section className="draw-history lot-draw-history"><h3>Biên bản phân hạng</h3>{lotDrawHistory.map((audit, index) => <article key={index} className="draw-history-row"><strong>{groupNames.get(audit.groupId)}</strong><span>{new Date(audit.drawnAt).toLocaleString("vi-VN")}</span><span>Người chứng kiến: {audit.witnessName}</span><span>{audit.drawnOrder.map((id) => teamNames.get(id) ?? id).join(" → ")}</span><small>{audit.reason}</small></article>)}</section> : null}
    <Modal open={pendingLotDraw !== null} title="Ghi nhận bốc thăm phân hạng" description="Chỉ ghi nhận kết quả bốc thăm đã thực hiện công khai theo điều lệ. Thứ tự và người chứng kiến được lưu vào biên bản." onClose={() => setPendingLotDraw(null)} className="lot-draw-modal">
      {pendingLotDraw ? <div className="form-grid">
        <div className="field full-width"><span>Nhóm đội còn hòa · {groupNames.get(pendingLotDraw.groupId) ?? "Bảng"}</span><p className="muted">Sắp đúng thứ tự đã bốc; đội ở trên được xếp hạng cao hơn.</p></div>
        <ol className="lot-draw-order-list">{pendingLotDraw.drawnOrder.map((id, index) => <li key={id}><span><strong>{index + 1}.</strong> {teamNames.get(id) ?? id}</span><span className="button-row"><button type="button" className="secondary-button" aria-label="Đưa lên" disabled={index === 0} onClick={() => moveLotDrawTeam(id, -1)}>↑</button><button type="button" className="secondary-button" aria-label="Đưa xuống" disabled={index === pendingLotDraw.drawnOrder.length - 1} onClick={() => moveLotDrawTeam(id, 1)}>↓</button></span></li>)}</ol>
        <label className="field full-width"><span>Người chứng kiến *</span><input value={pendingLotDraw.witnessName} maxLength={120} onChange={(event) => setPendingLotDraw((current) => current ? { ...current, witnessName: event.target.value } : current)} /></label>
        <label className="field full-width"><span>Biên bản / căn cứ bốc thăm *</span><textarea value={pendingLotDraw.reason} maxLength={1000} rows={3} onChange={(event) => setPendingLotDraw((current) => current ? { ...current, reason: event.target.value } : current)} /></label>
        <label className="field full-width lot-draw-attestation"><input type="checkbox" checked={pendingLotDraw.witnessed} onChange={(event) => setPendingLotDraw((current) => current ? { ...current, witnessed: event.target.checked } : current)} /><span>Tôi xác nhận đây là kết quả bốc thăm công khai, có người chứng kiến.</span></label>
        <div className="modal-actions full-width"><button type="button" className="secondary-button" onClick={() => setPendingLotDraw(null)}>Hủy</button><button type="button" className="primary-button" disabled={submitting || !pendingLotDraw.witnessed || pendingLotDraw.witnessName.trim().length < 2 || pendingLotDraw.reason.trim().length < 10} onClick={confirmLotDraw}>Lưu biên bản và tiếp tục</button></div>
      </div> : null}
    </Modal>

  </>;
}
