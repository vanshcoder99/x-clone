import React from "react";
import { X } from "lucide-react";
import { Composer } from "./Composer";
import type { Tweet } from "../types";

interface ReplyModalProps {
    tweet: Tweet | null;
    onClose: () => void;
    onReplySuccess: (reply: Tweet) => void;
}

export const ReplyModal: React.FC<ReplyModalProps> = ({
    tweet,
    onClose,
    onReplySuccess,
}) => {
    if (!tweet) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-surface-primary border border-border-dark rounded-3xl max-w-xl w-full p-4 sm:p-5 shadow-2xl relative text-left"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Modal Header */}
                <div className="flex items-center justify-between pb-3 border-b border-border-dark">
                    <span className="font-extrabold text-base text-text-primary">Reply</span>
                    <button
                        onClick={onClose}
                        className="text-text-muted hover:text-text-primary p-1.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                        title="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="pt-3">
                    {/* Parent Tweet Preview */}
                    <div className="flex gap-3 mb-3">
                        <div className="flex flex-col items-center">
                            <img
                                src={
                                    tweet.author.avatarUrl ||
                                    `https://api.dicebear.com/7.x/identicon/svg?seed=${tweet.author.username}`
                                }
                                alt={tweet.author.username}
                                className="w-10 h-10 rounded-full object-cover bg-surface-secondary border border-border-dark flex-shrink-0"
                            />
                            <div className="w-0.5 flex-1 bg-border-dark my-1.5 min-h-[30px]" />
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex gap-1.5 items-center">
                                <span className="font-bold text-sm text-text-primary">
                                    {tweet.author.username}
                                </span>
                                <span className="text-xs text-text-muted">
                                    @{tweet.author.username}
                                </span>
                            </div>
                            <p className="mt-1 text-xs sm:text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
                                {tweet.content}
                            </p>
                            <span className="text-[0.75rem] text-text-muted mt-1 block">
                                Replying to{" "}
                                <span className="text-accent-blue font-semibold">
                                    @{tweet.author.username}
                                </span>
                            </span>
                        </div>
                    </div>

                    {/* Integrated Composer for reply */}
                    <div className="rounded-2xl border border-border-dark/60 bg-surface-card/60 overflow-hidden">
                        <Composer
                            parentTweetId={tweet.id}
                            placeholder="Post your reply"
                            onTweetPosted={(newReply) => {
                                onReplySuccess(newReply);
                                onClose();
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
