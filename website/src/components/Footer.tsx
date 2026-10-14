import { SITE, hrefFor } from "../config";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <span>{SITE.domain}</span>
        <nav aria-label="Footer">
          <a href={hrefFor("/docs")}>Docs</a>
          <a href={hrefFor("/changelog")}>Changelog</a>
          <a href={hrefFor("/privacy")}>Privacy</a>
          <a href={SITE.repoUrl}>Source on GitHub</a>
        </nav>
      </div>
    </footer>
  );
}
