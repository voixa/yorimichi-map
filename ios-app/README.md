# 街歩きガチャ iOS版 (Capacitor wrap)

Web版 (`../`) とは**完全に別管理**。`ios-app/www/` 配下のコードは Web版と同期されない。

## 必要なもの

- MacBook (Xcode 15+ が動くもの)
- Apple Developer Program 個人会員 (¥12,800/年)
- iPhone 実機 (TestFlight ドッグフード用)
- Node.js 18+

## 初回セットアップ (Mac で実施)

```sh
cd ios-app
npm install
node scripts/init-www.mjs            # Web版から www/ に初回コピー (今回限り・通常は不要)
npx cap sync ios                     # www/ を ios/App/App/public/ に同期
npx cap open ios                     # Xcode を起動
```

Xcode で：
1. `Signing & Capabilities` で個人 Apple ID を選択
2. Bundle ID: `jp.indx.yorimichi` を確認
3. Run (▶) で iPhone シミュレータ or 実機ビルド

## 日常開発フロー

```sh
# www/ の HTML/CSS/JS を編集したあと
npx cap sync ios                     # ios/App/App/public/ に反映
# Xcode で Run
```

## ディレクトリ

```
ios-app/
├ www/                          ← iOS版アプリの実体 (HTML/CSS/JS)
│   ├ index.html
│   ├ app.js                    ← Web版コピー起点・SW登録/Stripe導線削除済み
│   ├ courses.js, photos.js     ← Web版とデータ共有 (将来統合検討)
│   └ ...
├ ios/                          ← Xcode プロジェクト
│   └ App/App/Info.plist        ← 権限宣言・iPhone専用設定
├ scripts/
│   └ init-www.mjs              ← Web版→www/ 初回コピー (1回限り)
├ capacitor.config.json
└ package.json
```

## Web版との違い

| 項目 | Web版 | iOS版 |
|------|-------|-------|
| Service Worker | あり (sw.js v156) | なし |
| 課金 | Stripe LIVE | StoreKit IAP (将来) |
| 配信 | yorimichi.in-dx.jp | App Store |
| GPS | navigator.geolocation | 同左 (Capacitor pluginへ移行予定) |
| LP / about | あり | about のみ (確率開示用) |

## Apple App Store 規約対応

- **4.5.4 (ルートボックス確率開示)**: ガチャ N/R/SR/LR の出現率を `about.html` の「ガチャ確率」セクションに明記
- **3.1.1 (デジタルコンテンツ課金は IAP 必須)**: iOS版から Stripe 決済導線は完全に除去
- **4.2 (Minimum Functionality)**: Webラッパー判定回避のためガチャ・図鑑・GPS・完走証明書のゲーム要素を強調

## 関連ノート

- 戦略判断: `C:/Users/seiji/Obsidian/Decisions/2026-06-07-yorimichi-ios-native.md`
- プロジェクト状態: `C:/Users/seiji/Obsidian/Projects/yorimichi-map.md`
- 技術知見: `C:/Users/seiji/Obsidian/Knowledge/capacitor-ios-no-mac-setup.md`
