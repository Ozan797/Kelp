import { ArticleLayout } from "../components/ArticleLayout";
import { CHANGELOG } from "../content/changelog";

export default function Changelog() {
  return (
    <ArticleLayout title="Changelog" intro="What's new in each version of Kelp.">
      {CHANGELOG.map((release, i) => (
        <section key={release.version} className="release" aria-labelledby={`v${release.version}`}>
          <div className="release-head">
            <h2 id={`v${release.version}`}>Version {release.version}</h2>
            {release.date === null ? (
              <span className="badge">Not released yet</span>
            ) : (
              <>
                {i === 0 && <span className="badge badge-accent">Latest</span>}
                <p>
                  <time dateTime={release.date}>{release.date}</time>
                </p>
              </>
            )}
          </div>
          <ul>
            {release.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </ArticleLayout>
  );
}
