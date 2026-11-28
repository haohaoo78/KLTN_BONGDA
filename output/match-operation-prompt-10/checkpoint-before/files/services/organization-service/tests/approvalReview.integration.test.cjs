const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

test("approval review records the full request, response, supplement, and retain timeline", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const {
    createApprovalReview,
    listApprovalReviews,
    requestApprovalReviewSupplement,
    respondToApprovalReview,
    retainApprovalReview,
  } = require("../dist/repositories/approvalReviewRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const ids = { team: randomUUID(), captain: randomUUID(), tournament: randomUUID(), registration: randomUUID() };
  let reviewId;
  try {
    await pool.query("INSERT INTO teams (id,name,captain_id) VALUES($1,$2,$3)", [ids.team, "Approval review integration fixture", ids.captain]);
    await pool.query(
      `INSERT INTO team_registrations(id,team_id,tournament_id,status,submission_sequence,submitted_at,submitted_roster,version)
       VALUES($1,$2,$3,'APPROVED',1,NOW(),'[]'::jsonb,1)`, [ids.registration, ids.team, ids.tournament],
    );

    const opened = await createApprovalReview({
      registrationId: ids.registration, requestedBy: randomUUID(), reason: "Xác minh lại thông tin đăng ký đội.",
      responseDeadline: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    reviewId = opened.id;
    await respondToApprovalReview(opened.id, ids.captain, "Đội đã gửi giải trình theo yêu cầu.");
    await requestApprovalReviewSupplement(opened.id, "Vui lòng gửi thêm minh chứng hợp lệ.", new Date(Date.now() + 2 * 60 * 60_000).toISOString(), randomUUID());
    await respondToApprovalReview(opened.id, ids.captain, "Đội đã bổ sung minh chứng.");
    await retainApprovalReview(opened.id, randomUUID(), "BTC đã xác minh và giữ nguyên phê duyệt.");

    const [review] = await listApprovalReviews(ids.registration);
    assert.equal(review.status, "RETAINED");
    assert.deepEqual(review.events.map((event) => [event.eventType, event.statusBefore, event.statusAfter]), [
      ["OPENED", "APPROVED", "OPEN"],
      ["TEAM_RESPONDED", "OPEN", "RESPONDED"],
      ["SUPPLEMENT_REQUESTED", "RESPONDED", "SUPPLEMENT_REQUIRED"],
      ["TEAM_RESPONDED", "SUPPLEMENT_REQUIRED", "RESPONDED"],
      ["RETAINED", "RESPONDED", "RETAINED"],
    ]);
  } finally {
    if (reviewId) {
      await pool.query("DELETE FROM team_registration_approval_review_events WHERE review_id=$1", [reviewId]);
      await pool.query("DELETE FROM team_registration_approval_reviews WHERE id=$1", [reviewId]);
    }
    await pool.query("DELETE FROM team_registration_versions WHERE registration_id=$1", [ids.registration]);
    await pool.query("DELETE FROM team_registrations WHERE id=$1", [ids.registration]);
    await pool.query("DELETE FROM teams WHERE id=$1", [ids.team]);
    await closePool();
  }
});

test("revoking approval records the review decision without deleting the registration", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const { createApprovalReview, listApprovalReviews, markApprovalReviewRevoked } = require("../dist/repositories/approvalReviewRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const ids = { team: randomUUID(), captain: randomUUID(), tournament: randomUUID(), registration: randomUUID() };
  let reviewId;
  try {
    await pool.query("INSERT INTO teams (id,name,captain_id) VALUES($1,$2,$3)", [ids.team, "Approval revoke integration fixture", ids.captain]);
    await pool.query(
      `INSERT INTO team_registrations(id,team_id,tournament_id,status,submission_sequence,submitted_at,submitted_roster,version)
       VALUES($1,$2,$3,'APPROVED',1,NOW(),'[]'::jsonb,1)`, [ids.registration, ids.team, ids.tournament],
    );
    const opened = await createApprovalReview({
      registrationId: ids.registration, requestedBy: randomUUID(), reason: "Kiểm tra căn cứ phê duyệt.",
      responseDeadline: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    reviewId = opened.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE team_registrations SET status='APPROVAL_REVOKED' WHERE id=$1", [ids.registration]);
      await markApprovalReviewRevoked(client, opened.id, "Hồ sơ không đáp ứng điều lệ.", randomUUID());
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }

    const [review] = await listApprovalReviews(ids.registration);
    const registration = await pool.query("SELECT status FROM team_registrations WHERE id=$1", [ids.registration]);
    assert.equal(registration.rows[0].status, "APPROVAL_REVOKED");
    assert.equal(review.status, "REVOKED");
    assert.deepEqual(review.events.map((event) => [event.eventType, event.statusBefore, event.statusAfter]), [
      ["OPENED", "APPROVED", "OPEN"],
      ["REVOKED", "OPEN", "REVOKED"],
    ]);
  } finally {
    if (reviewId) {
      await pool.query("DELETE FROM team_registration_approval_review_events WHERE review_id=$1", [reviewId]);
      await pool.query("DELETE FROM team_registration_approval_reviews WHERE id=$1", [reviewId]);
    }
    await pool.query("DELETE FROM team_registration_versions WHERE registration_id=$1", [ids.registration]);
    await pool.query("DELETE FROM team_registrations WHERE id=$1", [ids.registration]);
    await pool.query("DELETE FROM teams WHERE id=$1", [ids.team]);
    await closePool();
  }
});
