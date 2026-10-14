import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { pageFor } from "./routes";
import "./site.css";

const Page = pageFor(window.location.pathname);
const app = (
  <StrictMode>
    <Page />
  </StrictMode>
);

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing #root");

// In dev the HTML is empty, so render. In production it was prerendered, so hydrate:
// React reuses the existing HTML and only attaches event handlers.
if (import.meta.env.DEV) createRoot(container).render(app);
else hydrateRoot(container, app);
