const test = require("node:test");
const assert = require("node:assert/strict");
process.env.SCHEDULING_DATABASE_URL ??= "postgresql://unit:unit@127.0.0.1:1/unit";
process.env.INTERNAL_API_KEY ??= "unit-test-internal-key";
const validation = require("../dist/scheduling/services/refereeTeamValidation");
const service = require("../dist/scheduling/services/refereeTeamService");
const policy = require("../dist/scheduling/authorization");
const scheduling = require("../dist/scheduling/services/schedulingService");
const repository = require("../dist/scheduling/repositories/refereeTeamRepository");
const { AppError } = require("../dist/lib/errors");

const tournamentId = "a0000000-0000-4000-8000-000000000001";
const memberId = "a0000000-0000-4000-8000-000000000002";
const userId = "a0000000-0000-4000-8000-000000000003";
const requestId = "a0000000-0000-4000-8000-000000000004";
const actor = { userId: "a0000000-0000-4000-8000-000000000005", userRoles: ["BTC"] };
const canonical = { userId, email: "referee@example.edu", fullName: "Existing Global Name", phone: null, accountStatus: "ACTIVE", isActive: true, emailVerified: true, roles: ["TEAM_CAPTAIN", "REFEREE"] };
const baseMember = () => ({ id: memberId, tournamentId, userId, profile: validation.emptyRefereeTeamProfile(), assignmentCount: 0,
  accessEmail: { status: "PENDING", lastAttemptAt: null, sentAt: null }, createdAt: "2026-11-25T00:00:00Z", updatedAt: "2026-11-25T00:00:00Z" });
const accessSetup = (t, { published = true, status = "PREPARING" } = {}) => {
  t.mock.method(policy, "assertCanManageTournament", async (request) => {
    if (!request.userRoles?.includes("BTC") || !request.userId) throw new AppError(403, "Forbidden", "FORBIDDEN");
  });
  t.mock.method(scheduling, "getTournamentScheduleSettings", async () => ({ id: tournamentId, name: "Official referee QA", status }));
  t.mock.method(scheduling, "getOfficialScheduleContext", async () => ({ schedulePublishedAt: published ? "2026-11-25T00:00:00Z" : null }));
  t.mock.method(repository, "listRefereeTeamMembers", async () => []);
  t.mock.method(repository, "findRefereeAccessEmailEvent", async () => null);
};

test("referee team email normalization is case-insensitive and rejects malformed input", () => {
  assert.equal(validation.parseRefereeEmail("  REFEREE@Example.EDU "), "referee@example.edu");
  for (const email of ["", "invalid", "a b@example.edu", null]) assert.throws(() => validation.parseRefereeEmail(email), { code: "INVALID_REFEREE_TEAM_INPUT" });
});

test("basic add does not require advanced qualifications or invented acceptance status", () => {
  const input = validation.parseAddRefereeTeamInput({ email: canonical.email, requestId });
  assert.deepEqual(input.profile, validation.emptyRefereeTeamProfile());
  assert.equal(input.profile.level, "UNVERIFIED");
  assert.equal("participationStatus" in input.profile, false);
  assert.throws(() => validation.parseAddRefereeTeamInput({ email: canonical.email, requestId, status: "ACCEPTED" }), { code: "INVALID_REFEREE_TEAM_INPUT" });
});

test("advanced fields validate format, expertise, positions and actual unavailable date ranges", () => {
  const profile = validation.parseRefereeTeamProfile({ formats: [5, 7, 11], level: "CITY", experienceYears: 4, positions: ["REFEREE", "MATCH_SECRETARY"], unavailablePeriods: [{ id: requestId, startAt: "2026-12-02T08:00", endAt: "2026-12-02T10:00", reason: "Unavailable" }] });
  assert.equal(profile.unavailablePeriods.length, 1);
  for (const invalid of [{ formats: [5, 5] }, { formats: [9] }, { level: "POT_1" }, { positions: ["SEED_1"] }, { positions: ["REFEREE", "REFEREE"] }, { experienceYears: -1 }, { unavailablePeriods: [{ startAt: "2026-12-02T10:00", endAt: "2026-12-02T08:00" }] }, { unavailablePeriods: [{ startAt: "2026-02-30T08:00", endAt: "2026-03-01T10:00" }] }]) {
    assert.throws(() => validation.parseRefereeTeamProfile(invalid), { code: "INVALID_REFEREE_TEAM_INPUT" });
  }
});

test("advanced patch preserves omitted fields and rejects all global identity fields", () => {
  const current = { ...validation.emptyRefereeTeamProfile(), organization: "Original school", formats: [7] };
  assert.equal(validation.parseRefereeProfilePatch({ profile: { level: "NATIONAL" } }, current).organization, current.organization);
  assert.deepEqual(current.formats, [7]);
  for (const patch of [{ fullName: "Overwrite" }, { profile: { email: canonical.email } }, { profile: {}, userId }, { profile: { roles: ["ADMIN"] } }]) assert.throws(() => validation.parseRefereeProfilePatch(patch, current), { code: "INVALID_REFEREE_TEAM_INPUT" });
});

