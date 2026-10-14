import type { ComponentType } from "react";
import type { PagePath } from "./config";
import { normalizePath } from "./path";
import Landing from "./pages/Landing";
import GettingStarted from "./pages/docs/GettingStarted";
import Hetzner from "./pages/docs/Hetzner";
import R2 from "./pages/docs/R2";
import S3 from "./pages/docs/S3";
import Troubleshooting from "./pages/docs/Troubleshooting";
import NotFound from "./pages/NotFound";

// Every entry in PAGES needs a component here. TypeScript reports a missing or extra key.
const ROUTES: Record<PagePath, ComponentType> = {
  "/": Landing,
  "/docs": GettingStarted,
  "/docs/s3": S3,
  "/docs/r2": R2,
  "/docs/hetzner": Hetzner,
  "/docs/troubleshooting": Troubleshooting,
};

export function pageFor(path: string): ComponentType {
  return (ROUTES as Record<string, ComponentType | undefined>)[normalizePath(path)] ?? NotFound;
}
