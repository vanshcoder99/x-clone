import { Router } from "express";
import {
    getOrCreateConversation,
    getConversations,
    getMessages,
    sendMessage,
    markConversationAsRead,
    getEligibleContacts,
    getMessageRequests,
    respondToMessageRequest,
    archiveConversation,
} from "../controllers/message.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = Router();

// All message routes require active authentication
router.use(authenticateToken as any);

// Conversations
router.post("/conversations", getOrCreateConversation);
router.get("/conversations", getConversations);
router.get("/contacts", getEligibleContacts);
router.get("/requests", getMessageRequests);
router.patch("/conversations/:conversationId/request", respondToMessageRequest);

// Messages in conversation
router.get("/conversations/:conversationId/messages", getMessages);
router.post("/conversations/:conversationId/messages", sendMessage);
router.patch("/conversations/:conversationId/read", markConversationAsRead);
router.patch("/conversations/:conversationId/archive", archiveConversation);

export default router;
