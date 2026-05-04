import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const linkPath = path.join(root, ".vercel", "project.json");
if (!fs.existsSync(linkPath)) {
  console.error(
    "No Vercel project link (.vercel/project.json). From the repo root run:\n" +
      "  npx vercel link\n" +
      "Then pick team + existing project “abscissalive” (or the project that owns abscissa.live).",
  );
  process.exit(1);
}

let orgId;
try {
  const raw = fs.readFileSync(linkPath, "utf8");
  const data = JSON.parse(raw);
  orgId = data.orgId;
} catch {
  console.error("Could not read or parse .vercel/project.json.");
  process.exit(1);
}

if (typeof orgId !== "string" || !orgId.startsWith("team_")) {
  console.error(
    ".vercel/project.json must contain a valid orgId (team_*). Re-run: npx vercel link",
  );
  process.exit(1);
}

const args = ["vercel", "deploy", "--prod", "--yes", "--scope", orgId];
const result = spawnSync("npx", args, {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
