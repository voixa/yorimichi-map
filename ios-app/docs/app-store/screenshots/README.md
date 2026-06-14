# App Store スクリーンショット

## 仕様（2026・iPhone専用）
- **必須サイズ: 6.9" = 1320 × 2868 px（縦）** — これ1セット出せば全iPhoneに自動縮小適用。
- 枚数: 1〜10枚（推奨5〜8）。PNG/JPEG・sRGB・アルファ無し・ピクセル完全一致。
- 撮影機: **iPhone 17 Pro Max** シミュレータ（`xcrun simctl ... "iPhone 17 Pro Max"`）。`simctl io screenshot` がちょうど1320×2868で出力（`01-home.png` で確認済）。

## 撮りたい画面（ストーリー順）
1. ✅ **01-home** ホーム＝ガチャヒーロー＋巨大CTA「今日のおでかけを引く」（撮影済・baseline）
2. ⬜ **02-gacha** ガチャ前のエリア×所要時間選択（「10秒でおでかけ」の核）
3. ⬜ **03-result** ガチャ結果カード（レア度＝限定/隠れ家でワクワク感）
4. ⬜ **04-map** さんぽ＝地図主役＋コースカード
5. ⬜ **05-zukan** 図鑑＝金枠「🏆制覇」コレクション（要：完走コースをシード）
6. ⬜ **06-walk** 歩行中HUD／到着チェックイン or 完走証明書

## 撮影手順
**A. computer-use が使える場合**: Simulator を前面化→各タブ/モーダルへタップ移動→各画面で
`xcrun simctl io "iPhone 17 Pro Max" screenshot docs/app-store/screenshots/0X-name.png`。

**B. computer-use が使えない場合（タップ不可）**: 一時コードで起動時に目的画面を強制表示してから simctl 撮影→リバート。
- 図鑑シード例（app.js の `loadCompletion()` 直後に一時追加）:
  `['kichijoji_park','kichijoji_food'].forEach(id=>{state.discoveredCourses.add(id);state.completedCourses.add(id);});`
  さらに起動時に図鑑を開く: `setTimeout(()=>{document.querySelector('[data-main-tab="me"]')?.click();/* or openCollection() */},1500);`
- ガチャ: 起動時に `setTimeout(()=>showGachaModal(),1500);`
- 撮影後は必ず一時コードを削除して再ビルド。

## 仕上げ（提出前）
- 生キャプチャにキャッチコピー帯／端末フレームを付けると訴求UP（任意・デザイン作業）。
- 最低限は生キャプチャ5〜8枚でも提出可。
