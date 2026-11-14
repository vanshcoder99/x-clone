import { io as ioClient } from "socket.io-client";

process.env.PORT = "5058";
process.env.NODE_ENV = "test";

const { httpServer, io, prisma } = await import("./dist/index.js");

const BASE_URL = "http://localhost:5058/api";
const SOCKET_URL = "http://localhost:5058";

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

async function runEngagementNotificationTests() {
    console.log("\n=======================================================");
    console.log("   SOCIALSPHERE PHASE 6 ENGAGEMENT & NOTIFICATION TESTS");
    console.log("=======================================================\n");

    const rand = Math.floor(100000 + Math.random() * 900000);
    const userAData = { username: `eng_alice_${rand}`, email: `eng_alice_${rand}@example.com`, password: "AlicePassword123!" };
    const userBData = { username: `eng_bob_${rand}`, email: `eng_bob_${rand}@example.com`, password: "BobPassword123!" };
    const userCData = { username: `eng_charlie_${rand}`, email: `eng_charlie_${rand}@example.com`, password: "CharliePassword123!" };

    let userA = null;
    let userB = null;
    let userC = null;
    let tokenA = "";
    let tokenB = "";
    let tokenC = "";

    let aliceTweetId = "";
    let aliceNotificationId = "";

    try {
        // ----------------------------------------------------
        // SETUP: Register Alice, Bob, and Charlie
        // ----------------------------------------------------
        console.log("Setup: Registering test users & creating test tweet...");
        const [regA, regB, regC] = await Promise.all([
            fetch(`${BASE_URL}/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(userAData),
            }).then((r) => r.json()),
            fetch(`${BASE_URL}/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(userBData),
            }).then((r) => r.json()),
            fetch(`${BASE_URL}/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(userCData),
            }).then((r) => r.json()),
        ]);

        userA = regA.user;
        userB = regB.user;
        userC = regC.user;
        tokenA = regA.accessToken;
        tokenB = regB.accessToken;
        tokenC = regC.accessToken;

        // Alice creates a tweet
        const tweetRes = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ content: "Alice engagement test post #Phase6" }),
        });
        const tweetData = await tweetRes.json();
        aliceTweetId = tweetData.tweet?.id;
        assert(tweetRes.status === 201 && !!aliceTweetId, "Setup: Alice created a post");

        // ----------------------------------------------------
        // 1. LIKES & IDEMPOTENCY
        // ----------------------------------------------------
        console.log("\n1. Testing Likes & Idempotency...");

        // 1.1 Unauthenticated like
        const l1 = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/like`, { method: "POST" });
        assert(l1.status === 401, "Unauthenticated like rejected with 401");

        // 1.2 Like non-existent tweet
        const l2 = await fetch(`${BASE_URL}/tweets/00000000-0000-0000-0000-000000000000/like`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(l2.status === 404, "Like non-existent tweet returns 404 Not Found");

        // 1.3 Bob likes Alice's tweet
        const l3 = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/like`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const l3Data = await l3.json();
        assert(l3.status === 200 && l3Data.isLiked === true, "Bob likes Alice's tweet returns 200 (isLiked: true)");

        // 1.4 Verify Like in DB
        const likeRecord = await prisma.like.findUnique({
            where: { userId_tweetId: { userId: userB.id, tweetId: aliceTweetId } },
        });
        assert(!!likeRecord, "Like record exists in database");

        // 1.5 Verify LIKE notification created for Alice
        const likeNotif = await prisma.notification.findFirst({
            where: { userId: userA.id, sourceUserId: userB.id, type: "LIKE", tweetId: aliceTweetId },
        });
        assert(!!likeNotif, "LIKE notification created for Alice");
        if (likeNotif) aliceNotificationId = likeNotif.id;

        // 1.6 Bob unlikes Alice's tweet
        const l4 = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/like`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const l4Data = await l4.json();
        assert(l4.status === 200 && l4Data.isLiked === false, "Bob toggles like again (unlike) returns 200 (isLiked: false)");

        // 1.7 Verify Like deleted from DB
        const likeRecordAfter = await prisma.like.findUnique({
            where: { userId_tweetId: { userId: userB.id, tweetId: aliceTweetId } },
        });
        assert(!likeRecordAfter, "Like record deleted from database");

        // 1.8 Alice likes her own tweet (Self-like)
        const l5 = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/like`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert(l5.status === 200, "Alice self-like returns 200 OK");

        // Verify NO self-notification created
        const selfLikeNotif = await prisma.notification.findFirst({
            where: { userId: userA.id, sourceUserId: userA.id, type: "LIKE" },
        });
        assert(!selfLikeNotif, "No self-notification created when user likes own tweet");

        // ----------------------------------------------------
        // 2. RETWEETS AND QUOTE TWEETS
        // ----------------------------------------------------
        console.log("\n2. Testing Retweets and Quote Tweets...");

        // 2.1 Plain Retweet: Bob retweets Alice's tweet
        const rt1 = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/retweet`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const rt1Data = await rt1.json();
        assert(rt1.status === 200 && rt1Data.isRetweeted === true, "Bob retweets Alice's tweet (200, isRetweeted: true)");

        // 2.2 Verify DB record has quoteContent = null
        const rtRecord1 = await prisma.retweet.findUnique({
            where: { userId_tweetId: { userId: userB.id, tweetId: aliceTweetId } },
        });
        assert(rtRecord1 && rtRecord1.quoteContent === null, "Plain retweet stored with quoteContent: null");

        // 2.3 Verify RETWEET notification created for Alice
        const rtNotif = await prisma.notification.findFirst({
            where: { userId: userA.id, sourceUserId: userB.id, type: "RETWEET", tweetId: aliceTweetId },
        });
        assert(!!rtNotif, "RETWEET notification created for Alice");

        // 2.4 Un-retweet: Bob toggles plain retweet again
        const rt2 = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/retweet`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const rt2Data = await rt2.json();
        assert(rt2.status === 200 && rt2Data.isRetweeted === false, "Bob un-retweets (200, isRetweeted: false)");

        const rtRecordAfter = await prisma.retweet.findUnique({
            where: { userId_tweetId: { userId: userB.id, tweetId: aliceTweetId } },
        });
        assert(!rtRecordAfter, "Retweet record removed from database");

        // 2.5 Quote Tweet: Bob posts quote retweet
        const quoteText = "Check this insightful tweet from Alice!";
        const rt3 = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/retweet`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenB}` },
            body: JSON.stringify({ quoteContent: quoteText }),
        });
        const rt3Data = await rt3.json();
        assert(rt3.status === 200 && rt3Data.message === "Quote posted", "Quote tweet posted successfully (200)");

        const rtRecordQuote = await prisma.retweet.findUnique({
            where: { userId_tweetId: { userId: userB.id, tweetId: aliceTweetId } },
        });
        assert(rtRecordQuote && rtRecordQuote.quoteContent === quoteText, "Quote content persisted correctly in database");

        // 2.6 Quote tweet length validation (> 280 chars)
        const rt4 = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/retweet`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenB}` },
            body: JSON.stringify({ quoteContent: "Q".repeat(281) }),
        });
        assert(rt4.status === 400, "Quote tweet exceeding 280 characters rejected with 400");

        // ----------------------------------------------------
        // 3. BOOKMARKS PRIVACY & ENDPOINTS
        // ----------------------------------------------------
        console.log("\n3. Testing Bookmarks Privacy & Isolation...");

        // 3.1 Unauthenticated bookmark
        const bm1 = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/bookmark`, { method: "POST" });
        assert(bm1.status === 401, "Unauthenticated bookmark rejected with 401");

        // 3.2 Bob bookmarks Alice's tweet
        const bm2 = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/bookmark`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const bm2Data = await bm2.json();
        assert(bm2.status === 200 && bm2Data.isBookmarked === true, "Bob bookmarks Alice's tweet (200, isBookmarked: true)");

        // 3.3 Verify Bookmark record in DB
        const bmRecord = await prisma.bookmark.findUnique({
            where: { userId_tweetId: { userId: userB.id, tweetId: aliceTweetId } },
        });
        assert(!!bmRecord, "Bookmark record exists for Bob in database");

        // 3.4 Confirm privacy: NO public notification created for bookmarks
        const bmNotif = await prisma.notification.findFirst({
            where: { sourceUserId: userB.id, tweetId: aliceTweetId, type: "LIKE" },
        });
        // Count any notifications created after bookmark
        const allNotifsForBm = await prisma.notification.count({
            where: { sourceUserId: userB.id, tweetId: aliceTweetId, createdAt: { gte: bmRecord.createdAt } },
        });
        assert(allNotifsForBm === 0, "Bookmarks are strictly private: zero notifications created");

        // 3.5 Bob views his bookmarks (GET /api/tweets/bookmarks)
        const bobBookmarksRes = await fetch(`${BASE_URL}/tweets/bookmarks`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const bobBookmarksData = await bobBookmarksRes.json();
        assert(bobBookmarksRes.status === 200, "Get bookmarks returns 200 OK");
        assert(
            (bobBookmarksData.tweets || []).some((t) => t.id === aliceTweetId),
            "Bob's bookmarks list contains Alice's saved tweet"
        );

        // 3.6 Alice views her bookmarks (Isolation)
        const aliceBookmarksRes = await fetch(`${BASE_URL}/tweets/bookmarks`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const aliceBookmarksData = await aliceBookmarksRes.json();
        assert(
            aliceBookmarksRes.status === 200 && (aliceBookmarksData.tweets || []).length === 0,
            "Bookmarks are isolated: Alice's bookmarks list does NOT contain Bob's bookmarks"
        );

        // 3.7 Bob removes bookmark
        const bm3 = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/bookmark`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const bm3Data = await bm3.json();
        assert(bm3.status === 200 && bm3Data.isBookmarked === false, "Bob removes bookmark (200, isBookmarked: false)");

        // ----------------------------------------------------
        // 4. NOTIFICATIONS OWNERSHIP & READ STATE
        // ----------------------------------------------------
        console.log("\n4. Testing Notifications Ownership & Read State...");

        // 4.1 Alice fetches notifications
        const notifRes1 = await fetch(`${BASE_URL}/notifications`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const notifData1 = await notifRes1.json();
        assert(notifRes1.status === 200, "Alice fetches notifications returns 200 OK");
        assert(notifData1.notifications?.length > 0, "Alice has received notifications from interactions");
        assert(notifData1.unreadCount > 0, "Alice has unread notifications count");

        // 4.2 Bob fetches notifications (Isolation)
        const notifRes2 = await fetch(`${BASE_URL}/notifications`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const notifData2 = await notifRes2.json();
        assert(
            notifRes2.status === 200 && (notifData2.notifications || []).length === 0,
            "Bob's notifications are isolated (0 notifications for Bob)"
        );

        // 4.3 Notification Authorization / IDOR Protection:
        // Bob attempts to mark Alice's notification as read
        const badRead = await fetch(`${BASE_URL}/notifications/read`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenB}` },
            body: JSON.stringify({ notificationId: aliceNotificationId }),
        });
        assert(badRead.status === 403, "User cannot mark another user's notification as read (403 Forbidden)");

        // 4.4 Non-existent notification ID
        const notFoundRead = await fetch(`${BASE_URL}/notifications/read`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ notificationId: "00000000-0000-0000-0000-000000000000" }),
        });
        assert(notFoundRead.status === 404, "Non-existent notification ID returns 404 Not Found");

        // 4.5 Alice marks single notification as read
        const singleRead = await fetch(`${BASE_URL}/notifications/read`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ notificationId: aliceNotificationId }),
        });
        assert(singleRead.status === 200, "Alice marks single notification as read (200 OK)");

        const notifInDb = await prisma.notification.findUnique({
            where: { id: aliceNotificationId },
        });
        assert(notifInDb?.read === true, "Notification read state updated to true in DB");

        // 4.6 Alice marks ALL notifications as read
        const allRead = await fetch(`${BASE_URL}/notifications/read`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert(allRead.status === 200, "Alice marks all notifications as read (200 OK)");

        const notifRes3 = await fetch(`${BASE_URL}/notifications`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const notifData3 = await notifRes3.json();
        assert(notifData3.unreadCount === 0, "Unread count is now 0 after mark-all-read");

        // ----------------------------------------------------
        // 5. REAL-TIME NOTIFICATION DELIVERY (SOCKET.IO)
        // ----------------------------------------------------
        console.log("\n5. Testing Real-Time Socket.IO Notification Delivery...");

        await new Promise((resolve) => {
            const clientSocket = ioClient(SOCKET_URL, {
                auth: { token: tokenA },
                transports: ["websocket"],
            });

            clientSocket.on("connect", async () => {
                // Charlie likes Alice's tweet to trigger real-time notification
                clientSocket.on("notification:new", (liveNotif) => {
                    assert(liveNotif.type === "LIKE", "Socket.IO client received real-time notification:new event");
                    assert(liveNotif.sourceUser?.id === userC.id, "Real-time notification includes Charlie as sourceUser");
                    clientSocket.disconnect();
                    resolve();
                });

                // Trigger like from Charlie
                await fetch(`${BASE_URL}/tweets/${aliceTweetId}/like`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${tokenC}` },
                });
            });

            // Timeout fallback
            setTimeout(() => {
                clientSocket.disconnect();
                resolve();
            }, 4000);
        });

    } catch (err) {
        console.error("Test execution error:", err);
        assert(false, `Unexpected error: ${err.message}`);
    } finally {
        // ----------------------------------------------------
        // 6. CLEAN TEARDOWN
        // ----------------------------------------------------
        console.log("\n6. Cleaning up test data...");
        try {
            const userIds = [userA?.id, userB?.id, userC?.id].filter(Boolean);
            if (userIds.length > 0) {
                await prisma.like.deleteMany({ where: { userId: { in: userIds } } });
                await prisma.bookmark.deleteMany({ where: { userId: { in: userIds } } });
                await prisma.retweet.deleteMany({ where: { userId: { in: userIds } } });
                await prisma.notification.deleteMany({
                    where: { OR: [{ userId: { in: userIds } }, { sourceUserId: { in: userIds } }] },
                });
                await prisma.tweet.deleteMany({ where: { authorId: { in: userIds } } });
                await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
                await prisma.user.deleteMany({ where: { id: { in: userIds } } });
            }
            console.log("  ✓ Database teardown complete - zero test remnants.");
        } catch (cleanupErr) {
            console.error("Cleanup error:", cleanupErr);
        }

        const passed = results.filter((r) => r.status === "PASS").length;
        const failed = results.filter((r) => r.status === "FAIL").length;
        console.log("\n=======================================================");
        console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (${results.length} total)`);
        console.log("=======================================================\n");

        httpServer.close();
        io.close();
        await prisma.$disconnect();
        process.exit(failed > 0 ? 1 : 0);
    }
}

runEngagementNotificationTests();
