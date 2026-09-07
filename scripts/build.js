import { createHash } from "node:crypto";
import { mkdir, cp, rm, readFile, writeFile, readdir } from "node:fs/promises";
// Only public files are copied: never source metadata, credentials or user media.
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const path of ["index.html", "favicon.svg", "css", "js", "vendor"])
  await cp(path, `dist/${path}`, { recursive: true });
// A single content-derived version keeps entry points and app modules in sync after deploys.
const files = ["index.html", "css/style.css", ...(await readdir("js")).filter(name => name.endsWith(".js")).sort().map(name => `js/${name}`)];
const hash = createHash("sha256");
for (const file of files) hash.update(await readFile(file));
const version = hash.digest("hex").slice(0, 12);
for (const file of files) {
  let source = await readFile(file, "utf8");
  if (file.endsWith(".js")) source = source.replace(/(["'])(\.\/[^"']+\.js)\1/g, (_, quote, path) => `${quote}${path}?v=${version}${quote}`);
  if (file === "index.html") source = source.replace(/(\.\/(?:js|css)\/[^"']+\.(?:js|css))/g, `$1?v=${version}`);
  await writeFile(`dist/${file}`, source);
}
console.log("Static website built in dist/");
