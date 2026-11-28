import type {
  Tournament,
  TournamentCreateInput,
  TournamentUpdateInput,
  RegistrationPeriod,
  RegistrationPeriodCreateInput,
  Regulation,
  RegulationCreateInput,
  RegulationUpdateInput,
  TournamentStatus,
  TournamentScope,
  FootballFormat,
  CompetitionFormat,
  RankingCriterion,
  TournamentRules,
  InstitutionLevel,
  InstitutionTeamLimit,
} from "../models/tournament";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";
import { canWithdrawRegistrationBeforeDraw, removeTeamFromRosterSnapshot } from "../services/rosterWithdrawal";

function mapTournament(row: {
  id: string;
  name: string;
  description: string | null;
  status: string;
  location: string | null;
  organizer_name: string | null;
  organizer_contact_name: string | null;
  organizer_email: string | null;
  organizer_phone: string | null;
  scope: TournamentScope;
  football_format: FootballFormat;
  competition_format: CompetitionFormat;
  min_teams: number;
  max_teams: number;
  min_players: number;
  max_players_per_team: number;
  min_goalkeepers: number;
  start_date: string | null;
  end_date: string | null;
  organizing_institution_id?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  registration_periods?: RegistrationPeriod[];
  allowed_institution_ids?: string[];
  allowed_institution_levels?: InstitutionLevel[];
  all_institutions_allowed?: boolean;
  default_max_teams_per_institution?: number | null;
  institution_team_limits?: InstitutionTeamLimit[];
  ranking_criteria?: RankingCriterion[];
  rules?: TournamentRules | null;
}): Tournament {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as TournamentStatus,
    location: row.location,
    organizerName: row.organizer_name,
    organizerContactName: row.organizer_contact_name,
    organizerEmail: row.organizer_email,
    organizerPhone: row.organizer_phone,
    scope: row.scope,
    footballFormat: row.football_format,
    competitionFormat: row.competition_format,
    minTeams: row.min_teams,
    maxTeams: row.max_teams,
    minPlayers: row.min_players,
    maxPlayersPerTeam: row.max_players_per_team,
    minGoalkeepers: row.min_goalkeepers ?? 1,
    startDate: row.start_date,
    endDate: row.end_date,
    organizingInstitutionId: row.organizing_institution_id ?? null,
    ...(row.registration_periods ? { registrationPeriods: row.registration_periods } : {}),
    ...(row.allowed_institution_ids ? { allowedInstitutionIds: row.allowed_institution_ids } : {}),
    ...(row.allowed_institution_levels
      ? { allowedInstitutionLevels: row.allowed_institution_levels }
      : {}),
    ...(row.all_institutions_allowed !== undefined
      ? { allInstitutionsAllowed: row.all_institutions_allowed }
      : {}),
    ...(row.default_max_teams_per_institution !== undefined
      ? { defaultMaxTeamsPerInstitution: row.default_max_teams_per_institution }
      : {}),
    ...(row.institution_team_limits
      ? { institutionTeamLimits: row.institution_team_limits }
      : {}),
    ...(row.ranking_criteria ? { rankingCriteria: row.ranking_criteria } : {}),
    ...(row.rules !== undefined ? { rules: row.rules } : {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findTournamentById(
  id: string,
): Promise<Tournament | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT t.id, t.name, t.description, t.status, t.location, t.organizer_name,
            t.organizer_contact_name, t.organizer_email, t.organizer_phone, t.scope,
            t.football_format, t.competition_format, t.min_teams, t.max_teams,
            t.min_players, t.max_players_per_team, t.min_goalkeepers, t.start_date, t.end_date,
            t.organizing_institution_id,
            t.created_by, t.created_at, t.updated_at,
            t.allowed_institution_levels, t.all_institutions_allowed,
            t.default_max_teams_per_institution,
            COALESCE((
              SELECT json_agg(json_build_object(
                'id', rp.id, 'tournamentId', rp.tournament_id, 'name', rp.name,
                'startDate', rp.start_date, 'endDate', rp.end_date, 'createdAt', rp.created_at
              ) ORDER BY rp.start_date)
              FROM registration_periods rp WHERE rp.tournament_id = t.id
            ), '[]'::json) AS registration_periods,
            COALESCE((
              SELECT array_agg(ai.institution_id::text ORDER BY ai.institution_id)
              FROM tournament_allowed_institutions ai WHERE ai.tournament_id = t.id
            ), ARRAY[]::text[]) AS allowed_institution_ids,
            COALESCE((
              SELECT json_agg(json_build_object(
                'institutionId', il.institution_id, 'maxTeams', il.max_teams
              ) ORDER BY il.institution_id)
              FROM tournament_institution_limits il WHERE il.tournament_id = t.id
            ), '[]'::json) AS institution_team_limits,
            COALESCE((
              SELECT array_agg(rc.criterion ORDER BY rc.priority)
              FROM tournament_ranking_criteria rc WHERE rc.tournament_id = t.id
            ), ARRAY[]::varchar[]) AS ranking_criteria,
            (
              SELECT json_build_object(
                'eligibilityDescription', rules.eligibility_description,
                'pointsForWin', rules.points_for_win, 'pointsForDraw', rules.points_for_draw,
                'pointsForLoss', rules.points_for_loss,
                'advancingTeamsPerGroup', rules.advancing_teams_per_group,
                'roundRobinLegs', rules.round_robin_legs,
                'maxTeamsPerGroup', rules.max_teams_per_group,
                'knockoutDecisionMethod', rules.knockout_decision_method,
                'extraTimeMinutes', rules.extra_time_minutes,
                'plannedPitchCount', rules.planned_pitch_count,
                'playableHoursPerDay', rules.playable_hours_per_day,
                'yellowCardsForSuspension', rules.yellow_cards_for_suspension,
                'suspensionMatches', rules.suspension_matches,
                'complaintWindowHours', rules.complaint_window_hours,
                'minimumRestMinutes', rules.minimum_rest_minutes,
                'matchDurationMinutes', rules.match_duration_minutes,
                'forfeitPolicy', rules.forfeit_policy,
                'forfeitWinnerScore', rules.forfeit_winner_score,
                'forfeitLoserScore', rules.forfeit_loser_score,
                'competitionConfig', rules.competition_config,
                'publishedVersion', rules.published_version,
                'publishedAt', rules.published_at
              )
              FROM tournament_rules rules WHERE rules.tournament_id = t.id
            ) AS rules
     FROM tournaments t
     WHERE t.id = $1`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapTournament(result.rows[0]);
}

/** Persist expired registration windows even when BTC is not viewing the tournament. */
export async function closeExpiredTournamentRegistrations(): Promise<number> {
  await getPool().query(
    `UPDATE tournament_player_participation_claims claim
     SET state='RELEASED',released_at=NOW(),updated_at=NOW()
     FROM tournaments tournament
     WHERE tournament.id=claim.tournament_id AND claim.state='ACTIVE'
       AND tournament.end_date < CURRENT_DATE`,
  );
  const result = await getPool().query(
    `UPDATE tournaments t
     SET status='REGISTRATION_CLOSED', updated_at=NOW()
     WHERE t.status='OPEN_REGISTRATION'
       AND EXISTS (SELECT 1 FROM registration_periods rp WHERE rp.tournament_id=t.id)
       AND NOT EXISTS (
         SELECT 1 FROM registration_periods rp
         WHERE rp.tournament_id=t.id AND rp.end_date > NOW()
       )
     RETURNING t.id`,
  );
  return result.rowCount ?? 0;
}

export async function setManualRegistrationStatus(input: {
  tournamentId: string;
  actorId: string;
  action: "TEST_CLOSE" | "TEST_REOPEN";
}): Promise<Tournament> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [input.tournamentId]);
    const current = await client.query<{ status: TournamentStatus }>(
      "SELECT status FROM tournaments WHERE id=$1 FOR UPDATE", [input.tournamentId],
    );
    if (!current.rowCount) throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
    const expected = input.action === "TEST_CLOSE" ? "OPEN_REGISTRATION" : "REGISTRATION_CLOSED";
    const next = input.action === "TEST_CLOSE" ? "REGISTRATION_CLOSED" : "OPEN_REGISTRATION";
    if (current.rows[0].status !== expected) {
      throw new AppError(409, `Cannot ${input.action === "TEST_CLOSE" ? "close" : "reopen"} registration from ${current.rows[0].status}`, "INVALID_REGISTRATION_CONTROL_TRANSITION");
    }
    if (input.action === "TEST_REOPEN") {
      const activePeriod = await client.query(
        "SELECT 1 FROM registration_periods WHERE tournament_id=$1 AND start_date <= NOW() AND end_date >= NOW() LIMIT 1",
        [input.tournamentId],
      );
      if (!activePeriod.rowCount) throw new AppError(409, "The real registration deadline has passed; test reopening is no longer available", "REGISTRATION_PERIOD_EXPIRED");
      const snapshot = await client.query("SELECT 1 FROM tournament_roster_lock_snapshots WHERE tournament_id=$1 LIMIT 1", [input.tournamentId]);
      if (snapshot.rowCount) throw new AppError(409, "Registration cannot reopen after roster lock", "ROSTER_ALREADY_LOCKED");
    }
    await client.query("UPDATE tournaments SET status=$2,updated_at=NOW() WHERE id=$1", [input.tournamentId, next]);
    await client.query(
      "INSERT INTO tournament_registration_control_audit(tournament_id,actor_id,action,previous_status,new_status) VALUES($1,$2,$3,$4,$5)",
      [input.tournamentId, input.actorId, input.action, current.rows[0].status, next],
    );
    await client.query("COMMIT");
    const updated = await findTournamentById(input.tournamentId);
    if (!updated) throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function backfillOrganizerInstitutionForCreator(
  creatorId: string,
  institutionId: string,
): Promise<void> {
  await getPool().query(
    `UPDATE tournaments
     SET organizing_institution_id = $2
     WHERE created_by = $1 AND organizing_institution_id IS NULL`,
    [creatorId, institutionId],
  );
}

export async function listTournaments(
  limit: number,
  offset: number,
  status?: string,
  filters: {
    statuses?: string[];
    search?: string;
    scope?: TournamentScope;
    institutionId?: string;
    fromDate?: string;
    toDate?: string;
    sortBy?: "CREATED_AT" | "NAME" | "START_DATE";
    sortOrder?: "ASC" | "DESC";
    draftCreatorId?: string;
  } = {},
): Promise<{ items: Tournament[]; total: number }> {
  const pool = getPool();

  const conditions: string[] = [];
  const values: unknown[] = [];
  const addCondition = (sql: (index: number) => string, value: unknown) => {
    values.push(value);
    conditions.push(sql(values.length));
  };
  if (filters.draftCreatorId) {
    addCondition((index) => `(status <> 'DRAFT' OR created_by = $${index})`, filters.draftCreatorId);
  } else {
    conditions.push("status <> 'DRAFT'");
  }
  if (filters.statuses?.length) {
    addCondition((index) => `status = ANY($${index}::varchar[])`, filters.statuses);
  } else if (status) {
    addCondition((index) => `status = $${index}`, status);
  }
  if (filters.search) {
    addCondition(
      (index) => `(name ILIKE $${index} OR COALESCE(organizer_name, '') ILIKE $${index})`,
      `%${filters.search}%`,
    );
  }
  if (filters.scope) addCondition((index) => `scope = $${index}`, filters.scope);
  if (filters.institutionId) {
    addCondition((index) => `organizing_institution_id = $${index}`, filters.institutionId);
  }
  if (filters.fromDate) addCondition((index) => `start_date::date >= $${index}::date`, filters.fromDate);
  if (filters.toDate) addCondition((index) => `start_date::date <= $${index}::date`, filters.toDate);
  const whereClause = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const countQuery = `SELECT COUNT(*)::text AS count FROM tournaments${whereClause}`;
  let listQuery = `
    SELECT id, name, description, status, location, organizer_name, organizer_contact_name,
           organizer_email, organizer_phone, scope, football_format, competition_format,
           min_teams, max_teams, min_players, max_players_per_team, min_goalkeepers,
           start_date, end_date, organizing_institution_id, created_by, created_at, updated_at,
           allowed_institution_levels, all_institutions_allowed,
           default_max_teams_per_institution,
           COALESCE((
             SELECT array_agg(ai.institution_id::text ORDER BY ai.institution_id)
             FROM tournament_allowed_institutions ai WHERE ai.tournament_id = tournaments.id
           ), ARRAY[]::text[]) AS allowed_institution_ids,
           COALESCE((
             SELECT json_agg(json_build_object(
               'institutionId', il.institution_id, 'maxTeams', il.max_teams
             ) ORDER BY il.institution_id)
             FROM tournament_institution_limits il WHERE il.tournament_id = tournaments.id
           ), '[]'::json) AS institution_team_limits,
           COALESCE((
             SELECT json_agg(json_build_object(
               'id', rp.id,
               'tournamentId', rp.tournament_id,
               'name', rp.name,
               'startDate', rp.start_date,
               'endDate', rp.end_date,
               'createdAt', rp.created_at
             ) ORDER BY rp.start_date)
             FROM registration_periods rp
             WHERE rp.tournament_id = tournaments.id
           ), '[]'::json) AS registration_periods,
           (
             SELECT json_build_object(
               'eligibilityDescription', tr.eligibility_description,
               'pointsForWin', tr.points_for_win, 'pointsForDraw', tr.points_for_draw,
               'pointsForLoss', tr.points_for_loss, 'advancingTeamsPerGroup', tr.advancing_teams_per_group,
               'roundRobinLegs', tr.round_robin_legs, 'maxTeamsPerGroup', tr.max_teams_per_group,
               'knockoutDecisionMethod', tr.knockout_decision_method,
               'extraTimeMinutes', tr.extra_time_minutes,
               'plannedPitchCount', tr.planned_pitch_count,
               'playableHoursPerDay', tr.playable_hours_per_day,
               'yellowCardsForSuspension', tr.yellow_cards_for_suspension,
               'suspensionMatches', tr.suspension_matches, 'complaintWindowHours', tr.complaint_window_hours,
               'minimumRestMinutes', tr.minimum_rest_minutes, 'matchDurationMinutes', tr.match_duration_minutes,
               'forfeitPolicy', tr.forfeit_policy, 'forfeitWinnerScore', tr.forfeit_winner_score,
               'forfeitLoserScore', tr.forfeit_loser_score, 'publishedVersion', tr.published_version,
               'competitionConfig', tr.competition_config,
               'publishedAt', tr.published_at
             ) FROM tournament_rules tr WHERE tr.tournament_id = tournaments.id
           ) AS rules
    FROM tournaments${whereClause}
  `;
  const paginationValues = [...values, limit, offset];
  const sortColumn = filters.sortBy === "NAME"
    ? "name"
    : filters.sortBy === "START_DATE"
      ? "start_date"
      : "created_at";
  const sortOrder = filters.sortOrder === "ASC" ? "ASC" : "DESC";
  listQuery += ` ORDER BY ${sortColumn} ${sortOrder} NULLS LAST, id ASC LIMIT $${paginationValues.length - 1} OFFSET $${paginationValues.length}`;
  const countResult = await pool.query<{ count: string }>(countQuery, values);
  const total = Number(countResult.rows[0]?.count ?? 0);

  const result = await pool.query(listQuery, paginationValues);

  return {
    items: result.rows.map(mapTournament),
    total,
  };
}

export async function reserveTournamentRegistration(input: {
  registrationId: string;
  tournamentId: string;
  teamId: string;
  institutionId: string;
  isResubmission?: boolean;
  requireConfirmedRoster?: boolean;
  roster: Array<{ playerId: string; lineupRole: "STARTER" | "SUBSTITUTE"; isGoalkeeper: boolean }>;
}): Promise<"PENDING" | "WAITLIST"> {
  const tournament = await findTournamentById(input.tournamentId);
  if (!tournament) throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  if (!Array.isArray(input.roster) || input.roster.length < tournament.minPlayers || input.roster.length > tournament.maxPlayersPerTeam) {
    throw new AppError(409, `Roster must contain ${tournament.minPlayers}–${tournament.maxPlayersPerTeam} players under this tournament's rules`, "TOURNAMENT_ROSTER_SIZE_INVALID");
  }
  const goalkeeperCount = input.roster.filter((player) => player.isGoalkeeper).length;
  if (goalkeeperCount < tournament.minGoalkeepers) {
    throw new AppError(409, `Roster must include at least ${tournament.minGoalkeepers} goalkeeper(s) under this tournament's rules`, "TOURNAMENT_ROSTER_GOALKEEPERS_INVALID");
  }
  const starters = input.roster.filter((player) => player.lineupRole === "STARTER");
  if (starters.length !== tournament.footballFormat || starters.filter((player) => player.isGoalkeeper).length !== 1) {
    throw new AppError(409, `The starting lineup must match ${tournament.footballFormat}-a-side and name exactly one starting goalkeeper`, "TOURNAMENT_LINEUP_INVALID");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", ["tournament-player-participation-reconcile"]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [input.tournamentId]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`team-registration:${input.teamId}`]);
    const intakeWindow = await client.query<{ status: string; has_open_period: boolean }>(
      `SELECT tournament.status,
         EXISTS (SELECT 1 FROM registration_periods period
                 WHERE period.tournament_id=tournament.id
                   AND period.start_date <= NOW() AND period.end_date >= NOW()) AS has_open_period
       FROM tournaments tournament WHERE tournament.id=$1 FOR SHARE`,
      [input.tournamentId],
    );
    if (!intakeWindow.rowCount || intakeWindow.rows[0].status !== "OPEN_REGISTRATION" || !intakeWindow.rows[0].has_open_period) {
      throw new AppError(409, input.isResubmission
        ? "Thời hạn đăng ký đã đóng; không thể bổ sung hoặc gửi lại hồ sơ sau thời hạn."
        : "Thời hạn nhận hồ sơ đã đóng; hệ thống không nhận thêm đăng ký mới", "REGISTRATION_CLOSED");
    }
    const submittedPlayerIds = [...new Set(input.roster.map((player) => player.playerId))].sort();
    for (const playerId of submittedPlayerIds) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`tournament-player-participation:${playerId}`]);
    }
    if (input.requireConfirmedRoster) {
      const confirmed = await client.query<{ player_id: string }>(
        `SELECT player_id FROM tournament_player_participation_claims
         WHERE player_id=ANY($1::uuid[]) AND team_id=$2 AND tournament_id=$3 AND state='ACTIVE'`,
        [submittedPlayerIds, input.teamId, input.tournamentId],
      );
      if (new Set(confirmed.rows.map((row) => row.player_id)).size !== submittedPlayerIds.length) {
        throw new AppError(409, "Mỗi cầu thủ trong roster phải xác nhận lời mời tham gia giải trước khi gửi hồ sơ", "PLAYER_CONFIRMATION_REQUIRED");
      }
    }
    const unavailable = await client.query<{ player_id: string }>(
      `SELECT DISTINCT unavailable.player_id FROM (
         SELECT claim.player_id FROM tournaments target
         JOIN tournament_player_participation_claims claim ON claim.player_id=ANY($3::uuid[]) AND claim.state='ACTIVE'
         JOIN tournaments other ON other.id=claim.tournament_id
         WHERE target.id=$1 AND (claim.tournament_id<>$1 OR claim.team_id<>$2)
           AND target.start_date IS NOT NULL AND target.end_date IS NOT NULL
           AND other.start_date IS NOT NULL AND other.end_date IS NOT NULL
           AND other.start_date <= target.end_date AND other.end_date >= target.start_date
         UNION ALL
         SELECT participation.player_id FROM tournaments target
         JOIN tournament_player_participation_reservations participation ON participation.player_id=ANY($3::uuid[])
         JOIN tournament_registration_reservations reservation ON reservation.registration_id=participation.registration_id
         JOIN tournaments other ON other.id=participation.tournament_id
         WHERE target.id=$1 AND reservation.status='APPROVED' AND (participation.tournament_id<>$1 OR reservation.team_id<>$2)
           AND target.start_date IS NOT NULL AND target.end_date IS NOT NULL
           AND other.start_date IS NOT NULL AND other.end_date IS NOT NULL
           AND other.start_date <= target.end_date AND other.end_date >= target.start_date
       ) unavailable`,
      [input.tournamentId, input.teamId, submittedPlayerIds],
    );
    if (unavailable.rowCount) {
      throw new AppError(409, "Roster có cầu thủ đã được duyệt ở giải khác trùng thời gian; hãy thay cầu thủ trước khi gửi", "TOURNAMENT_PLAYER_DATE_CONFLICT");
    }
    const approvedTotal = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM tournament_registration_reservations WHERE tournament_id=$1 AND status='APPROVED' AND persisted_in_organization=TRUE",
      [input.tournamentId],
    );
    const override = await client.query<{ max_teams: number | null }>(
      "SELECT max_teams FROM tournament_institution_limits WHERE tournament_id=$1 AND institution_id=$2",
      [input.tournamentId, input.institutionId],
    );
    const schoolCap = override.rowCount ? override.rows[0].max_teams : tournament.defaultMaxTeamsPerInstitution;
    const approvedSchool = schoolCap == null ? { rows: [{ count: "0" }] } : await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM tournament_registration_reservations WHERE tournament_id=$1 AND institution_id=$2 AND status='APPROVED' AND persisted_in_organization=TRUE",
      [input.tournamentId, input.institutionId],
    );
    const initialStatus = Number(approvedTotal.rows[0]?.count ?? 0) >= tournament.maxTeams
      || (schoolCap != null && Number(approvedSchool.rows[0]?.count ?? 0) >= schoolCap)
      ? "WAITLIST" : "PENDING";
    if (input.isResubmission) {
      const priorReservation = await client.query<{ status: string }>(
        `SELECT status FROM tournament_registration_reservations
         WHERE registration_id=$1 AND tournament_id=$2 AND team_id=$3 AND persisted_in_organization=TRUE FOR UPDATE`,
        [input.registrationId,input.tournamentId,input.teamId],
      );
      // A previously submitted PENDING application keeps its place in the
      // review queue when the captain resubmits a corrected version.
      const resubmissionStatus = priorReservation.rows[0]?.status === "PENDING" ? "PENDING" : initialStatus;
      const existing = await client.query(
        `UPDATE tournament_registration_reservations SET status=$5,roster_player_ids=$2::uuid[],
           conflict_details='[]'::jsonb,updated_at=NOW()
         WHERE registration_id=$1 AND tournament_id=$3 AND team_id=$4 AND persisted_in_organization=TRUE
           AND status IN ('PENDING','WAITLIST','CONFLICT_ADJUSTMENT_REQUIRED') RETURNING registration_id`,
        [input.registrationId, submittedPlayerIds, input.tournamentId, input.teamId, resubmissionStatus],
      );
      if (existing.rowCount) {
        await client.query("COMMIT");
        return resubmissionStatus;
      }
    }
    await client.query(
      `DELETE FROM tournament_registration_reservations
       WHERE tournament_id = $1 AND persisted_in_organization = FALSE
         AND expires_at <= NOW()`,
      [input.tournamentId],
    );
    const duplicate = await client.query<{ registration_id: string }>(
      `SELECT registration_id FROM tournament_registration_reservations
       WHERE tournament_id = $1 AND team_id = $2 AND status IN ('PENDING', 'APPROVED', 'WAITLIST', 'CONFLICT_ADJUSTMENT_REQUIRED')`,
      [input.tournamentId, input.teamId],
    );
    if (duplicate.rowCount) {
      if (duplicate.rows[0].registration_id === input.registrationId) {
        await client.query("COMMIT");
        return initialStatus;
      }
      throw new AppError(409, "This team already has a registration for the tournament", "ALREADY_REGISTERED");
    }

    // Applications are all accepted; once a quota is full the new application remains
    // in the waitlist and does not hold a player participation claim.
    await client.query(
      `INSERT INTO tournament_registration_reservations
         (registration_id, tournament_id, team_id, institution_id, roster_player_ids, status)
       VALUES ($1, $2, $3, $4, $5::uuid[], $6)
       ON CONFLICT (registration_id) DO UPDATE SET roster_player_ids=EXCLUDED.roster_player_ids, status=EXCLUDED.status, updated_at=NOW()`,
      [input.registrationId, input.tournamentId, input.teamId, input.institutionId, submittedPlayerIds, initialStatus],
    );
    await client.query("COMMIT");
    return initialStatus;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listUnavailableTournamentPlayerIds(tournamentId: string, teamId: string, playerIds: string[]): Promise<string[]> {
  if (!playerIds.length) return [];
  const result = await getPool().query<{ player_id: string }>(
    `SELECT DISTINCT unavailable.player_id FROM (
       SELECT claim.player_id
       FROM tournaments target
       JOIN tournament_player_participation_claims claim ON claim.player_id=ANY($3::uuid[]) AND claim.state='ACTIVE'
       JOIN tournaments other ON other.id=claim.tournament_id
       WHERE target.id=$1 AND (claim.tournament_id<>$1 OR claim.team_id<>$2)
         AND target.start_date IS NOT NULL AND target.end_date IS NOT NULL
         AND other.start_date IS NOT NULL AND other.end_date IS NOT NULL
         AND other.start_date <= target.end_date AND other.end_date >= target.start_date
       UNION ALL
       SELECT participation.player_id
       FROM tournaments target
       JOIN tournament_player_participation_reservations participation ON participation.player_id=ANY($3::uuid[])
       JOIN tournament_registration_reservations reservation ON reservation.registration_id=participation.registration_id
       JOIN tournaments other ON other.id=participation.tournament_id
       WHERE target.id=$1 AND reservation.status='APPROVED' AND (participation.tournament_id<>$1 OR reservation.team_id<>$2)
         AND target.start_date IS NOT NULL AND target.end_date IS NOT NULL
         AND other.start_date IS NOT NULL AND other.end_date IS NOT NULL
         AND other.start_date <= target.end_date AND other.end_date >= target.start_date
     ) unavailable`,
    [tournamentId, teamId, [...new Set(playerIds)]],
  );
  return result.rows.map((row) => row.player_id);
}

