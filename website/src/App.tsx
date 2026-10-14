import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { NOT_FOUND, PAGES, pageUrl, type PageMeta } from "./config";
import { normalizePath } from "./path";
import { isKnownPath, renderPage } from "./routes";

/** Keeps the tab title, description and canonical link in step with the page shown. */
function updateHead(path: string) {
  const page: PageMeta = PAGES.find((p) => p.path === normalizePath(path)) ?? NOT_FOUND;
  document.title = page.title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", page.description);
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", pageUrl(page.path));
  return page.title;
}

/**
 * The whole site. The first visit is prerendered HTML; after that, clicks on internal links swap the
 * page in place instead of reloading, so shared layout (header, docs sidebar) never re-renders and
 * the change can animate with a View Transition.
 */
export function App({ initialPath }: { initialPath: string }) {
  const [path, setPath] = useState(initialPath);
  // Screen readers don't notice an in-place page change, so announce the new title.
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const go = (url: URL, push: boolean) => {
      const update = () => {
        if (push) history.pushState(null, "", url.href);
        // flushSync makes React update the DOM right now, inside the transition callback, so the
        // browser captures the finished new page (a normal setState would update a moment later).
        flushSync(() => setPath(url.pathname));
        setAnnouncement(updateHead(url.pathname));
        if (url.hash) document.getElementById(url.hash.slice(1))?.scrollIntoView();
        else window.scrollTo(0, 0);
      };
      const animate =
        "startViewTransition" in document && matchMedia("(prefers-reduced-motion: no-preference)").matches;
      if (animate) document.startViewTransition(update);
      else update();
    };

    const onClick = (e: MouseEvent) => {
      // Leave new-tab clicks, downloads, other sites and unknown pages to the browser.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest("a") : null;
      if (!link || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || !isKnownPath(url.pathname)) return;
      // Same page, different #section: let the browser scroll there.
      if (url.hash && normalizePath(url.pathname) === normalizePath(location.pathname)) return;
      e.preventDefault();
      if (url.href !== location.href) go(url, true);
    };
    const onBackForward = () => go(new URL(location.href), false);

    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onBackForward);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onBackForward);
    };
  }, []);

  return (
    <>
      {renderPage(path)}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
