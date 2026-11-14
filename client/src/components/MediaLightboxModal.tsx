import React, { useEffect, useState, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { TweetMediaItem } from "../types";

interface MediaLightboxModalProps {
    isOpen: boolean;
    media: TweetMediaItem[];
    initialIndex?: number;
    onClose: () => void;
}

export const MediaLightboxModal: React.FC<MediaLightboxModalProps> = ({
    isOpen,
    media,
    initialIndex = 0,
    onClose,
}) => {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);

    useEffect(() => {
        if (isOpen) {
            setCurrentIndex(Math.min(Math.max(0, initialIndex), Math.max(0, media.length - 1)));
        }
    }, [isOpen, initialIndex, media.length]);

    const handlePrev = useCallback((e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setCurrentIndex((prev) => (prev > 0 ? prev - 1 : media.length - 1));
    }, [media.length]);

    const handleNext = useCallback((e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setCurrentIndex((prev) => (prev < media.length - 1 ? prev + 1 : 0));
    }, [media.length]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            } else if (e.key === "ArrowLeft") {
                handlePrev();
            } else if (e.key === "ArrowRight") {
                handleNext();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, handleNext, handlePrev, onClose]);

    if (!isOpen || media.length === 0) return null;

    const currentItem = media[currentIndex] || media[0];

    return (
        <div
            className="lightbox-overlay"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label="Media gallery viewer"
        >
            {/* Top Toolbar */}
            <div className="lightbox-header" onClick={(e) => e.stopPropagation()}>
                <span className="lightbox-counter">
                    {currentIndex + 1} / {media.length}
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    className="lightbox-btn"
                    title="Close (Esc)"
                    aria-label="Close lightbox"
                >
                    <X size={22} />
                </button>
            </div>

            {/* Navigation Chevrons */}
            {media.length > 1 && (
                <>
                    <button
                        type="button"
                        onClick={handlePrev}
                        className="lightbox-nav-btn prev"
                        title="Previous (Left arrow)"
                        aria-label="Previous attachment"
                    >
                        <ChevronLeft size={30} />
                    </button>
                    <button
                        type="button"
                        onClick={handleNext}
                        className="lightbox-nav-btn next"
                        title="Next (Right arrow)"
                        aria-label="Next attachment"
                    >
                        <ChevronRight size={30} />
                    </button>
                </>
            )}

            {/* Main Media Container */}
            <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
                {currentItem.mediaType === "VIDEO" ? (
                    <video
                        controls
                        playsInline
                        preload="metadata"
                        className="lightbox-media"
                        key={currentItem.url}
                    >
                        <source src={currentItem.url} />
                        Your browser does not support video playback.
                    </video>
                ) : (
                    <img
                        src={currentItem.url}
                        alt={`Attachment ${currentIndex + 1} of ${media.length}`}
                        className="lightbox-media"
                        key={currentItem.url}
                    />
                )}
            </div>
        </div>
    );
};

