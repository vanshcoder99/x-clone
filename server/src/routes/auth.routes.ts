import { Router } from "express";
import { changePassword, getCurrentUser, googleAuth, loginUser, logoutUser, refreshAccessToken, registerUser } from "../controllers/auth.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";


const authRouter = Router();

authRouter.post("/register",registerUser);
authRouter.post("/login",loginUser);
authRouter.post("/logout",logoutUser);
authRouter.post("/refresh",refreshAccessToken);
authRouter.post("/google",googleAuth);

authRouter.get("/me",authenticateToken,getCurrentUser)
authRouter.post("/password", authenticateToken, changePassword)

export default authRouter
