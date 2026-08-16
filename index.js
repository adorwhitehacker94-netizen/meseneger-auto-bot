const login = require('fca-priyansh');
const fs = require('fs');
const express = require('express');
require('dotenv').config();

// ===== তোমার কনফিগারেশন =====
const PREFIX = '!';
const ADMIN_IDS = ['61581910887562'];
const BOT_NAME = 'MyBot';

// ===== JSON ডেটা ফাইল =====
const DATA_FILE = './data.json';

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('❌ Data load error:', e.message);
  }
  return { pairs: [], warns: {}, mutes: {} };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('❌ Data save error:', e.message);
  }
}

let botData = loadData();

// ===== Express সার্ভার =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  const uptime = process.uptime();
  res.send(`🤖 বট চলছে!<br>⏱️ Uptime: ${formatUptime(uptime)}`);
});

app.listen(PORT, () => {
  console.log(`🌐 সার্ভার চলছে পোর্ট ${PORT} এ`);
});

// ===== Self-Ping (২৪/৭) =====
setInterval(() => {
  const url = process.env.RENDER_URL || process.env.RAILWAY_STATIC_URL;
  if (url) {
    const cleanUrl = url.startsWith('http') ? url : `https://${url}`;
    fetch(cleanUrl)
      .then(res => console.log(`💓 Self-ping: ${res.status}`))
      .catch(err => console.error('❌ Ping failed:', err.message));
  }
}, 5 * 60 * 1000);

