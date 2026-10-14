import { useEffect, useRef, type CSSProperties } from "react";

type Bubble = { x: number; size: number; d: number; delay: number; depth: "far" | "mid" | "near" };

// Hand-placed, not random: prerendered HTML and the browser's first render must match exactly.
// Far bubbles are small, slow and faint; near ones are bigger, faster and brighter.
const BUBBLES: Bubble[] = [
  { x: 4, size: 3, d: 16, delay: -2, depth: "far" },
  { x: 11, size: 7, d: 10, delay: -7, depth: "mid" },
  { x: 17, size: 4, d: 14, delay: -11, depth: "far" },
  { x: 23, size: 12, d: 9, delay: -3, depth: "near" },
  { x: 29, size: 3, d: 18, delay: -14, depth: "far" },
  { x: 36, size: 6, d: 12, delay: -5, depth: "mid" },
  { x: 44, size: 4, d: 15, delay: -9, depth: "far" },
  { x: 52, size: 9, d: 11, delay: -1, depth: "mid" },
  { x: 58, size: 3, d: 17, delay: -6, depth: "far" },
  { x: 64, size: 14, d: 8, delay: -6.5, depth: "near" },
  { x: 70, size: 5, d: 13, delay: -12, depth: "mid" },
  { x: 76, size: 3, d: 16, delay: -4, depth: "far" },
  { x: 82, size: 8, d: 10, delay: -8, depth: "mid" },
  { x: 88, size: 4, d: 14, delay: -13, depth: "far" },
  { x: 93, size: 10, d: 9.5, delay: -2.5, depth: "near" },
  { x: 97, size: 3, d: 18, delay: -10, depth: "far" },
];

const PEAK = { far: 0.45, mid: 0.75, near: 1 };
const SWAY = { far: 4, mid: 8, near: 14 };

/**
 * Ocean background for navy bands: a moving gradient and rising bubbles.
 * With `followCursor`, a soft glow also follows the mouse (only for a fine pointer and normal motion).
 */
export function Bubbles({ followCursor = false }: { followCursor?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    const band = layer?.parentElement;
    if (!followCursor || !layer || !band) return;
    if (!matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;

    let frame = 0;
    const move = (e: PointerEvent) => {
      // One style write per animation frame, however fast the mouse moves.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = band.getBoundingClientRect();
        layer.style.setProperty("--mx", `${e.clientX - box.left}px`);
        layer.style.setProperty("--my", `${e.clientY - box.top}px`);
        layer.classList.add("tracking");
      });
    };
    const leave = () => layer.classList.remove("tracking");

    band.addEventListener("pointermove", move);
    band.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      band.removeEventListener("pointermove", move);
      band.removeEventListener("pointerleave", leave);
    };
  }, [followCursor]);

  return (
    <div className="bubbles" aria-hidden="true" ref={ref}>
      <div className="glow glow-a" />
      <div className="glow glow-b" />
      <div className="glow glow-c" />
      <div className="glow glow-d" />
      {followCursor && <div className="glow glow-cursor" />}
      {BUBBLES.map((b) => (
        <span
          key={b.x}
          className={b.depth === "far" ? "bubble far" : "bubble"}
          style={
            {
              "--x": `${b.x}%`,
              "--size": `${b.size}px`,
              "--d": `${b.d}s`,
              "--delay": `${b.delay}s`,
              "--peak": PEAK[b.depth],
              "--sway": `${SWAY[b.depth]}px`,
            } as CSSProperties
          }
        >
          <i />
        </span>
      ))}
    </div>
  );
}
