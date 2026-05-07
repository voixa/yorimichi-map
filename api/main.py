"""
街歩きガチャ API server
Stripe Checkout → コイン付与のためのバックエンド

ENV:
  STRIPE_SECRET_KEY       - 必須（テスト: sk_test_..., 本番: sk_live_...）
  STRIPE_WEBHOOK_SECRET   - 任意（webhook検証用、後日設定）
  ALLOWED_ORIGINS         - 任意（カンマ区切り、デフォルトは寄り道マップ本番URL）

Endpoints:
  GET  /health                     - ヘルスチェック
  POST /api/checkout               - Stripe Checkout Session を作成
  POST /api/verify-session         - 完了したセッションを検証してコイン額を返す
  POST /api/webhook                - Stripe webhook（決済完了通知）
"""
import os
import json
import logging

import stripe
from flask import Flask, request, jsonify
from flask_cors import CORS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

DEFAULT_ORIGINS = [
    "https://yorimichi.in-dx.jp",
    "https://yorimichi-map-1028920472559.asia-northeast1.run.app",
]
allowed_origins_env = os.environ.get("ALLOWED_ORIGINS", "").strip()
allowed_origins = (
    [o.strip() for o in allowed_origins_env.split(",") if o.strip()]
    if allowed_origins_env
    else DEFAULT_ORIGINS
)
CORS(app, origins=allowed_origins, supports_credentials=False)

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY")
if not stripe.api_key:
    logger.warning("STRIPE_SECRET_KEY is not set; Stripe calls will fail")

# 単一の Source of Truth
# 1ガチャ = 3コイン
PACKS = {
    "pack_starter": {"coins": 15,  "bonus": 0,   "price": 120,  "name": "お試し5連パック (15コイン)"},
    "pack_25":      {"coins": 75,  "bonus": 0,   "price": 500,  "name": "25連パック (75コイン)"},
    "pack_60":      {"coins": 150, "bonus": 30,  "price": 1000, "name": "⭐おすすめ60連パック (150+30ボーナス)"},
    "pack_big":     {"coins": 500, "bonus": 100, "price": 3000, "name": "大盤振る舞い200連パック (500+100ボーナス)"},
}

PRIMARY_ORIGIN = allowed_origins[0] if allowed_origins else "https://yorimichi.in-dx.jp"


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "service": "machiaruki-api",
        "stripe_mode": "test" if (stripe.api_key or "").startswith("sk_test_") else "live",
        "packs": list(PACKS.keys()),
    })


@app.route("/api/checkout", methods=["POST"])
def checkout():
    """Stripe Checkout Session を作成して決済URLを返す"""
    data = request.get_json(silent=True) or {}
    pack_id = data.get("pack")
    user_id = data.get("user_id") or "anonymous"

    if pack_id not in PACKS:
        return jsonify({"error": "invalid_pack", "valid_packs": list(PACKS.keys())}), 400

    pack = PACKS[pack_id]
    total_coins = pack["coins"] + pack["bonus"]

    try:
        session = stripe.checkout.Session.create(
            line_items=[{
                "price_data": {
                    "currency": "jpy",
                    "unit_amount": pack["price"],
                    "product_data": {"name": pack["name"]},
                },
                "quantity": 1,
            }],
            mode="payment",
            # PayPay/カード等は Stripe Dashboard 側で有効化したものが自動で表示される
            # （payment_method_types を明示すると Dashboard 設定が無視されるので指定しない）
            success_url=f"{PRIMARY_ORIGIN}/?coins=success&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{PRIMARY_ORIGIN}/?coins=cancel",
            metadata={
                "pack_id": pack_id,
                "coins": str(total_coins),
                "user_id": user_id,
            },
            locale="ja",
        )
        return jsonify({"url": session.url, "session_id": session.id})
    except stripe.error.StripeError as e:
        logger.exception("Stripe checkout failed")
        return jsonify({"error": "stripe_error", "message": str(e)}), 502
    except Exception as e:
        logger.exception("Unexpected checkout error")
        return jsonify({"error": "server_error"}), 500


@app.route("/api/verify-session", methods=["POST"])
def verify_session():
    """
    成功画面遷移後、フロントが session_id を渡してきた時に
    実際に支払いが完了しているか確認しコイン額を返す。
    （冪等性はフロント側 localStorage で消費済みセッションIDを管理）
    """
    data = request.get_json(silent=True) or {}
    session_id = data.get("session_id")

    if not session_id:
        return jsonify({"error": "missing_session_id"}), 400

    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except stripe.error.StripeError as e:
        logger.exception("verify-session: Stripe error")
        return jsonify({"error": "stripe_error", "message": str(e)}), 502

    paid = (session.get("payment_status") == "paid")
    metadata = session.get("metadata") or {}

    if not paid:
        return jsonify({"paid": False, "payment_status": session.get("payment_status")}), 200

    return jsonify({
        "paid": True,
        "pack_id": metadata.get("pack_id"),
        "coins": int(metadata.get("coins", 0)),
        "user_id": metadata.get("user_id"),
    })


@app.route("/api/webhook", methods=["POST"])
def webhook():
    """
    Stripe webhook（後日、Dashboard でエンドポイントを登録 + STRIPE_WEBHOOK_SECRET 設定後に有効化）
    現状はログ出力のみ。
    """
    payload = request.data
    sig = request.headers.get("stripe-signature")
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET")

    if not secret:
        logger.warning("Webhook hit but STRIPE_WEBHOOK_SECRET is not set")
        return jsonify({"ok": True, "note": "webhook_secret_not_configured"}), 200

    try:
        event = stripe.Webhook.construct_event(payload, sig, secret)
    except Exception as e:
        logger.exception("Webhook signature verification failed")
        return jsonify({"error": "invalid_signature"}), 400

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        metadata = session.get("metadata") or {}
        logger.info(
            "Granted %s coins (pack=%s) to user=%s session=%s",
            metadata.get("coins"),
            metadata.get("pack_id"),
            metadata.get("user_id"),
            session.get("id"),
        )

    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
