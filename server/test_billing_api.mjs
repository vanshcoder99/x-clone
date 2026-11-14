import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

process.env.PORT = "5073";
process.env.RAZORPAY_KEY_ID = "rzp_test_socialsphere_unit";
process.env.RAZORPAY_KEY_SECRET = "billing-api-unit-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "billing-api-webhook-unit-secret";
delete process.env.RAZORPAY_PLUS_PLAN_ID;
delete process.env.RAZORPAY_PRO_PLAN_ID;

const { httpServer, io, prisma } = await import("./dist/index.js");
const { generateAccessToken } = await import("./dist/lib/jwt.js");
const id = randomUUID().replaceAll("-", "").slice(0, 12);
const username = `billing_api_${id}`;
const webhookEventId = `evt_test_${id}`;
let userId;
const base = "http://127.0.0.1:5073/api";

const request = async (path, method = "GET", { token, body, headers } = {}) => {
    const response = await fetch(`${base}${path}`, {
        method,
        headers: {
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
};

try {
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("API server startup timeout")), 10000);
        httpServer.once("listening", () => { clearTimeout(timer); resolve(); });
    });
    const user = await prisma.user.create({
        data: { username, email: `${username}@example.test`, name: "Billing API Test" },
        select: { id: true, username: true },
    });
    userId = user.id;
    const token = generateAccessToken({ userId: user.id, username: user.username });

    const plans = await request("/billing/plans");
    assert.equal(plans.status, 200);
    assert.deepEqual(plans.data.plans.map((plan) => [plan.tier, plan.priceInr, plan.pricePaise]), [
        ["FREE", 0, 0], ["PLUS", 199, 19900], ["PRO", 499, 49900],
    ]);
    console.log("PASS public plan list exposes authoritative INR prices");

    const overview = await request("/billing/me", "GET", { token });
    assert.equal(overview.status, 200);
    assert.equal(overview.data.entitlements.tier, "FREE");
    assert.equal(overview.data.entitlements.monthlyCredits, 20);
    assert.equal(overview.data.entitlements.creditsRemaining, 20);
    assert.equal(overview.data.entitlements.maxPostCharacters, 280);
    console.log("PASS new account receives server-derived Free entitlements");

    const invalidPlan = await request("/billing/subscriptions", "POST", { token, body: { plan: "ULTRA" } });
    assert.equal(invalidPlan.status, 400);
    const unavailable = await request("/billing/subscriptions", "POST", { token, body: { plan: "PLUS" } });
    assert.equal(unavailable.status, 503);
    console.log("PASS invalid plans are rejected and paid checkout fails closed without preconfigured Dashboard plans");

    const invalidSignature = await request("/billing/subscriptions/verify", "POST", {
        token,
        body: { razorpay_subscription_id: "sub_test", razorpay_payment_id: "pay_test", razorpay_signature: "0".repeat(64) },
    });
    assert.equal(invalidSignature.status, 400);
    console.log("PASS callback with an invalid Razorpay signature cannot grant a plan");

    const unauthorized = await request("/billing/me");
    assert.equal(unauthorized.status, 401);
    console.log("PASS billing dashboard requires authentication");

    const tooLong = await request("/tweets", "POST", { token, body: { content: "😀".repeat(281) } });
    assert.equal(tooLong.status, 400);
    const exactLimit = await request("/tweets", "POST", { token, body: { content: "😀".repeat(280) } });
    assert.equal(exactLimit.status, 201);
    console.log("PASS Free post character cap counts emoji graphemes and allows the exact 280-character limit");

    const rawPayload = Buffer.from(JSON.stringify({ entity: "event", event: "payment.authorized", created_at: Math.floor(Date.now() / 1000), payload: {} }));
    const signed = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(rawPayload).digest("hex");
    const invalidWebhook = await request("/billing/webhooks/razorpay", "POST", {
        body: JSON.parse(rawPayload.toString("utf8")),
        headers: { "x-razorpay-signature": "f".repeat(64), "x-razorpay-event-id": webhookEventId },
    });
    assert.equal(invalidWebhook.status, 400);
    console.log("PASS webhook with invalid raw-body signature is rejected");

    const firstWebhook = await fetch(`${base}/billing/webhooks/razorpay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-razorpay-signature": signed, "x-razorpay-event-id": webhookEventId },
        body: rawPayload,
    });
    assert.equal(firstWebhook.status, 200);
    const duplicateWebhook = await fetch(`${base}/billing/webhooks/razorpay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-razorpay-signature": signed, "x-razorpay-event-id": webhookEventId },
        body: rawPayload,
    });
    const duplicateBody = await duplicateWebhook.json();
    assert.equal(duplicateWebhook.status, 200);
    assert.equal(duplicateBody.duplicate, true);
    console.log("PASS signed webhook is accepted and duplicate event IDs are idempotent");
} finally {
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.processedWebhookEvent.deleteMany({ where: { eventId: webhookEventId } });
    io.close();
    await new Promise((resolve) => httpServer.close(() => resolve()));
    await prisma.$disconnect();
}
