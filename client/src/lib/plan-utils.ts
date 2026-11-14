export const countCharacters = (value: string): number => {
    if (typeof Intl.Segmenter === "function") {
        return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)).length;
    }
    return Array.from(value).length;
};

export const canUseAIAction = (tier: string | undefined, action: string): boolean => {
    if (tier === "PRO") return true;
    if (tier === "PLUS") return action !== "expand" && action !== "alternatives";
    return action === "improve" || action === "grammar" || action === "hashtags";
};
