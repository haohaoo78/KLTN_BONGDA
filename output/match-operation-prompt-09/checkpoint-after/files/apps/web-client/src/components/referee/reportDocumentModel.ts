import type { MatchReport, MatchReportDraft } from "../../api/competition";
import type { RefereeMatchContext, RefereeTeamSide } from "../../api/refereePortal";
import { matchStageScores } from "../../../../../packages/shared/src/matchOutcome";

export type ReportSubmission = MatchReport["submissionSnapshots"][number];
export type ReportDocument = {
  historical: boolean;
  missing: string[];
  title: string;
  tournamentName: string;
  roundLabel: string;
  groupName: string | null;
  home: RefereeTeamSide;
  away: RefereeTeamSide;
  scheduledDate: string | null;
  actualStartedAt: string | null;
  actualEndedAt: string | null;
  venueName: string;
  venueLocation: string | null;
  submittedAt: string | null;
  fields: MatchReportDraft;
  halfTime: { home: number | null; away: number | null };
  result: ReportSubmission["result"];
  crew: NonNullable<NonNullable<ReportSubmission["context"]>["crew"]>;
  lineups: ReportSubmission["lineups"];
  events: ReportSubmission["events"];
  shootout: ReportSubmission["shootout"];
  relatedIssues: Array<{description:string;resolution?:string|null;resolvedAt?:string|null}>;
};

/** Historical records deliberately never read the current crew, events or lineups. */
export function reportDocumentFromSubmission(submission: ReportSubmission, index: number): ReportDocument {
  const frozen = submission.context;
  const missing: string[] = [];
  if (!frozen?.home || !frozen?.away || !frozen.tournament) missing.push("Tên đội và thông tin giải chưa được lưu trong bản lịch sử cũ.");
  if (!frozen?.crew) missing.push("Bản lịch sử cũ chưa lưu tổ trọng tài.");
  if (!submission.report) missing.push("Bản lịch sử cũ chưa lưu đầy đủ ghi chú và thông tin bổ sung của lần nộp.");
  const playerNames = frozen?.playerNames ?? {};
  const lineups = (submission.lineups ?? []).map((player) => ({ ...player, fullName: player.fullName ?? playerNames[player.playerId] ?? null }));
  const events = (submission.events ?? []).map((event) => ({ ...event, playerName: event.playerName ?? (event.playerId ? playerNames[event.playerId] : null) ?? null }));
  if (lineups.some((player) => !player.fullName)) missing.push("Một số tên cầu thủ chưa được lưu trong bản lịch sử cũ; không thay bằng hồ sơ hiện tại.");
  return {
    historical: true, missing, title: `Biên bản · lần nộp ${index + 1}${submission.version ? ` · phiên bản ${submission.version}` : ""}`,
    tournamentName: frozen?.tournament?.name ?? "Thông tin giải chưa được lưu trong bản lịch sử",
    roundLabel: frozen?.roundLabel ?? "Vòng đấu chưa được lưu", groupName: frozen?.groupName ?? null,
    home: frozen?.home ?? { id: null, name: "Đội nhà · bản cũ chưa lưu tên", logoUrl: null },
    away: frozen?.away ?? { id: null, name: "Đội khách · bản cũ chưa lưu tên", logoUrl: null },
    scheduledDate: frozen?.schedule?.scheduledDate ?? null,
    actualStartedAt: submission.clock?.actualStartedAt ?? null, actualEndedAt: submission.clock?.actualEndedAt ?? null,
    venueName: frozen?.venueName ?? "Sân chưa được lưu trong bản lịch sử", venueLocation: frozen?.venueLocation ?? null,
    submittedAt: submission.submittedAt, fields: submission.report ?? {},
    halfTime: { home: submission.report?.homeScoreAtHalfTime ?? null, away: submission.report?.awayScoreAtHalfTime ?? null },
    result: submission.result, crew: frozen?.crew ?? [], lineups, events, shootout: submission.shootout,
    relatedIssues:frozen?.preparation?.issues??[],
  };
}

export function reportDocumentFromCurrent(context: RefereeMatchContext, fields: MatchReportDraft): ReportDocument {
  const scores = matchStageScores(context.events, context.home.id, context.away.id);
  const half = matchStageScores(context.events.filter((event) => event.phase === "FIRST_HALF"), context.home.id, context.away.id);
  const hasExtraTime = context.events.some((event) => event.phase?.startsWith("EXTRA_TIME")) || context.clock.phase.startsWith("EXTRA_TIME") || context.result?.homeExtraTimeScore != null;
  return {
    historical: false, missing: [], title: "Xem trước biên bản", tournamentName: context.tournament.name, roundLabel: context.roundLabel, groupName: context.groupName,
    home: context.home, away: context.away, scheduledDate: context.schedule.scheduledDate,
    actualStartedAt: context.clock.actualStartedAt ?? null, actualEndedAt: context.clock.actualEndedAt ?? null,
    venueName: context.venueName, venueLocation: context.venueLocation, submittedAt: null, fields,
    halfTime: { home: scores.unknownPhase?null:half.regulation.home, away: scores.unknownPhase?null:half.regulation.away },
    result: context.result ?? { homeScore: scores.regulation.home, awayScore: scores.regulation.away, homeExtraTimeScore: hasExtraTime ? scores.extraTime.home : null, awayExtraTimeScore: hasExtraTime ? scores.extraTime.away : null, homePenaltyScore: null, awayPenaltyScore: null },
    crew: context.crew, lineups: context.lineups, events: context.events, shootout: context.shootout?.current,
    relatedIssues:context.preparation?.issues??[],
  };
}

export function canPrepareReport(context: RefereeMatchContext): boolean {
  return context.match.status === "FINISHED" && context.assignment.capabilities.includes("MANAGE_REPORT")
    && (!context.report || ["DRAFT", "REVISION_REQUIRED"].includes(context.report.status));
}

export function canConfirmReport(context: RefereeMatchContext): boolean {
  return context.match.status === "FINISHED" && context.assignment.isFinalAuthority
    && context.assignment.capabilities.includes("FINALIZE") && context.report?.status === "PENDING"
    && context.report.requiresOrganizerReview === false;
}
