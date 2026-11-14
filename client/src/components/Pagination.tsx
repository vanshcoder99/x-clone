import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    disabled?: boolean;
    totalCount?: number;
    limit?: number;
}

export const Pagination: React.FC<PaginationProps> = ({
    currentPage,
    totalPages,
    onPageChange,
    disabled = false,
    totalCount,
}) => {
    // Hide pagination if only 1 page or invalid
    if (totalPages <= 1) return null;

    // Helper to generate page items with ellipses
    const getPageNumbers = (): (number | "...")[] => {
        if (totalPages <= 7) {
            return Array.from({ length: totalPages }, (_, i) => i + 1);
        }

        if (currentPage <= 4) {
            return [1, 2, 3, 4, 5, "...", totalPages];
        }

        if (currentPage >= totalPages - 3) {
            return [
                1,
                "...",
                totalPages - 4,
                totalPages - 3,
                totalPages - 2,
                totalPages - 1,
                totalPages,
            ];
        }

        return [
            1,
            "...",
            currentPage - 1,
            currentPage,
            currentPage + 1,
            "...",
            totalPages,
        ];
    };

    const pages = getPageNumbers();

    return (
        <nav
            className="flex flex-col items-center justify-center gap-2.5 py-6 px-4 my-4 border-t border-border-dark w-full select-none"
            aria-label="Feed pagination navigation"
            role="navigation"
        >
            <div className="inline-flex items-center justify-center gap-1.5 flex-wrap">
                {/* Previous Page Button */}
                <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1.5 h-9 sm:h-10 px-2.5 sm:px-3.5 text-xs sm:text-sm font-semibold rounded-lg border border-white/10 bg-surface-card text-text-primary hover:not-disabled:bg-surface-secondary hover:not-disabled:border-accent-blue hover:not-disabled:text-accent-blue focus-visible:outline-2 focus-visible:outline-accent-blue disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={disabled || currentPage <= 1}
                    aria-label="Previous page"
                    title="Previous page"
                >
                    <ChevronLeft size={16} />
                    <span className="hidden sm:inline">Previous</span>
                </button>

                {/* Numbered Page Buttons & Ellipses */}
                <div className="inline-flex items-center gap-1 sm:gap-1.5">
                    {pages.map((item, index) => {
                        if (item === "...") {
                            return (
                                <span
                                    key={`ellipsis-${index}`}
                                    className="inline-flex items-center justify-center min-w-6 sm:min-w-8 h-9 sm:h-10 text-text-muted text-xs sm:text-sm font-bold select-none"
                                    aria-hidden="true"
                                >
                                    …
                                </span>
                            );
                        }

                        const pageNum = item as number;
                        const isActive = pageNum === currentPage;

                        return (
                            <button
                                key={`page-${pageNum}`}
                                type="button"
                                className={`inline-flex items-center justify-center min-w-8 sm:min-w-10 h-9 sm:h-10 px-2 sm:px-3 text-xs sm:text-sm font-semibold rounded-lg border transition-all cursor-pointer ${
                                    isActive
                                        ? "bg-accent-blue text-white border-accent-blue shadow-md shadow-accent-blue/30 font-bold"
                                        : "border-white/10 bg-surface-card text-text-primary hover:bg-surface-secondary hover:border-accent-blue hover:text-accent-blue"
                                }`}
                                onClick={() => onPageChange(pageNum)}
                                disabled={disabled}
                                aria-label={`Page ${pageNum}`}
                                aria-current={isActive ? "page" : undefined}
                            >
                                {pageNum}
                            </button>
                        );
                    })}
                </div>

                {/* Next Page Button */}
                <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1.5 h-9 sm:h-10 px-2.5 sm:px-3.5 text-xs sm:text-sm font-semibold rounded-lg border border-white/10 bg-surface-card text-text-primary hover:not-disabled:bg-surface-secondary hover:not-disabled:border-accent-blue hover:not-disabled:text-accent-blue focus-visible:outline-2 focus-visible:outline-accent-blue disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={disabled || currentPage >= totalPages}
                    aria-label="Next page"
                    title="Next page"
                >
                    <span className="hidden sm:inline">Next</span>
                    <ChevronRight size={16} />
                </button>
            </div>

            {/* Accessible Page Info Subtitle */}
            {typeof totalCount === "number" && (
                <div className="w-full text-center text-xs text-text-muted mt-1" aria-live="polite">
                    Showing page {currentPage} of {totalPages} ({totalCount} total {totalCount === 1 ? "post" : "posts"})
                </div>
            )}
        </nav>
    );
};
