import 'dotenv/config';

const idToken = process.env.GOOGLE_TEST_ID_TOKEN;
if (!idToken) {
    console.error("Set GOOGLE_TEST_ID_TOKEN to a fresh Firebase ID token from a real Google sign-in.");
    process.exit(1);
}

process.env.PORT = "5098";
const { httpServer, prisma, io } = await import('../dist/index.js');

try {
    const res = await fetch("http://localhost:5098/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
    });
    const data = await res.json();
    const cookie = res.headers.get("set-cookie") || "";
    console.log("Google auth status:", res.status);
    console.log("Authenticated username:", data.user?.username || "(none)");
    console.log("Access token returned:", Boolean(data.accessToken));
    console.log("Refresh cookie set:", cookie.includes("refreshToken="));
    console.log("Refresh token exposed in JSON:", Object.hasOwn(data, "refreshToken"));
    if (res.status !== 200 || !data.user || !data.accessToken || !cookie.includes("refreshToken=") || Object.hasOwn(data, "refreshToken")) {
        process.exitCode = 1;
    }
} finally {
    if (io) io.close();
    await new Promise((resolve) => httpServer.close(resolve));
    await prisma.$disconnect();
}
