const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// تخزين الأوامر مع الوقت
let commands = [];
let players = {}; // تخزين معلومات اللاعبين (آخر تحديث)

// دالة لإضافة أمر جديد
function addCommand(username, userId, message, time) {
    commands.push({
        username,
        userId,
        message,
        time: time || Date.now()
    });
    // الاحتفاظ بآخر 1000 أمر فقط لتوفير الذاكرة
    if (commands.length > 1000) {
        commands = commands.slice(-1000);
    }
}

// نقطة نهاية لإرسال الأوامر (من القادة)
app.post('/update', (req, res) => {
    const { username, userId, message, time } = req.body;
    if (!username || !userId || !message) {
        return res.status(400).json({ error: 'Missing fields' });
    }
    const cmdTime = time || Date.now();
    addCommand(username, userId, message, cmdTime);
    res.json({ status: 'ok' });
});

// نقطة نهاية لجلب الأوامر الجديدة فقط (مع last)
app.get('/data', (req, res) => {
    const last = parseInt(req.query.last) || 0;
    const newCommands = commands.filter(cmd => cmd.time > last);
    res.json({ commands: newCommands });
});

// نقطة نهاية لتحديث حالة اللاعب (ping)
app.post('/ping', (req, res) => {
    const { username, userId, placeId, jobId } = req.body;
    if (username && userId) {
        players[username] = {
            userId,
            placeId,
            jobId,
            lastSeen: Date.now()
        };
    }
    res.json({ status: 'ok' });
});

// نقطة نهاية للحصول على قائمة اللاعبين المسجلين
app.get('/players', (req, res) => {
    // حذف اللاعبين غير النشطين منذ أكثر من 60 ثانية
    const now = Date.now();
    for (const name in players) {
        if (now - players[name].lastSeen > 60000) {
            delete players[name];
        }
    }
    res.json(Object.keys(players));
});

// نقطة نهاية للحصول على معلومات لاعب معين (للـ jointotarget)
app.get('/player/:name', (req, res) => {
    const name = req.params.name;
    const info = players[name];
    if (info) {
        res.json({
            placeId: info.placeId,
            jobId: info.jobId
        });
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// نقطة نهاية للتحقق من صحة السيرفر (اختياري)
app.get('/', (req, res) => {
    res.send('DEDSEC Server Running');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
