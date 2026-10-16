import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function fillTeamId(template, teamId) {
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? "")) {
    throw new Error("Set KELP_TEAM_ID to your Apple Team ID (developer.apple.com → Membership details).");
  }
  return template.replaceAll("__TEAM_ID__", teamId);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL("../src-tauri/", import.meta.url);
  try {
    const template = readFileSync(new URL("Kelp.entitlements.template", dir), "utf8");
    writeFileSync(new URL("Kelp.entitlements", dir), fillTeamId(template, process.env.KELP_TEAM_ID));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
