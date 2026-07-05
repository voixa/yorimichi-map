# 街歩きガチャ(yorimichi) iOS 引き継ぎ（2026-07-05）

新チャットにこのまま貼れば即再開できる。repo `~/projects/yorimichi-map`・branch `feat/ios-capacitor`。iOS版コード＝`ios-app/www/`（Web版とは別管理）。

## 現状
- **v1.0.1 (build4) = 公開中／v1.0.2 (build5) = `WAITING_FOR_REVIEW`**（2026-07-05提出）。App ID `6782575046`／bundle `jp.indx.yorimichi`。v1.0.2の中身は1.0.1と実質同一で、**ストア掲載スクショを新UIの4枚に差し替え**たのが目的。
- **コインIAP 4商品すべて `APPROVED`**（coins.15/.90/.210/.700）。集客ブロッカーはゼロ。
- 今セッションで公開済みになったもの＝**UI/UX全面刷新**（色統一・ホーム簡素化）＋**金沢/嵐山コース(21→24)**＋**日本地図図鑑**（実海岸線に都市ピン収集／未発見=灰・発見=橙・制覇=金／シェア画像1080×1440／結果カード「🗾日本地図で見る」→図鑑→「🗗さんぽ地図で歩く」で実地図に接続＝ポケGO的ループ）。
- **未コミット23ファイルは過去セッションの蓄積**（native設定/Web版/IAPスクリプト等）。今回の作業は下記コミットで確定済み。

## 完了（コミット・`feat/ios-capacitor`）
`8303e83`色統一+簡素化+金沢/嵐山 → `25da411`日本地図図鑑P1 → `3f7fcb9`シェア画像 → `a3a29d7`実海岸線に差替 → `09877c5`図鑑↔さんぽ接続 → `41f193d`**v1.0.1(build4)提出**（→承認・公開） → `f2cc999`/`8b240b9`/`d8695ec`**ASO新4枚**。

## 残タスク
1. ✅ **v1.0.2 スクショ差し替え＝2026-07-05 提出済み(`WAITING_FOR_REVIEW`)**。⚠️当初の「ビルド不要=build4再利用」は**不可だった**（公開済ビルドは新バージョンに再アタッチ不可=`409`）→ **build5を新規archive/upload**して提出。詳細レシピは Obsidian `Knowledge/yorimichi-appstore-release-flow`。あとは審査結果待ち。
   - 未コミット：pbxproj(1.0.2/build5)・`ios-app/www/analytics.js`(PostHog・1.0.1から出荷済)・`docs/app-store/{asc_submit.py,upload_screenshots_asc.py}`の編集。必要ならコミットする。
2. 集客(低優先・futari公開が先＝`Projects/yorimichi-marketing-execution-plan`)：制覇マップシェアの磨き／実機QA1周／コイン購入e2eテスト。方針=ゼロマーケのベースライン実験・専用SNS発信なし・アプリ内バイラル+ASOだけ。
3. コース拡張（京都/金沢は入れた・他都市は`comingSoon`ピンで表示中）。

## 触るファイル
- `ios-app/www/app.js`(~15k・IIFE)：図鑑=`showCollection`/`renderCollection(filter)`(rarity)+`state.collectionRegionFilter`合成／日本地図=`renderRegionMap`+`CJM_ISLAND_PATHS`+`latLngToPct`／シェア=`shareCollectionMap`／接続=`jumpToDiscoverForRegion`／`enabledCourseCount`。
- `ios-app/www/index.html`：`#collection-region-map`(図鑑上部)・`#result-mapview`。`style.css`(末尾に`.cjm-*`)。`courses.js`：`YORIMICHI_REGIONS/AREAS/COURSES`（都市追加は3つとも登録）。
- `ios-app/docs/app-store/`：`asc_submit.py`(version作成/whatsNew/build待ち/attach/submit)・`upload_screenshots_asc.py`・`make_appstore_screenshots.py`(生1206×2622→合成1284×2778・`SHOTS`で構成)・`build/ExportOptions.plist`。

