import { useEffect, useState } from "react";
import { ArrowRight, Check, CircleCheck, Loader2, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { isAxiosError } from "axios";
import { api } from "../api/client";
import { useAuth } from "../features/auth/hooks";

interface Plan {
    tier: "FREE" | "PLUS" | "PRO";
    name: string;
    priceInr: number;
    monthlyCredits: number;
    maxPostCharacters: number;
    features: string[];
}

interface CheckoutResponse {
    checkout: {
        keyId: string;
        subscriptionId?: string;
        orderId?: string;
        name: string;
        description: string;
        amountInr: number;
        amountPaise?: number;
        currency: string;
        prefill: { name: string | null; email: string } | null;
    };
}

const loadRazorpayCheckout = () => new Promise<boolean>((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
});

export const PlansPage = () => {
    const { user, refreshUser } = useAuth();
    const navigate = useNavigate();
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [selectedTier, setSelectedTier] = useState<Plan["tier"] | null>(null);
    const [message, setMessage] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

    useEffect(() => {
        let active = true;
        api.get("/billing/plans")
            .then(({ data }) => { if (active) setPlans(data.plans || []); })
            .catch(() => { if (active) setMessage({ kind: "error", text: "Unable to load plans. Please try again." }); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const startCheckout = async (plan: Plan) => {
        setMessage(null);
        if (!user) {
            navigate("/auth?mode=login&redirect=/plans");
            return;
        }
        if (plan.tier === "FREE") return;

        setProcessing(true);
        try {
            const [{ data }, checkoutLoaded] = await Promise.all([
                api.post<CheckoutResponse>("/billing/subscriptions", { plan: plan.tier }),
                loadRazorpayCheckout(),
            ]);
            if (!checkoutLoaded || !window.Razorpay) throw new Error("Razorpay Checkout could not be loaded. Check your connection and retry.");

            const checkout = data.checkout;
            let checkoutCompleted = false;

            const checkoutOptions: RazorpayCheckoutOptions = {
                key: checkout.keyId,
                name: checkout.name,
                description: checkout.description,
                prefill: checkout.prefill ? { name: checkout.prefill.name || "", email: checkout.prefill.email } : undefined,
                theme: { color: "#1d9bf0" },
                handler: async (response) => {
                    checkoutCompleted = true;
                    setMessage({ kind: "info", text: "Payment received. Verifying with Razorpay…" });
                    try {
                        const result = await api.post("/billing/subscriptions/verify", response);
                        if (result.data.status === "ACTIVE") {
                            await refreshUser();
                            setMessage({ kind: "success", text: `${plan.name} is active. Your new entitlements are ready.` });
                        } else {
                            setMessage({ kind: "info", text: "Razorpay is confirming the subscription. This page will update when the signed webhook arrives." });
                        }
                    } catch (error) {
                        setMessage({
                            kind: "error",
                            text: isAxiosError(error) && typeof error.response?.data?.error === "string"
                                ? error.response.data.error
                                : "We could not verify this payment yet. The webhook will reconcile its status."
                        });
                    }
                },
                modal: {
                    ondismiss: () => {
                        if (!checkoutCompleted) {
                            const cancelTarget = checkout.subscriptionId || checkout.orderId;
                            if (cancelTarget) {
                                void api.post(`/billing/subscriptions/${encodeURIComponent(cancelTarget)}/cancel-pending`).catch(() => undefined);
                            }
                            setMessage({ kind: "info", text: "Checkout was closed. Your plan was not changed." });
                        }
                    }
                },
            };

            if (checkout.subscriptionId) {
                checkoutOptions.subscription_id = checkout.subscriptionId;
            } else if (checkout.orderId) {
                checkoutOptions.order_id = checkout.orderId;
                checkoutOptions.amount = checkout.amountPaise || checkout.amountInr * 100;
                checkoutOptions.currency = checkout.currency || "INR";
            }

            const widget = new window.Razorpay(checkoutOptions);
            widget.on("payment.failed", (event) => {
                setMessage({ kind: "error", text: event.error?.description || "Payment failed. Your current plan is unchanged." });
            });
            widget.open();
        } catch (error) {
            setMessage({ kind: "error", text: isAxiosError(error) && typeof error.response?.data?.error === "string" ? error.response.data.error : error instanceof Error ? error.message : "Unable to start checkout." });
        } finally {
            setProcessing(false);
        }
    };

    const currentTier = user?.entitlements?.tier || "FREE";

    return (
        <main className="billing-workspace flex-1 min-w-0 h-full overflow-y-auto border-x border-border-dark bg-black px-4 py-6 sm:px-7 lg:px-10">
            <div className="mx-auto w-full max-w-6xl">
                <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-premium-violet/30 bg-premium-violet/10 px-3 py-1 text-xs font-semibold text-premium-violet"><Sparkles size={14} /> SocialSphere Plans</p>
                        <h1 className="text-3xl font-extrabold text-white sm:text-4xl">Choose your plan</h1>
                        <p className="mt-2 text-sm text-text-secondary">Monthly plans billed securely through Razorpay Subscriptions.</p>
                    </div>
                    <button onClick={() => navigate("/settings/billing")} className="rounded-full border border-border-dark px-4 py-2 text-sm font-semibold text-text-primary hover:bg-white/5">Billing dashboard</button>
                </header>

                {message && <p role="status" className={`mb-6 rounded-xl border px-4 py-3 text-sm ${message.kind === "error" ? "border-red-500/30 bg-red-950/30 text-red-300" : message.kind === "success" ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300" : "border-accent-blue/30 bg-accent-blue/10 text-blue-200"}`}>{message.text}</p>}

                {loading ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent-blue" /></div> : (
                    <div className="grid items-stretch gap-4 lg:grid-cols-3">
                        {plans.map((plan) => {
                            const isCurrent = currentTier === plan.tier;
                            const isSelected = selectedTier === plan.tier || (!selectedTier && isCurrent);
                            const recommended = plan.tier === "PLUS";
                            return (
                                <article
                                    key={plan.tier}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={isSelected}
                                    aria-label={`Select the ${plan.name} plan`}
                                    onClick={() => setSelectedTier(plan.tier)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            setSelectedTier(plan.tier);
                                        }
                                    }}
                                    className={`plan-card group relative flex cursor-pointer flex-col rounded-3xl border p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl sm:p-6 ${isSelected ? `plan-card-selected ${recommended ? "plan-card-selected-recommended" : ""} -translate-y-1 ${recommended ? "border-premium-violet bg-premium-violet/10 shadow-xl shadow-purple-950/40" : "border-accent-blue bg-surface-hover shadow-xl shadow-accent-blue/15"}` : "border-border-dark bg-surface-primary hover:border-accent-blue/60 hover:bg-surface-hover hover:shadow-accent-blue/10"} ${recommended && !isSelected ? "border-premium-violet/70 shadow-xl shadow-purple-950/30 hover:border-premium-violet" : ""} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue`}
                                >
                                    {recommended && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-premium-violet px-3 py-1 text-[11px] font-extrabold text-black">RECOMMENDED</span>}
                                    <div className="mb-5 flex items-center justify-between">
                                        <h2 className="text-xl font-extrabold text-white">{plan.name}</h2>
                                        {isCurrent && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-300"><CircleCheck size={13} /> Current</span>}
                                    </div>
                                    <div className="mb-5 flex items-baseline gap-1">
                                        <span className="text-4xl font-extrabold text-white">₹{plan.priceInr}</span>
                                        <span className="text-sm text-text-muted">/ month</span>
                                    </div>
                                    <div className="mb-5 space-y-2 rounded-2xl border border-border-dark bg-surface-secondary p-4 text-sm">
                                        <p className="flex justify-between gap-2"><span className="text-text-secondary">AI credits</span><strong className="text-white">{plan.monthlyCredits.toLocaleString()} / month</strong></p>
                                        <p className="flex justify-between gap-2"><span className="text-text-secondary">Post length</span><strong className="text-white">{plan.maxPostCharacters.toLocaleString()} characters</strong></p>
                                    </div>
                                    <ul className="mb-7 flex-1 space-y-3">
                                        {plan.features.map((feature) => <li key={feature} className="flex items-start gap-2.5 text-sm leading-5 text-text-secondary"><Check size={16} className="mt-0.5 shrink-0 text-accent-blue" />{feature}</li>)}
                                    </ul>
                                    <button
                                        onClick={() => void startCheckout(plan)}
                                        disabled={processing || isCurrent || plan.tier === "FREE"}
                                        className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${recommended ? "bg-premium-violet text-black hover:bg-purple-300" : "bg-accent-blue text-white hover:bg-accent-blue-hover"}`}
                                    >
                                        {processing ? <Loader2 size={16} className="animate-spin" /> : null}
                                        {isCurrent ? "Current plan" : plan.tier === "FREE" ? "Free plan" : currentTier === "FREE" ? "Continue to payment" : "Change plan"}
                                        {!isCurrent && plan.tier !== "FREE" && !processing && <ArrowRight size={16} />}
                                    </button>
                                </article>
                            );
                        })}
                    </div>
                )}
                <p className="mt-6 text-xs leading-5 text-text-muted">Paid features activate only after server-side payment verification. Recurring billing requires Razorpay Subscriptions enabled for your merchant account.</p>
            </div>
        </main>
    );
};
