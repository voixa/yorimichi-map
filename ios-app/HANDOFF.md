# 街歩きガチャ iOS化 引継ぎ書

> **読み方**: MacBook Air にこのリポを clone した直後にこのファイルを開く。
> Mac側で新しい Claude Code セッションを開く場合は、この HANDOFF.md 全文をコピーして最初に貼り付ければ即座に状況把握できる。

---

## 0. プロジェクト超概要

| 項目 | 内容 |
|------|------|
| アプリ名 | 街歩きガチャ |
| Bundle ID | `jp.indx.yorimichi` |
| ターゲット | iPhone のみ (iPad非対応) |
| 公開目標 | 2026年8月末入稿 → 9月留学開始前リリース |
| 開発者 | 柳下征二郎 (個人名義) |
| GitHubリポ | https://github.com/voixa/yorimichi-map |
| 作業ブランチ | `feat/ios-capacitor` |
| 技術スタック | Capacitor 8 + WKWebView + Swift Package Manager |
| Web版 | https://yorimichi.in-dx.jp (Cloud Run, 別管理・触らない) |
| ベースAPI | https://yorimichi-api-1028920472559.asia-northeast1.run.app (共有可) |

---

## 1. 現状サマリー (2026-06-09 時点)

### ✅ 完了済み

- [x] Capacitor 8 環境構築
- [x] iOS版コードを `ios-app/` に Web版から完全分離 (コード共有なし)
- [x] Service Worker 登録を iOS版から削除
- [x] Stripe Checkout 呼び出しを no-op 化 (規約4.5.4/3.1.1 対応)
- [x] 課金UI を CSS で完全非表示 (`html[data-platform="ios"]` セレクタ)
- [x] ガチャ確率開示 (N:60% / R:30% / SR:9% / LR:1%) を `about.html` に明記
- [x] Info.plist の権限宣言 (NSLocationWhenInUseUsageDescription 等)
- [x] iPhone専用化 (Portrait のみ・iPad orientation 削除)
- [x] Capacitor plugins 6個統合 (app/browser/geolocation/share/splash-screen/status-bar)

### ⏳ 未着手 (Mac側で実行)

- [ ] **Apple Developer Program 登録** (個人名義・¥12,800/年・iPhone Safariから15分)
- [ ] Apple Developer 承認待ち (24-48時間)
- [ ] Xcode で初回ビルド・iPhone シミュレータ起動確認
- [ ] iPhone 実機ビルド (USB接続)
- [ ] App Store Connect で App レコード作成
- [ ] App Icon / Splash Screen 制作 (現在は Capacitor デフォルト)
- [ ] StoreKit 2 IAP 実装 (consumable コイン)
- [ ] Capacitor Geolocation plugin への移行 (現在は WKWebView の navigator.geolocation 流用)
- [ ] TestFlight 内部テスター招待 + ドッグフード
- [ ] スクリーンショット撮影 (6.7" / 6.5")
- [ ] App Store メタデータ (説明文・キーワード)
- [ ] 本番審査提出

---

## 2. Mac 側で最初にやること

```sh
# 1. リポを clone
git clone https://github.com/voixa/yorimichi-map.git
cd yorimichi-map
git checkout feat/ios-capacitor

# 2. iOS版だけ npm install (Web版は無視してOK)
cd ios-app
npm install

# 3. Capacitor を iOS バンドルに同期
npx cap sync ios

# 4. Xcode を起動
npx cap open ios
```

Xcode が起動したら：

1. 左ペインで `App` ターゲットを選択
2. `Signing & Capabilities` タブで個人 Apple ID を選択 (承認後に Team が選べる)
3. Bundle ID が `jp.indx.yorimichi` であることを確認
4. シミュレータ (iPhone 15 等) を選んで `▶ Run`

→ アプリが起動して街歩きガチャの画面が出れば成功。

---

## 3. Apple Developer Program 登録

**未着手**。これがないと TestFlight も App Store も使えない。

```
URL    : https://developer.apple.com/programs/enroll/
所要   : iPhone Safari で15分
費用   : ¥12,800/年 (クレジットカード)
名義   : 個人「柳下征二郎」(法人化は留学後)
承認   : 24〜48時間

[入力情報]
  氏名 (パスポート表記): YANAGISHITA SEIJIRO
  住所 (現住所・英語表記)
  電話番号: 080-9084-1146
  国: Japan
  Apple ID: seijirooo.y@gmail.com (既存)
```

