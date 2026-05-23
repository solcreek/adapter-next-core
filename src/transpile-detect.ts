import * as path from "node:path";
import { readFileSync, statSync } from "node:fs";

/**
 * Detect direct dependencies whose `.js` entry files contain JSX.
 *
 * Turbopack (Next.js's default bundler since 15) has a regression where
 * it fails to parse JSX inside `.js` files shipped by a workspace-linked
 * or third-party package — the build exits with `Expected ';', got
 * 'ident'`. The documented upstream fix is to add the offending package
 * to `transpilePackages`; doing it here means user apps don't need to
 * know.
 *
 * Scope: DIRECT deps only. Transitive deps are either already
 * transpiled by their publisher (the common case) or reachable through
 * the direct dep we pick up. Walking all of node_modules would be slow
 * and catch unrelated packages.
 *
 * Detection: we locate each dep's `.js` entry file (via package.json's
 * `main` or the conditional `exports` field) and heuristically look for
 * JSX with a strong React signal. The double-condition keeps false
 * positives low — a plain TS-generics function `function f<T>()`
 * without React imports won't trigger. False positives cost a little
 * build time; false negatives are the status quo (i.e. the bug
 * resurfaces).
 *
 * @param projectDir absolute path to the user's Next.js project root
 * @returns list of package names to add to `next.config.transpilePackages`
 */
export function detectPackagesNeedingTranspile(projectDir: string): string[] {
  let projectPkg: Record<string, unknown>;
  try {
    projectPkg = JSON.parse(readFileSync(path.join(projectDir, "package.json"), "utf-8"));
  } catch {
    return [];
  }

  const directDeps = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const map = projectPkg[field];
    if (map && typeof map === "object") {
      for (const name of Object.keys(map as Record<string, string>)) directDeps.add(name);
    }
  }
  if (directDeps.size === 0) return [];

  // Don't ever try to transpile Next.js itself or the React runtimes —
  // they're pre-bundled and transpilePackages on them would be an
  // expensive no-op at best, a breakage at worst.
  const SKIP = new Set([
    "next",
    "react",
    "react-dom",
    "react-server-dom-webpack",
    "react-dom/server",
    "scheduler",
    "@next/routing",
    "@next/swc",
    "@solcreek/adapter-creek",
    "@solcreek/adapter-creekd",
    "@solcreek/adapter-core",
  ]);

  const needsTranspile: string[] = [];

  for (const dep of directDeps) {
    if (SKIP.has(dep)) continue;
    // Ignore subpath-qualified entries that aren't real packages (shouldn't
    // show up in dependencies, but be defensive).
    if (dep.includes("/") && !dep.startsWith("@")) continue;

    // Locate the package root via direct node_modules path. Can't use
    // `require.resolve(dep + '/package.json')` — Node's resolver honors
    // the `exports` field and most packages don't expose `./package.json`.
    // pnpm's flat node_modules layout hoists a symlink at
    // `node_modules/<dep>` for every direct + hoisted dep, so this works
    // across npm, yarn, pnpm.
    const pkgRoot = path.join(projectDir, "node_modules", dep);
    const pkgJsonPath = path.join(pkgRoot, "package.json");
    let pkgJson: Record<string, unknown>;
    try {
      pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    } catch {
      continue;
    }

    // Only `.js` entry files matter — `.mjs` / `.cjs` indicate the
    // publisher already picked a module format Turbopack handles
    // correctly.
    const entryCandidates = collectEntryFiles(pkgJson, pkgRoot);
    if (entryCandidates.length === 0) continue;

    for (const entry of entryCandidates) {
      try {
        const content = readFileSync(entry, "utf-8");
        if (looksLikeJsxInJs(content, entry)) {
          needsTranspile.push(dep);
          break; // one hit is enough; move to next package
        }
      } catch {
        // Unreadable entry file — skip without failing the whole detect pass.
      }
    }
  }

  return needsTranspile;
}

/**
 * Pick the `.js` entry file(s) for a package. Only files that end in
 * `.js` (and not `.mjs` / `.cjs`) are eligible — the others either
 * indicate module-format-specific entries (where Turbopack's bug
 * doesn't apply) or that the publisher already transpiled.
 */
export function collectEntryFiles(
  pkgJson: Record<string, unknown>,
  pkgRoot: string,
): string[] {
  const candidates: string[] = [];
  const tryAdd = (rel: unknown) => {
    if (typeof rel !== "string") return;
    if (!rel.endsWith(".js")) return;
    const abs = path.join(pkgRoot, rel.startsWith("./") ? rel.slice(2) : rel);
    try {
      if (statSync(abs).isFile()) candidates.push(abs);
    } catch {
      // Entry declared but doesn't exist on disk — skip.
    }
  };

  tryAdd(pkgJson.main);
  // `exports` can be a string, or a nested conditional object. We walk
  // the "." entry's import/require/default branches.
  const exports_ = pkgJson.exports as unknown;
  if (typeof exports_ === "string") {
    tryAdd(exports_);
  } else if (exports_ && typeof exports_ === "object") {
    const rootExport = (exports_ as Record<string, unknown>)["."] ?? exports_;
    if (typeof rootExport === "string") {
      tryAdd(rootExport);
    } else if (rootExport && typeof rootExport === "object") {
      for (const cond of ["default", "import", "require", "node", "browser"]) {
        tryAdd((rootExport as Record<string, unknown>)[cond]);
      }
    }
  }
  return [...new Set(candidates)];
}

/**
 * Heuristic: a `.js` file looks like it contains JSX if it has at least
 * one JSX-ish token AND at least one React signal. Both conditions
 * together keep false positives low.
 */
export function looksLikeJsxInJs(content: string, filePath: string): boolean {
  if (!filePath.endsWith(".js")) return false;
  const head = content.slice(0, 20_000); // cap scan cost

  const JSX_HINTS = [
    /return\s*\(\s*</, // return (<...
    /return\s+<[A-Za-z]/, // return <Tag or <Component
    /=>\s*<[A-Za-z]/, // arrow => <...
    /\bcreateElement\s*\(/, // raw createElement
  ];
  const hasJsxHint = JSX_HINTS.some((re) => re.test(head));
  if (!hasJsxHint) return false;

  const REACT_HINTS = [
    /['"]use client['"]/,
    /from\s+['"]react['"]/,
    /require\s*\(\s*['"]react['"]\s*\)/,
    /\bReact\.createElement\b/,
  ];
  return REACT_HINTS.some((re) => re.test(head));
}
