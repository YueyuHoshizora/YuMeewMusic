import assert from "node:assert/strict";
import test from "node:test";
import { parseStoryboardPrompt, referencedResourceNames } from "../js/video-prompt-mode.js";

test("structured preview prompts convert back into ordered storyboard scenes", () => {
  const prompt = `全片風格：\n主要風格：電影感\n\n影片細節：\n雨夜中的城市\n\n分鏡內容：\nScene 1\n時間：0-2.5s\n場景：街角的霓虹燈\n鏡頭：緩慢向前推進\n\nScene 2\n時間：2.5-5s\n場景：角色抬頭看向天空\n人物與對話：星語：「雨停了」\n\n引用資源：\n@Image1：圖片`;
  const parsed = parseStoryboardPrompt(prompt);
  assert.equal(parsed.scenes.length, 2);
  assert.deepEqual([parsed.scenes[0].start, parsed.scenes[0].end], [0, 2.5]);
  assert.equal(parsed.scenes[1].fields["人物與對話"], "星語：「雨停了」");
  assert.equal(parsed.videoDetails, "雨夜中的城市");
  assert.equal(parsed.filmStyle, "主要風格：電影感");
});

test("unstructured or invalid scene prompts cannot overwrite storyboard data", () => {
  assert.equal(parseStoryboardPrompt("一段自由格式的影片題詞"), null);
  assert.equal(parseStoryboardPrompt("Scene 1\n時間：2-2s\n場景：無效時間"), null);
  assert.equal(parseStoryboardPrompt("Scene 2\n時間：0-2s\n場景：編號不連續"), null);
});

test("plain prompt mode detects exact resource mentions without prefix collisions", () => {
  assert.deepEqual(referencedResourceNames("使用 @Image10，忽略 Image1", ["Image1", "Image10", "Audio1"]), ["Image10"]);
});
