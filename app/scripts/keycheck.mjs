import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHAPE_ERROR = "That isn't a minisign key or signature. Expected base64 text with a comment line and a key line.";

export function keyId(minisignBase64) {
  const lines = Buffer.from(minisignBase64.trim(), "base64").toString("utf8").split("\n");
  const bytes = Buffer.from(lines[1]?.trim() ?? "", "base64");
  if (bytes.length < 10) throw new Error(SHAPE_ERROR);
  return Buffer.from(bytes.subarray(2, 10)).reverse().toString("hex").toUpperCase();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
    const trusted = keyId(JSON.parse(read("../src-tauri/tauri.conf.json")).plugins.updater.pubkey);
    const signed = keyId(readFileSync(process.argv[2], "utf8"));
    if (signed !== trusted) {
      console.error(`The update was signed with key ${signed} but the app trusts key ${trusted}. Set TAURI_SIGNING_PRIVATE_KEY to the key matching tauri.conf.json.`);
      process.exit(1);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
