import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePath } from "../src/path.ts";

test("the home page in every form", () => {
  for (const p of ["/", "", "/index.html"]) assert.equal(normalizePath(p), "/");
});

test("a page with or without a trailing slash or index.html", () => {
  for (const p of ["/docs/s3", "/docs/s3/", "/docs/s3/index.html", "/docs/s3//"]) {
    assert.equal(normalizePath(p), "/docs/s3");
  }
});

test("unknown paths stay unknown, so they render NotFound and not the home page", () => {
  assert.equal(normalizePath("/nope"), "/nope");
  assert.equal(normalizePath("/404.html"), "/404.html");
});
