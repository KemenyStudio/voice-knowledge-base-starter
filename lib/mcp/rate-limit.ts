interface Bucket {
  resetAt: number
  count: number
}

const buckets = new Map<string, Bucket>()

/** Fixed window. Returns false when the caller is over the limit. */
export function takeToken(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): boolean {
  const current = buckets.get(key)
  if (!current || now >= current.resetAt) {
    buckets.set(key, { resetAt: now + windowMs, count: 1 })
    return true
  }
  if (current.count >= limit) return false
  current.count += 1
  return true
}

export function resetRateLimits(): void {
  buckets.clear()
}
