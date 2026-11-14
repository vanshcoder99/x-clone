import React from "react";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { Provider } from "react-redux";
import { store } from "./store/store";
import { AppStateBridge } from "./store/AppStateBridge";
import { Sidebar } from "./components/Sidebar";
import { RightSidebar } from "./components/RightSidebar";

// Pages
import { FeedPage } from "./pages/FeedPage";
import { ProfilePage } from "./pages/ProfilePage";
import { TweetDetailPage } from "./pages/TweetDetailPage";
import { ExplorePage } from "./pages/ExplorePage";
import { BookmarksPage } from "./pages/BookmarksPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { MessagesPage } from "./pages/MessagesPage";
import { AuthPage } from "./pages/AuthPage";
import { PlansPage } from "./pages/PlansPage";
import { BillingPage } from "./pages/BillingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { HelpCenterPage } from "./pages/HelpCenterPage";

const MainLayout: React.FC = () => {
    const location = useLocation();
    const isMessagesPage = location.pathname.startsWith("/messages");
    const isFocusedPage = ["/plans", "/settings/billing", "/settings", "/help"].includes(location.pathname);
    const navigate = useNavigate();

    return (
        <div className={`${isMessagesPage ? "messages-app-layout" : "app-container"} flex justify-center w-full min-h-screen md:h-screen md:h-dvh ${isMessagesPage ? "max-w-none pb-0" : "max-w-[1280px] mx-auto pb-16"} md:overflow-hidden md:pb-0`}>
            {/* Left Navigational Rail */}
            <Sidebar onOpenPremiumModal={() => navigate("/plans")} />

            {/* Central Content */}
            <Routes>
                <Route path="/" element={<FeedPage />} />
                <Route path="/profile/:username" element={<ProfilePage onOpenPremiumModal={() => navigate("/plans")} />} />
                <Route path="/tweet/:id" element={<TweetDetailPage />} />
                <Route path="/explore" element={<ExplorePage />} />
                <Route path="/bookmarks" element={<BookmarksPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/messages" element={<MessagesPage />} />
                <Route path="/plans" element={<PlansPage />} />
                <Route path="/settings/billing" element={<BillingPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/help" element={<HelpCenterPage />} />
                <Route path="/auth" element={<AuthPage />} />
            </Routes>

            {/* Right Widget Column (Hidden on Messages view for maximum chat real-estate) */}
            {!isMessagesPage && !isFocusedPage && (
                <RightSidebar onOpenPremiumModal={() => navigate("/plans")} />
            )}
        </div>
    );
};

export function App() {
    return (
        <Provider store={store}>
            <BrowserRouter>
                <AppStateBridge />
                <MainLayout />
            </BrowserRouter>
        </Provider>
    );
}

export default App;
