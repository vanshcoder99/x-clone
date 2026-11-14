import 'dotenv/config';
import jwt from 'jsonwebtoken';

process.env.PORT = "5097";
const { httpServer, prisma } = await import('../dist/index.js');

async function testUpload() {
    const user = await prisma.user.findFirst();
    if (!user) {
        console.error("No user found in DB");
        process.exit(1);
    }

    const token = jwt.sign(
        { userId: user.id, username: user.username },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: "1h" }
    );

    // 1x1 transparent PNG in base64
    const sampleBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const res = await fetch("http://localhost:5097/api/media/upload", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            fileData: sampleBase64,
            fileName: "test_image.png",
            resourceType: "image",
        }),
    });

    const data = await res.json();
    console.log("Upload response status:", res.status);
    console.log("Upload response data:", data);

    let fetchStatus = 0;
    if (data.url) {
        const fileRes = await fetch(data.url);
        fetchStatus = fileRes.status;
        console.log("Static file fetch status (expected 200):", fileRes.status);
    }

    httpServer.close();
    await prisma.$disconnect();

    if (res.status === 200 && data.url && fetchStatus === 200) {
        console.log("✓ PASS: Media upload and static serving are working!");
        process.exit(0);
    } else {
        console.error("✗ FAIL");
        process.exit(1);
    }
}

testUpload().catch(console.error);
