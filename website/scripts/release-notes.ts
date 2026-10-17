import { mkdirSync, writeFileSync } from "node:fs";
import { noteFor, releaseMarkdown } from "../src/notes.ts";

const [version, outDir] = process.argv.slice(2);
const note = version ? noteFor(version) : null;

if (!note || !outDir) {
  console.log(
    `No release notes for ${version}. Add an entry to website/src/notes.ts before tagging.`,
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/summary.txt`, note.summary);
writeFileSync(`${outDir}/body.md`, releaseMarkdown(note));
