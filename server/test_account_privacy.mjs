import { randomUUID } from "node:crypto";

process.env.PORT = "5071";
const { httpServer, io, prisma } = await import("./dist/index.js");
const { generateAccessToken } = await import("./dist/lib/jwt.js");

const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const accounts = {};
const checks = [];
const baseUrl = "http://127.0.0.1:5071/api";

const check = (label, condition) => {
    checks.push({ label, passed: !!condition });
    console.log(`${condition ? "PASS" : "FAIL"} ${label}`);
};

const call = async (path, method = "GET", body, token) => {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
    });
    let data = {};
    try { data = await response.json(); } catch { /* empty response */ }
    return { status: response.status, data };
};

const addAccount = async (role) => {
    const username = `privacy_${role}_${suffix}`;
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

    for (const role of ["owner", "approved", "rejected", "public", "blocked"]) await addAccount(role);
    const owner = accounts.owner;
    const approved = accounts.approved;
    const rejected = accounts.rejected;
    const publicFollower = accounts.public;
    const blocked = accounts.blocked;

    const tag = `privacycheck${suffix}`;
    const tweet = await prisma.tweet.create({
        data: {
            content: `Private root #${tag}`,
            authorId: owner.id,
            hashtags: { create: [{ hashtag: { connectOrCreate: { where: { tag }, create: { tag } } } }] },
        },
        select: { id: true },
    });

    check("new account defaults to public", (await call(`/users/profile/${owner.username}`, "GET", undefined, owner.token)).data.user.isPrivate === false);
    await call("/users/profile", "PATCH", { isPrivate: true }, owner.token);
    check("privacy setting persists", (await call(`/users/profile/${owner.username}`, "GET", undefined, owner.token)).data.user.isPrivate === true);

    const hiddenProfile = await call(`/tweets/user/${owner.username}`, "GET", undefined, approved.token);
    const hiddenTweet = await call(`/tweets/${tweet.id}`, "GET", undefined, approved.token);
    const hiddenFeed = await call("/tweets/feed?type=for-you", "GET", undefined, approved.token);
    const hiddenHashtag = await call(`/tweets/hashtag/${tag}`, "GET", undefined, approved.token);
    const hiddenFollowers = await call(`/users/${owner.username}/followers`, "GET", undefined, approved.token);
    check("private profile feed denies direct API access", hiddenProfile.status === 403);
    check("private tweet detail denies direct API access", hiddenTweet.status === 403);
    check("for-you feed excludes private tweet", !(hiddenFeed.data.tweets || []).some((item) => item.id === tweet.id));
    check("hashtag results exclude private tweet", !(hiddenHashtag.data.tweets || []).some((item) => item.id === tweet.id));
    check("private follower list denies unapproved visitor", hiddenFollowers.status === 403);

    check("self-follow is rejected", (await call(`/users/follow/${owner.id}`, "POST", {}, owner.token)).status === 400);
    const firstRequest = await call(`/users/follow/${owner.id}`, "POST", {}, approved.token);
    const duplicateRequest = await call(`/users/follow/${owner.id}`, "POST", {}, approved.token);
    check("private follow creates a pending request", firstRequest.data.isRequested && !firstRequest.data.isFollowing);
    check("duplicate request reuses the pending request", firstRequest.data.followRequestId === duplicateRequest.data.followRequestId);
    check("pending requests do not count as followers", (await call(`/users/profile/${owner.username}`, "GET", undefined, owner.token)).data.user._count.followers === 0);
    check("owner can list received requests", (await call("/users/follow-requests/received", "GET", undefined, owner.token)).data.requests?.length === 1);
    check("non-owner cannot accept a request", (await call(`/users/follow-requests/${firstRequest.data.followRequestId}/accept`, "POST", {}, approved.token)).status === 404);
    check("owner accepts request", (await call(`/users/follow-requests/${firstRequest.data.followRequestId}/accept`, "POST", {}, owner.token)).status === 200);
    check("acceptance creates actual follow", (await call(`/users/profile/${owner.username}`, "GET", undefined, approved.token)).data.user.isFollowing === true);
    check("approved follower can view private post", (await call(`/tweets/${tweet.id}`, "GET", undefined, approved.token)).status === 200);
    check("approved follower can view private profile feed", (await call(`/tweets/user/${owner.username}`, "GET", undefined, approved.token)).status === 200);

    const rejectedRequest = await call(`/users/follow/${owner.id}`, "POST", {}, rejected.token);
    check("owner rejects request", (await call(`/users/follow-requests/${rejectedRequest.data.followRequestId}/reject`, "POST", {}, owner.token)).status === 200);
    const rejectedProfile = await call(`/users/profile/${owner.username}`, "GET", undefined, rejected.token);
    check("rejection creates no follow", !rejectedProfile.data.user.isFollowing);
    const retry = await call(`/users/follow/${owner.id}`, "POST", {}, rejected.token);
    const duplicateRetry = await call(`/users/follow/${owner.id}`, "POST", {}, rejected.token);
    check("rejected user can send one fresh request", retry.data.isRequested && retry.data.followRequestId === duplicateRetry.data.followRequestId);
    check("requester cancels pending request", (await call(`/users/follow-requests/${retry.data.followRequestId}/cancel`, "POST", {}, rejected.token)).status === 200);
    check("canceled request disappears from sent list", (await call("/users/follow-requests/sent", "GET", undefined, rejected.token)).data.requests?.length === 0);
    check("unauthorized reply to private post is denied", (await call(`/tweets/${tweet.id}/reply`, "POST", { content: "Denied reply" }, rejected.token)).status === 403);
    check("follow decision notification is returned", (await call("/notifications", "GET", undefined, approved.token)).data.notifications?.some((item) => item.type === "FOLLOW_REQUEST_ACCEPTED"));

    const blockedRequest = await call(`/users/follow/${owner.id}`, "POST", {}, blocked.token);
    await call(`/users/block/${blocked.id}`, "POST", {}, owner.token);
    check("blocking cancels pending request and prevents future requests", blockedRequest.data.isRequested && (await call(`/users/follow/${owner.id}`, "POST", {}, blocked.token)).status === 403);

    await call("/users/profile", "PATCH", { isPrivate: false }, owner.token);
    const publicFollow = await call(`/users/follow/${owner.id}`, "POST", {}, publicFollower.token);
    check("public follow creates relationship immediately", publicFollow.data.isFollowing && !publicFollow.data.isRequested);
    check("public post is anonymously accessible", (await call(`/tweets/${tweet.id}`)).status === 200);
    await call("/users/profile", "PATCH", { isPrivate: true }, owner.token);
    check("existing follower retains access after public to private switch", (await call(`/tweets/${tweet.id}`, "GET", undefined, publicFollower.token)).status === 200);
    check("non-follower loses access after public to private switch", (await call(`/tweets/${tweet.id}`, "GET", undefined, rejected.token)).status === 403);
    await call("/users/profile", "PATCH", { isPrivate: false }, owner.token);
    check("private to public switch restores public access", (await call(`/tweets/${tweet.id}`)).status === 200);

    const failed = checks.filter((item) => !item.passed);
    console.log(JSON.stringify({ total: checks.length, passed: checks.length - failed.length, failed: failed.map((item) => item.label) }));
    if (failed.length) process.exitCode = 1;
} catch (error) {
    console.error("Privacy API suite failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
} finally {
    const usernames = Object.values(accounts).map((account) => account.username);
    if (usernames.length) await prisma.user.deleteMany({ where: { username: { in: usernames } } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
    io.close();
    httpServer.closeAllConnections?.();
    await new Promise((resolve) => httpServer.close(resolve));
}
