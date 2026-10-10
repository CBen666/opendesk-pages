-- devices：每台设备一行的去重聚合表，替代对 heartbeats 全表的 COUNT(DISTINCT)/GROUP BY。
-- 读写成本从 O(心跳行数) 降到 O(设备数)，避免 D1 rows_read 免费额度被统计查询打爆。
CREATE TABLE IF NOT EXISTS devices (
  device_id   TEXT PRIMARY KEY,
  os          TEXT,
  device_type TEXT,
  client_type TEXT,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
-- GROUP BY device_type 的覆盖索引：避免每次统计都扫全表行
CREATE INDEX IF NOT EXISTS idx_devices_type_last_seen ON devices(device_type, last_seen);

-- 历史回填：从 heartbeats 生成每设备的首末心跳时间与最新属性。
-- 心跳表按 time 递增写入（time 由服务端收到时刻生成），因此 MIN/MAX 聚合出的属性即最新值。
-- 幂等：只回填 devices 中尚不存在的 device_id。
INSERT INTO devices (device_id, os, device_type, client_type, first_seen, last_seen)
SELECT h.device_id, h.os, h.device_type, h.client_type,
       MIN(h.time), MAX(h.time)
FROM heartbeats h
WHERE h.device_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.device_id = h.device_id)
GROUP BY h.device_id;
