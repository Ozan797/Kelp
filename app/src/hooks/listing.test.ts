import { describe, expect, it } from "vitest";
import { pageToRows } from "./useListing";

describe("pageToRows", () => {
  it("turns folders and objects into rows named relative to the folder", () => {
    const rows = pageToRows(
      {
        folders: ["vimeo/2025/"],
        objects: [{ key: "vimeo/teaser.mp4", size: 184, lastModified: "2026-10-14T13:00:00Z" }],
        nextToken: null,
      },
      "vimeo/",
    );
    expect(rows).toEqual([
      { key: "vimeo/2025/", name: "2025", isFolder: true, size: null, lastModified: null },
      { key: "vimeo/teaser.mp4", name: "teaser.mp4", isFolder: false, size: 184, lastModified: "2026-10-14T13:00:00Z" },
    ]);
  });
});
