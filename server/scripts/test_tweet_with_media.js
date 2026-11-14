import 'dotenv/config';
import jwt from 'jsonwebtoken';

process.env.PORT = "5096";
const { httpServer, prisma } = await import('../dist/index.js');

async function testTweetMedia() {
    const user = await prisma.user.findFirst();
    if (!user) process.exit(1);

    const token = jwt.sign(
        { userId: user.id, username: user.username },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: "1h" }
    );

    // 1. Upload media
    const sampleBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const uploadRes = await fetch("http://localhost:5096/api/media/upload", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            fileData: sampleBase64,
            fileName: "test_pic.png",
            resourceType: "image",
        }),
    });
    const uploadData = await uploadRes.json();
    console.log("Upload status:", uploadRes.status, "URL:", uploadData.url);

    // 2. Post tweet with this media
    const tweetRes = await fetch("http://localhost:5096/api/tweets", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            content: "Testing persistent media upload on SocialSphere!",
            media: [
                {
                    url: uploadData.url,
                    publicId: uploadData.publicId,
                    mediaType: "IMAGE",
                },
            ],
        }),
    });

    const tweetData = await tweetRes.json();
    console.log("Tweet status:", tweetRes.status);
    console.log("Tweet media attached:", tweetData.tweet?.media);

    httpServer.close();
    await prisma.$disconnect();

    if (tweetRes.status === 201 && tweetData.tweet?.media?.length > 0) {
        console.log("✓ PASS: Tweet successfully created with visible persistent media!");
        process.exit(0);
    } else {
        console.error("✗ FAIL");
        process.exit(1);
    }
}

testTweetMedia().catch(console.error);

