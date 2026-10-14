import type { CSSProperties } from "react";

// Position, size, rise duration and start offset for each bubble. Kept sparse so text stays readable.
const BUBBLES = [
  { x: "8%", size: "6px", d: "9s", delay: "0s" },
  { x: "18%", size: "4px", d: "7s", delay: "-3s" },
  { x: "31%", size: "6px", d: "11s", delay: "-6s" },
  { x: "61%", size: "3px", d: "6s", delay: "-1s" },
  { x: "72%", size: "8px", d: "9s", delay: "-2s" },
  { x: "83%", size: "4px", d: "8s", delay: "-5s" },
  { x: "92%", size: "6px", d: "12s", delay: "-8s" },
];

/** Ambient bubbles for a navy band. Hidden when the user prefers reduced motion. */
export function Bubbles() {
  return (
    <div className="bubbles" aria-hidden="true">
      {BUBBLES.map((b) => (
        <span
          key={b.x}
          style={{ "--x": b.x, "--size": b.size, "--d": b.d, "--delay": b.delay } as CSSProperties}
        />
      ))}
    </div>
  );
}
