import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type ConnectionProfile } from "../lib/tauri";
import { CopySheet } from "./CopySheet";

const cdn: ConnectionProfile = { id: "c2", name: "cdn", settings: { kind: "r2", endpoint: null, region: "auto", pathStyle: false, accessKeyId: "A" }, bucket: null, lastLocation: null };

afterEach(() => vi.restoreAllMocks());

describe("CopySheet", () => {
  it("picks a bucket and a folder on the other connection, then copies", async () => {
    vi.spyOn(api, "listBuckets").mockResolvedValue(["cdn-assets", "cdn-staging"]);
    const list = vi.spyOn(api, "listObjects").mockImplementation(async (_id, _bucket, prefix) =>
      prefix === "" ? { folders: ["video/"], objects: [], nextToken: null } : { folders: [], objects: [], nextToken: null },
    );
    const onCopy = vi.fn();
    render(<CopySheet connection={cdn} names={["teaser.mp4", "thumb.jpg"]} onCopy={onCopy} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Copy 2 items to Cloudflare · cdn" })).toBeTruthy();
    expect(screen.getByText("teaser.mp4 and thumb.jpg. They stay where they are.")).toBeTruthy();
    expect(await screen.findByRole("radio", { name: "cdn-assets" })).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: "video" }));
    expect(list).toHaveBeenLastCalledWith("c2", "cdn-assets", "video/", null);
    expect(screen.getByText("cdn-assets / video /")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Copy 2 items" }));
    expect(onCopy).toHaveBeenCalledWith("cdn-assets", "video/");
  });

  it("counts many items instead of naming them", async () => {
    vi.spyOn(api, "listBuckets").mockResolvedValue(["b"]);
    vi.spyOn(api, "listObjects").mockResolvedValue({ folders: [], objects: [], nextToken: null });
    render(<CopySheet connection={cdn} names={["a", "b", "c"]} onCopy={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("3 items. They stay where they are.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Copy 3 items" })).toBeTruthy();
  });
});
