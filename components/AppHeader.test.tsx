import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { usePathname } from "next/navigation";
import manifest from "@/app/manifest";
import AppHeader from "./AppHeader";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

test("どの画面のヘッダーからもレシート撮影ページへ直接飛べる", () => {
  vi.mocked(usePathname).mockReturnValue("/months");

  const html = renderToStaticMarkup(<AppHeader />);

  expect(html).toContain('href="/expenses/new/receipt"');
  expect(html).toContain('aria-label="レシートを撮る"');
});

test("PWA のショートカットはヘッダーの撮影リンクと同じページを開く", () => {
  vi.mocked(usePathname).mockReturnValue("/settings");

  const html = renderToStaticMarkup(<AppHeader />);
  const urls = (manifest().shortcuts ?? []).map((shortcut) => shortcut.url);

  expect(urls).toEqual(["/expenses/new/receipt"]);
  expect(html).toContain(`href="${urls[0]}"`);
});

test("セットアップ中はヘッダーを表示しない", () => {
  vi.mocked(usePathname).mockReturnValue("/setup");

  expect(renderToStaticMarkup(<AppHeader />)).toBe("");
});