export async function reserveTournamentInvitationParticipation(input: {
  invitationId: string; tournamentId: string; teamId: string; playerId: string;
}): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", ["tournament-player-participation-reconcile"]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`tournament-player-participation:${input.playerId}`]);
    const target = await client.query<{ start_date: string | null; end_date: string | null; status: TournamentStatus }>(
      "SELECT start_date::text,end_date::text,status FROM tournaments WHERE id=$1 FOR SHARE", [input.tournamentId],
    );
    const dates = target.rows[0];
    if (!dates) throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
    if (!dates.start_date || !dates.end_date) throw new AppError(409, "Set the tournament start and end dates before confirming a player", "TOURNAMENT_DATES_REQUIRED");
    if (["ROSTER_LOCKED", "PREPARING", "IN_PROGRESS", "PAUSED", "COMPLETED"].includes(dates.status)) {
      const officialRoster = await client.query(
        `SELECT 1 FROM tournament_registration_reservations
         WHERE tournament_id=$1 AND team_id=$2 AND status='APPROVED' AND persisted_in_organization=TRUE LIMIT 1`,
        [input.tournamentId, input.teamId],
      );
      if (!officialRoster.rowCount) {
        // Accepted invitations from applications that were not selected must
        // never be resurrected by Organization's legacy-claim reconciliation.
        await client.query(
          `UPDATE tournament_player_participation_claims
           SET state='RELEASED',released_at=COALESCE(released_at,NOW()),updated_at=NOW()
           WHERE invitation_id=$1 AND state='ACTIVE'`, [input.invitationId],
        );
        await client.query("COMMIT");
        return;
      }
    }
    const conflicts = await client.query<{ tournament_id: string; tournament_name: string }>(
      `SELECT DISTINCT conflict.tournament_id, conflict.tournament_name FROM (
         SELECT claim.tournament_id, other.name AS tournament_name
         FROM tournament_player_participation_claims claim
         JOIN tournaments other ON other.id=claim.tournament_id
         WHERE claim.player_id=$1 AND claim.state='ACTIVE' AND claim.invitation_id<>$2
           AND (claim.tournament_id<>$3 OR claim.team_id<>$6) AND other.start_date IS NOT NULL AND other.end_date IS NOT NULL
           AND other.start_date <= $5::date AND other.end_date >= $4::date
         UNION ALL
         SELECT participation.tournament_id, other.name AS tournament_name
         FROM tournament_player_participation_reservations participation
         JOIN tournament_registration_reservations reservation ON reservation.registration_id=participation.registration_id
         JOIN tournaments other ON other.id=participation.tournament_id
         WHERE participation.player_id=$1 AND reservation.status='APPROVED'
           AND (participation.tournament_id<>$3 OR reservation.team_id<>$6) AND other.start_date IS NOT NULL AND other.end_date IS NOT NULL
           AND other.start_date <= $5::date AND other.end_date >= $4::date
       ) conflict ORDER BY conflict.tournament_name`,
      [input.playerId, input.invitationId, input.tournamentId, dates.start_date, dates.end_date, input.teamId],
    );
    if (conflicts.rowCount) {
      throw new AppError(
        409,
        `Cầu thủ đã xác nhận tham gia giải ${conflicts.rows.map((row) => row.tournament_name).join(", ")} có thời gian tổ chức trùng nhau`,
        "PLAYER_TOURNAMENT_DATE_CONFLICT",
        { conflictingTournaments: conflicts.rows },
      );
    }
    await client.query(
      `INSERT INTO tournament_player_participation_claims (invitation_id,tournament_id,team_id,player_id,state,released_at)
       VALUES ($1,$2,$3,$4,'ACTIVE',NULL)
       ON CONFLICT (invitation_id) DO UPDATE SET tournament_id=EXCLUDED.tournament_id,
         team_id=EXCLUDED.team_id,player_id=EXCLUDED.player_id,state='ACTIVE',released_at=NULL,updated_at=NOW()`,
      [input.invitationId, input.tournamentId, input.teamId, input.playerId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function releaseTournamentInvitationParticipation(invitationId: string): Promise<void> {
  await getPool().query(
    `UPDATE tournament_player_participation_claims SET state='RELEASED',released_at=NOW(),updated_at=NOW()
     WHERE invitation_id=$1 AND state='ACTIVE'`, [invitationId],
  );
}

export async function reconcileApprovedPlayerParticipationClaims(claims: Array<{
  registrationId: string; tournamentId: string; teamId: string; institutionId: string; playerIds: string[];
  status: "PENDING" | "APPROVED" | "WAITLIST" | "CONFLICT_ADJUSTMENT_REQUIRED";
}>): Promise<void> {
  if (!claims.length) return;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", ["tournament-player-participation-reconcile"]);
    for (const claim of claims) {
      const playerIds = [...new Set(claim.playerIds)].sort();
      if (!playerIds.length) continue;
      for (const playerId of playerIds) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`tournament-player-participation:${playerId}`]);
      }
      const current = await client.query<{ status: string; tournament_id: string }>(
        "SELECT status,tournament_id FROM tournament_registration_reservations WHERE registration_id=$1 FOR UPDATE",
        [claim.registrationId],
      );
      if (current.rowCount && ["REJECTED", "WITHDRAWN"].includes(current.rows[0].status)) continue;
      await client.query(
        `INSERT INTO tournament_registration_reservations
           (registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization,expires_at,roster_player_ids)
         VALUES ($1,$2,$3,$4,$5,TRUE,'infinity'::timestamptz,$6::uuid[])
         ON CONFLICT (registration_id) DO UPDATE SET status=EXCLUDED.status,persisted_in_organization=TRUE,
           expires_at='infinity'::timestamptz,roster_player_ids=EXCLUDED.roster_player_ids,updated_at=NOW()
         WHERE tournament_registration_reservations.status NOT IN ('REJECTED','WITHDRAWN')`,
        [claim.registrationId, claim.tournamentId, claim.teamId, claim.institutionId, claim.status, playerIds],
      );
      if (claim.status === "APPROVED") {
        await client.query(
          `INSERT INTO tournament_player_participation_reservations (registration_id,tournament_id,player_id)
           SELECT $1,$2,unnest($3::uuid[]) ON CONFLICT (registration_id,player_id) DO NOTHING`,
          [claim.registrationId, claim.tournamentId, playerIds],
        );
      } else {
        await client.query("DELETE FROM tournament_player_participation_reservations WHERE registration_id=$1", [claim.registrationId]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function updateTournamentRegistrationReservation(
  registrationId: string,
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "WAITLIST" | "CONFLICT_ADJUSTMENT_REQUIRED",
  persistedInOrganization: boolean,
  registration?: { tournamentId: string; teamId: string; institutionId: string },
  playerIds?: string[],
): Promise<{ conflictedRegistrations: Array<{ registrationId: string; conflicts: Array<{ playerId: string; conflictingTournamentId: string; conflictingTournamentName: string }>; adjustmentDeadline: string | null }>; waitlistedRegistrationIds: string[] }> {
  if (status === "APPROVED" && registration) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", ["tournament-player-participation-reconcile"]);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [registration.tournamentId]);
      const target = await client.query<{
        start_date: string | null; end_date: string | null; name: string;
        max_teams: number; default_max_teams_per_institution: number | null;
      }>(
        "SELECT start_date, end_date, name, max_teams, default_max_teams_per_institution FROM tournaments WHERE id = $1 FOR UPDATE", [registration.tournamentId],
      );
      const dates = target.rows[0];
      if (!dates) throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
      if (!dates?.start_date || !dates.end_date) {
        throw new AppError(409, "Set the tournament start and end dates before approving a team", "TOURNAMENT_DATES_REQUIRED");
      }
      const currentReservation = await client.query<{ status: string }>(
        "SELECT status FROM tournament_registration_reservations WHERE registration_id=$1 FOR UPDATE",
        [registrationId],
      );
      if (!currentReservation.rowCount) throw new AppError(404, "Registration reservation not found", "REGISTRATION_RESERVATION_NOT_FOUND");
      const approvedPlayerIds = [...new Set(playerIds ?? [])].sort();
      if (!approvedPlayerIds.length) throw new AppError(409, "A confirmed player roster is required before approval", "REGISTRATION_ROSTER_REQUIRED");
      for (const playerId of approvedPlayerIds) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`tournament-player-participation:${playerId}`]);
      }
      if (currentReservation.rows[0]?.status !== "APPROVED") {
        const approvedTotal = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM tournament_registration_reservations
           WHERE tournament_id=$1 AND status='APPROVED' AND persisted_in_organization=TRUE`,
          [registration.tournamentId],
        );
        if (Number(approvedTotal.rows[0]?.count ?? 0) >= dates.max_teams) {
          throw new AppError(409, "Giải đã đủ chỉ tiêu; hồ sơ được giữ ở danh sách chờ suất", "TOURNAMENT_TEAM_LIMIT_REACHED");
        }
        const override = await client.query<{ max_teams: number | null }>(
          "SELECT max_teams FROM tournament_institution_limits WHERE tournament_id=$1 AND institution_id=$2",
          [registration.tournamentId, registration.institutionId],
        );
        const schoolCap = override.rowCount ? override.rows[0].max_teams : dates.default_max_teams_per_institution;
        if (schoolCap !== null) {
          const approvedSchool = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM tournament_registration_reservations
             WHERE tournament_id=$1 AND institution_id=$2 AND status='APPROVED' AND persisted_in_organization=TRUE`,
            [registration.tournamentId, registration.institutionId],
          );
          if (Number(approvedSchool.rows[0]?.count ?? 0) >= schoolCap) {
            throw new AppError(409, "Trường đã đủ chỉ tiêu; hồ sơ được giữ ở danh sách chờ suất", "INSTITUTION_TEAM_LIMIT_REACHED");
          }
        }
      }
      const collisions = await client.query(
        `SELECT DISTINCT participation.player_id, other.id AS tournament_id, other.name
         FROM tournament_player_participation_reservations participation
         JOIN tournament_registration_reservations reservation ON reservation.registration_id=participation.registration_id
         JOIN tournaments other ON other.id=participation.tournament_id
         WHERE participation.player_id=ANY($1::uuid[]) AND participation.registration_id<>$2
           AND reservation.status='APPROVED' AND other.id<>$3
           AND other.start_date IS NOT NULL AND other.end_date IS NOT NULL
           AND other.start_date <= $5 AND other.end_date >= $4
         ORDER BY participation.player_id,other.name`,
        [approvedPlayerIds, registrationId, registration.tournamentId, dates.start_date, dates.end_date],
      );
      if (collisions.rowCount) {
        throw new AppError(409, "Một hoặc nhiều cầu thủ đã được duyệt ở giải khác có thời gian tổ chức trùng nhau", "TOURNAMENT_PLAYER_DATE_CONFLICT");
      }
      await client.query(
        `INSERT INTO tournament_registration_reservations
           (registration_id, tournament_id, team_id, institution_id, status, persisted_in_organization, expires_at, roster_player_ids)
         VALUES ($1, $2, $3, $4, $5, $6, 'infinity'::timestamptz, $7::uuid[])
         ON CONFLICT (registration_id) DO UPDATE SET status = EXCLUDED.status,
           persisted_in_organization = EXCLUDED.persisted_in_organization, expires_at = EXCLUDED.expires_at,
           roster_player_ids=EXCLUDED.roster_player_ids, updated_at = NOW()`,
        [registrationId, registration.tournamentId, registration.teamId, registration.institutionId, status, persistedInOrganization, approvedPlayerIds],
      );
      await client.query(
        `INSERT INTO tournament_player_participation_reservations (registration_id,tournament_id,player_id)
         SELECT $1,$2,unnest($3::uuid[]) ON CONFLICT (registration_id,player_id) DO NOTHING`,
        [registrationId, registration.tournamentId, approvedPlayerIds],
      );
      const affected = await client.query<{ registration_id: string; conflicts: unknown; adjustment_deadline: string | null }>(
        `WITH collisions AS (
           SELECT reservation.registration_id,reservation.tournament_id,
             jsonb_agg(DISTINCT jsonb_build_object('playerId',roster.player_id,
               'conflictingTournamentId',$2::uuid,'conflictingTournamentName',$3::text)) AS conflicts
           FROM tournament_registration_reservations reservation
           JOIN tournaments other ON other.id=reservation.tournament_id
           CROSS JOIN LATERAL unnest(reservation.roster_player_ids) roster(player_id)
           WHERE reservation.registration_id<>$1 AND reservation.persisted_in_organization=TRUE
             AND reservation.status IN ('PENDING','WAITLIST','CONFLICT_ADJUSTMENT_REQUIRED') AND roster.player_id=ANY($4::uuid[])
             AND other.start_date IS NOT NULL AND other.end_date IS NOT NULL
             AND other.start_date <= $6 AND other.end_date >= $5
           GROUP BY reservation.registration_id,reservation.tournament_id
         )
         SELECT collisions.registration_id,collisions.conflicts,
           (SELECT MIN(period.end_date) FROM registration_periods period
            WHERE period.tournament_id=collisions.tournament_id AND period.end_date>NOW()) AS adjustment_deadline
         FROM collisions`,
        [registrationId, registration.tournamentId, dates.name, approvedPlayerIds, dates.start_date, dates.end_date],
      );
      const conflictedRegistrations = affected.rows.map((row) => ({
        registrationId: row.registration_id,
        conflicts: Array.isArray(row.conflicts) ? row.conflicts as Array<{ playerId: string; conflictingTournamentId: string; conflictingTournamentName: string }> : [],
        adjustmentDeadline: row.adjustment_deadline,
      }));
      for (const conflict of conflictedRegistrations) {
        await client.query(
          `UPDATE tournament_registration_reservations SET status='CONFLICT_ADJUSTMENT_REQUIRED',conflict_details=$2::jsonb,updated_at=NOW() WHERE registration_id=$1`,
          [conflict.registrationId, JSON.stringify(conflict.conflicts)],
        );
      }
      const approvedCount = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM tournament_registration_reservations WHERE tournament_id=$1 AND status='APPROVED' AND persisted_in_organization=TRUE",
        [registration.tournamentId],
      );
      let waitlisted: { rows: Array<{ registration_id: string }> };
      if (Number(approvedCount.rows[0]?.count ?? 0) >= dates.max_teams) {
        waitlisted = await client.query<{ registration_id: string }>(
          `UPDATE tournament_registration_reservations SET status='WAITLIST',updated_at=NOW()
           WHERE tournament_id=$1 AND status='PENDING' AND persisted_in_organization=TRUE RETURNING registration_id`,
          [registration.tournamentId],
        );
      } else {
        const currentSchoolCap = await client.query<{ max_teams: number | null }>(
          "SELECT max_teams FROM tournament_institution_limits WHERE tournament_id=$1 AND institution_id=$2",
          [registration.tournamentId, registration.institutionId],
        );
        const schoolCap = currentSchoolCap.rowCount ? currentSchoolCap.rows[0].max_teams : dates.default_max_teams_per_institution;
        const approvedSchool = schoolCap == null ? { rows: [{ count: "0" }] } : await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM tournament_registration_reservations
           WHERE tournament_id=$1 AND institution_id=$2 AND status='APPROVED' AND persisted_in_organization=TRUE`,
          [registration.tournamentId, registration.institutionId],
        );
        waitlisted = schoolCap != null && Number(approvedSchool.rows[0]?.count ?? 0) >= schoolCap
          ? await client.query<{ registration_id: string }>(
            `UPDATE tournament_registration_reservations SET status='WAITLIST',updated_at=NOW()
             WHERE tournament_id=$1 AND institution_id=$2 AND status='PENDING' AND persisted_in_organization=TRUE RETURNING registration_id`,
            [registration.tournamentId, registration.institutionId],
          )
          : { rows: [] as Array<{ registration_id: string }> };
      }
      await client.query("COMMIT");
      return { conflictedRegistrations, waitlistedRegistrationIds: waitlisted.rows.map((row) => row.registration_id) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", ["tournament-player-participation-reconcile"]);
    if (status !== "APPROVED") {
      await client.query("DELETE FROM tournament_player_participation_reservations WHERE registration_id=$1", [registrationId]);
    }
    const result = registration
      ? await client.query(
        `INSERT INTO tournament_registration_reservations
           (registration_id, tournament_id, team_id, institution_id, status, persisted_in_organization, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 THEN 'infinity'::timestamptz ELSE NOW() + INTERVAL '15 minutes' END)
         ON CONFLICT (registration_id) DO UPDATE
         SET status = EXCLUDED.status, persisted_in_organization = EXCLUDED.persisted_in_organization,
             expires_at = EXCLUDED.expires_at, updated_at = NOW()`,
        [registrationId, registration.tournamentId, registration.teamId, registration.institutionId, status, persistedInOrganization],
      )
      : await client.query(
        `UPDATE tournament_registration_reservations
         SET status = $2, persisted_in_organization = $3,
             expires_at = CASE WHEN $3 THEN 'infinity'::timestamptz ELSE expires_at END,
             updated_at = NOW()
         WHERE registration_id = $1`,
        [registrationId, status, persistedInOrganization],
      );
    if ((status === "REJECTED" || status === "WITHDRAWN") && registration) {
      await client.query(
        `UPDATE tournament_player_participation_claims
         SET state='RELEASED',released_at=NOW(),updated_at=NOW()
         WHERE team_id=$1 AND tournament_id=$2 AND state='ACTIVE'`,
        [registration.teamId, registration.tournamentId],
      );
    }
    if (!result.rowCount) throw new AppError(404, "Registration reservation not found", "REGISTRATION_RESERVATION_NOT_FOUND");
    await client.query("COMMIT");
    return { conflictedRegistrations: [], waitlistedRegistrationIds: [] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function approveTournamentTeamWithdrawal(input: {
  registrationId: string;
  tournamentId: string;
  actorId: string;
  reason: string;
}): Promise<{ snapshotVersion: number | null; alreadyWithdrawn: boolean }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", ["tournament-player-participation-reconcile"]);
    const locked = await client.query<{
      team_id: string; status: string; persisted_in_organization: boolean; tournament_status: string; min_teams: number;
    }>(
      `SELECT reservation.team_id, reservation.status, reservation.persisted_in_organization,
              tournament.status AS tournament_status,
              tournament.min_teams
       FROM tournament_registration_reservations reservation
       JOIN tournaments tournament ON tournament.id = reservation.tournament_id
       WHERE reservation.registration_id = $1 AND reservation.tournament_id = $2
       FOR UPDATE OF reservation, tournament`,
      [input.registrationId, input.tournamentId],
    );
    const registration = locked.rows[0];
    if (!registration) throw new AppError(404, "Registration reservation not found", "REGISTRATION_RESERVATION_NOT_FOUND");
    if (registration.status === "WITHDRAWN") {
      const audit = await client.query<{ snapshot_version: number | null }>(
        "SELECT snapshot_version FROM tournament_roster_withdrawal_adjustments WHERE registration_id = $1",
        [input.registrationId],
      );
      if (!audit.rowCount) {
        throw new AppError(409, "Đăng ký đã được rút bởi một nghiệp vụ khác; cần đồng bộ hồ sơ trước khi xử lý yêu cầu này", "REGISTRATION_WITHDRAWN_ELSEWHERE");
      }
      await client.query("COMMIT");
      return { snapshotVersion: audit.rows[0].snapshot_version, alreadyWithdrawn: true };
    }
    if (registration.status !== "APPROVED" || !registration.persisted_in_organization) {
      throw new AppError(409, "Chỉ hồ sơ đội đã duyệt mới được BTC chấp thuận rút", "REGISTRATION_NOT_APPROVED");
    }

    const draw = await client.query<{ status: string | null }>(
      `SELECT CASE
         WHEN EXISTS (
           SELECT 1 FROM tournament_draw_versions
           WHERE tournament_id = $1 AND status IN ('CONFIRMED', 'PUBLISHED')
         ) THEN 'PUBLISHED'
         WHEN EXISTS (
           SELECT 1 FROM tournament_live_draw_sessions
           WHERE tournament_id = $1 AND status IN ('LIVE', 'PAUSED', 'COMPLETED', 'FINALIZED')
         ) THEN 'LIVE'
         ELSE NULL
       END AS status`,
      [input.tournamentId],
    );
    const drawStatus = draw.rows[0]?.status ?? null;
    if (!canWithdrawRegistrationBeforeDraw(registration.tournament_status, drawStatus)) {
      throw new AppError(
        409,
        "Không thể rút đội sau khi bảng đấu đã được xác nhận/công bố hoặc giải đã sang giai đoạn thi đấu. Cần xử lý thay đổi dây chuyền trước khi quyết định.",
        "WITHDRAWAL_REQUIRES_COMPETITION_CHANGE_WORKFLOW",
      );
    }

    const remainingCount = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tournament_registration_reservations
       WHERE tournament_id = $1 AND status = 'APPROVED' AND persisted_in_organization = TRUE
         AND registration_id <> $2`,
      [input.tournamentId, input.registrationId],
    );
    if (Number(remainingCount.rows[0]?.count ?? 0) < registration.min_teams) {
      throw new AppError(409, "Không thể chấp thuận rút đội vì số đội còn lại sẽ thấp hơn mức tối thiểu của giải", "MINIMUM_TEAMS_NOT_MET");
    }

    let previousSnapshotVersion: number | null = null;
    let snapshotVersion: number | null = null;
    if (registration.tournament_status === "ROSTER_LOCKED") {
      const snapshot = await client.query<{ version: number; roster_data: unknown }>(
        `SELECT version, roster_data FROM tournament_roster_lock_snapshots
         WHERE tournament_id = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE`,
        [input.tournamentId],
      );
      const latest = snapshot.rows[0];
      if (!latest) throw new AppError(409, "Không tìm thấy snapshot danh sách đã chốt", "ROSTER_SNAPSHOT_NOT_FOUND");
      const adjusted = removeTeamFromRosterSnapshot(latest.roster_data, registration.team_id);
      if (!adjusted.removed || adjusted.roster.length === 0) {
        throw new AppError(409, "Snapshot không chứa đội hoặc danh sách sau điều chỉnh không hợp lệ", "ROSTER_SNAPSHOT_CONFLICT");
      }
      previousSnapshotVersion = latest.version;
      snapshotVersion = latest.version + 1;
      await client.query(
        `INSERT INTO tournament_roster_lock_snapshots (tournament_id, version, roster_data, locked_by)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [input.tournamentId, snapshotVersion, JSON.stringify(adjusted.roster), input.actorId],
      );
    }

    await client.query(
      `UPDATE tournament_registration_reservations
       SET status = 'WITHDRAWN', updated_at = NOW()
       WHERE registration_id = $1 AND status = 'APPROVED'`,
      [input.registrationId],
    );
    await client.query("DELETE FROM tournament_player_participation_reservations WHERE registration_id=$1", [input.registrationId]);
    await client.query(
      `UPDATE tournament_player_participation_claims
       SET state='RELEASED',released_at=NOW(),updated_at=NOW()
       WHERE team_id=$1 AND tournament_id=$2 AND state='ACTIVE'`,
      [registration.team_id, input.tournamentId],
    );
    await client.query(
      `INSERT INTO tournament_roster_withdrawal_adjustments
         (tournament_id, registration_id, team_id, actor_id, reason, previous_snapshot_version, snapshot_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (registration_id) DO NOTHING`,
      [input.tournamentId, input.registrationId, registration.team_id, input.actorId, input.reason.trim(), previousSnapshotVersion, snapshotVersion],
    );
    await client.query("COMMIT");
    return { snapshotVersion, alreadyWithdrawn: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listUnpersistedRegistrationCounts(
  institutionId?: string,
): Promise<Array<{ tournamentId: string; count: number }>> {
  const result = await getPool().query<{ tournament_id: string; count: string }>(
    `SELECT tournament_id, COUNT(*)::text AS count
     FROM tournament_registration_reservations
     WHERE persisted_in_organization = FALSE
       AND status IN ('PENDING', 'APPROVED')
       AND expires_at > NOW()
       AND ($1::uuid IS NULL OR institution_id = $1)
     GROUP BY tournament_id`,
    [institutionId ?? null],
  );
  return result.rows.map((row) => ({
    tournamentId: row.tournament_id,
    count: Number(row.count),
  }));
}

export async function createTournament(
  input: TournamentCreateInput,
): Promise<Tournament> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO tournaments (
         name, description, status, location, organizer_name, organizer_contact_name,
         organizer_email, organizer_phone, scope, football_format, competition_format,
         min_teams, max_teams, min_players, max_players_per_team, min_goalkeepers, start_date, end_date, created_by,
         organizing_institution_id,
         allowed_institution_levels, all_institutions_allowed,
         default_max_teams_per_institution
         )
         VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         RETURNING id, name, description, status, location, organizer_name, organizer_contact_name,
                   organizer_email, organizer_phone, scope, football_format, competition_format,
                   min_teams, max_teams, min_players, max_players_per_team, min_goalkeepers,
                   start_date, end_date, created_by, created_at, updated_at,
                   organizing_institution_id,
                   allowed_institution_levels, all_institutions_allowed,
                   default_max_teams_per_institution`,
      [
        input.name,
        input.description || null,
        input.location,
        input.organizerName,
        input.organizerContactName,
        input.organizerEmail,
        input.organizerPhone || null,
        input.scope,
        input.footballFormat,
        input.competitionFormat,
        input.minTeams,
        input.maxTeams,
        input.minPlayers,
        input.maxPlayersPerTeam,
        input.minGoalkeepers,
        input.startDate,
        input.endDate,
        input.createdBy,
        input.organizingInstitutionId,
        input.allowedInstitutionLevels,
        input.allInstitutionsAllowed,
        input.defaultMaxTeamsPerInstitution,
      ],
    );
    const tournament = mapTournament(result.rows[0]);
    const registrationResult = await client.query(
      `INSERT INTO registration_periods (tournament_id, name, start_date, end_date)
       VALUES ($1, 'Đăng ký tham gia', $2, $3)
       RETURNING id, tournament_id, name, start_date, end_date, created_at`,
      [
        tournament.id,
          `${input.registrationStart}T00:00:00.000+07:00`,
          `${input.registrationEnd}T23:59:59.999+07:00`,
      ],
    );
    const registrationPeriod = mapRegistrationPeriod(registrationResult.rows[0]);
    await client.query(
      `INSERT INTO tournament_rules (
         tournament_id, eligibility_description, points_for_win, points_for_draw, points_for_loss,
         advancing_teams_per_group, yellow_cards_for_suspension, suspension_matches,
         round_robin_legs, max_teams_per_group,
         knockout_decision_method, extra_time_minutes, planned_pitch_count, playable_hours_per_day,
         complaint_window_hours, minimum_rest_minutes, match_duration_minutes, forfeit_policy,
         forfeit_winner_score, forfeit_loser_score, competition_config, published_version, published_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22, NOW())`,
      [
        tournament.id,
        input.eligibilityDescription,
        input.pointsForWin,
        input.pointsForDraw,
        input.pointsForLoss,
        input.advancingTeamsPerGroup,
        input.yellowCardsForSuspension,
        input.suspensionMatches,
        input.roundRobinLegs,
        input.maxTeamsPerGroup,
        input.knockoutDecisionMethod,
        input.extraTimeMinutes,
        input.plannedPitchCount,
        input.playableHoursPerDay,
        input.complaintWindowHours,
        input.minimumRestMinutes,
        input.matchDurationMinutes,
        input.forfeitPolicy,
        input.forfeitWinnerScore,
        input.forfeitLoserScore,
        JSON.stringify(input.competitionConfig),
        1,
      ],
    );

    const defaultRegulation = [
      "Quy định chung",
      `1. Tất cả đội và cầu thủ phải tuân thủ điều lệ giải, quy định quản lý sự kiện và các yêu cầu an toàn.
2. Đội bóng chỉ được đăng ký nếu đáp ứng số lượng tối thiểu cầu thủ, hồ sơ quy định và trường học được phép tham gia.
3. Mỗi trận đấu tính điểm theo điều lệ: thắng ${input.pointsForWin} điểm, hòa ${input.pointsForDraw} điểm, thua ${input.pointsForLoss} điểm. Thứ tự tiêu chí xếp hạng là danh sách được BTC cấu hình trong điều lệ; không tự thêm tiêu chí đối đầu hoặc fair-play.
4. Kỷ luật thi đấu dựa trên thẻ vàng, thẻ đỏ, án treo giò và các trường hợp xử lý theo điều lệ của giải.
5. Mọi khiếu nại phải được gửi trong thời hạn quy định và được BTC xem xét theo quy trình rõ ràng.
6. Đội bóng cần đảm bảo lịch nghỉ tối thiểu, hồ sơ cầu thủ hợp lệ và tuân thủ các cam kết tổ chức trận đấu.
7. Người có thẩm quyền xác nhận cuối trong tổ trọng tài công nhận kết quả trận thông thường. BTC xử lý ngoại lệ và các thay đổi thuộc thẩm quyền theo điều lệ.`,
    ] as const;

    await client.query(
      `INSERT INTO regulations (tournament_id, title, content)
       VALUES ($1, $2, $3)`,
      [tournament.id, defaultRegulation[0], defaultRegulation[1]],
    );
    await client.query(
      `INSERT INTO regulation_versions (tournament_id, version, title, content, effective_date, created_by)
       VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [tournament.id, 1, defaultRegulation[0], defaultRegulation[1], input.createdBy],
    );
    if (input.allowedInstitutionIds.length > 0) {
      await client.query(
        `INSERT INTO tournament_allowed_institutions (tournament_id, institution_id)
         SELECT $1, institution_id FROM unnest($2::uuid[]) AS institution_id`,
        [tournament.id, input.allowedInstitutionIds],
      );
    }
    if (input.institutionTeamLimits.length > 0) {
      await client.query(
        `INSERT INTO tournament_institution_limits (tournament_id, institution_id, max_teams)
         SELECT $1, institution_id, max_teams
         FROM jsonb_to_recordset($2::jsonb) AS limits(institution_id UUID, max_teams INTEGER)`,
        [
          tournament.id,
          JSON.stringify(input.institutionTeamLimits.map((limit) => ({
            institution_id: limit.institutionId,
            max_teams: limit.maxTeams,
          }))),
        ],
      );
    }
    await client.query(
      `INSERT INTO tournament_ranking_criteria (tournament_id, priority, criterion)
       SELECT $1, priority, criterion
       FROM unnest($2::varchar[]) WITH ORDINALITY AS criteria(criterion, priority)`,
      [tournament.id, input.rankingCriteria],
    );
    await client.query(
      `INSERT INTO tournament_organizers (tournament_id, user_id, assigned_by)
       VALUES ($1, $2, $2)
       ON CONFLICT (tournament_id, user_id) DO NOTHING`,
      [tournament.id, input.createdBy],
    );
    await client.query(
      `INSERT INTO tournament_organizer_history (tournament_id, user_id, action, actor_id)
       VALUES ($1, $2, 'ASSIGNED', $2)`,
      [tournament.id, input.createdBy],
    );
    await client.query("COMMIT");
    return {
      ...tournament,
      registrationPeriods: [registrationPeriod],
      allowedInstitutionIds: input.allowedInstitutionIds,
      allowedInstitutionLevels: input.allowedInstitutionLevels,
      allInstitutionsAllowed: input.allInstitutionsAllowed,
      defaultMaxTeamsPerInstitution: input.defaultMaxTeamsPerInstitution,
      institutionTeamLimits: input.institutionTeamLimits,
      rankingCriteria: input.rankingCriteria,
      rules: {
        eligibilityDescription: input.eligibilityDescription,
        pointsForWin: input.pointsForWin,
        pointsForDraw: input.pointsForDraw,
        pointsForLoss: input.pointsForLoss,
        advancingTeamsPerGroup: input.advancingTeamsPerGroup,
        roundRobinLegs: input.roundRobinLegs,
        maxTeamsPerGroup: input.maxTeamsPerGroup,
        knockoutDecisionMethod: input.knockoutDecisionMethod,
        extraTimeMinutes: input.extraTimeMinutes,
        plannedPitchCount: input.plannedPitchCount,
        playableHoursPerDay: input.playableHoursPerDay,
        yellowCardsForSuspension: input.yellowCardsForSuspension,
        suspensionMatches: input.suspensionMatches,
        complaintWindowHours: input.complaintWindowHours,
        minimumRestMinutes: input.minimumRestMinutes,
        matchDurationMinutes: input.matchDurationMinutes,
        forfeitPolicy: input.forfeitPolicy,
        forfeitWinnerScore: input.forfeitWinnerScore,
        forfeitLoserScore: input.forfeitLoserScore,
        competitionConfig: input.competitionConfig,
        publishedVersion: 0,
        publishedAt: null,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateTournament(
  id: string,
  input: TournamentUpdateInput,
  expectedStatus?: TournamentStatus,
): Promise<Tournament | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push(`description = $${idx++}`);
    values.push(input.description);
  }
  if (input.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(input.status);
  }
  if (input.location !== undefined) {
    sets.push(`location = $${idx++}`);
    values.push(input.location);
  }
  if (input.maxTeams !== undefined) {
    sets.push(`max_teams = $${idx++}`);
    values.push(input.maxTeams);
  }
  if (input.startDate !== undefined) {
    sets.push(`start_date = $${idx++}`);
    values.push(input.startDate);
  }
  if (input.endDate !== undefined) {
    sets.push(`end_date = $${idx++}`);
    values.push(input.endDate);
  }

  if (input.competitionFormat !== undefined) {
    sets.push(`competition_format = $${idx++}`);
    values.push(input.competitionFormat);
  }

  const hasRuleUpdates = input.competitionConfig !== undefined || input.roundRobinLegs !== undefined ||
    input.maxTeamsPerGroup !== undefined || input.advancingTeamsPerGroup !== undefined ||
    input.knockoutDecisionMethod !== undefined || input.extraTimeMinutes !== undefined;
  if (sets.length === 0 && !hasRuleUpdates) {
    return findTournamentById(id);
  }

  sets.push("updated_at = NOW()");
  values.push(id);
  let where = `id = $${idx}`;
  if (expectedStatus !== undefined) {
    values.push(expectedStatus);
    where += ` AND status = $${idx + 1}`;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (sets.length) {
      const result = await client.query(`UPDATE tournaments SET ${sets.join(", ")} WHERE ${where}`, values);
      if (expectedStatus !== undefined && result.rowCount === 0) {
        throw new AppError(409, "Trạng thái giải đã thay đổi trong lúc xử lý; hãy tải lại rồi thử lại", "TOURNAMENT_STATE_CHANGED");
      }
      if (expectedStatus === undefined && result.rowCount === 0) {
        await client.query("ROLLBACK");
        return null;
      }
    } else if (expectedStatus !== undefined) {
      const current = await client.query("SELECT 1 FROM tournaments WHERE id=$1 AND status=$2 FOR UPDATE", [id, expectedStatus]);
      if (!current.rowCount) throw new AppError(409, "Trạng thái giải đã thay đổi trong lúc xử lý; hãy tải lại rồi thử lại", "TOURNAMENT_STATE_CHANGED");
    }
    if (hasRuleUpdates) {
      const ruleSets: string[] = [];
      const ruleValues: unknown[] = [];
      let ruleIndex = 1;
      const addRule = (column: string, value: unknown, cast = "") => {
        ruleSets.push(`${column}=$${ruleIndex++}${cast}`);
        ruleValues.push(value);
      };
      if (input.competitionConfig !== undefined) addRule("competition_config", JSON.stringify(input.competitionConfig), "::jsonb");
      if (input.roundRobinLegs !== undefined) addRule("round_robin_legs", input.roundRobinLegs);
      if (input.maxTeamsPerGroup !== undefined) addRule("max_teams_per_group", input.maxTeamsPerGroup);
      if (input.advancingTeamsPerGroup !== undefined) addRule("advancing_teams_per_group", input.advancingTeamsPerGroup);
      if (input.knockoutDecisionMethod !== undefined) addRule("knockout_decision_method", input.knockoutDecisionMethod);
      if (input.extraTimeMinutes !== undefined) addRule("extra_time_minutes", input.extraTimeMinutes);
      ruleSets.push("updated_at=NOW()");
      ruleValues.push(id);
      const updatedRules = await client.query(`UPDATE tournament_rules SET ${ruleSets.join(", ")} WHERE tournament_id=$${ruleIndex}`, ruleValues);
      if (!updatedRules.rowCount) throw new AppError(404, "Tournament rules not found", "TOURNAMENT_RULES_NOT_FOUND");
      await client.query("UPDATE tournaments SET updated_at=NOW() WHERE id=$1", [id]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return findTournamentById(id);
}

export async function lockTournamentRosterSnapshot(
  tournamentId: string,
  lockedBy: string,
  rosterData: unknown[],
): Promise<Tournament | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    const current = await client.query<{ status: TournamentStatus; min_teams: number; max_teams: number }>(
      "SELECT status,min_teams,max_teams FROM tournaments WHERE id = $1 FOR UPDATE",
      [tournamentId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    if (current.rows[0].status !== "REGISTRATION_CLOSED") {
      throw new AppError(409, "Roster lock requires a closed registration period", "INVALID_TOURNAMENT_TRANSITION");
    }
    const unselected = await client.query<{ registration_id: string }>(
      `SELECT registration_id FROM tournament_registration_reservations
       WHERE tournament_id=$1 AND persisted_in_organization=TRUE
         AND status IN ('PENDING','WAITLIST','CONFLICT_ADJUSTMENT_REQUIRED') FOR UPDATE`,
      [tournamentId],
    );
    const unselectedIds = unselected.rows.map((row) => row.registration_id);
    const approvedReservations = await client.query<{ team_id: string }>(
      `SELECT team_id FROM tournament_registration_reservations
       WHERE tournament_id=$1 AND status='APPROVED' AND persisted_in_organization=TRUE FOR UPDATE`,
      [tournamentId],
    );
    const unresolvedResult = await client.query<{ registration_id: string }>(
      `SELECT registration_id
       FROM tournament_registration_reservations
       WHERE tournament_id=$1 AND persisted_in_organization=TRUE
         AND status NOT IN ('APPROVED','REJECTED','APPROVAL_REVOKED','WITHDRAWN')
       FOR UPDATE`,
      [tournamentId],
    );
    const approvedTeamIds = approvedReservations.rows.map((row) => row.team_id).sort();
    const snapshotTeamIds = rosterData.map((candidate) => (candidate as { teamId?: string })?.teamId).filter((id): id is string => typeof id === "string").sort();
    if (approvedTeamIds.length < current.rows[0].min_teams || approvedTeamIds.length > current.rows[0].max_teams) {
      throw new AppError(409, `Approved team count must be between ${current.rows[0].min_teams} and ${current.rows[0].max_teams} before locking`, "APPROVED_TEAM_COUNT_OUT_OF_RANGE");
    }
    const unresolvedCount = unresolvedResult.rows.length;
    if (approvedTeamIds.length < current.rows[0].max_teams && unresolvedCount > 0) {
      throw new AppError(
        409,
        `Còn ${unresolvedCount} hồ sơ chưa có quyết định cuối cùng. Khi vẫn còn suất, BTC phải tiếp tục xử lý các hồ sơ này; chỉ chốt dưới mức tối đa khi không còn hồ sơ chưa xử lý.`,
        "REGISTRATION_QUEUE_NOT_EXHAUSTED",
      );
    }
    if (approvedTeamIds.length !== snapshotTeamIds.length || approvedTeamIds.some((teamId, index) => teamId !== snapshotTeamIds[index])) {
      throw new AppError(409, "Danh sách đội đã duyệt thay đổi trong lúc chuẩn bị chốt; tải lại danh sách rồi thử lại.", "REGISTRATION_SET_CHANGED");
    }
    const versionResult = await client.query<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0)::INTEGER + 1 AS version FROM tournament_roster_lock_snapshots WHERE tournament_id = $1",
      [tournamentId],
    );
    await client.query(
      `INSERT INTO tournament_roster_lock_snapshots (tournament_id, version, roster_data, locked_by)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [tournamentId, versionResult.rows[0].version, JSON.stringify(rosterData), lockedBy],
    );
    await client.query(
      "UPDATE tournaments SET status = 'ROSTER_LOCKED', updated_at = NOW() WHERE id = $1 AND status = 'REGISTRATION_CLOSED'",
      [tournamentId],
    );
    if (unselectedIds.length) {
      await client.query(
        `UPDATE tournament_registration_reservations SET status='REJECTED',updated_at=NOW()
         WHERE registration_id=ANY($1::uuid[]) AND status IN ('PENDING','WAITLIST','CONFLICT_ADJUSTMENT_REQUIRED')`,
        [unselectedIds],
      );
      await client.query("DELETE FROM tournament_player_participation_reservations WHERE registration_id=ANY($1::uuid[])", [unselectedIds]);
      await client.query(
        `UPDATE tournament_player_participation_claims SET state='RELEASED',released_at=NOW(),updated_at=NOW()
         WHERE state='ACTIVE' AND EXISTS (
           SELECT 1 FROM tournament_registration_reservations reservation
           WHERE reservation.registration_id=ANY($1::uuid[]) AND reservation.team_id=tournament_player_participation_claims.team_id
             AND reservation.tournament_id=tournament_player_participation_claims.tournament_id
         )`,
        [unselectedIds],
      );
    }
    await client.query("COMMIT");
    return findTournamentById(tournamentId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteTournament(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query("DELETE FROM tournaments WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

// Registration Periods
function mapRegistrationPeriod(row: {
  id: string;
  tournament_id: string;
  name: string;
  start_date: string;
  end_date: string;
  created_at: string;
}): RegistrationPeriod {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
  };
}

export async function listRegistrationPeriods(
  tournamentId: string,
): Promise<RegistrationPeriod[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, tournament_id, name, start_date, end_date, created_at
     FROM registration_periods
     WHERE tournament_id = $1
     ORDER BY start_date ASC`,
    [tournamentId],
  );

  return result.rows.map(mapRegistrationPeriod);
}

export async function createRegistrationPeriod(
  input: RegistrationPeriodCreateInput,
): Promise<RegistrationPeriod> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO registration_periods (tournament_id, name, start_date, end_date)
     VALUES ($1, $2, $3, $4)
     RETURNING id, tournament_id, name, start_date, end_date, created_at`,
    [input.tournamentId, input.name, input.startDate, input.endDate],
  );

  return mapRegistrationPeriod(result.rows[0]);
}

export async function deleteRegistrationPeriod(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    "DELETE FROM registration_periods WHERE id = $1",
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

// Regulations
function mapRegulation(row: {
  id: string;
  tournament_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}): Regulation {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listRegulations(
  tournamentId: string,
): Promise<Regulation[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, tournament_id, title, content, created_at, updated_at
     FROM regulations
     WHERE tournament_id = $1
     ORDER BY created_at ASC`,
    [tournamentId],
  );

  return result.rows.map(mapRegulation);
}

export async function findRegulationById(id: string): Promise<Regulation | null> {
  const result = await getPool().query(
    `SELECT id, tournament_id, title, content, created_at, updated_at
     FROM regulations WHERE id = $1`,
    [id],
  );
  return result.rowCount ? mapRegulation(result.rows[0]) : null;
}

export async function createRegulation(
  input: RegulationCreateInput,
): Promise<Regulation> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO regulations (tournament_id, title, content)
     VALUES ($1, $2, $3)
     RETURNING id, tournament_id, title, content, created_at, updated_at`,
    [input.tournamentId, input.title, input.content],
  );

  return mapRegulation(result.rows[0]);
}

export async function updateRegulation(
  id: string,
  input: RegulationUpdateInput,
): Promise<Regulation | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.title !== undefined) {
    sets.push(`title = $${idx++}`);
    values.push(input.title);
  }
  if (input.content !== undefined) {
    sets.push(`content = $${idx++}`);
    values.push(input.content);
  }

  if (sets.length === 0) {
    const existing = await pool.query(
      `SELECT id, tournament_id, title, content, created_at, updated_at
       FROM regulations WHERE id = $1`,
      [id],
    );
    if (existing.rowCount === 0) return null;
    return mapRegulation(existing.rows[0]);
  }

  sets.push("updated_at = NOW()");
  values.push(id);

  await pool.query(
    `UPDATE regulations SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );

  const result = await pool.query(
    `SELECT id, tournament_id, title, content, created_at, updated_at
     FROM regulations WHERE id = $1`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapRegulation(result.rows[0]);
}

export async function deleteRegulation(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query("DELETE FROM regulations WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}
