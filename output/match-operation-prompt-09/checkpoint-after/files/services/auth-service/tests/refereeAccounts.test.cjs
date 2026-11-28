const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ACCOUNT_DATABASE_URL ||= 'postgresql://unit:unit@127.0.0.1:1/sfl_step6_qa_auth_unit';
process.env.INTERNAL_API_KEY ||= 'unit-referee-api-key-not-a-deployment-secret';
const { RefereeAccountService, normalizeRefereeEmail, parseRefereeEnsureInput } = require('../dist/account/services/refereeAccountService');
const { assertRefereeAccountAvailable } = require('../dist/account/repositories/refereeAccountRepository');
const { AppError } = require('../dist/lib/errors');
const actorUserId = '11111111-1111-4111-8111-111111111111', tournamentId = '22222222-2222-4222-8222-222222222222', userId = '33333333-3333-4333-8333-333333333333';
const scope = { actorUserId, tournamentId };
const actor = { id: actorUserId, email: 'actor@example.local', fullName: 'BTC', isActive: true, emailVerified: true, accountStatus: 'ACTIVE', roles: ['BTC'] };
const account = { userId, email: 'referee@example.local', fullName: 'Referee', phone: null, isActive: true, emailVerified: true, accountStatus: 'ACTIVE', roles: ['PLAYER', 'REFEREE'] };
function fixture(overrides = {}) {
  const calls = { ensure: [], email: [], complete: [], authorize: [], read: [] };
  const repository = {
    async findByEmail(email) { calls.read.push(email); return account; },
    async resolve() { return [account]; },
    async ensure(input, passwordHash) { calls.ensure.push({ input, passwordHash }); return { account, created: false, roleAdded: false }; },
    async reserveDelivery() { return { reserved: true, delivery: { status: 'PENDING' } }; },
    async withAccessDispatchLock(userId, dispatch) { return dispatch(); },
    async completeDelivery(eventKey, delivery) { calls.complete.push({ eventKey, delivery }); },
    ...overrides.repository,
  };
  const dependencies = {
    async findUserById() { return actor; },
    async fetch(url, options) { calls.authorize.push({ url: String(url), options }); return new Response(null, { status: 204 }); },
    async sendAccess(input) { calls.email.push(input); return { status: 'SENT', sentAt: '2026-11-25T01:00:00Z' }; },
    async makePasswordHash() { return 'server-generated-unusable-placeholder'; },
    ...overrides.dependencies,
  };
  return { service: new RefereeAccountService(repository, dependencies), calls };
}

