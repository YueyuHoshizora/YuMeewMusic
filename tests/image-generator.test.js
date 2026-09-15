import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { calculateImageSize, imageResolutionsForRatio } from "../js/image-generation-settings.js";
import { extractImageGenerationIdentifiers, generationIdentifierHeaders, responseGenerationIdentifiers } from "../js/image-generation-identifiers.js";

test("image generation identifiers preserve task, generation and request IDs", () => {
  const identifiers = extractImageGenerationIdentifiers(
    { task_id: "task_123", id: "generation_456" },
    new Headers({ "x-request-id": "req_789" }),
  );
  assert.deepEqual(identifiers, { taskId: "task_123", generationId: "generation_456", requestId: "req_789" });
  const internalHeaders = new Headers(generationIdentifierHeaders(identifiers));
  assert.deepEqual(responseGenerationIdentifiers(internalHeaders), identifiers);
});

test("image generation identifiers fall back to request ID when no task ID exists", () => {
  assert.deepEqual(
    extractImageGenerationIdentifiers({}, new Headers({ "x-request-id": "req_only" })),
    { taskId: "", generationId: "", requestId: "req_only" },
  );
});

test("image generation settings calculate height from horizontal pixels", () => {
  assert.deepEqual(calculateImageSize("16:9", 1280), { ratio: "16:9", width: 1280, height: 720 });
  assert.deepEqual(calculateImageSize("1:1", 512), { ratio: "1:1", width: 512, height: 512 });
  assert.deepEqual(calculateImageSize("4:3", 640), { ratio: "4:3", width: 640, height: 480 });
  assert.deepEqual(calculateImageSize("3:4", 720), { ratio: "3:4", width: 720, height: 960 });
  assert.deepEqual(calculateImageSize("9:16", 1080), { ratio: "9:16", width: 1080, height: 1920 });
});

test("image resolution options stay under 2000px on both sides and scale with the ratio", () => {
  for (const ratio of ["1:1", "4:3", "3:4", "16:9", "9:16"]) {
    const resolutions = imageResolutionsForRatio(ratio);
    assert.ok(resolutions.length > 0, ratio);
    for (const { width, height } of resolutions) {
      assert.ok(width < 2000, `${ratio} width ${width}`);
      assert.ok(height < 2000, `${ratio} height ${height}`);
    }
    for (let i = 1; i < resolutions.length; i++) assert.ok(resolutions[i].width > resolutions[i - 1].width, ratio);
  }
  assert.deepEqual(
    imageResolutionsForRatio("16:9").map(({ width }) => width),
    [480, 512, 640, 720, 768, 1024, 1080, 1280, 1920],
  );
  assert.deepEqual(
    imageResolutionsForRatio("9:16").map(({ width }) => width),
    [480, 512, 640, 720, 768, 1024, 1080],
  );
});

