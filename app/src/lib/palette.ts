export type Command = {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  group: "places" | "actions";
  run: () => void;
};

function score(label: string, query: string): number {
  const name = label.toLowerCase();
  if (name.startsWith(query)) return 0;
  return name.includes(query) ? 1 : -1;
}

export function rank(commands: Command[], query: string): Command[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") {
    return [...commands.filter((c) => c.group === "actions"), ...commands.filter((c) => c.group === "places")];
  }
  return commands
    .map((command, index) => ({ command, index, score: score(command.label, wanted) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.command);
}
