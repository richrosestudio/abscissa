import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const link = path.join(root, ".vercel", "project.json");
if (!fs.existsSync(link)) {
  console.error(
    "No Vercel project link (.vercel/project.json). From the repo root run:\n" +
      "  npx vercel link\n" +
      "Then pick team + existing project “abscissalive” (or the project that owns abscissa.live).",
  );
  process.exit(1);
}
