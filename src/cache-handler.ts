/**
 * In-memory Next.js ISR cache handler.
 *
 * Implements the `cacheHandler` interface (get / set / revalidateTag /
 * resetRequestCache) using a module-scoped Map. Single-instance only;
 * cache state is lost on process restart.
 *
 * Stale-while-revalidate is supported via `tagInvalidatedAt` — when a
 * tag is invalidated via revalidateTag(), subsequent get() calls
 * return the existing value with `cacheState: "stale"` so Next.js can
 * serve it while triggering a background re-render. This matches the
 * behaviour opennextjs-cloudflare#1168 documented for self-host.
 *
 * Used by both @solcreek/adapter-creek and @solcreek/adapter-creekd
 * as the default cacheHandler — adapters wire it into next.config via
 *   cacheHandler: require.resolve("@solcreek/adapter-core/cache-handler")
 *
 * Persistent / cross-instance caches are out of scope here; an
 * adapter that needs one (e.g. CF Durable Objects, a SQLite-backed
 * store) should ship its own and tell users to point cacheHandler at
 * that instead.
 */

interface CacheEntry {
  value: unknown;
  lastModified: number;
  tags: string[];
  revalidate?: number | false;
}

const cache = new Map<string, CacheEntry>();
const tagToKeys = new Map<string, Set<string>>();
// When a tag is invalidated via revalidateTag(), we record the wall-clock
// timestamp here. Subsequent get() calls compare this against the entry's
// lastModified — if the tag was invalidated AFTER the entry was written,
// the entry is treated as stale (cacheState: "stale") rather than missing.
//
// This implements stale-while-revalidate semantics: Next.js receives the
// old value plus the stale signal and decides to serve it while triggering
// a background re-render. Aligned with opennextjs-cloudflare#1168.
const tagInvalidatedAt = new Map<string, number>();

function isStaleByTags(entry: CacheEntry): boolean {
  for (const tag of entry.tags) {
    const invalidatedAt = tagInvalidatedAt.get(tag);
    if (invalidatedAt !== undefined && invalidatedAt > entry.lastModified) {
      return true;
    }
  }
  return false;
}

export default class CacheHandler {
  constructor(_ctx?: unknown) {
    // Context includes serverDistDir, dev, etc.
    // Not needed for in-memory implementation.
  }

  async get(key: string, _ctx?: { kind?: string }) {
    const entry = cache.get(key);
    if (!entry) return null;

    const age = (Date.now() - entry.lastModified) / 1000;

    // Stale if either (a) any of its tags was invalidated since write, or
    // (b) time-based revalidate has elapsed.
    const staleByTag = isStaleByTags(entry);
    const staleByTime =
      entry.revalidate !== undefined &&
      entry.revalidate !== false &&
      (entry.revalidate === 0 || age > entry.revalidate);

    if (staleByTag || staleByTime) {
      return {
        value: entry.value,
        lastModified: entry.lastModified,
        age: Math.floor(age),
        cacheState: "stale" as const,
      };
    }

    return {
      value: entry.value,
      lastModified: entry.lastModified,
      age: Math.floor(age),
      cacheState: "fresh" as const,
    };
  }

  async set(
    key: string,
    data: unknown | null,
    ctx?: { tags?: string[]; revalidate?: number | false },
  ) {
    if (data === null) {
      cache.delete(key);
      return;
    }

    const tags = ctx?.tags ?? [];
    const revalidate = typeof ctx?.revalidate === "number" ? ctx.revalidate : undefined;

    cache.set(key, {
      value: data,
      lastModified: Date.now(),
      tags,
      revalidate,
    });

    // Index by tags for revalidateTag()
    for (const tag of tags) {
      let keys = tagToKeys.get(tag);
      if (!keys) {
        keys = new Set();
        tagToKeys.set(tag, keys);
      }
      keys.add(key);
    }
  }

  async revalidateTag(tag: string | string[]) {
    const tags = Array.isArray(tag) ? tag : [tag];
    const now = Date.now();
    // Mark each tag as invalidated NOW. Existing entries become stale on
    // the next get(); fresh writes (lastModified > now) are unaffected.
    // We do NOT delete entries — Next.js wants to serve them as stale
    // while it re-renders in the background.
    for (const t of tags) {
      tagInvalidatedAt.set(t, now);
    }
  }

  resetRequestCache() {
    // No per-request cache to reset in this implementation.
  }
};
