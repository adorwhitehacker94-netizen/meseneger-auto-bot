const login = require('fb-chat-api');
const fs = require('fs');
const mongoose = require('mongoose');
const express = require('express');
require('dotenv').config();

// ===== তোমার কনফিগারেশন =====
const PREFIX = '!';
const ADMIN_IDS = ['61581910887562']; // তোমার ফেক আইডি
const BOT_NAME = 'ur hayati';

// ===== Express সার্ভার (Health Check) =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  const uptime = process.uptime();
  res.send(`🤖 বট চলছে!<br>⏱️ Uptime: ${formatUptime(uptime)}`);
});

app.listen(PORT, () => {
  console.log(`🌐 সার্ভার চলছে পোর্ট ${PORT} এ`);
});

// ===== Self-Ping সিস্টেম (২৪/৭ আনলিমিটেড) =====
setInterval(() => {
  const url = process.env.RENDER_URL || process.env.RAILWAY_STATIC_URL;
  if (url) {
    const cleanUrl = url.startsWith('http') ? url : `https://${url}`;
    fetch(cleanUrl)
      .then(res => console.log(`💓 Self-ping সফল: ${res.status}`))
      .catch(err => console.error('❌ Self-ping ফেল:', err.message));
  }
}, 5 * 60 * 1000); // প্রতি ৫ মিনিটে পিং করবে

// ===== MongoDB মডেল =====
const PairSchema = new mongoose.Schema({
  threadID: String,
  user1: String,
  user2: String,
  pairedAt: { type: Date, default: Date.now }
});
const PairModel = mongoose.model('Pair', PairSchema);

const WarnSchema = new mongoose.Schema({
  userID: String,
  threadID: String,
  warns: { type: Number, default: 0 },
  reasons: [String]
});
const WarnModel = mongoose.model('Warn', WarnSchema);

const MuteSchema = new mongoose.Schema({
  userID: String,
  threadID: String,
  mutedUntil: Date
});
const MuteModel = mongoose.model('Mute', MuteSchema);

// ===== MongoDB কানেকশন =====
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err.message));

// ===== বট লগইন =====
login({
  appState: JSON.parse(fs.readFileSync('appstate.json', 'utf8'))
}, (err, api) => {
  if (err) return console.error('❌ Login Error:', err);

  api.setOptions({
    listenEvents: true,
    selfListen: false,
    logLevel: 'silent'
  });

  console.log(`✅ ${BOT_NAME} লগইন সফল!`);

  api.listenMqtt((err, event) => {
    if (err) return console.error('❌ Listen Error:', err);
    if (!event) return;

    // গ্রুপ ইভেন্ট হ্যান্ডলার
    if (event.logMessageType === 'log:subscribe') {
      const userName = event.logMessageData.addedParticipants?.[0]?.fullName || 'নতুন মেম্বার';
      api.sendMessage(`🎉 স্বাগতম ${userName}! গ্রুপে আপনাকে পেয়ে আমরা আনন্দিত।`, event.threadID);
      return;
    }

    // শুধু টেক্সট মেসেজ প্রসেস করো
    if (event.type !== 'message' || !event.body) return;

    const text = event.body.trim();
    const senderID = event.senderID;
    const threadID = event.threadID;

    if (!text.startsWith(PREFIX)) return;

    const command = text.slice(PREFIX.length).split(' ')[0].toLowerCase();
    const args = text.slice(PREFIX.length + command.length).trim();
    const isAdmin = ADMIN_IDS.includes(senderID);

    console.log(`📩 [${isAdmin ? 'ADMIN' : 'MEMBER'}] ${senderID}: ${text}`);

    handleCommand(command, args, { api, event, senderID, threadID, isAdmin });
  });
});

