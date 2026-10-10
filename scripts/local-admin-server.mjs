/**
 * 本地管理员调试服务器（不属于站点生产代码）：
 * 复用 src/server 的 Hono app，用 node:sqlite 实现 D1 binding 适配层，
 * 供 OpenDesk 管理员面板在本地端到端调试（生产走 Cloudflare Pages + D1）。
 *
 * 启动：node scripts/local-admin-server.mjs   （默认 http://127.0.0.1:8799）
 * 环境变量：ADMIN_TOKEN（必填，管理员令牌）、IP_HASH_SALT、PORT
 */

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApi } from '../src/server/hono-app.js';

const PORT = Number(process.env.PORT) || 8799;
const DB_FILE = process.env.ADMIN_DB_FILE || path.join(process.cwd(), '.wrangler/local-admin.sqlite');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'local-admin-token';
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'local-dev-salt';

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const sqlite = new DatabaseSync(DB_FILE);
// 迁移文件并非全部幂等（如 ALTER TABLE ADD COLUMN），重启时忽略"已存在"类报错
for (const file of fs.readdirSync(path.join(process.cwd(), 'migrations')).sort()) {
    try {
        sqlite.exec(fs.readFileSync(path.join(process.cwd(), 'migrations', file), 'utf8'));
    } catch (error) {
        if (!/already exists|duplicate column/i.test(String(error?.message))) throw error;
    }
}

// 最小 D1 binding 适配：覆盖本仓库 API 用到的 prepare/bind/first/all/run/batch 与 meta.last_row_id
function makeD1(env) {
    return {
        prepare(sql) {
            const bind = (...values) => ({
                bind: (...more) => bind(...values, ...more),
                async first() {
                    return sqlite.prepare(sql).get(...values) ?? null;
                },
                async all() {
                    return { results: sqlite.prepare(sql).all(...values) };
                },
                async run() {
                    const info = sqlite.prepare(sql).run(...values);
                    return { meta: { last_row_id: Number(info.lastInsertRowid) } };
                },
            });
            return bind();
        },
        async batch(statements) {
            return Promise.all(statements.map((stmt) => stmt.run()));
        },
    };
}

const app = createApi();

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    // /api/* 交给 Hono；其余路径仅返回状态说明（站点页面不在此服务）
    if (!url.pathname.startsWith('/api/')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'this server only exposes /api/*' }));
        return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value);
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    const request = new Request(url.href, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    });
    // Hono Pages 适配约定：env 里带 binding 与 CF_PAGES=1（feedback 上传需要 formData）
    const env = {
        'opendesk-stats-db': makeD1(),
        ADMIN_TOKEN,
        IP_HASH_SALT,
        CF_PAGES: '1',
    };
    try {
        const response = await app.fetch(request, env);
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = key.toLowerCase() === 'set-cookie' ? value : value;
        });
        res.writeHead(response.status, responseHeaders);
        const buffer = Buffer.from(await response.arrayBuffer());
        res.end(body !== undefined && req.method === 'HEAD' ? undefined : buffer);
    } catch (error) {
        console.error('request failed', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[local-admin-server] listening on http://127.0.0.1:${PORT}`);
    console.log(`[local-admin-server] db: ${DB_FILE}`);
    console.log(`[local-admin-server] admin token: ${ADMIN_TOKEN}`);
});
