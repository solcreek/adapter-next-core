import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { applyBaseModifyConfig } from "./base-config.js";

describe("applyBaseModifyConfig", () => {
  let originalCwd: string;
  let projectDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectDir = mkdtempSync(path.join(tmpdir(), "adapter-next-core-config-"));
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  function writePackage(name: string, cacheHandlerRel: string) {
    const pkgRoot = path.join(projectDir, "node_modules", name);
    mkdirSync(path.join(pkgRoot, path.dirname(cacheHandlerRel)), {
      recursive: true,
    });
    writeFileSync(
      path.join(pkgRoot, "package.json"),
      JSON.stringify({
        name,
        type: "module",
        exports: {
          "./cache-handler": {
            default: `./${cacheHandlerRel}`,
          },
        },
      }),
    );
    writeFileSync(path.join(pkgRoot, cacheHandlerRel), "export default class {}");
  }

  it("resolves the cache handler from adapter-next-core, not the legacy adapter-core shim", () => {
    writePackage("@solcreek/adapter-next-core", "dist/cache-handler.js");
    writePackage("@solcreek/adapter-core", "dist/legacy-cache-handler.js");

    const config = applyBaseModifyConfig(
      {},
      { phase: "phase-production-build" } as never,
      {
        logLabel: "Test Adapter",
        cacheHandlerPath: path.join(projectDir, "fallback-cache-handler.js"),
      },
    );

    expect(realpathSync(String(config.cacheHandler))).toBe(
      realpathSync(
        path.join(
          projectDir,
          "node_modules",
          "@solcreek",
          "adapter-next-core",
          "dist",
          "cache-handler.js",
        ),
      ),
    );
    expect(config.cacheHandler).not.toContain("adapter-core/dist/legacy");
  });
});
