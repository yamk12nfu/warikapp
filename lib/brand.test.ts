import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { brand } from "./brand";

const globalsCss = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);

function tokenValue(block: string, token: string) {
  return block.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1].trim();
}

test("ブランド値は globals.css の対応するトークンと一致する", () => {
  const [light, dark] = [...globalsCss.matchAll(/:root\s*\{([\s\S]*?)\n\s*\}/g)].map(
    (m) => m[1],
  );
  expect(dark).toBeDefined();
  expect(tokenValue(light, "--background")).toBe("#fbf8f4");
  expect(tokenValue(dark, "--background")).toBe("#1c1a17");
  expect(tokenValue(light, "--me")).toBe("#0b7568");
  expect(tokenValue(light, "--partner")).toBe("#7a52d9");
  expect(brand).toEqual({
    background: { light: "#fbf8f4", dark: "#1c1a17" },
    me: "#0b7568",
    partner: "#7a52d9",
  });
});
