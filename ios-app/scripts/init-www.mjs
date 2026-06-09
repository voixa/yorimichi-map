#!/usr/bin/env node
/**
 * init-www.mjs
 *
 * Web版 (リポルート) から ios-app/www/ への 1回限りの初回コピー。
 *
 * このスクリプトは初期セットアップ専用。実行後は ios-app/www/ を独立に編集していくため、
 * Web版とコードは同期されない。Web版で重要な変更があったときに参考にする程度。
 *
 * 使い方:
 *   cd ios-app && node scripts/init-www.mjs [--force]
 *
 * --force 付きでないと既存 www/ がある場合エラー終了する (上書き事故防止)。
 */
import { mkdir, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IOS_APP_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(IOS_APP_ROOT, "..");
const WWW = join(IOS_APP_ROOT, "www");

// Web版からコピーするファイル (iOS版で必要なもののみ)
// - sw.js は iOS版で不要 (アセットはバンドル内)
// - lp.html は Web専用 LP なので不要
// - manifest.json は PWA 用 (iOS版では不要だが念のためコピー)
const FILES = [
  "index.html",
  "app.js",
  "courses.js",
  "photos.js",
  "style.css",
  "about.html",
  "profile.html",
  "offline.html",
  "manifest.json",
  "og.png",
  "og.svg",
];

const force = process.argv.includes("--force");

async function main() {
  if (existsSync(WWW) && !force) {
    console.error(`[init-www] ERROR: ${WWW} already exists.`);
    console.error(`           Re-run with --force to overwrite.`);
    process.exit(1);
  }

  if (existsSync(WWW)) {
    await rm(WWW, { recursive: true, force: true });
  }
  await mkdir(WWW, { recursive: true });

  let copied = 0;
  let skipped = 0;
  for (const f of FILES) {
    const src = join(REPO_ROOT, f);
    const dst = join(WWW, f);
    if (!existsSync(src)) {
      console.warn(`[init-www] SKIP (not found): ${f}`);
      skipped++;
      continue;
    }
    await copyFile(src, dst);
    copied++;
  }

  console.log(`[init-www] copied=${copied} skipped=${skipped} -> ${WWW}`);
  console.log(`[init-www] NEXT: ios-app/www/ を iOS版独自に編集する (SW削除・Stripe削除等)`);
}

main().catch((err) => {
  console.error("[init-www] FAILED:", err);
  process.exit(1);
});
