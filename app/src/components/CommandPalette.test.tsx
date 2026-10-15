import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Command } from "../lib/palette";
import { CommandPalette } from "./CommandPalette";

function commands(run: (id: string) => void): Command[] {
  return [
    { id: "folder:drafts", label: "drafts", detail: "media-archive/vimeo/", group: "places", run: () => run("drafts") },
    { id: "folder:old-drafts", label: "old-drafts", detail: "media-archive/vimeo/", group: "places", run: () => run("old-drafts") },
    { id: "new-folder", label: "New folder…", shortcut: "⌘⇧N", group: "actions", run: () => run("new-folder") },
  ];
}

describe("CommandPalette", () => {
  it("filters as you type and runs the highlighted command with Return", async () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette commands={commands(run)} onClose={onClose} />);
    const field = screen.getByRole("combobox", { name: "Search commands and places" });
    expect(document.activeElement).toBe(field);
    await userEvent.type(field, "dra");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["draftsmedia-archive/vimeo/", "old-draftsmedia-archive/vimeo/"]);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(run).toHaveBeenCalledWith("old-drafts");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows shortcuts and runs a command on click", async () => {
    const run = vi.fn();
    render(<CommandPalette commands={commands(run)} onClose={vi.fn()} />);
    expect(screen.getByText("⌘⇧N")).toBeTruthy();
    await userEvent.click(screen.getByRole("option", { name: /New folder/ }));
    expect(run).toHaveBeenCalledWith("new-folder");
  });

  it("closes with Escape and gives focus back", async () => {
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    const onClose = vi.fn();
    const { unmount } = render(<CommandPalette commands={commands(vi.fn())} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it("scrolls the highlighted item into view", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<CommandPalette commands={commands(vi.fn())} onClose={vi.fn()} />);
    await userEvent.keyboard("{ArrowDown}");
    expect(scroll).toHaveBeenLastCalledWith({ block: "nearest" });
    expect(scroll.mock.contexts[scroll.mock.contexts.length - 1]).toBe(screen.getAllByRole("option")[1]);
  });

  it("points at the highlighted item with a valid id, whatever the folder is called", () => {
    const spaced: Command[] = [{ id: "folder:my photos/2024/", label: "2024", group: "places", run: vi.fn() }];
    render(<CommandPalette commands={spaced} onClose={vi.fn()} />);
    const target = screen.getByRole("combobox").getAttribute("aria-activedescendant") ?? "";
    expect(target).not.toMatch(/\s/);
    expect(document.getElementById(target)?.textContent).toBe("2024");
  });

  it("keeps the list it opened with while it is open", async () => {
    const run = vi.fn();
    const first = commands(run);
    const { rerender } = render(<CommandPalette commands={first} onClose={vi.fn()} />);
    rerender(<CommandPalette commands={[{ id: "pause", label: "Pause all transfers", group: "actions", run: () => run("pause") }, ...first]} onClose={vi.fn()} />);
    await userEvent.keyboard("{Enter}");
    expect(run).toHaveBeenCalledWith("new-folder");
  });

  it("says when nothing matches", async () => {
    render(<CommandPalette commands={commands(vi.fn())} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "zzz");
    expect(screen.getByText("No matches")).toBeTruthy();
  });
});