test("resend requires an explicit UUID action and accepts no identity or delivery override", () => {
  assert.equal(validation.parseRefereeResendInput({ requestId }), requestId);
  for (const input of [{}, { requestId: "fake" }, { requestId, status: "SENT" }, { requestId, email: "other@example.edu" }]) assert.throws(() => validation.parseRefereeResendInput(input), { code: "INVALID_REFEREE_TEAM_INPUT" });
});

test("service itself denies non-BTC and unauthorized tournament access before reading team data", async (t) => {
  let reads = 0;
  t.mock.method(repository, "listRefereeTeamMembers", async () => { reads++; return []; });
  await assert.rejects(service.getTournamentRefereeTeam({ userId, userRoles: ["REFEREE"] }, tournamentId), { code: "FORBIDDEN" });
  t.mock.method(globalThis, "fetch", async () => ({ status: 403, ok: false }));
  await assert.rejects(service.getTournamentRefereeTeam(actor, tournamentId), { code: "FORBIDDEN" });
  assert.equal(reads, 0);
});

test("team reads before published schedules are read-only; they never dispatch emails", async (t) => {
  accessSetup(t, { published: false });
  t.mock.method(repository, "listRefereeTeamMembers", async () => []);
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => { network++; throw new Error("unexpected dispatch"); });
  const result = await service.getTournamentRefereeTeam(actor, tournamentId);
  assert.equal(result.readOnly, true);
  assert.deepEqual(result.stats, { totalMembers: 0, assignedMembers: 0, unassignedMembers: 0, totalAssignments: 0 });
  assert.equal(network, 0);
  for (const code of ["PUBLISHED_DRAW_REQUIRED", "PUBLISHED_FIXTURES_REQUIRED"]) {
    t.mock.method(scheduling, "getOfficialScheduleContext", async () => { throw new AppError(409, "Not published", code); });
    assert.equal((await service.getTournamentRefereeTeam(actor, tournamentId)).readOnly, true);
  }
});

test("team mutations require published Step 5 and cannot change completed tournaments", async (t) => {
  accessSetup(t, { published: false });
  await assert.rejects(service.createTournamentRefereeMember(actor, tournamentId, { email: canonical.email, requestId }), { code: "PUBLISHED_SCHEDULE_REQUIRED" });
  t.mock.method(scheduling, "getOfficialScheduleContext", async () => ({ schedulePublishedAt: "2026-11-25T00:00:00Z" }));
  t.mock.method(scheduling, "getTournamentScheduleSettings", async () => ({ id: tournamentId, name: "Closed", status: "COMPLETED" }));
  await assert.rejects(service.createTournamentRefereeMember(actor, tournamentId, { email: canonical.email, requestId }), { code: "TOURNAMENT_READ_ONLY" });
});

test("membership commits before any email and existing global identity is preserved", async (t) => {
  accessSetup(t);
  let saved = null;
  const steps = [];
  t.mock.method(repository, "addRefereeTeamMember", async (_tournamentId, accountId, profile) => { assert.equal(accountId, userId); saved = { ...baseMember(), profile }; steps.push("member-committed"); return { memberId, created: true }; });
  t.mock.method(repository, "markRefereeMemberNotification", async () => {});
  t.mock.method(repository, "claimRefereeAccessEmailEvent", async () => ({ id: requestId, userId, eventKey: `referee-team:${tournamentId}:${requestId}` }));
  t.mock.method(repository, "finishRefereeAccessEmailEvent", async (_id, outcome) => { saved.accessEmail = { ...saved.accessEmail, ...outcome }; });
  t.mock.method(repository, "findRefereeTeamMember", async () => saved);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(options.body);
    if (path === "/internal/referee-accounts") return { ok: true, json: async () => ({ account: canonical, created: false, roleAdded: false }) };
    assert.ok(saved, "membership must exist before notification or SMTP request");
    if (path === "/internal/notifications") { assert.equal(options.headers["x-internal-api-key"], process.env.INTERNAL_API_KEY); assert.equal(body.type, "SYSTEM"); assert.equal(body.idempotencyKey, `referee-team-member:${memberId}`); steps.push("in-app"); return { ok: true }; }
    assert.ok(path.endsWith("/access-email"));
    assert.equal(body.eventKey, `referee-team:${tournamentId}:${requestId}`);
    steps.push("access-email");
    return { ok: true, json: async () => ({ status: "SENT", sentAt: "2026-11-25T01:00:00Z" }) };
  });
  const result = await service.createTournamentRefereeMember(actor, tournamentId, { email: "REFEREE@example.edu", fullName: "BTC supplied different name", requestId, profile: { level: "CITY" } });
  assert.deepEqual(steps, ["member-committed", "in-app", "access-email"]);
  assert.equal(result.member.identity.fullName, canonical.fullName);
  assert.deepEqual(result.member.identity.roles, canonical.roles);
  assert.equal(result.member.accessEmail.status, "SENT");
});

