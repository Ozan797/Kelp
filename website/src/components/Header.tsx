import { SITE, hrefFor } from "../config";
import { Logo } from "./Logo";
import { ThemeSwitch } from "./ThemeSwitch";

/** Navy site header. Every page renders <main id="main"> right after it. */
export function Header() {
  return (
    <header className="site-header theme-dark">
      <a className="skip-link button button-primary" href="#main">
        Skip to content
      </a>
      <div className="container site-header-inner">
        <a className="brand" href="/">
          <Logo />
          {SITE.name}
        </a>
        <div className="header-actions">
          <nav className="header-nav" aria-label="Main">
            <a href={hrefFor("/docs")}>Docs</a>
            <a className="hide-xs" href={hrefFor("/whats-new")}>
              What's new
            </a>
            <a className="hide-xs" href={SITE.repoUrl}>
              GitHub
            </a>
          </nav>
          <ThemeSwitch />
          {/* Jumps to the "Get Kelp" section; the download itself lives there. */}
          <a className="button button-primary hide-sm" href="/#download">
            Get Kelp
          </a>
        </div>
      </div>
    </header>
  );
}