⚠️ 法人「インデックス」名義での登録は DUNS 番号取得が必要でスケジュール遅延。個人で進める。

承認後にやること:
1. App Store Connect (https://appstoreconnect.apple.com/) にログイン
2. `Apps` → `+` → 新規アプリ作成
   - Platform: iOS
   - Name: 街歩きガチャ
   - Bundle ID: `jp.indx.yorimichi`
   - SKU: `yorimichi-001` (任意・ユニークな識別子)
3. Team ID を Xcode の Signing で選択 → Automatic Signing で証明書自動生成

---

## 4. ディレクトリ構造

```
yorimichi-map/                    ← リポルート
├ app.js, index.html, style.css   ← Web版 (現状維持・触らない)
├ sw.js, courses.js, photos.js
├ api/                            ← Flask バックエンド (Cloud Run)
│
└ ios-app/                        ← ★ ここで作業
    ├ www/                        ← iOS版 HTML/CSS/JS の実体
    │   ├ index.html
    │   ├ app.js                  ← Web版から独立コピー
    │   ├ courses.js, photos.js
    │   ├ style.css               ← iOS固有CSSルール追加済
    │   ├ about.html              ← ガチャ確率開示追加済
    │   └ ...
    ├ ios/                        ← Xcode プロジェクト
    │   └ App/App/
    │       ├ Info.plist          ← 権限・iPhone専用設定済
    │       ├ AppDelegate.swift
    │       └ Assets.xcassets/    ← アイコン・スプラッシュ
    ├ scripts/init-www.mjs        ← Web→www/ 初回コピー (使い終わり)
    ├ capacitor.config.json
    ├ package.json
    ├ README.md                   ← 短い操作手順
    └ HANDOFF.md                  ← このファイル
```

---

## 5. Web版とiOS版の差分 (重要)

| 項目 | Web版 (`../`) | iOS版 (`ios-app/www/`) |
|------|---------------|------------------------|
| Service Worker | あり (sw.js v156) | **なし**・登録コードも削除 |
| 課金 | Stripe LIVE 稼働中 | **無効化**・近日対応トースト |
| `startStripeCheckout()` | API呼び出し | **no-op** (showToast のみ) |
| `startSubscriptionCheckout()` | API呼び出し | **no-op** |
| `.shop-grid` / `#sub-cta` 等 | 表示 | CSS で **display: none** |
| プラットフォーム判定 | なし | `html[data-platform="ios"]` |
| body class | なし | `is-ios-app` |
| 確率開示 | なし | about.html に明記 (4.5.4対応) |
| LP (lp.html) | あり | コピーせず |
| 更新通知 | Service Worker | App Store 経由のみ |

**Web版は何も触っていない**。Web版を改修したいときは `main` ブランチで普通に作業し、必要なら iOS版にも手動で反映する。

---

## 6. App Store 規約対応 (確認済み)

### 4.5.4 ルートボックス確率開示
✅ `ios-app/www/about.html` の「ガチャ排出率」セクションに N/R/SR/LR の確率を明記

### 3.1.1 デジタルコンテンツはIAP必須
✅ `ios-app/www/app.js` の `startStripeCheckout()` / `startSubscriptionCheckout()` を no-op 化
✅ `ios-app/www/style.css` で `.shop-grid` 等を `display: none`

### 4.2 Minimum Functionality (ラッパー判定)
⚠️ リスクあり。対策:
- ガチャ・図鑑・GPS・完走証明書の「ゲーム要素」を強調
- App Store 説明文に「散歩×ガチャの位置情報ゲーム」と明示
- スクリーンショットでガチャ演出を最初に見せる

### 5.1.1 個人情報
✅ 位置情報はサーバー送信しない (about.html 明記)
✅ NSLocationWhenInUseUsageDescription を Info.plist に追加済

### ITSAppUsesNonExemptEncryption
✅ false に設定 (HTTPS のみ使用・暗号化機能なし)

---

## 7. StoreKit IAP 実装の設計メモ (未着手)

### 課金商品 (App Store Connect で登録予定)

| 商品ID | タイプ | コイン量 | 価格 |
|--------|--------|----------|------|
| `coins_10` | Consumable | 10 | ¥120 |
| `coins_30` | Consumable | 30 | ¥320 |
| `coins_100` | Consumable | 100 | ¥980 |
| `coins_300` | Consumable | 300 | ¥2,800 |
| `premium_monthly` | Auto-Renewable | プレミアム | ¥480/月 |

### 実装方針 (推奨)
- Capacitor のサードパーティ plugin `@capacitor-community/in-app-purchases` を使う
- もしくは Swift で StoreKit 2 を直接書いて Capacitor Bridge で繋ぐ
- consumable は購入即コイン付与 (Firestore か localStorage)
- レシート検証は Apple のサーバーサイド (App Store Server API) 経由

### 既存コードへの組み込み
`ios-app/www/app.js` の以下の関数を IAP 呼び出しに置き換える:
```js
async function startStripeCheckout(_packId) {
  // ← この no-op を IAP 呼び出しに差し替え
  showToast('💎 アプリ版のコイン購入は近日対応予定です', 'info', 3000);
}
```

非表示にしている課金UIを再表示するには `ios-app/www/style.css` の以下を変更:
```css
/* iOS で再表示するには、このセレクタから .shop-grid 等を外す */
html[data-platform="ios"] .shop-grid,
html[data-platform="ios"] #shop-modal,
... { display: none !important; }
```

---

## 8. リジェクト対策チェックリスト (審査提出前)

- [ ] スクリーンショット最初の1枚で「ガチャ演出」を見せる (ラッパー疑い回避)
- [ ] 説明文に「位置情報ゲーム」「散歩アクティビティ」と明記
- [ ] アプリアイコン (1024x1024) を制作
- [ ] スプラッシュスクリーンをブランド化 (現在は Capacitor デフォルト)
- [ ] プライバシーポリシーURL を App Store Connect に登録
- [ ] サポート連絡先メール (support@in-dx.jp) を登録
- [ ] レーティング設定: 4+ (年齢制限なし) 想定
- [ ] テスター用デモアカウント不要 (匿名アクセスのため)
- [ ] In-App Purchase は本リリースで一旦見送り → 第2版で追加 (審査スコープを最小化)

---

## 9. 次のセッション開始コマンド (Mac側)

新しい Claude Code セッションを Mac で開いた時は、以下を最初に伝える:

```
このリポ (yorimichi-map) は街歩きガチャの開発用。
ブランチ feat/ios-capacitor で iOS化作業中。
ios-app/HANDOFF.md を読んで状況把握して。
次は [Apple Dev 登録 / Xcode 起動 / IAP 実装 / etc.] をやりたい。
```

---

## 10. 残ファイル位置リファレンス

| 探したいもの | パス |
|--------------|------|
| iOS版アプリの実体コード | `ios-app/www/` |
| Xcodeプロジェクト | `ios-app/ios/App/App.xcodeproj` |
| 権限宣言 / Bundle設定 | `ios-app/ios/App/App/Info.plist` |
| Capacitor設定 | `ios-app/capacitor.config.json` |
| Stripe no-op化箇所 | `ios-app/www/app.js` の `startStripeCheckout` / `startSubscriptionCheckout` |
| SW削除箇所 | `ios-app/www/app.js` の `init()` 内 |
| 課金UI非表示ルール | `ios-app/www/style.css` 末尾 |
| ガチャ確率開示 | `ios-app/www/about.html` の「ガチャ排出率」セクション |
| ガチャ確率定義 (元データ) | `ios-app/www/app.js` 内 `RARITY` 定数 (約2058行付近) |

---

## 11. 履歴

| 日付 | 出来事 |
|------|--------|
| 2026-06-05 | Iter 117→120で 23ラウンドUI改善(67項目)+14バグ修正完了 / SW v156 / Stripe LIVE |
| 2026-06-07 | iOSネイティブ化を決定 (Capacitor wrap・iPhone専用・8月末入稿) |
| 2026-06-07 | Bundle ID を `jp.in-dx.yorimichi` → `jp.indx.yorimichi` に変更 (Capacitor規約) |
| 2026-06-09 | Web版とiOS版を完全分離 (`ios-app/` ディレクトリ独立・コード共有なし) |
| 2026-06-09 | MacBook Air 路線確定 (GitHub Actions/Fastlane Match は不要に) |

---

**最終コミット**: `bc31fe7` (feat/ios-capacitor)
**最終更新**: 2026-06-09
