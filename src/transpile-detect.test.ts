import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
  collectEntryFiles,
  detectPackagesNeedingTranspile,
  looksLikeJsxInJs,
} from "./transpile-detect.js";

describe("looksLikeJsxInJs", () => {
  it("flags return-paren-JSX with react import", () => {
    expect(
      looksLikeJsxInJs(
        `import React from "react";\nexport default function F() { return (<div>hi</div>); }`,
        "/x/y.js",
      ),
    ).toBe(true);
  });

  it("flags arrow JSX with use client", () => {
    expect(
      looksLikeJsxInJs(
        `"use client";\nconst F = () => <Comp />;`,
        "/x/y.js",
      ),
    ).toBe(true);
  });

  it("flags raw createElement with React import", () => {
    expect(
      looksLikeJsxInJs(
        `import React from "react";\nexport default () => createElement("div", null, "x");`,
        "/x/y.js",
      ),
    ).toBe(true);
  });

  it("does NOT flag TS generics without JSX (no JSX hint)", () => {
    expect(
      looksLikeJsxInJs(
        `import React from "react";\nfunction f<T>(): T { return null as T; }`,
        "/x/y.js",
      ),
    ).toBe(false);
  });

  it("does NOT flag JSX-shaped code without React signal", () => {
    expect(
      looksLikeJsxInJs(`function f() { return (<TagName/>); }`, "/x/y.js"),
    ).toBe(false);
  });

  it("does NOT flag .mjs files even with JSX (different module format)", () => {
    expect(
      looksLikeJsxInJs(
        `import React from "react";\nexport default () => <div />;`,
        "/x/y.mjs",
      ),
    ).toBe(false);
  });
});

describe("collectEntryFiles", () => {
  let pkgRoot: string;
  beforeEach(() => {
    pkgRoot = mkdtempSync(path.join(tmpdir(), "adapter-core-entry-"));
  });
  afterEach(() => {
    rmSync(pkgRoot, { recursive: true, force: true });
  });

  it("returns main field when it points at an existing .js", () => {
    writeFileSync(path.join(pkgRoot, "index.js"), "module.exports = {}");
    const got = collectEntryFiles({ main: "./index.js" }, pkgRoot);
    expect(got).toHaveLength(1);
    expect(got[0]).toBe(path.join(pkgRoot, "index.js"));
  });

  it("walks exports['.'] conditional object", () => {
    writeFileSync(path.join(pkgRoot, "node.js"), "module.exports = {}");
    const got = collectEntryFiles(
      { exports: { ".": { node: "./node.js", default: "./node.js" } } },
      pkgRoot,
    );
    expect(got).toHaveLength(1);
  });

  it("skips .mjs and .cjs entries", () => {
    writeFileSync(path.join(pkgRoot, "index.mjs"), "");
    expect(collectEntryFiles({ main: "./index.mjs" }, pkgRoot)).toEqual([]);
  });

  it("returns empty when entry file is missing on disk", () => {
    expect(collectEntryFiles({ main: "./nope.js" }, pkgRoot)).toEqual([]);
  });
});

describe("detectPackagesNeedingTranspile", () => {
  let projectDir: string;
  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), "adapter-core-detect-"));
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function writeDep(name: string, files: Record<string, string>, pkg: Record<string, unknown> = {}) {
    const depRoot = path.join(projectDir, "node_modules", name);
    mkdirSync(depRoot, { recursive: true });
    writeFileSync(
      path.join(depRoot, "package.json"),
      JSON.stringify({ name, ...pkg }),
    );
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(depRoot, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }

  it("returns empty list when project has no package.json", () => {
    expect(detectPackagesNeedingTranspile(projectDir)).toEqual([]);
  });

  it("flags a direct dep that ships JSX in .js", () => {
    writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "app", dependencies: { "ui-lib": "1.0.0" } }),
    );
    writeDep(
      "ui-lib",
      {
        "index.js": `import React from "react";\nexport default () => <div />;`,
      },
      { main: "./index.js" },
    );
    expect(detectPackagesNeedingTranspile(projectDir)).toEqual(["ui-lib"]);
  });

  it("skips Next/React core packages even if they ship JSX-shaped .js", () => {
    writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({
        name: "app",
        dependencies: { next: "16.2.3", react: "19.0.0" },
      }),
    );
    writeDep(
      "next",
      { "index.js": `import React from "react";\nexport default () => <div/>;` },
      { main: "./index.js" },
    );
    writeDep(
      "react",
      { "index.js": `import React from "react";\nexport default () => <span/>;` },
      { main: "./index.js" },
    );
    expect(detectPackagesNeedingTranspile(projectDir)).toEqual([]);
  });

  it("does NOT flag a dep that ships ESM-only", () => {
    writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "app", dependencies: { "esm-pkg": "1.0.0" } }),
    );
    writeDep(
      "esm-pkg",
      { "index.mjs": `import React from "react";\nexport default () => <div />;` },
      { main: "./index.mjs" },
    );
    expect(detectPackagesNeedingTranspile(projectDir)).toEqual([]);
  });

  it("does NOT flag a plain-utility dep with no JSX", () => {
    writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "app", dependencies: { "utility": "1.0.0" } }),
    );
    writeDep(
      "utility",
      { "index.js": `module.exports = { add: (a,b) => a+b };` },
      { main: "./index.js" },
    );
    expect(detectPackagesNeedingTranspile(projectDir)).toEqual([]);
  });
});