## ビルド〜提出（実証済み手順）
```
# 版上げ: pbxproj の MARKETING_VERSION / CURRENT_PROJECT_VERSION を bump
cd ios-app && export PATH="$HOME/.local/node/bin:$PATH"; export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
npx cap copy ios
cd ios/App && xcodebuild -scheme App -project App.xcodeproj -configuration Release \
  -archivePath ../../build/App.xcarchive -destination 'generic/platform=iOS' \
  CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=H5AU564JP3 archive          # ←cert/profileはグローバル指定しない(RevenueCat SPM対策)
cd ../.. && xcodebuild -exportArchive -archivePath build/App.xcarchive \
  -exportOptionsPlist build/ExportOptions.plist -exportPath build/export
xcrun altool --upload-app -f build/export/App.ipa -t ios --apiKey XZ54R7ZQ99 --apiIssuer 70cefba7-13f2-453a-907b-cb645079e635
~/projects/yorimichi-map/.venv-shots/bin/python docs/app-store/asc_submit.py all   # version作成→whatsNew→build待ち→attach→submit
```
署名: `Apple Distribution: Seijiro Yagishita (H5AU564JP3)` / profile `yorimichi AppStore`。ASC鍵: `~/.appstoreconnect/private_keys/AuthKey_XZ54R7ZQ99.p8`(KID XZ54R7ZQ99 / issuer 70cefba7-… / **App Managerロール=売上/分析API 403**)。RevenueCat: project `5313b8a9` / 公開鍵 `appl_AdusslcuzjBoCqXeyvzslQtOAFc`(`app.js` の`RC_IOS_API_KEY`)。

## ハマりどころ（重要）
- **`aria-hidden="true"` は `[aria-hidden]{display:none}` で消える**→装飾SVG/要素は `role="presentation"` のみ（図鑑SVGが0×0で消えた真因）。
- **system-dark(prefers-color-scheme)では `[data-theme="dark"]` ルールが効かない**→色はflipトークン(`var(--text)`等)で。文字色を属性上書き頼みにしない。
- **`http.server` はCSS/JSをキャッシュ**→検証は**launch.jsonのportを毎回変える**。`preview_stop`がpython子を残す→`pkill -f http.server`。
- **ホームの引くCTAはsetMainTab('home')が走って初めて描画**。初期タブが「さんぽ」だとCTAが"消えて"見えるが**バグではない**（撮影時はホームを明示クリック）。
- **日本地図SVGは手描き不可(貧相)**→実海岸線GeoJSON(`johan/world.geo.json`・パブリックドメイン)をcos補正equirectangularで投影。`latLngToPct`と島パスは**同一投影定数**でピンが海岸線に乗る。都市増でも同レシピ。
- **ASOスクショ実機撮影**：iPhone 17 Proシミュ(1206×2622)。`app.js`先頭に一時shot-helper(geoloc抑止+onboarded+overlay殺し+auto-nav)→build→install→`simctl io screenshot`→**`git checkout app.js`で戻す**。⚠️**GPS許可のネイティブalertはJS/`simctl privacy`で消せない**→computer-useで「アプリの使用中は許可」を1回タップ→以降そのsimは許可済み。
- **ビルド処理(Apple側)が今回~40分と遅かった**。`asc_submit.py wait`(25分)ではタイムアウトし得る→再実行/延長。altool成功=バリデーション通過なら処理待ちなだけ。
- **触るサーバ**（ブラウザで確認用）：`cd ios-app/www && python3 -m http.server 8080 --bind 0.0.0.0`→`http://localhost:8080`。iPhone実機は同WiFiでMacのLAN IP(可変・`ipconfig getifaddr en0`)。IAPだけ動かないがコア体験は触れる。

## Obsidian
`Projects/yorimichi-map`（全体）／`Projects/yorimichi-marketing-execution-plan`（集客・正本）／`Knowledge/yorimichi-redesign-gotchas`（罠集）／`Decisions/2026-07-01-yorimichi-japan-map-collection`。
