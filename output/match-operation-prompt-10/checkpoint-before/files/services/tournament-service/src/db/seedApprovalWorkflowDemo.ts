import { createHash } from "node:crypto";
import { Pool } from "pg";

const schoolCodes = ["SFL-HCM-IUH", "SFL-HCM-HUTECH", "SFL-HCM-UEF", "SFL-HCM-UEH", "SFL-HCM-CAOTHANG", "SFL-HCM-HITU", "SFL-HCM-TDC", "SFL-HCM-HCMCT"];
const variant = process.env.TEST_SEED_VARIANT;
const organizerId = idFor(variant === "draw-demo" || variant === "draw-demo-reset" ? "draw-demo-btc-01" : "dataset-btc-01");

function idFor(key: string): string {
  const bytes = createHash("sha256").update(`sftms-demo-dataset-v1:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type DemoTournament = {
  key: string; name: string; scope: "SINGLE_INSTITUTION" | "INTER_SCHOOL"; institutionId: string;
  minTeams: number; maxTeams: number; maxPerSchool: number | null; groupCapacity: number;
};

async function main(): Promise<void> {
  if (!(process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")) throw new Error("Approval workflow demo seeding is restricted to development/test");
  const databaseUrl = process.env.DATABASE_URL;
  const organizationUrl = process.env.ORGANIZATION_SERVICE_URL;
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!databaseUrl || !organizationUrl || !internalApiKey) throw new Error("DATABASE_URL, ORGANIZATION_SERVICE_URL and INTERNAL_API_KEY are required");

  const institutionEndpoint = variant === "draw-demo" || variant === "draw-demo-reset" ? "/internal/institution-catalog" : "/internal/institutions";
  const institutionsResponse = await fetch(new URL(institutionEndpoint, organizationUrl), {
    headers: { "x-gateway-internal-key": internalApiKey }, signal: AbortSignal.timeout(8_000),
  });
  if (!institutionsResponse.ok) throw new Error(`Organization school catalog returned HTTP ${institutionsResponse.status}`);
  const institutionsBody = await institutionsResponse.json() as { institutions?: Array<{ id: string; code: string; institutionType?: string }> };
  const institutions = new Map((institutionsBody.institutions ?? []).map((item) => [item.code, item]));
  const requiredSchoolCodes = variant === "draw-demo" || variant === "draw-demo-reset"
    ? schoolCodes
    : variant === "expanded-1" || variant === "review-1" || variant === "overlap-1" || variant === "invite-overlap" || variant === "1" || variant === "2"
    ? [schoolCodes[0]!]
    : schoolCodes.slice(0, 4);
  if (requiredSchoolCodes.some((code) => !institutions.has(code))) {
    throw new Error(`Required active schools are missing; activate the Seed 1 school through the ADMIN test setup first: ${requiredSchoolCodes.filter((code) => !institutions.has(code)).join(", ")}`);
  }
  const iuh = institutions.get("SFL-HCM-IUH")!;
  const demoTournaments: DemoTournament[] = [
    { key: "approval-draw-iuh-2026", name: "IUH Student Cup 2026 — Bộ dữ liệu duyệt đội & chia bảng", scope: "SINGLE_INSTITUTION", institutionId: iuh.id, minTeams: 4, maxTeams: 8, maxPerSchool: 12, groupCapacity: 4 },
    { key: "approval-draw-inter-2026", name: "HCMC Inter-School Cup 2026 — Bộ dữ liệu duyệt đội & lập lịch", scope: "INTER_SCHOOL", institutionId: iuh.id, minTeams: 8, maxTeams: 16, maxPerSchool: 4, groupCapacity: 4 },
  ];
  if (variant === "draw-demo" || variant === "draw-demo-reset") {
    demoTournaments.splice(0, demoTournaments.length, {
      key: "draw-workspace-demo-2026",
      name: "[DRAW-DEMO] HCMC University Draw Cup 2026 — 32 đội",
      scope: "INTER_SCHOOL", minTeams: 4, institutionId: iuh.id, maxTeams: 32, maxPerSchool: null, groupCapacity: 8,
    });
  } else if (variant === "expanded-1") {
    demoTournaments.splice(0, demoTournaments.length, {
      key: "sftms-test-seed-1-expanded-2026",
      name: "Seed 1 mở rộng — Vòng tròn · 12 hồ sơ / tối đa 8 / tối thiểu 4",
      scope: "SINGLE_INSTITUTION",
      minTeams: 4,
      institutionId: iuh.id,
      maxTeams: 8,
      maxPerSchool: 12,
      groupCapacity: 4,
    }, {
      key: "sftms-test-seed-1-overlap-2026",
      name: "Seed 1 — Giải B kiểm tra trùng lịch cầu thủ",
      scope: "SINGLE_INSTITUTION",
      minTeams: 4,
      institutionId: iuh.id,
      maxTeams: 8,
      maxPerSchool: 12,
      groupCapacity: 4,
    });
  } else if (variant === "review-1") {
    demoTournaments.splice(0, demoTournaments.length, {
      key: "sftms-test-seed-1-review-2026",
      name: "Seed 1 mở rộng — Vòng tròn · 12 hồ sơ / tối đa 8 / tối thiểu 4 · Kịch bản mới",
      scope: "SINGLE_INSTITUTION", minTeams: 4, institutionId: iuh.id, maxTeams: 8, maxPerSchool: 12, groupCapacity: 4,
    });
  } else if (variant === "overlap-1") {
    demoTournaments.splice(0, demoTournaments.length, {
      key: "sftms-test-seed-1-overlap-a-2026",
      name: "Seed 1 — Giải A kiểm tra trùng lịch cầu thủ",
      scope: "SINGLE_INSTITUTION", minTeams: 4, institutionId: iuh.id, maxTeams: 8, maxPerSchool: 12, groupCapacity: 4,
    }, {
      key: "sftms-test-seed-1-overlap-2026",
      name: "Seed 1 — Giải B kiểm tra trùng lịch cầu thủ",
      scope: "SINGLE_INSTITUTION", minTeams: 4, institutionId: iuh.id, maxTeams: 8, maxPerSchool: 12, groupCapacity: 4,
    });
  } else if (variant === "invite-overlap") {
    demoTournaments.splice(0, demoTournaments.length, {
      key: "sftms-player-invite-overlap-a-2026",
      name: "Kiểm thử lời mời cầu thủ trùng lịch — Giải A",
      scope: "SINGLE_INSTITUTION", minTeams: 4, institutionId: iuh.id, maxTeams: 8, maxPerSchool: 12, groupCapacity: 4,
    }, {
      key: "sftms-player-invite-overlap-b-2026",
      name: "Kiểm thử lời mời cầu thủ trùng lịch — Giải B",
      scope: "SINGLE_INSTITUTION", minTeams: 4, institutionId: iuh.id, maxTeams: 8, maxPerSchool: 12, groupCapacity: 4,
    }, {
      key: "sftms-player-invite-nonoverlap-c-2026",
      name: "Kiểm thử lời mời cầu thủ không trùng lịch — Giải C",
      scope: "SINGLE_INSTITUTION", minTeams: 4, institutionId: iuh.id, maxTeams: 8, maxPerSchool: 12, groupCapacity: 4,
    });
  } else if (variant) {
    const n = Number(variant);
    if (!Number.isInteger(n) || n < 1 || n > 4) throw new Error("TEST_SEED_VARIANT must be 1, 2, 3 or 4");
    demoTournaments.splice(0, demoTournaments.length, {
      key: `sftms-test-seed-${n}-2026`,
      name: ["SFTMS Seed 1 — Nội bộ vòng tròn (8 đội)", "SFTMS Seed 2 — Nội bộ loại trực tiếp (8 đội)", "SFTMS Seed 3 — Liên trường vòng bảng + loại trực tiếp (16 đội)", "SFTMS Seed 4 — Liên trường loại trực tiếp (16 đội)"][n - 1]!,
      scope: n <= 2 ? "SINGLE_INSTITUTION" : "INTER_SCHOOL",
      minTeams: n <= 2 ? 4 : 8,
      institutionId: iuh.id,
      maxTeams: n <= 2 ? 8 : 16,
      maxPerSchool: n <= 2 ? 12 : 4,
      groupCapacity: 4,
    });
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sftms-demo-approval-workflow-tournament-v1')::bigint)");
      for (const item of demoTournaments) {
        const tournamentId = idFor(item.key);
        if (variant === "draw-demo-reset" && item.key === "draw-workspace-demo-2026") {
          const existing = await client.query<{ name: string; created_by: string }>("SELECT name,created_by FROM tournaments WHERE id=$1 FOR UPDATE", [tournamentId]);
          if (existing.rowCount && (existing.rows[0]!.name !== item.name || existing.rows[0]!.created_by !== organizerId)) throw new Error("Refusing to reset an unrelated tournament at the Draw demo ID");
          const locked = await client.query("SELECT 1 FROM tournament_draw_versions WHERE tournament_id=$1 AND status<>'DRAFT' LIMIT 1", [tournamentId]);
          const running = await client.query("SELECT 1 FROM tournament_live_draw_sessions WHERE tournament_id=$1 AND status IN ('LIVE','PAUSED','COMPLETED') LIMIT 1", [tournamentId]);
          if (locked.rowCount || running.rowCount) throw new Error("Cannot reset Draw demo after a draw is confirmed/published or while a live draw is running");
          await client.query("DELETE FROM tournament_draw_versions WHERE tournament_id=$1 AND status='DRAFT'", [tournamentId]);
          await client.query("DELETE FROM tournament_live_draw_sessions WHERE tournament_id=$1 AND status IN ('CANCELLED','FINALIZED')", [tournamentId]);
          await client.query("DELETE FROM tournament_draw_test_configs WHERE tournament_id=$1", [tournamentId]);
        }
        const description = "Dữ liệu development riêng để kiểm thử từ bước BTC xét duyệt đội đến chốt danh sách, chia bảng và lập lịch. Không gửi email khi seed.";
        await client.query(
          `INSERT INTO tournaments (
             id,name,description,status,location,organizer_name,organizer_contact_name,organizer_email,organizer_phone,
             scope,football_format,competition_format,min_teams,max_teams,min_players,max_players_per_team,
             start_date,end_date,created_by,organizing_institution_id,allowed_institution_levels,
             all_institutions_allowed,default_max_teams_per_institution
           ) VALUES (
             $1,$2,$3,$15,'SFL Demo Stadium · Khuôn viên IUH','Ban tổ chức IUH',
             'BTC Demo IUH',$17,'0900000001',$4,7,$11,
             $5,$6,7,18,CURRENT_DATE+$12::int,CURRENT_DATE+$13::int,$7,$8,ARRAY['UNIVERSITY','COLLEGE']::TEXT[],$9,$10
           ) ON CONFLICT (id) DO UPDATE
             SET start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,
                 status=CASE WHEN $16::boolean THEN 'ROSTER_LOCKED' ELSE tournaments.status END
             WHERE $14::boolean`,
          [tournamentId,item.name,description,item.scope,item.minTeams,item.maxTeams,organizerId,item.institutionId,item.scope === "INTER_SCHOOL",item.maxPerSchool,
            variant === "1" || variant === "expanded-1" || variant === "review-1" || variant === "overlap-1" || variant === "invite-overlap" ? "ROUND_ROBIN" : variant === "2" || variant === "4" ? "KNOCKOUT" : "GROUP_AND_KNOCKOUT",
            item.key === "sftms-player-invite-nonoverlap-c-2026" ? 95 : variant === "review-1" ? 180 : variant === "expanded-1" || variant === "overlap-1" || variant === "invite-overlap" ? 60 : 21,
            item.key === "sftms-player-invite-nonoverlap-c-2026" ? 103 : variant === "review-1" ? 188 : variant === "expanded-1" || variant === "overlap-1" || variant === "invite-overlap" ? 68 : 29, variant === "expanded-1" || variant === "review-1" || variant === "overlap-1" || variant === "invite-overlap", item.key === "draw-workspace-demo-2026" ? "ROSTER_LOCKED" : "OPEN_REGISTRATION", variant === "draw-demo-reset", variant === "draw-demo" || variant === "draw-demo-reset" ? "drawdemo.btc01@football.local" : "dataset.btc01@football.local"],
        );
        const identity = await client.query<{ name: string; created_by: string; status: string }>("SELECT name,created_by,status FROM tournaments WHERE id=$1", [tournamentId]);
        if (identity.rows[0]?.name !== item.name || identity.rows[0]?.created_by !== organizerId) throw new Error(`Stable tournament ID collision for ${item.name}`);

        await client.query(
          `INSERT INTO registration_periods(id,tournament_id,name,start_date,end_date)
           VALUES($1,$2,'Đăng ký demo',NOW()-INTERVAL '1 day',NOW()+INTERVAL '14 days')
           ON CONFLICT(id) DO UPDATE SET start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date
             WHERE $3::boolean`,
          [idFor(`${item.key}-registration-period`),tournamentId,variant === "review-1"],
        );
        await client.query(
          `INSERT INTO tournament_rules(tournament_id,eligibility_description,points_for_win,points_for_draw,points_for_loss,
             advancing_teams_per_group,round_robin_legs,max_teams_per_group,knockout_decision_method,extra_time_minutes,
             planned_pitch_count,playable_hours_per_day,minimum_rest_minutes,match_duration_minutes,forfeit_policy,
             forfeit_winner_score,forfeit_loser_score)
           VALUES($1,'Cầu thủ là thành viên hợp lệ của CLB thuộc trường; roster tối thiểu 7, tối đa 18 cầu thủ.',3,1,0,
             2,1,$2,'EXTRA_TIME_THEN_PENALTIES',10,3,10,60,60,'ORGANIZER_DECISION',3,0)
           ON CONFLICT(tournament_id) DO NOTHING`,
          [tournamentId,item.groupCapacity],
        );
        await client.query(
          `INSERT INTO tournament_ranking_criteria(tournament_id,priority,criterion)
           VALUES($1,1,'POINTS'),($1,2,'GOAL_DIFFERENCE'),($1,3,'GOALS_FOR'),($1,4,'HEAD_TO_HEAD')
           ON CONFLICT DO NOTHING`, [tournamentId],
        );
        if (item.scope === "SINGLE_INSTITUTION") {
          await client.query("INSERT INTO tournament_allowed_institutions(tournament_id,institution_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [tournamentId,item.institutionId]);
        }
        if (item.scope === "INTER_SCHOOL") {
          for (const code of schoolCodes) await client.query("INSERT INTO tournament_allowed_institutions(tournament_id,institution_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [tournamentId,institutions.get(code)!.id]);
          await client.query(
            `INSERT INTO tournament_institution_limits(tournament_id,institution_id,max_teams)
             SELECT $1,id,$3 FROM unnest($2::uuid[]) AS id ON CONFLICT(tournament_id,institution_id) DO NOTHING`,
            [tournamentId,schoolCodes.slice(0, variant && variant !== "draw-demo" ? 4 : schoolCodes.length).map((code) => institutions.get(code)!.id),item.maxPerSchool],
          );
        }
        await client.query("INSERT INTO tournament_organizers(tournament_id,user_id,assigned_by) VALUES($1,$2,$2) ON CONFLICT DO NOTHING", [tournamentId,organizerId]);
        await client.query(
          `INSERT INTO tournament_organizer_history(tournament_id,user_id,action,actor_id)
           SELECT $1,$2,'ASSIGNED',$2 WHERE NOT EXISTS(
             SELECT 1 FROM tournament_organizer_history WHERE tournament_id=$1 AND user_id=$2 AND action='ASSIGNED'
           )`, [tournamentId,organizerId],
        );
        await client.query("INSERT INTO tournament_workflow_state(tournament_id,current_step,updated_by) VALUES($1,$3,$2) ON CONFLICT(tournament_id) DO UPDATE SET current_step=CASE WHEN $4::boolean THEN 4 ELSE tournament_workflow_state.current_step END,updated_at=CASE WHEN $4::boolean THEN NOW() ELSE tournament_workflow_state.updated_at END", [tournamentId,organizerId,item.key === "draw-workspace-demo-2026" ? 4 : 2,variant === "draw-demo-reset"]);
        await client.query(
          `INSERT INTO regulations(tournament_id,title,content)
           SELECT $1,'Điều lệ demo',CASE WHEN $2='ROUND_ROBIN' THEN 'Giải bóng đá 7 người, thể thức vòng tròn ' || $3 || ' lượt. Mỗi đội đăng ký 7–18 cầu thủ. Thắng 3 điểm, hòa 1 điểm.' WHEN $2='KNOCKOUT' THEN 'Giải bóng đá 7 người, loại trực tiếp, 8 hoặc 16 đội không cần BYE. Mỗi đội đăng ký 7–18 cầu thủ.' ELSE 'Giải bóng đá 7 người. Thể thức 4 bảng, mỗi bảng 4 đội; 2 đội đầu bảng vào tứ kết. Mỗi đội đăng ký 7–18 cầu thủ.' END
            WHERE NOT EXISTS(SELECT 1 FROM regulations WHERE tournament_id=$1 AND title='Điều lệ demo')`,
          [tournamentId,variant === "1" ? "ROUND_ROBIN" : variant === "2" || variant === "4" ? "KNOCKOUT" : "GROUP_AND_KNOCKOUT",1],
        );
      }
      if (variant === "review-1") {
        const reviewTournamentId = idFor("sftms-test-seed-1-review-2026");
        await client.query("UPDATE tournaments SET status='OPEN_REGISTRATION',updated_at=NOW() WHERE id=$1", [reviewTournamentId]);
        await client.query("UPDATE tournament_workflow_state SET current_step=2,updated_at=NOW() WHERE tournament_id=$1", [reviewTournamentId]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    const ids = demoTournaments.map((item) => idFor(item.key));
    const result = await pool.query("SELECT id,name,status,scope,max_teams FROM tournaments WHERE id=ANY($1::uuid[]) ORDER BY name", [ids]);
    console.log(JSON.stringify({ seed: "approval-workflow-demo-tournaments", tournaments: result.rows }, null, 2));
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((error: unknown) => { console.error("[approval-workflow-demo-tournaments] failed", error); process.exitCode = 1; });
