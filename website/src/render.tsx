import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { headFor } from "./head";
import { pageFor } from "./routes";

export { NOT_FOUND, PAGES, SITE, pageUrl } from "./config";
export { escapeHtml } from "./head";

/** Renders one page to HTML for scripts/prerender.mjs. */
export function render(path: string): { html: string; head: string } {
  const Page = pageFor(path);
  const html = renderToString(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
  return { html, head: headFor(path) };
}
