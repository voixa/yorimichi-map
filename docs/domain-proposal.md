# 独自ドメイン提案

現在URL：`https://yorimichi.in-dx.jp`
覚えにくいので独自ドメイン推奨。

---

## おすすめドメイン候補（Top 5）

### 🥇 1. `yorimichi.app`
- **価格**：年 ¥3,000-3,500
- **TLD**：`.app`（HTTPS必須・モダン・アプリ向け公式）
- **長さ**：13文字、覚えやすい
- **印象**：プロダクト名そのままで一意。SNSで言及しやすい

### 🥈 2. `yorimichi-map.com`
- **価格**：年 ¥1,500-2,000
- **TLD**：`.com`（信頼性最強）
- **長さ**：18文字、やや長い
- **印象**：王道。「マップ」が入って意味が伝わりやすい

### 🥉 3. `yorimichi.jp`
- **価格**：年 ¥3,500
- **TLD**：`.jp`（日本国内サービス感）
- **長さ**：12文字
- **印象**：ローカル感・信頼感

### 4. `yorimichi-map.jp`
- **価格**：年 ¥3,500
- **TLD**：`.jp`
- **長さ**：17文字
- **印象**：明確だが長い

### 5. `yorimichi.tokyo`
- **価格**：年 ¥3,000
- **TLD**：`.tokyo`（地域TLD）
- **長さ**：15文字
- **印象**：おしゃれ、東京特化感、若干クセあり

---

## 🏆 私のおすすめ：`yorimichi.app`

理由：
1. **「app」という TLD がアプリだと一目で分かる**
2. **HTTPS必須**で安全感（`.app` の特性）
3. **短くて覚えやすい**
4. **海外展開時もそのまま使える**
5. **競合の `yorimichi-map.com` が空いてれば抑えるべき**だが、`.app` の方が今っぽい

---

## 取得＆設定の手順（30分）

### 1. ドメイン購入（5分）

**おすすめ業者**：
- **Cloudflare Registrar** ⭐推奨
  - 原価販売（年¥3,000程度）
  - 更新料も安い
  - DNSも同じCloudflareで一元管理
- **お名前.com**
  - UIが日本語
  - 初年度安いが更新料高い
  - 不要オプションの自動加入に注意

```
Cloudflare の場合：
1. dash.cloudflare.com にアカウント作成
2. Domain Registration → Register
3. yorimichi.app を検索 → 利用可能ならカートへ
4. 支払い（年 ~$15）
5. 即時取得完了
```

### 2. Cloud Run にカスタムドメインをマッピング（10分）

```bash
gcloud beta run domain-mappings create \
  --service=yorimichi-map \
  --domain=yorimichi.app \
  --region=asia-northeast1
```

実行後、表示されるDNSレコード（A/AAAA/CNAME）を Cloudflare DNS に追加。

### 3. SSL証明書の自動発行を待つ（数分〜1時間）

Cloud Run が Let's Encrypt 経由で自動発行。`https://yorimichi.app` でアクセス可能に。

### 4. 既存URLからリダイレクト（任意）

旧URL（Cloud Run デフォルト）から新ドメインへのリダイレクトは Cloud Run の設定で可能。ただし通常は両方アクセス可能のままで問題ない。

### 5. OGP・各種ファイル更新

新ドメインで動くように以下を更新：
- `lp.html` の og:url
- `index.html` の og:url  
- `sitemap.xml`
- `robots.txt`
- `docs/note-article-draft.md`
- `docs/b2b-pitch.md`

---

## サブドメイン戦略（将来）

事業拡大時の構成例：

```
yorimichi.app           → メインサービス（散歩マップ）
docs.yorimichi.app      → ドキュメント・FAQ
blog.yorimichi.app      → ブログ・コンテンツマーケ
admin.yorimichi.app     → 管理画面（B2B加盟店向け）
api.yorimichi.app       → 公開API（将来）
in-dx.jp                → 飲DX 法人サイト（VOIXA含む全事業）
```

---

## 月額コスト見積もり（ドメイン込み）

| 項目 | 月額 |
|---|---|
| Cloud Run（無料枠内） | ¥0 |
| Cloud Build（更新時のみ） | ¥0 |
| Artifact Registry | ¥10 |
| ドメイン yorimichi.app | ¥250 |
| **合計** | **月¥260** |

月10万PV想定でもこの金額に収まります。

---

## 次のアクション

1. **本日中**：`yorimichi.app` が空いているか Cloudflare で確認
2. **空いていれば**：すぐに購入（取り合いリスク回避）
3. **DNSマッピング**：購入後すぐに Cloud Run へ
4. **OGP・SNS再投稿**：新ドメインでXに再ポスト

> 💡 **このタスクは私（Claude）でできるのは「DNSコマンドの生成」「ファイル更新」までです。アカウント開設・支払いは柳下さんお願いします。**
