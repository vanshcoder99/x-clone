import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, CalendarClock, CreditCard, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { isAxiosError } from "axios";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../features/auth/hooks";

interface BillingData {
    entitlements: {
        tier: "FREE" | "PLUS" | "PRO";
        planName: string;
        subscriptionStatus: string;
        currentPeriodStart: string;
        currentPeriodEnd: string;
        monthlyCredits: number;
        creditsUsed: number;
        creditsRemaining: number;
        maxPostCharacters: number;
        cancelAtPeriodEnd: boolean;
    };
    subscription: { status: string; cancelAtPeriodEnd: boolean } | null;
    payments: Array<{ id: string; amount: number; currency: string; status: string; createdAt: string; razorpayPaymentId: string }>;
}

export const BillingPage = () => {
    const { user, refreshUser, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const [billing, setBilling] = useState<BillingData | null>(null);
    const [loading, setLoading] = useState(true);
    const [canceling, setCanceling] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const loadBilling = useCallback(async () => {
        setError("");
        if (!user?.id) {
            setBilling(null);
            setLoading(false);
            return;
        }
        try {
            const { data } = await api.get<BillingData>("/billing/me");
            setBilling(data);
        } catch (err) {
            setError(isAxiosError(err) && typeof err.response?.data?.error === "string" ? err.response.data.error : "Unable to load your billing details.");
        } finally {
            setLoading(false);
        }
    }, [user?.id]);

    useEffect(() => {
        if (authLoading) return;
        const timer = window.setTimeout(() => { void loadBilling(); }, 0);
        return () => window.clearTimeout(timer);
    }, [authLoading, loadBilling]);

    const cancel = async () => {
        if (!window.confirm("Cancel renewal at the end of your current billing period? Paid features remain available until then.")) return;
        setCanceling(true);
        setNotice("");
        try {
            await api.post("/billing/subscriptions/cancel");
            await Promise.all([loadBilling(), refreshUser()]);
            setNotice("Renewal is canceled. Your current paid entitlements remain active through the period end.");
        } catch (err) {
            setError(isAxiosError(err) && typeof err.response?.data?.error === "string" ? err.response.data.error : "Could not cancel the subscription.");
        } finally {
            setCanceling(false);
        }
    };

    if (authLoading || loading) return <main className="billing-workspace flex min-h-0 min-w-0 flex-1 items-center justify-center border-x border-border-dark bg-black p-8"><Loader2 className="animate-spin text-accent-blue" /></main>;
    if (!user) return <main className="billing-workspace flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center border-x border-border-dark bg-black px-6 text-center"><CreditCard size={34} className="mb-4 text-premium-violet" /><h1 className="text-2xl font-extrabold text-white">Sign in to view billing</h1><p className="mt-2 max-w-sm text-sm leading-6 text-text-secondary">Your plan, payment history and renewal settings are tied to your account.</p><button type="button" onClick={() => navigate("/auth?mode=login&redirect=%2Fsettings%2Fbilling")} className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent-blue px-5 py-2.5 text-sm font-bold text-white hover:bg-accent-blue-hover">Sign in <ArrowRight size={16} /></button></main>;

    return (
        <main className="billing-workspace flex-1 min-w-0 h-full overflow-y-auto border-x border-border-dark bg-black px-4 py-6 sm:px-7 lg:px-10">
            <div className="mx-auto w-full max-w-5xl">
                <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-premium-violet"><CreditCard size={16} /> Account settings</p>
                        <h1 className="text-3xl font-extrabold text-white">Subscription & billing</h1>
                    </div>
                    <button onClick={() => void loadBilling()} className="inline-flex items-center gap-2 rounded-full border border-border-dark px-4 py-2 text-sm font-semibold text-text-primary hover:bg-white/5"><RefreshCw size={15} /> Refresh</button>
                </header>

                {error && <div role="alert" className="mb-5 rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}
                {notice && <div role="status" className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-300">{notice}</div>}

                {billing && <>
                    <section className="grid gap-4 md:grid-cols-2">
                        <article className="rounded-3xl border border-border-dark bg-surface-primary p-5 sm:p-6">
                            <div className="mb-5 flex items-center justify-between">
                                <h2 className="text-lg font-bold text-white">Current plan</h2>
                                <span className={`rounded-full px-3 py-1 text-xs font-bold ${billing.entitlements.tier === "FREE" ? "bg-white/10 text-text-secondary" : "bg-premium-violet/15 text-premium-violet"}`}>{billing.entitlements.tier}</span>
                            </div>
                            <p className="text-3xl font-extrabold text-white">{billing.entitlements.planName}</p>
                            <p className="mt-2 text-sm text-text-secondary">Status: <span className="font-semibold text-text-primary">{billing.entitlements.subscriptionStatus.toLowerCase().replaceAll("_", " ")}</span></p>
                            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-border-dark bg-surface-secondary p-4">
                                <CalendarClock size={18} className="mt-0.5 text-accent-blue" />
                                <div className="text-sm">
                                    <p className="font-semibold text-white">Billing period</p>
                                    <p className="mt-1 text-text-secondary">{new Date(billing.entitlements.currentPeriodStart).toLocaleDateString()} – {new Date(billing.entitlements.currentPeriodEnd).toLocaleDateString()}</p>
                                    {billing.entitlements.cancelAtPeriodEnd && <p className="mt-2 text-amber-300">Renewal is canceled; access ends when this period ends.</p>}
                                </div>
                            </div>
                            <div className="mt-5 flex flex-wrap gap-2">
                                <Link to="/plans" className="inline-flex items-center gap-2 rounded-full bg-accent-blue px-4 py-2.5 text-sm font-bold text-white hover:bg-accent-blue-hover">Change plan <ArrowUpRight size={15} /></Link>
                                {billing.subscription?.status === "ACTIVE" && !billing.subscription.cancelAtPeriodEnd && <button onClick={() => void cancel()} disabled={canceling} className="rounded-full border border-border-dark px-4 py-2.5 text-sm font-semibold text-text-secondary hover:border-red-500/40 hover:text-red-300 disabled:opacity-50">{canceling ? "Canceling…" : "Cancel renewal"}</button>}
                            </div>
                        </article>

                        <article className="rounded-3xl border border-border-dark bg-surface-primary p-5 sm:p-6">
                            <div className="mb-5 flex items-center gap-2"><Sparkles size={18} className="text-premium-violet" /><h2 className="text-lg font-bold text-white">AI & posting entitlements</h2></div>
                            <div className="mb-5">
                                <div className="mb-2 flex items-center justify-between text-sm"><span className="text-text-secondary">AI credits remaining</span><strong className="text-white">{billing.entitlements.creditsRemaining} / {billing.entitlements.monthlyCredits}</strong></div>
                                <div className="h-2 overflow-hidden rounded-full bg-surface-secondary"><div className="h-full rounded-full bg-premium-violet transition-all" style={{ width: `${billing.entitlements.monthlyCredits ? (billing.entitlements.creditsRemaining / billing.entitlements.monthlyCredits) * 100 : 0}%` }} /></div>
                            </div>
                            <p className="mb-3 text-sm text-text-secondary">Used this cycle: <strong className="text-white">{billing.entitlements.creditsUsed}</strong></p>
                            <p className="text-sm text-text-secondary">Post character limit: <strong className="text-white">{billing.entitlements.maxPostCharacters.toLocaleString()}</strong></p>
                            <p className="mt-4 text-xs text-text-muted">Credits reset at the start of your next billing period and do not roll over.</p>
                        </article>
                    </section>

                    <section className="mt-7 rounded-3xl border border-border-dark bg-surface-primary p-5 sm:p-6">
                        <div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-white">Payment history</h2><p className="mt-1 text-sm text-text-muted">Razorpay payment records for this account.</p></div></div>
                        {billing.payments.length === 0 ? <p className="rounded-2xl border border-dashed border-border-dark px-4 py-8 text-center text-sm text-text-muted">No payments recorded yet.</p> : (
                            <div className="divide-y divide-border-dark">
                                {billing.payments.map((payment) => <div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                    <div><p className="font-semibold text-white">₹{(payment.amount / 100).toLocaleString("en-IN")}</p><p className="mt-1 text-xs text-text-muted">{new Date(payment.createdAt).toLocaleString()} · {payment.razorpayPaymentId}</p></div>
                                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${payment.status === "CAPTURED" ? "bg-emerald-500/10 text-emerald-300" : payment.status === "FAILED" ? "bg-red-500/10 text-red-300" : "bg-white/10 text-text-secondary"}`}>{payment.status}</span>
                                </div>)}
                            </div>
                        )}
                    </section>
                </>}
            </div>
        </main>
    );
};
