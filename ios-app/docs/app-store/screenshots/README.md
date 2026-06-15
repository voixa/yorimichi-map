# App Store スクリーンショット

## ✅ 完成版（提出可能）
`appstore-6.9/01〜05.png` = **1320×2868（6.9"必須規格）・キャプション付き5枚**。そのまま App Store Connect にアップロード可。
（6.9"を1セット出せば全iPhoneサイズに自動適用される）

| # | 画面 | キャッチコピー |
|---|------|--------------|
| 01 | ホーム(ガチャヒーロー) | 今日どこ行く？を、10秒で。 |
| 02 | ガチャ(エリア×時間+マシン) | エリアと時間を選んで、回すだけ |
| 03 | ガチャ結果(隠れ家コース) | 王道から、隠れ家まで |
| 04 | さんぽ(地図主役) | 地図で、さんぽを楽しむ |
| 05 | 図鑑(金枠制覇) | 歩いて集めて、制覇する |

## 手法（「ふたりのこと」と同じ）
twin-diary-native の `scripts/make_appstore_screenshots.py` を流用・翻案。
**生スクショ → PIL でブランドグラデ背景＋見出しを合成 → 提出品質に**（端末フレーム不要・リビルド不要）。

### 再生成手順
```sh
cd ~/projects/yorimichi-map
# 初回のみ: python venv に Pillow（PEP668回避）
python3 -m venv .venv-shots && ./.venv-shots/bin/pip install Pillow
# 合成（raw-*.png → appstore-6.9/）
./.venv-shots/bin/python ios-app/docs/app-store/make_appstore_screenshots.py
```
スクリプト=`../make_appstore_screenshots.py`（オレンジ系グラデ・キャッチコピーはここで編集）。

### 生スクショの撮り直し（必要時）
6.3"=iPhone 17 Pro シミュレータで撮影（1206×2622）。スクリプトが1320×2868へ拡大合成する。
```sh
xcrun simctl io "iPhone 17 Pro" screenshot raw-0X-name.png
```
- 画面遷移は Simulator を前面化してタップ（computer-use）。図鑑の「制覇」表示には完走コースのシードが要る（撮影時のみ app.js `loadCompletion()` 直後に一時追加→撮影後リバート。今回はこの手法で撮影）。

## 仕上げ（任意）
- 英語ロケール版が要るなら SHOTS の見出しを英語にして再生成。
- 端末フレーム/動画(App Preview)は任意。現状の5枚で提出可。
