import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App";
import "./site.css";

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing #root");

// Prerendered HTML names its page in data-page. Start from that page, not the URL's, so hydration
// always matches (a host may serve 404.html or index.html for any URL). In dev there is no data-page.
const app = (
  <StrictMode>
    <App initialPath={container.dataset.page ?? window.location.pathname} />
  </StrictMode>
);

// In dev the HTML is empty, so render. In production it was prerendered, so hydrate:
// React reuses the existing HTML and only attaches event handlers.
if (import.meta.env.DEV) createRoot(container).render(app);
else hydrateRoot(container, app);
