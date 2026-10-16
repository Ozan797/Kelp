import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MoveSheet } from "./MoveSheet";

describe("MoveSheet", () => {
  it("says what will move, where to, and that the originals go", async () => {
    const onMove = vi.fn();
    const onCancel = vi.fn();
    render(<MoveSheet count={3} plan={{ files: 12, bytes: 3_100_000_000, existing: 0, examples: [] }} destination="drafts/" from="vimeo/" onMove={onMove} onCancel={onCancel} />);
    expect(screen.getByRole("dialog", { name: "Move 3 items to drafts/?" })).toBeTruthy();
    expect(screen.getByText("12 files · 3.1 GB. They will be removed from vimeo/.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Move 3 items" }));
    expect(onMove).toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("uses the singular for one item", () => {
    render(<MoveSheet count={1} plan={{ files: 1, bytes: 5, existing: 0, examples: [] }} destination="old-site" from="vimeo/" onMove={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Move 1 item" })).toBeTruthy();
    expect(screen.getByText("1 file · 5 B. They will be removed from vimeo/.")).toBeTruthy();
  });
});
