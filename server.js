const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const SECRET_TOKEN = "DEDSEC_SECURE_2025_X7K9P2";

// تخزين العملاء: username -> { ws, userId, placeId, jobId, lastPing }
const clients = new Map();

// تخزين الأوامر المعلقة (في حال كان العميل غير متصل)
const pendingCommands = new Map(); // key: username أو 'all', value: command object

app.use(express.json({ limit: '1mb' }));

// ---------- HTTP endpoints ----------

// 1. Ping - تسجيل اللاعب (يُستخدم لتحديث البيانات)
app.post('/ping', (req, res) => {
    const { username, userId, placeId, jobId, token } = req.body;
    if (token !== SECRET_TOKEN) return res.status(401).json({ error: 'Invalid token' });
    if (!username || !userId) return res.status(400).json({ error: 'Missing username or userId' });

    // تحديث بيانات العميل إذا كان متصلاً عبر WebSocket
    const client = clients.get(username);
    if (client) {
        client.userId = userId;
        client.placeId = placeId || '';
        client.jobId = jobId || '';
        client.lastPing = Date.now();
    } else {
        // إذا لم يكن متصلاً، نخزن البيانات مؤقتاً لحين اتصاله
        clients.set(username, {
            ws: null,
            userId,
            placeId: placeId || '',
            jobId: jobId || '',
            lastPing: Date.now()
        });
    }
    res.status(200).json({ status: 'ok' });
});

// 2. إرسال أمر (من قائد)
app.post('/update', (req, res) => {
    const { username, userId, message, time, token } = req.body;
    if (token !== SECRET_TOKEN) return res.status(401).json({ error: 'Invalid token' });
    if (!message || !time) return res.status(400).json({ error: 'Missing message or time' });

    // تحليل الأمر
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

    // إنشاء كائن الأمر
    const commandData = {
        time: time,
        username: username,
        userId: userId,
        message: message,
        token: SECRET_TOKEN
    };

    // دالة لإرسال الأمر إلى عميل معين
    const sendToClient = (targetUsername) => {
        const client = clients.get(targetUsername);
        if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(commandData));
            return true;
        } else {
            // تخزين الأمر معلقاً
            pendingCommands.set(targetUsername, commandData);
            return false;
        }
    };

    if (target === 'all') {
        // إرسال لجميع العملاء المتصلين
        let sent = 0;
        for (const [name, client] of clients) {
            if (client.ws && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify(commandData));
                sent++;
            }
        }
        // إذا لم يتم الإرسال لأحد، نخزنه للأمر 'all'
        if (sent === 0) {
            pendingCommands.set('all', commandData);
        }
        // إذا كان هناك عملاء غير متصلين، نخزن لهم أيضاً (لكن الأفضل تخزين لـ all فقط)
    } else {
        // إرسال لهدف محدد
        sendToClient(target);
    }

    res.status(200).json({ status: 'ok' });
});

// 3. قائمة اللاعبين (للواجهة)
app.get('/players', (req, res) => {
    const { token } = req.query;
    if (token !== SECRET_TOKEN) return res.status(401).json({ error: 'Invalid token' });
    const playerNames = Array.from(clients.keys());
    res.status(200).json(playerNames);
});

// 4. الحصول على معلومات لاعب (لـ jointotarget)
app.get('/player/:username', (req, res) => {
    const { token } = req.query;
    if (token !== SECRET_TOKEN) return res.status(401).json({ error: 'Invalid token' });
    const username = req.params.username;
    const client = clients.get(username);
    if (!client) return res.status(404).json({ error: 'Player not found' });
    res.status(200).json({
        placeId: client.placeId || '',
        jobId: client.jobId || ''
    });
});

// ---------- WebSocket ----------
wss.on('connection', (ws, req) => {
    let registeredUsername = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'register') {
                if (data.token !== SECRET_TOKEN) {
                    ws.close(1008, 'Invalid token');
                    return;
                }
                const username = data.username;
                if (!username) {
                    ws.close(1008, 'Missing username');
                    return;
                }
                // تسجيل العميل
                registeredUsername = username;
                // إذا كان هناك بيانات قديمة (من ping) ندمجها
                const existing = clients.get(username) || {};
                clients.set(username, {
                    ws: ws,
                    userId: existing.userId || 0,
                    placeId: existing.placeId || '',
                    jobId: existing.jobId || '',
                    lastPing: Date.now()
                });

                // إرسال الأوامر المعلقة لهذا المستخدم أو 'all'
                if (pendingCommands.has(username)) {
                    ws.send(JSON.stringify(pendingCommands.get(username)));
                    pendingCommands.delete(username);
                }
                if (pendingCommands.has('all')) {
                    ws.send(JSON.stringify(pendingCommands.get('all')));
                    pendingCommands.delete('all');
                }
                // تأكيد التسجيل
                ws.send(JSON.stringify({ type: 'registered', status: 'ok' }));
            }
        } catch (e) {
            // تجاهل الأخطاء
        }
    });

    ws.on('close', () => {
        if (registeredUsername) {
            // لا نحذف العميل فوراً، بل نضع ws = null ليظل في القائمة
            const client = clients.get(registeredUsername);
            if (client) {
                client.ws = null;
                client.lastPing = Date.now(); // تحديث الوقت لمنع حذفه
            }
        }
    });

    ws.on('error', (err) => {
        // تجاهل الأخطاء
    });
});

// تنظيف العملاء غير النشطين (لم يرسلوا ping منذ 60 ثانية)
setInterval(() => {
    const now = Date.now();
    for (const [name, client] of clients) {
        if (now - client.lastPing > 60000) {
            // إذا كان متصلاً، نغلق الاتصال
            if (client.ws && client.ws.readyState === WebSocket.OPEN) {
                client.ws.close();
            }
            clients.delete(name);
        }
    }
}, 30000);

// تنظيف الأوامر المعلقة القديمة (أكثر من 30 ثانية)
setInterval(() => {
    const now = Date.now();
    for (const [key, cmd] of pendingCommands) {
        if (now - cmd.time > 30000) {
            pendingCommands.delete(key);
        }
    }
}, 15000);

server.listen(PORT, () => {
    console.log(`DEDSEC Server v2 with WebSocket running on port ${PORT}`);
});            target = parts[1];
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
