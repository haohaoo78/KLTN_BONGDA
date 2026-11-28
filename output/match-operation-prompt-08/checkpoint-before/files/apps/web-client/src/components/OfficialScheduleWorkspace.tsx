import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoScheduleResources } from "@sfl/shared";
import { buildScheduleSetupSuggestions, normalizeScheduleDecisionTiming } from "../../../../packages/shared/src/scheduleSetupAnalysis";
import {
  createTournamentVenue, getTournamentVenues, getDrawManagement,
  getOfficialSchedulingContext, requestOfficialScheduling, saveOfficialScheduleDraft,
  publishOfficialTournamentSchedules, saveTournamentScheduleResources, updateTournamentVenue,
  type OfficialSchedulingContext, type Tournament, type TournamentRules, type Venue,
} from "../api/competition";
import { DrawDemoScheduleWorkspace, type OfficialSchedulingBridge } from "./DrawDemoScheduleWorkspace";
import { emptyDemoStep5State, type DemoStep5State, type DrawTestState, type DemoPublishedAllocation, type ScheduleSettingProvenance } from "../utils/drawTestStorage";

type Props = {
  tournamentId: string; tournamentName: string;
  competitionFormat: NonNullable<Tournament["competitionFormat"]>; footballFormat: 5 | 7 | 11;
  startDate?: string | null; endDate?: string | null; regulation?: TournamentRules | null;
  teamNames: Map<string, string>; onNotice: (message: string) => void; onPublished?: () => void;
};
const defaultWeekdays = [0, 1, 2, 3, 4, 5, 6];
function defaultResources(startDate: string, endDate: string, rules: TournamentRules | null): DemoScheduleResources {
  const totalMinutes = rules?.matchDurationMinutes ?? 90;
  const halfMinutes = Math.max(1, Math.floor(totalMinutes / 2));
  const source: ScheduleSettingProvenance = {
    source: rules?.matchDurationMinutes ? "REGULATION" : "SYSTEM_PROPOSED",
    sourceLabel: rules?.matchDurationMinutes ? "Điều lệ hiện hành" : "Đề xuất hệ thống · cần BTC xác nhận",
    explanation: rules?.matchDurationMinutes ? `Thời lượng toàn trận ${totalMinutes} phút theo điều lệ.` : "Ước tính thời lượng trận; BTC cần xác nhận trước khi lập lịch.",
    confirmed: Boolean(rules?.matchDurationMinutes),
    adjustable: !rules?.matchDurationMinutes,
  };
  return {
    competitionStartDate: startDate.slice(0, 10), competitionEndDate: endDate.slice(0, 10),
    officialCompetitionStartDate: startDate.slice(0, 10), officialCompetitionEndDate: endDate.slice(0, 10),
    allowedWeekdays: defaultWeekdays, slots: [{ id: "REGULATION_WINDOW", label: "Khung giờ thi đấu", start: rules?.competitionConfig?.schedulingStartTime ?? "08:00", end: rules?.competitionConfig?.schedulingEndTime ?? "22:00" }],
    blockedDates: [],
    groupTiming: { halfMinutes, halftimeBreakMinutes: 15, preparationBeforeMinutes: 10, transitionAfterMinutes: 10, extraTimeReserveMinutes: 0, penaltyReserveMinutes: 0 },
    knockoutTiming: { halfMinutes, halftimeBreakMinutes: 15, preparationBeforeMinutes: 10, transitionAfterMinutes: 10, extraTimeReserveMinutes: rules?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES" ? rules.extraTimeMinutes ?? 0 : 0, penaltyReserveMinutes: rules?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES" || rules?.knockoutDecisionMethod === "PENALTIES_ONLY" ? 15 : 0 },
    minimumTeamRestMinutes: rules?.minimumRestMinutes ?? 120, maximumMatchesPerTeamPerDay: 1, travelBufferMinutes: 0,
    venues: [],
    locations: [], availabilityProfiles: [],
    setupProvenance: { "groupTiming.halfMinutes": source, "knockoutTiming.halfMinutes": source },
    setupRegulationVersion: rules?.publishedVersion ?? null,
    stageDateRanges: {},
    defaultObjectives: ["MINIMIZE_CHANGES", "REST", "FAIRNESS", "TRAVEL", "VENUE_USE", "COMPLETION"],
  };
}

