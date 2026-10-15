import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../lib/tauri";
import type { Transfer } from "../hooks/useTransfers";
import { Rail } from "./Rail";
import { crumbsFor } from "./Toolbar";
import { transferSummary } from "./StatusBar";

const media: ConnectionProfile = {
  id: "c1",
  name: "media",
  settings: { kind: "hetzner", endpoint: null, region: "hel1", pathStyle: false, accessKeyId: "AKID" },
  bucket: null,
  lastLocation: null,
};

describe("Rail", () => {
  it("names each tile for screen readers and marks the open one", async () => {
    const onSelect = vi.fn();
    const onSettings = vi.fn();
    render(<Rail connections={[media]} selectedId="c1" onSelect={onSelect} onAdd={vi.fn()} onContextMenu={vi.fn()} onSettings={onSettings} />);
    const tile = screen.getByRole("button", { name: "Hetzner · media" });
    expect(tile.getAttribute("aria-current")).toBe("true");
    await userEvent.click(tile);
    expect(onSelect).toHaveBeenCalledWith("c1");
    expect(screen.getByRole("button", { name: "Add a connection" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onSettings).toHaveBeenCalled();
  });
});

describe("crumbsFor", () => {
  it("starts at the bucket and adds one crumb per folder", () => {
    expect(crumbsFor("media", "vimeo/2025/")).toEqual([
      { label: "media", prefix: "" },
      { label: "vimeo", prefix: "vimeo/" },
      { label: "2025", prefix: "vimeo/2025/" },
    ]);
    expect(crumbsFor("media", "")).toEqual([{ label: "media", prefix: "" }]);
  });
});

function transfer(partial: Partial<Transfer>): Transfer {
  return {
    id: "t", direction: "upload", kind: "file", name: "a", destination: "d", status: "running", retryAt: null,
    total: 100, done: 0, filesTotal: 1, filesDone: 0, filesFailed: 0, error: null, path: null,
    speed: null, sample: null, ...partial,
  };
}

describe("transferSummary", () => {
  it("is empty only when there are no transfers", () => {
    expect(transferSummary([])).toBeNull();
  });

  it("counts finished and cancelled transfers once nothing is running", () => {
    expect(transferSummary([transfer({ id: "1", status: "finished" }), transfer({ id: "2", status: "finished" })])).toBe("2 finished");
    expect(transferSummary([transfer({ id: "1", status: "finished" }), transfer({ id: "2", status: "failed" })])).toBe("1 finished · 1 failed");
    expect(transferSummary([transfer({ id: "1" }), transfer({ id: "2", status: "finished" })])).toBe("Uploading 1 file · 0%");
    expect(transferSummary([transfer({ status: "cancelled" })])).toBe("1 cancelled");
  });

  it("counts running uploads and downloads with overall progress and failures", () => {
    expect(
      transferSummary([
        transfer({ id: "1", done: 50 }),
        transfer({ id: "2", done: 78 }),
        transfer({ id: "3", status: "failed" }),
      ]),
    ).toBe("Uploading 2 files · 64% · 1 failed");
    expect(transferSummary([transfer({ direction: "download", done: 10 })])).toBe("Downloading 1 file · 10%");
    expect(
      transferSummary([transfer({ id: "1" }), transfer({ id: "2", direction: "download" })]),
    ).toBe("Transferring 2 files · 0%");
    expect(transferSummary([transfer({ status: "failed" })])).toBe("1 failed");
  });

  it("counts waiting and retrying transfers as in progress and paused ones apart", () => {
    expect(
      transferSummary([
        transfer({ id: "1", status: "waiting" }),
        transfer({ id: "2", status: "retrying", done: 50 }),
        transfer({ id: "3", status: "paused" }),
      ]),
    ).toBe("Uploading 2 files · 25% · 1 paused");
    expect(transferSummary([transfer({ status: "paused" })])).toBe("1 paused");
  });
});

describe("BucketColumn drop targets", () => {
  it("marks buckets as drop targets and highlights the one under the pointer", async () => {
    const { BucketColumn } = await import("./BucketColumn");
    render(<BucketColumn connection={media} buckets={["media-archive", "old-site"]} error={null} selected="media-archive" onSelect={vi.fn()} dropBucket="old-site" />);
    const oldSite = screen.getByRole("button", { name: "old-site" });
    expect(oldSite.getAttribute("data-drop")).toBe("bucket");
    expect(oldSite.getAttribute("data-bucket")).toBe("old-site");
    expect(oldSite.classList.contains("drop-target")).toBe(true);
    expect(screen.getByRole("button", { name: "media-archive" }).classList.contains("drop-target")).toBe(false);
  });
});

describe("drag targets in the frame", () => {
  it("marks breadcrumbs as folders and other connections as copy targets", async () => {
    const { Toolbar } = await import("./Toolbar");
    render(
      <Toolbar bucket="media" prefix="vimeo/2025/" canBack={false} canForward={false} onBack={vi.fn()} onForward={vi.fn()} onNavigate={vi.fn()} filter="" onFilter={vi.fn()} onNewFolder={vi.fn()} onUpload={vi.fn()} dropKey="vimeo/" />,
    );
    const crumb = screen.getByRole("button", { name: "vimeo" });
    expect(crumb.getAttribute("data-drop")).toBe("folder");
    expect(crumb.getAttribute("data-key")).toBe("vimeo/");
    expect(crumb.classList.contains("drop-target")).toBe(true);
    expect(screen.getByRole("button", { name: "media" }).getAttribute("data-key")).toBe("");
  });

  it("marks connection tiles as drop targets", () => {
    const cdn: ConnectionProfile = { ...media, id: "c2", name: "cdn", settings: { ...media.settings, kind: "r2" } };
    render(<Rail connections={[media, cdn]} selectedId="c1" onSelect={vi.fn()} onAdd={vi.fn()} onContextMenu={vi.fn()} onSettings={vi.fn()} dropConnection="c2" />);
    const tile = screen.getByRole("button", { name: "Cloudflare · cdn" });
    expect(tile.getAttribute("data-drop")).toBe("connection");
    expect(tile.getAttribute("data-connection")).toBe("c2");
    expect(tile.classList.contains("drop-target")).toBe(true);
  });
});