test("SMTP failure leaves membership saved and reports the real failed email status", async (t) => {
  accessSetup(t);
  const saved = baseMember();
  t.mock.method(repository, "addRefereeTeamMember", async () => ({ memberId, created: true }));
  t.mock.method(repository, "markRefereeMemberNotification", async () => {});
  t.mock.method(repository, "claimRefereeAccessEmailEvent", async () => ({ id: requestId, userId, eventKey: "stable-event" }));
  t.mock.method(repository, "finishRefereeAccessEmailEvent", async (_id, outcome) => { saved.accessEmail = { ...saved.accessEmail, ...outcome }; });
  t.mock.method(repository, "findRefereeTeamMember", async () => saved);
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = new URL(url).pathname;
    if (path === "/internal/referee-accounts") return { ok: true, json: async () => ({ account: canonical }) };
    if (path === "/internal/notifications") return { ok: true };
    return { ok: true, json: async () => ({ status: "FAILED", errorCode: "SMTP_DELIVERY_FAILED" }) };
  });
  const result = await service.createTournamentRefereeMember(actor, tournamentId, { email: canonical.email, requestId });
  assert.equal(result.member.id, memberId);
  assert.equal(result.member.accessEmail.status, "FAILED");
  assert.equal(result.member.accessEmail.errorCode, "SMTP_DELIVERY_FAILED");
});

test("a lost SMTP response remains pending instead of reporting false success or creating another event", async (t) => {
  accessSetup(t);
  const saved = baseMember();
  let eventCreations = 0;
  t.mock.method(repository, "findRefereeTeamMember", async () => saved);
  t.mock.method(repository, "createRefereeAccessEmailEvent", async () => { eventCreations++; });
  t.mock.method(repository, "claimRefereeAccessEmailEvent", async () => ({ id: requestId, userId, eventKey: "same-persisted-key" }));
  t.mock.method(repository, "finishRefereeAccessEmailEvent", async (_id, outcome) => { saved.accessEmail = { ...saved.accessEmail, ...outcome }; });
  t.mock.method(globalThis, "fetch", async (url) => {
    if (new URL(url).pathname.endsWith("/access-email")) throw new Error("response lost");
    return { ok: true, json: async () => ({ users: [canonical], missingUserIds: [] }) };
  });
  const result = await service.resendTournamentRefereeAccess(actor, tournamentId, memberId, { requestId });
  assert.equal(eventCreations, 1);
  assert.equal(result.member.accessEmail.status, "PENDING");
  assert.equal(result.member.accessEmail.errorCode, "EMAIL_STATUS_UNCERTAIN");
});

test("reload resolves canonical accounts and actual assignment counts without sending access email", async (t) => {
  accessSetup(t);
  const saved = { ...baseMember(), assignmentCount: 3 };
  t.mock.method(repository, "listRefereeTeamMembers", async () => [saved]);
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url) => { paths.push(new URL(url).pathname); return { ok: true, json: async () => ({ users: [canonical], missingUserIds: [] }) }; });
  const result = await service.getTournamentRefereeTeam(actor, tournamentId);
  assert.deepEqual(result.stats, { totalMembers: 1, assignedMembers: 1, unassignedMembers: 0, totalAssignments: 3 });
  assert.equal(result.members[0].identity.fullName, canonical.fullName);
  assert.deepEqual(paths, ["/internal/referee-accounts/resolve"]);
});

test("duplicate email with a new action is rejected before account provisioning or email dispatch", async (t) => {
  accessSetup(t);
  t.mock.method(repository, "listRefereeTeamMembers", async () => [baseMember()]);
  const methods = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => { methods.push(options.method); return { ok: true, json: async () => ({ account: canonical }) }; });
  await assert.rejects(service.createTournamentRefereeMember(actor, tournamentId, { email: canonical.email.toUpperCase(), requestId }), { code: "REFEREE_ALREADY_IN_TEAM" });
  assert.deepEqual(methods, ["GET"]);
});

test("reused add key cannot provision another email or create another membership", async (t) => {
  accessSetup(t);
  t.mock.method(repository, "findRefereeAccessEmailEvent", async () => ({ operation: "ADD", requestedBy: actor.userId, userId, memberId }));
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url) => { paths.push(new URL(url).pathname); return { ok: true, json: async () => ({ users: [canonical], missingUserIds: [] }) }; });
  await assert.rejects(service.createTournamentRefereeMember(actor, tournamentId, { email: "other@example.edu", requestId }), { code: "REFEREE_REQUEST_REUSED" });
  assert.deepEqual(paths, ["/internal/referee-accounts/resolve"]);
});
