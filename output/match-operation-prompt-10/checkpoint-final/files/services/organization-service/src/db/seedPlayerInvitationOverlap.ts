import { createHash } from "node:crypto";
import { Pool } from "pg";

const tournaments = [
  { key: "sftms-player-invite-overlap-a-2026", name: "Kiểm thử lời mời cầu thủ trùng lịch — Giải A" },
  { key: "sftms-player-invite-overlap-b-2026", name: "Kiểm thử lời mời cầu thủ trùng lịch — Giải B" },
  { key: "sftms-player-invite-nonoverlap-c-2026", name: "Kiểm thử lời mời cầu thủ không trùng lịch — Giải C" },
] as const;
const manualPlayerCount = 8;

function idFor(key: string): string {
  const bytes = createHash("sha256").update(`sftms-demo-dataset-v1:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function main(): Promise<void> {
  if (!(process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")) throw new Error("Fixture is restricted to development/test");
  if (process.env.DEMO_INTER_SCHOOL === "true") throw new Error("Fixture requires single-school demo data");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const tournamentServiceUrl = process.env.TOURNAMENT_SERVICE_URL;
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!tournamentServiceUrl || !internalApiKey) throw new Error("TOURNAMENT_SERVICE_URL and INTERNAL_API_KEY are required");
  const teamId = idFor("dataset-team-31");
  const captainId = idFor("dataset-captain-31");
  const tournamentInfo = await Promise.all(tournaments.map(async (item) => {
    const tournamentId = idFor(item.key);
    const response = await fetch(new URL(`/tournaments/${encodeURIComponent(tournamentId)}`, tournamentServiceUrl), {
      headers: { "x-gateway-internal-key": internalApiKey }, signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Could not read seeded tournament ${item.name}: HTTP ${response.status}`);
    const payload = await response.json() as { tournament?: { id?: string; name?: string; startDate?: string | null; endDate?: string | null } };
    const tournament = payload.tournament;
    if (tournament?.id !== tournamentId || !tournament.startDate || !tournament.endDate) throw new Error(`Seeded tournament ${item.name} needs valid event dates`);
    return { ...item, id: tournamentId, name: tournament.name ?? item.name, startDate: tournament.startDate.slice(0, 10), endDate: tournament.endDate.slice(0, 10) };
  }));
  const [eventA, eventB, eventC] = tournamentInfo;
  if (eventA.startDate > eventB.endDate || eventB.startDate > eventA.endDate) throw new Error("Seed 1 overlap tournaments must have overlapping event dates");
  let existingRegistrationPreserved = false;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sftms-player-invite-overlap-v1')::bigint)");
      const team = await client.query<{ captain_id: string; is_active: boolean }>(
        "SELECT captain_id,is_active FROM teams WHERE id=$1 FOR SHARE", [teamId],
      );
      if (!team.rowCount || team.rows[0]!.captain_id !== captainId || !team.rows[0]!.is_active) {
        throw new Error("IUH Demo Club 31 is missing or does not match its stable demo identity");
      }
      const teamName = await client.query<{ name: string }>("SELECT name FROM teams WHERE id=$1 FOR UPDATE", [teamId]);
      if (teamName.rows[0]?.name === "IUH Demo Club 31") {
        await client.query("UPDATE teams SET name='IUH Warriors',short_name='IUH Warriors',updated_at=NOW() WHERE id=$1", [teamId]);
      } else if (teamName.rows[0]?.name !== "IUH Warriors") {
        throw new Error(`IUH demo team 31 has an unexpected name: ${teamName.rows[0]?.name ?? "missing"}`);
      }
      const players = await client.query<{
        id: string; user_id: string; jersey_number: number; position: string;
      }>(
        `SELECT id,user_id,jersey_number,position FROM players
         WHERE team_id=$1 AND left_at IS NULL AND user_id IS NOT NULL
         AND NULLIF(BTRIM(full_name),'') IS NOT NULL AND NULLIF(BTRIM(student_id),'') IS NOT NULL
         ORDER BY CASE position WHEN 'GK' THEN 0 WHEN 'DEF' THEN 1 WHEN 'MID' THEN 2 WHEN 'FWD' THEN 3 ELSE 4 END, jersey_number,id LIMIT 20`, [teamId],
      );
      if (players.rowCount !== 20) throw new Error("IUH Demo Club 31 needs 20 linked active players");
      const positionSet = new Set(players.rows.map((player) => player.position));
      if (!["GK", "DEF", "MID", "FWD"].every((position) => positionSet.has(position))) throw new Error("IUH Demo Club 31 fixture needs GK, DEF, MID, and FWD players");
      // Keep the original 14 stable invitation IDs, then add #15 (FW) to the confirmed roster.
      const fixturePlayers = players.rows.filter((player, index) => index < 14 || player.jersey_number === 15);
      if (fixturePlayers.length !== 15 || !fixturePlayers.some((player) => player.jersey_number === 15)) throw new Error("Seed 1 fixture needs the #15 forward account for a balanced roster");
      const tournamentIds = tournamentInfo.map((item) => item.id);
      const registrations = await client.query(
        "SELECT 1 FROM team_registrations WHERE team_id=$1 AND tournament_id=ANY($2::uuid[]) LIMIT 1", [teamId,tournamentIds],
      );
      existingRegistrationPreserved = Boolean(registrations.rowCount);
      // Once either roster has been submitted, preserve its snapshot and all invitation history on reruns.
      for (const [tournamentIndex, tournament] of (registrations.rowCount ? [] : tournamentInfo.entries())) {
        for (const [index, player] of fixturePlayers.entries()) {
          const invitationId = idFor(tournament.key + "-invitation-31-" + String(index + 1).padStart(2, "0"));
          const existing = await client.query<{ tournament_id: string; team_id: string; player_id: string; status: string; conflict_tournament_id: string | null }>(
            "SELECT tournament_id,team_id,player_id,status,conflict_tournament_id FROM tournament_player_invitations WHERE id=$1 FOR UPDATE", [invitationId],
          );
          if (existing.rowCount) {
            const row = existing.rows[0]!;
            if (row.tournament_id !== tournament.id || row.team_id !== teamId || row.player_id !== player.id) {
              throw new Error("Existing invitation conflicts with fixture; refusing to overwrite it");
            }
          } else {
            await client.query(
              `INSERT INTO tournament_player_invitations(
                id,tournament_id,team_id,player_id,player_user_id,invited_by,competition_role,lineup_role,is_goalkeeper,
                proposed_jersey_number,position_snapshot,message,status,expires_at,
                tournament_start_date,tournament_end_date,tournament_name
              ) VALUES($1,$2,$3,$4,$5,$6,'PLAYER',$7,$8,$9,$10,$11,'PENDING',NOW()+INTERVAL '14 days',$12::date,$13::date,$14)`,
              [invitationId,tournament.id,teamId,player.id,player.user_id,captainId,player.jersey_number <= 6 || player.jersey_number === 15 ? "STARTER" : "SUBSTITUTE",
                player.position === "GK",player.jersey_number,player.position,
                "Lời mời Seed 1 để kiểm thử roster và xung đột thời gian giải.",tournament.startDate,tournament.endDate,tournament.name],
            );
          }
          if (player.jersey_number === 11) {
            await client.query(
              `UPDATE tournament_player_invitations SET status='CANCELLED',responded_at=COALESCE(responded_at,NOW()),
                 status_reason='Cầu thủ dự phòng của Seed 1',updated_at=NOW()
               WHERE id=$1 AND status='PENDING'`,
              [invitationId],
            );
          }
          const lineupRole = player.jersey_number <= 6 || player.jersey_number === 15 ? "STARTER" : "SUBSTITUTE";
          await client.query(
            `UPDATE tournament_player_invitations SET lineup_role=$2,is_goalkeeper=$3,updated_at=NOW()
             WHERE id=$1 AND (lineup_role<>$2 OR is_goalkeeper<>$3)`,
            [invitationId,lineupRole,player.position === "GK" && lineupRole === "STARTER"],
          );
          const isConfirmedRosterPlayer = player.jersey_number <= 10 || player.jersey_number === 15;
          if (tournamentIndex === 0 && isConfirmedRosterPlayer) {
            await client.query(
              `UPDATE tournament_player_invitations SET status='ACCEPTED',responded_at=COALESCE(responded_at,NOW()),
                 updated_at=NOW(),tournament_start_date=$2::date,tournament_end_date=$3::date,tournament_name=$4
               WHERE id=$1 AND status='PENDING' RETURNING id`,
              [invitationId,tournament.startDate,tournament.endDate,tournament.name],
            );
            // Preserve an existing manual response when rerunning after a user has tested the fixture.
          } else if (tournamentIndex === 1 && isConfirmedRosterPlayer) {
            const changed = await client.query<{ id: string }>(
              `UPDATE tournament_player_invitations SET status='INVALIDATED',conflict_tournament_id=$2,conflict_tournament_name=$3,
                 status_reason='Đã xác nhận tham gia Giải A có thời gian trùng nhau',updated_at=NOW(),
                 tournament_start_date=$4::date,tournament_end_date=$5::date,tournament_name=$6
               WHERE id=$1 AND status='PENDING' RETURNING id`,
              [invitationId,eventA.id,eventA.name,tournament.startDate,tournament.endDate,tournament.name],
            );
            if (changed.rowCount) {
              const playerName = await client.query<{ full_name: string }>("SELECT full_name FROM players WHERE id=$1", [player.id]);
              const noticeData = JSON.stringify({ invitationId, status: "INVALIDATED", acceptedTournamentId: eventA.id, acceptedTournamentName: eventA.name, invalidatedTournamentId: eventB.id });
              for (const recipient of [
                { userId: captainId, suffix: "captain", title: "Lời mời cầu thủ đã bị vô hiệu hóa", body: `Cầu thủ ${playerName.rows[0]?.full_name ?? "Cầu thủ"} đã xác nhận tham gia giải ${eventA.name}. Lời mời tham gia giải ${eventB.name} đã bị vô hiệu hóa. Vui lòng chọn cầu thủ thay thế.` },
                { userId: player.user_id, suffix: "player", title: "Lời mời tham gia giải không còn hiệu lực", body: `Lời mời tham gia giải ${eventB.name} đã bị vô hiệu hóa vì bạn đã xác nhận tham gia giải ${eventA.name}.` },
              ]) {
                await client.query(
                  `INSERT INTO organization_notification_outbox(user_id,type,title,body,data,idempotency_key)
                   VALUES($1,'TOURNAMENT_INVITATION',$2,$3,$4::jsonb,$5)
                   ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
                  [recipient.userId,recipient.title,recipient.body,noticeData,`seed1-overlap:${invitationId}:${recipient.suffix}`],
                );
              }
            }
          } else {
            await client.query(
              `UPDATE tournament_player_invitations SET tournament_start_date=$2::date,tournament_end_date=$3::date,tournament_name=$4,updated_at=NOW()
               WHERE id=$1 AND status='PENDING'`,
              [invitationId,tournament.startDate,tournament.endDate,tournament.name],
            );
          }
        }
      }
      // P01 and P02 test only the overlapping A/B pair; remove incidental C invitations
      // that the legacy 14-player base fixture created for those two accounts.
      await client.query(
        `UPDATE tournament_player_invitations invitation
         SET status='CANCELLED',responded_at=COALESCE(responded_at,NOW()),
             status_reason='Seed 1 manual P01/P02 scenarios only use tournaments A and B',updated_at=NOW()
         FROM players player
         WHERE invitation.player_id=player.id AND invitation.team_id=$1 AND invitation.tournament_id=$2
           AND invitation.status='PENDING' AND player.team_id=$1 AND player.jersey_number IN (12,13)`,
        [teamId,eventC.id],
      );
      // These extra stable invitation rows are the manual P03-P08 scenarios. Insert-only
      // makes rerunning the seed safe after the user has accepted, declined, or tested them.
      const manualSpecs = [
        { jersey: 16, tournament: eventA, status: "ACCEPTED" }, // P03
        { jersey: 16, tournament: eventC, status: "PENDING" },
        { jersey: 17, tournament: eventA, status: "PENDING" }, // P04
        { jersey: 17, tournament: eventB, status: "PENDING" },
        { jersey: 17, tournament: eventC, status: "PENDING" },
        { jersey: 18, tournament: eventA, status: "PENDING" }, // P05
        { jersey: 18, tournament: eventB, status: "PENDING" },
        { jersey: 19, tournament: eventA, status: "PENDING" }, // P06
        { jersey: 20, tournament: eventA, status: "ACCEPTED" }, // P07
        { jersey: 11, tournament: eventA, status: "DECLINED" }, // P08
      ] as const;
      for (const spec of manualSpecs) {
        const player = players.rows.find((item) => item.jersey_number === spec.jersey);
        if (!player) throw new Error(`Missing manual Seed 1 player jersey ${spec.jersey}`);
        const invitationId = idFor(`seed1-manual-${spec.tournament.key}-team31-jersey-${spec.jersey}`);
        await client.query(
          `INSERT INTO tournament_player_invitations(
            id,tournament_id,team_id,player_id,player_user_id,invited_by,competition_role,lineup_role,is_goalkeeper,
            proposed_jersey_number,position_snapshot,message,status,expires_at,responded_at,
            tournament_start_date,tournament_end_date,tournament_name
          ) VALUES($1,$2,$3,$4,$5,$6,'PLAYER',$7,$8,$9,$10,$11,$12::varchar,NOW()+INTERVAL '90 days',
            CASE WHEN $12::varchar IN ('ACCEPTED','DECLINED') THEN NOW() ELSE NULL END,$13::date,$14::date,$15)
          ON CONFLICT(id) DO NOTHING`,
          [invitationId,spec.tournament.id,teamId,player.id,player.user_id,captainId,
            spec.jersey <= 7 ? "STARTER" : "SUBSTITUTE",player.position === "GK",player.jersey_number,player.position,
            `Seed 1 · kiểm thử thủ công P${String(spec.jersey === 11 ? 8 : spec.jersey - 13).padStart(2,"0")}`,
            spec.status,spec.tournament.startDate,spec.tournament.endDate,spec.tournament.name],
        );
        const inserted = await client.query<{ tournament_id: string; team_id: string; player_id: string }>(
          "SELECT tournament_id,team_id,player_id FROM tournament_player_invitations WHERE id=$1", [invitationId],
        );
        if (!inserted.rowCount || inserted.rows[0]!.tournament_id !== spec.tournament.id || inserted.rows[0]!.team_id !== teamId || inserted.rows[0]!.player_id !== player.id) {
          throw new Error(`Manual Seed 1 invitation identity conflict for jersey ${spec.jersey}`);
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const acceptedRows = await pool.query<{ id: string; tournament_id: string; team_id: string; player_id: string; lineup_role: string; is_goalkeeper: boolean; position_snapshot: string | null }>(
      `SELECT id,tournament_id,team_id,player_id,lineup_role,is_goalkeeper,position_snapshot FROM tournament_player_invitations
       WHERE tournament_id=$1 AND team_id=$2 AND status='ACCEPTED' ORDER BY player_id`, [eventA.id,teamId],
    );
    await pool.query(
      `INSERT INTO tournament_registration_drafts(team_id,tournament_id,updated_by,roster,notes)
       SELECT $1,$2,$3,COALESCE(jsonb_agg(jsonb_build_object(
         'playerId',invitation.player_id,'competitionRole',invitation.competition_role,
         'lineupRole',invitation.lineup_role,'isGoalkeeper',invitation.is_goalkeeper,
         'proposedJerseyNumber',invitation.proposed_jersey_number,'position',invitation.position_snapshot
       ) ORDER BY invitation.proposed_jersey_number),'[]'::jsonb),
       'Seed 1 draft: roster đã xác nhận, đội trưởng tự gửi hồ sơ khi sẵn sàng.'
       FROM tournament_player_invitations invitation
       WHERE invitation.team_id=$1 AND invitation.tournament_id=$2 AND invitation.status='ACCEPTED'
         AND NOT EXISTS(SELECT 1 FROM team_registrations registration WHERE registration.team_id=$1 AND registration.tournament_id=$2)
       HAVING COUNT(*)>0
       ON CONFLICT(team_id,tournament_id) DO NOTHING`, [teamId,eventA.id,captainId],
    );
    const approvedTeamId = idFor("dataset-team-01");
    const approvedCaptainId = idFor("dataset-captain-01");
    const approvedTournamentId = idFor("sftms-test-seed-1-expanded-2026");
    const approvedRegistration = await pool.query<{ id: string }>(
      "SELECT id FROM team_registrations WHERE team_id=$1 AND tournament_id=$2 AND status='APPROVED'",
      [approvedTeamId,approvedTournamentId],
    );
    if (approvedRegistration.rowCount) {
      await pool.query(
        `INSERT INTO team_registration_withdrawal_requests(id,registration_id,team_id,tournament_id,requested_by,reason,status)
         SELECT $1,$2,$3,$4,$5,'Yêu cầu rút demo đang chờ BTC xử lý; Seed không quyết định thay người dùng.','PENDING'
         WHERE NOT EXISTS(SELECT 1 FROM team_registration_withdrawal_requests WHERE registration_id=$2 AND status='PENDING')
         ON CONFLICT(id) DO NOTHING`,
        [idFor("seed1-pending-team-withdrawal-team01"),approvedRegistration.rows[0]!.id,approvedTeamId,approvedTournamentId,approvedCaptainId],
      );
    }
    for (const invitation of acceptedRows.rows) {
      const response = await fetch(new URL("/internal/player-participation/invitations/reserve", tournamentServiceUrl), {
        method: "POST", headers: { "content-type": "application/json", "x-gateway-internal-key": internalApiKey },
        body: JSON.stringify({ invitationId: invitation.id, tournamentId: invitation.tournament_id, teamId: invitation.team_id, playerId: invitation.player_id }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Could not reserve accepted Seed 1 player ${invitation.player_id}: HTTP ${response.status} ${detail}`);
      }
    }
    const playerNumbers = playersForOutput();
    const counts = await pool.query<{ tournament_id: string; status: string; count: string }>(
      `SELECT tournament_id,status,COUNT(*)::text AS count FROM tournament_player_invitations
       WHERE tournament_id=ANY($1::uuid[]) AND team_id=$2 GROUP BY tournament_id,status ORDER BY tournament_id,status`,
      [tournamentInfo.map((item) => item.id),teamId],
    );
    const overlapAvailability = await fetch(new URL(`/internal/tournaments/${eventB.id}/player-availability`, tournamentServiceUrl), {
      method: "POST", headers: { "content-type": "application/json", "x-gateway-internal-key": internalApiKey },
      body: JSON.stringify({ teamId, playerIds: playerNumbers.map((player) => player.id) }), signal: AbortSignal.timeout(8_000),
    });
    if (!overlapAvailability.ok) throw new Error(`Could not verify Seed 1 overlap filtering: HTTP ${overlapAvailability.status}`);
    const availability = await overlapAvailability.json() as { unavailablePlayerIds?: string[] };
    const expectedUnavailable = acceptedRows.rows.map((row) => row.player_id).sort();
    if (JSON.stringify([...(availability.unavailablePlayerIds ?? [])].sort()) !== JSON.stringify(expectedUnavailable)) {
      throw new Error("Seed 1 validation failed: accepted A roster is not fully hidden from overlapping B roster selection");
    }
    const manualInvitations = await pool.query<{ email: string; full_name: string; player_number: number; position: string; statuses: string }>(
      `SELECT p.contact_email AS email,p.full_name,(p.jersey_number + 600)::int AS player_number,p.position,
         STRING_AGG(DISTINCT t.label || '=' || i.status, ', ' ORDER BY t.label || '=' || i.status) AS statuses
       FROM players p JOIN tournament_player_invitations i ON i.player_id=p.id AND i.team_id=p.team_id
       JOIN (VALUES($2::uuid,'A'),($3::uuid,'B'),($4::uuid,'C')) t(id,label) ON t.id=i.tournament_id
       WHERE p.team_id=$1 AND p.left_at IS NULL AND p.jersey_number BETWEEN 11 AND 20
       GROUP BY p.id,p.contact_email,p.full_name,p.jersey_number,p.position ORDER BY p.jersey_number`,
      [teamId,eventA.id,eventB.id,eventC.id],
    );
    if ((manualInvitations.rowCount ?? 0) < manualPlayerCount) throw new Error("Seed 1 validation failed: manual test-player invitations are missing");
    const starterCount = acceptedRows.rows.filter((row) => row.lineup_role === "STARTER").length;
    const goalkeeperCount = acceptedRows.rows.filter((row) => row.lineup_role === "STARTER" && row.is_goalkeeper).length;
    console.log(JSON.stringify({
      seed: "Seed 1 roster overlap",
      teamId, team: "IUH Warriors", institution: "Đại học Công nghiệp Thành phố Hồ Chí Minh", captain: "dataset.captain31@football.local",
      tournaments: tournamentInfo,
      existingRegistrationPreserved,
      overlapAvailability: { checked: playerNumbers.length, unavailable: expectedUnavailable.length, eligible: playerNumbers.length - expectedUnavailable.length },
      invitationStatusCounts: counts.rows,
      manualPlayers: manualInvitations.rows,
      readyRosterA: { accepted: acceptedRows.rows.length, starters: starterCount, substitutes: acceptedRows.rows.length - starterCount, goalkeepers: goalkeeperCount, positions: [...new Set(acceptedRows.rows.map((row) => row.position_snapshot).filter((position): position is string => Boolean(position)))], canSubmit: acceptedRows.rows.length >= 7 && acceptedRows.rows.length <= 18 && starterCount === 7 && goalkeeperCount === 1 },
      replacementPool: ["dataset.player0611@football.local", "dataset.player0616@football.local through dataset.player0620@football.local"],
    }, null, 2));
  } finally {
    await pool.end();
  }
}

function playersForOutput(): Array<{ id: string }> {
  return Array.from({ length: 20 }, (_, index) => ({ id: idFor(`dataset-player-${String(601 + index).padStart(4, "0")}`) }));
}

if (require.main === module) main().catch((error: unknown) => {
  console.error("[player-invitation-overlap-seed] failed", error);
  process.exitCode = 1;
});
