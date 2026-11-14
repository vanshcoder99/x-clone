interface RazorpayCheckoutResponse {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
    key: string;
    subscription_id: string;
    name: string;
    description: string;
    prefill?: { name: string; email: string };
    theme?: { color: string };
    handler: (response: RazorpayCheckoutResponse) => void | Promise<void>;
    modal?: { ondismiss?: () => void };
}

interface RazorpayCheckoutError {
    error?: { description?: string };
}

declare class RazorpayCheckout {
    constructor(options: RazorpayCheckoutOptions);
    open(): void;
    on(event: "payment.failed", handler: (event: RazorpayCheckoutError) => void): void;
}

interface Window {
    Razorpay?: typeof RazorpayCheckout;
}