test("image-generator page exposes generation, download and background actions", () => {
  const html = readFileSync("image-generator.html", "utf8");
  const script = readFileSync("js/image-generator.js", "utf8");
  const css = readFileSync("css/image-generator.css", "utf8");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /<title>圖片生成器 · YuMeew<\/title>/);
  assert.match(html, />圖片生成器<span class="brand-sub">TEXT TO IMAGE<\/span>/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/);
  for (const [, id] of script.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#?]+)(?:\?[^"#]*)?"/g)) assert.ok(existsSync(path), path);
  assert.match(html, /id="image-prompt"[^>]*maxlength="2048"/);
  assert.doesNotMatch(html, /id="prompt-count"|0 \/ 2048/);
  assert.doesNotMatch(script, /prompt-count/);
  assert.match(html, /id="image-model"[^>]*class="setting-select"/);
  assert.match(html, /id="generation-settings-title">生成設定/);
  assert.match(html, /id="image-aspect-ratio"[\s\S]*value="1:1"[\s\S]*value="4:3"[\s\S]*value="3:4"[\s\S]*value="16:9" selected[\s\S]*value="9:16"/);
  assert.match(html, /id="image-width"[\s\S]*value="1280" selected>1280 × 720/);
  assert.doesNotMatch(html, /id="image-height"|計算高度/);
  assert.match(html, /id="result-resolution">1280 × 720/);
  assert.match(html, /id="result-format">16:9 · JPEG/);
  assert.match(html, /value="flux-2-klein-4b"[^>]*selected[^>]*>Flux\.2 Klein 4B<\/option>/);
  assert.match(html, /value="flux-2-klein-4b"[\s\S]*value="gpt-image-2\.5-flare">GPT-Image-2\.5 Flare<\/option>[\s\S]*value="gpt-image-2\.5-sunburst"/);
  assert.match(html, /value="gpt-image-2\.5-sunburst">GPT-Image-2\.5 Sunburst<\/option>/);
  assert.doesNotMatch(html, /提示詞會傳送至|model-provider-note|class="cloud-note"/);
  assert.match(html, /<span>API KEY<\/span>\s*<button id="model-api-key"[^>]*disabled>Free<\/button>/);
  assert.match(html, /class="prompt-actions">[\s\S]*class="generation-options"[\s\S]*id="image-model"[\s\S]*id="model-api-key"[\s\S]*id="generate-image"/);
  assert.match(html, /id="prompt-keywords"[^>]*type="text"/);
  assert.match(html, /id="compose-prompt"[^>]*class="export-button"[^>]*>組成題詞<\/button>/);
  assert.match(html, /id="generated-image-frame"/);
  assert.match(html, /id="generated-image-frame"[^>]*role="button"[^>]*tabindex="0"/);
  assert.match(html, /id="result-fullscreen-hint"[^>]*>⛶ 點擊全螢幕<\/span>/);
  assert.match(html, /1280 × 720/);
  assert.doesNotMatch(html, /每日早上 8 點（台灣時間）重置額度/);
  assert.match(html, /id="download-image"[^>]*disabled/);
  assert.match(html, /id="apply-background"[^>]*disabled/);
  assert.match(html, /id="open-image-history"[^>]*disabled>生成歷史<\/button>/);
  assert.match(html, /id="image-history-dialog"[\s\S]*最多保留最近 10 張圖片/);
  assert.match(html, /只有按下「套用主畫面背景」才會取代主畫面的背景素材/);
  assert.match(html, /id="generation-lock"[^>]*hidden/);
  assert.match(html, /id="image-generation-lock-title"[^>]*>圖片生成中<\/strong>/);
  assert.match(html, /id="image-generation-lock-detail"[^>]*>正在建立圖片生成任務…<\/p>/);
  assert.match(html, /id="confirm-image-generation-dialog"[^>]*aria-labelledby="confirm-image-generation-title"[\s\S]*id="image-generation-summary"[^>]*aria-label="生成摘要"[\s\S]*id="cancel-image-generation"[^>]*>取消<\/button>[\s\S]*class="dialog-confirm"[^>]*type="submit"[^>]*>確認生成<\/button>/);
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css, /\.generated-image-frame:fullscreen/);
  assert.match(css, /\.generated-image-frame\.fullscreen-fallback/);
  assert.match(css, /body\.image-generator-body\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /@media \(max-width:\s*800px\)/);
  assert.match(css, /\.prompt-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 210px/);
  assert.match(css, /\.generation-options\s*\{[^}]*grid-template-columns:\s*minmax\(190px, 300px\) 200px/);
  assert.match(css, /\.model-api-key\s*\{[^}]*width:\s*200px/);
  assert.match(css, /\.model-api-key\s*\{[^}]*flex-direction:\s*row/);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.prompt-actions\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width:\s*560px\)/);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*?\.generation-options\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*?\.model-api-key\s*\{[^}]*width:\s*100%/);
  assert.match(css, /width:\s*100dvh;\s*height:\s*100vw/);
  assert.match(css, /rotate\(90deg\)/);
  assert.match(css, /@keyframes mobile-result-fullscreen-in/);
  assert.match(css, /\.autocomplete-row\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /\.result-actions\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(script, /https:\/\/flux-klein-worker\.yustellar\.idv\.tw\/generate/);
  assert.match(script, /https:\/\/flux-klein-worker\.yustellar\.idv\.tw\/autocomplete/);
  assert.match(script, /https:\/\/api\.openai\.com\/v1\/images\/generations/);
  assert.match(script, /method:\s*"POST"/);
  assert.match(script, /"Content-Type":\s*"application\/json"/);
  assert.match(script, /import \{ clientIdentityHeaders \} from "\.\/client-identity\.js"/);
  assert.equal((script.match(/\.\.\.clientIdentityHeaders\(\)/g) || []).length, 2);
  assert.match(html, /id="enhance-prompt"[^>]*type="checkbox"[^>]*checked/);
  assert.match(html, /文字轉譯成Prompt/);
  assert.match(script, /const enhance = Boolean\(\$\("enhance-prompt"\)\.checked\)/);
  assert.match(script, /async function callFlux2Klein4B\(\{ prompt, enhance, width, height \}\)/);
  assert.match(script, /"flux-2-klein-4b": Object\.freeze\(\{[\s\S]*?label: "Flux\.2 Klein 4B"[\s\S]*?apiKey: "Free"[\s\S]*?publicResource: true[\s\S]*?call: callFlux2Klein4B/);
  assert.match(script, /"gpt-image-2\.5-sunburst": Object\.freeze\(\{[\s\S]*?label: "GPT-Image-2\.5 Sunburst"[\s\S]*?apiKey: "OpenAI"[\s\S]*?call: callGptImage25Sunburst/);
  assert.match(script, /"gpt-image-2\.5-flare": Object\.freeze\(\{[\s\S]*?label: "GPT-Image-2\.5 Flare"[\s\S]*?apiKey: "OpenAI"[\s\S]*?call: callGptImage25Flare/);
  assert.doesNotMatch(script, /model-provider-note|provider: "OpenAI Image API"/);
  assert.match(script, /async function callOpenAiImage\(\{ model, prompt, apiKey, width, height \}\)/);
  assert.match(script, /model: "gpt-image-2\.5-flare"/);
  assert.match(script, /Authorization: `Bearer \$\{apiKey\}`/);
  assert.match(script, /model: "gpt-image-2\.5-sunburst"/);
  assert.match(script, /size: `\$\{width\}x\$\{height\}`/);
  assert.match(script, /output_format: "jpeg"/);
  assert.match(script, /image\?\.b64_json/);
  assert.match(script, /const modelId = \$\("image-model"\)\.value;\s*const model = IMAGE_MODELS\[modelId\]/);
  assert.match(script, /storedKey \? "已設定" : "未設定"/);
  assert.doesNotMatch(script, /maskApiKey/);
  assert.match(script, /\$\("image-model"\)\.addEventListener\("change", syncModelDetails\)/);
  assert.match(script, /\$\("model-api-key"\)\.addEventListener\("click", openApiKeyDialog\)/);
  assert.match(script, /saveApiKey\(model\.provider, model\.apiKey, value\)/);
  assert.match(script, /const storedKey = getApiKey\(model\.provider\)[\s\S]*api-key-input"\)\.value = storedKey\?\.value \|\| ""/);
  assert.match(script, /const response = await model\.call\(\{ prompt, enhance, apiKey, width, height \}\)/);
  assert.match(script, /function requestImageGeneration\(\)[\s\S]*model\.publicResource \? "Free"[\s\S]*image-generation-summary"\)\.replaceChildren[\s\S]*confirm-image-generation-dialog"\)\.showModal\(\)/);
  assert.match(script, /function confirmImageGeneration\(event\)[\s\S]*confirm-image-generation-dialog"\)\.close\(\)[\s\S]*generateImage\(\)/);
  assert.match(script, /generate-image"\)\.addEventListener\("click", requestImageGeneration\)[\s\S]*confirm-image-generation-form"\)\.addEventListener\("submit", confirmImageGeneration\)/);
  assert.match(script, /\["生成比例", size\.ratio\][\s\S]*\["輸出尺寸", `\$\{size\.width\} × \$\{size\.height\}`\][\s\S]*\["預估費用", estimatedFee\]/);
  assert.match(css, /\.image-generation-summary\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
  assert.match(css, /\.image-generation-estimated-fee strong\s*\{[^}]*font-weight:\s*900/);
  assert.match(html, /id="api-key-input"[^>]*type="password"/);
  assert.match(html, /id="api-key-account-credits"[^>]*type="checkbox"[^>]*\/> 使用帳戶扣點/);
  assert.match(script, /usesAccountCredits\(modelId\) \? \(memberSignedIn \? "帳戶扣點" : "需登入"\)/);
  assert.match(script, /function canUseSelectedImageModel\(\)[\s\S]*usesAccountCredits\(modelId\)[\s\S]*return memberSignedIn/);
  assert.match(script, /function syncApiKeyCreditControls\(\)[\s\S]*accountOption\.disabled = !memberSignedIn[\s\S]*api-key-input"\)\.disabled = accountOption\.checked/);
  assert.match(script, /onAuthStateChange\(session =>[\s\S]*memberSignedIn = Boolean\(session\?\.user\)[\s\S]*syncModelDetails\(\)/);
  assert.doesNotMatch(html, /api-key-source|從其他模型複製/);
  assert.doesNotMatch(script, /copyApiKeyFromSource|syncApiKeySources|listApiKeys/);
  assert.match(script, /getApiKey\(model\.provider\)/);
  assert.match(script, /accountCredits && !memberSignedIn[\s\S]*請先登入會員帳號，再使用帳戶扣點/);
  assert.match(script, /\$\("image-model"\)\.disabled = value/);
  assert.match(script, /\$\("enhance-prompt"\)\.disabled = value/);
  assert.match(script, /body:\s*JSON\.stringify\(\{ prompt, enhance, width, height \}\)/);
  assert.match(script, /async function composePrompt\(\)/);
  assert.match(script, /async function toggleResultFullscreen\(\)/);
  assert.match(script, /resultFrame\.requestFullscreen\(\)/);
  assert.match(script, /resultFrame\.classList\.contains\("fullscreen-fallback"\)/);
  assert.match(script, /body:\s*JSON\.stringify\(\{ prompt \}\)/);
  assert.match(script, /\["completed", "prompt", "result", "text", "completion"\]/);
  assert.match(script, /body\?\.message \|\| body\?\.error/);
  assert.match(script, /\$\("image-prompt"\)\.value = result\.slice\(0, 2048\)/);
  assert.doesNotMatch(script, /\$\("image-prompt"\)\.addEventListener\("keydown"/);
  assert.doesNotMatch(script, /\$\("prompt-keywords"\)\.addEventListener\("keydown"/);
  assert.doesNotMatch(script, /searchParams\.set\("p"/);
  assert.match(script, /statusCode === 429/);
  assert.match(script, /body\.code !== "rate_limit_exceeded"/);
  assert.match(script, /操作過於頻繁，請在 \$\{retryAfter\} 秒後再試/);
  assert.match(script, /const limitedMessage = rateLimitMessage\(body\);[\s\S]*if \(limitedMessage\) throw Error\(limitedMessage\);/);
  assert.match(script, /const limitedMessage = rateLimitMessage\(errorBody\);[\s\S]*if \(model\.publicResource && isQuotaError/);
  assert.match(script, /今日圖片生成額度已用完，請於早上 8 點（台灣時間）額度重置後再試/);
  assert.match(script, /saveStoredMedia\("image", file\)/);
  assert.match(script, /saveStoredMedia\("generated-image", cachedFile\)/);
  assert.match(script, /loadStoredMedia\("generated-image"\)/);
  assert.match(script, /const IMAGE_HISTORY_LIMIT = 10/);
  assert.match(script, /saveStoredValue\("image-generation-history"/);
  assert.match(script, /loadStoredValue\("image-generation-history"\)/);
  assert.match(script, /async function saveGenerationHistory\(blob, prompt, modelId, identifiers = \{\}\)[\s\S]*taskId: identifiers\.taskId[\s\S]*requestId: identifiers\.requestId[\s\S]*localTaskId: identifiers\.localTaskId[\s\S]*slice\(0, IMAGE_HISTORY_LIMIT\)/);
  assert.match(script, /任務 ID：\$\{record\.taskId\}[\s\S]*生成 ID：\$\{record\.generationId\}[\s\S]*請求 ID：\$\{record\.requestId\}/);
  assert.match(script, /function startGenerationProgress\(\)[\s\S]*window\.setInterval\(renderGenerationProgress, 1000\)/);
  assert.match(script, /已執行 \$\{elapsed\} 秒/);
  assert.match(script, /const progress = startGenerationProgress\(\)[\s\S]*identifiers\.localTaskId = progress\.localTaskId[\s\S]*updateGenerationProgress\(identifiers\)[\s\S]*stopGenerationProgress\(\)/);
  assert.match(script, /open-image-history"\)\.addEventListener/);
  assert.match(script, /void restoreLastGeneratedImage\(\)/);
  assert.match(script, /deleteStoredValue\("image-video-project"\)/);
  const mainHtml = readFileSync("index.html", "utf8");
  assert.match(mainHtml, /href="\.\/image-generator\.html"[^>]*>圖片生成器<\/a>/);
  assert.match(readFileSync("scripts/serve.js", "utf8"), /"image-generator\.html"/);
  assert.match(readFileSync("scripts/build.js", "utf8"), /"image-generator\.html"/);
});

test("GitHub Pages build preserves the official custom domain", () => {
  assert.equal(readFileSync("CNAME", "utf8").trim(), "ezmusic.yustellar.idv.tw");
  assert.match(readFileSync("scripts/build.js", "utf8"), /"CNAME"/);
  assert.match(readFileSync("README.md", "utf8"), /https:\/\/ezmusic\.yustellar\.idv\.tw\//);
});
