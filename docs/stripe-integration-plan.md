# Stripe 決済実装プラン（コインショップ実課金化）

現状のコインショップは画面のみ（Demo）。実課金にするための手順。

---

## アーキテクチャ

```
[ユーザー]
  ↓ ボタンクリック
[index.html / app.js]
  ↓ POST /api/checkout
[Cloud Run Backend (Python Flask)]
  ↓ Stripe API
[Stripe]
  ↓ Webhook
[Cloud Run Backend]
  ↓ コイン付与（Firestore に保存）
[index.html]
```

現在は静的サイトのみだが、決済実装には**最低限のバックエンド**が必要。
別の Cloud Run サービス `yorimichi-api` を立てる。

---

## 実装ステップ

### Step 1: Stripe アカウント開設（柳下さん作業）

1. https://stripe.com で会社情報入力
2. 本人確認書類提出（運転免許等）
3. 銀行口座登録
4. **テストモード**でAPIキー取得（`pk_test_*`, `sk_test_*`）
5. 本番モード切替は本人確認完了後（数日）

### Step 2: バックエンド作成（Claude側）

新規ファイル：`api/main.py`

```python
import os
import stripe
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=["https://yorimichi.in-dx.jp"])

stripe.api_key = os.environ['STRIPE_SECRET_KEY']

PACKS = {
    'pack_10':  { 'coins': 10,  'price': 100,  'name': '10コイン' },
    'pack_80':  { 'coins': 80,  'price': 700,  'name': '80コイン（10連向け）' },
    'pack_120': { 'coins': 120, 'price': 1000, 'name': '120コイン（+20ボーナス）' },
    'pack_700': { 'coins': 700, 'price': 5000, 'name': '700コイン（+200ボーナス）' },
}

@app.route('/api/checkout', methods=['POST'])
def checkout():
    pack_id = request.json.get('pack')
    user_id = request.json.get('user_id')  # localStorage UUID
    if pack_id not in PACKS:
        return jsonify({ 'error': 'invalid pack' }), 400

    pack = PACKS[pack_id]
    session = stripe.checkout.Session.create(
        line_items=[{
            'price_data': {
                'currency': 'jpy',
                'unit_amount': pack['price'],
                'product_data': { 'name': pack['name'] },
            },
            'quantity': 1,
        }],
        mode='payment',
        success_url='https://yorimichi.in-dx.jp/?coins=success',
        cancel_url='https://yorimichi.in-dx.jp/?coins=cancel',
        metadata={
            'pack_id': pack_id,
            'coins': pack['coins'],
            'user_id': user_id or 'anonymous',
        },
    )
    return jsonify({ 'url': session.url })


@app.route('/api/webhook', methods=['POST'])
def webhook():
    payload = request.data
    sig = request.headers.get('stripe-signature')
    secret = os.environ['STRIPE_WEBHOOK_SECRET']
    try:
        event = stripe.Webhook.construct_event(payload, sig, secret)
    except Exception as e:
        return jsonify({ 'error': str(e) }), 400

    if event['type'] == 'checkout.session.completed':
        session = event['data']['object']
        user_id = session['metadata']['user_id']
        coins = int(session['metadata']['coins'])
        # TODO: Firestore に "coin_grants" コレクションで保存
        # ユーザーがアプリを開いたとき同期
        print(f'Granted {coins} to {user_id}')

    return jsonify({ 'ok': True })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
```

### Step 3: フロント側の統合（app.js修正）

`purchaseCoins()` を Stripe Checkout 経由に書き換え。
ユーザー識別子（UUID）を localStorage で管理。

```javascript
// 既存の購入ボタンクリック時
async function purchaseCoinsViaStripe(packId) {
  let userId = localStorage.getItem('yorimichi-user-id');
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem('yorimichi-user-id', userId);
  }

  const res = await fetch('https://yorimichi-api.example.com/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pack: packId, user_id: userId }),
  });
  const { url } = await res.json();
  window.location.href = url;
}

// 戻り値処理（成功時）
const params = new URLSearchParams(location.search);
if (params.get('coins') === 'success') {
  // 数秒後に webhook 経由でコイン付与されているはず
  // /api/sync_coins?user_id=xxx で同期
  syncCoinsFromBackend();
}
```

### Step 4: バックエンドのデプロイ

```bash
cd C:\Users\seiji\projects\yorimichi-map\api
gcloud run deploy yorimichi-api --source . --region asia-northeast1 \
  --set-env-vars STRIPE_SECRET_KEY=sk_test_xxx,STRIPE_WEBHOOK_SECRET=whsec_xxx \
  --allow-unauthenticated
```

### Step 5: Stripe Webhook URL 登録

Stripe Dashboard → Webhooks → Add endpoint:
- URL: `https://yorimichi-api-xxx.asia-northeast1.run.app/api/webhook`
- Events: `checkout.session.completed`

### Step 6: テスト決済確認

Stripe テストカード番号：
- 成功：`4242 4242 4242 4242`
- 失敗（残高不足）：`4000 0000 0000 9995`
- 3Dセキュア：`4000 0027 6000 3184`

すべて確認できたら本番モードに切替。

---

## 課題と注意点

### ⚠ 1. ユーザー識別の課題

現状はlocalStorage でUUID管理だが、ブラウザ削除でリセットされる。
**改善案**：
- メールアドレス入力（任意）
- Sign in with Apple/Google 導入
- それまでは「同じ端末でのみ有効」と明記

### ⚠ 2. 特商法表記必須

課金実装の前に「**特定商取引法に基づく表記**」が必須。
about.html にすでにテンプレ用意済み。本実装時に正式版に書き換え。

### ⚠ 3. 消費税

¥100 のコインパックは内税表記推奨。
Stripe で消費税自動計算機能あり。

### ⚠ 4. インボイス制度

将来的に法人化したら適格請求書発行事業者の登録検討。

---

## コスト

| 項目 | コスト |
|---|---|
| Stripe 決済手数料 | 売上の **3.6%**（カード決済） |
| Cloud Run（API） | 月 ¥0〜1,000（リクエスト数次第） |
| Firestore | 月 ¥0〜500（無料枠で十分） |
| **小計** | 売上の3.6% + ¥1,500/月 |

¥100コインパックの場合：
- 売上 ¥100
- 手数料 ¥3.6
- 利益 ¥96.4

---

## 実装前にやるべきこと

1. ✅ Stripe アカウント開設（柳下さん）
2. ✅ 個人事業届の確認（飲DX で売上計上できるか）
3. ✅ 銀行口座（屋号付きでもOK）
4. ✅ 利用規約の本格化（弁護士確認推奨）
5. ✅ 特商法表記の本実装

すべてクリアしたら Claude 側で1日でコード実装します。
