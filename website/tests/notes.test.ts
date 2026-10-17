import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RELEASE_NOTES,
  compareVersions,
  noteFor,
  publishedNotes,
  releaseMarkdown,
  type ReleaseNote,
} from "../src/notes.ts";

const entry = (version: string): ReleaseNote => ({
  version,
  date: "2026-01-01",
  summary: "s",
  changes: [{ title: "t", body: "b." }],
});

test("entries_are_newest_first_and_complete", () => {
  const versions = RELEASE_NOTES.map((n) => n.version);
  assert.equal(new Set(versions).size, versions.length);
  for (const note of RELEASE_NOTES) {
    assert.match(note.version, /^\d+\.\d+\.\d+$/);
    assert.match(note.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(note.date)));
    assert.ok(note.summary.length > 0);
    assert.ok(note.changes.length > 0);
  }
  for (let i = 1; i < versions.length; i++) {
    assert.ok(compareVersions(versions[i - 1], versions[i]) > 0);
  }
});

test("compares_versions_numerically", () => {
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.ok(compareVersions("0.1.0", "0.1.1") < 0);
});

test("finds_a_version", () => {
  assert.equal(noteFor("0.1.1")?.version, "0.1.1");
  assert.equal(noteFor("9.9.9"), null);
});

test("published_notes_stop_at_the_live_version", () => {
  const fixture = [entry("0.2.0"), entry("0.1.1"), entry("0.1.0")];
  assert.deepEqual(
    publishedNotes("0.1.1", fixture).map((n) => n.version),
    ["0.1.1", "0.1.0"],
  );
  assert.deepEqual(publishedNotes(null, fixture), []);
});

test("writes_markdown_for_the_draft_release", () => {
  const note = { ...entry("1.0.0"), summary: "S", changes: [{ title: "A", body: "a." }] };
  assert.equal(releaseMarkdown(note), "S\n\n- **A** a.\n");
});
