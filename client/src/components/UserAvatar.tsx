import { useState } from "react";

interface UserAvatarProps {
    src?: string | null;
    name?: string | null;
    username?: string | null;
    className?: string;
}

export const UserAvatar = ({ src, name, username, className = "" }: UserAvatarProps) => {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const label = (name || username || "?").trim();
    const initial = label.charAt(0).toLocaleUpperCase() || "?";
    if (src && src !== failedSrc) {
        return <img src={src} alt={label} className={className} onError={() => setFailedSrc(src)} />;
    }
    return <span role="img" aria-label={`${label} profile picture`} className={`inline-flex items-center justify-center bg-accent-blue/20 font-bold uppercase text-accent-blue ${className}`}>{initial}</span>;
};
