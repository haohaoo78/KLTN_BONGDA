const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");
const {
  createTournamentInvitations,
  getAcceptedTournamentInvitations,
  listAcceptedTournamentInvitationClaims,
  respondToTournamentInvitation,
} = require("../dist/repositories/tournamentInvitationRepository");
const {
  createPlayerTournamentWithdrawalRequest,
  beginPlayerTournamentWithdrawalDecision,
  completePlayerTournamentWithdrawalDecision,
} = require("../dist/repositories/playerTournamentWithdrawalRepository");
const { enqueueRegistrationDecision } = require("../dist/repositories/registrationDecisionOutboxRepository");
const { closePool, getPool } = require("../dist/lib/db");

test("claim reconciliation excludes accepted invitations from finalized registrations", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const pool = getPool();
  const teamId = randomUUID(); const playerId = randomUUID(); const playerUserId = randomUUID();
  const captainId = randomUUID(); const tournamentId = randomUUID(); const registrationId = randomUUID();
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "sfl_team");
    await pool.query("INSERT INTO teams (id,name,captain_id) VALUES ($1,'Finalized claim fixture',$2)", [teamId,captainId]);
    await pool.query("INSERT INTO players (id,team_id,user_id,full_name,student_id) VALUES ($1,$2,$3,'Finalized claim player',$4)", [playerId,teamId,playerUserId,`FCL-${randomUUID()}`]);
    await pool.query(
      `INSERT INTO team_registrations(id,team_id,tournament_id,status,submitted_roster,version,submission_sequence)
       VALUES($1,$2,$3,'PENDING','[]'::jsonb,1,1)`, [registrationId,teamId,tournamentId],
    );
    const [invitation] = await createTournamentInvitations([{
      teamId,tournamentId,playerId,invitedBy:captainId,competitionRole:"PLAYER",lineupRole:"STARTER",isGoalkeeper:true,
      proposedJerseyNumber:1,positionSnapshot:"GK",message:null,expiresAt:new Date(Date.now()+60_000).toISOString(),
      tournamentStartDate:"2042-06-01",tournamentEndDate:"2042-06-10",tournamentName:"Finalized claim test",
    }]);
    await respondToTournamentInvitation(invitation.id,playerUserId,"ACCEPTED");
    assert.equal((await listAcceptedTournamentInvitationClaims()).some((item) => item.id === invitation.id),true);
    await pool.query("UPDATE team_registrations SET status='REJECTED' WHERE id=$1", [registrationId]);
    assert.equal((await listAcceptedTournamentInvitationClaims()).some((item) => item.id === invitation.id),false);
    await pool.query("DELETE FROM team_registrations WHERE id=$1", [registrationId]);
    assert.equal((await listAcceptedTournamentInvitationClaims()).some((item) => item.id === invitation.id),true,
      "accepted invitations for an unsubmitted draft must remain recoverable");
  } finally {
    await pool.query("DELETE FROM teams WHERE id=$1", [teamId]);
    await closePool();
  }
});

test("player identity owns the response and only accepted invitations enter the submitted roster", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const pool = getPool();
  const database = await pool.query("SELECT current_database() AS name");
  assert.equal(database.rows[0].name, "sfl_team", "integration test must run only against organization DB");
  const teamId = randomUUID();
  const playerId = randomUUID();
  const playerUserId = randomUUID();
  const otherUserId = randomUUID();
  const captainId = randomUUID();
  const tournamentId = randomUUID();
  try {
    await pool.query("INSERT INTO teams (id,name,captain_id) VALUES ($1,'Invitation integration team',$2)", [teamId,captainId]);
    await pool.query("INSERT INTO players (id,team_id,user_id,full_name,student_id) VALUES ($1,$2,$3,'Fixture player',$4)", [playerId,teamId,playerUserId,`INV-${randomUUID()}`]);
    const [invitation] = await createTournamentInvitations([{
      teamId,tournamentId,playerId,invitedBy:captainId,competitionRole:"PLAYER",lineupRole:"STARTER",
      isGoalkeeper:true,proposedJerseyNumber:1,positionSnapshot:"GK",message:null,
      expiresAt:new Date(Date.now()+60_000).toISOString(),
    }]);
    assert.equal(await respondToTournamentInvitation(invitation.id,otherUserId,"ACCEPTED"),null);
    assert.equal((await getAcceptedTournamentInvitations(teamId,tournamentId,[playerId])).length,0);
    const accepted = await respondToTournamentInvitation(invitation.id,playerUserId,"ACCEPTED");
    assert.equal(accepted.status,"ACCEPTED");
    const roster = await getAcceptedTournamentInvitations(teamId,tournamentId,[playerId]);
    assert.equal(roster.length,1);
    assert.equal(roster[0].proposed_jersey_number,1);
  } finally {
    await pool.query("DELETE FROM teams WHERE id=$1",[teamId]);
    await closePool();
  }
});

