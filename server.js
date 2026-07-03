const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// تخزين الأوامر مع الوقت
let commands = [];
let players = {};

// تخزين المعلقات (pending requests) لكل عميل
let pendingRequests = [];

// دالة لإضافة أمر جديد
function addCommand(username, userId, message, time) {
    const cmd = {
        username,
        userId,
        message,
        time: time || Date.now()
    };
    commands.push(cmd);
    if (commands.length > 1000) commands = commands.slice(-1000);

    // إعلام جميع المعلقات بوجود أمر جديد
    const toResolve = pendingRequests.slice();
    pendingRequests = [];
    for (const { res, last } of toResolve) {
        const newCmds = commands.filter(c => c.time > last);
        if (newCmds.length > 0) {
            res.json({ commands: newCmds });
        } else {
            // إذا لم توجد أوامر جديدة (ربما تمت إزالتها)، نعيد المعلقة
            pendingRequests.push({ res, last });
        }
    }
}

// نقطة نهاية لإرسال الأوامر
app.post('/update', (req, res) => {
    const { username, userId, message, time } = req.body;
    if (!username || !userId || !message) {
        return res.status(400).json({ error: 'Missing fields' });
    }
    const cmdTime = time || Date.now();
    addCommand(username, userId, message, cmdTime);
    res.json({ status: 'ok' });
});

// نقطة نهاية Long Polling
app.get('/data', (req, res) => {
    const last = parseInt(req.query.last) || 0;
    // البحث عن أوامر جديدة
    const newCmds = commands.filter(cmd => cmd.time > last);
    if (newCmds.length > 0) {
        return res.json({ commands: newCmds });
    }
    // لا توجد أوامر جديدة → نعلق الطلب حتى 30 ثانية أو حتى ظهور أمر
    const timeout = setTimeout(() => {
        // إزالة الطلب من المعلقات وإرجاع قائمة فارغة
        const index = pendingRequests.findIndex(p => p.res === res);
        if (index !== -1) pendingRequests.splice(index, 1);
        res.json({ commands: [] });
    }, 30000); // 30 ثانية كحد أقصى

    pendingRequests.push({
        res,
        last,
        timeout
    });
});

// نقطة نهاية ping (تحديث اللاعبين)
app.post('/ping', (req, res) => {
    const { username, userId, placeId, jobId } = req.body;
    if (username && userId) {
        players[username] = { userId, placeId, jobId, lastSeen: Date.now() };
    }
    res.json({ status: 'ok' });
});

// قائمة اللاعبين
app.get('/players', (req, res) => {
    const now = Date.now();
    for (const name in players) {
        if (now - players[name].lastSeen > 60000) delete players[name];
    }
    res.json(Object.keys(players));
});

// معلومات لاعب معين
app.get('/player/:name', (req, res) => {
    const info = players[req.params.name];
    if (info) {
        res.json({ placeId: info.placeId, jobId: info.jobId });
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

app.get('/', (req, res) => res.send('DEDSEC Server Running'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
