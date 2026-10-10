// devices 去重表的读写入口：心跳 upsert + 统计查询 + 缺表自愈。
// 所有读统计接口走本模块，不再对 heartbeats 做全表聚合（rows_read 优化）。
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS devices (
  device_id   TEXT PRIMARY KEY,
  os          TEXT,
  device_type TEXT,
  client_type TEXT,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
CREATE INDEX IF NOT EXISTS idx_devices_type_last_seen ON devices(device_type, last_seen);
`;

// 从 heartbeats 幂等回填缺失设备（与 migrations/0005 同逻辑）
const BACKFILL_SQL = `
INSERT INTO devices (device_id, os, device_type, client_type, first_seen, last_seen)
SELECT h.device_id, h.os, h.device_type, h.client_type,
       MIN(h.time), MAX(h.time)
FROM heartbeats h
WHERE h.device_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.device_id = h.device_id)
GROUP BY h.device_id;
`;

// upsert：新设备插入，老设备推进 last_seen 并刷新最新属性
const UPSERT_SQL = `
INSERT INTO devices (device_id, os, device_type, client_type, first_seen, last_seen)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(device_id) DO UPDATE SET
  os = excluded.os,
  device_type = excluded.device_type,
  client_type = excluded.client_type,
  last_seen = excluded.last_seen
`;

let ensured = false;

// 确保表存在。生产部署时序下新代码可能先于手工迁移生效，这里自愈建表并回填。
// 迁移脚本（wrangler d1 migrations apply）跑过时为空操作，module 级缓存保证每实例只探一次。
export async function ensureDevicesTable(db) {
  if (ensured) return
  try {
    await db.prepare('SELECT 1 FROM devices LIMIT 1').first()
    ensured = true
    return
  } catch {
    // 表不存在，走建表 + 回填
  }
  const stmts = CREATE_TABLE_SQL.split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((sql) => db.prepare(sql))
  await db.batch([...stmts, db.prepare(BACKFILL_SQL)])
  ensured = true
}

// 心跳 upsert。失败向上抛，由调用方决定是否影响主流程。
export function upsertDevice(db, { deviceId, os, deviceType, clientType, time }) {
  return db
    .prepare(UPSERT_SQL)
    .bind(deviceId, os, deviceType, clientType, time, time)
    .run()
}

// 查询参数：{ total: { devices }, last_1d, last_7d }，按时间窗口与 device_type 分组。
// 命中 last_seen 索引，成本 O(设备数) 而非 O(心跳行数)。
export async function queryDeviceStats(db) {
  await ensureDevicesTable(db)

  const hour = 3600 * 1000
  const dayAgo = new Date(Date.now() - 24 * hour).toISOString()
  const weekAgo = new Date(Date.now() - 7 * 24 * hour).toISOString()

  const countByType = (rows) =>
    Object.fromEntries(rows.map((r) => [r.device_type ?? 'unknown', r.devices]))

  const [total, totalByType, day, dayByType, week, weekByType] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS devices FROM devices').first(),
    db
      .prepare('SELECT device_type, COUNT(*) AS devices FROM devices GROUP BY device_type')
      .all(),
    db
      .prepare('SELECT COUNT(*) AS devices FROM devices WHERE last_seen >= ?')
      .bind(dayAgo)
      .first(),
    db
      .prepare('SELECT device_type, COUNT(*) AS devices FROM devices WHERE last_seen >= ? GROUP BY device_type')
      .bind(dayAgo)
      .all(),
    db
      .prepare('SELECT COUNT(*) AS devices FROM devices WHERE last_seen >= ?')
      .bind(weekAgo)
      .first(),
    db
      .prepare('SELECT device_type, COUNT(*) AS devices FROM devices WHERE last_seen >= ? GROUP BY device_type')
      .bind(weekAgo)
      .all(),
  ])

  return {
    total: { devices: total.devices, by_type: countByType(totalByType.results) },
    last_1d: { devices: day.devices, by_type: countByType(dayByType.results) },
    last_7d: { devices: week.devices, by_type: countByType(weekByType.results) },
  }
}

// 按天去重活跃设备趋势（devices.first_seen/last_seen 均为 UTC ISO 字符串），
// 用日期区间交叉连接展开后按天聚合，返回：
// - totals: [{ day, devices }]（缺失日期由调用方补零）
// - byType: [{ day, device_type, devices }]
export async function queryDailyActiveDevices(db, rangeStart, rangeEnd) {
  await ensureDevicesTable(db)

  const result = await db
    .prepare(
      `WITH RECURSIVE span(day) AS (
         VALUES (?)
         UNION ALL
         SELECT strftime('%Y-%m-%d', day, '+1 day') FROM span WHERE day < ?
       )
       SELECT span.day AS day, COUNT(d.device_id) AS devices
       FROM span
       LEFT JOIN devices d
         ON d.first_seen <= span.day || 'T23:59:59.999Z'
        AND d.last_seen >= span.day || 'T00:00:00.000Z'
       GROUP BY span.day
       ORDER BY span.day`,
    )
    .bind(rangeStart.slice(0, 10), rangeEnd.slice(0, 10))
    .all()

  const byType = await db
    .prepare(
      `WITH RECURSIVE span(day) AS (
         VALUES (?)
         UNION ALL
         SELECT strftime('%Y-%m-%d', day, '+1 day') FROM span WHERE day < ?
       )
       SELECT span.day AS day, d.device_type AS device_type, COUNT(*) AS devices
       FROM span
       JOIN devices d
         ON d.first_seen <= span.day || 'T23:59:59.999Z'
        AND d.last_seen >= span.day || 'T00:00:00.000Z'
       GROUP BY span.day, d.device_type
       ORDER BY span.day`,
    )
    .bind(rangeStart.slice(0, 10), rangeEnd.slice(0, 10))
    .all()

  return {
    totals: result.results.map((r) => ({ day: r.day, devices: r.devices })),
    byType: byType.results.map((r) => ({ day: r.day, device_type: r.device_type, devices: r.devices })),
  }
}
