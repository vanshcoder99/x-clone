import crypto from "crypto";

process.env.PORT = "5066";
process.env.NODE_ENV = "test";
process.env.CLOUDINARY_CLOUD_NAME = "socialsphere_cloud";
process.env.CLOUDINARY_API_KEY = "test_api_key_12345";
process.env.CLOUDINARY_API_SECRET = "test_secret_67890";

const { httpServer, prisma } = await import("./dist/index.js");

const BASE_URL = "http://localhost:5066/api";

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
    console.log("   SOCIALSPHERE PHASE 9 CLOUDINARY & MEDIA TEST SUITE  ");
    console.log("=======================================================\n");

    const stamp = Date.now().toString().slice(-6);
    const aliceUname = `med_alice_${stamp}`;
    const bobUname = `med_bob_${stamp}`;

    let aliceToken, aliceId;
    let bobToken, bobId;

    try {
        // ----------------------------------------------------
        // Setup: Create test users Alice and Bob
        // ----------------------------------------------------
        console.log("0. Setting up test users...");
        const aliceReg = await makeRequest("/auth/register", "POST", {
            username: aliceUname,
            email: `${aliceUname}@test.com`,
            password: "Password123!",
        });
        assert(aliceReg.status === 201, "Alice registered successfully");
        aliceToken = aliceReg.data?.accessToken;
        aliceId = aliceReg.data?.user?.id;

        const bobReg = await makeRequest("/auth/register", "POST", {
            username: bobUname,
            email: `${bobUname}@test.com`,
            password: "Password123!",
        });
        assert(bobReg.status === 201, "Bob registered successfully");
        bobToken = bobReg.data?.accessToken;
        bobId = bobReg.data?.user?.id;

        // ----------------------------------------------------
        // 1. Media Upload Signing Endpoint Security & Validation
        // ----------------------------------------------------
        console.log("\n1. Testing Media Upload Signing Endpoint (/api/media/sign-upload)...");

        // 1.1 Unauthenticated request returns 401
        const unauthSign = await makeRequest("/media/sign-upload", "POST", { resourceType: "image" });
        assert(unauthSign.status === 401, "Unauthenticated /api/media/sign-upload returns 401 Unauthorized");

        // 1.2 Invalid resourceType returns 400
        const badResource = await makeRequest("/media/sign-upload", "POST", { resourceType: "audio" }, aliceToken);
        assert(badResource.status === 400, "Invalid resourceType 'audio' rejected with 400 Bad Request");

        // 1.3 Invalid image format returns 400
        const badImgFormat = await makeRequest("/media/sign-upload", "POST", { resourceType: "image", format: "exe" }, aliceToken);
        assert(badImgFormat.status === 400, "Invalid image format 'exe' rejected with 400 Bad Request");

        // 1.4 Invalid video format returns 400
        const badVidFormat = await makeRequest("/media/sign-upload", "POST", { resourceType: "video", format: "mkv" }, aliceToken);
        assert(badVidFormat.status === 400, "Invalid video format 'mkv' rejected with 400 Bad Request");

        // 1.5 Valid image upload signing
        const aliceSignImage = await makeRequest("/media/sign-upload", "POST", { resourceType: "image", format: "png" }, aliceToken);
        assert(aliceSignImage.status === 200, "Valid image signing returns 200 OK");
        assert(aliceSignImage.data?.signature?.length === 40, "Cryptographic SHA-1 signature returned (40-hex string)");
        assert(aliceSignImage.data?.apiKey === "test_api_key_12345", "API Key matches server configuration");
        assert(aliceSignImage.data?.cloudName === "socialsphere_cloud", "Cloud Name matches server configuration");
        assert(
            aliceSignImage.data?.folder === `socialsphere/users/${aliceId}/media`,
            "Folder scoped strictly to authenticated user's private media directory"
        );
        assert(
            aliceSignImage.data?.publicId?.startsWith(`socialsphere/users/${aliceId}/media/`),
            "Server-controlled publicId generated inside user's folder"
        );
        assert(aliceSignImage.data?.maxFileSize === 10 * 1024 * 1024, "Image max file size is 10MB");

        // Verify signature correctness
        const expectedSerialized = `folder=${aliceSignImage.data.folder}&public_id=${aliceSignImage.data.publicId}&timestamp=${aliceSignImage.data.timestamp}${process.env.CLOUDINARY_API_SECRET}`;
        const expectedSig = crypto.createHash("sha1").update(expectedSerialized).digest("hex");
        assert(aliceSignImage.data.signature === expectedSig, "Signature matches Cloudinary alphabetical sorting standard");

        // Verify PendingUpload database record was created
        const pendingRecord = await prisma.pendingUpload.findUnique({
            where: { publicId: aliceSignImage.data.publicId },
        });
        assert(pendingRecord !== null, "PendingUpload record created in PostgreSQL");
        assert(pendingRecord?.userId === aliceId, "PendingUpload is linked to Alice");
        assert(pendingRecord?.status === "PENDING", "PendingUpload status initialized to 'PENDING'");
        assert(pendingRecord?.resourceType === "image", "PendingUpload resourceType is 'image'");

        // 1.6 Valid video upload signing
        const aliceSignVideo = await makeRequest("/media/sign-upload", "POST", { resourceType: "video", format: "mp4" }, aliceToken);
        assert(aliceSignVideo.status === 200, "Valid video signing returns 200 OK");
        assert(aliceSignVideo.data?.resourceType === "video", "Video resourceType is 'video'");
        assert(aliceSignVideo.data?.maxFileSize === 50 * 1024 * 1024, "Video max file size is 50MB");

        // ----------------------------------------------------
        // 2. Asset Ownership & Security Enforcement
        // ----------------------------------------------------
        console.log("\n2. Testing Asset Ownership and Anti-Spoofing Enforcement...");

        // 2.1 Cross-user spoofing: Bob attempts to attach Alice's signed publicId
        const bobSpoof = await makeRequest(
            "/tweets",
            "POST",
            {
                content: "Bob trying to hijack Alice's media",
                media: [
                    {
                        url: "https://res.cloudinary.com/socialsphere_cloud/image/upload/sample.jpg",
                        publicId: aliceSignImage.data.publicId,
                        mediaType: "IMAGE",
                    },
                ],
            },
            bobToken
        );
        assert(bobSpoof.status === 403, "Bob rejected with 403 Forbidden when attaching Alice's publicId");

        // 2.2 Forged publicId not in PendingUpload
        const forgedPublicId = await makeRequest(
            "/tweets",
            "POST",
            {
                content: "Alice using forged publicId",
                media: [
                    {
                        url: "https://res.cloudinary.com/socialsphere_cloud/image/upload/sample.jpg",
                        publicId: "socialsphere/users/fake_id/media/12345",
                        mediaType: "IMAGE",
                    },
                ],
            },
            aliceToken
        );
        assert(forgedPublicId.status === 403, "Forged publicId rejected with 403 Forbidden");

        // 2.3 Expired upload session
        const expiredSign = await makeRequest("/media/sign-upload", "POST", { resourceType: "image", format: "jpg" }, aliceToken);
        // Artificially expire the record in the database
        await prisma.pendingUpload.update({
            where: { publicId: expiredSign.data.publicId },
            data: { expiresAt: new Date(Date.now() - 60 * 1000) },
        });

        const expiredAttach = await makeRequest(
            "/tweets",
            "POST",
            {
                content: "Attempting to attach expired upload",
                media: [
                    {
                        url: "https://res.cloudinary.com/socialsphere_cloud/image/upload/expired.jpg",
                        publicId: expiredSign.data.publicId,
                        mediaType: "IMAGE",
                    },
                ],
            },
            aliceToken
        );
        assert(expiredAttach.status === 403, "Expired media upload session rejected with 403 Forbidden");

        // 2.4 Max attachment limit (> 4 items)
        const excessiveMedia = await makeRequest(
            "/tweets",
            "POST",
            {
                content: "Exceeding attachment limit",
                media: [
                    { url: "https://example.com/1.jpg" },
                    { url: "https://example.com/2.jpg" },
                    { url: "https://example.com/3.jpg" },
                    { url: "https://example.com/4.jpg" },
                    { url: "https://example.com/5.jpg" },
                ],
            },
            aliceToken
        );
        assert(excessiveMedia.status === 400, "Attaching more than 4 media files rejected with 400 Bad Request");

        // ----------------------------------------------------
        // 3. Multi-Media Tweet Creation & Retrieval
        // ----------------------------------------------------
        console.log("\n3. Testing Multi-Media Tweet Creation and Retrieval...");

        // Prepare 3 valid media uploads for Alice
        const m1 = await makeRequest("/media/sign-upload", "POST", { resourceType: "image", format: "png" }, aliceToken);
        const m2 = await makeRequest("/media/sign-upload", "POST", { resourceType: "image", format: "webp" }, aliceToken);
        const m3 = await makeRequest("/media/sign-upload", "POST", { resourceType: "video", format: "mp4" }, aliceToken);

        const aliceMultiTweet = await makeRequest(
            "/tweets",
            "POST",
            {
                content: "Check out my multi-media post! #cloudinary #tech",
                media: [
                    {
                        url: "https://res.cloudinary.com/socialsphere_cloud/image/upload/img1.png",
                        publicId: m1.data.publicId,
                        mediaType: "IMAGE",
                    },
                    {
                        url: "https://res.cloudinary.com/socialsphere_cloud/image/upload/img2.webp",
                        publicId: m2.data.publicId,
                        mediaType: "IMAGE",
                    },
                    {
                        url: "https://res.cloudinary.com/socialsphere_cloud/video/upload/vid3.mp4",
                        publicId: m3.data.publicId,
                        mediaType: "VIDEO",
                    },
                ],
            },
            aliceToken
        );

        assert(aliceMultiTweet.status === 201, "Multi-media tweet created successfully (201 Created)");
        const createdTweet = aliceMultiTweet.data?.tweet;
        const tweetId = createdTweet?.id;

        assert(createdTweet?.media?.length === 3, "Created tweet response contains 3 media attachments");
        assert(createdTweet?.media[0]?.mediaType === "IMAGE", "First attachment is IMAGE");
        assert(createdTweet?.media[1]?.mediaType === "IMAGE", "Second attachment is IMAGE");
        assert(createdTweet?.media[2]?.mediaType === "VIDEO", "Third attachment is VIDEO");
        assert(createdTweet?.media[0]?.order === 0, "First attachment order is 0");
        assert(createdTweet?.media[1]?.order === 1, "Second attachment order is 1");
        assert(createdTweet?.media[2]?.order === 2, "Third attachment order is 2");
        assert(createdTweet?.mediaUrl === "https://res.cloudinary.com/socialsphere_cloud/image/upload/img1.png", "Primary mediaUrl matches first media item");

        // Verify PendingUpload status transitioned to CONSUMED
        const consumed1 = await prisma.pendingUpload.findUnique({ where: { publicId: m1.data.publicId } });
        const consumed2 = await prisma.pendingUpload.findUnique({ where: { publicId: m2.data.publicId } });
        const consumed3 = await prisma.pendingUpload.findUnique({ where: { publicId: m3.data.publicId } });
        assert(consumed1?.status === "CONSUMED", "First PendingUpload status transitioned to 'CONSUMED'");
        assert(consumed2?.status === "CONSUMED", "Second PendingUpload status transitioned to 'CONSUMED'");
        assert(consumed3?.status === "CONSUMED", "Third PendingUpload status transitioned to 'CONSUMED'");

        // 3.1 Verify reusing already-consumed publicId is rejected
        const reuseConsumed = await makeRequest(
            "/tweets",
            "POST",
            {
                content: "Attempting to reuse consumed upload",
                media: [
                    {
                        url: "https://res.cloudinary.com/socialsphere_cloud/image/upload/img1.png",
                        publicId: m1.data.publicId,
                        mediaType: "IMAGE",
                    },
                ],
            },
            aliceToken
        );
        assert(reuseConsumed.status === 403, "Reusing already-consumed publicId rejected with 403 Forbidden");

        // 3.2 Fetch single tweet thread via GET /api/tweets/:id
        const getThread = await makeRequest(`/tweets/${tweetId}`, "GET", null, aliceToken);
        assert(getThread.status === 200, "GET /api/tweets/:id returns 200 OK");
        assert(getThread.data?.tweet?.media?.length === 3, "Thread response preserves all 3 media attachments");

        // 3.3 Fetch timeline feed
        const getFeed = await makeRequest("/tweets/feed?page=1&limit=10", "GET", null, aliceToken);
        assert(getFeed.status === 200, "GET /api/tweets/feed returns 200 OK");
        const feedTweet = getFeed.data?.tweets?.find((t) => t.id === tweetId);
        assert(feedTweet?.media?.length === 3, "Timeline feed includes media attachments array");

        // 3.4 Fetch user's tweets feed
        const getUserFeed = await makeRequest(`/tweets/user/${aliceUname}?page=1&limit=10`, "GET", null, aliceToken);
        assert(getUserFeed.status === 200, "GET /api/tweets/user/:username returns 200 OK");
        const userTweet = getUserFeed.data?.tweets?.find((t) => t.id === tweetId);
        assert(userTweet?.media?.length === 3, "User profile feed includes media attachments array");

        // 3.5 Fetch tweets by hashtag
        const getTagFeed = await makeRequest("/tweets/hashtag/cloudinary?page=1&limit=10", "GET", null, aliceToken);
        assert(getTagFeed.status === 200, "GET /api/tweets/hashtag/:tag returns 200 OK");
        const tagTweet = getTagFeed.data?.tweets?.find((t) => t.id === tweetId);
        assert(tagTweet?.media?.length === 3, "Hashtag search feed includes media attachments array");

        // ----------------------------------------------------
        // 4. Threaded Replies with Multi-Media
        // ----------------------------------------------------
        console.log("\n4. Testing Threaded Replies with Media Attachments...");

        const bobMediaSign = await makeRequest("/media/sign-upload", "POST", { resourceType: "image", format: "jpg" }, bobToken);
        const replyRes = await makeRequest(
            `/tweets/${tweetId}/reply`,
            "POST",
            {
                content: "Awesome post Alice! Replying with my attachment.",
                media: [
                    {
                        url: "https://res.cloudinary.com/socialsphere_cloud/image/upload/bob_reply.jpg",
                        publicId: bobMediaSign.data.publicId,
                        mediaType: "IMAGE",
                    },
                ],
            },
            bobToken
        );

        assert(replyRes.status === 201, "Reply with media created successfully (201 Created)");
        assert(replyRes.data?.reply?.media?.length === 1, "Reply contains media attachment array");
        assert(replyRes.data?.reply?.media[0]?.url === "https://res.cloudinary.com/socialsphere_cloud/image/upload/bob_reply.jpg", "Reply media URL matches");

        // Verify thread endpoint returns reply with media
        const updatedThread = await makeRequest(`/tweets/${tweetId}`, "GET", null, aliceToken);
        const threadReply = updatedThread.data?.tweet?.replies?.find((r) => r.id === replyRes.data.reply.id);
        assert(threadReply?.media?.length === 1, "Thread details include reply with its media attachment");

        // ----------------------------------------------------
        // 5. Legacy Single-Media Backward Compatibility
        // ----------------------------------------------------
        console.log("\n5. Testing Legacy Single-Media Tweet Compatibility...");

        const legacyTweet = await makeRequest(
            "/tweets",
            "POST",
            {
                content: "Legacy single-media tweet test #legacy",
                mediaUrl: "https://example.com/legacy_image.jpg",
                mediaType: "IMAGE",
            },
            aliceToken
        );

        assert(legacyTweet.status === 201, "Legacy single-media tweet created successfully");
        assert(legacyTweet.data?.tweet?.mediaUrl === "https://example.com/legacy_image.jpg", "Legacy mediaUrl preserved");
        assert(legacyTweet.data?.tweet?.media?.length === 1, "Synthesized media array contains 1 item");
        assert(legacyTweet.data?.tweet?.media[0]?.url === "https://example.com/legacy_image.jpg", "Synthesized media URL matches legacy mediaUrl");

        // ----------------------------------------------------
        // 6. Tweet Deletion and Cloudinary Asset Cleanup
        // ----------------------------------------------------
        console.log("\n6. Testing Tweet Deletion and Asset Cleanup...");

        // 6.1 Unauthorized user cannot delete tweet
        const unauthDel = await makeRequest(`/tweets/${tweetId}`, "DELETE", null, bobToken);
        assert(unauthDel.status === 403, "Bob rejected with 403 Forbidden when deleting Alice's tweet");

        // 6.2 Author deletes multi-media tweet
        const authDel = await makeRequest(`/tweets/${tweetId}`, "DELETE", null, aliceToken);
        assert(authDel.status === 200, "Alice deletes her multi-media tweet successfully (200 OK)");

        // 6.3 Verify database records deleted
        const dbTweet = await prisma.tweet.findUnique({ where: { id: tweetId } });
        assert(dbTweet === null, "Tweet deleted from PostgreSQL");

        const dbMedia = await prisma.tweetMedia.findMany({ where: { tweetId } });
        assert(dbMedia.length === 0, "TweetMedia child records cascade deleted");

        // 6.4 Verify child reply disassociated cleanly without FK failure
        const dbReply = await prisma.tweet.findUnique({ where: { id: replyRes.data.reply.id } });
        assert(dbReply !== null, "Child reply remains preserved");
        assert(dbReply?.parentTweetId === null, "Child reply parentTweetId disassociated to null");

    } catch (err) {
        console.error("Test execution encountered an error:", err);
        failed++;
    } finally {
        console.log("\n7. Database teardown & test server shutdown...");
        try {
            await prisma.user.deleteMany({
                where: {
                    username: { in: [aliceUname, bobUname] },
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

