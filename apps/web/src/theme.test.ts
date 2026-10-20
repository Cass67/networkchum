import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression guard for the neon icon theme: glyph bodies must stay unfilled.
// A dark body fill (rgba(13, 5, 36, 0.92)) once painted a box behind every
// neon icon on the canvas; keep the neon set outline-only.
const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "theme.css"),
  "utf8",
);

function neonRule(selectorStart: string): string {
  const pattern = new RegExp(
    `${selectorStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^{]*\\{[^}]*\\}`,
  );
  const match = css.match(pattern);
  if (!match) {
    throw new Error(`missing neon rule for ${selectorStart}`);
  }
  return match[0];
}

it("neon theme leaves glyph bodies unfilled so no dark box renders", () => {
  const rule = neonRule(
    ":root[data-icon-theme='neon'] .device-role-glyph .glyph-body",
  );
  expect(rule).toMatch(/fill:\s*none/);
  expect(rule).not.toMatch(/fill:\s*rgba?\(/);
});

it("neon glyph svg must not clip its glow (square artifact)", () => {
  // The drop-shadow glow gets clipped at the glyph's square viewport edge and
  // renders as a box behind the icon; overflow: visible lets it fade out.
  expect(css).toMatch(
    /:root\[data-icon-theme='neon'\] \.device-role-glyph \{[^}]*overflow:\s*visible/,
  );
});

it("neon theme keeps the colored stroke and glow on glyph outlines", () => {
  const rule = neonRule(
    ":root[data-icon-theme='neon'] .device-role-glyph[data-icon-kind='router'] :is(.glyph-body, .glyph-detail)",
  );
  expect(rule).toMatch(/stroke:\s*var\(--glyph-neon-router\)/);
  expect(rule).toMatch(/drop-shadow/);
});
