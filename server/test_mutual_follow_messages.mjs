import { randomUUID } from "node:crypto";
import { io as ioClient } from "socket.io-client";

process.env.PORT = "5072";
const { httpServer, io, prisma } = await import("./dist/index.js");
const { generateAccessToken } = await import("./dist/lib/jwt.js");

const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const baseUrl = "http://127.0.0.1:5072/api";
const accounts = {};
const checks = [];
let testSocket = null;

const check = (label, passed) => {
    checks.push({ label, passed: Boolean(passed) });
    console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
};

const request = async (path, method = "GET", body, token) => {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
    });
    let data = {};
    try { data = await response.json(); } catch { /* empty response */ }
    return { status: response.status, data };
};

const createUser = async (role) => {
    const username = `dm_access_${role}_${suffix}`;
    const user = await prisma.user.create({
        data: { username, email: `${username}@example.test`, name: role },
        select: { id: true, username: true },
    });
    accounts[role] = { ...user, token: generateAccessToken({ userId: user.id, username: user.username }) };
};

try {
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("server startup timeout")), 10000);
        httpServer.once("listening", () => { clearTimeout(timer); resolve(); });
    });
    await createUser("alice");
    await createUser("bob");
    const { alice, bob } = accounts;

    check("contacts exclude users who do not follow back", !(await request("/messages/contacts", "GET", undefined, alice.token)).data.contacts?.some((contact) => contact.id === bob.id));
    check("conversation creation is denied without follows", (await request("/messages/conversations", "POST", { recipientId: bob.id }, alice.token)).status === 403);
    await prisma.user.update({ where: { id: bob.id }, data: { isPrivate: true } });
    await prisma.followRequest.create({ data: { requesterId: alice.id, targetId: bob.id, status: "PENDING" } });
    check("pending private follow request does not grant messaging", (await request("/messages/contacts", "GET", undefined, alice.token)).data.contacts?.every((contact) => contact.id !== bob.id));
    await prisma.followRequest.update({ where: { requesterId_targetId: { requesterId: alice.id, targetId: bob.id } }, data: { status: "ACCEPTED" } });
    await prisma.follow.create({ data: { followerId: alice.id, followingId: bob.id } });
    check("one-way follow cannot create a conversation", (await request("/messages/conversations", "POST", { recipientId: bob.id }, alice.token)).status === 403);
    check("accepted private request without reverse follow is not eligible", (await request("/messages/contacts", "GET", undefined, alice.token)).data.contacts?.every((contact) => contact.id !== bob.id));
    await prisma.follow.create({ data: { followerId: bob.id, followingId: alice.id } });
    check("mutual follows appear in Contacts", (await request("/messages/contacts", "GET", undefined, alice.token)).data.contacts?.some((contact) => contact.id === bob.id));
    check("Contacts search returns eligible users by username", (await request(`/messages/contacts?q=${encodeURIComponent(bob.username)}`, "GET", undefined, alice.token)).data.contacts?.some((contact) => contact.id === bob.id));

    const simultaneous = await Promise.all([
        request("/messages/conversations", "POST", { recipientId: bob.id }, alice.token),
        request("/messages/conversations", "POST", { recipientId: bob.id }, alice.token),
    ]);
    const conversationId = simultaneous[0].data.conversation?.id;
    const pairKey = [alice.id, bob.id].sort().join(":");
    check("mutual follows create one idempotent conversation under concurrent requests", Boolean(conversationId) && simultaneous.every((result) => result.data.conversation?.id === conversationId) && await prisma.conversation.count({ where: { directKey: pairKey } }) === 1);
    check("conversation appears in Recent", (await request("/messages/conversations", "GET", undefined, alice.token)).data.conversations?.some((conversation) => conversation.id === conversationId));
    check("mutual follows can send a message", (await request(`/messages/conversations/${conversationId}/messages`, "POST", { content: "Hello" }, alice.token)).status === 201);
    check("new message increments recipient unread count", (await request("/messages/conversations", "GET", undefined, bob.token)).data.conversations?.find((conversation) => conversation.id === conversationId)?.unreadCount === 1);
    check("opening history marks message read", (await request(`/messages/conversations/${conversationId}/messages`, "GET", undefined, bob.token)).status === 200 && (await request("/messages/conversations", "GET", undefined, bob.token)).data.conversations?.find((conversation) => conversation.id === conversationId)?.unreadCount === 0);

    await createUser("carol");
    const { carol } = accounts;
    await prisma.follow.createMany({ data: [
        { followerId: alice.id, followingId: carol.id },
        { followerId: carol.id, followingId: alice.id },
    ] });
    const otherConversation = await request("/messages/conversations", "POST", { recipientId: carol.id }, alice.token);
    await request(`/messages/conversations/${otherConversation.data.conversation.id}/messages`, "POST", { content: "Earlier activity" }, alice.token);
    await request(`/messages/conversations/${conversationId}/messages`, "POST", { content: "Latest activity" }, alice.token);
    check("new messages move their conversation to the top of Recent", (await request("/messages/conversations", "GET", undefined, alice.token)).data.conversations?.[0]?.id === conversationId);

    check("archive keeps history and removes conversation from Recent", (await request(`/messages/conversations/${conversationId}/archive`, "PATCH", { archived: true }, alice.token)).status === 200 && !(await request("/messages/conversations", "GET", undefined, alice.token)).data.conversations?.some((conversation) => conversation.id === conversationId));
    check("archived conversation remains listed and can be unarchived", (await request("/messages/conversations?archived=true", "GET", undefined, alice.token)).data.conversations?.some((conversation) => conversation.id === conversationId) && (await request(`/messages/conversations/${conversationId}/archive`, "PATCH", { archived: false }, alice.token)).status === 200 && (await request("/messages/conversations", "GET", undefined, alice.token)).data.conversations?.some((conversation) => conversation.id === conversationId));

    await prisma.follow.delete({ where: { followerId_followingId: { followerId: bob.id, followingId: alice.id } } });
    check("existing conversation is removed from list after unfollow", !(await request("/messages/conversations", "GET", undefined, alice.token)).data.conversations.some((conversation) => conversation.id === conversationId));
    check("unfollow removes contact eligibility", !(await request("/messages/contacts", "GET", undefined, alice.token)).data.contacts?.some((contact) => contact.id === bob.id));
    check("existing conversation history is denied after unfollow", (await request(`/messages/conversations/${conversationId}/messages`, "GET", undefined, alice.token)).status === 403);
    check("sending is denied after unfollow", (await request(`/messages/conversations/${conversationId}/messages`, "POST", { content: "Blocked by follow rule" }, alice.token)).status === 403);
    testSocket = ioClient("http://127.0.0.1:5072", {
        auth: { token: alice.token },
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("socket connection timeout")), 5000);
        testSocket.once("connect", () => { clearTimeout(timer); resolve(); });
        testSocket.once("connect_error", reject);
    });
    const deniedSocketJoin = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 5000);
        testSocket.once("auth_error", (data) => {
            clearTimeout(timer);
            resolve(typeof data?.message === "string" && data.message.includes("both follow"));
        });
        testSocket.emit("join_conversation", conversationId);
    });
    check("socket conversation room is denied after unfollow", deniedSocketJoin);

    await prisma.follow.create({ data: { followerId: bob.id, followingId: alice.id } });
    check("messaging resumes after mutual follow is restored", (await request(`/messages/conversations/${conversationId}/messages`, "POST", { content: "Restored" }, alice.token)).status === 201);
    await prisma.block.create({ data: { blockerId: alice.id, blockedId: bob.id } });
    check("block still overrides mutual-follow messaging", (await request(`/messages/conversations/${conversationId}/messages`, "POST", { content: "Blocked" }, alice.token)).status === 403);

    const failed = checks.filter((item) => !item.passed);
    console.log(JSON.stringify({ total: checks.length, passed: checks.length - failed.length, failed: failed.map((item) => item.label) }));
    if (failed.length) process.exitCode = 1;
} catch (error) {
    console.error("Mutual-follow messaging suite failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
} finally {
    testSocket?.disconnect();
    const usernames = Object.values(accounts).map((account) => account.username);
    if (usernames.length) await prisma.user.deleteMany({ where: { username: { in: usernames } } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
    io.close();
    httpServer.closeAllConnections?.();
    await new Promise((resolve) => httpServer.close(resolve));
}
