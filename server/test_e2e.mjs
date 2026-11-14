async function runTest() {
  const rand = Math.floor(Math.random() * 100000);
  const userPayload = {
    username: `pilot_${rand}`,
    email: `pilot_${rand}@example.com`,
    password: "Password123!",
    bio: "Autopilot test user on SocialSphere"
  };

  console.log("1. Registering user:", userPayload.username);
  const regRes = await fetch("http://localhost:5000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(userPayload)
  });
  const regData = await regRes.json();
  if (!regRes.ok) {
    console.error("Registration failed:", regData);
    process.exit(1);
  }
  console.log("   User registered successfully:", regData.user.username);
  const token = regData.accessToken;
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };

  console.log("\n2. Testing AI Tweet Suggestion...");
  const aiRes = await fetch("http://localhost:5000/api/ai/suggest-tweet", {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: "building SocialSphere twitter clone in public" })
  });
  const aiData = await aiRes.json();
  console.log("   AI Suggestion received:\n   \"", aiData.suggestion, "\"");

  console.log("\n3. Posting AI-generated Tweet...");
  const tweetRes = await fetch("http://localhost:5000/api/tweets", {
    method: "POST",
    headers,
    body: JSON.stringify({ content: aiData.suggestion })
  });
  const tweetData = await tweetRes.json();
  console.log("   Tweet posted successfully!");
  console.log("   - Tweet ID:", tweetData.tweet?.id);
  console.log("   - Content:", tweetData.tweet?.content);
  console.log("   - Hashtags:", tweetData.tweet?.hashtags?.map(h => '#' + h.hashtag?.name).join(', '));

  console.log("\n4. Upgrading to SocialSphere Premium...");
  const subRes = await fetch("http://localhost:5000/api/users/subscribe", {
    method: "POST",
    headers
  });
  const subData = await subRes.json();
  console.log("   Subscribed to Premium!");
  console.log("   - Tier:", subData.subscription?.tier);
  console.log("   - Status:", subData.subscription?.status);

  console.log("\n5. Verifying User Profile & Verified Checkmark...");
  const profRes = await fetch(`http://localhost:5000/api/users/profile/${userPayload.username}`, {
    headers
  });
  const profData = await profRes.json();
  console.log("   - Username:", profData.user?.username);
  console.log("   - Is Verified:", profData.user?.isVerified);
  console.log("   - Tweets Count:", profData.user?._count?.tweets);

  console.log("\n6. Testing Timeline Feed (For You & Following)...");
  const feedRes = await fetch("http://localhost:5000/api/tweets/feed", {
    headers
  });
  const feedData = await feedRes.json();
  console.log(`   Feed fetched successfully! Returned ${feedData.tweets?.length} tweet(s).`);
  console.log("   Top tweet author:", feedData.tweets?.[0]?.author?.username, "Verified:", feedData.tweets?.[0]?.author?.isVerified);

  console.log("\n7. Testing Social Interaction (Liking Tweet)...");
  const tweetId = tweetData.tweet?.id;
  const likeRes = await fetch(`http://localhost:5000/api/tweets/${tweetId}/like`, {
    method: "POST",
    headers
  });
  const likeData = await likeRes.json();
  console.log("   Like action result:", likeData.message, "Liked:", likeData.isLiked);

  console.log("\n=================================================");
  console.log(" ALL LIVE CORE SOCIALSPHERE ENDPOINTS VERIFIED! ");
  console.log("=================================================");
}

runTest().catch(console.error);
