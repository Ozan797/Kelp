import { describe, expect, it } from "vitest";
import { destinationText, dropTarget, dropZone, pillText, summaryText } from "./drop";

const open = { bucket: "media", prefix: "vimeo/" };

function inside(html: string): Element {
  document.body.innerHTML = html;
  const found = document.querySelector("#here");
  if (!found) throw new Error("no #here");
  return found;
}

describe("dropTarget", () => {
  it("drops into a folder row", () => {
    const element = inside('<div data-drop="list"><div data-drop="folder" data-key="vimeo/drafts/"><span id="here"></span></div></div>');
    expect(dropTarget(element, open)).toEqual({ bucket: "media", prefix: "vimeo/drafts/" });
  });

  it("drops onto a bucket's root", () => {
    const element = inside('<button data-drop="bucket" data-bucket="old-site"><span id="here"></span></button>');
    expect(dropTarget(element, open)).toEqual({ bucket: "old-site", prefix: "" });
  });

  it("drops a file row's way into the open folder", () => {
    const element = inside('<div data-drop="list"><div class="file-row"><span id="here"></span></div></div>');
    expect(dropTarget(element, open)).toEqual(open);
  });

  it("has no list target without an open folder, and nothing outside targets", () => {
    const element = inside('<div data-drop="list"><span id="here"></span></div>');
    expect(dropTarget(element, null)).toBeNull();
    expect(dropTarget(inside('<nav><span id="here"></span></nav>'), open)).toBeNull();
    expect(dropTarget(null, open)).toBeNull();
  });
});

describe("drop text", () => {
  it("counts what is dropped", () => {
    expect(summaryText({ files: 3, folders: 0, bytes: 412_000_000, loose: 3 }, 3)).toBe("3 files · 412 MB");
    expect(summaryText({ files: 1, folders: 0, bytes: 5, loose: 1 }, 1)).toBe("1 file · 5 B");
    expect(summaryText({ files: 1204, folders: 1, bytes: 9_800_000_000, loose: 0 }, 1)).toBe("1 folder · 9.8 GB");
    expect(summaryText({ files: 1206, folders: 1, bytes: 9_800_000_000, loose: 2 }, 3)).toBe("1 folder and 2 files · 9.8 GB");
    expect(summaryText({ files: 9, folders: 2, bytes: 1000, loose: 0 }, 2)).toBe("2 folders · 1 KB");
    expect(summaryText({ files: 3, folders: 1, bytes: 10, loose: 1 }, 4)).toBe("1 folder and 1 file · 10 B");
    expect(summaryText(null, 3)).toBe("3 items");
    expect(summaryText(null, 1)).toBe("1 item");
  });

  it("names the destination", () => {
    expect(destinationText({ bucket: "media", prefix: "vimeo/drafts/" })).toBe("vimeo/drafts/");
    expect(destinationText({ bucket: "old-site", prefix: "" })).toBe("old-site");
  });

  it("says what will happen or where to drop", () => {
    expect(pillText("3 files · 412 MB", open)).toBe("Upload 3 files · 412 MB to vimeo/");
    expect(pillText("3 files · 412 MB", null)).toBe("Drop on a folder or a bucket");
  });
});

describe("dropZone", () => {
  it("names the kind of target under the pointer", () => {
    expect(dropZone(inside('<button data-drop="bucket" data-bucket="b"><span id="here"></span></button>'))).toBe("bucket");
    expect(dropZone(inside('<div data-drop="list"><span id="here"></span></div>'))).toBe("list");
    expect(dropZone(inside('<nav><span id="here"></span></nav>'))).toBeNull();
    expect(dropZone(null)).toBeNull();
  });
});
