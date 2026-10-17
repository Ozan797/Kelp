import { describe, expect, it } from "vitest";
import { blockWebMenu, keepsWebMenu } from "./webMenu";

describe("keepsWebMenu", () => {
  it("keeps the menu in text fields and over selected text", () => {
    expect(keepsWebMenu(document.createElement("input"), "")).toBe(true);
    expect(keepsWebMenu(document.createElement("textarea"), "")).toBe(true);
    expect(keepsWebMenu(document.createElement("div"), "error text")).toBe(true);
  });

  it("drops the menu everywhere else", () => {
    expect(keepsWebMenu(document.createElement("div"), "")).toBe(false);
    expect(keepsWebMenu(null, "")).toBe(false);
  });

  it("stops the web menu on empty space", () => {
    blockWebMenu(document);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
