# IAP（アプリ内課金）商品仕様 + StoreKit 実装計画

> 承認後 App Store Connect で登録する。Product ID は**永久に再利用不可**なので確定後は変更しない。

## 消耗型コイン商品（v1で登録・推奨）
既存Web版のパック（index.html:1559-1583）に対応。

| Web pack id | コイン | 価格(参考) | 推奨 Product ID | 表示名 | 説明 |
|-------------|-------|-----------|-----------------|--------|------|
| pack_starter | 🪙15 | ¥120 | `jp.indx.yorimichi.coins.15` | コイン15 | ガチャ約7回分 |
| pack_25 | 🪙90 | ¥500 | `jp.indx.yorimichi.coins.90` | コイン90 | ガチャ約45回分・お得 |
| pack_60 | 🪙210 | ¥1,000 | `jp.indx.yorimichi.coins.210` | コイン210 | 人気No.1 |
| pack_big | 🪙700 | ¥3,000 | `jp.indx.yorimichi.coins.700` | コイン700 | 最もお得 |

各商品に必要な入力:
- Reference Name（社内用・64字）/ Product ID（上記）/ 価格（Appleの価格ポイントから日本¥120/¥500/¥1000/¥3000に最も近いものを選択）
- 表示名・説明（ローカライズ）/ **審査用スクリーンショット**（実際のコイン購入画面）

## サブスク（v2に延期推奨）
- Web版「プレミアム ¥480/月」（index.html:1594）→ iOSは自動更新サブスク。
- サブスクはサブスクリプショングループ・無料トライアル設定・復元導線が必要で審査が重い。**v1は消耗型4種のみで出し、サブスクは公開後に追加**するのが安全。

## ⚠️ 重要な規約事項
- **コインは絶対に外部決済で売らない**（3.1.1）。アプリ内の購入は必ずStoreKit経由。Web checkout（Stripe）をWebViewで開いてはいけない。→ iOSはStripe導線を既にno-op化済（`app.js:3985` startStripeCheckout）。
- 購入済みコインは**失効させない**。
- 復元（Restore）導線を用意（消耗型は基本不要だが、サブスク追加時は必須）。

## StoreKit 2 実装計画（承認前にコードは書ける／検証はSandbox=承認後）
現状: `app.js` の購入関数は no-op（トースト表示のみ）。
1. **ネイティブ・ブリッジ**: Capacitorカスタムプラグイン（Swift, StoreKit 2 `Product.products(for:)` / `product.purchase()`）を追加。`ios/App/App/StoreKitPlugin.swift` 新規。
   - メソッド: `getProducts(ids)` / `purchase(productId)` / `restore()` / `currentEntitlements()`
   - トランザクション検証（`Transaction.currentEntitlements` / `VerificationResult`）→ 成功時にコイン付与イベントをWebへ。
2. **JS側差し替え**:
   - `startStripeCheckout(packId)`（app.js:3985）→ packId→Product ID マップで `StoreKit.purchase()` 呼び出し。
   - 成功コールバックで `gacha.coins += 付与数; gachaSave(); gachaUpdateUI()`。
   - ショップUIの iOS hide（style.css）を解除し `[data-iap-shop]` へ。価格はStoreKitの `displayPrice` を表示（ハードコード¥を使わない）。
3. **付与の正当性**: 消耗型はサーバー検証推奨だが、最小構成ではクライアント付与でも可（不正リスク低・少額）。将来 `/api/verify-iap`（App Store Server API）を追加。
4. **検証**: Sandboxテスター（App Store Connect で作成＝承認後）でサンドボックス購入→コイン付与→失効しないことを確認。TestFlightで本番に近い検証。

## 登録手順（承認後）
1. Paid Apps 契約 + 銀行/税 情報を App Store Connect で完了（IAP前提条件）
2. 上記4商品を「消耗型」で作成・Product ID を確定入力
3. 各商品の審査用スクショ（コイン購入画面）をアップ
4. アプリのバージョン1.0に4商品を紐付けて同時審査
