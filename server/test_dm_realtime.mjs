import { io as ioClient } from "socket.io-client";

process.env.PORT = "5065";
process.env.NODE_ENV = "test";

const { httpServer, io, prisma } = await import("./dist/index.js");

const BASE_URL = "http://localhost:5065/api";
const SOCKET_URL = "http://localhost:5065";

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
    console.log("   SOCIALSPHERE PHASE 8 REAL-TIME & DM TEST SUITE      ");
    console.log("=======================================================\n");

    const stamp = Date.now().toString().slice(-6);
    const aliceUname = `dm_alice_${stamp}`;
    const bobUname = `dm_bob_${stamp}`;
    const eveUname = `dm_eve_${stamp}`;

    let aliceToken, aliceId;
    let bobToken, bobId;
    let eveToken, eveId;

    const clientSockets = [];

    const createSocket = (token = null) => {
        const sock = ioClient(SOCKET_URL, {
            auth: { token: token || undefined },
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
        });
        clientSockets.push(sock);
        return sock;
    };

    try {
        // ----------------------------------------------------
        // Setup: Register Test Users
        // ----------------------------------------------------
        console.log("Setup: Registering test accounts (Alice, Bob, Eve)...");
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

        const regE = await makeRequest("/auth/register", "POST", {
            username: eveUname,
            email: `${eveUname}@test.com`,
            password: "password123",
        });
        eveToken = regE.data.accessToken;
        eveId = regE.data.user.id;

        assert(aliceToken && bobToken && eveToken, "Registered Alice, Bob, and Eve successfully");

        // ----------------------------------------------------
        // 1. Connection & Authentication Security
        // ----------------------------------------------------
        console.log("\n1. Testing Socket.IO Connection & Authentication Security...");

        // Guest socket connects unauthenticated
        const guestSock = createSocket(null);
        const guestConnected = await new Promise((resolve) => {
            guestSock.on("connect", () => resolve(true));
            guestSock.on("connect_error", () => resolve(false));
            setTimeout(() => resolve(false), 2000);
        });
        assert(guestConnected, "Guest socket connects without token for public events");

        // Invalid token handshake rejected
        const invalidSock = ioClient(SOCKET_URL, {
            auth: { token: "forged.or.invalid.jwt.token" },
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
        });
        clientSockets.push(invalidSock);
        const handshakeRejected = await new Promise((resolve) => {
            invalidSock.on("connect", () => resolve(false));
            invalidSock.on("connect_error", (err) => {
                resolve(err.message.includes("Authentication error"));
            });
            setTimeout(() => resolve(false), 2000);
        });
        assert(handshakeRejected, "Handshake with invalid/forged JWT is rejected with Authentication error");

        // Valid token authenticates and joins user room
        const aliceSock = createSocket(aliceToken);
        const aliceConnected = await new Promise((resolve) => {
            aliceSock.on("connect", () => resolve(true));
            aliceSock.on("connect_error", () => resolve(false));
            setTimeout(() => resolve(false), 2000);
        });
        assert(aliceConnected, "Alice connects and authenticates via valid JWT handshake");

        // Late authentication event
        const lateSock = createSocket(null);
        await new Promise((resolve) => lateSock.on("connect", resolve));
        lateSock.emit("authenticate", bobToken);
        const lateAuthSuccess = await new Promise((resolve) => {
            lateSock.on("authenticated", (data) => resolve(data.userId === bobId));
            lateSock.on("auth_error", () => resolve(false));
            setTimeout(() => resolve(false), 2000);
        });
        assert(lateAuthSuccess, "Late socket authentication with valid token succeeds and joins permitted room");

        // Late auth with bad token fails
        lateSock.emit("authenticate", "bad.token");
        const lateAuthFailed = await new Promise((resolve) => {
            lateSock.on("auth_error", (data) => resolve(Boolean(data.message)));
            setTimeout(() => resolve(false), 2000);
        });
        assert(lateAuthFailed, "Late socket authentication with bad token rejected with auth_error");

        // ----------------------------------------------------
        // 2. Conversation Access Control & Idempotency
        // ----------------------------------------------------
        console.log("\n2. Testing Conversation Access Control & Idempotency...");

        // Validation errors
        const noRecip = await makeRequest("/messages/conversations", "POST", {}, aliceToken);
        assert(noRecip.status === 400, "Missing recipientId rejected with 400 Bad Request");

        const selfRecip = await makeRequest("/messages/conversations", "POST", { recipientId: aliceId }, aliceToken);
        assert(selfRecip.status === 400, "Self-conversation rejected with 400 Bad Request");

        const nonExistent = await makeRequest("/messages/conversations", "POST", { recipientId: "nonexistent-id-999" }, aliceToken);
        assert(nonExistent.status === 404, "Non-existent recipient returns 404 Not Found");

        // Valid creation
        const createConv = await makeRequest("/messages/conversations", "POST", { recipientId: bobId }, aliceToken);
        assert(createConv.status === 201, "Alice creates conversation with Bob returns 201 Created");
        const convId = createConv.data.conversation?.id;
        assert(Boolean(convId), `Conversation created with ID: ${convId}`);

        // Idempotency: repeating request returns 200 with same conversation ID
        const repeatConv = await makeRequest("/messages/conversations", "POST", { recipientId: bobId }, aliceToken);
        assert(repeatConv.status === 200, "Duplicate conversation creation returns 200 OK idempotently");
        assert(repeatConv.data.conversation?.id === convId, "Returned existing conversation ID matches original");

        // Bob requests conversation with Alice - returns same conversation ID
        const bobGetConv = await makeRequest("/messages/conversations", "POST", { recipientId: aliceId }, bobToken);
        assert(bobGetConv.status === 200, "Bob gets conversation with Alice returns same conversation ID");
        assert(bobGetConv.data.conversation?.id === convId, "Conversation is symmetric between participants");

        // Unauthorized access: Eve attempts to read messages in Alice/Bob conversation
        const eveRead = await makeRequest(`/messages/conversations/${convId}/messages`, "GET", null, eveToken);
        assert(eveRead.status === 403, "Non-participant (Eve) reading messages is rejected with 403 Forbidden");

        // Unauthorized send: Eve attempts to send message in Alice/Bob conversation
        const eveSend = await makeRequest(`/messages/conversations/${convId}/messages`, "POST", { content: "Eve snooping" }, eveToken);
        assert(eveSend.status === 403, "Non-participant (Eve) sending message is rejected with 403 Forbidden");

        // Unauthorized socket join: Eve tries to join conv room
        const eveSock = createSocket(eveToken);
        await new Promise((resolve) => eveSock.on("connect", resolve));
        eveSock.emit("join_conversation", convId);
        const eveJoinDenied = await new Promise((resolve) => {
            eveSock.on("auth_error", (data) => resolve(data.message.includes("Unauthorized")));
            eveSock.on("joined_conversation", () => resolve(false));
            setTimeout(() => resolve(false), 2000);
        });
        assert(eveJoinDenied, "Non-participant socket joining conversation room receives auth_error");

        // ----------------------------------------------------
        // 3. Two-User Live Direct Messaging & Persistence
        // ----------------------------------------------------
        console.log("\n3. Testing Two-User Live Message Delivery & Persistence...");

        const bobSock = createSocket(bobToken);
        await new Promise((resolve) => bobSock.on("connect", resolve));

        // Bob joins authorized conversation room
        bobSock.emit("join_conversation", convId);
        const bobJoined = await new Promise((resolve) => {
            bobSock.on("joined_conversation", (data) => resolve(data.conversationId === convId));
            setTimeout(() => resolve(false), 2000);
        });
        assert(bobJoined, "Bob authorized socket joins conversation room successfully");

        // Message validation
        const emptyMsg = await makeRequest(`/messages/conversations/${convId}/messages`, "POST", { content: "   " }, aliceToken);
        assert(emptyMsg.status === 400, "Empty/whitespace message content rejected with 400");

        const longMsg = await makeRequest(`/messages/conversations/${convId}/messages`, "POST", { content: "X".repeat(10001) }, aliceToken);
        assert(longMsg.status === 400, "Message exceeding 10,000 characters rejected with 400");

        // Set up real-time socket listeners for Bob
        let receivedRoomMsg = null;
        let receivedUnreadAlert = null;
        bobSock.on("message:new", (msg) => {
            receivedRoomMsg = msg;
        });
        bobSock.on("message:unread", (data) => {
            receivedUnreadAlert = data;
        });

        // Set up listener for Eve to verify room isolation
        let eveReceivedAny = false;
        eveSock.on("message:new", () => { eveReceivedAny = true; });
        eveSock.on("message:unread", () => { eveReceivedAny = true; });

        // Alice sends valid message
        const testContent = "Hello Bob! Testing real-time direct messaging delivery 🚀";
        const sendRes = await makeRequest(
            `/messages/conversations/${convId}/messages`,
            "POST",
            { content: testContent },
            aliceToken
        );
        assert(sendRes.status === 201, "Alice posts message returns 201 Created");
        const msgId = sendRes.data.message?.id;
        assert(Boolean(msgId), `Message ID: ${msgId} created`);

        // Wait for real-time delivery
        await new Promise((resolve) => setTimeout(resolve, 800));

        assert(receivedRoomMsg !== null, "Bob received real-time 'message:new' event in conversation room");
        assert(receivedRoomMsg?.content === testContent, "Received message content matches sent content");
        assert(receivedRoomMsg?.sender?.id === aliceId, "Received message sender identity verified as Alice");
        assert(receivedUnreadAlert !== null, "Bob received 'message:unread' notification in personal room");
        assert(eveReceivedAny === false, "Zero message leakage to unauthorized non-participant Eve");

        // Verify DB Persistence
        if (msgId) {
            const dbMsg = await prisma.message.findUnique({
                where: { id: msgId },
            });
            assert(dbMsg !== null && dbMsg.content === testContent, "Message successfully persisted in PostgreSQL database");
        } else {
            assert(false, "Message successfully persisted in PostgreSQL database (msgId was undefined)");
        }

        // ----------------------------------------------------
        // 4. Typing Indicators Scoping & Security
        // ----------------------------------------------------
        console.log("\n4. Testing Typing Indicator Delivery & Room Scoping...");

        let bobReceivedTyping = null;
        bobSock.on("user_typing", (data) => {
            bobReceivedTyping = data;
        });

        let eveReceivedTyping = false;
        eveSock.on("user_typing", () => {
            eveReceivedTyping = true;
        });

        // Alice joins conversation room
        aliceSock.emit("join_conversation", convId);
        await new Promise((resolve) => aliceSock.on("joined_conversation", resolve));

        // Alice emits typing
        aliceSock.emit("typing", { conversationId: convId, isTyping: true });
        await new Promise((resolve) => setTimeout(resolve, 600));

        assert(bobReceivedTyping !== null, "Bob received user_typing event from Alice in conversation room");
        assert(bobReceivedTyping?.isTyping === true, "user_typing payload reports isTyping: true");
        assert(bobReceivedTyping?.userId === aliceId, "user_typing reports correct sender ID (Alice)");
        assert(eveReceivedTyping === false, "Typing indicator strictly hidden from non-participant Eve");

        // Eve tries to forge typing event into Alice/Bob's conversation without authorization
        bobReceivedTyping = null;
        eveSock.emit("typing", { conversationId: convId, isTyping: true });
        await new Promise((resolve) => setTimeout(resolve, 600));
        assert(bobReceivedTyping === null, "Forged typing event from unauthorized user is blocked by server");

        // ----------------------------------------------------
        // 5. Read Receipts & Unread Count Auditing
        // ----------------------------------------------------
        console.log("\n5. Testing Read Receipts & Unread Auditing...");

        // Bob checks conversations list before reading
        const bobConvsBefore = await makeRequest("/messages/conversations", "GET", null, bobToken);
        assert(bobConvsBefore.status === 200, "Bob fetches conversation list returns 200 OK");
        assert(bobConvsBefore.data.totalUnreadCount >= 1, `Bob totalUnreadCount reports ${bobConvsBefore.data.totalUnreadCount} (>= 1)`);
        const bobConvItem = bobConvsBefore.data.conversations.find((c) => c.id === convId);
        assert(bobConvItem?.hasUnread === true, "Conversation item hasUnread is true for recipient");

        // Bob reads conversation messages via GET
        const bobReadRes = await makeRequest(`/messages/conversations/${convId}/messages`, "GET", null, bobToken);
        assert(bobReadRes.status === 200, "Bob retrieves messages returns 200 OK");
        assert(bobReadRes.data.messages.length >= 1, "Messages array contains the sent message");

        // Verify Bob's read status updated in DB
        const bobPart = await prisma.conversationParticipant.findUnique({
            where: { conversationId_userId: { conversationId: convId, userId: bobId } },
        });
        assert(bobPart?.hasReadLatest === true, "Bob's hasReadLatest flag updated to true in database");

        // Explicit read receipt PATCH endpoint
        const patchRead = await makeRequest(`/messages/conversations/${convId}/read`, "PATCH", null, bobToken);
        assert(patchRead.status === 200, "PATCH /conversations/:id/read returns 200 OK");

        // Non-participant Eve tries to mark conversation as read
        const evePatchRead = await makeRequest(`/messages/conversations/${convId}/read`, "PATCH", null, eveToken);
        assert(evePatchRead.status === 403, "Non-participant marking conversation read rejected with 403");

        // Bob checks conversations list after reading
        const bobConvsAfter = await makeRequest("/messages/conversations", "GET", null, bobToken);
        const bobConvItemAfter = bobConvsAfter.data.conversations.find((c) => c.id === convId);
        assert(bobConvItemAfter?.hasUnread === false, "Conversation item hasUnread is now false");
        assert(bobConvsAfter.data.totalUnreadCount === 0, "Bob totalUnreadCount is now 0 after reading");

        // ----------------------------------------------------
        // 6. Block Enforcement on Direct Messaging
        // ----------------------------------------------------
        console.log("\n6. Testing Block Rules Enforcement on Direct Messages...");

        // Alice blocks Bob
        const blockRes = await makeRequest(`/users/block/${bobId}`, "POST", null, aliceToken);
        assert(blockRes.status === 200, "Alice blocks Bob returns 200 OK");

        // Alice cannot send message to Bob
        const aliceBlockedSend = await makeRequest(
            `/messages/conversations/${convId}/messages`,
            "POST",
            { content: "Should fail" },
            aliceToken
        );
        assert(aliceBlockedSend.status === 403, "Blocker (Alice) cannot message blocked user (Bob) - 403 Forbidden");

        // Bob cannot send message to Alice
        const bobBlockedSend = await makeRequest(
            `/messages/conversations/${convId}/messages`,
            "POST",
            { content: "Should also fail" },
            bobToken
        );
        assert(bobBlockedSend.status === 403, "Blocked user (Bob) cannot message blocker (Alice) - 403 Forbidden");

        // Cannot initiate new conversation when blocked
        const blockedInitiate = await makeRequest("/messages/conversations", "POST", { recipientId: aliceId }, bobToken);
        assert(blockedInitiate.status === 403, "Cannot initiate conversation with user who blocked you - 403 Forbidden");

        // Alice unblocks Bob
        const unblockRes = await makeRequest(`/users/unblock/${bobId}`, "POST", null, aliceToken);
        assert(unblockRes.status === 200, "Alice unblocks Bob returns 200 OK");

        // Messaging restored after unblock
        const unblockSend = await makeRequest(
            `/messages/conversations/${convId}/messages`,
            "POST",
            { content: "We can chat again!" },
            aliceToken
        );
        assert(unblockSend.status === 201, "Messaging successfully restored after unblock (201 Created)");

        // ----------------------------------------------------
        // 7. Existing Real-Time Broadcasts Preservation
        // ----------------------------------------------------
        console.log("\n7. Testing Existing Real-Time Broadcasts Preservation...");

        let receivedTweetBroadcast = null;
        guestSock.on("tweet:new", (t) => {
            receivedTweetBroadcast = t;
        });

        // Alice posts a public tweet
        const tweetRes = await makeRequest("/tweets", "POST", { content: "Public broadcast test #realtime" }, aliceToken);
        assert(tweetRes.status === 201, "Public tweet created successfully");

        await new Promise((resolve) => setTimeout(resolve, 800));
        assert(receivedTweetBroadcast !== null, "Guest socket received 'tweet:new' broadcast event without interfering with DMs");

    } catch (err) {
        console.error("Test execution encountered an error:", err);
        failed++;
    } finally {
        console.log("\n8. Cleaning up test sockets and database records...");
        // Disconnect all test sockets
        for (const sock of clientSockets) {
            try {
                sock.disconnect();
            } catch {}
        }

        try {
            // Delete users (Prisma cascade deletes participants, conversations, messages, blocks)
            await prisma.user.deleteMany({
                where: {
                    username: { in: [aliceUname, bobUname, eveUname] },
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
