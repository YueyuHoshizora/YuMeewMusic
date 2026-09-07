import { mkdir, cp, rm } from "node:fs/promises";
// Only public files are copied: never source metadata, credentials or user media.
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const path of ["index.html", "favicon.svg", "css", "js", "vendor"])
  await cp(path, `dist/${path}`, { recursive: true });
console.log("Static website built in dist/");