test('referee identity parsing normalizes email and rejects malformed inputs', () => {
  assert.equal(normalizeRefereeEmail(' Referee@Example.Local '), 'referee@example.local');
  assert.throws(() => normalizeRefereeEmail('bad-email'), { code: 'VALIDATION_ERROR' });
  const parsed = parseRefereeEnsureInput({ ...scope, email: ' REF@Example.Local ', fullName: ' Test Referee ', phone: '+84 901 222 333', idempotencyKey: 'referee-request-1' });
  assert.equal(parsed.email, 'ref@example.local'); assert.equal(parsed.fullName, 'Test Referee');
  assert.throws(() => parseRefereeEnsureInput({ ...parsed, actorUserId: 'not-uuid' }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => parseRefereeEnsureInput({ ...parsed, phone: 'abc' }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => parseRefereeEnsureInput({ ...parsed, idempotencyKey: 'x' }), { code: 'VALIDATION_ERROR' });
});

test('scoped lookup and ensure recheck the actual database actor before upstream or mutation', async () => {
  for (const denied of [{ ...actor, roles: ['TEAM_CAPTAIN'] }, { ...actor, isActive: false }, { ...actor, emailVerified: false }, { ...actor, accountStatus: 'LOCKED' }, null]) {
    const { service, calls } = fixture({ dependencies: { async findUserById() { return denied; } } });
    await assert.rejects(service.lookup(account.email, scope), { code: 'FORBIDDEN' });
    await assert.rejects(service.ensure({ ...scope, email: account.email, idempotencyKey: 'safe-request-1' }), { code: 'FORBIDDEN' });
    assert.equal(calls.authorize.length, 0); assert.equal(calls.ensure.length, 0); assert.equal(calls.email.length, 0);
  }
});

test('scope ownership is independently verified with Tournament Service, not caller role headers', async () => {
  for (const status of [403, 404]) {
    const { service, calls } = fixture({ dependencies: { async fetch() { return new Response(null, { status }); } } });
    await assert.rejects(service.lookup(account.email, scope), { code: 'FORBIDDEN' }); assert.equal(calls.read.length, 0);
  }
  const { service, calls } = fixture();
  const found = await service.lookup(' REFEREE@example.local ', scope);
  assert.equal(found.account.userId, userId);
  assert.match(calls.authorize[0].url, new RegExp('/internal/tournaments/' + tournamentId + '/manager-access$'));
  assert.equal(calls.authorize[0].options.headers['x-user-roles'], 'BTC');
});

test('upstream ownership errors fail closed without account mutations', async () => {
  const failed = fixture({ dependencies: { async fetch() { throw Error('unavailable'); } } });
  await assert.rejects(failed.service.ensure({ ...scope, email: account.email, idempotencyKey: 'safe-request-1' }), { code: 'UPSTREAM_UNAVAILABLE' });
  assert.equal(failed.calls.ensure.length, 0);
  const unexpected = fixture({ dependencies: { async fetch() { return new Response('{}', { status: 200 }); } } });
  await assert.rejects(unexpected.service.lookup(account.email, scope), { code: 'UPSTREAM_ERROR' });
});

test('ensuring an account never dispatches mail or accepts a BTC chosen password', async () => {
  const { service, calls } = fixture();
  const result = await service.ensure({ ...scope, email: ' REFEREE@EXAMPLE.LOCAL ', fullName: 'Different display name', idempotencyKey: 'safe-request-2', password: 'BTC chosen password' });
  assert.deepEqual(result.account.roles, ['PLAYER', 'REFEREE']);
  assert.equal(calls.ensure[0].input.email, account.email);
  assert.equal(calls.ensure[0].passwordHash, 'server-generated-unusable-placeholder');
  assert.equal('password' in calls.ensure[0].input, false); assert.equal(calls.email.length, 0);
});

test('pending staff identity is allowed but locked, disabled and inactive verified accounts cannot be activated implicitly', () => {
  assert.doesNotThrow(() => assertRefereeAccountAvailable({ ...account, isActive: false, emailVerified: false }));
  for (const blocked of [{ ...account, accountStatus: 'LOCKED' }, { ...account, accountStatus: 'DISABLED' }, { ...account, isActive: false }]) assert.throws(() => assertRefereeAccountAvailable(blocked), { code: 'REFEREE_ACCOUNT_UNAVAILABLE' });
});

test('bulk resolution returns sanitized identities and explicit missing IDs', async () => {
  const { service } = fixture();
  const missingId = '44444444-4444-4444-8444-444444444444';
  const result = await service.resolve({ ...scope, userIds: [userId, userId, missingId] });
  assert.deepEqual(result.missingUserIds, [missingId]); assert.equal(result.users.length, 1);
  assert.equal('passwordHash' in result.users[0], false); assert.equal('token' in result.users[0], false);
});

test('a repeated access event never resends for SENT, FAILED or uncertain PENDING', async () => {
  for (const status of ['SENT', 'FAILED', 'PENDING']) {
    const { service, calls } = fixture({ repository: { async reserveDelivery() { return { reserved: false, delivery: { status } }; } } });
    assert.deepEqual(await service.sendAccess(userId, { ...scope, tournamentName: 'Tournament', eventKey: 'event-team-1' }), { status });
    assert.equal(calls.email.length, 0); assert.equal(calls.complete.length, 0);
  }
});

test('post-membership delivery records honest SENT, FAILED or PENDING without returning tokens', async () => {
  for (const delivery of [{ status: 'SENT', sentAt: '2026-11-25T01:00:00Z' }, { status: 'FAILED', errorCode: 'SMTP_NOT_CONFIGURED' }, { status: 'PENDING', errorCode: 'EMAIL_STATUS_UNCERTAIN' }]) {
    const { service, calls } = fixture({ dependencies: { async sendAccess(input) { calls.email.push(input); return delivery; } } });
    const result = await service.sendAccess(userId, { ...scope, tournamentName: 'Tournament', eventKey: 'event-team-2' });
    assert.deepEqual(result, delivery); assert.equal(calls.complete.length, 1); assert.equal(calls.email.length, 1);
    assert.equal('token' in result, false); assert.equal('password' in result, false);
  }
});

test('failed dispatch does not remove an existing referee account or membership', async () => {
  const { service, calls } = fixture({ dependencies: { async sendAccess() { throw new AppError(502, 'Delivery failed', 'EMAIL_DELIVERY_FAILED'); } } });
  const result = await service.sendAccess(userId, { ...scope, tournamentName: 'Tournament', eventKey: 'event-team-3' });
  assert.deepEqual(result, { status: 'FAILED', errorCode: 'EMAIL_DELIVERY_FAILED' }); assert.equal(calls.complete.length, 1); assert.equal(calls.ensure.length, 0);
});

test('uncertain transport or persistence never reports a definitive failure', async () => {
  for (const error of [new AppError(502, 'Uncertain', 'EMAIL_STATUS_UNCERTAIN'), new Error('connection lost')]) {
    const { service, calls } = fixture({ dependencies: { async sendAccess() { throw error; } } });
    const result = await service.sendAccess(userId, { ...scope, tournamentName: 'Tournament', eventKey: 'event-team-4' });
    assert.deepEqual(result, { status: 'PENDING', errorCode: 'EMAIL_STATUS_UNCERTAIN' }); assert.equal(calls.complete.length, 1);
  }
});

test('access dispatches for the same recipient are serialized around token creation and sending', async () => {
  let tail = Promise.resolve(), inFlight = 0, maximumInFlight = 0;
  const { service } = fixture({ repository: { async withAccessDispatchLock(userId, dispatch) { const previous = tail; let release; tail = new Promise(resolve => { release = resolve; }); await previous; try { return await dispatch(); } finally { release(); } } },
    dependencies: { async sendAccess() { inFlight++; maximumInFlight = Math.max(maximumInFlight, inFlight); await new Promise(resolve => setTimeout(resolve, 5)); inFlight--; return { status: 'SENT' }; } } });
  await Promise.all(['one', 'two'].map(key => service.sendAccess(userId, { ...scope, tournamentName: 'Tournament', eventKey: 'serialized-event-' + key })));
  assert.equal(maximumInFlight, 1);
});

test('Auth uses activation only for provisioned pending accounts and verification preserves existing passwords', async () => {
  const userRepository = require('../dist/account/repositories/userRepository');
  const mail = require('../dist/services/verificationEmailService');
  const { AuthService } = require('../dist/services/authService');
  const originalFind = userRepository.findUserById, originalSend = mail.sendRefereeTeamAccessEmail;
  try {
    for (const identity of [{ isActive: false, emailVerified: false, accessType: 'account_activation' }, { isActive: true, emailVerified: false, accessType: 'verification' }, { isActive: true, emailVerified: true, accessType: 'login' }]) {
      const current = { ...actor, id: userId, email: account.email, roles: ['PLAYER', 'REFEREE'], passwordHash: 'original-password-hash', ...identity };
      userRepository.findUserById = async () => current;
      const calls = { activation: [], verification: [], expired: [], mail: [] };
      const auth = new AuthService({ async expirePendingEmailVerifications() {}, async createEmailVerification(...args) { calls.verification.push(args); }, async expireEmailVerificationToken(...args) { calls.expired.push(args); } });
      auth.staffInvitationRepository = { async create(...args) { calls.activation.push(args); }, async expire(...args) { calls.expired.push(args); } };
      mail.sendRefereeTeamAccessEmail = async input => { calls.mail.push(input); return { status: 'SENT' }; };
      const result = await auth.sendRefereeTeamAccountAccess({ userId, tournamentName: 'Tournament', eventKey: 'route-' + identity.accessType });
      assert.deepEqual(result, { status: 'SENT' }); assert.equal('token' in result, false);
      assert.equal(calls.mail[0].accessType, identity.accessType);
      assert.equal(current.passwordHash, 'original-password-hash');
      assert.equal(calls.activation.length, identity.accessType === 'account_activation' ? 1 : 0);
      assert.equal(calls.verification.length, identity.accessType === 'verification' ? 1 : 0);
      if (identity.accessType === 'login') assert.equal('token' in calls.mail[0], false);
      else {
        assert.match(calls.mail[0].token, /^[a-f0-9]{64}$/);
        const expiresAt = identity.accessType === 'account_activation' ? calls.activation[0][2] : calls.verification[0][3];
        assert.ok(expiresAt.getTime() - Date.now() > 23.99 * 3600000 && expiresAt.getTime() - Date.now() <= 24 * 3600000);
      }
    }
  } finally { userRepository.findUserById = originalFind; mail.sendRefereeTeamAccessEmail = originalSend; }
});

test('uncertain SMTP retains activation tokens while known failure expires only the attempted token', async () => {
  const userRepository = require('../dist/account/repositories/userRepository');
  const mail = require('../dist/services/verificationEmailService');
  const { AuthService } = require('../dist/services/authService');
  const originalFind = userRepository.findUserById, originalSend = mail.sendRefereeTeamAccessEmail;
  try {
    userRepository.findUserById = async () => ({ ...actor, id: userId, roles: ['REFEREE'], isActive: false, emailVerified: false });
    for (const status of ['FAILED', 'PENDING']) {
      let issuedToken, expiredToken;
      const auth = new AuthService({});
      auth.staffInvitationRepository = { async create(id, token) { issuedToken = token; }, async expire(token) { expiredToken = token; } };
      mail.sendRefereeTeamAccessEmail = async () => ({ status });
      await auth.sendRefereeTeamAccountAccess({ userId, tournamentName: 'Tournament', eventKey: 'token-' + status });
      assert.equal(expiredToken, status === 'FAILED' ? issuedToken : undefined);
    }
    userRepository.findUserById = async () => ({ ...actor, id: userId, roles: ['REFEREE'], accountStatus: 'LOCKED', isActive: false, emailVerified: false });
    let sent = false; mail.sendRefereeTeamAccessEmail = async () => { sent = true; return { status: 'SENT' }; };
    await assert.rejects(new AuthService({}).sendRefereeTeamAccountAccess({ userId, tournamentName: 'Tournament', eventKey: 'blocked' }), { code: 'REFEREE_ACCOUNT_UNAVAILABLE' });
    assert.equal(sent, false);
  } finally { userRepository.findUserById = originalFind; mail.sendRefereeTeamAccessEmail = originalSend; }
});
