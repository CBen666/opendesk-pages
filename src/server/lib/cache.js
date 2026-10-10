// 管理统计接口的短 TTL 缓存（Cloudflare Cache API），防频繁刷新面板打爆 D1 读额度。
// 仅生产 Workers 运行时有 caches.default；无 caches 的环境（本地 node/wrangler 模拟）自动跳过。

const CACHE_TTL_SECONDS = 60

export const cacheKey = (url) => new Request(url, { method: 'GET' })

// cacheable 包裹 handler：命中缓存直接回包，否则执行 handler 并以 60s TTL 写入缓存。
export const withCache = (handler) => async (c) => {
  const cache = typeof caches !== 'undefined' ? caches.default : null
  if (!cache) return handler(c)

  const key = cacheKey(c.req.url)
  const cached = await cache.match(key)
  if (cached) return cached

  const response = await handler(c)
  if (response.status === 200) {
    const res = new Response(response.body, response)
    res.headers.set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`)
    c.executionCtx.waitUntil(cache.put(key, res.clone()))
    return res
  }
  return response
}
