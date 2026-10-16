import { test } from "node:test";
import assert from "node:assert/strict";
import { cargoVersion, versionMismatches } from "./version.mjs";

test("matching versions pass", () => {
  assert.deepEqual(versionMismatches("0.2.0", { "tauri.conf.json": "0.2.0", "Cargo.toml": "0.2.0", "package.json": "0.2.0" }), []);
});

test("every mismatching file is named with its version", () => {
  assert.deepEqual(versionMismatches("0.2.0", { "tauri.conf.json": "0.1.9", "Cargo.toml": "0.2.0", "package.json": "0.1.8" }), [
    "tauri.conf.json (0.1.9)",
    "package.json (0.1.8)",
  ]);
});

test("reads the package version from Cargo.toml, not a dependency's", () => {
  const text = '[package]\nname = "kelp"\nversion = "0.2.0"\n\n[dependencies]\nserde = { version = "1.0.0" }\n';
  assert.equal(cargoVersion(text), "0.2.0");
});