/** Data controller only: all layout and interactions belong to the restored Step 5 workspace. */
export function OfficialScheduleWorkspace(props: Props) {
  const { tournamentId, tournamentName, competitionFormat, footballFormat, startDate, endDate, regulation, onNotice } = props;
  const [state, setState] = useState<DrawTestState | null>(null);
  const [error, setError] = useState("");
  const authority = useRef<OfficialSchedulingContext | null>(null);
  const stateRef = useRef<DrawTestState | null>(null);
  const venueRef = useRef<Venue[]>([]);
  const drawRef = useRef<Awaited<ReturnType<typeof getDrawManagement>> | null>(null);
  const committing = useRef(false);

  const projectContext = useCallback((context: OfficialSchedulingContext, extras?: DemoStep5State): DrawTestState => {
    const drawData = drawRef.current;
    const draw = [drawData?.latestVersion, ...(drawData?.history ?? [])].find((item) => item?.id === context.drawVersionId && item.status === "PUBLISHED");
    if (!draw) throw new Error("Không tìm thấy kết quả bốc thăm chính thức tương ứng với sơ đồ.");
    const groups = draw.groups.map((group) => [...group.assignments].sort((a, b) => a.position - b.position));
    const slots = groups.flatMap((group) => group.map((item) => item.teamId));
    const allocation: DemoPublishedAllocation = {
      method: draw.method === "MANUAL" ? "MANUAL" : "RANDOM", format: competitionFormat,
      teamIds: slots.filter((id): id is string => Boolean(id)), slots,
      teamsPerGroup: groups.map((group) => group.length), groupCount: groups.length,
      qualifiersPerGroup: context.rules?.advancingTeamsPerGroup ?? 0, extraQualificationSlots: 0,
      publishedAt: draw.publishedAt ?? draw.createdAt,
    };
    const protectedTimingStages = new Set(context.fixtures.filter((fixture) => {
      const entry = context.entries[fixture.id];
      return Boolean(context.schedulePublishedAt || entry?.locked || entry?.officialStatus === "PUBLISHED");
    }).map((fixture) => fixture.stage));
    const resources = normalizeScheduleDecisionTiming(context.tournamentContext,
      context.resources ?? buildScheduleSetupSuggestions(context.tournamentContext, defaultResources(context.startDate || startDate || "", context.endDate || endDate || "", context.rules ?? regulation ?? null)),
      protectedTimingStages);
    const step5: DemoStep5State = {
      ...emptyDemoStep5State(context.diagramVersion, resources), ...extras,
      diagramSnapshotKey: context.diagramVersion, resources,
      scheduleByFixture: context.entries,
      schedulePublishedAt: context.schedulePublishedAt,
      publishedScheduleByFixture: context.schedulePublishedAt ? context.entries : {},
      scheduleVersion: 1,
    };
    const next: DrawTestState = {
      version: 1, tournamentId, configuration: null, publication: allocation,
      fixtures: context.fixtures, fixturesPublishedAt: allocation.publishedAt,
      directSession: null, completedSteps: { step3: true, step4: true }, currentStep: 5,
      updatedAt: context.schedulePublishedAt ?? allocation.publishedAt, step5,
    };
    authority.current = context; stateRef.current = next; setState(next);
    return next;
  }, [tournamentId, competitionFormat, startDate, endDate, regulation]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [context, drawData, catalog] = await Promise.all([
        getOfficialSchedulingContext(tournamentId), getDrawManagement(tournamentId), getTournamentVenues(),
      ]);
      drawRef.current = drawData; venueRef.current = catalog.venues;
      projectContext(context);
    } catch (cause) { setState(null); setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu lập lịch chính thức."); }
  }, [tournamentId, projectContext]);
  useEffect(() => { void load(); }, [load]);

  const request = useCallback<OfficialSchedulingBridge["request"]>((action, input, signal) => {
    const context = authority.current;
    if (!context) return Promise.reject(new Error("Chưa tải dữ liệu lập lịch chính thức."));
    // Official APIs derive fixtures, rules and persisted resources on the server.
    // Only candidate entries and setup edits are sent for preview/validation.
    const { fixtures: _fixtures, tournamentId: _id, pitchType: _pitch, ...candidate } = input;
    return requestOfficialScheduling(tournamentId, action, { ...candidate, diagramVersion: context.diagramVersion }, signal);
  }, [tournamentId]);

  const commit = useCallback<OfficialSchedulingBridge["commit"]>(async (nextStep5) => {
    if (committing.current) throw new Error("Đang lưu thay đổi trước đó. Vui lòng chờ.");
    const current = authority.current;
    const previous = stateRef.current?.step5;
    if (!current || !previous) throw new Error("Chưa tải dữ liệu lập lịch chính thức.");
    if (current.schedulePublishedAt) throw new Error("Lịch đã công bố và chỉ được xem.");
    if (nextStep5.diagramSnapshotKey !== current.diagramVersion) throw new Error("Sơ đồ đã đổi phiên bản. Tải lại trước khi lưu.");
    const resourcesChanged = JSON.stringify(nextStep5.resources) !== JSON.stringify(previous.resources);
    const entriesChanged = JSON.stringify(nextStep5.scheduleByFixture) !== JSON.stringify(current.entries);
    if (!resourcesChanged && !entriesChanged) {
      const ephemeral = { ...stateRef.current!, step5: nextStep5 };
      stateRef.current = ephemeral; setState(ephemeral); return ephemeral;
    }
    committing.current = true;
    try {
      let draftBaseSignature = current.baseSignature;
      if (resourcesChanged && nextStep5.resources) {
        const configuredResources = nextStep5.resources;
        const catalog = [...venueRef.current];
        const idMap = new Map<string, string>();
        for (const configured of configuredResources.venues) {
          const existing = catalog.find((venue) => venue.id === configured.id);
          if (existing) {
            if (existing.name !== configured.name || existing.location !== configured.location) {
              const result = await updateTournamentVenue(existing.id, { name: configured.name, location: configured.location });
              catalog[catalog.findIndex((venue) => venue.id === existing.id)] = result.venue;
            }
            idMap.set(configured.id, existing.id);
          } else {
            const result = await createTournamentVenue({ name: configured.name.trim(), location: configured.location.trim() });
            catalog.push(result.venue); idMap.set(configured.id, result.venue.id);
          }
        }
        const normalized: DemoScheduleResources = { ...configuredResources, venues: configuredResources.venues.map((venue) => ({ ...venue, id: idMap.get(venue.id) ?? venue.id, code: idMap.get(venue.id) ?? venue.code })) };
        await saveTournamentScheduleResources(tournamentId, normalized, current.resourceRevision === 0 ? null : current.resourceRevision);
        venueRef.current = catalog;
        const refreshed = await getOfficialSchedulingContext(tournamentId);
        if (JSON.stringify(refreshed.entries) !== JSON.stringify(current.entries)) throw new Error("Lịch đã được thay đổi trong phiên khác. Cấu hình đã lưu; tải lại trước khi lưu lịch.");
        authority.current = refreshed;
        draftBaseSignature = refreshed.baseSignature;
      }
      if (entriesChanged) await saveOfficialScheduleDraft(tournamentId, { entries: nextStep5.scheduleByFixture, baseSignature: draftBaseSignature, diagramVersion: current.diagramVersion });
      return projectContext(await getOfficialSchedulingContext(tournamentId), nextStep5);
    } catch (cause) {
      // Keep the user's editor and surface the real server error; never replace with test data.
      throw cause;
    } finally { committing.current = false; }
  }, [tournamentId, projectContext]);

  const publish = useCallback<OfficialSchedulingBridge["publish"]>(async () => {
    await publishOfficialTournamentSchedules(tournamentId);
    const published = projectContext(await getOfficialSchedulingContext(tournamentId));
    props.onPublished?.();
    return published;
  }, [tournamentId, projectContext, props.onPublished]);

  if (error) return <section className="panel"><p className="form-error" role="alert">{error}</p><button className="button button-secondary" type="button" onClick={() => void load()}>Tải lại</button></section>;
  if (!state || !authority.current) return <section className="panel"><p>Đang tải lịch thi đấu từ Match Service…</p></section>;
  return <DrawDemoScheduleWorkspace mode="schedule" tournamentId={tournamentId} tournamentName={tournamentName}
    startDate={startDate} endDate={endDate} footballFormat={footballFormat} competitionFormat={competitionFormat}
    regulation={authority.current.rules ?? regulation} onNotice={onNotice}
    official={{ state, diagramVersion: authority.current.diagramVersion, request, commit, publish }} />;
}
