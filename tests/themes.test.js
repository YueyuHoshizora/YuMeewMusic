import test from "node:test";
import assert from "node:assert/strict";
import { THEMES, applyTheme } from "../js/themes.js";
import { validateSettings } from "../js/settings.js";

function luminance(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((value) => parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("all twenty appearances restore safely and maintain readable accent/button text", () => {
  assert.equal(Object.keys(THEMES).length, 10);
  for (const [theme, palette] of Object.entries(THEMES))
    for (const mode of ["dark", "light"]) {
      const properties = {};
      const root = {
        dataset: {},
        style: {
          setProperty(key, value) {
            properties[key] = value;
          },
        },
      };
      const restored = validateSettings({ mode, theme, color: "#123456" });
      applyTheme(restored.mode, restored.theme, root);
      assert.deepEqual(root.dataset, { mode, theme });
      assert.equal(properties["--primary"], palette[mode]);
      assert.equal(restored.color, "#123456");
      assert.ok(
        contrast(palette[mode], mode === "dark" ? "#111820" : "#ffffff") >= 4.5,
        `${mode} ${theme} button`,
      );
      assert.ok(
        contrast(palette[mode], mode === "dark" ? "#1b2024" : "#ffffff") >= 4.5,
        `${mode} ${theme} text`,
      );
    }
});

test("unknown saved appearance values fall back without discarding spectrum preferences", () => {
  const saved = validateSettings({ mode: "invalid", theme: "invalid", color: "#123456" });
  assert.equal(saved.mode, "dark");
  assert.equal(saved.theme, "lime");
  assert.equal(saved.color, "#123456");
});
