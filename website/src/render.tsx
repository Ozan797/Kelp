import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { headFor } from "./head";
import { App } from "./App";

export { NOT_FOUND, PAGES, SITE, pageUrl } from "./config";
export { escapeHtml } from "./head";

/** Renders one page to HTML for scripts/prerender.mjs. */
export function render(path: string): { html: string; head: string } {
  const html = renderToString(
    <StrictMode>
      <App initialPath={path} />
    </StrictMode>,
  );
  return { html, head: headFor(path) };
}
