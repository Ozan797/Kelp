import type { ReactElement } from "react";
import type { PagePath } from "./config";
import { normalizePath } from "./path";
import Landing from "./pages/Landing";
import GettingStarted from "./pages/docs/GettingStarted";
import Hetzner from "./pages/docs/Hetzner";
import R2 from "./pages/docs/R2";
import S3 from "./pages/docs/S3";
import Troubleshooting from "./pages/docs/Troubleshooting";
import NotFound from "./pages/NotFound";
import Privacy from "./pages/Privacy";

/**
 * A page is a plain function that returns its layout, e.g. <DocsLayout>…</DocsLayout>.
 * The router *calls* it instead of rendering <Page />. That way two docs pages produce the same root
 * element (DocsLayout), so React keeps the shared layout — header, sidebar — mounted and only swaps
 * the content. Rule: page functions must not use hooks; put stateful parts in child components
 * (like DemoWindow).
 */
type Page = () => ReactElement;

// Every entry in PAGES needs a page here. TypeScript reports a missing or extra key.
const ROUTES: Record<PagePath, Page> = {
  "/": Landing,
  "/docs": GettingStarted,
  "/docs/s3": S3,
  "/docs/r2": R2,
  "/docs/hetzner": Hetzner,
  "/docs/troubleshooting": Troubleshooting,
  "/privacy": Privacy,
};

const lookup = (path: string) => (ROUTES as Record<string, Page | undefined>)[normalizePath(path)];

/** True for paths the site can render without a reload. */
export const isKnownPath = (path: string) => lookup(path) !== undefined;

/** The page's element tree; unknown paths get the 404 page. */
export function renderPage(path: string): ReactElement {
  return (lookup(path) ?? NotFound)();
}
