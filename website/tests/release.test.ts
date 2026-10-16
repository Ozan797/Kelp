import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadUrl, parseRelease, releaseFromVersion } from "../src/release.ts";

test("reads the version from a manifest", () => {
  assert.deepEqual(parseRelease({ version: "0.2.0", notes: "x", platforms: {} }), { version: "0.2.0" });
});

test("rejects_anything_but_a_plain_version", () => {
  for (const json of [null, "0.2.0", 42, {}, { version: 2 }, { version: "" }, { version: "v0.2.0" }, { version: "<script>alert(1)</script>" }, { version: "0.2.0 beta" }]) {
    assert.equal(parseRelease(json), null, JSON.stringify(json));
  }
});

test("links to the versioned disk image of a release", () => {
  assert.equal(
    downloadUrl({ version: "0.2.0" }),
    "https://kelp-dl.ozanai.dev/releases/0.2.0/Kelp_0.2.0_aarch64.dmg",
  );
});

test("takes a release version handed over by the deploy workflow", () => {
  assert.deepEqual(releaseFromVersion("0.1.0"), { version: "0.1.0" });
});

test("ignores a handed-over version that isn't plain x.y.z", () => {
  for (const version of ["", "v0.1.0", "0.1.0\nEVIL=1", "latest"]) {
    assert.equal(releaseFromVersion(version), null, JSON.stringify(version));
  }
});
