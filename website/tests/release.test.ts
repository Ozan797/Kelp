import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRelease } from "../src/release.ts";

test("reads the version from a manifest", () => {
  assert.deepEqual(parseRelease({ version: "0.2.0", notes: "x", platforms: {} }), { version: "0.2.0" });
});

test("rejects_anything_but_a_plain_version", () => {
  for (const json of [null, "0.2.0", 42, {}, { version: 2 }, { version: "" }, { version: "v0.2.0" }, { version: "<script>alert(1)</script>" }, { version: "0.2.0 beta" }]) {
    assert.equal(parseRelease(json), null, JSON.stringify(json));
  }
});
