# App Store 提出アンケート 回答集（街歩きガチャ）

> 「ふたりのこと」の `docs/apple-submission-answers.md` を yorimichi 用に翻案。提出時UIはApple側更新で微変動するため画面で最終確認。
> セット: 本書 ／ `metadata.md`(掲載文) ／ `app-privacy.md`(ラベル詳細) ／ `iap-products.md`(課金) ／ `privacy-policy.md`・`terms-of-service.md`

## 0. 前提（このアプリの性質）
- 街歩きコースを**ガチャ(消耗コイン)**で引くGPSアプリ。位置情報・写真・AI解説・UGC(スポット投稿)。**アカウント登録なし(匿名UUID)・広告なし・トラッキングなし**。Cloud Run(日本)バックエンド。
- bundle id `jp.indx.yorimichi` / version `1.0` / iPhone専用 / 主market 日本。
- **ふたりのことより審査が楽な点**: ログイン不要＝デモアカウント不要・Sign in with Apple不要・2.1(ペア機能が試せない)リスクなし。

## 1. App Privacy（プライバシー栄養ラベル）
詳細表=`app-privacy.md`。要約: **トラッキング全項目No**。収集=精密位置/写真/匿名UserID/利用状況/UGC/クラッシュ（すべてApp機能・一部分析、IDに紐づくが追跡なし）。収集しない=氏名/メール/電話/住所/連絡先/健康/金融/IDFA。データ削除手段あり(info@in-dx.jp / 端末削除)。

## 2. 年齢レーティング（2025新方式）
- In-App Controls(保護者管理/年齢確認) → **No**
- **User-Generated Content** → **Yes**（スポット投稿・写真・コース評価）→ ガイドライン1.2適用。通報(`/api/report-spot`)あり。
- Messaging and Chat → **No**
- Unrestricted Web Access → **No** ／ Advertising → **No**
- **ルートボックス(ランダムなアプリ内アイテム購入) → Yes**（ガチャ＝消耗コインで回す）
- ギャンブル/賭博のシミュレーション → **No**（カジノ/スロット/賭けではない）／コンテスト → No
- 暴力・性的・成熟・医療 → すべて None
- **見込みレーティング: 12+〜16+**（ルートボックス申告による地域差。正直回答。ブラジルは自動18+表示の場合あり）

## 3. 輸出コンプライアンス（Export Compliance）
- `ITSAppUsesNonExemptEncryption: false` を Info.plist に設定済 → 提出時の暗号化質問はスキップ。通信はHTTPSのみ＝免除。

## 4. コンテンツ権利（Content Rights）
- 第三者コンテンツの配信 → 実質 **No**（コースは自社キュレーション、写真等はユーザー自身）。
- 地図は **OpenStreetMap**（ODbL・アプリ内に "Leaflet | © OpenStreetMap" 帰属表示あり）。ルート=OSRM。第三者著作物の再配布はしていない。

## 5. 広告識別子（IDFA）/ ATT
- IDFA使用 → **No**（広告なし・AdSupport未リンク・ATT未実装・`NSUserTrackingUsageDescription`なし）。

## 6. App Review Information（審査情報）★リジェクト回避の要
- **Sign-In Required: No**（アカウント不要。審査員はそのまま全機能を試せる）。
- **連絡先**: 氏名 柳下征二郎 / メール info@in-dx.jp / 電話（登録）。
- **Notes（審査メモ）テンプレ**（日本語＋英語を貼る）:

