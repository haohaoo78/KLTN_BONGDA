import type {
  Card,
  CardCreateInput,
  Suspension,
  SuspensionCreateInput,
  Complaint,
  ComplaintCreateInput,
  ComplaintUpdateInput,
  DisciplinaryDecision,
  DisciplinaryDecisionCreateInput,
} from "../models/discipline";
import { AppError } from "../lib/errors";
import {
  listCards,
  createCard,
  listSuspensions,
  findSuspensionById,
  createSuspension,
  updateSuspension,
  listComplaints,
  findComplaintById,
  createComplaint,
  updateComplaint,
  createDisciplinaryDecision,
  listDisciplinaryDecisions,
} from "../repositories/disciplineRepository";

// Cards
export async function getCards(tournamentId: string, playerId?: string, teamId?: string): Promise<Card[]> {
  return listCards(tournamentId, playerId, teamId);
}

export async function issueCard(input: CardCreateInput, issuedBy: string): Promise<Card> {
  if (input.minute !== undefined && (input.minute < 0 || input.minute > 120)) {
    throw new AppError(400, "Invalid minute value", "INVALID_MINUTE");
  }

  const card = await createCard(input, issuedBy);

  // Auto-create suspension if it's a red card
  if (input.cardType === "RED") {
    const suspensionInput: SuspensionCreateInput = {
      playerId: input.playerId,
      tournamentId: input.tournamentId,
      teamId: input.teamId,
      type: "RED_CARD",
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days default
      reason: `Red card in match ${input.matchId}`,
      matchId: input.matchId,
    };
    await createSuspension(suspensionInput, issuedBy);
  }

  return card;
}

// Suspensions
export async function getSuspensions(tournamentId: string, playerId?: string, isActive?: boolean): Promise<Suspension[]> {
  return listSuspensions(tournamentId, playerId, isActive);
}

export async function getSuspension(id: string): Promise<Suspension> {
  const suspension = await findSuspensionById(id);
  if (!suspension) {
    throw new AppError(404, "Suspension not found", "SUSPENSION_NOT_FOUND");
  }
  return suspension;
}

export async function issueSuspension(input: SuspensionCreateInput, issuedBy: string): Promise<Suspension> {
  if (new Date(input.startDate) >= new Date(input.endDate)) {
    throw new AppError(400, "Start date must be before end date", "INVALID_DATES");
  }

  return createSuspension(input, issuedBy);
}

export async function liftSuspension(id: string): Promise<Suspension> {
  const suspension = await updateSuspension(id, false);
  if (!suspension) {
    throw new AppError(404, "Suspension not found", "SUSPENSION_NOT_FOUND");
  }
  return suspension;
}

export async function checkPlayerSuspension(playerId: string, tournamentId: string): Promise<boolean> {
  const suspensions = await listSuspensions(tournamentId, playerId, true);
  const now = new Date();
  const activeSuspension = suspensions.some(
    (s) => new Date(s.startDate) <= now && new Date(s.endDate) >= now,
  );
  return activeSuspension;
}

// Complaints
export async function getComplaints(tournamentId: string, status?: string, teamId?: string): Promise<Complaint[]> {
  return listComplaints(tournamentId, status, teamId);
}

export async function getComplaint(id: string): Promise<Complaint> {
  const complaint = await findComplaintById(id);
  if (!complaint) {
    throw new AppError(404, "Complaint not found", "COMPLAINT_NOT_FOUND");
  }
  return complaint;
}

export async function submitComplaint(input: ComplaintCreateInput): Promise<Complaint> {
  if (!input.description.trim()) {
    throw new AppError(400, "Description is required", "INVALID_DESCRIPTION");
  }

  return createComplaint(input);
}

export async function reviewComplaint(id: string, input: ComplaintUpdateInput, reviewedBy: string): Promise<Complaint> {
  const updated = await updateComplaint(id, input, reviewedBy);
  if (!updated) {
    throw new AppError(404, "Complaint not found", "COMPLAINT_NOT_FOUND");
  }
  return updated;
}

// Disciplinary Decisions
export async function issueDisciplinaryDecision(input: DisciplinaryDecisionCreateInput, issuedBy: string): Promise<DisciplinaryDecision> {
  if (!input.action.trim()) {
    throw new AppError(400, "Action is required", "INVALID_ACTION");
  }

  return createDisciplinaryDecision(input, issuedBy);
}

export async function getDisciplinaryDecisions(playerId?: string): Promise<DisciplinaryDecision[]> {
  return listDisciplinaryDecisions(playerId);
}
