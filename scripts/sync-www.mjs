#!/usr/bin/env node
/**
 * sync-www.mjs
 *
 * iOS Capacitor 用に www/ ディレクトリへ Web アセットをコピーする。
 * Web 配信構成 (ルートから直接 index.html を返す) は変更せず、
 * iOS バンドルだけが www/ をソースに使う。
 *
 * 含めるもの:
 *   index.html / app.js / courses.js / photos.js / style.css
 *   manifest.json / sw.js / offline.html / about.html / profile.html
 *   og.png / og.svg
 *
 * 除外するもの:
 *   api/ (Flask バックエンド) / docs/ / tests/ / scripts/
 *   Dockerfile / nginx.conf / package.json / lp.html / robots.txt / sitemap.xml
 *
 * 使い方: npm run build:ios
 */
import { readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const WWW = join(ROOT, "www");

const FILES = [
  "index.html",
  "app.js",
  "courses.js",
  "photos.js",
  "style.css",
  "manifest.json",
  "sw.js",
  "offline.html",
  "about.html",
  "profile.html",
  "og.png",
  "og.svg",
];

async function main() {
  // クリーンビルド
  if (existsSync(WWW)) {
    await rm(WWW, { recursive: true, force: true });
  }
  await mkdir(WWW, { recursive: true });

  let copied = 0;
  let skipped = 0;
  for (const f of FILES) {
    const src = join(ROOT, f);
    const dst = join(WWW, f);
    if (!existsSync(src)) {
      console.warn(`[sync-www] SKIP (not found): ${f}`);
      skipped++;
      continue;
    }
    await copyFile(src, dst);
    copied++;
  }

  // iOS では Service Worker を無効化したいので index.html に capacitor:// フラグを差し込む
  // (sw.js 側で navigator.serviceWorker.register をスキップする実装が必要)
  const indexPath = join(WWW, "index.html");
  if (existsSync(indexPath)) {
    let html = await readFile(indexPath, "utf8");
    if (!html.includes("window.__CAPACITOR_PLATFORM__")) {
      html = html.replace(
        "<head>",
        `<head>\n  <script>window.__CAPACITOR_PLATFORM__ = "ios";</script>`
      );
      await writeFile(indexPath, html, "utf8");
      console.log("[sync-www] injected __CAPACITOR_PLATFORM__ flag into index.html");
    }
  }

  console.log(`[sync-www] copied=${copied} skipped=${skipped} -> ${WWW}`);
}

main().catch((err) => {
  console.error("[sync-www] FAILED:", err);
  process.exit(1);
});
