const assert = require("node:assert/strict");
const test = require("node:test");
const { NotificationService } = require("../dist/services/notificationService");

test("notification retries reuse the original notification and do not duplicate delivery logs", async () => {
  let insertCount = 0;
  let deliveryLogCount = 0;
  const notification = { id: 23, userId: "user-1", type: "TOURNAMENT_INVITATION", title: "Invalidated", body: "Changed", data: {}, isRead: false };
  const repository = {
    createNotificationOnce: async () => {
      insertCount += 1;
      return { notification, created: insertCount === 1 };
    },
    createDeliveryLog: async () => { deliveryLogCount += 1; },
    createNotification: async () => { throw new Error("idempotent path must not use non-idempotent insert"); },
  };
  const service = new NotificationService(repository);
  const input = {
    userId: "user-1", type: "TOURNAMENT_INVITATION", title: "Invalidated", body: "Changed",
    idempotencyKey: "invitation-invalidated:inv-1:player",
  };
  assert.equal(await service.sendNotification(input), notification);
  assert.equal(await service.sendNotification(input), notification);
  assert.equal(insertCount, 2);
  assert.equal(deliveryLogCount, 1);
});
