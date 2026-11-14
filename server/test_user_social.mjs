process.env.PORT = "5056";
process.env.NODE_ENV = "test";

const { httpServer, io, prisma } = await import("./dist/index.js");

const BASE_URL = "http://localhost:5056/api";

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

async function runSocialTests() {
    console.log("\n=======================================================");
    console.log("   SOCIALSPHERE PHASE 4 USER & SOCIAL GRAPH TEST SUITE ");
    console.log("=======================================================\n");

    const rand = Math.floor(100000 + Math.random() * 900000);
    const userAData = { username: `u_alice_${rand}`, email: `alice_${rand}@example.com`, password: "AlicePassword123!" };
    const userBData = { username: `u_bob_${rand}`, email: `bob_${rand}@example.com`, password: "BobPassword123!" };
    const userCData = { username: `u_charlie_${rand}`, email: `charlie_${rand}@example.com`, password: "CharliePassword123!" };

    let userA = null;
    let userB = null;
    let userC = null;
    let tokenA = "";
    let tokenB = "";
    let tokenC = "";
    let aliceTweetId = "";

    try {
        // ----------------------------------------------------
        // SETUP: Register 3 users (Alice, Bob, Charlie)
        // ----------------------------------------------------
        console.log("Setup: Registering test users...");
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

        assert(userA?.id && userB?.id && userC?.id, "Test users registered successfully");

        // ----------------------------------------------------
        // 1. USER PROFILE RETRIEVAL & DISPLAY
        // ----------------------------------------------------
        console.log("\n1. Testing Profile Retrieval & Display...");

        // 1.1 Unauthenticated profile view
        const p1 = await fetch(`${BASE_URL}/users/profile/${userA.username}`);
        const p1Data = await p1.json();
        assert(p1.status === 200, "Unauthenticated profile request returns 200 OK");
        assert(p1Data.user?.username === userA.username, "Profile returns matching username");
        assert(p1Data.user?.isFollowing === false, "Public view reports isFollowing: false");
        assert(p1Data.user?.isBlocked === false && p1Data.user?.isBlockedBy === false, "Public view reports isBlocked: false and isBlockedBy: false");

        // 1.2 Non-existent profile
        const p2 = await fetch(`${BASE_URL}/users/profile/nonexistent_${rand}`);
        assert(p2.status === 404, "Non-existent profile returns 404 Not Found");

        // 1.3 Authenticated view of own profile
        const p3 = await fetch(`${BASE_URL}/users/profile/${userA.username}`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const p3Data = await p3.json();
        assert(p3.status === 200, "Authenticated own profile view returns 200 OK");
        assert(p3Data.user?.isFollowing === false && p3Data.user?.isBlocked === false, "Own profile reports isFollowing: false and isBlocked: false");

        // ----------------------------------------------------
        // 2. PROFILE MANAGEMENT & VALIDATION
        // ----------------------------------------------------
        console.log("\n2. Testing Profile Update & Validation...");

        // 2.1 Unauthorized update
        const u1 = await fetch(`${BASE_URL}/users/profile`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bio: "Unauthorized bio" }),
        });
        assert(u1.status === 401, "Unauthenticated profile update returns 401 Unauthorized");

        // 2.2 Invalid username format
        const u2 = await fetch(`${BASE_URL}/users/profile`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ username: "bad user name!" }),
        });
        assert(u2.status === 400, "Invalid username format (spaces/symbols) returns 400 Bad Request");

        // 2.3 Bio too long (> 160 chars)
        const longBio = "A".repeat(161);
        const u3 = await fetch(`${BASE_URL}/users/profile`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ bio: longBio }),
        });
        assert(u3.status === 400, "Bio exceeding 160 characters returns 400 Bad Request");

        // 2.4 Duplicate username (Alice tries to take Bob's username)
        const u4 = await fetch(`${BASE_URL}/users/profile`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ username: userB.username }),
        });
        assert(u4.status === 409, "Conflicting/taken username returns 409 Conflict");

        // 2.5 Valid profile update
        const validBio = "Hello world from Alice!";
        const validAvatar = "https://example.com/alice.png";
        const u5 = await fetch(`${BASE_URL}/users/profile`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ bio: validBio, avatarUrl: validAvatar }),
        });
        const u5Data = await u5.json();
        assert(u5.status === 200, "Valid profile update returns 200 OK");
        assert(u5Data.user?.bio === validBio, "Updated bio matches submitted bio");
        assert(u5Data.user?.avatarUrl === validAvatar, "Updated avatar matches submitted avatar");

        // ----------------------------------------------------
        // 3. FOLLOW & UNFOLLOW IDEMPOTENCY
        // ----------------------------------------------------
        console.log("\n3. Testing Follow & Unfollow Idempotency...");

        // 3.1 Self follow
        const f1 = await fetch(`${BASE_URL}/users/follow/${userA.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert(f1.status === 400, "Self-follow rejected with 400 Bad Request");

        // 3.2 Follow non-existent user
        const f2 = await fetch(`${BASE_URL}/users/follow/00000000-0000-0000-0000-000000000000`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert(f2.status === 404, "Follow non-existent user returns 404 Not Found");

        // 3.3 Alice follows Bob
        const f3 = await fetch(`${BASE_URL}/users/follow/${userB.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const f3Data = await f3.json();
        assert(f3.status === 200 && f3Data.isFollowing === true, "Alice follows Bob returns 200 OK (isFollowing: true)");

        // 3.4 Verify Follow record and Notification in DB
        const followRecord = await prisma.follow.findUnique({
            where: { followerId_followingId: { followerId: userA.id, followingId: userB.id } },
        });
        assert(!!followRecord, "Follow record created in database");

        const notifCountBefore = await prisma.notification.count({
            where: { userId: userB.id, sourceUserId: userA.id, type: "FOLLOW" },
        });
        assert(notifCountBefore === 1, "Follow notification created for target user");

        // 3.5 Alice follows Bob AGAIN (Idempotency)
        const f4 = await fetch(`${BASE_URL}/users/follow/${userB.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const f4Data = await f4.json();
        assert(f4.status === 200 && f4Data.isFollowing === true, "Repeated follow returns 200 OK idempotently");

        // 3.6 Verify no duplicate notifications were created
        const notifCountAfter = await prisma.notification.count({
            where: { userId: userB.id, sourceUserId: userA.id, type: "FOLLOW" },
        });
        assert(notifCountAfter === 1, "No duplicate notification created on idempotent follow");

        // 3.7 Alice checks Bob's profile
        const pBob = await fetch(`${BASE_URL}/users/profile/${userB.username}`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const pBobData = await pBob.json();
        assert(pBobData.user?.isFollowing === true, "Bob's profile correctly shows isFollowing: true for Alice");

        // 3.8 Alice unfollows Bob
        const uf1 = await fetch(`${BASE_URL}/users/unfollow/${userB.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const uf1Data = await uf1.json();
        assert(uf1.status === 200 && uf1Data.isFollowing === false, "Alice unfollows Bob returns 200 OK (isFollowing: false)");

        const followRecordAfterUf = await prisma.follow.findUnique({
            where: { followerId_followingId: { followerId: userA.id, followingId: userB.id } },
        });
        assert(!followRecordAfterUf, "Follow record deleted from database");

        // 3.9 Alice checks Bob's profile again
        const pBob2 = await fetch(`${BASE_URL}/users/profile/${userB.username}`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const pBobData2 = await pBob2.json();
        assert(pBobData2.user?.isFollowing === false, "Bob's profile now shows isFollowing: false for Alice");

        // 3.10 Repeated unfollow (Idempotency)
        const uf2 = await fetch(`${BASE_URL}/users/unfollow/${userB.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert(uf2.status === 200, "Repeated unfollow returns 200 OK idempotently");

        // ----------------------------------------------------
        // 4. FOLLOWERS & FOLLOWING LISTS
        // ----------------------------------------------------
        console.log("\n4. Testing Followers & Following Lists...");

        // Alice follows Bob; Charlie follows Bob
        await fetch(`${BASE_URL}/users/follow/${userB.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        await fetch(`${BASE_URL}/users/follow/${userB.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenC}` },
        });

        // 4.1 Bob's followers list
        const followersRes = await fetch(`${BASE_URL}/users/${userB.username}/followers`);
        const followersData = await followersRes.json();
        assert(followersRes.status === 200, "Get followers returns 200 OK");
        const followerUsernames = (followersData.followers || []).map((u) => u.username);
        assert(
            followerUsernames.includes(userA.username) && followerUsernames.includes(userC.username),
            "Followers list contains Alice and Charlie"
        );

        // 4.2 Alice's following list
        const followingRes = await fetch(`${BASE_URL}/users/${userA.username}/following`);
        const followingData = await followingRes.json();
        assert(followingRes.status === 200, "Get following returns 200 OK");
        const followingUsernames = (followingData.following || []).map((u) => u.username);
        assert(followingUsernames.includes(userB.username), "Alice following list contains Bob");

        // ----------------------------------------------------
        // 5. BLOCK / UNBLOCK TWO-WAY PRIVACY ENFORCEMENT
        // ----------------------------------------------------
        console.log("\n5. Testing Block & Two-Way Privacy Enforcement...");

        // 5.1 Self-block rejected
        const b1 = await fetch(`${BASE_URL}/users/block/${userA.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert(b1.status === 400, "Self-block rejected with 400 Bad Request");

        // 5.2 Block non-existent user
        const b2 = await fetch(`${BASE_URL}/users/block/00000000-0000-0000-0000-000000000000`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert(b2.status === 404, "Block non-existent user returns 404 Not Found");

        // 5.3 Establish mutual follows between Alice and Bob first
        await fetch(`${BASE_URL}/users/follow/${userA.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const mutualFollowsBefore = await prisma.follow.count({
            where: {
                OR: [
                    { followerId: userA.id, followingId: userB.id },
                    { followerId: userB.id, followingId: userA.id },
                ],
            },
        });
        assert(mutualFollowsBefore === 2, "Mutual follows established between Alice and Bob before block");

        // 5.4 Alice blocks Bob (Atomic transaction)
        const b3 = await fetch(`${BASE_URL}/users/block/${userB.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const b3Data = await b3.json();
        assert(b3.status === 200 && b3Data.isBlocked === true, "Alice blocks Bob returns 200 OK");

        // 5.5 Verify atomic mutual follow removal
        const mutualFollowsAfter = await prisma.follow.count({
            where: {
                OR: [
                    { followerId: userA.id, followingId: userB.id },
                    { followerId: userB.id, followingId: userA.id },
                ],
            },
        });
        assert(mutualFollowsAfter === 0, "Atomic block completely severed mutual follow records in both directions");

        // 5.6 Verify block record created
        const blockRecord = await prisma.block.findUnique({
            where: { blockerId_blockedId: { blockerId: userA.id, blockedId: userB.id } },
        });
        assert(!!blockRecord, "Block record persisted in database");

        // 5.7 Alice views Bob's profile: isBlocked: true, isBlockedBy: false
        const pAliceViewsBob = await fetch(`${BASE_URL}/users/profile/${userB.username}`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const pAliceViewsBobData = await pAliceViewsBob.json();
        assert(
            pAliceViewsBobData.user?.isBlocked === true && pAliceViewsBobData.user?.isBlockedBy === false,
            "Alice sees isBlocked: true and isBlockedBy: false on Bob's profile"
        );

        // 5.8 Bob views Alice's profile: isBlocked: false, isBlockedBy: true
        const pBobViewsAlice = await fetch(`${BASE_URL}/users/profile/${userA.username}`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const pBobViewsAliceData = await pBobViewsAlice.json();
        assert(
            pBobViewsAliceData.user?.isBlocked === false && pBobViewsAliceData.user?.isBlockedBy === true,
            "Bob sees isBlocked: false and isBlockedBy: true on Alice's profile"
        );

        // 5.9 Alice cannot follow Bob while blocked
        const fAfterBlock1 = await fetch(`${BASE_URL}/users/follow/${userB.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert(fAfterBlock1.status === 403, "Blocker (Alice) cannot follow blocked user (Bob) - 403 Forbidden");

        // 5.10 Bob cannot follow Alice while blocked
        const fAfterBlock2 = await fetch(`${BASE_URL}/users/follow/${userA.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(fAfterBlock2.status === 403, "Blocked user (Bob) cannot follow blocker (Alice) - 403 Forbidden");

        // 5.11 Search privacy
        const searchAlice = await fetch(`${BASE_URL}/users/search?q=${userB.username}`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const searchAliceData = await searchAlice.json();
        const foundBobByAlice = (searchAliceData.users || []).some((u) => u.username === userB.username);
        assert(!foundBobByAlice, "Blocked user (Bob) is excluded from blocker (Alice)'s search results");

        const searchBob = await fetch(`${BASE_URL}/users/search?q=${userA.username}`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const searchBobData = await searchBob.json();
        const foundAliceByBob = (searchBobData.users || []).some((u) => u.username === userA.username);
        assert(!foundAliceByBob, "Blocker (Alice) is excluded from blocked user (Bob)'s search results");

        const searchCharlie = await fetch(`${BASE_URL}/users/search?q=${userA.username}`, {
            headers: { Authorization: `Bearer ${tokenC}` },
        });
        const searchCharlieData = await searchCharlie.json();
        const foundAliceByCharlie = (searchCharlieData.users || []).some((u) => u.username === userA.username);
        assert(foundAliceByCharlie, "Unrelated user (Charlie) can find Alice in search");

        // 5.12 Tweet view privacy under block
        // Alice posts a tweet
        const postRes = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ content: "Alice secret post during block test" }),
        });
        const postData = await postRes.json();
        aliceTweetId = postData.tweet?.id;
        assert(postRes.status === 201 && !!aliceTweetId, "Alice created a tweet");

        // Bob requests Alice's tweets
        const bUserTweets = await fetch(`${BASE_URL}/tweets/user/${userA.username}`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const bUserTweetsData = await bUserTweets.json();
        assert(
            bUserTweets.status === 200 && bUserTweetsData.tweets?.length === 0 && bUserTweetsData.isBlocked === true,
            "Bob cannot view Alice's tweets via profile feed (empty tweets + isBlocked: true)"
        );

        // Bob requests single tweet by ID
        const bSingleTweet = await fetch(`${BASE_URL}/tweets/${aliceTweetId}`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(bSingleTweet.status === 403, "Bob cannot view Alice's single tweet by ID (403 Forbidden)");

        // 5.13 Interaction privacy under block (Like, Retweet, Bookmark, Reply)
        const likeRes = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/like`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(likeRes.status === 403, "Blocked user cannot like tweet (403 Forbidden)");

        const rtRes = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/retweet`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(rtRes.status === 403, "Blocked user cannot retweet post (403 Forbidden)");

        const bmRes = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/bookmark`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(bmRes.status === 403, "Blocked user cannot bookmark post (403 Forbidden)");

        const replyRes = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenB}` },
            body: JSON.stringify({ content: "Illegal reply from blocked user" }),
        });
        assert(replyRes.status === 403, "Blocked user cannot reply to post (403 Forbidden)");

        const bViewFollowers = await fetch(`${BASE_URL}/users/${userA.username}/followers`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(bViewFollowers.status === 403, "Blocked user cannot view blocker's followers list (403 Forbidden)");

        const bViewFollowing = await fetch(`${BASE_URL}/users/${userA.username}/following`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(bViewFollowing.status === 403, "Blocked user cannot view blocker's following list (403 Forbidden)");

        // ----------------------------------------------------
        // 6. UNBLOCK & RESTORATION OF PRIVACY
        // ----------------------------------------------------
        console.log("\n6. Testing Unblock & Non-Restoration of Follows...");

        // 6.1 Alice unblocks Bob
        const ubRes = await fetch(`${BASE_URL}/users/unblock/${userB.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const ubData = await ubRes.json();
        assert(ubRes.status === 200 && ubData.isBlocked === false, "Alice unblocks Bob returns 200 OK (isBlocked: false)");

        // 6.2 Block record deleted
        const blockAfterUnblock = await prisma.block.findUnique({
            where: { blockerId_blockedId: { blockerId: userA.id, blockedId: userB.id } },
        });
        assert(!blockAfterUnblock, "Block record removed from database");

        // 6.3 Follow relationship NOT restored (remains 0 follows)
        const mutualFollowsAfterUnblock = await prisma.follow.count({
            where: {
                OR: [
                    { followerId: userA.id, followingId: userB.id },
                    { followerId: userB.id, followingId: userA.id },
                ],
            },
        });
        assert(mutualFollowsAfterUnblock === 0, "Unblocking does NOT restore previously severed follows");

        // 6.4 Bob views Alice's profile again
        const pBobViewsAliceAfter = await fetch(`${BASE_URL}/users/profile/${userA.username}`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        const pBobViewsAliceAfterData = await pBobViewsAliceAfter.json();
        assert(
            pBobViewsAliceAfterData.user?.isBlocked === false && pBobViewsAliceAfterData.user?.isBlockedBy === false,
            "Bob views Alice's profile after unblock: both isBlocked and isBlockedBy are false"
        );

        // 6.5 Bob can view Alice's tweet again
        const bSingleTweetAfter = await fetch(`${BASE_URL}/tweets/${aliceTweetId}`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(bSingleTweetAfter.status === 200, "Bob can view Alice's tweet after unblock (200 OK)");

        // 6.6 Bob can like Alice's tweet again
        const bLikeAfter = await fetch(`${BASE_URL}/tweets/${aliceTweetId}/like`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(bLikeAfter.status === 200, "Bob can like Alice's tweet after unblock (200 OK)");
    } catch (err) {
        console.error("Test execution error:", err);
        assert(false, `Unexpected error: ${err.message}`);
    } finally {
        // ----------------------------------------------------
        // 7. CLEAN TEARDOWN
        // ----------------------------------------------------
        console.log("\n7. Cleaning up test data...");
        try {
            const userIds = [userA?.id, userB?.id, userC?.id].filter(Boolean);
            if (userIds.length > 0) {
                // Delete likes
                await prisma.like.deleteMany({ where: { userId: { in: userIds } } });
                // Delete bookmarks
                await prisma.bookmark.deleteMany({ where: { userId: { in: userIds } } });
                // Delete retweets
                await prisma.retweet.deleteMany({ where: { userId: { in: userIds } } });
                // Delete tweet hashtags
                if (aliceTweetId) {
                    await prisma.tweetHashtag.deleteMany({ where: { tweetId: aliceTweetId } });
                }
                // Delete tweets
                await prisma.tweet.deleteMany({ where: { authorId: { in: userIds } } });
                // Delete notifications
                await prisma.notification.deleteMany({
                    where: { OR: [{ userId: { in: userIds } }, { sourceUserId: { in: userIds } }] },
                });
                // Delete follows
                await prisma.follow.deleteMany({
                    where: { OR: [{ followerId: { in: userIds } }, { followingId: { in: userIds } }] },
                });
                // Delete blocks
                await prisma.block.deleteMany({
                    where: { OR: [{ blockerId: { in: userIds } }, { blockedId: { in: userIds } }] },
                });
                // Delete refresh tokens
                await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
                // Delete subscriptions
                await prisma.subscription.deleteMany({ where: { userId: { in: userIds } } });
                // Delete users
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

runSocialTests();

