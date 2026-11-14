import { createHmac, timingSafeEqual } from "node:crypto";

const getCredentials = () => {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) {
        const error = new Error("Razorpay is not configured on the server. Add its API credentials to server/.env.") as Error & { statusCode: number };
        error.statusCode = 503;
        throw error;
    }
    return { keyId, keySecret };
};

export const razorpayKeyId = () => getCredentials().keyId;

export const razorpayRequest = async <T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> => {
    const { keyId, keySecret } = getCredentials();
    const response = await fetch(`https://api.razorpay.com/v1${path}`, {
        method,
        headers: {
            Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
            "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null) as (T & { error?: { description?: string; code?: string } }) | null;
    if (!response.ok || !data) {
        const description = data?.error?.description;
        let message = description || `Razorpay request failed (${response.status}).`;
        if (response.status === 401 && !description) {
            message = "Razorpay rejected the API credentials. Confirm RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are a matching test-mode pair in the server environment, then restart the server.";
        }
        const error = new Error(message) as Error & { statusCode: number; code?: string };
        error.statusCode = response.status === 401 ? 401 : response.status === 429 ? 503 : 502;
        if (data?.error?.code) {
            error.code = data.error.code;
        }
        throw error;
    }
    return data;
};

export const verifyHmacSignature = (value: string, signature: string, secret: string): boolean => {
    if (!value || !signature || !secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = createHmac("sha256", secret).update(value, "utf8").digest();
    const actual = Buffer.from(signature, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export const verifySubscriptionCheckoutSignature = (
    subscriptionId: string,
    paymentId: string,
    signature: string,
) => {
    const { keySecret } = getCredentials();
    return verifyHmacSignature(`${paymentId}|${subscriptionId}`, signature, keySecret);
};

export const verifyOrderPaymentSignature = (
    orderId: string,
    paymentId: string,
    signature: string,
) => {
    const { keySecret } = getCredentials();
    return verifyHmacSignature(`${orderId}|${paymentId}`, signature, keySecret);
};

export const verifyWebhookSignature = (rawBody: Buffer, signature: string): boolean => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    const actual = Buffer.from(signature, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
};
