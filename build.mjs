import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, "src");
const output = join(root, "dist");
const webDir = process.env.OPENCODE_WEB_DIR || "/home/runner/work/_temp/omgithub-web";

if (!existsSync(join(source, "index.html"))) {
  throw new Error("Source index.html is missing.");
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const started = Date.now();
cpSync(source, output, { recursive: true });
const files = ["index.html", "styles.css", "game.js", "levels.js"];
for (const file of files) {
  if (!existsSync(join(output, file))) throw new Error(`Built output is missing ${file}.`);
}

mkdirSync(webDir, { recursive: true });
const deployment = { project: resolve(root), directory: resolve(output) };
writeFileSync(join(webDir, "deployment-output.json"), `${JSON.stringify(deployment)}\n`);
writeFileSync(
  join(webDir, "deployment-output.pretty.json"),
  `${JSON.stringify(deployment, null, 2)}\n`,
);

console.log(`Built ${files.length} static files into ${deployment.directory} in ${Date.now() - started}ms.`);
console.log(`Deployment metadata: ${join(webDir, "deployment-output.json")}`);
