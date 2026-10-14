import type { ReactNode } from "react";
import { hrefFor } from "../config";
import { Footer } from "./Footer";
import { Header } from "./Header";

const DOCS_NAV = [
  { path: "/docs", label: "Getting started" },
  { path: "/docs/s3", label: "Amazon S3" },
  { path: "/docs/r2", label: "Cloudflare R2" },
  { path: "/docs/hetzner", label: "Hetzner" },
  { path: "/docs/troubleshooting", label: "Troubleshooting" },
] as const;

type DocsPath = (typeof DOCS_NAV)[number]["path"];

export function DocsLayout({ path, title, children }: { path: DocsPath; title: string; children: ReactNode }) {
  return (
    <>
      <Header />
      <main id="main" className="container docs">
        <nav className="docs-nav" aria-label="Docs">
          <ul className="nav-list" role="list">
            {DOCS_NAV.map((item) => (
              <li key={item.path}>
                <a href={hrefFor(item.path)} aria-current={item.path === path ? "page" : undefined}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <article className="prose">
          <h1>{title}</h1>
          {children}
        </article>
      </main>
      <Footer />
    </>
  );
}
