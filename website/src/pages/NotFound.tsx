import { Bubbles } from "../components/Bubbles";
import { Header } from "../components/Header";

export default function NotFound() {
  return (
    <>
      <Header />
      <main id="main" className="band theme-dark not-found">
        <Bubbles />
        <div className="container not-found-body">
          <h1>This page drifted off.</h1>
          <p>The link may be old, or the page may have moved.</p>
          <p>
            <a className="button button-primary button-lg" href="/">
              Go to the home page
            </a>
          </p>
        </div>
      </main>
    </>
  );
}
