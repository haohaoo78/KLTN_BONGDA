import { getPool } from "../lib/db";

export type TournamentWorkflowState = {
  tournamentId: string;
  currentStep: number;
  updatedBy: string;
  updatedAt: string;
};

type WorkflowRow = { tournament_id: string; current_step: number; updated_by: string; updated_at: string };
function mapRow(row: WorkflowRow): TournamentWorkflowState {
  return {
    tournamentId: row.tournament_id,
    currentStep: row.current_step,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export async function getWorkflowState(tournamentId: string, userId: string): Promise<TournamentWorkflowState> {
  const result = await getPool().query<WorkflowRow>(
    `INSERT INTO tournament_workflow_state (tournament_id, updated_by)
     VALUES ($1, $2)
     ON CONFLICT (tournament_id) DO UPDATE SET tournament_id = EXCLUDED.tournament_id
     RETURNING tournament_id, current_step, updated_by, updated_at`,
    [tournamentId, userId],
  );
  return mapRow(result.rows[0]);
}

export async function saveWorkflowStep(tournamentId: string, userId: string, currentStep: number): Promise<TournamentWorkflowState> {
  const result = await getPool().query<WorkflowRow>(
    `INSERT INTO tournament_workflow_state (tournament_id, current_step, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (tournament_id) DO UPDATE
       SET current_step = EXCLUDED.current_step, updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING tournament_id, current_step, updated_by, updated_at`,
    [tournamentId, currentStep, userId],
  );
  return mapRow(result.rows[0]);
}
