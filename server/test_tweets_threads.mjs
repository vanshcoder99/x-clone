process.env.PORT = "5057";
process.env.NODE_ENV = "test";

const { httpServer, io, prisma } = await import("./dist/index.js");

const BASE_URL = "http://localhost:5057/api";

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

async function runTweetThreadTests() {
    console.log("\n=======================================================");
    console.log("   SOCIALSPHERE PHASE 5 TWEET & THREAD ENGINE TESTS    ");
    console.log("=======================================================\n");

    const rand = Math.floor(100000 + Math.random() * 900000);
    const userAData = { username: `tw_alice_${rand}`, email: `tw_alice_${rand}@example.com`, password: "AlicePassword123!" };
    const userBData = { username: `tw_bob_${rand}`, email: `tw_bob_${rand}@example.com`, password: "BobPassword123!" };
    const userPData = { username: `tw_prem_${rand}`, email: `tw_prem_${rand}@example.com`, password: "PremPassword123!" };

    let userA = null;
    let userB = null;
    let userP = null;
    let tokenA = "";
    let tokenB = "";
    let tokenP = "";

    const createdTweetIds = [];

    try {
        // ----------------------------------------------------
        // SETUP: Register Alice, Bob, and Premium User
        // ----------------------------------------------------
        console.log("Setup: Registering test users...");
        const [regA, regB, regP] = await Promise.all([
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
                body: JSON.stringify(userPData),
            }).then((r) => r.json()),
        ]);

        userA = regA.user;
        userB = regB.user;
        userP = regP.user;
        tokenA = regA.accessToken;
        tokenB = regB.accessToken;
        tokenP = regP.accessToken;

        // Upgrade userP to Premium
        const subRes = await fetch(`${BASE_URL}/users/subscribe`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenP}` },
        });
        assert(subRes.status === 200, "Setup: User P upgraded to Premium");

        // ----------------------------------------------------
        // 1. TWEET COMPOSER & CHARACTER LIMIT VALIDATION
        // ----------------------------------------------------
        console.log("\n1. Testing Tweet Composer & Character Limit Validation...");

        // 1.1 Unauthenticated creation
        const c1 = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "Hello world" }),
        });
        assert(c1.status === 401, "Unauthenticated tweet creation rejected with 401");

        // 1.2 Empty content
        const c2 = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ content: "   " }),
        });
        assert(c2.status === 400, "Empty/whitespace-only tweet content rejected with 400");

        // 1.3 Invalid content type
        const c3 = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ content: 12345 }),
        });
        assert(c3.status === 400, "Non-string tweet content rejected with 400");

        // 1.4 Invalid media type
        const c4 = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ content: "Post with bad media", mediaUrl: "https://example.com/audio.mp3", mediaType: "AUDIO" }),
        });
        assert(c4.status === 400, "Invalid media type rejected with 400");

        // 1.5 Standard user exceeding 280 characters (281 chars)
        const content281 = "A".repeat(281);
        const c5 = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ content: content281 }),
        });
        assert(c5.status === 400, "Standard user exceeding 280 characters rejected with 400");

        // 1.6 Standard user with exactly 280 characters
        const content280 = "B".repeat(280);
        const c6 = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ content: content280 }),
        });
        const c6Data = await c6.json();
        assert(c6.status === 201, "Standard user posting exactly 280 characters succeeds (201)");
        if (c6Data.tweet?.id) createdTweetIds.push(c6Data.tweet.id);

        // 1.7 Premium user posting long-form content (> 280 chars, e.g. 1000 chars)
        const longContent = "Premium long-form post: " + "C".repeat(950);
        const c7 = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenP}` },
            body: JSON.stringify({ content: longContent }),
        });
        const c7Data = await c7.json();
        assert(c7.status === 201 && c7Data.tweet?.content?.length > 280, "Premium user can post > 280 character tweet (201)");
        if (c7Data.tweet?.id) createdTweetIds.push(c7Data.tweet.id);

        // 1.8 Premium user exceeding 10,000 characters (10,001 chars)
        const content10001 = "D".repeat(10001);
        const c8 = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenP}` },
            body: JSON.stringify({ content: content10001 }),
        });
        assert(c8.status === 400, "Premium user exceeding 10,000 characters rejected with 400");

        // 1.9 Media tweet with valid image
        const c9 = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ content: "Check out this image!", mediaUrl: "https://example.com/pic.jpg", mediaType: "IMAGE" }),
        });
        const c9Data = await c9.json();
        assert(c9.status === 201 && c9Data.tweet?.mediaType === "IMAGE", "Tweet with valid media posted successfully (201)");
        if (c9Data.tweet?.id) createdTweetIds.push(c9Data.tweet.id);

        // ----------------------------------------------------
        // 2. HASHTAG EXTRACTION & NORMALIZATION
        // ----------------------------------------------------
        console.log("\n2. Testing Hashtag Extraction & Normalization...");

        // Unique hashtag to test without collisions
        const testHashtag = `ss_${rand}`;
        const tweetWithTagsContent = `Exploring #React19 and #${testHashtag} and #${testHashtag.toUpperCase()}! #123 should be ignored. #español works! foo#bar ignored`;
        const h1 = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ content: tweetWithTagsContent }),
        });
        const h1Data = await h1.json();
        assert(h1.status === 201, "Tweet with hashtags created successfully (201)");
        const tagTweetId = h1Data.tweet?.id;
        if (tagTweetId) createdTweetIds.push(tagTweetId);

        // 2.1 Verify tags returned on tweet response
        const returnedTags = h1Data.tweet?.hashtags || [];
        assert(returnedTags.includes(testHashtag.toLowerCase()), "Normalized lowercase hashtag returned");
        assert(!returnedTags.includes("123"), "Pure number #123 was NOT extracted as hashtag");
        assert(!returnedTags.includes("bar"), "Embedded foo#bar was NOT extracted as hashtag");
        assert(returnedTags.includes("español"), "Unicode hashtag #español successfully extracted");

        // 2.2 Verify TweetHashtag relation in database
        const dbHashtag = await prisma.hashtag.findUnique({
            where: { tag: testHashtag.toLowerCase() },
            include: { tweets: true },
        });
        assert(!!dbHashtag && dbHashtag.tweets.length === 1, "Hashtag and TweetHashtag relation persisted in DB");

        // 2.3 Search by hashtag
        const tagSearch = await fetch(`${BASE_URL}/tweets/hashtag/${testHashtag.toLowerCase()}`);
        const tagSearchData = await tagSearch.json();
        assert(tagSearch.status === 200, "Search by hashtag returns 200 OK");
        assert(
            (tagSearchData.tweets || []).some((t) => t.id === tagTweetId),
            "Hashtag query returns matching tweet"
        );

        // 2.4 Search by hashtag with leading # / URI encoding
        const tagSearchEncoded = await fetch(`${BASE_URL}/tweets/hashtag/%23${testHashtag.toLowerCase()}`);
        const tagSearchEncodedData = await tagSearchEncoded.json();
        assert(
            tagSearchEncoded.status === 200 && (tagSearchEncodedData.tweets || []).some((t) => t.id === tagTweetId),
            "Hashtag query handles leading '#' and URI encoding cleanly"
        );

        // ----------------------------------------------------
        // 3. THREADS AND REPLIES
        // ----------------------------------------------------
        console.log("\n3. Testing Threads and Replies Engine...");

        // Alice posts root tweet for thread
        const rootRes = await fetch(`${BASE_URL}/tweets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ content: "Root thread tweet from Alice" }),
        });
        const rootData = await rootRes.json();
        const rootTweetId = rootData.tweet?.id;
        assert(rootRes.status === 201 && !!rootTweetId, "Root tweet created for thread");
        if (rootTweetId) createdTweetIds.push(rootTweetId);

        // 3.1 Reply to non-existent parent
        const r1 = await fetch(`${BASE_URL}/tweets/00000000-0000-0000-0000-000000000000/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenB}` },
            body: JSON.stringify({ content: "Reply to ghost" }),
        });
        assert(r1.status === 404, "Reply to non-existent parent returns 404 Not Found");

        // 3.2 Standard user reply exceeding 280 chars
        const r2 = await fetch(`${BASE_URL}/tweets/${rootTweetId}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenB}` },
            body: JSON.stringify({ content: "R".repeat(281) }),
        });
        assert(r2.status === 400, "Standard user reply exceeding 280 characters rejected with 400");

        // 3.3 Bob replies to Alice's tweet
        const r3 = await fetch(`${BASE_URL}/tweets/${rootTweetId}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenB}` },
            body: JSON.stringify({ content: "Bob's first reply to Alice #ReplyTag" }),
        });
        const r3Data = await r3.json();
        assert(r3.status === 201 && r3Data.reply?.author?.id === userB.id, "Bob successfully replied to Alice (201)");
        const reply1Id = r3Data.reply?.id;
        if (reply1Id) createdTweetIds.push(reply1Id);

        // 3.4 Verify reply notification created for Alice
        const replyNotif = await prisma.notification.findFirst({
            where: { userId: userA.id, sourceUserId: userB.id, type: "REPLY", tweetId: rootTweetId },
        });
        assert(!!replyNotif, "Reply notification created for parent tweet author");

        // 3.5 Alice replies to her own tweet (Self-reply)
        const r4 = await fetch(`${BASE_URL}/tweets/${rootTweetId}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ content: "Alice self-reply adding more details" }),
        });
        const r4Data = await r4.json();
        assert(r4.status === 201, "Alice self-reply posted successfully (201)");
        const reply2Id = r4Data.reply?.id;
        if (reply2Id) createdTweetIds.push(reply2Id);

        // Verify NO self-notification created for Alice
        const selfNotif = await prisma.notification.findFirst({
            where: { userId: userA.id, sourceUserId: userA.id, type: "REPLY" },
        });
        assert(!selfNotif, "No self-notification created when author replies to own post");

        // 3.6 Verify Thread Retrieval
        const threadRes = await fetch(`${BASE_URL}/tweets/${rootTweetId}`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        const threadData = await threadRes.json();
        assert(threadRes.status === 200, "Fetch thread by ID returns 200 OK");
        assert(threadData.tweet?._count?.replies === 2, "Root tweet reports exactly 2 replies");
        assert(threadData.tweet?.replies?.length === 2, "Thread returns 2 reply items");
        assert(
            threadData.tweet?.replies?.[0]?.id === reply1Id && threadData.tweet?.replies?.[1]?.id === reply2Id,
            "Replies returned in chronological order (createdAt: asc)"
        );

        // ----------------------------------------------------
        // 4. DELETION AND CASCADING CLEANUP
        // ----------------------------------------------------
        console.log("\n4. Testing Deletion & Cascading Cleanup...");

        // 4.1 Unauthorized deletion (Bob tries to delete Alice's tweet)
        const d1 = await fetch(`${BASE_URL}/tweets/${rootTweetId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(d1.status === 403, "Non-author deletion attempt rejected with 403 Forbidden");

        // 4.2 Add engagements to Alice's tweet before deletion
        await fetch(`${BASE_URL}/tweets/${rootTweetId}/like`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        await fetch(`${BASE_URL}/tweets/${rootTweetId}/retweet`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        await fetch(`${BASE_URL}/tweets/${rootTweetId}/bookmark`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenB}` },
        });

        // Verify engagements in DB before deletion
        const likesBefore = await prisma.like.count({ where: { tweetId: rootTweetId } });
        const retweetsBefore = await prisma.retweet.count({ where: { tweetId: rootTweetId } });
        const bookmarksBefore = await prisma.bookmark.count({ where: { tweetId: rootTweetId } });
        assert(likesBefore === 1 && retweetsBefore === 1 && bookmarksBefore === 1, "Engagements recorded on root tweet");

        // 4.3 Alice deletes her root tweet
        const d2 = await fetch(`${BASE_URL}/tweets/${rootTweetId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert(d2.status === 200, "Author deletes root tweet successfully (200 OK)");

        // 4.4 Verify cascading cleanup of likes, retweets, bookmarks, notifications
        const [likesAfter, retweetsAfter, bookmarksAfter, notifsAfter] = await Promise.all([
            prisma.like.count({ where: { tweetId: rootTweetId } }),
            prisma.retweet.count({ where: { tweetId: rootTweetId } }),
            prisma.bookmark.count({ where: { tweetId: rootTweetId } }),
            prisma.notification.count({ where: { tweetId: rootTweetId } }),
        ]);
        assert(
            likesAfter === 0 && retweetsAfter === 0 && bookmarksAfter === 0 && notifsAfter === 0,
            "All likes, retweets, bookmarks, and notifications cascade deleted with root tweet"
        );

        // 4.5 Verify child replies are preserved with parentTweetId = null
        const orphanReply = await prisma.tweet.findUnique({
            where: { id: reply1Id },
        });
        assert(
            orphanReply && orphanReply.parentTweetId === null,
            "Child reply preserved as standalone post with parentTweetId set to null"
        );

        // 4.6 Bob deletes his own reply
        const d3 = await fetch(`${BASE_URL}/tweets/${reply1Id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert(d3.status === 200, "Bob can delete his own reply tweet (200 OK)");

        // ----------------------------------------------------
        // 5. AI COMPOSER INTEGRATION
        // ----------------------------------------------------
        console.log("\n5. Testing AI Composer Suggestion Integration...");

        // 5.1 Empty prompt rejected
        const ai1 = await fetch(`${BASE_URL}/ai/suggest-tweet`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ prompt: "" }),
        });
        assert(ai1.status === 400, "AI suggest rejects empty prompt with 400");

        // 5.2 Valid prompt returns suggestion
        const ai2 = await fetch(`${BASE_URL}/ai/suggest-tweet`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ prompt: "React 19 Server Components" }),
        });
        const ai2Data = await ai2.json();
        assert(
            ai2.status === 200 && typeof ai2Data.suggestion === "string" && ai2Data.suggestion.length > 0,
            "AI suggest returns valid tweet text suggestion (200 OK)"
        );
    } catch (err) {
        console.error("Test execution error:", err);
        assert(false, `Unexpected error: ${err.message}`);
    } finally {
        // ----------------------------------------------------
        // 6. CLEAN TEARDOWN
        // ----------------------------------------------------
        console.log("\n6. Cleaning up test data...");
        try {
            const userIds = [userA?.id, userB?.id, userP?.id].filter(Boolean);
            if (userIds.length > 0) {
                // Delete likes
                await prisma.like.deleteMany({ where: { userId: { in: userIds } } });
                // Delete bookmarks
                await prisma.bookmark.deleteMany({ where: { userId: { in: userIds } } });
                // Delete retweets
                await prisma.retweet.deleteMany({ where: { userId: { in: userIds } } });
                // Delete tweet hashtags
                await prisma.tweetHashtag.deleteMany({
                    where: { tweet: { authorId: { in: userIds } } },
                });
                // Delete notifications
                await prisma.notification.deleteMany({
                    where: { OR: [{ userId: { in: userIds } }, { sourceUserId: { in: userIds } }] },
                });
                // Delete tweets
                await prisma.tweet.deleteMany({ where: { authorId: { in: userIds } } });
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

runTweetThreadTests();

