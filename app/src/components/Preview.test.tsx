import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Row } from "../hooks/useListing";
import { Preview } from "./Preview";

const file = (name: string, size: number): Row => ({ key: `v/${name}`, name, isFolder: false, size, lastModified: "2026-10-03T10:00:00Z" });
const files = [file("a.zip", 5), file("b.txt", 2_000_000), file("c.mp4", 9), file("thumb.jpg", 92_000), file("z.md", 3)];

function renderPreview(index: number, overrides: Partial<Parameters<typeof Preview>[0]> = {}) {
  const props = { connectionId: "c1", bucket: "archive", files, index, onIndex: vi.fn(), onClose: vi.fn(), onDownload: vi.fn(), ...overrides };
  render(<Preview {...props} />);
  return props;
}

afterEach(() => vi.restoreAllMocks());

describe("Preview", () => {
  it("shows an image with its details", () => {
    renderPreview(3);
    expect(screen.getByRole("dialog", { name: "thumb.jpg" })).toBeTruthy();
    expect(screen.getByText("92 KB · 3 Oct · 4 of 5")).toBeTruthy();
    expect(screen.getByRole("img", { name: "thumb.jpg" }).getAttribute("src")).toBe("kelp-preview://localhost/c1?bucket=archive&key=v%2Fthumb.jpg");
  });

  it("plays video", () => {
    const { container } = render(<Preview connectionId="c1" bucket="archive" files={files} index={2} onIndex={vi.fn()} onClose={vi.fn()} onDownload={vi.fn()} />);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("kelp-preview://localhost/c1?bucket=archive&key=v%2Fc.mp4");
  });

  it("shows the first megabyte of text and says so", async () => {
    const fetcher = vi.fn(async () => new Response("hello"));
    vi.stubGlobal("fetch", fetcher);
    renderPreview(1);
    expect(await screen.findByText("hello")).toBeTruthy();
    expect(screen.getByText("Showing the first 1 MB.")).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith("kelp-preview://localhost/c1?bucket=archive&key=v%2Fb.txt", { headers: { Range: "bytes=0-1048575" } });
  });

  it("offers Download for files it can't show", async () => {
    const props = renderPreview(0);
    expect(screen.getByText("No preview for this kind of file.")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Download a.zip" })[0]);
    expect(props.onDownload).toHaveBeenCalledWith(files[0]);
  });

  it("steps with the arrow keys and closes with Space or Escape", async () => {
    const props = renderPreview(3);
    await userEvent.keyboard("{ArrowRight}");
    expect(props.onIndex).toHaveBeenLastCalledWith(4);
    await userEvent.keyboard("{ArrowLeft}");
    expect(props.onIndex).toHaveBeenLastCalledWith(2);
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("still listens for keys when focus has fallen out of the preview", async () => {
    const props = renderPreview(4);
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("says when an image can't load and tries again", async () => {
    renderPreview(3);
    fireEvent.error(screen.getByRole("img", { name: "thumb.jpg" }));
    expect(screen.getByText("Kelp couldn't load this preview.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("img", { name: "thumb.jpg" })).toBeTruthy();
  });

  it("stops at the ends", async () => {
    const props = renderPreview(4);
    await userEvent.keyboard("{ArrowRight}");
    expect(props.onIndex).not.toHaveBeenCalled();
  });

  it("says what went wrong when text can't load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Access denied.", { status: 502 })));
    renderPreview(4);
    await waitFor(() => expect(screen.getByText("Access denied.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