// ===== বট লগইন =====
login({
  appState: JSON.parse(fs.readFileSync('appstate.json', 'utf8'))
}, (err, api) => {
  if (err) return console.error('❌ Login Error:', err);

  api.setOptions({ listenEvents: true, selfListen: false, logLevel: 'silent' });
  console.log(`✅ ${BOT_NAME} লগইন সফল!`);

  api.listenMqtt((err, event) => {
    if (err) return console.error('❌ Listen Error:', err);
    if (!event) return;

    // ওয়েলকাম মেসেজ
    if (event.logMessageType === 'log:subscribe') {
      const userName = event.logMessageData.addedParticipants?.[0]?.fullName || 'নতুন মেম্বার';
      api.sendMessage(`🎉 স্বাগতম ${userName}!`, event.threadID);
      return;
    }

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
        if (ADMIN_IDS.includes(targetID)) return api.sendMessage('❌ অ্যাডমিনকে কিক করা যাবে না!', threadID);
        api.removeUserFromGroup(targetID, threadID, (err) => {
          if (err) return api.sendMessage('❌ কিক করতে পারছি না!', threadID);
          api.sendMessage('✅ ব্যবহারকারীকে বের করা হয়েছে।', threadID);
        });
        break;
      }

      case 'ban': {
        const mentions = event.mentions;
        if (!mentions || Object.keys(mentions).length === 0) return api.sendMessage('❌ কাউকে মেনশন করো!', threadID);
        const targetID = Object.keys(mentions)[0];
        if (ADMIN_IDS.includes(targetID)) return api.sendMessage('❌ অ্যাডমিনকে ব্যান করা যাবে না!', threadID);
        api.removeUserFromGroup(targetID, threadID, (err) => {
          if (err) return api.sendMessage('❌ ব্যান করতে পারছি না!', threadID);
          api.sendMessage(`🚫 ${mentions[targetID]} ব্যান হয়েছে।`, threadID);
        });
        break;
      }

      case 'mute': {
        const mentions = event.mentions;
        if (!mentions || Object.keys(mentions).length === 0) return api.sendMessage('❌ কাউকে মেনশন করো! যেমন: !mute @user 1h', threadID);
        const targetID = Object.keys(mentions)[0];
        const duration = args.split(' ')[1] || '1h';
        const ms = parseDuration(duration);
        const key = `${threadID}_${targetID}`;
        botData.mutes[key] = Date.now() + ms;
        saveData(botData);
        api.sendMessage(`🔇 ${mentions[targetID]} ${duration} এর জন্য মিউট।`, threadID);
        break;
      }

      case 'unmute': {
        const mentions = event.mentions;
        if (!mentions) return api.sendMessage('❌ কাউকে মেনশন করো!', threadID);
        const targetID = Object.keys(mentions)[0];
        const key = `${threadID}_${targetID}`;
        delete botData.mutes[key];
        saveData(botData);
        api.sendMessage(`🔊 ${mentions[targetID]} আনমিউট হয়েছে।`, threadID);
        break;
      }

      case 'warn': {
        const mentions = event.mentions;
        if (!mentions) return api.sendMessage('❌ কাউকে মেনশন করো!', threadID);
        const targetID = Object.keys(mentions)[0];
        const reason = args.split(' ').slice(1).join(' ') || 'কারণ নেই';
        const key = `${threadID}_${targetID}`;
        if (!botData.warns[key]) botData.warns[key] = { count: 0, reasons: [] };
        botData.warns[key].count++;
        botData.warns[key].reasons.push(reason);
        saveData(botData);
        api.sendMessage(`⚠️ ${mentions[targetID]} ওয়ার্নিং: ${botData.warns[key].count}/3\nকারণ: ${reason}`, threadID);
        if (botData.warns[key].count >= 3) {
          api.removeUserFromGroup(targetID, threadID, () => {
            api.sendMessage(`🚫 ${mentions[targetID]} ৩ ওয়ার্নিং পেয়ে বের হয়েছে।`, threadID);
          });
        }
        break;
      }

      case 'warns': {
        const mentions = event.mentions;
        const targetID = mentions ? Object.keys(mentions)[0] : senderID;
        const key = `${threadID}_${targetID}`;
        const w = botData.warns[key];
        if (!w || w.count === 0) return api.sendMessage('✅ কোনো ওয়ার্নিং নেই।', threadID);
        api.sendMessage(`⚠️ ওয়ার্নিং: ${w.count}/3`, threadID);
        break;
      }

      case 'clearwarns': {
        const mentions = event.mentions;
        if (!mentions) return api.sendMessage('❌ কাউকে মেনশন করো!', threadID);
        const targetID = Object.keys(mentions)[0];
        const key = `${threadID}_${targetID}`;
        delete botData.warns[key];
        saveData(botData);
        api.sendMessage(`✅ ওয়ার্নিং মুছে গেছে।`, threadID);
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
        const list = Object.keys(mentions);
        if (list.length < 2) return api.sendMessage('❌ দুইজনকে মেনশন করো। !pair @u1 @u2', threadID);
        botData.pairs.push({ threadID, user1: list[0], user2: list[1], date: new Date().toISOString() });
        saveData(botData);
        api.sendMessage(`💑 ${mentions[list[0]]} ❤️ ${mentions[list[1]]} জোড়া হয়েছে! 🎉`, threadID);
        break;
      }

      case 'unpair':
      case 'divorce': {
        const mentions = event.mentions;
        if (!mentions) return api.sendMessage('❌ কাউকে মেনশন করো!', threadID);
        const targetID = Object.keys(mentions)[0];
        const before = botData.pairs.length;
        botData.pairs = botData.pairs.filter(p => p.threadID !== threadID || (p.user1 !== targetID && p.user2 !== targetID));
        saveData(botData);
        if (botData.pairs.length < before) {
          api.sendMessage(`💔 জোড়া ভেঙে গেছে।`, threadID);
        } else {
          api.sendMessage('❌ কোনো জোড়া পাওয়া যায়নি!', threadID);
        }
        break;
      }

      case 'couples': {
        const groupPairs = botData.pairs.filter(p => p.threadID === threadID);
        if (groupPairs.length === 0) return api.sendMessage('💔 এই গ্রুপে কোনো জোড়া নেই।', threadID);
        const ids = [...new Set(groupPairs.flatMap(p => [p.user1, p.user2]))];
        api.getUserInfo(ids, (err, info) => {
          if (err) return api.sendMessage('❌ তথ্য পেতে পারছি না!', threadID);
          const lines = groupPairs.map(p => {
            const n1 = info[p.user1]?.name || 'Unknown';
            const n2 = info[p.user2]?.name || 'Unknown';
            return `💑 ${n1} ❤️ ${n2}`;
          });
          api.sendMessage(`💕 জোড়া লিস্ট:\n${lines.join('\n')}`, threadID);
        });
        break;
      }

      case 'pic': { sendProfilePic(api, event); break; }
      case 'myid': { api.sendMessage(`🆔 UID: ${senderID}`, threadID); break; }
      case 'uptime': { api.sendMessage(`⏱️ আপটাইম: ${formatUptime(process.uptime())}`, threadID); break; }
      case 'botinfo': { api.sendMessage(`🤖 ${BOT_NAME}\n⏱️ ${formatUptime(process.uptime())}`, threadID); break; }
      case 'help': { api.sendMessage(getAdminHelp(), threadID); break; }
    }
    return;
  }

  // ===== মেম্বার কমান্ড =====
  switch (command) {
    case 'help': { api.sendMessage(getMemberHelp(), threadID); break; }
    case 'rules': { api.sendMessage('📜 নিয়ম:\n১. সম্মান করো\n২. স্প্যাম করো না\n৩. খারাপ শব্দ নয়\n৪. অ্যাডমিনের কথা মানো', threadID); break; }
    case 'pair':
    case 'shadi': {
      const mentions = event.mentions;
      const list = Object.keys(mentions);
      if (list.length < 2) return api.sendMessage('❌ দুইজনকে মেনশন করো। !pair @u1 @u2', threadID);
      botData.pairs.push({ threadID, user1: list[0], user2: list[1], date: new Date().toISOString() });
      saveData(botData);
      api.sendMessage(`💑 ${mentions[list[0]]} ❤️ ${mentions[list[1]]} জোড়া! 🎉`, threadID);
      break;
    }
    case 'unpair':
    case 'divorce': {
      const mentions = event.mentions;
      if (!mentions) return api.sendMessage('❌ কাউকে মেনশন করো!', threadID);
      const targetID = Object.keys(mentions)[0];
      const before = botData.pairs.length;
      botData.pairs = botData.pairs.filter(p => p.threadID !== threadID || (p.user1 !== targetID && p.user2 !== targetID));
      saveData(botData);
      if (botData.pairs.length < before) api.sendMessage(`💔 জোড়া ভেঙে গেছে।`, threadID);
      else api.sendMessage('❌ কোনো জোড়া নেই!', threadID);
      break;
    }
    case 'pic': { sendProfilePic(api, event); break; }
    case 'myid': { api.sendMessage(`🆔 UID: ${senderID}`, threadID); break; }
    case 'uptime': { api.sendMessage(`⏱️ আপটাইম: ${formatUptime(process.uptime())}`, threadID); break; }
    default: {
      if (['kick','ban','mute','unmute','warn','announce','say'].includes(command)) return;
      api.sendMessage('❓ অজানা কমান্ড। !help লিখো।', threadID);
    }
  }
}

