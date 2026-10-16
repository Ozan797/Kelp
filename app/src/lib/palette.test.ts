import { describe, expect, it } from "vitest";
import { rank, type Command } from "./palette";

const command = (id: string, label: string, group: Command["group"]): Command => ({ id, label, group, run: () => undefined });

const all = [
  command("folder:2024", "2024", "places"),
  command("folder:drafts", "drafts", "places"),
  command("folder:old-drafts", "old-drafts", "places"),
  command("new-folder", "New folder…", "actions"),
  command("download", "Download 2 items", "actions"),
];

describe("rank", () => {
  it("puts names that start with the query before names that contain it", () => {
    expect(rank(all, "dra").map((c) => c.id)).toEqual(["folder:drafts", "folder:old-drafts"]);
  });

  it("ignores case", () => {
    expect(rank(all, "DOWN").map((c) => c.id)).toEqual(["download"]);
  });

  it("shows actions first, then places, when nothing is typed", () => {
    expect(rank(all, "  ").map((c) => c.id)).toEqual(["new-folder", "download", "folder:2024", "folder:drafts", "folder:old-drafts"]);
  });

  it("keeps the given order among equal matches", () => {
    expect(rank(all, "o").map((c) => c.id)).toEqual(["folder:old-drafts", "new-folder", "download"]);
  });
});
