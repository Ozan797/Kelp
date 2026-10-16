import { test } from "node:test";
import assert from "node:assert/strict";
import { keyId } from "./keycheck.mjs";

function blob(idBytes) {
  const inner = Buffer.concat([Buffer.from("Ed"), Buffer.from(idBytes), Buffer.alloc(32, 7)]).toString("base64");
  return Buffer.from(`untrusted comment: minisign public key\n${inner}\n`).toString("base64");
}

test("prints the key id as uppercase hex in reverse byte order", () => {
  assert.equal(keyId(blob([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0xab])), "AB07060504030201");
});

test("rejects text without a key line", () => {
  assert.throws(() => keyId(Buffer.from("untrusted comment: only").toString("base64")), /minisign/);
});

test("rejects a key line that is too short", () => {
  const text = Buffer.from(`untrusted comment: x\n${Buffer.from("Ed12").toString("base64")}\n`).toString("base64");
  assert.throws(() => keyId(text), /minisign/);
});
