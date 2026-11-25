const assert = require("node:assert/strict");
const test = require("node:test");
const { buildResubmissionRoster } = require("../dist/services/registrationDraftRoster");

const invite = (player_id, overrides = {}) => ({
  player_id,
  lineup_role: "SUBSTITUTE",
  is_goalkeeper: false,
  competition_role: "PLAYER",
  proposed_jersey_number: 12,
  position_snapshot: "MF",
  full_name: `Player ${player_id}`,
  student_id: `ID-${player_id}`,
  birth_date: null,
  ...overrides,
});

const draft = (roster, editingSubmitted = true) => ({ editingSubmitted, roster });
const draftPlayer = (playerId, overrides = {}) => ({
  playerId,
  competitionRole: "PLAYER",
  lineupRole: "STARTER",
  isGoalkeeper: false,
  proposedJerseyNumber: 9,
  position: "DF",
  ...overrides,
});

test("submitted changes preserve saved roster choices and append newly accepted invitations", () => {
  const result = buildResubmissionRoster(
    [invite("p1"), invite("p2", { is_goalkeeper: true })],
    draft([draftPlayer("p1", { proposedJerseyNumber: null, position: null })]),
  );
  assert.deepEqual(result.map(({ playerId }) => playerId), ["p1", "p2"]);
  assert.equal(result[0].lineupRole, "STARTER");
  assert.equal(result[0].jerseyNumber, null);
  assert.equal(result[0].position, null);
  assert.equal(result[1].isGoalkeeper, true);
  assert.equal(result[1].lineupRole, "SUBSTITUTE");
});

test("draft cannot reintroduce a player without an accepted invitation", () => {
  assert.throws(
    () => buildResubmissionRoster([invite("p1")], draft([draftPlayer("withdrawn-player")])),
    /DRAFT_ROSTER_INVITATION_NOT_ACCEPTED/,
  );
});

test("draft cannot submit duplicate player rows", () => {
  assert.throws(
    () => buildResubmissionRoster([invite("p1")], draft([draftPlayer("p1"), draftPlayer("p1")])),
    /DRAFT_ROSTER_DUPLICATE_PLAYER/,
  );
});
