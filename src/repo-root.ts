import * as path from "node:path";
import { existsSync, readFileSync } from "node:fs";

/**
 * Walk up from startDir looking for monorepo workspace markers. Returns
 * the first directory that has any of:
 *
 *   - `pnpm-workspace.yaml`
 *   - `turbo.json`
 *   - `package.json` with a top-level `workspaces` field (npm / yarn)
 *
 * Falls back to startDir if no marker is found before the filesystem root.
 *
 * Used by both adapters to set Next.js's `outputFileTracingRoot` so dep
 * tracing follows symlinks across the monorepo rather than dead-ending
 * at the app package's `node_modules`.
 */
export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (
      existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
      existsSync(path.join(dir, "turbo.json"))
    ) {
      return dir;
    }
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) return dir;
      } catch {
        // Unreadable / malformed package.json — keep climbing rather than
        // crashing the adapter at build time.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}
