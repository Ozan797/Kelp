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
    render(<Rail connections={[media]} selectedId="c1" onSelect={onSelect} onAdd={vi.fn()} onContextMenu={vi.fn()} />);
    const tile = screen.getByRole("button", { name: "Hetzner · media" });
    expect(tile.getAttribute("aria-current")).toBe("true");
    await userEvent.click(tile);
    expect(onSelect).toHaveBeenCalledWith("c1");
    expect(screen.getByRole("button", { name: "Add a connection" })).toBeTruthy();
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
    id: "t", direction: "upload", name: "a", destination: "d", total: 100,
    status: "running", done: 0, error: null, path: null, ...partial,
  };
}

describe("transferSummary", () => {
  it("is empty when nothing is happening", () => {
    expect(transferSummary([])).toBeNull();
    expect(transferSummary([transfer({ status: "finished" })])).toBeNull();
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
});
