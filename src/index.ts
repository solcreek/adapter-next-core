// Package entry. Aggregates the Next.js-specific adapter utilities
// previously bundled into @solcreek/adapter-core:
//
//   import {
//     applyBaseModifyConfig,
//     detectPackagesNeedingTranspile,
//   } from "@solcreek/adapter-next-core";
//
// The CacheHandler ships as a subpath export (./cache-handler) —
// Next.js requires a path-resolvable module for
// `next.config.cacheHandler`, so hiding it behind a re-export from
// the package root would force every consumer to know the dist
// filename.

export {
  applyBaseModifyConfig,
  type BaseModifyConfigOptions,
} from "./base-config.js";

export {
  collectEntryFiles,
  detectPackagesNeedingTranspile,
  looksLikeJsxInJs,
} from "./transpile-detect.js";

// Framework-neutral helpers both Next adapters use. They lived in
// @solcreek/adapter-core, which is deprecated up to 0.2.0 and from 0.3.0 a
// shim that itself depends on this package; owning them here drops that
// dependency.
export { findRepoRoot } from "./repo-root.js";
export { type DeployManifestBase } from "./manifest-base.js";
