import { adminGuard } from '../lib/auth.js'
import { queryDeviceStats } from '../lib/devices.js'
import { withCache } from '../lib/cache.js'

// /api/stats：设备心跳统计（仅管理员）。
// 返回曾经打卡（全量）、最近一天、最近七天的去重设备数，以及按 device_type 分组数量。
// 数据源为 devices 去重表（O(设备数)），并带 60s 缓存，避免全表扫描打爆 D1 rows_read。
const statsHandler = async (c) => {
  const db = c.env?.['opendesk-stats-db']
  if (!db) return c.json({ error: 'statistics require D1; unavailable in this environment' }, 503)

  const stats = await queryDeviceStats(db)
  return c.json({ ok: true, ...stats })
}

export const register = (app) => {
  app.get('/stats', adminGuard, withCache(statsHandler))
  app.get('/stats/', adminGuard, withCache(statsHandler))
}
