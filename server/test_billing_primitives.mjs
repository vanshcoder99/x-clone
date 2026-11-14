import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { countCharacters, isAIActionAllowed, PLAN_CONFIG } from "./src/lib/plan-config.ts";
import { verifyHmacSignature } from "./src/lib/razorpay.ts";
import { verifySubscriptionCheckoutSignature } from "./src/lib/razorpay.ts";

assert.equal(PLAN_CONFIG.FREE.pricePaise, 0);
assert.equal(PLAN_CONFIG.PLUS.pricePaise, 19900);
assert.equal(PLAN_CONFIG.PRO.pricePaise, 49900);
assert.equal(PLAN_CONFIG.FREE.monthlyCredits, 20);
assert.equal(PLAN_CONFIG.PLUS.monthlyCredits, 300);
assert.equal(PLAN_CONFIG.PRO.monthlyCredits, 1000);
assert.equal(PLAN_CONFIG.FREE.maxPostCharacters, 280);
assert.equal(PLAN_CONFIG.PLUS.maxPostCharacters, 2000);
assert.equal(PLAN_CONFIG.PRO.maxPostCharacters, 10000);
assert.equal(countCharacters("A😀👩‍💻e\u0301"), 4);
assert.equal(isAIActionAllowed("FREE", "improve"), true);
assert.equal(isAIActionAllowed("FREE", "expand"), false);
assert.equal(isAIActionAllowed("PLUS", "professional"), true);
assert.equal(isAIActionAllowed("PLUS", "expand"), false);
assert.equal(isAIActionAllowed("PRO", "expand"), true);

const value = "sub_test|pay_test";
const secret = "billing-unit-test-secret";
const validSignature = createHmac("sha256", secret).update(value).digest("hex");
assert.equal(verifyHmacSignature(value, validSignature, secret), true);
assert.equal(verifyHmacSignature(value, "0".repeat(64), secret), false);
assert.equal(verifyHmacSignature(`${value}!`, validSignature, secret), false);
assert.equal(verifyHmacSignature(value, "invalid", secret), false);
process.env.RAZORPAY_KEY_ID = "rzp_test_unit";
process.env.RAZORPAY_KEY_SECRET = secret;
const subscriptionSignature = createHmac("sha256", secret).update("pay_test|sub_test").digest("hex");
assert.equal(verifySubscriptionCheckoutSignature("sub_test", "pay_test", subscriptionSignature), true);
assert.equal(verifySubscriptionCheckoutSignature("sub_other", "pay_test", subscriptionSignature), false);

console.log("Billing primitives passed: plans, INR paise conversion, Unicode graphemes, AI gates, and HMAC validation.");
