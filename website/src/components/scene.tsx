import { useEffect, useRef, useState, type RefObject } from "react";

export function FolderIcon() {
  return (
    <svg className="row-icon folder" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2 5.5A1.5 1.5 0 0 1 3.5 4h3.6c.4 0 .8.2 1.1.5L9.3 6h7.2A1.5 1.5 0 0 1 18 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z"
        fill="currentColor"
      />
    </svg>
  );
}

export function FileIcon() {
  return (
    <svg className="row-icon file" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M5 2.5h6.2L15 6.3V16.5A1 1 0 0 1 14 17.5H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z"
        fill="currentColor"
      />
    </svg>
  );
}

export function useScenePhase(stepMs: readonly number[], stillPhase: number): [number, RefObject<HTMLDivElement>] {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(stillPhase);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timers: number[] = [];
    let visible = false;
    const play = () => {
      stepMs.forEach((ms, i) => {
        timers.push(
          window.setTimeout(() => {
            if (i === stepMs.length - 1) {
              play();
            } else {
              setPhase(i);
            }
          }, ms),
        );
      });
    };
    const stop = () => {
      timers.forEach(window.clearTimeout);
      timers.length = 0;
    };
    const sync = () => {
      stop();
      if (reduce.matches) {
        setPhase(stillPhase);
      } else if (visible) {
        play();
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(node);
    reduce.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      reduce.removeEventListener("change", sync);
      stop();
    };
  }, [stepMs, stillPhase]);

  return [phase, ref];
}