test("a player withdrawal remains a request until captain approval and then withdraws the invitation", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const pool = getPool();
  const teamId = randomUUID(); const playerId = randomUUID(); const playerUserId = randomUUID();
  const captainId = randomUUID(); const tournamentId = randomUUID(); let invitationId = ""; let requestId = ""; let requestId2 = "";
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "sfl_team");
    await pool.query("INSERT INTO teams (id,name,captain_id) VALUES ($1,'Player withdrawal team',$2)", [teamId,captainId]);
    await pool.query("INSERT INTO players (id,team_id,user_id,full_name,student_id) VALUES ($1,$2,$3,'Withdrawal player',$4)", [playerId,teamId,playerUserId,`WDR-${randomUUID()}`]);
    const [invitation] = await createTournamentInvitations([{
      teamId,tournamentId,playerId,invitedBy:captainId,competitionRole:"PLAYER",lineupRole:"STARTER",isGoalkeeper:true,
      proposedJerseyNumber:1,positionSnapshot:"GK",message:null,expiresAt:new Date(Date.now()+60_000).toISOString(),
      tournamentStartDate:"2040-06-01",tournamentEndDate:"2040-06-10",tournamentName:"Withdrawal test",
    }]);
    invitationId = invitation.id;
    await respondToTournamentInvitation(invitation.id,playerUserId,"ACCEPTED");
    const request = await createPlayerTournamentWithdrawalRequest({ invitationId, playerUserId, reason:"Injury before the tournament" });
    requestId = request.id;
    assert.equal(request.status,"PENDING");
    assert.equal((await pool.query("SELECT status FROM tournament_player_invitations WHERE id=$1",[invitationId])).rows[0].status,"ACCEPTED");
    await assert.rejects(createPlayerTournamentWithdrawalRequest({ invitationId, playerUserId, reason:"Another request" }), (error) => error.code === "WITHDRAWAL_REQUEST_PENDING");
    const processing = await beginPlayerTournamentWithdrawalDecision({ id:requestId, decision:"APPROVED", actorId:captainId, note:"Approved" });
    assert.equal(processing.status,"PROCESSING");
    const completed = await completePlayerTournamentWithdrawalDecision(requestId,"APPROVED",captainId,"Approved");
    assert.equal(completed.status,"APPROVED");
    assert.equal((await pool.query("SELECT status FROM tournament_player_invitations WHERE id=$1",[invitationId])).rows[0].status,"WITHDRAWN");
    const [secondInvitation] = await createTournamentInvitations([{
      teamId,tournamentId,playerId,invitedBy:captainId,competitionRole:"PLAYER",lineupRole:"STARTER",isGoalkeeper:true,
      proposedJerseyNumber:2,positionSnapshot:"GK",message:null,expiresAt:new Date(Date.now()+60_000).toISOString(),
      tournamentStartDate:"2040-06-01",tournamentEndDate:"2040-06-10",tournamentName:"Withdrawal test",
    }]);
    await respondToTournamentInvitation(secondInvitation.id,playerUserId,"ACCEPTED");
    const rejectedRequest = await createPlayerTournamentWithdrawalRequest({ invitationId:secondInvitation.id, playerUserId, reason:"Cannot travel to the tournament" });
    requestId2 = rejectedRequest.id;
    await beginPlayerTournamentWithdrawalDecision({ id:requestId2, decision:"REJECTED", actorId:captainId, note:"Roster is already submitted" });
    assert.equal((await completePlayerTournamentWithdrawalDecision(requestId2,"REJECTED",captainId,"Roster is already submitted")).status,"REJECTED");
    assert.equal((await pool.query("SELECT status FROM tournament_player_invitations WHERE id=$1",[secondInvitation.id])).rows[0].status,"ACCEPTED");
  } finally {
    if (requestId) await pool.query("DELETE FROM tournament_player_withdrawal_requests WHERE id=$1",[requestId]);
    if (requestId2) await pool.query("DELETE FROM tournament_player_withdrawal_requests WHERE id=$1",[requestId2]);
    if (teamId) await pool.query("DELETE FROM teams WHERE id=$1",[teamId]);
    await closePool();
  }
});

