export function keepsWebMenu(target: EventTarget | null, selectedText: string): boolean {
  if (selectedText.length > 0) return true;
  return target instanceof Element && target.closest("input, textarea") !== null;
}

export function blockWebMenu(doc: Document) {
  doc.addEventListener("contextmenu", (event) => {
    if (!keepsWebMenu(event.target, doc.getSelection()?.toString() ?? "")) event.preventDefault();
  });
}
