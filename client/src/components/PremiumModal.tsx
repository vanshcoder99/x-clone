import React from "react";
import { Check, Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface PremiumModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const PremiumModal: React.FC<PremiumModalProps> = ({ isOpen, onClose }) => {
    const navigate = useNavigate();
    if (!isOpen) return null;

    const openPlans = () => {
        onClose();
        navigate("/plans");
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
            <section className="w-full max-w-lg rounded-3xl border border-premium-violet/40 bg-surface-primary p-5 shadow-2xl sm:p-7" onClick={(event) => event.stopPropagation()}>
                <header className="mb-6 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-xl font-extrabold text-premium-violet"><Sparkles size={20} /> SocialSphere Plans</h2>
                    <button onClick={onClose} aria-label="Close plans" className="rounded-full p-2 text-text-muted hover:bg-white/10 hover:text-white"><X size={19} /></button>
                </header>
                <p className="mb-5 text-sm leading-6 text-text-secondary">Choose a plan for longer posts, more AI credits and premium profile features.</p>
                <ul className="mb-7 space-y-3">
                    {["Free, Plus and Pro options", "Verified badge on paid plans", "Secure recurring billing with Razorpay"].map((benefit) => (
                        <li key={benefit} className="flex items-center gap-2.5 text-sm text-text-primary"><Check size={16} className="text-emerald-400" />{benefit}</li>
                    ))}
                </ul>
                <button onClick={openPlans} className="w-full rounded-full bg-accent-blue px-5 py-3 text-sm font-bold text-white hover:bg-accent-blue-hover">View plans</button>
            </section>
        </div>
    );
};
