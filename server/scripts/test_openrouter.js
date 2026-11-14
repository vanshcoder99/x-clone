import 'dotenv/config';
import jwt from 'jsonwebtoken';
import http from 'http';

process.env.PORT = "5099";

const { httpServer, prisma } = await import('../dist/index.js');

const BASE_URL = "http://localhost:5099/api/ai";

// Create test auth token
const testPayload = { userId: "test_user_ai_001", username: "ai_tester" };
const token = jwt.sign(testPayload, process.env.JWT_ACCESS_SECRET, { expiresIn: "1h" });

async function runTests() {
    console.log("\n=======================================================");
    console.log("   TESTING REAL OPENROUTER AI SUGGEST INTEGRATION      ");
    console.log("=======================================================\n");

    const authHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };

    let allPassed = true;

    // Test 1: Improve Tweet
    console.log("1. Testing 'improve' tweet with OpenRouter...");
    const res1 = await fetch(`${BASE_URL}/suggest-tweet`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
            prompt: "i just coded socialsphere and it has openrouter ai",
            action: "improve",
        }),
    });
    const data1 = await res1.json();
    console.log("Status:", res1.status);
    console.log("Response:", data1);
    if (res1.status === 200 && data1.isRealLLM && data1.provider === "OpenRouter" && data1.suggestion) {
        console.log("✓ PASS: Successfully generated improved tweet via OpenRouter LLM\n");
    } else {
        console.error("✗ FAIL: Improve tweet failed\n");
        allPassed = false;
    }

    // Test 2: Grammar Correction
    console.log("2. Testing 'grammar' correction with OpenRouter...");
    const res2 = await fetch(`${BASE_URL}/suggest-tweet`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
            prompt: "me and him goes to the shop yesterday and we buyed some food",
            action: "grammar",
        }),
    });
    const data2 = await res2.json();
    console.log("Status:", res2.status);
    console.log("Response:", data2);
    if (res2.status === 200 && data2.isRealLLM && data2.suggestion.toLowerCase().includes("went")) {
        console.log("✓ PASS: Corrected grammar via OpenRouter LLM\n");
    } else {
        console.error("✗ FAIL: Grammar correction failed\n");
        allPassed = false;
    }

    // Test 3: Multiple Alternatives
    console.log("3. Testing 'alternatives' (multiple versions) with OpenRouter...");
    const res3 = await fetch(`${BASE_URL}/suggest-tweet`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
            prompt: "launching our developer beta next week",
            action: "alternatives",
        }),
    });
    const data3 = await res3.json();
    console.log("Status:", res3.status);
    console.log("Response:", data3);
    if (res3.status === 200 && Array.isArray(data3.suggestions) && data3.suggestions.length >= 2) {
        console.log("✓ PASS: Successfully generated multiple distinct variations\n");
    } else {
        console.error("✗ FAIL: Alternatives generation failed\n");
        allPassed = false;
    }

    // Test 4: Hashtag Suggestions
    console.log("4. Testing 'suggest-hashtags' with OpenRouter...");
    const res4 = await fetch(`${BASE_URL}/suggest-hashtags`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
            content: "Full-stack development with React 19, TypeScript, and PostgreSQL on Neon",
        }),
    });
    const data4 = await res4.json();
    console.log("Status:", res4.status);
    console.log("Response:", data4);
    if (res4.status === 200 && Array.isArray(data4.hashtags) && data4.hashtags.length > 0) {
        console.log("✓ PASS: Successfully generated hashtags via OpenRouter LLM\n");
    } else {
        console.error("✗ FAIL: Hashtag generation failed\n");
        allPassed = false;
    }

    // Test 5: Validation (Empty input)
    console.log("5. Testing validation for empty input...");
    const res5 = await fetch(`${BASE_URL}/suggest-tweet`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ prompt: "" }),
    });
    console.log("Status (expected 400):", res5.status);
    if (res5.status === 400) {
        console.log("✓ PASS: Empty prompt correctly rejected with 400\n");
    } else {
        console.error("✗ FAIL: Empty prompt was not rejected\n");
        allPassed = false;
    }

    httpServer.close();
    await prisma.$disconnect();

    if (allPassed) {
        console.log("=======================================================");
        console.log("   ALL OPENROUTER TESTS PASSED SUCCESSFULLY!          ");
        console.log("=======================================================\n");
        process.exit(0);
    } else {
        console.error("Some tests failed.");
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Fatal test error:", err);
    process.exit(1);
});

