import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTeamId } from "./entitlements.mjs";

const template = "<string>__TEAM_ID__.dev.ozanai.kelp</string><string>__TEAM_ID__</string>";

test("fills every Team ID placeholder", () => {
  assert.equal(
    fillTeamId(template, "ABCDE12345"),
    "<string>ABCDE12345.dev.ozanai.kelp</string><string>ABCDE12345</string>",
  );
});

test("rejects a missing or malformed Team ID", () => {
  for (const teamId of [undefined, "", "abcde12345", "ABC", "ABCDE12345X"]) {
    assert.throws(() => fillTeamId(template, teamId), /Set KELP_TEAM_ID/);
  }
});
