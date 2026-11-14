import React from "react";

interface TweetSkeletonProps {
    count?: number;
}

export const TweetSkeleton: React.FC<TweetSkeletonProps> = ({ count = 3 }) => {
    return (
        <div className="flex w-full flex-col divide-y divide-border-dark" role="status" aria-busy="true" aria-label="Loading posts">
            {Array.from({ length: count }).map((_, idx) => (
                <div key={idx} className="flex gap-3 px-4 py-4">
                    <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-[var(--bg-card-hover)]" />

                    <div className="min-w-0 flex-1">
                        <div className="mb-3 flex items-center gap-2">
                            <div className="h-3.5 w-28 animate-pulse rounded bg-[var(--bg-card-hover)]" />
                            <div className="h-3 w-16 animate-pulse rounded bg-[var(--bg-card-hover)] opacity-70" />
                            <div className="h-3 w-8 animate-pulse rounded bg-[var(--bg-card-hover)] opacity-50" />
                        </div>

                        <div className="mb-2 h-3 w-[95%] animate-pulse rounded bg-[var(--bg-card-hover)]" />
                        <div className="mb-2 h-3 w-[82%] animate-pulse rounded bg-[var(--bg-card-hover)]" />
                        <div className="mb-4 h-3 w-[48%] animate-pulse rounded bg-[var(--bg-card-hover)]" />

                        <div className="mt-3 flex max-w-[380px] justify-between">
                            <div className="h-3 w-9 animate-pulse rounded-full bg-[var(--bg-card-hover)] opacity-60" />
                            <div className="h-3 w-9 animate-pulse rounded-full bg-[var(--bg-card-hover)] opacity-60" />
                            <div className="h-3 w-9 animate-pulse rounded-full bg-[var(--bg-card-hover)] opacity-60" />
                            <div className="h-3 w-9 animate-pulse rounded-full bg-[var(--bg-card-hover)] opacity-60" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};
