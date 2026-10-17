import { SITE, hrefFor } from "../config";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <span>{SITE.domain}</span>
        <nav aria-label="Footer">
          <a href={hrefFor("/docs")}>Docs</a>
          <a href={hrefFor("/whats-new")}>What's new</a>
          <a href={hrefFor("/privacy")}>Privacy</a>
        </nav>
      </div>
    </footer>
  );
}
