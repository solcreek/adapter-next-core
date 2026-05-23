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
