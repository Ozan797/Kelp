import type { CSSProperties, ReactNode } from "react";
import { hrefFor } from "../config";
import { BrandLogo, type Brand } from "./BrandLogo";
import { Footer } from "./Footer";
import { Header } from "./Header";

const DOCS_NAV: readonly { path: string; label: string; brand?: Brand }[] = [
  { path: "/docs", label: "Getting started" },
  { path: "/docs/s3", label: "Amazon S3", brand: "s3" },
  { path: "/docs/r2", label: "Cloudflare R2", brand: "r2" },
  { path: "/docs/hetzner", label: "Hetzner", brand: "hetzner" },
  { path: "/docs/troubleshooting", label: "Troubleshooting" },
];

type DocsPath = "/docs" | "/docs/s3" | "/docs/r2" | "/docs/hetzner" | "/docs/troubleshooting";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/**
 * Docs page with a sidebar. Animation (see site.css "docs"):
 * - first visit: sidebar links stagger in, then the article fades up (.enter);
 * - moving between docs pages: the article slides, and the highlight pill (.nav-indicator)
 *   glides from the old link to the new one with View Transitions.
 */
export function DocsLayout({ path, title, children }: { path: DocsPath; title: string; children: ReactNode }) {
  const active = DOCS_NAV.findIndex((item) => item.path === path);
  return (
    <>
      <Header />
      <main id="main" className="container docs">
        <nav className="docs-nav" aria-label="Docs">
          {/* Sits before the list so the links always paint above it, even mid-transition. */}
          <span className="nav-indicator" aria-hidden="true" style={{ "--index": active } as CSSProperties} />
          <ul className="nav-list docs-links" role="list">
            {DOCS_NAV.map((item, i) => {
              const current = item.path === path;
              return (
                <li key={item.path} className="enter" style={stagger(i)}>
                  <a href={hrefFor(item.path)} aria-current={current ? "page" : undefined}>
                    {item.brand && <BrandLogo brand={item.brand} className={`side-logo ${item.brand}`} />}
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <article className="prose docs-article enter" style={stagger(2)}>
          <h1>{title}</h1>
          {children}
        </article>
      </main>
      <Footer />
    </>
  );
}
