import { apiFetch } from "./client";

export type Tournament = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  location: string | null;
  maxTeams: number;
  startDate: string | null;
  endDate: string | null;
};

export type Team = {
  id: string;
  name: string;
  description: string | null;
  captainId: string;
  contactEmail: string | null;
  maxPlayers: number;
  isActive: boolean;
};

export type Player = {
  id: string;
  teamId: string;
  userId: string;
  jerseyNumber: number | null;
  position: string | null;
  isCaptain: boolean;
};

export type TeamRegistration = {
  id: string;
  teamId: string;
  tournamentId: string;
  status: string;
  notes: string | null;
};

export type Match = {
  id: string;
  tournamentId: string;
  homeTeamId: string;
  awayTeamId: string;
  matchDate: string;
  venue: string | null;
  round: string | null;
  status: string;
};

export type Standing = {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

export type Venue = {
  id: string;
  name: string;
  location: string;
  capacity: number | null;
  surface: string | null;
  isActive: boolean;
};

export type Card = {
  id: string;
  playerId: string;
  matchId: string;
  tournamentId: string;
  teamId: string;
  cardType: string;
  minute: number | null;
  reason: string | null;
};

export type NotificationItem = {
  id: number;
  title: string;
  body: string;
  type: string;
  is_read?: boolean;
  isRead?: boolean;
  created_at?: string;
  createdAt?: string;
};

export async function listTournaments() {
  return apiFetch<{ items: Tournament[]; total: number }>(
    "/tournaments?limit=100",
  );
}

export async function createTournament(input: {
  name: string;
  description?: string;
  location?: string;
  maxTeams: number;
  startDate?: string;
  endDate?: string;
}) {
  return apiFetch<{ tournament: Tournament }>("/tournaments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateTournament(
  id: string,
  input: Partial<Tournament> & { status?: string },
) {
  return apiFetch<{ tournament: Tournament }>(`/tournaments/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function listTeams() {
  return apiFetch<{ items: Team[]; total: number }>("/teams?limit=100");
}

export async function createTeam(input: {
  name: string;
  description?: string;
  contactEmail?: string;
  maxPlayers?: number;
}) {
  return apiFetch<{ team: Team }>("/teams", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listPlayers(teamId: string) {
  return apiFetch<{ players: Player[] }>(`/teams/${teamId}/players`);
}

export async function addPlayer(input: {
  teamId: string;
  userId: string;
  jerseyNumber?: number;
  position?: string;
  isCaptain?: boolean;
}) {
  return apiFetch<{ player: Player }>("/players", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listRegistrations(tournamentId: string) {
  return apiFetch<{ registrations: TeamRegistration[] }>(
    `/tournaments/${tournamentId}/registrations`,
  );
}

export async function registerTeam(input: {
  teamId: string;
  tournamentId: string;
  notes?: string;
}) {
  return apiFetch<{ registration: TeamRegistration }>("/registrations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateRegistration(
  id: string,
  input: { status: string; notes?: string },
) {
  return apiFetch<{ registration: TeamRegistration }>(`/registrations/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function listMatches(tournamentId: string) {
  return apiFetch<{ items: Match[]; total: number }>(
    `/tournaments/${tournamentId}/matches?limit=100`,
  );
}

export async function createMatch(input: {
  tournamentId: string;
  homeTeamId: string;
  awayTeamId: string;
  matchDate: string;
  venue?: string;
  round?: string;
}) {
  return apiFetch<{ match: Match }>("/matches", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function recordResult(input: {
  matchId: string;
  homeScore: number;
  awayScore: number;
  notes?: string;
}) {
  return apiFetch("/match-results", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listStandings(tournamentId: string) {
  return apiFetch<{ standings: Standing[] }>(
    `/tournaments/${tournamentId}/standings`,
  );
}

export async function listVenues() {
  return apiFetch<{ venues: Venue[] }>("/venues");
}

export async function createVenue(input: {
  name: string;
  location: string;
  capacity?: number;
  surface?: string;
}) {
  return apiFetch<{ venue: Venue }>("/venues", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listCards(tournamentId: string) {
  return apiFetch<{ cards: Card[] }>(`/tournaments/${tournamentId}/cards`);
}

export async function createCard(input: {
  playerId: string;
  matchId: string;
  tournamentId: string;
  teamId: string;
  cardType: "YELLOW" | "RED";
  minute?: number;
  reason?: string;
}) {
  return apiFetch<{ card: Card }>("/cards", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listNotifications() {
  return apiFetch<{ notifications: NotificationItem[] }>(
    "/notifications?limit=50",
  );
}

export async function markAllNotificationsRead() {
  return apiFetch("/notifications/mark-all-read", { method: "POST" });
}

export async function sendNotification(input: {
  userId: string;
  type: string;
  title: string;
  body: string;
}) {
  return apiFetch("/notifications/send", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
