import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { rank, type Command } from "../lib/palette";

type CommandPaletteProps = { commands: Command[]; onClose: () => void };

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => rank(commands, query), [commands, query]);

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    field.current?.focus();
    return () => before?.focus();
  }, []);

  const runAt = (index: number) => {
    const command = shown[index];
    if (!command) return;
    onClose();
    command.run();
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, shown.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runAt(active);
    }
  };

  return (
    <div className="sheet-backdrop palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={field}
          className="palette-field"
          role="combobox"
          aria-label="Search commands and places"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[active] ? `palette-${shown[active].id}` : undefined}
          placeholder="Search commands and places"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={keyDown}
        />
        <ul id="palette-list" className="palette-list" role="listbox" aria-label="Results">
          {shown.length === 0 && <li className="palette-empty">No matches</li>}
          {shown.map((command, index) => (
            <li
              key={command.id}
              id={`palette-${command.id}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? "palette-item active" : "palette-item"}
              onMouseEnter={() => setActive(index)}
              onClick={() => runAt(index)}
            >
              <span className="palette-label">{command.label}</span>
              {command.detail && <span className="palette-detail">{command.detail}</span>}
              {command.shortcut && <kbd className="palette-shortcut">{command.shortcut}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
