export type PaidPlan = "PLUS" | "PRO";
export type PlanTier = "FREE" | PaidPlan;
export type AIAction = "improve" | "grammar" | "expand" | "professional" | "casual" | "friendly" | "humorous" | "engaging" | "viral" | "alternatives" | "hashtags";

export interface PlanDefinition {
    tier: PlanTier;
    name: string;
    priceInr: number;
    pricePaise: number;
    monthlyCredits: number;
    maxPostCharacters: number;
    verifiedBadge: boolean;
    premiumProfile: boolean;
    aiLevel: "BASIC" | "ADVANCED" | "FULL";
    features: string[];
}

export const PLAN_CONFIG: Record<PlanTier, PlanDefinition> = {
    FREE: {
        tier: "FREE", name: "Free", priceInr: 0, pricePaise: 0,
        monthlyCredits: 20, maxPostCharacters: 280, verifiedBadge: false,
        premiumProfile: false, aiLevel: "BASIC",
        features: ["20 AI credits per month", "280 characters per post", "Basic AI suggestions", "Basic tone and hashtag suggestions"],
    },
    PLUS: {
        tier: "PLUS", name: "Plus", priceInr: 199, pricePaise: 19900,
        monthlyCredits: 300, maxPostCharacters: 2000, verifiedBadge: true,
        premiumProfile: true, aiLevel: "ADVANCED",
        features: ["300 AI credits per billing cycle", "2,000 characters per post", "AI rewriting and tone variations", "Hashtag recommendations", "Verified badge", "Premium profile features"],
    },
    PRO: {
        tier: "PRO", name: "Pro", priceInr: 499, pricePaise: 49900,
        monthlyCredits: 1000, maxPostCharacters: 10000, verifiedBadge: true,
        premiumProfile: true, aiLevel: "FULL",
        features: ["1,000 AI credits per billing cycle", "10,000 characters per post", "Full AI suggestions and expansion", "All tone variations", "Advanced hashtag recommendations", "Verified badge", "Premium profile features"],
    },
};

export const PAID_PLAN_ORDER: PaidPlan[] = ["PLUS", "PRO"];

export const countCharacters = (value: string): number => {
    if (typeof Intl.Segmenter === "function") {
        return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)).length;
    }
    return Array.from(value).length;
};

export const isAIActionAllowed = (tier: PlanTier, action: AIAction): boolean => {
    if (tier === "PRO") return true;
    if (tier === "PLUS") return action !== "expand" && action !== "alternatives";
    return action === "improve" || action === "grammar" || action === "hashtags";
};

export const getRazorpayPlanId = (tier: PaidPlan): string | undefined =>
    process.env[tier === "PLUS" ? "RAZORPAY_PLUS_PLAN_ID" : "RAZORPAY_PRO_PLAN_ID"]?.trim() || undefined;

const provisionedPlanIds = new Map<PaidPlan, string>();
export const cacheRazorpayPlanId = (tier: PaidPlan, id: string) => provisionedPlanIds.set(tier, id);
export const getCachedRazorpayPlanId = (tier: PaidPlan) => provisionedPlanIds.get(tier);

