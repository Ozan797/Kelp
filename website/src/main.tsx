import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { pageFor } from "./routes";
import "./site.css";

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing #root");

// Prerendered HTML names its page in data-page. Hydrate that page, not the URL's, so the two always
// match (a host may serve 404.html or index.html for any URL). In dev there is no data-page.
const Page = pageFor(container.dataset.page ?? window.location.pathname);
const app = (
  <StrictMode>
    <Page />
  </StrictMode>
);

// In dev the HTML is empty, so render. In production it was prerendered, so hydrate:
// React reuses the existing HTML and only attaches event handlers.
if (import.meta.env.DEV) createRoot(container).render(app);
else hydrateRoot(container, app);
