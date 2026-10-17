import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transfer } from "../hooks/useTransfers";
import { TransfersButton, TransfersPanel } from "./TransfersPanel";

function transfer(partial: Partial<Transfer>): Transfer {
  return {
    id: "t",
    direction: "upload",
    kind: "file",
    name: "a.mp4",
    destination: "media/vimeo/",
    status: "running",
    retryAt: null,
    total: 2_100_000_000,
    done: 1_344_000_000,
    filesTotal: 1,
    filesDone: 0,
    filesFailed: 0,
    error: null,
    path: null,
    speed: null,
    sample: null,
    moving: false,
    ...partial,
  };
}

const sample = [
  transfer({ id: "1" }),
  transfer({ id: "2", name: "raw.mov", status: "failed", error: "Kelp couldn't reach the storage provider." }),
  transfer({ id: "3", name: "thumb.jpg", direction: "download", status: "finished", path: "/Users/me/Downloads/thumb.jpg", total: 92_000, done: 92_000 }),
  transfer({ id: "4", name: "clip.mp4", status: "waiting", done: 0 }),
  transfer({ id: "5", name: "backup.tar", status: "paused", total: 20_000_000_000, done: 7_600_000_000 }),
];

function renderPanel(overrides: Partial<Parameters<typeof TransfersPanel>[0]> = {}) {
  const props = {
    transfers: sample,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onRetry: vi.fn(),
    onCancel: vi.fn(),
    onPauseAll: vi.fn(),
    onResumeAll: vi.fn(),
    onReveal: vi.fn(),
    onClearFinished: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<TransfersPanel {...props} />);
  return props;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TransfersPanel", () => {
  it("lists what needs attention first", () => {
    renderPanel();
    const names = Array.from(document.querySelectorAll(".transfer-title strong")).map((name) => name.textContent);
    expect(names).toEqual(["a.mp4", "raw.mov", "clip.mp4", "backup.tar", "thumb.jpg"]);
  });

  it("closes when you click outside it, but not inside", async () => {
    const props = renderPanel();
    await userEvent.click(screen.getByText("a.mp4"));
    expect(props.onClose).not.toHaveBeenCalled();
    await userEvent.click(document.body);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("says what shows up here when it's empty", () => {
    renderPanel({ transfers: [] });
    expect(screen.getByText("Uploads, downloads and copies show up here.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Clear finished" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows progress and lets you pause or cancel a running transfer", async () => {
    const props = renderPanel();
    expect(screen.getByText("64% · 1.3 GB of 2.1 GB")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Pause a.mp4" }));
    expect(props.onPause).toHaveBeenCalledWith("1");
    await userEvent.click(screen.getByRole("button", { name: "Cancel a.mp4" }));
    expect(props.onCancel).toHaveBeenCalledWith("1");
  });

  it("shows speed and time left once known", () => {
    renderPanel({ transfers: [transfer({ id: "1", total: 4_500_000_000, done: 2_900_000_000, speed: 48_000_000 })] });
    expect(screen.getByText("48 MB/s · 34 s left")).toBeTruthy();
  });

  it("switches to minutes when more than a minute is left", () => {
    renderPanel({ transfers: [transfer({ id: "1", total: 50_000_000_000, done: 0, speed: 25_000_000 })] });
    expect(screen.getByText("25 MB/s · 34 min left")).toBeTruthy();
  });

  it("resumes a paused transfer", async () => {
    const props = renderPanel();
    expect(screen.getByText("Paused at 38%")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Resume backup.tar" }));
    expect(props.onResume).toHaveBeenCalledWith("5");
  });

  it("explains a failure and offers Retry", async () => {
    const props = renderPanel();
    expect(screen.getByText("Kelp couldn't reach the storage provider.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry raw.mov" }));
    expect(props.onRetry).toHaveBeenCalledWith("2");
    await userEvent.click(screen.getByRole("button", { name: "Remove raw.mov" }));
    expect(props.onCancel).toHaveBeenCalledWith("2");
  });

  it("counts down to the next attempt while retrying", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    renderPanel({ transfers: [transfer({ id: "1", status: "retrying", retryAt: 1_008_000 })] });
    expect(screen.getByText("Connection dropped · Retrying in 8 s")).toBeTruthy();
  });

  it("offers Show in Finder for finished downloads", async () => {
    const props = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Show thumb.jpg in Finder" }));
    expect(props.onReveal).toHaveBeenCalledWith("/Users/me/Downloads/thumb.jpg");
  });

  it("offers Pause all while anything is active and Resume all when only paused ones are left", async () => {
    const props = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Pause all" }));
    expect(props.onPauseAll).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Resume all" })).toBeNull();
  });

  it("offers Resume all when everything left is paused", async () => {
    const props = renderPanel({ transfers: [transfer({ id: "5", status: "paused" }), transfer({ id: "3", status: "finished" })] });
    expect(screen.queryByRole("button", { name: "Pause all" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Resume all" }));
    expect(props.onResumeAll).toHaveBeenCalled();
  });

  it("closes with Escape and clears finished transfers on request", async () => {
    const props = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Clear finished" }));
    expect(props.onClearFinished).toHaveBeenCalled();
    screen.getByRole("dialog", { name: "Transfers" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("shows folders as one row with a file count", () => {
    renderPanel({
      transfers: [
        transfer({
          id: "f",
          kind: "folder",
          name: "photos",
          total: 9_800_000_000,
          done: 3_100_000_000,
          filesTotal: 1204,
          filesDone: 412,
          filesFailed: 2,
        }),
      ],
    });
    expect(screen.getByText("412 of 1,204 files · 3.1 GB of 9.8 GB")).toBeTruthy();
    expect(screen.getByText("2 files failed")).toBeTruthy();
  });

  it("retries only the failed files of a folder", async () => {
    const props = renderPanel({
      transfers: [transfer({ id: "f", kind: "folder", name: "photos", status: "failed", error: "2 files failed.", filesTotal: 10, filesFailed: 2 })],
    });
    expect(screen.getByText("2 files failed.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry failed files in photos" }));
    expect(props.onRetry).toHaveBeenCalledWith("f");
  });

  it("shows copies and moves", async () => {
    renderPanel({
      transfers: [
        transfer({ id: "c", direction: "copy", name: "a.jpg", destination: "cdn/web/", status: "finished", moving: true }),
        transfer({ id: "d", direction: "copy", name: "b.jpg", destination: "cdn/web/", status: "finished" }),
      ],
    });
    expect(screen.getByText("Moved")).toBeTruthy();
    expect(screen.getByText("Copied")).toBeTruthy();
    expect(screen.getAllByText("to cdn/web/")).toHaveLength(2);
  });

  it("never shows more than 100 percent", () => {
    renderPanel({ transfers: [transfer({ done: 3_000_000_000 })] });
    expect(screen.getByText("100% · 3 GB of 2.1 GB")).toBeTruthy();
  });

  it("names the real download folder", async () => {
    renderPanel({ transfers: [transfer({ id: "d", direction: "download", status: "finished", path: "/Users/me/Desktop/x.jpg" })] });
    expect(screen.getByText("to Desktop")).toBeTruthy();
  });

  it("lists cancelled transfers", () => {
    renderPanel({ transfers: [transfer({ name: "gone.mp4", status: "cancelled" })] });
    expect(screen.getByText("gone.mp4")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });
});

describe("TransfersButton", () => {
  const button = () => screen.getByRole("button", { name: "Transfers" }) as HTMLButtonElement;

  it("is greyed out until there is something to show", () => {
    render(<TransfersButton transfers={[]} open={false} pulse={0} onToggle={vi.fn()} />);
    expect(button().disabled).toBe(true);
  });

  it("toggles the panel and says whether it's open", async () => {
    const onToggle = vi.fn();
    render(<TransfersButton transfers={sample} open pulse={0} onToggle={onToggle} />);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(button());
    expect(onToggle).toHaveBeenCalled();
  });

  it("shows a progress ring while running and a dot when something failed", () => {
    render(<TransfersButton transfers={sample} open={false} pulse={0} onToggle={vi.fn()} />);
    expect(button().querySelector(".transfers-ring")).not.toBeNull();
    expect(button().querySelector(".transfers-dot")).not.toBeNull();
  });

  it("pulses when a transfer starts", () => {
    render(<TransfersButton transfers={sample} open={false} pulse={1} onToggle={vi.fn()} />);
    expect(button().querySelector(".transfers-glyph.pulse")).not.toBeNull();
  });
});
