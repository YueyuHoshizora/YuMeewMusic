import { createHash } from "node:crypto";
import { mkdir, cp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { build as bundleJavaScript, transform as minifyJavaScript } from "esbuild";
import { transform as minifyCss } from "lightningcss";
// Only public files are copied: never source metadata, credentials or user media.
await bundleJavaScript({
  entryPoints: ["scripts/supabase-entry.js"],
  outfile: "vendor/supabase.min.mjs",
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
});
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const path of ["index.html", "account.html", "admin.html", "settings.html", "subtitle-editor.html", "converter.html", "video-editor.html", "image-video.html", "vocal-separator.html", "music-rating.html", "suno-tool.html", "image-generator.html", "video-generator.html", "ai-mastering.html", "video-generator.webmanifest", "favicon.svg", "ads.txt", "service-worker.js", "CNAME", "icons", "css", "js", "vendor"])
  await cp(path, `dist/${path}`, { recursive: true });
// A single content-derived version keeps entry points and app modules in sync after deploys.
const htmlFiles = ["index.html", "account.html", "admin.html", "settings.html", "subtitle-editor.html", "converter.html", "video-editor.html", "image-video.html", "vocal-separator.html", "music-rating.html", "suno-tool.html", "image-generator.html", "video-generator.html", "ai-mastering.html"];
const files = [...htmlFiles, "video-generator.webmanifest", "ads.txt", "service-worker.js", "css/style.css", "css/account.css", "css/admin.css", "css/settings.css", "css/subtitle-editor.css", "css/converter.css", "css/video-editor.css", "css/image-video.css", "css/vocal-separator.css", "css/music-rating.css", "css/suno-tool.css", "css/image-generator.css", "css/video-generator.css", "css/ai-mastering.css", "css/audio-player.css", "vendor/supabase.min.mjs", ...(await readdir("js")).filter(name => name.endsWith(".js")).sort().map(name => `js/${name}`)];
const hash = createHash("sha256");
for (const file of files) hash.update(await readFile(file));
const version = hash.digest("hex").slice(0, 12);
for (const file of files) {
  let source = await readFile(file, "utf8");
  if (file === "service-worker.js") source = source.replace("__BUILD_VERSION__", version);
  if (file.endsWith(".js")) source = source.replace(/(["'])((?:\.\.\/|\.\/)[^"']+\.m?js)\1/g, (_, quote, path) => `${quote}${path}?v=${version}${quote}`);
  if (htmlFiles.includes(file)) source = source.replace(/(\.\/(?:js|css)\/[^"']+\.(?:js|css))/g, `$1?v=${version}`);
  if (file.endsWith(".js")) {
    source = (await minifyJavaScript(source, {
      minify: true,
      format: "esm",
      target: "es2022",
      legalComments: "none",
    })).code;
  } else if (file.endsWith(".css")) {
    source = minifyCss({ filename: file, code: Buffer.from(source), minify: true }).code.toString();
  }
  await writeFile(`dist/${file}`, source);
}
console.log("Static website built in dist/");
