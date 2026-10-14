import { ArticleLayout } from "../components/ArticleLayout";
import { CHANGELOG, PLANNED, formatDate, type ChangeType } from "../content/changelog";

const GROUPS: { type: ChangeType; label: string }[] = [
  { type: "new", label: "New" },
  { type: "improved", label: "Improved" },
  { type: "fixed", label: "Fixed" },
];

export default function Changelog() {
  return (
    <ArticleLayout title="Changelog" intro="What's new in each version of Kelp, and what's coming next." wide>
      <ol className="timeline" role="list">
        {CHANGELOG.map((release, i) => (
          <li key={release.version} className="timeline-item reveal">
            <div className="timeline-meta">
              <h2 id={`v${release.version}`}>Version {release.version}</h2>
              {release.date === null ? (
                <span className="badge">Not released yet</span>
              ) : (
                <>
                  <time dateTime={release.date}>{formatDate(release.date)}</time>
                  {i === 0 && <span className="badge badge-accent">Latest</span>}
                </>
              )}
            </div>
            <section className="card release-card" aria-labelledby={`v${release.version}`}>
              <p className="release-summary">{release.summary}</p>
              {GROUPS.map(({ type, label }) => {
                const changes = release.changes.filter((change) => change.type === type);
                if (changes.length === 0) return null;
                return (
                  <div key={type} className="change-group">
                    <h3 className="change-type">
                      <span className={`change-dot change-${type}`} aria-hidden="true" />
                      {label}
                    </h3>
                    <ul>
                      {changes.map((change) => (
                        <li key={change.text}>{change.text}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          </li>
        ))}
      </ol>

      <section className="planned reveal" aria-labelledby="planned-title">
        <h2 id="planned-title">Planned</h2>
        <p className="section-intro">What's being built next. Plans can change, so there are no dates here.</p>
        <div className="planned-grid">
          {PLANNED.map((group) => (
            <div key={group.title} className="card">
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </ArticleLayout>
  );
}
