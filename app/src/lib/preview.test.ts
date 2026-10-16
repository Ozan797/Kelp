import { describe, expect, it } from "vitest";
import { previewKind, previewUrl } from "./preview";

const row = (name: string, size: number) => ({ key: `v/${name}`, name, isFolder: false, size, lastModified: null });

describe("previewUrl", () => {
  it("puts bucket and key in the query so dots and slashes reach Rust untouched", () => {
    expect(previewUrl("c1", "media archive", "a/../b#?ü.txt")).toBe(
      "kelp-preview://localhost/c1?bucket=media%20archive&key=a%2F..%2Fb%23%3F%C3%BC.txt",
    );
  });
});

describe("previewKind", () => {
  it("previews images up to 50 MB, video, and text", () => {
    expect(previewKind(row("a.jpg", 1000))).toBe("image");
    expect(previewKind(row("a.jpg", 60_000_000))).toBe("none");
    expect(previewKind(row("a.mov", 9_000_000_000))).toBe("video");
    expect(previewKind(row("notes.md", 5))).toBe("text");
    expect(previewKind(row("a.zip", 5))).toBe("none");
  });
});
