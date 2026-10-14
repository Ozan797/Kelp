import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  body: string;
  actions?: ReactNode;
  tone?: "neutral" | "error";
  image?: ReactNode;
};

export function EmptyState({ title, body, actions, tone = "neutral", image }: EmptyStateProps) {
  return (
    <section className={`empty ${tone}`} aria-live="polite">
      {image ?? <span className="empty-icon" aria-hidden="true">{tone === "error" ? "!" : "⤓"}</span>}
      <h2>{title}</h2>
      <p>{body}</p>
      {actions && <div className="empty-actions">{actions}</div>}
    </section>
  );
}
