import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createApi } from '../src/server/hono-app.js'

// 反馈管理接口集成测试：用 node:sqlite 按真实迁移 SQL 建库，
// 以最小 D1 绑定 shim（prepare/bind/all/first/run）驱动真实 Hono 路由与 SQL。

const ADMIN_TOKEN = 'test-admin-token'
const here = path.dirname(fileURLToPath(import.meta.url))

function makeD1(db) {
  return {
    prepare(sql) {
      let args = []
      const stmt = {
        bind(...values) {
          args = values
          return stmt
        },
        async all() {
          return { results: db.prepare(sql).all(...args) }
        },
        async first() {
          return db.prepare(sql).get(...args) ?? null
        },
        async run() {
          const info = db.prepare(sql).run(...args)
          return { meta: { last_row_id: Number(info.lastInsertRowid) } }
        },
      }
      return stmt
    },
  }
}

let db
let env

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of ['0003_create_feedback.sql', '0004_add_feedback_contact.sql']) {
    db.exec(readFileSync(path.join(here, '..', 'migrations', file), 'utf8'))
  }
  env = { ADMIN_TOKEN, 'opendesk-stats-db': makeD1(db) }
})

// 按插入顺序返回自增 id 列表
function seed(rows) {
  const ins = db.prepare('INSERT INTO feedback (type, content, contact, time) VALUES (?, ?, ?, ?)')
  const ids = []
  for (const r of rows) {
    const info = ins.run(r.type, r.content, r.contact ?? null, r.time ?? '2026-01-01T00:00:00Z')
    ids.push(Number(info.lastInsertRowid))
  }
  return ids
}

function seedAttachment(feedbackId, filename) {
  db.prepare(
    'INSERT INTO feedback_attachments (feedback_id, filename, content_type, size, data) VALUES (?, ?, ?, ?, ?)',
  ).run(feedbackId, filename, 'text/plain', 5, Buffer.from('hello'))
}

async function get(url) {
  const res = await createApi().fetch(
    new Request(`http://pages.local${url}`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } }),
    env,
  )
  return { status: res.status, body: await res.json() }
}

test('list requires admin token', async () => {
  const res = await createApi().fetch(new Request('http://pages.local/api/feedback/list'), env)
  assert.equal(res.status, 401)
  const wrong = await createApi().fetch(
    new Request('http://pages.local/api/feedback/list', { headers: { authorization: 'Bearer nope' } }),
    env,
  )
  assert.equal(wrong.status, 401)
})

test('list returns items newest first with total for pagination', async () => {
  const ids = seed([
    { type: 'feature', content: 'f1' },
    { type: 'bug', content: 'b1' },
    { type: 'feature', content: 'f2' },
    { type: 'feature', content: 'f3' },
    { type: 'bug', content: 'b2' },
  ])
  const { status, body } = await get('/api/feedback/list')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.total, 5)
  assert.equal(body.limit, 50)
  assert.equal(body.offset, 0)
  assert.deepEqual(body.items.map((i) => i.id), [...ids].reverse())
  // 旧客户端依赖的字段形状保持不变
  assert.deepEqual(Object.keys(body.items[0]).sort(), ['attachments', 'contact', 'content', 'id', 'time', 'type'])
})

test('list paginates with limit and offset', async () => {
  const ids = seed([
    { type: 'feature', content: 'f1' },
    { type: 'bug', content: 'b1' },
    { type: 'feature', content: 'f2' },
    { type: 'feature', content: 'f3' },
    { type: 'bug', content: 'b2' },
  ])
  const page = await get('/api/feedback/list?limit=2&offset=2')
  assert.equal(page.status, 200)
  assert.deepEqual(page.body.items.map((i) => i.id), [ids[2], ids[1]])
  assert.equal(page.body.total, 5)

  const tail = await get('/api/feedback/list?limit=2&offset=4')
  assert.deepEqual(tail.body.items.map((i) => i.id), [ids[0]])

  const beyond = await get('/api/feedback/list?limit=2&offset=10')
  assert.equal(beyond.body.items.length, 0)
  assert.equal(beyond.body.total, 5)
})

test('list filters by type and combines with pagination', async () => {
  const ids = seed([
    { type: 'feature', content: 'f1' },
    { type: 'bug', content: 'b1' },
    { type: 'feature', content: 'f2' },
    { type: 'feature', content: 'f3' },
    { type: 'bug', content: 'b2' },
  ])
  const features = await get('/api/feedback/list?type=feature')
  assert.equal(features.body.total, 3)
  assert.deepEqual(features.body.items.map((i) => i.id), [ids[3], ids[2], ids[0]])
  assert.ok(features.body.items.every((i) => i.type === 'feature'))

  const bugs = await get('/api/feedback/list?type=bug')
  assert.deepEqual(bugs.body.items.map((i) => i.id), [ids[4], ids[1]])

  const paged = await get('/api/feedback/list?type=feature&limit=2&offset=1')
  assert.deepEqual(paged.body.items.map((i) => i.id), [ids[2], ids[0]])
  assert.equal(paged.body.total, 3)
})

test('list rejects invalid type and clamps bad pagination values', async () => {
  seed([{ type: 'feature', content: 'f1' }])
  const bad = await get('/api/feedback/list?type=requirement')
  assert.equal(bad.status, 400)

  const negative = await get('/api/feedback/list?offset=-5&limit=-5')
  assert.equal(negative.status, 200)
  assert.equal(negative.body.offset, 0)
  assert.equal(negative.body.limit, 1)

  const zeroLimit = await get('/api/feedback/list?limit=0')
  assert.equal(zeroLimit.body.limit, 50)
})

test('detail returns one feedback with attachments regardless of pagination', async () => {
  const ids = seed([
    { type: 'feature', content: 'f1', contact: 'a@b.c' },
    { type: 'bug', content: 'b1' },
  ])
  seedAttachment(ids[0], 'log.txt')
  const { status, body } = await get(`/api/feedback/detail/${ids[0]}`)
  assert.equal(status, 200)
  assert.equal(body.item.id, ids[0])
  assert.equal(body.item.type, 'feature')
  assert.equal(body.item.contact, 'a@b.c')
  assert.deepEqual(body.item.attachments, [{ attachment_id: 1, filename: 'log.txt' }])

  const noAttachment = await get(`/api/feedback/detail/${ids[1]}`)
  assert.deepEqual(noAttachment.body.item.attachments, [])
})

test('detail validates id and reports missing feedback', async () => {
  seed([{ type: 'bug', content: 'b1' }])
  const missing = await get('/api/feedback/detail/999')
  assert.equal(missing.status, 404)
  assert.match(missing.body.error, /not found/)

  const invalid = await get('/api/feedback/detail/abc')
  assert.equal(invalid.status, 400)
})

test('detail requires admin token', async () => {
  const res = await createApi().fetch(new Request('http://pages.local/api/feedback/detail/1'), env)
  assert.equal(res.status, 401)
})
