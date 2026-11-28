import {assertRecordedOutcome} from './matchOutcomeRepository';
import {getMatchShootout} from './matchShootoutRepository';
import {writeMatchEvent,voidRecordedEvent,mapEvent} from './matchEventMutationRepository';
import type {
  Lineup,
  MatchEvent,
  MatchEventCreateInput,
  MatchReport,
  MatchReportCreateInput,
  MatchReportSubmissionSnapshot,
  MatchReportUpdateInput,
} from "../models/match";
import type { PoolClient } from "pg";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
import { advanceApprovedKnockoutWinner, recalculateStandings } from "./matchRepository";
import { publishMatchUpdate } from "../realtime/matchRealtime";

// Lineups
function mapLineup(row: {
  id: string;
  match_id: string;
  team_id: string;
  player_id: string;
  position: string | null;
  jersey_number: number | null;
  is_starting: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
}): Lineup {
  return {
    id: row.id,
    matchId: row.match_id,
    teamId: row.team_id,
    playerId: row.player_id,
    position: row.position,
    jerseyNumber: row.jersey_number,
    isStarting: row.is_starting,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

export async function listLineups(matchId: string, teamId?: string): Promise<Lineup[]> {
  const pool = getPool();
  let query = `
    SELECT id, match_id, team_id, player_id, position, jersey_number, is_starting, confirmed_by, confirmed_at, created_at
    FROM lineups
    WHERE match_id = $1
  `;
  const params: unknown[] = [matchId];

  if (teamId) {
    query += ` AND team_id = $2`;
    params.push(teamId);
  }

  query += ` ORDER BY is_starting DESC, jersey_number ASC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapLineup);
}

// Match Events
export async function listMatchEvents(matchId: string, teamId?: string, includeCrew=false): Promise<MatchEvent[]> {
  const pool = getPool();
  let query = `
    SELECT *
    FROM match_events
    WHERE match_id = $1 AND voided_at IS NULL
  `;
  const params: unknown[] = [matchId];
  if(!includeCrew)query+=` AND visibility='PUBLIC'`;
  if(teamId){query+=` AND team_id=$2`;params.push(teamId);}
  query+=` ORDER BY COALESCE(logical_sequence,event_sequence) ASC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapEvent);
}

export async function findMatchEventById(id: string): Promise<MatchEvent | null> {
  const result = await getPool().query(
    `SELECT *
     FROM match_events
     WHERE id = $1`,
    [id],
  );
  return result.rowCount === 0 ? null : mapEvent(result.rows[0]);
}

export const createMatchEvent=writeMatchEvent;
export const deleteMatchEvent=voidRecordedEvent;

import * as reports from './matchReportRepository';
export const findMatchReportByMatchId=reports.findMatchReportByMatchId;
export const findMatchReportById=reports.findMatchReportById;
export const finalizeMatchReport=reports.finalizeMatchReport;
export const updateMatchReport=reports.updateMatchReport;
export const confirmMatchReport=reports.confirmMatchReport;
