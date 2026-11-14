import { Router } from "express";
import {
    getUserProfile,
    updateUserProfile,
    followUser,
    unfollowUser,
    blockUser,
    unblockUser,
    searchUsers,
    getSuggestedUsers,
    getFollowers,
    getFollowing,
    getReceivedFollowRequests,
    getSentFollowRequests,
    acceptFollowRequest,
    rejectFollowRequest,
    cancelFollowRequest,
} from "../controllers/user.controller.js";
import { authenticateToken, optionalAuthenticateToken } from "../middleware/auth.middleware.js";

const router = Router();

// Search users
router.get("/search", optionalAuthenticateToken as any, searchUsers);

// Suggested users for 'Who to follow'
router.get("/suggested", optionalAuthenticateToken as any, getSuggestedUsers);

// View profile (public, but personalized if logged in)
router.get("/profile/:username", optionalAuthenticateToken as any, getUserProfile);

// Followers & Following lists
router.get("/:username/followers", optionalAuthenticateToken as any, getFollowers);
router.get("/:username/following", optionalAuthenticateToken as any, getFollowing);

// Update own profile (protected)
router.patch("/profile", authenticateToken as any, updateUserProfile);

// Follow / Unfollow (protected)
router.post("/follow/:targetUserId", authenticateToken as any, followUser);
router.post("/unfollow/:targetUserId", authenticateToken as any, unfollowUser);
router.get("/follow-requests/received", authenticateToken as any, getReceivedFollowRequests);
router.get("/follow-requests/sent", authenticateToken as any, getSentFollowRequests);
router.post("/follow-requests/:requestId/accept", authenticateToken as any, acceptFollowRequest);
router.post("/follow-requests/:requestId/reject", authenticateToken as any, rejectFollowRequest);
router.post("/follow-requests/:requestId/cancel", authenticateToken as any, cancelFollowRequest);

// Block / Unblock (protected)
router.post("/block/:targetUserId", authenticateToken as any, blockUser);
router.post("/unblock/:targetUserId", authenticateToken as any, unblockUser);

export default router;
