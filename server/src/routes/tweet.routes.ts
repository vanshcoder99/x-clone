import { Router } from "express";
import {
    createTweet,
    getTimelineFeed,
    getTweetById,
    createReply,
    deleteTweet,
    getUserTweets,
    getTweetsByHashtag,
    getTrendingHashtags,
} from "../controllers/tweet.controller.js";
import {
    toggleLike,
    toggleRetweet,
    toggleBookmark,
    getUserBookmarks,
} from "../controllers/engagement.controller.js";
import {
    authenticateToken,
    optionalAuthenticateToken,
} from "../middleware/auth.middleware.js";

const router = Router();

// Feed & Discovery
router.get("/feed", optionalAuthenticateToken as any, getTimelineFeed);
router.get("/trending", optionalAuthenticateToken as any, getTrendingHashtags);
router.get("/hashtag/:tag", optionalAuthenticateToken as any, getTweetsByHashtag);
router.get("/user/:username", optionalAuthenticateToken as any, getUserTweets);
router.get("/bookmarks", authenticateToken as any, getUserBookmarks);

// Tweet CRUD
router.post("/", authenticateToken as any, createTweet);
router.get("/:id", optionalAuthenticateToken as any, getTweetById);
router.delete("/:id", authenticateToken as any, deleteTweet);

// Threaded Replies
router.post("/:parentTweetId/reply", authenticateToken as any, createReply);

// Social Engagements
router.post("/:tweetId/like", authenticateToken as any, toggleLike);
router.post("/:tweetId/retweet", authenticateToken as any, toggleRetweet);
router.post("/:tweetId/bookmark", authenticateToken as any, toggleBookmark);

export default router;
