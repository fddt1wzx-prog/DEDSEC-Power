const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

// خريطة userId -> { ws, username, placeId, jobId }
const clients = new Map();
// خريطة عكسية username -> userId
const usernameToId = new Map();

const server = http.createServer((req, res) => {
    // نترك HTTP endpoint للـ fallback فقط
    if (req.method === 'POST' && req.url === '/ping') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                // تحديث البيانات (للـ fallback)
                if (data.userId) {
                    clients.set(data.userId, {
                        ws: null, // لا يوجد ws في HTTP
                        username: data.username,
                        placeId: data.placeId,
                        jobId: data.jobId
                    });
                    usernameToId.set(data.username, data.userId);
                }
                res.writeHead(200);
                res.end('ok');
            } catch(e) {
                res.writeHead(400);
                res.end('bad request');
            }
        });
    } else if (req.method === 'GET' && req.url === '/players') {
        // قائمة اللاعبين (للـ fallback)
        const list = Array.from(clients.values()).map(c => c.username);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(list));
    } else {
        res.writeHead(404);
        res.end();
    }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    let currentUserId = null;

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch(e) {
            return;
        }

        // تسجيل / تحديث
        if (data.type === 'ping' && data.userId) {
            currentUserId = data.userId;
            clients.set(data.userId, {
                ws: ws,
                username: data.username,
                placeId: data.placeId,
                jobId: data.jobId
            });
            usernameToId.set(data.username, data.userId);
        }
        // أمر من قائد (لا نتحقق هنا، العميل سيفعل)
        else if (data.type === 'command' && data.userId) {
            const { username, userId, targetName, command, extra } = data;
            
            // تحديث بيانات المرسل إن لزم
            if (!clients.has(userId)) {
                clients.set(userId, { ws, username, placeId: null, jobId: null });
                usernameToId.set(username, userId);
            }

            // إذا الأمر موجه لشخص محدد
            if (targetName && targetName !== 'all') {
                const targetId = usernameToId.get(targetName);
                if (targetId && clients.has(targetId)) {
                    const targetClient = clients.get(targetId);
                    if (targetClient.ws && targetClient.ws.readyState === WebSocket.OPEN) {
                        targetClient.ws.send(JSON.stringify({
                            userId: userId,
                            username: username,
                            targetName: targetName,
                            command: command,
                            extra: extra || {}
                        }));
                    }
                }
            } else {
                // بث للجميع ما عدا المرسل
                const msg = JSON.stringify({
                    userId: userId,
                    username: username,
                    targetName: 'all',
                    command: command,
                    extra: extra || {}
                });
                clients.forEach((client, id) => {
                    if (id !== userId && client.ws && client.ws.readyState === WebSocket.OPEN) {
                        client.ws.send(msg);
                    }
                });
            }
        }
        // طلب قائمة اللاعبين عبر WS
        else if (data.type === 'get_players') {
            const list = Array.from(clients.values()).map(c => c.username);
            ws.send(JSON.stringify({ type: 'playerlist', players: list }));
        }
    });

    ws.on('close', () => {
        if (currentUserId) {
            const client = clients.get(currentUserId);
            if (client) {
                usernameToId.delete(client.username);
                clients.delete(currentUserId);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
