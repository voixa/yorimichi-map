# 日本地図図鑑 — UIUX設計プラン（rule#9 Step2）

> 要件: `JAPAN-MAP-COLLECTION-REQUIREMENTS.md` / 対象: `ios-app/www/{app.js,index.html,style.css}` / 前提: ラウンド1〜3済

## 1. 情報設計（IA）
図鑑ビュー（`showCollection` が開くモーダル/パネル）を **2段構成**にする：
```
┌─────────────────────────────┐
│  🗾 収集マップ（イラスト日本列島・SVG）      │  ← 主役・上部
│    ・都市ピン（金沢/京都/大阪/東京…）          │
│    ・タップで下のリストをその都市に絞り込み       │
│    ・進捗「○都市制覇 / 全△都市」               │
├─────────────────────────────┤
│  下: 選択都市のコース（既存シルエットリスト）      │  ← renderCollection 流用
└─────────────────────────────┘
```
- 3タブ構造は不変。図鑑への入口（`#hh-collection`ヒーロー・マイ）は現状維持で、開くと上記に。
- さんぽ（Leaflet実地図）は無変更。

## 2. ピンの単位とデータ源
- **ピン＝`YORIMICHI_REGIONS` の日本国内（country==='JP'）**＝ 東京/京都/大阪/金沢（ヴェネツィアは除外＝将来の世界地図/留学版）。
- 各リージョンの `centerLat/centerLng` を **SVGビューボックス座標へ線形投影**。
  - 日本本土 bbox: lng 129〜146、lat 31〜46。`x = (lng-129)/(146-129)*W`、`y = (46-lat)/(46-31)*H`（緯度は上下反転）。
  - 厳密な地理精度は不要（イラスト地図＝"可愛い"優先）。ピンが列島上に概ね乗ればOK。

## 3. ピンの状態（3段）
リージョン内のコース集合に対して：
- **未着手**（そのリージョンのコースを1つも引いてない）＝ 薄いドット（点線円）
- **発見**（`discoveredCourses` に1つ以上）＝ カラーピン（ブランドオレンジ）＋「発見n/総数」小バッジ
- **制覇**（そのリージョンの**全コース**が `completedCourses`）＝ **金ピン＋発光**（`showLegendaryGlow`のトーンを流用）
- 進捗ヘッダ「🏅 制覇 {金の都市数} / {JP都市数}」。

## 4. イラスト日本地図SVG
- **自作の簡略SVG**（4主要島のラフなシルエットpath＝軽量・依存ゼロ・"イラスト風"）。外部アセット/CDN不使用。
- 塗り＝`var(--surface-2)`、輪郭＝`var(--border)`、海＝透明（背景に溶ける）。ダーク/ライト両対応（トークン）。
- ピンは `<button>` を絶対配置（SVG上のオーバーレイ）でタップ判定を確実に（Leafletは使わない＝軽い）。
- viewBox 例 `0 0 320 360`（縦長＝日本列島）。

## 5. インタラクション
- ピンtap → 下のリストをそのリージョンのコースに絞り、`.active`ピンを強調。もう一度tapで全解除。
- 既定＝「すべて」（全リージョンのコースをリスト表示、地図は全ピン表示）。
- reduced-motion配慮：金ピンの発光はCSS`@media`で静的化。

## 6. シェア（第2段）
- 結果カード（引いた直後）に「🗾 日本地図で見る」＝図鑑を開いてそのリージョンにフォーカス。
- 「収集マップをシェア」＝日本地図＋進捗を画像化（既存の完走証明書シェア＝`html2canvas`/view-shot系を流用。無ければ第2段で）。

## 7. 実装ステップ
1. `index.html`：図鑑モーダル内の最上部に `#collection-japan-map`（SVG＋ピンオーバーレイ）コンテナを追加（既存リストは下に残置）。
2. `courses.js`/データ：投影に使う JP リージョンは既存。追加データ不要。
3. `app.js`：
   - `renderJapanMap()`：JPリージョンごとにピン生成（状態算出＝discovered/完走集合とcourses突合）＋投影配置＋tapハンドラ。
   - `showCollection()`/`renderCollection(filter)`：地図描画を呼び、ピンtapで `collectionRegionFilter` をセット→リスト再描画。
   - 進捗ヘッダ更新。