test("approving a withdrawal from a pending application opens DRAFT_CHANGES without changing the submitted snapshot", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const pool = getPool();
  const teamId = randomUUID(); const playerId = randomUUID(); const playerUserId = randomUUID();
  const captainId = randomUUID(); const tournamentId = randomUUID(); const registrationId = randomUUID(); let approvedRegistrationId = "";
  let invitationId = ""; let requestId = ""; let requestId2 = "";
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "sfl_team");
    await pool.query("INSERT INTO teams (id,name,captain_id) VALUES ($1,'Pending withdrawal integration team',$2)", [teamId,captainId]);
    await pool.query("INSERT INTO players (id,team_id,user_id,full_name,student_id) VALUES ($1,$2,$3,'Pending withdrawal player',$4)", [playerId,teamId,playerUserId,`PWR-${randomUUID()}`]);
    const [invitation] = await createTournamentInvitations([{
      teamId,tournamentId,playerId,invitedBy:captainId,competitionRole:"PLAYER",lineupRole:"STARTER",isGoalkeeper:true,
      proposedJerseyNumber:1,positionSnapshot:"GK",message:null,expiresAt:new Date(Date.now()+60_000).toISOString(),
      tournamentStartDate:"2041-06-01",tournamentEndDate:"2041-06-10",tournamentName:"Pending withdrawal test",
    }]);
    invitationId = invitation.id;
    await respondToTournamentInvitation(invitationId,playerUserId,"ACCEPTED");
    await pool.query(
      `INSERT INTO team_registrations(id,team_id,tournament_id,status,submitted_roster,version,submission_sequence)
       VALUES($1,$2,$3,'PENDING',$4::jsonb,1,1)`,
      [registrationId,teamId,tournamentId,JSON.stringify([{playerId,playerName:"Pending withdrawal player",lineupRole:"STARTER",isGoalkeeper:true}])],
    );
    const request = await createPlayerTournamentWithdrawalRequest({ invitationId,playerUserId,reason:"Unable to play this tournament" });
    requestId = request.id;
    await assert.rejects(enqueueRegistrationDecision(registrationId,{status:"APPROVED",notes:"Review passed"},captainId),
      (error) => error.code === "PLAYER_WITHDRAWAL_REQUEST_PENDING");
    await beginPlayerTournamentWithdrawalDecision({ id:requestId,decision:"REJECTED",actorId:captainId,note:"Please remain with the submitted roster" });
    await completePlayerTournamentWithdrawalDecision(requestId,"REJECTED",captainId,"Please remain with the submitted roster");
    assert.equal((await pool.query("SELECT status FROM tournament_player_invitations WHERE id=$1",[invitationId])).rows[0].status,"ACCEPTED");
    const afterRejection = await pool.query("SELECT status,version FROM team_registrations WHERE id=$1",[registrationId]);
    assert.equal(afterRejection.rows[0].status,"PENDING");
    assert.equal(Number(afterRejection.rows[0].version),1);
    const secondRequest = await createPlayerTournamentWithdrawalRequest({ invitationId,playerUserId,reason:"Retry withdrawal after reviewing the decision" });
    requestId2 = secondRequest.id;
    await beginPlayerTournamentWithdrawalDecision({ id:requestId2,decision:"APPROVED",actorId:captainId,note:"Accepted" });
    await completePlayerTournamentWithdrawalDecision(requestId2,"APPROVED",captainId,"Accepted");
    const result = await pool.query("SELECT status,version,submitted_roster FROM team_registrations WHERE id=$1",[registrationId]);
    assert.equal(result.rows[0].status,"PENDING");
    assert.equal(Number(result.rows[0].version),1);
    assert.deepEqual(result.rows[0].submitted_roster,[{playerId,playerName:"Pending withdrawal player",lineupRole:"STARTER",isGoalkeeper:true}]);
    const draft = await pool.query("SELECT registration_id,base_version,editing_submitted,draft_state,roster FROM tournament_registration_drafts WHERE team_id=$1 AND tournament_id=$2",[teamId,tournamentId]);
    assert.equal(draft.rows[0].registration_id,registrationId);
    assert.equal(draft.rows[0].editing_submitted,true);
    assert.equal(draft.rows[0].draft_state,"DRAFT_CHANGES");
    assert.deepEqual(draft.rows[0].roster,[]);
    assert.equal((await pool.query("SELECT action FROM team_registration_versions WHERE registration_id=$1 ORDER BY version DESC LIMIT 1",[registrationId])).rows[0].action,"PLAYER_WITHDRAWAL_ACCEPTED");
    await assert.rejects(
      enqueueRegistrationDecision(registrationId,{status:"APPROVED",notes:"Must not approve the old snapshot"},captainId),
      (error) => error.code === "REGISTRATION_EDIT_IN_PROGRESS",
    );
    const approvedTournamentId = randomUUID(); approvedRegistrationId = randomUUID();
    const [approvedInvitation] = await createTournamentInvitations([{
      teamId,tournamentId:approvedTournamentId,playerId,invitedBy:captainId,competitionRole:"PLAYER",lineupRole:"STARTER",isGoalkeeper:true,
      proposedJerseyNumber:2,positionSnapshot:"GK",message:null,expiresAt:new Date(Date.now()+60_000).toISOString(),
      tournamentStartDate:"2041-07-01",tournamentEndDate:"2041-07-10",tournamentName:"Approved withdrawal test",
    }]);
    await respondToTournamentInvitation(approvedInvitation.id,playerUserId,"ACCEPTED");
    await pool.query("INSERT INTO team_registrations(id,team_id,tournament_id,status,submitted_roster,version,submission_sequence) VALUES($1,$2,$3,'APPROVED',$4::jsonb,1,1)",
      [approvedRegistrationId,teamId,approvedTournamentId,JSON.stringify([{playerId}])]);
    await assert.rejects(createPlayerTournamentWithdrawalRequest({ invitationId:approvedInvitation.id,playerUserId,reason:"Cannot join the approved roster" }),
      (error) => error.code === "PLAYER_WITHDRAWAL_NOT_ALLOWED");
  } finally {
    if (requestId) await pool.query("DELETE FROM tournament_player_withdrawal_requests WHERE id=$1",[requestId]);
    if (requestId2) await pool.query("DELETE FROM tournament_player_withdrawal_requests WHERE id=$1",[requestId2]);
    if (approvedRegistrationId) await pool.query("DELETE FROM team_registrations WHERE id=$1",[approvedRegistrationId]);
    if (registrationId) await pool.query("DELETE FROM team_registrations WHERE id=$1",[registrationId]);
    await pool.query("DELETE FROM teams WHERE id=$1",[teamId]);
    await closePool();
  }
});

