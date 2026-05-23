# @solcreek/adapter-next-core

Next.js-specific adapter utilities shared between:

- [`@solcreek/adapter-creek`](https://github.com/solcreek/adapter-creek) — Next.js → Cloudflare Workers
- [`@solcreek/adapter-creekd`](https://github.com/solcreek/adapter-creekd) — Next.js → [`creekd`](https://github.com/solcreek/creekd) self-host

These helpers used to live in `@solcreek/adapter-core` alongside framework-neutral types like `DeployManifestBase` and `findRepoRoot`. They moved out so non-Next adapters (e.g. [`@solcreek/svelte-adapter`](https://github.com/solcreek/svelte-adapter), future Vue / Solid adapters) can depend on a clean `adapter-core` without inheriting Next.js's transpilation / cacheHandler / config-mutation surface.

## What's in here

| Export | Purpose |
|---|---|
| `applyBaseModifyConfig` | Shared `next.config` mutations every Next adapter needs: auto-transpile JSX-in-JS deps, monorepo `outputFileTracingRoot`, TS error suppression, `cacheHandler` wire-up. |
| `detectPackagesNeedingTranspile`, `collectEntryFiles`, `looksLikeJsxInJs` | Heuristic JSX-in-JS detection across the user's dep tree, used to seed `next.config.transpilePackages`. |
| `CacheHandler` (default export from `@solcreek/adapter-next-core/cache-handler`) | In-memory ISR / fetch-cache handler suitable for single-instance Next deployments. Adapters wire it in via `next.config.cacheHandler`. Tag-based stale-while-revalidate behaviour matches [opennextjs-cloudflare#1168](https://github.com/opennextjs/opennextjs-cloudflare/issues/1168). |

Persistent / cross-instance caches (KV, SQLite, Durable Objects) are out of scope here. Adapters that need one ship their own and point `cacheHandler` at it; this package's handler is the lightweight default.

## Install

```bash
pnpm add @solcreek/adapter-next-core
```

Peer dependency: `next >= 15` (optional — only required if you use `applyBaseModifyConfig`).

## Usage

```ts
import type { NextAdapter } from "next";
import {
  applyBaseModifyConfig,
  type BaseModifyConfigOptions,
} from "@solcreek/adapter-next-core";

export function createAdapter(options: MyAdapterOptions): NextAdapter {
  return {
    name: "my-adapter",
    modifyConfig(config, ctx) {
      const baseConfig = applyBaseModifyConfig(config, ctx, {
        logLabel: "My Adapter",
        cacheHandlerPath: require.resolve("@solcreek/adapter-next-core/cache-handler"),
      });
      // ... target-specific mutations on top of baseConfig
      return baseConfig;
    },
    // ...
  };
}
```

`./cache-handler` is a separate subpath export because `next.config.cacheHandler` requires a path-resolvable module specifier — Next loads the handler by `require(modulePath)`, not by JS import.

## Relationship to `@solcreek/adapter-core`

`adapter-core` is intentionally framework-neutral after the split:

- `findRepoRoot` (monorepo workspace traversal) — still in `adapter-core` because it's not Next-specific
- `DeployManifestBase` (cross-target manifest shape) — still in `adapter-core`
- `CreekdDeployManifest` (creekd-specific manifest types) — moved to [`@solcreek/creekd-manifest`](https://www.npmjs.com/package/@solcreek/creekd-manifest)
- Next-specific helpers (this package's surface) — moved here

Layering: `adapter-next-core → adapter-core` (no cycle). Non-Next adapters depend only on `adapter-core`.

## License

Apache-2.0
