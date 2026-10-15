import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DropOverlay } from "./DropOverlay";

const open = { bucket: "media", prefix: "vimeo/" };
const summary = { files: 3, folders: 0, bytes: 412_000_000, loose: 3 };
const paths = ["/u/a", "/u/b", "/u/c"];

describe("DropOverlay", () => {
  it("covers the list and names the open folder", () => {
    const { container } = render(<DropOverlay drag={{ paths, summary, target: open, zone: "list" }} open={open} />);
    expect(container.querySelector(".drop-panel")).toBeTruthy();
    expect(container.querySelector(".drop-pill")?.textContent).toBe("Upload 3 files · 412 MB to vimeo/");
  });

  it("names the folder row under the pointer", () => {
    const { container } = render(<DropOverlay drag={{ paths, summary, target: { bucket: "media", prefix: "vimeo/drafts/" }, zone: "folder" }} open={open} />);
    expect(container.querySelector(".drop-pill")?.textContent).toBe("Upload 3 files · 412 MB to vimeo/drafts/");
  });

  it("steps aside for a bucket in the sidebar", () => {
    const { container } = render(<DropOverlay drag={{ paths, summary, target: { bucket: "old-site", prefix: "" }, zone: "bucket" }} open={open} />);
    expect(container.querySelector(".drop-panel")).toBeNull();
    expect(container.querySelector(".drop-pill")?.textContent).toBe("Upload 3 files · 412 MB to old-site");
  });

  it("says where to drop when there is no target", () => {
    const { container } = render(<DropOverlay drag={{ paths, summary: null, target: null, zone: null }} open={null} />);
    expect(container.querySelector(".drop-panel")).toBeNull();
    expect(container.querySelector(".drop-pill")?.textContent).toBe("Drop on a folder or a bucket");
  });
});
