import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function manifest({ version, signature, notes, pubDate }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`"${version}" isn't a version like 0.2.0.`);
  if (!signature.trim()) throw new Error("The update signature is empty.");
  return {
    version,
    notes: notes.trim(),
    pub_date: pubDate,
    platforms: {
      "darwin-aarch64": {
        signature: signature.trim(),
        url: `https://dl.kelp.ozanai.dev/releases/${version}/Kelp.app.tar.gz`,
      },
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, signatureFile, notesFile] = process.argv.slice(2);
  try {
    const result = manifest({
      version: version ?? "",
      signature: readFileSync(signatureFile, "utf8"),
      notes: readFileSync(notesFile, "utf8"),
      pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
