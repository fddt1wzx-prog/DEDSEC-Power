const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));

// ============================
// الثوابت والإعدادات
// ============================
const SECRET_TOKEN = "DEDSEC_SECURE_2025_X7K9P2"; // يجب تطابق المفتاح مع السكربت

const PLAYER_EXPIRE_SECONDS = 60;        // حذف اللاعب بعد 60 ثانية من آخر ping
const COMMAND_EXPIRE_SECONDS = 30;       // حذف الأمر بعد 30 ثانية
const MAX_COMMANDS_PER_PLAYER = 20;      // حد أقصى للأوامر المخزنة لكل لاعب

// ============================
// التخزين الداخلي
// ============================
const players = new Map();          // key: username (string) -> { userId, placeId, jobId, lastPing }
const commands = new Map();         // key: targetUsername (string) -> array of { cmd, commander, time, extra? }

// ============================
// دوال مساعدة
// ============================
function cleanExpiredPlayers() {
    const now = Date.now();
    for (const [name, data] of players) {
        if (now - data.lastPing > PLAYER_EXPIRE_SECONDS * 1000) {
            players.delete(name);
        }
    }
}

function cleanExpiredCommands() {
    const now = Date.now();
    for (const [target, cmdList] of commands) {
        const filtered = cmdList.filter(cmd => now - cmd.time <= COMMAND_EXPIRE_SECONDS * 1000);
        if (filtered.length === 0) {
            commands.delete(target);
        } else {
            commands.set(target, filtered);
        }
    }
}

// تنظيف كل 30 ثانية
setInterval(() => {
    cleanExpiredPlayers();
    cleanExpiredCommands();
}, 30000);

// ============================
// نقاط النهاية (Endpoints)
// ============================

// 1. Ping – تسجيل تواجد اللاعب
app.post('/ping', (req, res) => {
    const { username, userId, placeId, jobId, token } = req.body;
    if (token !== SECRET_TOKEN) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    if (!username || !userId) {
        return res.status(400).json({ error: 'Missing username or userId' });
    }

    players.set(username, {
        userId,
        placeId: placeId || '',
        jobId: jobId || '',
        lastPing: Date.now()
    });

    res.status(200).json({ status: 'ok' });
});

// 2. إرسال أمر (من أي شخص، لكن العميل سيتحقق من القيادة)
app.post('/update', (req, res) => {
    const { username, userId, message, time, token } = req.body;
    if (token !== SECRET_TOKEN) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    if (!message || !time) {
        return res.status(400).json({ error: 'Missing message or time' });
    }

    // تحليل الرسالة لتحديد الهدف
    const parts = message.split(' ');
    const cmd = parts[0];
    let target = 'all';
    let extra = null;

    if (cmd === 'jointome') {
        if (parts.length >= 4) {
            target = parts[1];
            extra = { placeId: parts[2], jobId: parts[3] };
        } else {
            return res.status(400).json({ error: 'Invalid jointome format' });
        }
    } else if (cmd === 'custom') {
        if (parts.length >= 3) {
            target = parts[1];
            const cmdText = parts.slice(2).join(' ');
            extra = { customCommand: cmdText };
        } else {
            return res.status(400).json({ error: 'Invalid custom format' });
        }
    } else {
        if (parts.length >= 2) {
            target = parts[1];
        } else {
            target = 'all';
        }
    }

    // تخزين الأمر
    const now = Date.now();
    let cmdList = commands.get(target) || [];
    cmdList = cmdList.filter(c => now - c.time <= COMMAND_EXPIRE_SECONDS * 1000);
    if (cmdList.length >= MAX_COMMANDS_PER_PLAYER) {
        cmdList.shift();
    }
    cmdList.push({
        cmd: cmd,
        commander: username,
        userId: userId,   // نمرر userId للعميل ليتحقق من القيادة
        time: now,
        extra: extra
    });
    commands.set(target, cmdList);

    res.status(200).json({ status: 'ok' });
});

// 3. جلب الأوامر الجديدة للمستخدم (data)
app.get('/data', (req, res) => {
    const { username, token } = req.query;
    if (token !== SECRET_TOKEN) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    if (!username) {
        return res.status(400).json({ error: 'Missing username' });
    }

    const now = Date.now();
    let resultCommands = [];

    // أوامر خاصة باللاعب
    const playerCmds = commands.get(username);
    if (playerCmds) {
        const latest = playerCmds[playerCmds.length - 1];
        if (latest && now - latest.time <= COMMAND_EXPIRE_SECONDS * 1000) {
            resultCommands.push(latest);
        }
    }

    // أوامر 'all'
    const allCmds = commands.get('all');
    if (allCmds) {
        const latestAll = allCmds[allCmds.length - 1];
        if (latestAll && now - latestAll.time <= COMMAND_EXPIRE_SECONDS * 1000) {
            if (resultCommands.length === 0) {
                resultCommands.push(latestAll);
            }
        }
    }

    if (resultCommands.length > 0) {
        const cmdToSend = resultCommands[0];
        // حذف الأمر بعد إرساله
        if (cmdToSend.target === 'all') {
            const allList = commands.get('all');
            if (allList) {
                const idx = allList.findIndex(c => c.time === cmdToSend.time && c.cmd === cmdToSend.cmd);
                if (idx !== -1) allList.splice(idx, 1);
                if (allList.length === 0) commands.delete('all');
            }
        } else {
            const playerList = commands.get(username);
            if (playerList) {
                const idx = playerList.findIndex(c => c.time === cmdToSend.time && c.cmd === cmdToSend.cmd);
                if (idx !== -1) playerList.splice(idx, 1);
                if (playerList.length === 0) commands.delete(username);
            }
        }
        // إرسال الأمر مع userId
        return res.status(200).json({
            time: cmdToSend.time,
            username: cmdToSend.commander,
            userId: cmdToSend.userId,
            message: cmdToSend.cmd + (cmdToSend.extra ? ' ' + JSON.stringify(cmdToSend.extra) : ''),
            token: SECRET_TOKEN
        });
    } else {
        return res.status(204).send();
    }
});

// 4. قائمة جميع اللاعبين المسجلين
app.get('/players', (req, res) => {
    const { token } = req.query;
    if (token !== SECRET_TOKEN) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    const playerNames = Array.from(players.keys());
    res.status(200).json(playerNames);
});

// 5. الحصول على معلومات لاعب معين (للانضمام)
app.get('/player/:username', (req, res) => {
    const { token } = req.query;
    if (token !== SECRET_TOKEN) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    const username = req.params.username;
    const playerData = players.get(username);
    if (!playerData) {
        return res.status(404).json({ error: 'Player not found' });
    }
    res.status(200).json({
        placeId: playerData.placeId,
        jobId: playerData.jobId
    });
});

// ============================
// تشغيل الخادم
// ============================
app.listen(PORT, () => {
    console.log(`DEDSEC Server v2 running on port ${PORT}`);
    console.log(`Memory limit: ~${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
});
