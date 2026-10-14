import { describe, expect, it } from "vitest";
import { displayName, fileKind, formatBytes, formatModified } from "./format";

describe("formatBytes", () => {
  it("uses decimal units like Finder", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(92_000)).toBe("92 KB");
    expect(formatBytes(184_000_000)).toBe("184 MB");
    expect(formatBytes(2_100_000_000)).toBe("2.1 GB");
    expect(formatBytes(3_500_000_000_000)).toBe("3.5 TB");
  });

  it("rolls over to the next unit when rounding reaches 1000", () => {
    expect(formatBytes(999_999)).toBe("1 MB");
  });
});

describe("formatModified", () => {
  const now = new Date(2026, 9, 14, 18, 0);

  it("shows the time for today", () => {
    expect(formatModified(new Date(2026, 9, 14, 14, 2).toISOString(), now)).toBe("Today 14:02");
  });

  it("says yesterday", () => {
    expect(formatModified(new Date(2026, 9, 13, 9, 0).toISOString(), now)).toBe("Yesterday");
  });

  it("drops the year within the same year and keeps it otherwise", () => {
    expect(formatModified(new Date(2026, 9, 3).toISOString(), now)).toBe("3 Oct");
    expect(formatModified(new Date(2024, 9, 12).toISOString(), now)).toBe("12 Oct 2024");
  });

  it("shows a dash when unknown", () => {
    expect(formatModified(null, now)).toBe("—");
  });
});

describe("displayName", () => {
  it("removes the folder prefix and the trailing slash", () => {
    expect(displayName("vimeo/2025/teaser.mp4", "vimeo/2025/")).toBe("teaser.mp4");
    expect(displayName("vimeo/2025/", "vimeo/")).toBe("2025");
    expect(displayName("notes.md", "")).toBe("notes.md");
  });
});

describe("fileKind", () => {
  it("groups by extension", () => {
    expect(fileKind("2025", true)).toBe("folder");
    expect(fileKind("teaser.MP4", false)).toBe("video");
    expect(fileKind("thumb.webp", false)).toBe("image");
    expect(fileKind("notes.md", false)).toBe("text");
    expect(fileKind("dump.sql.gz", false)).toBe("other");
    expect(fileKind("README", false)).toBe("other");
  });

  it("does not treat object property names as extensions", () => {
    expect(fileKind("notes.constructor", false)).toBe("other");
  });
});
