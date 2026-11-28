import { config } from "../config";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
import type { PoolClient } from "pg";

export function demoTimeAllowed(tournamentId: string): boolean {
 return ["development","test"].includes(config.nodeEnv) && config.matchDemoModeEnabled && config.matchDemoTournamentIds.includes(tournamentId);
}

/** Only match-domain time changes. Auth expiry, SMTP, outbox leases and audit use wall time. */
export async function matchOperationNow(matchId: string, query: Pick<PoolClient,"query"> = getPool()): Promise<Date> {
 const result = await query.query("SELECT m.tournament_id,d.enabled,d.offset_milliseconds FROM matches m LEFT JOIN match_demo_times d ON d.match_id=m.id WHERE m.id=$1",[matchId]);
 const row = result.rows[0];
 if (row?.enabled && !demoTimeAllowed(row.tournament_id)) throw new AppError(409,"Trận đang dùng thời gian kiểm thử. Cần bật lại cấu hình Development/Test để tiếp tục hoặc kết thúc phiên trước khi tắt cấu hình.","DEMO_TIME_CONFIGURATION_DISABLED");
 return new Date(Date.now() + (row?.enabled ? Number(row.offset_milliseconds) : 0));
}
