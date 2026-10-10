import { adminGuard } from '../lib/auth.js'
import { queryDailyActiveDevices } from '../lib/devices.js'
import { withCache } from '../lib/cache.js'

// /api/stats/daily：按天去重活跃设备趋势（仅管理员）。
// 返回最近 N 天（默认 7，上限 90，含今天）每天的去重设备数，缺失的日期补零，
// 便于客户端直接绘制趋势图。日期边界按 UTC 计算（first_seen/last_seen 为 UTC ISO 字符串）。
// 数据源为 devices 去重表 + 60s 缓存（原实现对 heartbeats 按天 GROUP BY，读放大随明细表增长）。
const DEFAULT_DAYS = 7
const MAX_DAYS = 90

// UTC 当天零点的 ISO 字符串（YYYY-MM-DDT00:00:00.000Z）
const utcDayStart = (date) => date.toISOString().slice(0, 10) + 'T00:00:00.000Z'

const dailyHandler = async (c) => {
  const db = c.env?.['opendesk-stats-db']
  if (!db) return c.json({ error: 'statistics require D1; unavailable in this environment' }, 503)

  const days = Math.min(Math.max(Number(c.req.query('days')) || DEFAULT_DAYS, 1), MAX_DAYS)

  const todayStart = utcDayStart(new Date())
  const rangeStart = utcDayStart(new Date(Date.now() - (days - 1) * 24 * 3600 * 1000))
  const rangeEnd = utcDayStart(new Date(Date.now() + 24 * 3600 * 1000))

  const { totals, byType } = await queryDailyActiveDevices(db, rangeStart, rangeEnd)

  // 补零：区间内每一天都要有一个数据点
  const totalsByDay = new Map(totals.map((r) => [r.day, r.devices]))
  const typesByDay = new Map()
  for (const r of byType) {
    if (!typesByDay.has(r.day)) typesByDay.set(r.day, {})
    typesByDay.get(r.day)[r.device_type ?? 'unknown'] = r.devices
  }
  const points = []
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() - (days - 1 - i) * 24 * 3600 * 1000).toISOString().slice(0, 10)
    points.push({ day, devices: totalsByDay.get(day) ?? 0, by_type: typesByDay.get(day) ?? {} })
  }

  return c.json({
    ok: true,
    days,
    range: { start: rangeStart, end: rangeEnd, today_start: todayStart },
    points,
  })
}

export const register = (app) => {
  app.get('/stats/daily', adminGuard, withCache(dailyHandler))
  app.get('/stats/daily/', adminGuard, withCache(dailyHandler))
}
