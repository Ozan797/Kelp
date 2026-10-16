import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function cargoVersion(text) {
  const packageSection = text.split(/^\[(?!package\])/m)[0];
  return packageSection.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

export function versionMismatches(wanted, found) {
  return Object.entries(found)
    .filter(([, version]) => version !== wanted)
    .map(([file, version]) => `${file} (${version})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wanted = process.argv[2] ?? "";
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const found = {
    "tauri.conf.json": JSON.parse(read("../src-tauri/tauri.conf.json")).version,
    "Cargo.toml": cargoVersion(read("../src-tauri/Cargo.toml")),
    "package.json": JSON.parse(read("../package.json")).version,
  };
  const wrong = versionMismatches(wanted, found);
  if (wrong.length > 0) {
    console.error(`Tag v${wanted} doesn't match the app version in ${wrong.join(", ")}. Bump all three files, then tag again.`);
    process.exit(1);
  }
}
