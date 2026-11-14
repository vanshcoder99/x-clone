import jwt from "jsonwebtoken";

process.env.PORT = "5055";
process.env.NODE_ENV = "test";

const { httpServer, io, prisma } = await import("./dist/index.js");

const BASE_URL = "http://localhost:5055/api";

const results = [];
function assert(condition, testName) {
    if (condition) {
        results.push({ test: testName, status: "PASS" });
        console.log(`  ✓ ${testName}`);
    } else {
        results.push({ test: testName, status: "FAIL" });
        console.error(`  ✗ FAIL: ${testName}`);
    }
}

async function runAuthTests() {
    console.log("\n=======================================================");
    console.log("   SOCIALSPHERE PHASE 3 AUTHENTICATION TEST SUITE      ");
    console.log("=======================================================\n");

    const rand = Math.floor(100000 + Math.random() * 900000);
    const testUsername = `authtest_${rand}`;
    const testEmail = `authtest_${rand}@example.com`;
    const testName = "Auth Test User";
    const testPassword = "SecurePassword123!";

    let registeredAccessToken = "";
    let registeredRefreshToken = "";
    let registeredCookie = "";

    try {
        // ----------------------------------------------------
        // 1. REGISTRATION VALIDATION TESTS
        // ----------------------------------------------------
        console.log("1. Testing Registration Validation...");

        // 1.1 Missing fields
        const r1 = await fetch(`${BASE_URL}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: testEmail, password: testPassword }),
        });
        assert(r1.status === 400, "Registration rejects missing username with 400");

        // 1.2 Short password
        const r2 = await fetch(`${BASE_URL}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: testName, email: testEmail, username: testUsername, password: "123" }),
        });
        assert(r2.status === 400, "Registration rejects short password (< 6 chars) with 400");

        // 1.3 Invalid email format
        const r3 = await fetch(`${BASE_URL}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: testName, email: "invalid-email", username: testUsername, password: testPassword }),
        });
        assert(r3.status === 400, "Registration rejects invalid email format with 400");

        // 1.4 Invalid username format
        const r4 = await fetch(`${BASE_URL}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: testName, email: testEmail, username: "bad user name!", password: testPassword }),
        });
        assert(r4.status === 400, "Registration rejects username with special characters/spaces with 400");

        // 1.5 Valid Registration
        const regRes = await fetch(`${BASE_URL}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: testName, email: testEmail, username: testUsername, password: testPassword }),
        });
        const regData = await regRes.json();
        assert(regRes.status === 201, "Registration succeeds with valid payload (201)");
        assert(regData.user && !regData.user.password, "Password is NEVER returned in registration response");
        assert(regData.user?.name === testName, "Full name is returned from registration");
        assert(regData.user?.username === testUsername, "Created user matches submitted username");
        assert(typeof regData.accessToken === "string" && regData.accessToken.length > 0, "Access token issued");
        assert(!Object.hasOwn(regData, "refreshToken"), "Refresh token is not exposed in registration response body");

        registeredAccessToken = regData.accessToken;
        registeredCookie = regRes.headers.get("set-cookie") || "";
        assert(registeredCookie.includes("refreshToken="), "HTTP-only refreshToken cookie set on registration");
        registeredRefreshToken = registeredCookie.match(/(?:^|;\s*)refreshToken=([^;]+)/)?.[1] || "";

        // 1.6 Duplicate Registration
        const dupRes = await fetch(`${BASE_URL}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: testName, email: testEmail, username: `${testUsername}_dup`, password: testPassword }),
        });
        assert(dupRes.status === 409, "Duplicate email registration rejected with 409 Conflict");

        // ----------------------------------------------------
        // 2. LOGIN AUTHENTICATION TESTS
        // ----------------------------------------------------
        console.log("\n2. Testing Login Authentication...");

        // 2.1 Missing credentials
        const l1 = await fetch(`${BASE_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: testUsername }),
        });
        assert(l1.status === 400, "Login rejects missing password with 400");

        // 2.2 Wrong password
        const l2 = await fetch(`${BASE_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: testUsername, password: "WrongPassword999!" }),
        });
        assert(l2.status === 401, "Login with incorrect password rejected with 401");

        // 2.3 Non-existent user
        const l3 = await fetch(`${BASE_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: "ghost_user_does_not_exist", password: testPassword }),
        });
        assert(l3.status === 401, "Login for non-existent user rejected with 401");

        // 2.4 Successful Login via Email
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: testEmail, password: testPassword }),
        });
        const loginData = await loginRes.json();
        assert(loginRes.status === 200, "Login succeeds with valid email and password (200)");
        assert(loginData.user && !loginData.user.password, "Password is NEVER returned in login response");
        assert(typeof loginData.accessToken === "string", "New access token issued on login");
        assert(!Object.hasOwn(loginData, "refreshToken"), "Refresh token is not exposed in login response body");

        const loginCookie = loginRes.headers.get("set-cookie") || "";
        assert(loginCookie.includes("refreshToken="), "HTTP-only cookie set on login");

        // Update active session tokens
        let activeAccessToken = loginData.accessToken;
        let activeRefreshToken = loginCookie.match(/(?:^|;\s*)refreshToken=([^;]+)/)?.[1] || "";

        // ----------------------------------------------------
        // 3. AUTHORIZATION & PROTECTED ENDPOINTS
        // ----------------------------------------------------
        console.log("\n3. Testing Protected Endpoints & Authorization...");

        // 3.1 Missing token
        const meNoAuth = await fetch(`${BASE_URL}/auth/me`);
        assert(meNoAuth.status === 401, "Protected route /auth/me without Bearer token returns 401");

        // 3.2 Tampered / invalid token
        const meInvalid = await fetch(`${BASE_URL}/auth/me`, {
            headers: { Authorization: "Bearer bad.token.here" },
        });
        assert(meInvalid.status === 403, "Protected route with forged/invalid token returns 403");

        // 3.3 Expired access token
        const secret = process.env.JWT_ACCESS_SECRET;
        const expiredToken = jwt.sign({ userId: loginData.user.id, username: testUsername }, secret, {
            expiresIn: "0s",
        });
        const meExpired = await fetch(`${BASE_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${expiredToken}` },
        });
        assert(meExpired.status === 403, "Protected route with expired access token returns 403");

        // 3.4 Valid token
        const meValid = await fetch(`${BASE_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${activeAccessToken}` },
        });
        const meData = await meValid.json();
        assert(meValid.status === 200, "Protected route /auth/me returns 200 with valid Bearer token");
        assert(meData.user?.username === testUsername, "Protected route returns verified user identity");

        // ----------------------------------------------------
        // 4. TOKEN LIFECYCLE & REFRESH TOKEN ROTATION (RTR)
        // ----------------------------------------------------
        console.log("\n4. Testing Token Lifecycle & Refresh Token Rotation...");

        // 4.1 Missing refresh token
        const refNoToken = await fetch(`${BASE_URL}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        assert(refNoToken.status === 401, "POST /auth/refresh without token returns 401");

        // 4.2 Refresh Success with Rotation
        const refRes = await fetch(`${BASE_URL}/auth/refresh`, {
            method: "POST",
            headers: { Cookie: `refreshToken=${activeRefreshToken}` },
        });
        const refData = await refRes.json();
        assert(refRes.status === 200, "POST /auth/refresh succeeds with valid refresh token (200)");
        assert(typeof refData.accessToken === "string", "New access token received from refresh");
        assert(!Object.hasOwn(refData, "refreshToken"), "Rotated refresh token is not exposed in response body");
        const rotatedRefreshToken = (refRes.headers.get("set-cookie") || "").match(/(?:^|;\s*)refreshToken=([^;]+)/)?.[1] || "";
        assert(rotatedRefreshToken.length > 0 && rotatedRefreshToken !== activeRefreshToken, "Refresh token was rotated in the HTTP-only cookie");

        // 4.3 Replay / Stale Token Rejection (Old token must be revoked)
        const replayRes = await fetch(`${BASE_URL}/auth/refresh`, {
            method: "POST",
            headers: { Cookie: `refreshToken=${activeRefreshToken}` },
        });
        assert(
            replayRes.status === 403,
            "Replay attack / reusing old rotated refresh token is immediately rejected with 403"
        );

        // Update to the newly rotated token
        activeAccessToken = refData.accessToken;
        activeRefreshToken = rotatedRefreshToken;

        // Verify the new rotated access token works on protected route
        const meAfterRotate = await fetch(`${BASE_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${activeAccessToken}` },
        });
        assert(meAfterRotate.status === 200, "Rotated access token successfully authenticates protected route");

        // ----------------------------------------------------
        // 5. LOGOUT & REVOCATION
        // ----------------------------------------------------
        console.log("\n5. Testing Logout & Token Revocation...");

        const logoutRes = await fetch(`${BASE_URL}/auth/logout`, {
            method: "POST",
            headers: { Cookie: `refreshToken=${activeRefreshToken}` },
        });
        assert(logoutRes.status === 200, "POST /auth/logout succeeds (200)");

        // 5.1 Refresh after logout must fail
        const refAfterLogout = await fetch(`${BASE_URL}/auth/refresh`, {
            method: "POST",
            headers: { Cookie: `refreshToken=${activeRefreshToken}` },
        });
        assert(refAfterLogout.status === 403, "Logged-out refresh token is revoked in database and returns 403");

        // ----------------------------------------------------
        // 6. GOOGLE AUTHENTICATION TOKEN VERIFICATION
        // ----------------------------------------------------
        console.log("\n6. Testing Google Authentication Token Verification...");

        // 6.1 Missing idToken
        const g1 = await fetch(`${BASE_URL}/auth/google`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        assert(g1.status === 400, "POST /auth/google requires idToken (returns 400)");

        // 6.2 Invalid/Forged Google ID Token
        const g2 = await fetch(`${BASE_URL}/auth/google`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                idToken: "forged.google.token.test",
                googleProfile: { uid: "forged", email: testEmail, name: testName },
            }),
        });
        assert(
            g2.status === 401,
            "POST /auth/google rejects a forged token even when untrusted profile fields are supplied"
        );

    } finally {
        // ----------------------------------------------------
        // 7. TEARDOWN & DATABASE CLEANUP
        // ----------------------------------------------------
        console.log("\n7. Cleaning up test records from database...");
        try {
            await prisma.user.deleteMany({
                where: {
                    OR: [{ username: testUsername }, { email: testEmail }],
                },
            });
            console.log("   Test user cleaned up cleanly.");
        } catch (cleanupErr) {
            console.error("Cleanup error:", cleanupErr);
        }

        // Close server and disconnect database
        if (io) io.close();
        await new Promise((resolve) => httpServer.close(resolve));
        await prisma.$disconnect();
        console.log("   Test HTTP server and database pool closed.\n");
    }

    const passed = results.filter((r) => r.status === "PASS").length;
    const failed = results.filter((r) => r.status === "FAIL").length;

    console.log("=======================================================");
    console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${results.length})`);
    console.log("=======================================================\n");

    if (failed > 0) {
        process.exit(1);
    }
}

runAuthTests().catch((err) => {
    console.error("Fatal test error:", err);
    process.exit(1);
});

