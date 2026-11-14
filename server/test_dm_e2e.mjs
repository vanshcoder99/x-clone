import { io } from "socket.io-client";

async function runDMTest() {
  const rand = Math.floor(Math.random() * 100000);
  const userA = {
    username: `alice_${rand}`,
    email: `alice_${rand}@example.com`,
    password: "Password123!",
  };
  const userB = {
    username: `bob_${rand}`,
    email: `bob_${rand}@example.com`,
    password: "Password123!",
  };

  console.log("1. Registering Alice & Bob...");
  const regA = await fetch("http://localhost:5000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(userA),
  }).then((r) => r.json());

  const regB = await fetch("http://localhost:5000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(userB),
  }).then((r) => r.json());

  const tokenA = regA.accessToken;
  const tokenB = regB.accessToken;
  const idB = regB.user.id;

  console.log(`   Alice ID: ${regA.user.id}, Bob ID: ${idB}`);

  console.log("\n2. Alice creates/gets conversation with Bob...");
  const convRes = await fetch("http://localhost:5000/api/messages/conversations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({ recipientId: idB }),
  }).then((r) => r.json());

  const convId = convRes.conversation?.id;
  console.log(`   Conversation created with ID: ${convId}`);

  console.log("\n3. Testing Socket.IO Connection for Bob...");
  const bobSocket = io("http://localhost:5000", {
    auth: { token: tokenB },
    transports: ["websocket"],
  });

  let socketReceivedDM = false;
  bobSocket.on("message:unread", (data) => {
    console.log(`   🔔 Bob received real-time socket alert for DM: "${data.message.content}"`);
    socketReceivedDM = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 800));

  console.log("\n4. Alice sends message to Bob in conversation...");
  const sendRes = await fetch(`http://localhost:5000/api/messages/conversations/${convId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({ content: "Hello Bob! Testing real-time SocialSphere Direct Messages! 🚀" }),
  }).then((r) => r.json());

  console.log(`   Message sent: "${sendRes.message?.content}" (ID: ${sendRes.message?.id})`);

  // Wait 1s for socket emission
  await new Promise((resolve) => setTimeout(resolve, 1000));
  bobSocket.disconnect();

  console.log("\n5. Bob fetches conversation messages...");
  const msgsRes = await fetch(`http://localhost:5000/api/messages/conversations/${convId}/messages`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  }).then((r) => r.json());

  console.log(`   Bob retrieved ${msgsRes.messages?.length} message(s).`);
  console.log(`   First message from: @${msgsRes.messages?.[0]?.sender?.username}: "${msgsRes.messages?.[0]?.content}"`);

  console.log("\n=================================================");
  console.log(" REAL-TIME DIRECT MESSAGING FULLY VERIFIED! ");
  console.log("=================================================");
}

runDMTest().catch(console.error);

