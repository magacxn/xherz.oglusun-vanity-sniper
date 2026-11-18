//kullanmayın kullandırtmayın
import http2 from 'http2';
import WebSocket from 'ws';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('config.json'));
const LISTENER_TOKEN = config.listener_token;
const PATCHER_TOKEN = config.token;
const GUILD_ID = '1163506502481481779';
const DISCORD_HOST = 'canary.discord.com';
const SESSION_COUNT = 22;

const activeSessions = [];
const vanityPayloads = new Map();
let sniped = false;


const IDENTIFY_PAYLOAD = JSON.stringify({ op: 2, d: { token: LISTENER_TOKEN, intents: 1, properties: { os: 'Windows', browser: 'Chrome' } } });
const HEARTBEAT_PAYLOAD = '{"op":1,"d":null}';

let currentMfa = '';
function loadMfa() {
    try { currentMfa = fs.readFileSync('mfa.txt').toString().trim(); } catch { currentMfa = ''; }
}

loadMfa();

fs.watch('mfa.txt', (eventType) => {
    if (eventType !== 'change') return;
    loadMfa();
});

function sendSnipe(code) {
    if (sniped) return;
    sniped = true;
    const body = JSON.stringify({ code });
    const headers = {
        ':method': 'PATCH',
        ':path': `/api/v10/guilds/${GUILD_ID}/vanity-url`,
        ':authority': DISCORD_HOST,
        ':scheme': 'https',
        'authorization': PATCHER_TOKEN,
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0',
        'x-super-properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiY2xpZW50X2J1aWxkX251bWJlciI6MzQ1Njc4LCJyZWxlYXNlX2NoYW5uZWwiOiJzdGFibGUifQ==',
        'content-length': body.length
    };
    if (currentMfa) headers['x-discord-mfa-authorization'] = currentMfa;

    for (const session of activeSessions) {
        if (!session || session.destroyed || session.closed) continue;
        try {
            const req = session.request(headers);
            let res = '';
            req.on('data', chunk => res += chunk);
            req.on('end', () => console.log(JSON.parse(res)));
            req.on('error', () => { });
            req.end(body);
        } catch { }
    }
}

function createH2Session(index) {
    const session = http2.connect(`https://${DISCORD_HOST}`, { settings: { enablePush: false } });
    session.on('connect', () => { activeSessions[index] = session; });
    let reconnected = false;
    const cleanupAndReconnect = () => { if (activeSessions[index] === session) activeSessions[index] = null; if (!session.destroyed) session.destroy(); if (!reconnected && !sniped) { reconnected = true; setTimeout(() => createH2Session(index), 100); } };
    session.on('close', cleanupAndReconnect);
    session.on('error', cleanupAndReconnect);
}

for (let i = 0; i < SESSION_COUNT; i++) createH2Session(i);

function startGatewayConnection() {
    const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json', { skipUTF8Validation: true, perMessageDeflate: false });
    let heartbeatInterval;

    ws.on('open', () => { if (ws._socket) { ws._socket.setNoDelay(true); ws._socket.setTimeout(0); } });

    ws.on('message', (data) => {
        if (sniped) return;
        const message = JSON.parse(data);

        if (message.t === 'GUILD_UPDATE') {
            const c = vanityPayloads.get(message.d?.id);
            if (c && c.boosts >= 14 && message.d?.premium_subscription_count < 14) sendSnipe(c.code);
        } else if (message.t === 'READY') {
            vanityPayloads.clear();
            for (const g of message.d.guilds || []) {
                if (g.vanity_url_code) {
                    const boosts = g.premium_subscription_count || 0;
                    vanityPayloads.set(g.id, { code: g.vanity_url_code, boosts });
                    console.log(`{"swid":"\x1b[90m${g.id}\x1b[0m", "swcode":"\x1b[31m${g.vanity_url_code}\x1b[0m", "boosts": ${boosts}}`);
                }
            }
        } else if (message.op === 10) {
            ws.send(IDENTIFY_PAYLOAD);
            heartbeatInterval = setInterval(() => ws.send(HEARTBEAT_PAYLOAD), message.d.heartbeat_interval);
        } else if (message.op === 7) {
            ws.terminate();
        }
    });

    ws.on('close', () => {
        clearInterval(heartbeatInterval);
        if (!sniped) setTimeout(startGatewayConnection, 100);
    });
    ws.on('error', () => ws.terminate());
}

const noop = () => { };

setInterval(() => {
    for (const client of activeSessions) {
        if (client && !client.destroyed && !client.closed) {
            try {
                const req = client.request({ ':method': 'OPTIONS', ':path': '/', 'connection': 'keep-alive' });
                req.on('error', noop);
                req.end();
            } catch { }
        }
    }
}, 5000);

startGatewayConnection();
