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
            t.min_players, t.max_players_per_team, t.start_date, t.end_date,
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
                'yellowCardsForSuspension', rules.yellow_cards_for_suspension,
                'suspensionMatches', rules.suspension_matches,
                'complaintWindowHours', rules.complaint_window_hours,
                'minimumRestMinutes', rules.minimum_rest_minutes,
                'matchDurationMinutes', rules.match_duration_minutes,
                'forfeitPolicy', rules.forfeit_policy,
                'forfeitWinnerScore', rules.forfeit_winner_score,
                'forfeitLoserScore', rules.forfeit_loser_score,
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
           min_teams, max_teams, min_players, max_players_per_team,
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
           ), '[]'::json) AS registration_periods
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

export type ExistingRegistrationCounts = { total: number; institution: number };

export async function reserveTournamentRegistration(input: {
  registrationId: string;
  tournamentId: string;
  teamId: string;
  institutionId: string;
  maxTeams: number;
  defaultMaxTeamsPerInstitution: number | null;
  institutionTeamLimits: InstitutionTeamLimit[];
  loadExistingCounts: () => Promise<ExistingRegistrationCounts>;
}): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [input.tournamentId]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`team-registration:${input.teamId}`]);
    await client.query(
      `DELETE FROM tournament_registration_reservations
       WHERE tournament_id = $1 AND persisted_in_organization = FALSE
         AND expires_at <= NOW()`,
      [input.tournamentId],
    );
    const duplicate = await client.query<{ registration_id: string }>(
      `SELECT registration_id FROM tournament_registration_reservations
       WHERE tournament_id = $1 AND team_id = $2 AND status IN ('PENDING', 'APPROVED')`,
      [input.tournamentId, input.teamId],
    );
    if (duplicate.rowCount) {
      if (duplicate.rows[0].registration_id === input.registrationId) {
        await client.query("COMMIT");
        return;
      }
      throw new AppError(409, "This team already has a registration for the tournament", "ALREADY_REGISTERED");
    }

    const scheduleConflict = await client.query<{ name: string }>(
      `SELECT other.name
       FROM tournaments current
       JOIN tournaments other ON other.id <> current.id
       JOIN tournament_registration_reservations r ON r.tournament_id = other.id
       WHERE current.id = $1 AND r.team_id = $2 AND r.status = 'APPROVED'
         AND r.persisted_in_organization = TRUE
         AND current.start_date IS NOT NULL AND current.end_date IS NOT NULL
         AND other.start_date IS NOT NULL AND other.end_date IS NOT NULL
         AND current.start_date <= other.end_date AND current.end_date >= other.start_date
       LIMIT 1`,
      [input.tournamentId, input.teamId],
    );
    if (scheduleConflict.rowCount) {
      throw new AppError(409, `This team is already approved for ${scheduleConflict.rows[0].name}, whose dates overlap this tournament`, "TEAM_TOURNAMENT_DATE_CONFLICT");
    }

    const existing = await input.loadExistingCounts();
    const pendingReservations = await client.query<{
      total: string;
      institution: string;
    }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE institution_id = $2)::text AS institution
       FROM tournament_registration_reservations
       WHERE tournament_id = $1 AND persisted_in_organization = FALSE
         AND status IN ('PENDING', 'APPROVED') AND expires_at > NOW()`,
      [input.tournamentId, input.institutionId],
    );
    const reservedTotal = Number(pendingReservations.rows[0]?.total ?? 0);
    const reservedInstitution = Number(pendingReservations.rows[0]?.institution ?? 0);
    if (existing.total + reservedTotal >= input.maxTeams) {
      throw new AppError(409, "The tournament has reached its maximum number of teams", "TOURNAMENT_TEAM_LIMIT_REACHED");
    }

    const schoolOverride = input.institutionTeamLimits.find(
      (limit) => limit.institutionId === input.institutionId,
    );
    const schoolLimit = schoolOverride
      ? schoolOverride.maxTeams
      : input.defaultMaxTeamsPerInstitution;
    if (
      schoolLimit !== null &&
      existing.institution + reservedInstitution >= schoolLimit
    ) {
      throw new AppError(409, "Your school's team limit for this tournament has been reached", "INSTITUTION_TEAM_LIMIT_REACHED");
    }

    await client.query(
      `INSERT INTO tournament_registration_reservations
         (registration_id, tournament_id, team_id, institution_id)
       VALUES ($1, $2, $3, $4)`,
      [input.registrationId, input.tournamentId, input.teamId, input.institutionId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateTournamentRegistrationReservation(
  registrationId: string,
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN",
  persistedInOrganization: boolean,
  registration?: { tournamentId: string; teamId: string; institutionId: string },
): Promise<string[]> {
  if (status === "APPROVED" && registration) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`team-registration:${registration.teamId}`]);
      const target = await client.query<{ start_date: string | null; end_date: string | null; name: string }>(
        "SELECT start_date, end_date, name FROM tournaments WHERE id = $1 FOR SHARE", [registration.tournamentId],
      );
      const dates = target.rows[0];
      if (!dates?.start_date || !dates.end_date) {
        throw new AppError(409, "Set the tournament start and end dates before approving a team", "TOURNAMENT_DATES_REQUIRED");
      }
      const overlaps = await client.query<{ registration_id: string; status: string; name: string }>(
        `SELECT r.registration_id, r.status, t.name
         FROM tournament_registration_reservations r
         JOIN tournaments t ON t.id = r.tournament_id
         WHERE r.team_id = $1 AND r.registration_id <> $2
           AND r.status IN ('PENDING', 'APPROVED') AND r.persisted_in_organization = TRUE
           AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL
           AND t.start_date <= $4 AND t.end_date >= $3
         FOR UPDATE OF r`,
        [registration.teamId, registrationId, dates.start_date, dates.end_date],
      );
      const alreadyApproved = overlaps.rows.find((row) => row.status === "APPROVED");
      if (alreadyApproved) {
        throw new AppError(409, `This team is already approved for ${alreadyApproved.name}, whose dates overlap this tournament`, "TEAM_TOURNAMENT_DATE_CONFLICT");
      }
      const withdrawnIds = overlaps.rows.filter((row) => row.status === "PENDING").map((row) => row.registration_id);
      if (withdrawnIds.length) {
        await client.query(
          `UPDATE tournament_registration_reservations SET status = 'WITHDRAWN', updated_at = NOW()
           WHERE registration_id = ANY($1::uuid[])`, [withdrawnIds],
        );
      }
      await client.query(
        `INSERT INTO tournament_registration_reservations
           (registration_id, tournament_id, team_id, institution_id, status, persisted_in_organization, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'infinity'::timestamptz)
         ON CONFLICT (registration_id) DO UPDATE SET status = EXCLUDED.status,
           persisted_in_organization = EXCLUDED.persisted_in_organization, expires_at = EXCLUDED.expires_at, updated_at = NOW()`,
        [registrationId, registration.tournamentId, registration.teamId, registration.institutionId, status, persistedInOrganization],
      );
      await client.query("COMMIT");
      return withdrawnIds;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  const result = registration
    ? await getPool().query(
      `INSERT INTO tournament_registration_reservations
         (registration_id, tournament_id, team_id, institution_id, status, persisted_in_organization, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 THEN 'infinity'::timestamptz ELSE NOW() + INTERVAL '15 minutes' END)
       ON CONFLICT (registration_id) DO UPDATE
       SET status = EXCLUDED.status,
           persisted_in_organization = EXCLUDED.persisted_in_organization,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
      [
        registrationId,
        registration.tournamentId,
        registration.teamId,
        registration.institutionId,
        status,
        persistedInOrganization,
      ],
    )
    : await getPool().query(
      `UPDATE tournament_registration_reservations
       SET status = $2, persisted_in_organization = $3,
           expires_at = CASE WHEN $3 THEN 'infinity'::timestamptz ELSE expires_at END,
           updated_at = NOW()
       WHERE registration_id = $1`,
      [registrationId, status, persistedInOrganization],
    );
  if (!result.rowCount) {
    throw new AppError(404, "Registration reservation not found", "REGISTRATION_RESERVATION_NOT_FOUND");
  }
  return [];
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
         min_teams, max_teams, min_players, max_players_per_team, start_date, end_date, created_by,
         organizing_institution_id,
         allowed_institution_levels, all_institutions_allowed,
         default_max_teams_per_institution
         )
         VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
         RETURNING id, name, description, status, location, organizer_name, organizer_contact_name,
                   organizer_email, organizer_phone, scope, football_format, competition_format,
                   min_teams, max_teams, min_players, max_players_per_team,
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
        `${input.registrationStart}T00:00:00.000Z`,
        `${input.registrationEnd}T23:59:59.999Z`,
      ],
    );
    const registrationPeriod = mapRegistrationPeriod(registrationResult.rows[0]);
    await client.query(
      `INSERT INTO tournament_rules (
         tournament_id, eligibility_description, points_for_win, points_for_draw, points_for_loss,
         advancing_teams_per_group, yellow_cards_for_suspension, suspension_matches,
         complaint_window_hours, minimum_rest_minutes, match_duration_minutes, forfeit_policy,
         forfeit_winner_score, forfeit_loser_score, published_version, published_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())`,
      [
        tournament.id,
        input.eligibilityDescription,
        input.pointsForWin,
        input.pointsForDraw,
        input.pointsForLoss,
        input.advancingTeamsPerGroup,
        input.yellowCardsForSuspension,
        input.suspensionMatches,
        input.complaintWindowHours,
        input.minimumRestMinutes,
        input.matchDurationMinutes,
        input.forfeitPolicy,
        input.forfeitWinnerScore,
        input.forfeitLoserScore,
        1,
      ],
    );

    const defaultRegulation = [
      "Quy định chung",
      `1. Tất cả đội và cầu thủ phải tuân thủ điều lệ giải, quy định quản lý sự kiện và các yêu cầu an toàn.
2. Đội bóng chỉ được đăng ký nếu đáp ứng số lượng tối thiểu cầu thủ, hồ sơ quy định và trường học được phép tham gia.
3. Mỗi trận đấu tính điểm theo hệ thống: thắng 3 điểm, hòa 1 điểm, thua 0 điểm. Xếp hạng theo điểm số, hiệu số bàn thắng thua, bàn thắng, đối đầu trực tiếp và fair play khi cần.
4. Kỷ luật thi đấu dựa trên thẻ vàng, thẻ đỏ, án treo giò và các trường hợp xử lý theo điều lệ của giải.
5. Mọi khiếu nại phải được gửi trong thời hạn quy định và được BTC xem xét theo quy trình rõ ràng.
6. Đội bóng cần đảm bảo lịch nghỉ tối thiểu, hồ sơ cầu thủ hợp lệ và tuân thủ các cam kết tổ chức trận đấu.
7. BTC có quyền xác nhận kết quả, điều chỉnh lịch và xử lý các trường hợp vi phạm nếu phát sinh trong quá trình thi đấu.`,
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
        yellowCardsForSuspension: input.yellowCardsForSuspension,
        suspensionMatches: input.suspensionMatches,
        complaintWindowHours: input.complaintWindowHours,
        minimumRestMinutes: input.minimumRestMinutes,
        matchDurationMinutes: input.matchDurationMinutes,
        forfeitPolicy: input.forfeitPolicy,
        forfeitWinnerScore: input.forfeitWinnerScore,
        forfeitLoserScore: input.forfeitLoserScore,
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

  if (sets.length === 0) {
    return findTournamentById(id);
  }

  sets.push("updated_at = NOW()");
  values.push(id);

  await pool.query(
    `UPDATE tournaments SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );

  return findTournamentById(id);
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