// ===== কমান্ড হ্যান্ডলার =====
function handleCommand(command, args, ctx) {
  const { api, event, senderID, threadID, isAdmin } = ctx;

  // ===== অ্যাডমিন কমান্ড =====
  if (isAdmin) {
    switch (command) {

      case 'kick': {
        const mentions = event.mentions;
        if (!mentions || Object.keys(mentions).length === 0) {
          return api.sendMessage('❌ কাউকে মেনশন করো। যেমন: !kick @user', threadID);
        }
        const targetID = Object.keys(mentions)[0];
        if (ADMIN_IDS.includes(targetID)) {
          return api.sendMessage('❌ অ্যাডমিনকে কিক করা যাবে না!', threadID);
        }
        api.removeUserFromGroup(targetID, threadID, (err) => {
          if (err) return api.sendMessage('❌ কিক করতে পারছি না!', threadID);
          api.sendMessage('✅ ব্যবহারকারীকে গ্রুপ থেকে বের করা হয়েছে।', threadID);
        });
        break;
      }

      case 'ban': {
        const mentions = event.mentions;
        if (!mentions || Object.keys(mentions).length === 0) {
          return api.sendMessage('❌ কাউকে মেনশন করো!', threadID);
        }
        const targetID = Object.keys(mentions)[0];
        if (ADMIN_IDS.includes(targetID)) {
          return api.sendMessage('❌ অ্যাডমিনকে ব্যান করা যাবে না!', threadID);
        }
        api.removeUserFromGroup(targetID, threadID, (err) => {
          if (err) return api.sendMessage('❌ ব্যান করতে পারছি না!', threadID);
          api.sendMessage(`🚫 ${mentions[targetID]} স্থায়ীভাবে ব্যান হয়েছে।`, threadID);
        });
        break;
      }

      case 'mute': {
        const mentions = event.mentions;
        if (!mentions || Object.keys(mentions).length === 0) {
          return api.sendMessage('❌ কাউকে মেনশন করো! যেমন: !mute @user 1h', threadID);
        }
        const targetID = Object.keys(mentions)[0];
        const duration = args.split(' ')[1] || '1h';
        const ms = parseDuration(duration);

        MuteModel.findOneAndUpdate(
          { userID: targetID, threadID },
          { mutedUntil: new Date(Date.now() + ms) },
          { upsert: true }
        ).then(() => {
          api.sendMessage(`🔇 ${mentions[targetID]} ${duration} এর জন্য মিউট হয়েছে।`, threadID);
        });
        break;
      }

      case 'unmute': {
        const mentions = event.mentions;
        if (!mentions) return api.sendMessage('❌ কাউকে মেনশন করো!', threadID);
        const targetID = Object.keys(mentions)[0];

        MuteModel.deleteOne({ userID: targetID, threadID }).then(() => {
          api.sendMessage(`🔊 ${mentions[targetID]} আনমিউট হয়েছে।`, threadID);
        });
        break;
      }

      case 'warn': {
        const mentions = event.mentions;
        if (!mentions) return api.sendMessage('❌ কাউকে মেনশন করো!', threadID);
        const targetID = Object.keys(mentions)[0];
        const reason = args.split(' ').slice(1).join(' ') || 'কারণ দেওয়া হয়নি';

        WarnModel.findOneAndUpdate(
          { userID: targetID, threadID },
          { $inc: { warns: 1 }, $push: { reasons: reason } },
          { upsert: true, new: true }
        ).then(doc => {
          api.sendMessage(`⚠️ ${mentions[targetID]} এর ওয়ার্নিং: ${doc.warns}/3\nকারণ: ${reason}`, threadID);

          if (doc.warns >= 3) {
            api.removeUserFromGroup(targetID, threadID, () => {
              api.sendMessage(`🚫 ${mentions[targetID]} ৩টি ওয়ার্নিং পেয়ে বের হয়েছে।`, threadID);
            });
          }
        });
        break;
      }

      case 'warns': {
        const mentions = event.mentions;
        const targetID = mentions ? Object.keys(mentions)[0] : senderID;

        WarnModel.findOne({ userID: targetID, threadID }).then(doc => {
          if (!doc || doc.warns === 0) return api.sendMessage('✅ কোনো ওয়ার্নিং নেই।', threadID);
          api.sendMessage(`⚠️ ওয়ার্নিং: ${doc.warns}/3`, threadID);
        });
        break;
      }

      case 'clearwarns': {
        const mentions = event.mentions;
        if (!mentions) return api.sendMessage('❌ কাউকে মেনশন করো!', threadID);
        const targetID = Object.keys(mentions)[0];

        WarnModel.deleteOne({ userID: targetID, threadID }).then(() => {
          api.sendMessage(`✅ ${mentions[targetID]} এর সব ওয়ার্নিং মুছে গেছে।`, threadID);
        });
        break;
      }

      case 'announce': {
        if (!args) return api.sendMessage('❌ মেসেজ লেখো!', threadID);
        api.sendMessage(`📢 ঘোষণা:\n━━━━━━━━━━━━━━\n${args}\n━━━━━━━━━━━━━━`, threadID);
        break;
      }

      case 'say': {
        if (!args) return api.sendMessage('❌ মেসেজ লেখো!', threadID);
        api.sendMessage(args, threadID);
        break;
      }

      case 'pair':
      case 'shadi': {
        const mentions = event.mentions;
        const mentionList = Object.keys(mentions);

        if (mentionList.length < 2) {
          return api.sendMessage('❌ দুইজনকে মেনশন করো। যেমন: !pair @user1 @user2', threadID);
        }

        const user1 = mentionList[0];
        const user2 = mentionList[1];

        PairModel.findOneAndUpdate(
          { threadID, $or: [{ user1, user2 }, { user1: user2, user2: user1 }] },
          { user1, user2, pairedAt: new Date() },
          { upsert: true }
        ).then(() => {
          api.sendMessage(`💑 ${mentions[user1]} এবং ${mentions[user2]} এখন জোড়া! 🎉`, threadID);
        });
        break;
      }

      case 'unpair':
      case 'divorce': {
        const mentions = event.mentions;
        if (!mentions) return api.sendMessage('❌ কাউকে মেনশন করো!', threadID);
        const targetID = Object.keys(mentions)[0];

        PairModel.deleteOne({
          threadID,
          $or: [{ user1: targetID }, { user2: targetID }]
        }).then(result => {
          if (result.deletedCount === 0) {
            return api.sendMessage('❌ এই ইউজারের কোনো জোড়া নেই!', threadID);
          }
          api.sendMessage(`💔 ${mentions[targetID]} এর জোড়া ভেঙে গেছে।`, threadID);
        });
        break;
      }

      case 'couples': {
        PairModel.find({ threadID }).then(pairs => {
          if (pairs.length === 0) return api.sendMessage('💔 এই গ্রুপে কোনো জোড়া নেই।', threadID);

          const promises = pairs.map(pair => {
            return new Promise(resolve => {
              api.getUserInfo([pair.user1, pair.user2], (err, info) => {
                if (err) return resolve('');
                resolve(`💑 ${info[pair.user1]?.name || 'Unknown'} ❤️ ${info[pair.user2]?.name || 'Unknown'}`);
              });
            });
          });

          Promise.all(promises).then(results => {
            api.sendMessage(`💕 গ্রুপের জোড়া লিস্ট:\n${results.join('\n')}`, threadID);
          });
        });
        break;
      }

      case 'pic': {
        sendProfilePic(api, event, args);
        break;
      }

      case 'myid': {
        api.sendMessage(`🆔 তোমার UID: ${senderID}`, threadID);
        break;
      }

      case 'uptime': {
        const uptime = process.uptime();
        api.sendMessage(`⏱️ বট আপটাইম: ${formatUptime(uptime)}\n🤖 বট চলছে: ${new Date().toLocaleString('bn-BD')}`, threadID);
        break;
      }

      case 'botinfo': {
        const uptime = process.uptime();
        api.sendMessage(`🤖 বট: ${BOT_NAME}\n⏱️ অনলাইন: ${formatUptime(uptime)}\n👑 অ্যাডমিন: ${ADMIN_IDS.length} জন`, threadID);
        break;
      }

      case 'help': {
        api.sendMessage(getAdminHelp(), threadID);
        break;
      }
    }
    return; // অ্যাডমিন হলে এখানেই শেষ
  }

  // ===== মেম্বার কমান্ড (সবার জন্য) =====
  switch (command) {

    case 'help': {
      api.sendMessage(getMemberHelp(), threadID);
      break;
    }

    case 'rules': {
      api.sendMessage('📜 গ্রুপের নিয়মাবলী:\n১. সবাইকে সম্মান করো\n২. স্প্যাম করো না\n৩. খারাপ শব্দ ব্যবহার করো না\n৪. অ্যাডমিনের কথা মানো', threadID);
      break;
    }

    case 'pair':
    case 'shadi': {
      const mentions = event.mentions;
      const mentionList = Object.keys(mentions);

      if (mentionList.length < 2) {
        return api.sendMessage('❌ দুইজনকে মেনশন করো। যেমন: !pair @user1 @user2', threadID);
      }

      const user1 = mentionList[0];
      const user2 = mentionList[1];

      PairModel.findOneAndUpdate(
        { threadID, $or: [{ user1, user2 }, { user1: user2, user2: user1 }] },
        { user1, user2, pairedAt: new Date() },
        { upsert: true }
      ).then(() => {
        api.sendMessage(`💑 ${mentions[user1]} এবং ${mentions[user2]} এখন জোড়া! 🎉`, threadID);
      });
      break;
    }

    case 'unpair':
    case 'divorce': {
      const mentions = event.mentions;
      if (!mentions) return api.sendMessage('❌ কাউকে মেনশন করো!', threadID);
      const targetID = Object.keys(mentions)[0];

      PairModel.deleteOne({
        threadID,
        $or: [{ user1: targetID }, { user2: targetID }]
      }).then(result => {
        if (result.deletedCount === 0) {
          return api.sendMessage('❌ এই ইউজারের কোনো জোড়া নেই!', threadID);
        }
        api.sendMessage(`💔 ${mentions[targetID]} এর জোড়া ভেঙে গেছে।`, threadID);
      });
      break;
    }

    case 'pic': {
      sendProfilePic(api, event, args);
      break;
    }

    case 'myid': {
      api.sendMessage(`🆔 তোমার UID: ${senderID}`, threadID);
      break;
    }

    case 'uptime': {
      const uptime = process.uptime();
      api.sendMessage(`⏱️ বট আপটাইম: ${formatUptime(uptime)}`, threadID);
      break;
    }

    default: {
      // অ্যাডমিন কমান্ড মেম্বার দিলে ইগনোর
      const adminOnlyCommands = ['kick', 'ban', 'mute', 'unmute', 'warn', 'announce', 'say'];
      if (adminOnlyCommands.includes(command)) {
        return; // চুপচাপ ইগনোর করো
      }
      api.sendMessage('❓ অজানা কমান্ড। !help লিখো লিস্ট দেখতে।', threadID);
    }
  }
}

