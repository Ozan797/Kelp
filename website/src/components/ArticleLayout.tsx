import type { CSSProperties, ReactNode } from "react";
import { Bubbles } from "./Bubbles";
import { Footer } from "./Footer";
import { Header } from "./Header";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** Page with a navy title band. `wide` drops the 68ch reading width (for layouts like the changelog). */
export function ArticleLayout({
  title,
  intro,
  wide = false,
  children,
}: {
  title: string;
  intro: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <Header />
      <main id="main">
        <div className="band theme-dark">
          <Bubbles />
          <div className="container band-title">
            <h1 className="enter" style={stagger(0)}>
              {title}
            </h1>
            <p className="enter" style={stagger(1)}>
              {intro}
            </p>
          </div>
        </div>
        <article className="container article enter" style={stagger(2)}>
          <div className={wide ? "article-wide" : "prose"}>{children}</div>
        </article>
      </main>
      <Footer />
    </>
  );
}
