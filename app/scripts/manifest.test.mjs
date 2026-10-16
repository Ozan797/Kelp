import { test } from "node:test";
import assert from "node:assert/strict";
import { manifest } from "./manifest.mjs";

test("builds the darwin-aarch64 manifest", () => {
  assert.deepEqual(manifest({ version: "0.2.0", signature: "c2lnbmF0dXJl\n", notes: "Faster previews\n", pubDate: "2026-10-20T10:00:00Z" }), {
    version: "0.2.0",
    notes: "Faster previews",
    pub_date: "2026-10-20T10:00:00Z",
    platforms: {
      "darwin-aarch64": {
        signature: "c2lnbmF0dXJl",
        url: "https://dl.kelp.ozanai.dev/releases/0.2.0/Kelp.app.tar.gz",
      },
    },
  });
});

test("rejects a version that isn't x.y.z", () => {
  for (const version of ["v0.2.0", "0.2", "0.2.0-beta", "", "0.2.0; rm -rf /"]) {
    assert.throws(() => manifest({ version, signature: "s", notes: "", pubDate: "2026-10-20T10:00:00Z" }), /isn't a version like 0\.2\.0/);
  }
});

test("rejects an empty signature", () => {
  assert.throws(() => manifest({ version: "0.2.0", signature: " \n", notes: "", pubDate: "2026-10-20T10:00:00Z" }), /signature is empty/);
});
