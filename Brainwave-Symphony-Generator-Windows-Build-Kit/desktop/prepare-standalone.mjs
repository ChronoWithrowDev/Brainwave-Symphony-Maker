import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const server = path.join(standalone, "server.js");

try {
  await access(server);
} catch {
  console.error("Next.js standalone server.js was not generated. Check next.config.ts output: standalone.");
  process.exit(1);
}

const staticSource = path.join(root, ".next", "static");
const staticTarget = path.join(standalone, ".next", "static");
await mkdir(path.dirname(staticTarget), { recursive: true });
await cp(staticSource, staticTarget, { recursive: true, force: true });

const publicSource = path.join(root, "public");
try {
  await access(publicSource);
  await cp(publicSource, path.join(standalone, "public"), { recursive: true, force: true });
} catch {
  // The project can run without a public directory.
}

console.log("Prepared standalone Next.js files for Electron packaging.");
