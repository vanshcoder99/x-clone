import { BookOpen, CircleHelp, LockKeyhole, MessageCircle, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

const faqs = [
    { question: "How do I update my profile?", answer: "Open More → Settings and privacy. You can update your display name, username, bio and account privacy there." },
    { question: "What happens when I make my account private?", answer: "Only approved followers can view your posts and protected content. Follow requests remain pending until you accept them." },
    { question: "How do I follow a private account?", answer: "Select Request Follow on the profile. You can cancel a pending request from that profile until its owner responds." },
    { question: "Where can I manage my plan and payments?", answer: "Choose More → Billing to see your plan, AI credits, payment history and renewal controls. Plans are listed on the Premium page." },
    { question: "How do I change my password?", answer: "Open More → Settings and privacy, enter your current password and choose a new password. Google-only accounts currently sign in through Google." },
    { question: "How do I report a media upload problem?", answer: "Check that the file type and size are supported, then retry. Uploads require the service configuration maintained by SocialSphere." },
];

export const HelpCenterPage = () => <main className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto border-x border-border-dark bg-black px-4 py-6 sm:px-7 lg:px-10">
    <div className="mx-auto w-full max-w-4xl">
        <header className="mb-7 border-b border-border-dark pb-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-accent-blue"><BookOpen size={18} /> SocialSphere Help Center</div>
            <h1 className="mt-2 text-3xl font-extrabold text-white">How can we help?</h1>
            <p className="mt-2 text-sm text-text-secondary">Quick basics and answers to common questions.</p>
        </header>
        <section className="mb-7 grid gap-3 sm:grid-cols-3">
            {[
                { title: "Your account", icon: CircleHelp, text: "Edit profile details and sign-in settings.", to: "/settings" },
                { title: "Privacy & safety", icon: ShieldCheck, text: "Manage account privacy and follow requests.", to: "/settings#privacy-settings" },
                { title: "Plans & billing", icon: LockKeyhole, text: "Review plans, payment history and renewals.", to: "/settings/billing" },
            ].map(({ title, icon: Icon, text, to }) => <Link key={title} to={to} className="group rounded-2xl border border-border-dark bg-surface-primary p-4 transition hover:border-accent-blue/50 hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"><Icon size={19} className="mb-3 text-accent-blue" /><h2 className="font-bold text-white group-hover:text-accent-blue">{title}</h2><p className="mt-1 text-sm text-text-muted">{text}</p></Link>)}
        </section>
        <section className="overflow-hidden rounded-3xl border border-border-dark bg-surface-primary">
            <div className="flex items-center gap-2 border-b border-border-dark px-5 py-4"><MessageCircle size={18} className="text-accent-blue" /><h2 className="text-lg font-bold text-white">Frequently asked questions</h2></div>
            <div className="divide-y divide-border-dark">{faqs.map((faq) => <details key={faq.question} className="group px-5 py-4"><summary className="cursor-pointer list-none pr-6 font-semibold text-text-primary marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue">{faq.question}<span aria-hidden="true" className="float-right text-accent-blue transition group-open:rotate-45">+</span></summary><p className="mt-2 text-sm leading-6 text-text-secondary">{faq.answer}</p></details>)}</div>
        </section>
    </div>
</main>;