// ===== প্রোফাইল পিক =====
function sendProfilePic(api, event) {
  const mentions = event.mentions;
  const targetID = mentions ? Object.keys(mentions)[0] : event.senderID;
  api.getUserInfo(targetID, (err, info) => {
    if (err || !info[targetID]) return api.sendMessage('❌ তথ্য পাচ্ছি না!', event.threadID);
    const user = info[targetID];
    api.sendMessage({ body: `🖼️ ${user.name}`, url: user.profilePic || user.thumbSrc }, event.threadID);
  });
}

// ===== হেল্প মেনু =====
function getAdminHelp() {
  return `👑 অ্যাডমিন কমান্ড:
━━━━━━━━━━━━━━
🛡️ !kick @user | !ban @user
🔇 !mute @user 1h | !unmute @user
⚠️ !warn @user | !warns @user | !clearwarns @user
📢 !announce [msg] | !say [msg]
💑 !pair @u1 @u2 | !unpair @user | !couples
🖼️ !pic @user | !myid | !uptime | !botinfo | !help`;
}

function getMemberHelp() {
  return `👥 মেম্বার কমান্ড:
━━━━━━━━━━━━━━
💑 !pair @u1 @u2 | !unpair @user
🖼️ !pic @user | !myid | !uptime
📜 !rules | !help`;
}

// ===== সময় পার্সিং =====
function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return 3600000;
  const num = parseInt(match[1]);
  switch (match[2]) {
    case 's': return num * 1000;
    case 'm': return num * 60000;
    case 'h': return num * 3600000;
    case 'd': return num * 86400000;
    default: return 3600000;
  }
}

// ===== Uptime ফরম্যাট =====
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  let r = '';
  if (d > 0) r += `${d} দিন `;
  if (h > 0) r += `${h} ঘণ্টা `;
  if (m > 0) r += `${m} মিনিট `;
  r += `${s} সেকেন্ড`;
  return r;
}

process.on('SIGINT', () => { console.log('🛑 বট বন্ধ...'); process.exit(0); });
