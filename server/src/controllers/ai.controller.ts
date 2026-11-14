import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { consumeAICredit, getCachedAIResponse, requireAIEntitlement } from "../lib/entitlements.js";
import type { AIAction } from "../lib/plan-config.js";

// In-memory sliding-window rate limiter per user (max 20 requests per 60 seconds)
const userRateLimits = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;

const checkRateLimit = (userId: string): boolean => {
    const now = Date.now();
    const timestamps = (userRateLimits.get(userId) || []).filter(
        (t) => now - t < RATE_LIMIT_WINDOW_MS
    );
    if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
        userRateLimits.set(userId, timestamps);
        return false;
    }
    timestamps.push(now);
    userRateLimits.set(userId, timestamps);
    return true;
};

// ==========================================
// 1. OPENROUTER CALL HELPER
// ==========================================
async function callOpenRouter(systemPrompt: string, userMessage: string, maxTokens = 250) {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
        const error: any = new Error(
            "OPENROUTER_API_KEY is not configured in backend environment variables."
        );
        error.statusCode = 503;
        throw error;
    }

    const model = process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini";
    const clientUrl = process.env.CLIENT_URL?.trim() || "http://localhost:5173";

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": clientUrl,
            "X-Title": "SocialSphere",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ],
            temperature: 0.75,
            max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(20000), // 20-second timeout
    });

    const data: any = await response.json().catch(() => null);

    if (!response.ok) {
        const errorMsg = data?.error?.message || `OpenRouter API error (${response.status})`;
        const error: any = new Error(errorMsg);
        error.statusCode = response.status === 401 ? 401 : response.status === 429 ? 429 : 502;
        throw error;
    }

    const choice = data?.choices?.[0]?.message?.content?.trim();
    if (!choice) {
        const error: any = new Error("OpenRouter returned an empty completion response.");
        error.statusCode = 502;
        throw error;
    }

    return {
        rawContent: choice,
        model: data?.model || model,
        provider: "OpenRouter",
        tokensUsed: data?.usage?.total_tokens || 0,
    };
}

// ==========================================
// 2. SUGGEST TWEET (OPENROUTER LLM)
// ==========================================
export const suggestTweet = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const idempotencyKey = req.header("Idempotency-Key") || "";
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
            return res.status(400).json({ error: "A valid Idempotency-Key header is required for AI generation." });
        }
        const cached = await getCachedAIResponse(userId, idempotencyKey);
        if (cached) return res.status(200).json(cached);
        if (!checkRateLimit(userId)) {
            return res.status(429).json({
                error: "Too many AI requests. Please wait a moment before generating more suggestions.",
            });
        }

        const { prompt, tone = "improve", action } = req.body;

        if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
            return res.status(400).json({ error: "Prompt is required" });
        }

        if (prompt.trim().length > 500) {
            return res.status(400).json({ error: "Input exceeds maximum limit of 500 characters." });
        }

        const cleanPrompt = prompt.trim();
        const knownActions = new Set<AIAction>(["improve", "grammar", "expand", "professional", "casual", "friendly", "humorous", "engaging", "viral", "alternatives", "hashtags"]);
        const selectedMode = (knownActions.has(action) ? action : tone) as AIAction;
        if (!knownActions.has(selectedMode)) return res.status(400).json({ error: "Unsupported AI capability." });
        let entitlements;
        try {
            entitlements = await requireAIEntitlement(userId, selectedMode);
        } catch (error) {
            return res.status((error as { statusCode?: number }).statusCode || 403).json({
                error: (error as Error).message,
                code: (error as { code?: string }).code,
            });
        }
        const characterLimit = entitlements.maxPostCharacters;

        let systemPrompt = `You are SocialSphere AI, an expert social media writing assistant powered by OpenRouter.
Your job is to generate a high quality post for SocialSphere (an X/Twitter platform).
Strict constraints:
- Must be no more than ${characterLimit} characters.
- Return ONLY the final tweet text.
- Do NOT wrap the output in quotes.
- Do NOT include any explanations, introductions (like 'Here is:'), or conversational commentary.`;

        let isMultipleAlternatives = false;

        switch (selectedMode) {
            case "grammar":
                systemPrompt += `\nObjective: Fix all spelling, grammar, punctuation, and wording errors while preserving the user's exact original meaning, tone, and vocabulary.`;
                break;
            case "expand":
                systemPrompt += `\nObjective: Convert this short idea or bullet point into a compelling, insightful, and well-written social media post with depth.`;
                break;
            case "professional":
                systemPrompt += `\nObjective: Rewrite this post in an authoritative, strategic, and professional thought-leadership tone suitable for industry leaders.`;
                break;
            case "casual":
                systemPrompt += `\nObjective: Rewrite this post in a relaxed, authentic, everyday conversational social media tone.`;
                break;
            case "friendly":
                systemPrompt += `\nObjective: Rewrite this post in a warm, welcoming, friendly, and enthusiastic tone.`;
                break;
            case "humorous":
                systemPrompt += `\nObjective: Rewrite this post with wit, clever irony, and lighthearted social humor.`;
                break;
            case "engaging":
            case "viral":
                systemPrompt += `\nObjective: Rewrite this post with a high-engagement hook, punchy line breaks, and strong social momentum.`;
                break;
            case "alternatives":
                isMultipleAlternatives = true;
                systemPrompt = `You are SocialSphere AI, an expert social media writing assistant powered by OpenRouter.
Generate exactly 3 distinct, creative variations of the user's tweet idea (e.g., one bold & punchy, one conversational, one insightful).
Strict constraints:
- Each variation must be no more than ${characterLimit} characters.
- Format strictly as:
1. [First variation]
2. [Second variation]
3. [Third variation]
- Do NOT include quotes, introductions, or other commentary.`;
                break;
            case "improve":
            default:
                systemPrompt += `\nObjective: Rewrite the draft to significantly improve its clarity, readability, impact, and engagement while preserving the core idea.`;
                break;
        }

        const llmResult = await callOpenRouter(
            systemPrompt,
            cleanPrompt,
            isMultipleAlternatives ? 350 : 150
        );

        let primarySuggestion = "";
        let suggestions: string[] = [];

        if (isMultipleAlternatives) {
            // Parse numbered lines
            const lines = llmResult.rawContent
                .split(/\n+/)
                .map((l: string) => l.replace(/^\d+[\.\)]\s*/, "").trim())
                .filter((l: string) => l.length > 0);

            suggestions = lines.slice(0, 3);
            primarySuggestion = suggestions[0] || llmResult.rawContent;
        } else {
            primarySuggestion = llmResult.rawContent.replace(/^["']|["']$/g, "").trim();
            suggestions = [primarySuggestion];
        }

        const responseBody = {
            suggestion: primarySuggestion,
            suggestions,
            model: llmResult.model,
            provider: llmResult.provider,
            isRealLLM: true,
            tokensUsed: llmResult.tokensUsed,
        };
        const charged = await consumeAICredit(userId, idempotencyKey, responseBody);
        return res.status(200).json(charged);
    } catch (error: any) {
        console.error("OpenRouter suggestTweet error:", error.message);
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            error: error.message || "Failed to generate AI suggestion from OpenRouter.",
        });
    }
};