```
【日本語】
本アプリはアカウント登録不要で、起動後すぐ全機能をお試しいただけます。

・位置情報: 起動時に位置情報の許可を求めます。これはコースのスポット到着判定(50m以内)と地図・ルート表示に使います(常時取得はしません)。許可なしでも「電車で行ける候補」表示でアプリは利用可能です。
・ガチャ/コイン: 初回3回は無料でガチャを引けます。以降はアプリ内通貨「コイン」を使用します。コインは毎日のログインボーナス・コース完走・友達招待でも無料で貯まります。コインの購入はApp内課金(StoreKit・消耗型)のみで、外部決済は使用していません。ガチャの排出確率はガチャ画面の「排出率 詳細」から事前に確認できます(限定1%/隠れ家9%/穴場30%/定番60%)。
・写真: スポットでの撮影・写真選択は任意機能で、AIによる説明生成に使います。

【English】
No account/sign-in is required; all features are available immediately on launch.
- Location: We request location on launch, used only for spot check-in (within 50m) and map/route display (no background/Always use). The app remains usable without permission (shows "reachable by train" courses).
- Gacha/Coins: The first 3 gacha pulls are free. After that, an in-app currency "coins" is used, which can also be earned for free via daily login bonus, completing courses, and inviting friends. Coins are sold only via In-App Purchase (StoreKit, consumable); no external payment is used. Gacha odds are disclosed before pulling via "排出率 詳細" (Legendary 1% / Hidden 9% / Rare 30% / Standard 60%).
- Photos: Taking/选择 a photo at a spot is optional and used for AI description generation.
```

## 7. 提出メタデータ（必須/任意）
| 項目 | 必須 | 内容 |
|---|---|---|
| Version | 必須 | 1.0 |
| Name/Subtitle/Description/Keywords/Promo | 必須(一部任意) | `metadata.md` |
| **Support URL** | **必須** | `https://yorimichi.in-dx.jp/support`（要公開・info@in-dx.jp 記載） |
| Marketing URL | 任意 | `https://yorimichi.in-dx.jp` |
| **Privacy Policy URL** | **必須** | `https://yorimichi.in-dx.jp/privacy`（`privacy-policy.md` を公開） |
| Copyright | 任意 | `© 2026 インデックス（飲DX）` |
| Category | 必須 | Primary: **Travel** / Secondary: Navigation（Gamesは避ける＝ガチャ系審査が強まる） |
| Screenshots / Icon | 必須 | 6.9"=`screenshots/appstore-6.9/`(5枚生成済)。アイコンはビルド同梱 |
| Age Rating | 必須 | §2 |
| Price / IAP | 必須 | 本体無料 + 消耗型コイン4種(`iap-products.md`) |

## 8. IAP の設定（App Store Connect・§詳細は iap-products.md）
1. Paid Apps契約 + 銀行/税情報。
2. 消耗型コイン4種を作成(Product ID 厳密一致) → 各に日本語ローカライズ + **審査用スクショ(コイン購入画面)**。
3. **初回は本体バージョンと同時に審査提出**。
4. Sandboxテスターで購入→コイン付与→失効しないこと確認。
- サブスク(¥480/月)は**v2に延期**(審査簡素化)。

## 9. 提出前に残る「実作業」（アンケート以外）
- [x] iOS課金UIブロッカー是正(死にボタン/FAQ/虚偽プライバシー) — commit `eb0925a`
- [x] `PrivacyInfo.xcprivacy` 同梱・カメラ/写真許諾文言 — `eb0925a`
- [x] スクショ6.9"×5 — `f47728a`
- [ ] **StoreKit 2 実装**(no-op差し替え) + Sandbox検証 — 承認後(`iap-products.md`)
- [ ] **サポート/プライバシー/規約 URL を yorimichi.in-dx.jp に公開**(文面は用意済) — 要Webデプロイ
- [ ] aps-environment(Push使うなら production entitlement) — Push通知を初回から出すなら要対応(現状未確認)

## 10. 「今すぐ可能」vs「Apple承認後」
- **今すぐ可能(ほぼ完了)**: 本書の全回答準備・掲載文・スクショ・コードのブロッカー是正・プライバシー整備・URL文面。
- **🔒承認後**: App記録作成・Paid Apps契約・IAP登録・App Privacy/年齢提出・ビルドUpload・TestFlight・審査提出。
