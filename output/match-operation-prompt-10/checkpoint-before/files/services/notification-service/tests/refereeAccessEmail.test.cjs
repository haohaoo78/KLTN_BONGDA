const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const nodemailer = require('nodemailer');
const { config } = require('../dist/config');
const { EmailDeliveryService } = require('../dist/services/emailDeliveryService');

const originalTransport = nodemailer.createTransport;
const originalConfig = { ...config };
let deliveries, sent, failure, accepted;
const pool = {
  async query(sql, params) {
    if (sql.startsWith('INSERT INTO referee_access_email_deliveries')) {
      if (deliveries.has(params[0])) return { rowCount: 0, rows: [] };
      deliveries.set(params[0], { payload_hash: params[2], status: 'PENDING', error_code: null, sent_at: null });
      return { rowCount: 1, rows: [{ event_key: params[0] }] };
    }
    if (sql.startsWith('SELECT payload_hash')) return { rows: [deliveries.get(params[0])] };
    if (sql.includes("SET status='SENT'")) {
      Object.assign(deliveries.get(params[0]), { status: 'SENT', sent_at: new Date('2026-11-25T01:00:00Z') });
      return { rowCount: 1 };
    }
    if (sql.includes("SET status='FAILED'")) {
      Object.assign(deliveries.get(params[0]), { status: 'FAILED', error_code: params[1] });
      return { rowCount: 1 };
    }
    throw Error(`Unexpected SQL: ${sql}`);
  },
};
const input = {
  eventKey: 'referee-email:test-event-1', email: 'referee@example.invalid',
  fullName: 'Trọng tài <A>', tournamentName: 'Giải & Cup',
  accessType: 'account_activation', token: 'a'.repeat(64),
};
beforeEach(() => {
  deliveries = new Map(); sent = []; failure = null; accepted = true;
  Object.assign(config, { smtpHost: 'unit-test.invalid', smtpPort: 587, smtpUser: '', smtpPassword: '', mailFrom: 'test@example.invalid', mailDeliveryMode: 'smtp' });
  nodemailer.createTransport = () => ({
    async sendMail(mail) {
      sent.push(mail);
      if (failure) throw Object.assign(new Error('SMTP test failure'), { code: failure });
      return { accepted: accepted ? [mail.to] : [], messageId: 'smtp-test-message' };
    },
    close() {},
  });
});
afterEach(() => { nodemailer.createTransport = originalTransport; Object.assign(config, originalConfig); });

test('referee email claims one event, sends activation link once and stores no raw token', async () => {
  const service = new EmailDeliveryService(pool);
  assert.equal((await service.sendRefereeTeamAccessEmail(input)).status, 'SENT');
  assert.equal((await service.sendRefereeTeamAccessEmail(input)).status, 'SENT');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /activate=/);
  assert.match(sent[0].html, /Trọng tài &lt;A&gt;/);
  assert.match(sent[0].html, /Giải &amp; Cup/);
  assert.equal(JSON.stringify([...deliveries]).includes(input.token), false);
});
test('an SMTP failure is persisted and a repeated event never resends; explicit new event can send', async () => {
  const service = new EmailDeliveryService(pool); failure = 'EAUTH';
  assert.deepEqual(await service.sendRefereeTeamAccessEmail(input), { status: 'FAILED', errorCode: 'EAUTH' });
  failure = null;
  assert.equal((await service.sendRefereeTeamAccessEmail(input)).status, 'FAILED');
  assert.equal(sent.length, 1);
  assert.equal((await service.sendRefereeTeamAccessEmail({ ...input, eventKey: 'referee-email:test-event-2' })).status, 'SENT');
  assert.equal(sent.length, 2);
});
test('no SMTP recipient acceptance cannot be reported as SENT', async () => {
  accepted = false;
  assert.deepEqual(await new EmailDeliveryService(pool).sendRefereeTeamAccessEmail(input), { status: 'FAILED', errorCode: 'SMTP_RECIPIENT_REJECTED' });
});
test('missing SMTP configuration produces a durable failure without sending', async () => {
  config.smtpHost = '';
  assert.deepEqual(await new EmailDeliveryService(pool).sendRefereeTeamAccessEmail(input), { status: 'FAILED', errorCode: 'EMAIL_DELIVERY_NOT_CONFIGURED' });
  assert.equal(sent.length, 0);
});
test('pending delivery is not retried and reuse for another recipient is rejected', async () => {
  const service = new EmailDeliveryService(pool);
  await service.sendRefereeTeamAccessEmail(input);
  deliveries.get(input.eventKey).status = 'PENDING';
  assert.equal((await service.sendRefereeTeamAccessEmail(input)).status, 'PENDING');
  assert.equal(sent.length, 1);
  await assert.rejects(service.sendRefereeTeamAccessEmail({ ...input, email: 'other@example.invalid' }), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('existing active account gets login notice, no activation/reset link or acceptance workflow', async () => {
  await new EmailDeliveryService(pool).sendRefereeTeamAccessEmail({ ...input, accessType: 'login', token: undefined });
  assert.match(sent[0].text, /#login/);
  assert.doesNotMatch(sent[0].text, /[?&](activate|reset|verify)=/);
  assert.match(sent[0].text, /không cần xác nhận nhận việc/);
});
test('display-name sender configuration is parsed to a bare SMTP mailbox without changing configuration', async () => {
  config.mailFrom = 'Sân Cỏ <sender@example.invalid>';
  assert.equal((await new EmailDeliveryService(pool).sendRefereeTeamAccessEmail(input)).status, 'SENT');
  assert.deepEqual(sent[0].from, { name: config.mailFromName, address: 'sender@example.invalid' });
  assert.equal(config.mailFrom, 'Sân Cỏ <sender@example.invalid>');
});
test('malformed or multiple configured senders fail honestly before SMTP', async () => {
  for (const mailFrom of ['invalid-sender', 'A <a@example.invalid>, B <b@example.invalid>']) {
    config.mailFrom = mailFrom;
    const result = await new EmailDeliveryService(pool).sendRefereeTeamAccessEmail({ ...input, eventKey: 'referee-email:' + sent.length + mailFrom.length });
    assert.equal(result.status, 'FAILED');
    assert.equal(result.errorCode, 'EMAIL_DELIVERY_NOT_CONFIGURED');
  }
  assert.equal(sent.length, 0);
});
