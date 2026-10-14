import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NewFolderSheet } from "./NewFolderSheet";

describe("NewFolderSheet", () => {
  it("focuses the name field and shows a rejected name inline", async () => {
    const onCreate = vi.fn().mockRejectedValue({ kind: "invalidSettings", message: "Folder names can't contain a slash (/)." });
    render(<NewFolderSheet onCreate={onCreate} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "New folder" })).toBeTruthy();
    const name = screen.getByLabelText("Name");
    expect(document.activeElement).toBe(name);
    await userEvent.type(name, "a/b{Enter}");
    expect(onCreate).toHaveBeenCalledWith("a/b");
    expect((await screen.findByRole("alert")).textContent).toBe("Folder names can't contain a slash (/).");
  });

  it("cancels with Esc, but not while creating", async () => {
    const onCancel = vi.fn();
    const onCreate = vi.fn(() => new Promise<void>(() => undefined));
    render(<NewFolderSheet onCreate={onCreate} onCancel={onCancel} />);
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByLabelText("Name"), "drafts{Enter}");
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