// ==========================================
// 3. SUGGEST HASHTAGS (OPENROUTER LLM)
// ==========================================
export const suggestHashtags = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const idempotencyKey = req.header("Idempotency-Key") || "";
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
            return res.status(400).json({ error: "A valid Idempotency-Key header is required for AI generation." });
        }
        const cached = await getCachedAIResponse(userId, idempotencyKey);
        if (cached) return res.status(200).json(cached);
        if (!checkRateLimit(userId)) {
            return res.status(429).json({
                error: "Too many AI requests. Please wait a moment before generating hashtags.",
            });
        }

        const { content } = req.body;

        if (!content || typeof content !== "string" || content.trim().length === 0) {
            return res.status(400).json({ error: "Tweet content is required" });
        }

        if (content.trim().length > 500) {
            return res.status(400).json({ error: "Content exceeds maximum limit of 500 characters." });
        }

        let entitlements;
        try {
            entitlements = await requireAIEntitlement(userId, "hashtags");
        } catch (error) {
            return res.status((error as { statusCode?: number }).statusCode || 403).json({
                error: (error as Error).message,
                code: (error as { code?: string }).code,
            });
        }

        const systemPrompt = `You are SocialSphere AI.
Analyze the user's tweet and suggest 4 to 6 relevant, high-traffic, trending hashtags.
Strict constraints:
- Output ONLY the hashtags separated by space (e.g. #Tech #AI #WebDev #BuildInPublic).
- Do not include numbering, explanations, or any other words.`;

        const llmResult = await callOpenRouter(systemPrompt, content.trim(), 80);

        const extractedTags = llmResult.rawContent.match(/#[a-zA-Z0-9_]+/g) || [];

        if (extractedTags.length === 0) {
            return res.status(502).json({ error: "OpenRouter returned no hashtags. No AI credits were used." });
        }

        const responseBody = {
            hashtags: extractedTags.slice(0, 6),
            model: llmResult.model,
            provider: llmResult.provider,
            isRealLLM: true,
        };
        const charged = await consumeAICredit(userId, idempotencyKey, responseBody);
        return res.status(200).json(charged);
    } catch (error: any) {
        console.error("OpenRouter suggestHashtags error:", error.message);
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            error: error.message || "Failed to generate hashtags from OpenRouter.",
        });
    }
};
