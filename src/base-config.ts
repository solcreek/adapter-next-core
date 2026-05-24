import { copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import type { NextAdapter } from "next";

import { findRepoRoot } from "@solcreek/adapter-core";

import { detectPackagesNeedingTranspile } from "./transpile-detect.js";

// `NextAdapter.modifyConfig` is parameterised by Next.js's own NextConfig
// type and the build-phase tag. Re-export those argument types from a
// single place so adapter implementations don't have to duplicate the
// `Parameters<...>` dance.
type ModifyConfigFn = NonNullable<NextAdapter["modifyConfig"]>;
type NextConfig = Parameters<ModifyConfigFn>[0];
type ModifyConfigCtx = Parameters<ModifyConfigFn>[1];

/**
 * Options for `applyBaseModifyConfig`. Adapters pass their package name
 * so the auto-transpile log line credits the right tool, and the path
 * to the cache handler they want Next.js to use (typically the one
 * resolved from this package or a target-specific override).
 */
export interface BaseModifyConfigOptions {
  /** Display name in the log line, e.g. "Creek Adapter", "Creekd Adapter". */
  logLabel?: string;
  /** Absolute path to the cache handler module Next.js should load. */
  cacheHandlerPath: string;
}

/**
 * The portion of `NextAdapter.modifyConfig` that's identical across
 * targets: pick the cache handler, auto-transpile JSX-in-JS deps,
 * suppress TS errors (build-time only — type-check separately), set
 * `outputFileTracingRoot` for monorepos.
 *
 * Caller wraps this in their own `modifyConfig` and adds whatever
 * target-specific knobs they need. For CF Workers that's
 * `cacheMaxMemorySize: 0` and `maxPostponedStateSize: "20mb"`; for
 * creekd self-host that's `output: 'standalone'`. The base function
 * stays neutral.
 *
 * Returns a new config object — does not mutate the input.
 */
export function applyBaseModifyConfig(
  config: NextConfig,
  ctx: ModifyConfigCtx,
  opts: BaseModifyConfigOptions,
): NextConfig {
  // Only the production-build phase needs the adapter's massaging.
  // Dev / lint / typecheck phases pass through untouched.
  if (ctx.phase !== "phase-production-build") return config;

  const projectDir = process.cwd();
  const repoRoot = findRepoRoot(projectDir);
  const isMonorepo = repoRoot !== projectDir;
  const label = opts.logLabel ?? "Adapter";

  // Resolve the cache handler the same way Node would resolve a require:
  // walk up node_modules from projectDir until a package with the right
  // name is found. This works under npm (hoisted), yarn (hoisted), AND
  // pnpm (content-addressed store under .pnpm/), where the older
  // hardcoded "<projectDir>/node_modules/@solcreek/adapter-core/..."
  // path does NOT exist because pnpm only symlinks direct deps.
  //
  // Falls back to the dev-time path the adapter passed when the consumer
  // tree doesn't have @solcreek/adapter-next-core resolvable (e.g. building
  // inside the adapter monorepo itself).
  let resolvedCacheHandlerPath = opts.cacheHandlerPath;
  try {
    const fromProject = createRequire(projectDir + "/_");
    resolvedCacheHandlerPath = fromProject.resolve(
      "@solcreek/adapter-next-core/cache-handler",
    );
  } catch {
    // Module not resolvable from this project — stick with the
    // adapter-supplied fallback.
  }

  // Turbopack refuses `cacheHandler` paths outside the project tree —
  // it relativizes the absolute path against the project root then joins
  // to the filesystem root, which trips a "leaves the filesystem root"
  // safety check (FileSystemPath::join). pnpm's realpath resolution
  // routinely lands in a workspace sibling outside projectDir, so we
  // copy the handler into the project as a self-contained .mjs. The
  // file has no external imports, so a verbatim copy is correct.
  const relToProject = path.relative(projectDir, resolvedCacheHandlerPath);
  const isOutsideProject =
    !relToProject ||
    relToProject.startsWith("..") ||
    path.isAbsolute(relToProject);
  if (isOutsideProject && existsSync(resolvedCacheHandlerPath)) {
    const localPath = path.join(projectDir, ".solcreek-cache-handler.mjs");
    try {
      copyFileSync(resolvedCacheHandlerPath, localPath);
      resolvedCacheHandlerPath = localPath;
    } catch (e) {
      console.warn(
        `  [${label}] Failed to mirror cache-handler into project (${
          e instanceof Error ? e.message : String(e)
        }); Turbopack builds may fail.`,
      );
    }
  }

  // Auto-add any direct dep that ships JSX in `.js` to transpilePackages.
  const detected = detectPackagesNeedingTranspile(projectDir);
  const existing = Array.isArray(config.transpilePackages)
    ? config.transpilePackages
    : [];
  const transpilePackages =
    detected.length > 0 ? [...new Set([...existing, ...detected])] : existing;
  if (detected.length > 0) {
    console.log(
      `  [${label}] auto-transpile: ${JSON.stringify(detected)} (JSX in .js entry)`,
    );
  }

  return {
    ...config,
    cacheHandler: resolvedCacheHandlerPath,
    // Skip TypeScript type checking during build — type-checking should
    // be a separate step in CI / pre-deploy, not a hard gate on bundling.
    typescript: { ...config.typescript, ignoreBuildErrors: true },
    ...(transpilePackages.length > 0 && { transpilePackages }),
    // Monorepo: set tracing root so Next.js traces deps from repo root.
    ...(isMonorepo && { outputFileTracingRoot: repoRoot }),
  };
}
