import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { findRepoRoot } from "./repo-root.js";

describe("findRepoRoot", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "adapter-core-repo-root-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds pnpm-workspace.yaml ancestor", () => {
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
    mkdirSync(path.join(root, "apps", "web"), { recursive: true });
    expect(findRepoRoot(path.join(root, "apps", "web"))).toBe(root);
  });

  it("finds turbo.json ancestor", () => {
    writeFileSync(path.join(root, "turbo.json"), "{}");
    mkdirSync(path.join(root, "apps", "web"), { recursive: true });
    expect(findRepoRoot(path.join(root, "apps", "web"))).toBe(root);
  });

  it("finds npm/yarn workspaces field in package.json", () => {
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["apps/*"] }),
    );
    mkdirSync(path.join(root, "apps", "web"), { recursive: true });
    expect(findRepoRoot(path.join(root, "apps", "web"))).toBe(root);
  });

  it("returns startDir when no marker found", () => {
    mkdirSync(path.join(root, "apps", "web"), { recursive: true });
    // No workspace marker anywhere up the chain inside our tempdir.
    // (Above the tempdir there might be one, but the test runs inside an
    // isolated path so this stays scoped.)
    const start = path.join(root, "apps", "web");
    const result = findRepoRoot(start);
    // Either we bottom out at start, or we hit a marker outside our tempdir
    // (a workspace above the host's tmpdir). Never another directory inside
    // the tree, which has no marker.
    const outsideTree = path.relative(root, result).startsWith("..");
    expect(result === start || outsideTree).toBe(true);
  });

  it("tolerates malformed package.json without crashing", () => {
    // The malformed manifest sits below the marker, so the walk has to parse
    // it (and survive) before it reaches pnpm-workspace.yaml.
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "");
    mkdirSync(path.join(root, "apps", "web"), { recursive: true });
    writeFileSync(path.join(root, "apps", "package.json"), "{ not valid json");
    expect(findRepoRoot(path.join(root, "apps", "web"))).toBe(root);
  });
});
