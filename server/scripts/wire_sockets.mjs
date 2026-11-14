import fs from 'fs';

let userCtrl = fs.readFileSync('src/controllers/user.controller.ts', 'utf8');
if (!userCtrl.includes('emitNotificationToUser')) {
  userCtrl = "import { emitNotificationToUser } from '../socket.js';\n" + userCtrl;
  userCtrl = userCtrl.replace(
    'await prisma.$transaction([',
    'const [, newNotif] = await prisma.$transaction(['
  ).replace(
    'return res.status(200).json({ message: "Followed successfully" });',
    'emitNotificationToUser(targetUserId, { ...newNotif, sourceUser: { id: currentUserId, username: req.user?.username } });\n        return res.status(200).json({ message: "Followed successfully" });'
  );
  fs.writeFileSync('src/controllers/user.controller.ts', userCtrl, 'utf8');
  console.log('user.controller.ts updated');
}

let engCtrl = fs.readFileSync('src/controllers/engagement.controller.ts', 'utf8');
if (!engCtrl.includes('emitNotificationToUser')) {
  engCtrl = "import { emitNotificationToUser } from '../socket.js';\n" + engCtrl;
  engCtrl = engCtrl.replace(
    'return res.status(200).json({\n            message: "Liked tweet",',
    'emitNotificationToUser(tweet.authorId, { type: "LIKE", tweetId, sourceUser: { id: userId, username: req.user?.username } });\n        return res.status(200).json({\n            message: "Liked tweet",'
  ).replace(
    'return res.status(200).json({\n            message: quoteContent ? "Quote posted" : "Retweeted",',
    'emitNotificationToUser(tweet.authorId, { type: "RETWEET", tweetId, sourceUser: { id: userId, username: req.user?.username } });\n        return res.status(200).json({\n            message: quoteContent ? "Quote posted" : "Retweeted",'
  );
  fs.writeFileSync('src/controllers/engagement.controller.ts', engCtrl, 'utf8');
  console.log('engagement.controller.ts updated');
}

let tweetCtrl = fs.readFileSync('src/controllers/tweet.controller.ts', 'utf8');
if (!tweetCtrl.includes('broadcastNewTweet')) {
  tweetCtrl = "import { emitNotificationToUser, broadcastNewTweet } from '../socket.js';\n" + tweetCtrl;
  tweetCtrl = tweetCtrl.replace(
    'return res.status(201).json({\n            message: "Tweet posted successfully",',
    'broadcastNewTweet(tweet);\n        return res.status(201).json({\n            message: "Tweet posted successfully",'
  ).replace(
    'return res.status(201).json({\n            message: "Reply posted successfully",',
    'if (parentTweet.authorId !== userId) { emitNotificationToUser(parentTweet.authorId, { type: "REPLY", tweetId: parentTweet.id, sourceUser: { id: userId, username: req.user?.username } }); }\n        return res.status(201).json({\n            message: "Reply posted successfully",'
  );
  fs.writeFileSync('src/controllers/tweet.controller.ts', tweetCtrl, 'utf8');
  console.log('tweet.controller.ts updated');
}