4. `style.css`：`.cjm-*`（map/ pin/ pin-discovered/ pin-conquered/ badge/ progress）をトークンで。新規`!important`最小。
5. 結果カードに「🗾 日本地図で見る」導線。
6. （第2段）シェア画像。

## 8. 罠の踏襲（ラウンド1〜2の教訓）
- 文字/ピン色は **flipするトークン**（`var(--text)`等）。`[data-theme="dark"]`属性依存にしない（system-dark対策）。
- 装飾に `aria-hidden` を使わない（`display:none`される）→ `role="presentation"`。
- 検証はポート替えでキャッシュ回避＋`getComputedStyle`実測＋両テーマ。
- HTMLの既存id・`.hidden`トグルを壊さない（追加は新id）。

## 9. スコープ分割
- **Phase 1（今回）**: 日本地図SVG＋都市ピン3状態＋tap絞り込み＋進捗ヘッダ＋結果カード導線。
- **Phase 2（次回）**: 収集マップのシェア画像化、ズームで都市→コースピン展開、世界地図(留学版)。

## 10. レビュー反映（/review：UIUXデザイナー＋シニアFE・2026-07-01）
- **[最重要] 4都市スカスカ対策**：`YORIMICHI_REGIONS` に **country==='JP' の "準備中" 都市**（`comingSoon:true`・courses無し）を約10追加（札幌/仙台/名古屋/横浜/広島/福岡/沖縄/仙台/神戸/長野等）。地図に灰点線ピン＋「準備中」で表示＝**埋まって見える＋増える未来を提示**。実都市(東京/京都/大阪/金沢)は通常ピン。
- **[高] `renderCollection` は現状 rarity フィルタ専用**(app.js:9664付近・引数=all/legendary/sr/r/n)。→ `state.collectionRegionFilter`(既定null=全国) を追加し、renderCollection 内で **region と rarity を合成フィルタ**。既存 rarity タブ/検索/ソートは非破壊で維持。ピンtap＝regionフィルタをセットして再描画。
- **[高] Phase2の世界地図で id 破壊回避**：新規DOMは `#collection-region-map`（`data-country="JP"`）で汎用化。関数 `renderRegionMap(country='JP')`。
- **[中] 投影は%ベース**：`latLngToPct(lat,lng)`→ 0–100% を返し、ピン`<button>`を **`position:absolute; left:%; top:%; transform:translate(-50%,-50%)`** で配置（getBoundingClientRect/px計算は使わない＝resize/scroll安全）。ヒットボックス44px・safe-area考慮。
- **[中] 京都・大阪の近接衝突**（経度0.27°差）：city一覧で近接するピンは手動で微オフセット（表示座標に小さなずらしテーブル）。
- **[高/デザイナー] 発見/制覇の定義を明確化**：未着手＝そのregionのコースを1本も引いてない ／ **発見＝1本以上 `discoveredCourses`（オレンジ塗り＋バッジ「歩 completed/total」）** ／ **制覇＝region内の全コース `completedCourses`（金＋発光）**。バッジで「あと何本歩けば金か」を明示。
- **ピン3状態の具体スペック**：未/準備中＝灰の点線中空○(28px)・準備中はラベル「準備中」 ／ 発見＝オレンジ塗り◉(32px)＋数字バッジ ／ 制覇＝金塗り◉＋`filter:drop-shadow`発光(reduced-motionで静的)。
- **見本＝Figma代わりにPreviewで実物反復**（両テーマ・ポート替えキャッシュ回避・getComputedStyle実測）。
- **リバース索引**：起動時に `coursesByRegion` を1回構築（region状態算出をO(1)寄りに）。
- **結果カード**に「🗾 日本地図で見る」導線（Phase1）。ピンtap時は該当ピン強調＋「都市名・Nコース」バナー。
- 課題データ源の注意：コースの所属は `course.area`→`YORIMICHI_AREAS.find(a=>a.id===course.area).region`（`areaId`フィールドは存在しない）。