// ===== প্রোফাইল পিক পাঠানো =====
function sendProfilePic(api, event, args) {
  const mentions = event.mentions;
  const targetID = mentions ? Object.keys(mentions)[0] : event.senderID;

  api.getUserInfo(targetID, (err, info) => {
    if (err || !info[targetID]) {
      return api.sendMessage('❌ তথ্য পেতে পারছি না!', event.threadID);
    }

    const user = info[targetID];
    api.sendMessage({
      body: `🖼️ ${user.name} এর প্রোফাইল পিকচার`,
      url: user.profilePic || user.thumbSrc
    }, event.threadID);
  });
}

// ===== হেল্প মেনু =====
function getAdminHelp() {
  return `
👑 অ্যাডমিন কমান্ড:
━━━━━━━━━━━━━━
🛡️ মডারেশন:
• !kick @user
• !ban @user
• !mute @user 1h
• !unmute @user
• !warn @user [reason]
• !warns @user
• !clearwarns @user

📢 ম্যানেজমেন্ট:
• !announce [msg]
• !say [msg]

💑 সোশ্যাল:
• !pair @u1 @u2
• !unpair @user
• !couples

🖼️ অন্যান্য:
• !pic @user
• !myid
• !uptime
• !botinfo
• !help
  `;
}

function getMemberHelp() {
  return `
👥 মেম্বার কমান্ড:
━━━━━━━━━━━━━━
• !pair @user1 @user2 — জোড়া বানানো
• !unpair @user — জোড়া ভাঙা
• !pic @user — প্রোফাইল পিক
• !myid — তোমার UID
• !uptime — বট কতক্ষণ চলছে
• !rules — গ্রুপের নিয়ম
• !help — এই লিস্ট
  `;
}

// ===== সময় পার্সিং =====
function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return 3600000; // ডিফল্ট ১ ঘণ্টা

  const num = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return num * 1000;
    case 'm': return num * 60000;
    case 'h': return num * 3600000;
    case 'd': return num * 86400000;
    default: return 3600000;
  }
}

// ===== Uptime ফরম্যাট =====
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  let result = '';
  if (days > 0) result += `${days} দিন `;
  if (hours > 0) result += `${hours} ঘণ্টা `;
  if (mins > 0) result += `${mins} মিনিট `;
  result += `${secs} সেকেন্ড`;
  return result;
}

// ===== বট বন্ধ হওয়ার সময় =====
process.on('SIGINT', () => {
  console.log('🛑 বট বন্ধ হচ্ছে...');
  mongoose.disconnect();
  process.exit(0);
});
