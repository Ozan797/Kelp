import type { ComponentType } from "react";
import type { PagePath } from "./config";
import { normalizePath } from "./path";
import App from "./App";
import NotFound from "./pages/NotFound";

// Every entry in PAGES needs a component here. TypeScript reports a missing or extra key.
const ROUTES: Record<PagePath, ComponentType> = {
  "/": App,
};

export function pageFor(path: string): ComponentType {
  return (ROUTES as Record<string, ComponentType | undefined>)[normalizePath(path)] ?? NotFound;
}
