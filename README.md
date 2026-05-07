# 寄り道マップ (Yorimichi Map)

街の散歩コースを **ガチャで引く** GPSスタンプラリー型 Web 地図サービス。

🌐 **本番URL**：https://yorimichi.in-dx.jp/lp.html
🎰 **アプリ**：https://yorimichi.in-dx.jp/

---

## 概要

吉祥寺・谷根千・神保町・浅草エリアのキュレーション済み散歩コースを、巨大なガチャポンマシンUIで1本だけ引いて、GPSチェックインで巡るスタンプラリーアプリ。

- 🎰 ガチャ式コース発見（N/R/SR/LR の4段階レアリティ）
- 📍 GPS自動チェックイン（50m以内）
- 🏆 完走証明書・SNS共有
- 📚 ポケモン図鑑型コレクション
- 🌐 PWA対応（ホーム画面追加・オフライン動作）
- 🇯🇵🇬🇧 日英バイリンガル
- 💰 完全無料・登録不要

## 技術スタック

| 層 | 技術 |
|---|---|
| フロント | Vanilla HTML / CSS / JavaScript |
| 地図 | Leaflet.js 1.9.4 |
| タイル | OpenStreetMap / CartoDB |
| 経路計算 | OSRM 公開API |
| ジオコーディング | Nominatim |
| ホスティング | Google Cloud Run + Docker (nginx:alpine) |
| PWA | Service Worker + manifest.json |
| 音声 | Web Speech API |
| GPS | Geolocation API (watchPosition) |
| 永続化 | localStorage（バックエンドなし） |

## ファイル構成

```
yorimichi-map/
├── index.html        # メインアプリ
├── lp.html           # ランディングページ
├── about.html        # サービス概要・特商法
├── offline.html      # オフライン時フォールバック
├── app.js            # アプリロジック（〜3000行）
├── courses.js        # コース定義（13コース・4エリア）
├── photos.js         # Wikimedia写真URL・店舗特典
├── style.css         # スタイル
├── sw.js             # Service Worker
├── manifest.json     # PWA manifest
├── Dockerfile        # nginx:alpine
├── nginx.conf        # nginx設定
├── docs/             # 営業・PR資料
└── scripts/          # データメンテ用Pythonスクリプト
```

## デプロイ

```bash
bash scripts/validate.sh
gcloud run deploy yorimichi-map --source . --region asia-northeast1 --allow-unauthenticated --quiet
```

## 開発

```bash
# ローカル確認（任意のHTTPサーバーでOK）
python -m http.server 8000
# → http://localhost:8000
```

データを編集したら必ずデプロイ前に：

```bash
bash scripts/validate.sh
```

## 運営

| 項目 | 内容 |
|---|---|
| 屋号 | 飲DX |
| 代表 | 柳下征二郎 |
| 連絡 | info@in-dx.jp |

---

🤖 このプロダクトは **Claude Code** で開発しました。
