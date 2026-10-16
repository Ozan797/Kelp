import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../lib/tauri";
import type { Tab } from "../hooks/useTabs";
import { TabStrip } from "./TabStrip";

const media: ConnectionProfile = { id: "c1", name: "media", settings: { kind: "hetzner", endpoint: null, region: "hel1", pathStyle: false, accessKeyId: "A" }, bucket: null, lastLocation: null };
const cdn: ConnectionProfile = { ...media, id: "c2", name: "cdn", settings: { ...media.settings, kind: "r2" } };

const tabs: Tab[] = [
  { id: "a", connectionId: "c1", place: { bucket: "media-archive", prefix: "vimeo/2025/" } },
  { id: "b", connectionId: "c2", place: null },
];

function renderStrip(list: Tab[] = tabs) {
  const props = { tabs: list, activeId: "a", connections: [media, cdn], onSelect: vi.fn(), onClose: vi.fn(), onNew: vi.fn() };
  render(<TabStrip {...props} />);
  return props;
}

describe("TabStrip", () => {
  it("is hidden with one tab", () => {
    renderStrip([tabs[0]]);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("names each tab after its bucket and folder, or its connection", () => {
    renderStrip();
    expect(screen.getByRole("tab", { name: "media-archive / 2025" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "cdn" }).getAttribute("aria-selected")).toBe("false");
  });

  it("follows the tabs pattern: panels, arrow keys and one tab stop", async () => {
    const props = renderStrip();
    const [first, second] = screen.getAllByRole("tab");
    expect(first.getAttribute("aria-controls")).toBe("tab-panel-a");
    expect(first.tabIndex).toBe(0);
    expect(second.tabIndex).toBe(-1);
    first.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(props.onSelect).toHaveBeenCalledWith("b");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.closest('[role="tablist"]')?.querySelectorAll("button:not([role=tab])").length).toBe(0);
    }
  });

  it("selects, closes and opens tabs", async () => {
    const props = renderStrip();
    await userEvent.click(screen.getByRole("tab", { name: "cdn" }));
    expect(props.onSelect).toHaveBeenCalledWith("b");
    await userEvent.click(screen.getByLabelText("Close cdn"));
    expect(props.onClose).toHaveBeenCalledWith("b");
    await userEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(props.onNew).toHaveBeenCalled();
  });
});
