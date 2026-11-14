process.env.PORT = "5059";
process.env.NODE_ENV = "test";

const { httpServer, prisma } = await import("./dist/index.js");

const BASE_URL = "http://localhost:5059/api";

const makeRequest = async (endpoint, method = "GET", body = null, token = null) => {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${BASE_URL}${endpoint}`, options);
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    return { status: res.status, data };
};

const runSuite = async () => {
    let passed = 0;
    let failed = 0;

    const assert = (condition, description) => {
        if (condition) {
            console.log(`  ✓ ${description}`);
            passed++;
        } else {
            console.error(`  ✗ FAIL: ${description}`);
            failed++;
        }
    };

    console.log("\n=======================================================");
    console.log("   SOCIALSPHERE PHASE 7 PAGINATION & FEED TEST SUITE   ");
    console.log("=======================================================\n");

    const stamp = Date.now().toString().slice(-6);
    const aliceUname = `pg_alice_${stamp}`;
    const bobUname = `pg_bob_${stamp}`;
    const carolUname = `pg_carol_${stamp}`;

    let aliceToken, aliceId;
    let bobToken, bobId;
    let carolToken, carolId;

    const createdTweetIds = [];

    try {
        // ----------------------------------------------------
        // Setup: Register Test Users
        // ----------------------------------------------------
        console.log("Setup: Registering test users & populating posts...");
        const regA = await makeRequest("/auth/register", "POST", {
            username: aliceUname,
            email: `${aliceUname}@test.com`,
            password: "password123",
        });
        aliceToken = regA.data.accessToken;
        aliceId = regA.data.user.id;

        const regB = await makeRequest("/auth/register", "POST", {
            username: bobUname,
            email: `${bobUname}@test.com`,
            password: "password123",
        });
        bobToken = regB.data.accessToken;
        bobId = regB.data.user.id;

        const regC = await makeRequest("/auth/register", "POST", {
            username: carolUname,
            email: `${carolUname}@test.com`,
            password: "password123",
        });
        carolToken = regC.data.accessToken;
        carolId = regC.data.user.id;

        assert(aliceToken && bobToken && carolToken, "All 3 test users registered successfully");

        // Create 25 posts for Alice with #tech and #pagination
        for (let i = 1; i <= 25; i++) {
            const num = String(i).padStart(2, "0");
            const res = await makeRequest(
                "/tweets",
                "POST",
                { content: `Alice Paginated Thought #${num} #tech #page${num}` },
                aliceToken
            );
            if (res.data?.tweet?.id) {
                createdTweetIds.push(res.data.tweet.id);
            }
        }

        // Create 5 posts for Bob with #gaming
        for (let i = 1; i <= 5; i++) {
            const res = await makeRequest(
                "/tweets",
                "POST",
                { content: `Bob Gaming Update #${i} #gaming #tech` },
                bobToken
            );
            if (res.data?.tweet?.id) {
                createdTweetIds.push(res.data.tweet.id);
            }
        }

        assert(createdTweetIds.length === 30, "Created 30 test posts (25 Alice, 5 Bob)");

        // ----------------------------------------------------
        // 1. Page-by-Page Numbered Pagination & Mutually Exclusive Sets
        // ----------------------------------------------------
        console.log("\n1. Testing Page-by-Page Pagination & Result Isolation...");

        // Page 1
        const p1Res = await makeRequest("/tweets/feed?type=for-you&limit=10&page=1");
        assert(p1Res.status === 200, "GET /tweets/feed?page=1 returns 200 OK");
        assert(p1Res.data.tweets.length === 10, "Page 1 contains exactly 10 tweets");
        assert(p1Res.data.pagination.page === 1, "Pagination reports page: 1");
        assert(p1Res.data.pagination.limit === 10, "Pagination reports limit: 10");
        assert(p1Res.data.pagination.offset === 0, "Pagination reports offset: 0");
        assert(p1Res.data.pagination.totalCount >= 30, `Pagination reports totalCount: ${p1Res.data.pagination.totalCount} (>= 30)`);
        assert(p1Res.data.pagination.hasPrevPage === false, "Page 1 hasPrevPage is false");
        assert(p1Res.data.pagination.hasNextPage === true, "Page 1 hasNextPage is true");

        const p1Ids = p1Res.data.tweets.map((t) => t.id);

        // Page 2
        const p2Res = await makeRequest("/tweets/feed?type=for-you&limit=10&page=2");
        assert(p2Res.status === 200, "GET /tweets/feed?page=2 returns 200 OK");
        assert(p2Res.data.tweets.length === 10, "Page 2 contains exactly 10 tweets");
        assert(p2Res.data.pagination.page === 2, "Pagination reports page: 2");
        assert(p2Res.data.pagination.offset === 10, "Pagination reports offset: 10");
        assert(p2Res.data.pagination.hasPrevPage === true, "Page 2 hasPrevPage is true");
        assert(p2Res.data.pagination.hasNextPage === true, "Page 2 hasNextPage is true");

        const p2Ids = p2Res.data.tweets.map((t) => t.id);

        // Page 3
        const p3Res = await makeRequest("/tweets/feed?type=for-you&limit=10&page=3");
        assert(p3Res.status === 200, "GET /tweets/feed?page=3 returns 200 OK");
        assert(p3Res.data.tweets.length === 10, "Page 3 contains exactly 10 tweets");
        assert(p3Res.data.pagination.page === 3, "Pagination reports page: 3");
        assert(p3Res.data.pagination.offset === 20, "Pagination reports offset: 20");
        assert(p3Res.data.pagination.hasPrevPage === true, "Page 3 hasPrevPage is true");

        const p3Ids = p3Res.data.tweets.map((t) => t.id);

        // STRICT NON-CONCATENATION / MUTUAL EXCLUSIVITY CHECK
        const overlapP1P2 = p1Ids.filter((id) => p2Ids.includes(id));
        const overlapP2P3 = p2Ids.filter((id) => p3Ids.includes(id));
        const overlapP1P3 = p1Ids.filter((id) => p3Ids.includes(id));

        assert(overlapP1P2.length === 0, "Page 1 and Page 2 are 100% mutually exclusive (0 overlapping IDs)");
        assert(overlapP2P3.length === 0, "Page 2 and Page 3 are 100% mutually exclusive (0 overlapping IDs)");
        assert(overlapP1P3.length === 0, "Page 1 and Page 3 are 100% mutually exclusive (0 overlapping IDs)");
        assert(
            new Set([...p1Ids, ...p2Ids, ...p3Ids]).size === 30,
            "Navigating between pages replaces results; exactly 30 unique posts across 3 pages"
        );

        // Final Page
        const totalPages = p1Res.data.pagination.totalPages;
        const finalRes = await makeRequest(`/tweets/feed?type=for-you&limit=10&page=${totalPages}`);
        assert(finalRes.status === 200, `GET final page (${totalPages}) returns 200 OK`);
        assert(finalRes.data.pagination.hasNextPage === false, "Final page hasNextPage is false");
        assert(finalRes.data.pagination.hasPrevPage === true, "Final page hasPrevPage is true");

        // ----------------------------------------------------
        // 2. Boundary Values & Graceful Error Handling
        // ----------------------------------------------------
        console.log("\n2. Testing Boundary Values & Fallbacks...");

        // Invalid / Non-numeric page
        const nanPageRes = await makeRequest("/tweets/feed?type=for-you&limit=10&page=invalid");
        assert(nanPageRes.status === 200, "Non-numeric page query returns 200 OK");
        assert(nanPageRes.data.pagination.page === 1, "Non-numeric page safely falls back to page 1");

        // Zero / Negative page
        const zeroPageRes = await makeRequest("/tweets/feed?type=for-you&limit=10&page=-2");
        assert(zeroPageRes.status === 200, "Negative page query returns 200 OK");
        assert(zeroPageRes.data.pagination.page === 1, "Negative page safely clamped to page 1");

        // Out-of-bounds page (page > totalPages)
        const hugePageRes = await makeRequest("/tweets/feed?type=for-you&limit=10&page=99999");
        assert(hugePageRes.status === 200, "Out-of-bounds page query returns 200 OK");
        assert(hugePageRes.data.tweets.length === 0, "Out-of-bounds page returns empty tweets array");
        assert(hugePageRes.data.pagination.hasNextPage === false, "Out-of-bounds page hasNextPage is false");

        // Explicit offset support (backward compatibility)
        const offsetRes = await makeRequest("/tweets/feed?type=for-you&limit=10&offset=10");
        assert(offsetRes.status === 200, "GET with offset=10 returns 200 OK");
        assert(offsetRes.data.pagination.offset === 10, "Pagination reports offset: 10");
        assert(offsetRes.data.pagination.page === 2, "Pagination correctly derives page: 2 from offset");
        assert(offsetRes.data.pagination.hasMore === true, "Preserved backward compatible hasMore: true");

        // ----------------------------------------------------
        // 3. For You vs Following Feeds
        // ----------------------------------------------------
        console.log("\n3. Testing For You vs Following Feeds...");

        // Unauthenticated Following feed
        const unauthFollowing = await makeRequest("/tweets/feed?type=following");
        assert(unauthFollowing.status === 200, "Unauthenticated /tweets/feed?type=following returns 200 OK");
        assert(unauthFollowing.data.tweets.length === 0, "Unauthenticated user gets empty following feed");
        assert(unauthFollowing.data.pagination.totalCount === 0, "Unauthenticated following feed totalCount is 0");

        // Authenticated Carol (follows no one yet)
        const carolFollowingEmpty = await makeRequest("/tweets/feed?type=following", "GET", null, carolToken);
        assert(carolFollowingEmpty.status === 200, "Carol (following no one) returns 200 OK");
        assert(carolFollowingEmpty.data.tweets.length === 0, "Carol has 0 tweets in following feed");

        // Carol follows Bob
        const followRes = await makeRequest(`/users/follow/${bobId}`, "POST", null, carolToken);
        assert(followRes.status === 200, "Carol follows Bob successfully");

        // Carol's Following feed should now contain Bob's 5 tweets, and ZERO of Alice's 25 tweets
        const carolFollowing = await makeRequest("/tweets/feed?type=following", "GET", null, carolToken);
        assert(carolFollowing.status === 200, "Carol Following feed returns 200 OK");
        assert(carolFollowing.data.tweets.length === 5, "Carol sees exactly Bob's 5 posts");
        assert(
            carolFollowing.data.tweets.every((t) => t.author.id === bobId),
            "Every post in Carol's following feed belongs to followed user Bob"
        );
        assert(
            carolFollowing.data.tweets.some((t) => t.author.id === aliceId) === false,
            "None of unfollowed Alice's posts appear in Carol's following feed"
        );

        // ----------------------------------------------------
        // 4. Two-Way Block Isolation on Timeline Feed
        // ----------------------------------------------------
        console.log("\n4. Testing Two-Way Block Enforcement on Timeline Feed...");

        // Alice blocks Bob
        const blockRes = await makeRequest(`/users/block/${bobId}`, "POST", null, aliceToken);
        assert(blockRes.status === 200, "Alice blocks Bob successfully");

        // Alice's feed must not contain any of Bob's posts
        const aliceFeed = await makeRequest("/tweets/feed?type=for-you&limit=50", "GET", null, aliceToken);
        assert(
            aliceFeed.data.tweets.every((t) => t.author.id !== bobId),
            "Blocker (Alice) sees 0 posts from blocked user (Bob) on feed"
        );

        // Bob's feed must not contain any of Alice's posts
        const bobFeed = await makeRequest("/tweets/feed?type=for-you&limit=50", "GET", null, bobToken);
        assert(
            bobFeed.data.tweets.every((t) => t.author.id !== aliceId),
            "Blocked user (Bob) sees 0 posts from blocker (Alice) on feed"
        );

        // Carol (unrelated) can still see both Alice and Bob
        const carolFeed = await makeRequest("/tweets/feed?type=for-you&limit=50", "GET", null, carolToken);
        const carolSeesAlice = carolFeed.data.tweets.some((t) => t.author.id === aliceId);
        const carolSeesBob = carolFeed.data.tweets.some((t) => t.author.id === bobId);
        assert(carolSeesAlice && carolSeesBob, "Unrelated user (Carol) can view posts from both");

        // ----------------------------------------------------
        // 5. Hashtag Queries & Search with Numbered Pagination
        // ----------------------------------------------------
        console.log("\n5. Testing Hashtag Discovery & Pagination...");

        const tagRes = await makeRequest("/tweets/hashtag/tech?limit=10&page=1");
        assert(tagRes.status === 200, "GET /tweets/hashtag/tech?page=1 returns 200 OK");
        assert(tagRes.data.tweets.length === 10, "Hashtag feed returns 10 items for page 1");
        assert(tagRes.data.pagination.page === 1, "Hashtag pagination reports page: 1");
        assert(tagRes.data.pagination.totalCount >= 25, "Hashtag totalCount accurately reported");

        const tagP2Res = await makeRequest("/tweets/hashtag/tech?limit=10&page=2");
        assert(tagP2Res.status === 200, "GET /tweets/hashtag/tech?page=2 returns 200 OK");
        assert(tagP2Res.data.pagination.page === 2, "Hashtag page 2 reports page: 2");

        const tagP1Ids = tagRes.data.tweets.map((t) => t.id);
        const tagP2Ids = tagP2Res.data.tweets.map((t) => t.id);
        const tagOverlap = tagP1Ids.filter((id) => tagP2Ids.includes(id));
        assert(tagOverlap.length === 0, "Hashtag feed pages are strictly mutually exclusive");

        // Non-existent hashtag
        const emptyTagRes = await makeRequest("/tweets/hashtag/nonexistenttag9999");
        assert(emptyTagRes.status === 200, "Non-existent hashtag returns 200 OK");
        assert(emptyTagRes.data.tweets.length === 0, "Non-existent hashtag returns empty tweets array");
        assert(emptyTagRes.data.pagination.totalCount === 0, "Non-existent hashtag reports totalCount: 0");

        // ----------------------------------------------------
        // 6. Trending Topics Endpoint
        // ----------------------------------------------------
        console.log("\n6. Testing Trending Hashtags Endpoint...");

        const trendsRes = await makeRequest("/tweets/trending?limit=10");
        assert(trendsRes.status === 200, "GET /tweets/trending returns 200 OK");
        assert(Array.isArray(trendsRes.data.trends), "Trending response contains trends array");
        assert(trendsRes.data.trends.length > 0, "At least 1 trending topic returned");

        const techTrend = trendsRes.data.trends.find((t) => t.tag === "tech");
        assert(Boolean(techTrend), "Trending list includes '#tech'");
        assert(techTrend.tweetCount >= 25, `Trending '#tech' reports count ${techTrend.tweetCount} (>= 25)`);

        // Verify descending order
        let isSortedDesc = true;
        for (let i = 0; i < trendsRes.data.trends.length - 1; i++) {
            if (trendsRes.data.trends[i].tweetCount < trendsRes.data.trends[i + 1].tweetCount) {
                isSortedDesc = false;
                break;
            }
        }
        assert(isSortedDesc, "Trending topics are strictly sorted descending by tweetCount");

        // ----------------------------------------------------
        // 7. User Search Block Enforcement
        // ----------------------------------------------------
        console.log("\n7. Testing User Search Block Enforcement...");

        const searchBob = await makeRequest(`/users/search?q=${bobUname}`, "GET", null, aliceToken);
        assert(searchBob.status === 200, "Search returns 200 OK");
        assert(
            searchBob.data.users.every((u) => u.username !== bobUname),
            "Blocked user (Bob) is excluded from blocker (Alice)'s search results"
        );

    } catch (err) {
        console.error("Test execution failed with error:", err);
        failed++;
    } finally {
        console.log("\n8. Cleaning up test records from database...");
        try {
            await prisma.user.deleteMany({
                where: {
                    username: { in: [aliceUname, bobUname, carolUname] },
                },
            });
            console.log("  ✓ Database teardown complete - zero test remnants.");
        } catch (cleanupErr) {
            console.error("Cleanup error:", cleanupErr);
        }

        if (httpServer) {
            httpServer.close();
            console.log("  ✓ Test HTTP server closed.");
        }
    }

    console.log("\n=======================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (${passed + failed} total)`);
    console.log("=======================================================\n");

    if (failed > 0) {
        process.exit(1);
    }
};

runSuite();
