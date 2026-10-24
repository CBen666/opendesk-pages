import { clientIp, hashIp } from '../lib/ip-hash.js'
import { adminGuard } from '../lib/auth.js'

// 反馈附件限制：最多 5 个、单个 ≤ 1MB（D1 行存储上限内，防滥用）。
const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_BYTES = 1024 * 1024

// /api/feedback/submit：提交用户反馈（feature / bug），multipart/form-data 上传附件。
// 字段：type（feature|bug，必填）、content（必填）、contact（可选）、attachments（可选，一个或多个文件）。
// 主记录写入 feedback 表，附件以 BLOB 写入 feedback_attachments 表（feedback_id 外键关联）。
const submitHandler = async (c) => {
  let form
  try {
    form = await c.req.formData()
  } catch {
    return c.json({ error: 'expected multipart/form-data body' }, 400)
  }

  const type = typeof form.get('type') === 'string' ? form.get('type') : null
  const content = typeof form.get('content') === 'string' ? form.get('content') : null
  const contact = typeof form.get('contact') === 'string' ? form.get('contact').trim() || null : null
  if (type !== 'feature' && type !== 'bug') {
    return c.json({ error: "type must be 'feature' or 'bug'" }, 400)
  }
  if (!content?.trim()) {
    return c.json({ error: 'content is required' }, 400)
  }

  const attachments = form.getAll('attachments').filter((f) => f instanceof File)
  if (attachments.length > MAX_ATTACHMENTS) {
    return c.json({ error: `at most ${MAX_ATTACHMENTS} attachments are allowed` }, 400)
  }
  for (const f of attachments) {
    if (f.size > MAX_ATTACHMENT_BYTES) {
      return c.json({ error: `attachment "${f.name}" exceeds ${MAX_ATTACHMENT_BYTES} bytes` }, 400)
    }
  }

  const time = new Date().toISOString()
  const ipHash = await hashIp(clientIp(c), c.env?.IP_HASH_SALT)

  const db = c.env?.['opendesk-stats-db']
  let id = null
  if (db) {
    const result = await db
      .prepare('INSERT INTO feedback (type, content, contact, time, ip_hash) VALUES (?, ?, ?, ?, ?)')
      .bind(type, content.trim(), contact, time, ipHash)
      .run()
    id = result.meta.last_row_id

    for (const f of attachments) {
      await db
        .prepare(
          'INSERT INTO feedback_attachments (feedback_id, filename, content_type, size, data) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(id, f.name, f.type, f.size, new Uint8Array(await f.arrayBuffer()))
        .run()
    }
  }

  return c.json({ ok: true, id, type, attachments: attachments.length, ...(contact ? { contact } : {}) })
}

// /api/feedback/list（仅管理员）：返回已提交反馈列表，按时间倒序；附件含 attachment_id 与 filename，不返回文件数据。
// 分页：limit（1~200，默认 50）+ offset（默认 0）；响应含 total（按 type 过滤后的总数）供客户端翻页。
// type（可选，feature|bug）：按反馈类型过滤，非法值返回 400。
const listHandler = async (c) => {
  const db = c.env?.['opendesk-stats-db']
  if (!db) return c.json({ error: 'statistics require D1; unavailable in this environment' }, 503)

  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200)
  const offset = Math.max(Number(c.req.query('offset')) || 0, 0)
  const type = c.req.query('type')
  if (type !== undefined && type !== 'feature' && type !== 'bug') {
    return c.json({ error: "type must be 'feature' or 'bug'" }, 400)
  }

  const where = type ? 'WHERE type = ?' : ''
  const filterArgs = type ? [type] : []

  const { results: feedbacks } = await db
    .prepare(`SELECT id, type, content, contact, time FROM feedback ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(...filterArgs, limit, offset)
    .all()

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM feedback ${where}`)
    .bind(...filterArgs)
    .first()
  const total = Number(totalRow?.n ?? 0)

  // 附件只按当前页 feedback 的 id 精确查询，避免每次全表扫描附件表
  const ids = feedbacks.map((r) => r.id)
  let attachments = []
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ')
    const result = await db
      .prepare(
        `SELECT id, feedback_id, filename FROM feedback_attachments WHERE feedback_id IN (${placeholders}) ORDER BY id`,
      )
      .bind(...ids)
      .all()
    attachments = result.results
  }

  const byFeedback = new Map()
  for (const a of attachments) {
    if (!byFeedback.has(a.feedback_id)) byFeedback.set(a.feedback_id, [])
    byFeedback.get(a.feedback_id).push({ attachment_id: a.id, filename: a.filename })
  }
  return c.json({
    ok: true,
    total,
    limit,
    offset,
    items: feedbacks.map((r) => ({
      id: r.id,
      type: r.type,
      content: r.content,
      contact: r.contact,
      time: r.time,
      attachments: byFeedback.get(r.id) ?? [],
    })),
  })
}

// /api/feedback/detail/:id（仅管理员）：按 id 返回单条反馈完整详情（含附件元信息），不受列表分页范围限制。
const detailHandler = async (c) => {
  const db = c.env?.['opendesk-stats-db']
  if (!db) return c.json({ error: 'statistics require D1; unavailable in this environment' }, 503)

  const feedbackId = Number(c.req.param('id'))
  if (!Number.isInteger(feedbackId) || feedbackId <= 0) {
    return c.json({ error: 'invalid feedback id' }, 400)
  }

  const row = await db
    .prepare('SELECT id, type, content, contact, time FROM feedback WHERE id = ?')
    .bind(feedbackId)
    .first()
  if (!row) return c.json({ error: 'feedback not found' }, 404)

  const { results: attachments } = await db
    .prepare('SELECT id, filename FROM feedback_attachments WHERE feedback_id = ? ORDER BY id')
    .bind(feedbackId)
    .all()

  return c.json({
    ok: true,
    item: {
      ...row,
      attachments: attachments.map((a) => ({ attachment_id: a.id, filename: a.filename })),
    },
  })
}

// 生成 Content-Disposition，兼容 ASCII 与 Unicode 文件名（RFC 5987 filename*）。
const buildDisposition = (filename) => {
  const name = filename || 'attachment'
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(name)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

// /api/feedback/attachment/:id（仅管理员）：下载附件原始文件（BLOB），校验管理员 token。
const attachmentHandler = async (c) => {
  const db = c.env?.['opendesk-stats-db']
  if (!db) return c.json({ error: 'statistics require D1; unavailable in this environment' }, 503)

  const attachmentId = Number(c.req.param('id'))
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
    return c.json({ error: 'invalid attachment id' }, 400)
  }

  const row = await db
    .prepare('SELECT filename, content_type, data FROM feedback_attachments WHERE id = ?')
    .bind(attachmentId)
    .first()
  if (!row) return c.json({ error: 'attachment not found' }, 404)

  const buf = row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data)
  return c.body(buf, 200, {
    'Content-Type': row.content_type || 'application/octet-stream',
    'Content-Disposition': buildDisposition(row.filename),
    'Cache-Control': 'private, no-store',
  })
}

export const register = (app) => {
  app.post('/feedback/submit', submitHandler)
  app.post('/feedback/submit/', submitHandler)
  app.get('/feedback/list', adminGuard, listHandler)
  app.get('/feedback/list/', adminGuard, listHandler)
  app.get('/feedback/detail/:id', adminGuard, detailHandler)
  app.get('/feedback/detail/:id/', adminGuard, detailHandler)
  app.get('/feedback/attachment/:id', adminGuard, attachmentHandler)
  app.get('/feedback/attachment/:id/', adminGuard, attachmentHandler)
}