test("accepting an invitation invalidates only overlapping pending invitations and writes idempotent notices", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const pool = getPool();
  const teamId = randomUUID();
  const playerId = randomUUID();
  const playerUserId = randomUUID();
  const captainId = randomUUID();
  const tournamentA = randomUUID();
  const tournamentB = randomUUID();
  const tournamentC = randomUUID();
  try {
    const database = await pool.query("SELECT current_database() AS name");
    assert.equal(database.rows[0].name, "sfl_team", "integration test must run only against organization DB");
    await pool.query("INSERT INTO teams (id,name,captain_id) VALUES ($1,'Overlap invitation team',$2)", [teamId,captainId]);
    await pool.query("INSERT INTO players (id,team_id,user_id,full_name,student_id) VALUES ($1,$2,$3,'Overlap fixture player',$4)", [playerId,teamId,playerUserId,`OVL-${randomUUID()}`]);
    const base = { teamId, playerId, invitedBy: captainId, competitionRole: "PLAYER", lineupRole: "STARTER", isGoalkeeper: true, proposedJerseyNumber: 1, positionSnapshot: "GK", message: null, expiresAt: new Date(Date.now()+60_000).toISOString(), tournamentStartDate: "2040-06-01", tournamentEndDate: "2040-06-10" };
    const [first, second] = await createTournamentInvitations([
      { ...base, tournamentId: tournamentA, tournamentName: "Overlap A" },
      { ...base, tournamentId: tournamentB, tournamentName: "Overlap B", proposedJerseyNumber: 2 },
      { ...base, tournamentId: tournamentC, tournamentName: "Separate C", tournamentStartDate: "2040-06-11", tournamentEndDate: "2040-06-20", proposedJerseyNumber: 3 },
    ]);
    await assert.rejects(
      createTournamentInvitations([{ ...base, tournamentId: tournamentA, tournamentName: "Overlap A" }]),
      (error) => error.code === "ACTIVE_INVITATION_EXISTS",
    );
    const third = (await pool.query("SELECT id FROM tournament_player_invitations WHERE tournament_id=$1 AND player_id=$2", [tournamentC,playerId])).rows[0];
    const accepted = await respondToTournamentInvitation(first.id, playerUserId, "ACCEPTED");
    assert.equal(accepted.status, "ACCEPTED");
    assert.equal(accepted.invalidatedInvitations.length, 1);
    assert.equal(accepted.invalidatedInvitations[0].id, second.id);
    assert.equal(accepted.invalidatedInvitations[0].status, "INVALIDATED");
    assert.equal(accepted.invalidatedInvitations[0].conflict_tournament_name, "Overlap A");
    assert.equal((await pool.query("SELECT status FROM tournament_player_invitations WHERE id=$1", [third.id])).rows[0].status, "PENDING");
    const notices = await pool.query(
      "SELECT user_id,idempotency_key,body FROM organization_notification_outbox WHERE idempotency_key LIKE $1",
      [`invitation-invalidated:${second.id}:%`],
    );
    assert.equal(notices.rowCount, 2);
    assert.equal(new Set(notices.rows.map((row) => row.user_id)).size, 2);
    assert.match(notices.rows.find((row) => row.idempotency_key.endsWith(":captain")).body, /Overlap fixture player.*Overlap A.*Overlap B.*chọn cầu thủ thay thế/);
    assert.match(notices.rows.find((row) => row.idempotency_key.endsWith(":player")).body, /Overlap B.*Overlap A/);
    const acceptedC = await respondToTournamentInvitation(third.id, playerUserId, "ACCEPTED");
    assert.equal(acceptedC.status, "ACCEPTED");
    assert.equal(acceptedC.invalidatedInvitations.length, 0);
  } finally {
    await pool.query("DELETE FROM organization_notification_outbox WHERE user_id=ANY($1::uuid[]) AND idempotency_key LIKE 'invitation-invalidated:%'", [[playerUserId,captainId]]);
    await pool.query("DELETE FROM teams WHERE id=$1", [teamId]);
    await closePool();
  }
});
