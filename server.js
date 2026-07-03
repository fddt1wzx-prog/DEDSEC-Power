const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

let commands = [];
let players = {};
let pendingRequests = [];

// إضافة أمر جديد
function addCommand(username, userId, message, time) {
    const cmd = { username, userId, message, time: time || Date.now() };
    commands.push(cmd);
    if (commands.length > 2000) commands = commands.slice(-2000); // زيادة الاحتفاظ

    // إعلام المعلقات
    const toResolve = pendingRequests.slice();
    pendingRequests = [];
    for (const { res, last } of toResolve) {
        const newCmds = commands.filter(c => c.time > last);
        if (newCmds.length > 0) {
            res.json({ commands: newCmds });
        } else {
            pendingRequests.push({ res, last });
        }
    }
}

app.post('/update', (req, res) => {
    const { username, userId, message, time } = req.body;
    if (!username || !userId || !message) {
        return res.status(400).json({ error: 'Missing fields' });
    }
    addCommand(username, userId, message, time || Date.now());
    res.json({ status: 'ok' });
});

// Long Polling مع timeout 35 ثانية
app.get('/data', (req, res) => {
    const last = parseInt(req.query.last) || 0;
    const newCmds = commands.filter(cmd => cmd.time > last);
    if (newCmds.length > 0) {
        return res.json({ commands: newCmds });
    }
    const timeout = setTimeout(() => {
        const index = pendingRequests.findIndex(p => p.res === res);
        if (index !== -1) pendingRequests.splice(index, 1);
        res.json({ commands: [] });
    }, 35000); // 35 ثانية

    pendingRequests.push({ res, last, timeout });
});

app.post('/ping', (req, res) => {
    const { username, userId, placeId, jobId } = req.body;
    if (username && userId) {
        players[username] = { userId, placeId, jobId, lastSeen: Date.now() };
    }
    res.json({ status: 'ok' });
});

// قائمة اللاعبين مع تنظيف بعد 90 ثانية (بدلاً من 60)
app.get('/players', (req, res) => {
    const now = Date.now();
    for (const name in players) {
        if (now - players[name].lastSeen > 90000) { // 90 ثانية
            delete players[name];
        }
    }
    res.json(Object.keys(players));
});

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
