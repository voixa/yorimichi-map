"""
街歩きガチャ API server

ENV:
  STRIPE_SECRET_KEY       - 必須（テスト: sk_test_..., 本番: sk_live_...）
  STRIPE_WEBHOOK_SECRET   - 任意（webhook検証用、後日設定）
  GEMINI_API_KEY          - 任意（AIコース生成用、未設定時はテンプレ生成）
                            Google AI Studio で取得: https://aistudio.google.com/apikey
  ALLOWED_ORIGINS         - 任意（カンマ区切り、デフォルトは街歩きガチャ本番URL）

Endpoints:
  GET  /health                     - ヘルスチェック
  POST /api/checkout               - Stripe Checkout Session を作成
  POST /api/verify-session         - 完了したセッションを検証してコイン額を返す
  POST /api/webhook                - Stripe webhook（決済完了通知）
  POST /api/generate-narrative     - AIによるコース名・物語生成 (Gemini)
"""
import os
import json
import logging

import stripe
from flask import Flask, request, jsonify
from flask_cors import CORS

try:
    from google import genai
    from google.genai import types as genai_types
    _gemini_available = True
except ImportError:
    genai = None
    genai_types = None
    _gemini_available = False

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

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
gemini_client = None
if _gemini_available and GEMINI_API_KEY:
    try:
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        logger.info("Gemini client initialized")
    except Exception as e:
        logger.warning(f"Gemini init failed: {e}")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# 単一の Source of Truth
# 1ガチャ = 3コイン
PACKS = {
    "pack_starter": {"coins": 15,  "bonus": 0,   "price": 120,  "name": "お試し5連パック (15コイン)"},
    "pack_25":      {"coins": 75,  "bonus": 0,   "price": 500,  "name": "25連パック (75コイン)"},
    "pack_60":      {"coins": 150, "bonus": 30,  "price": 1000, "name": "⭐おすすめ60連パック (150+30ボーナス)"},
    "pack_big":     {"coins": 500, "bonus": 100, "price": 3000, "name": "大盤振る舞い200連パック (500+100ボーナス)"},
}

# サブスクリプションプラン
# 価格は ENV (STRIPE_PRICE_PREMIUM) で上書き可能。未設定時は動的に price を作成
SUBSCRIPTION_PRICE_ID = os.environ.get("STRIPE_PRICE_PREMIUM", "")
SUBSCRIPTION_AMOUNT = 480  # JPY/月
SUBSCRIPTION_NAME = "街歩きガチャ プレミアム"
SUBSCRIPTION_TRIAL_DAYS = 7

PRIMARY_ORIGIN = allowed_origins[0] if allowed_origins else "https://yorimichi.in-dx.jp"


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "service": "machiaruki-api",
        "stripe_mode": "test" if (stripe.api_key or "").startswith("sk_test_") else "live",
        "packs": list(PACKS.keys()),
        "ai_enabled": gemini_client is not None,
        "ai_model": GEMINI_MODEL if gemini_client else None,
    })


# ----- AI コース生成 -----

NARRATIVE_SYSTEM_PROMPT = """あなたは「街歩きガチャ」というアプリのコース命名・物語生成エンジンです。
ユーザーが選んだ出発地・目的地・経由スポットから、心が踊る街歩きコースの名前と短い物語を作ってください。

ルール:
- コース名は10〜18文字、句読点は最小限。「・」を1〜2個使ってOK
- 物語は60〜100文字。読み手の足取りを誘うトーン
- 商標・著名人・ブランド名は使わない（例: ジブリ・宮崎駿・ポケモン等は禁止）
- スポット名はそのまま使ってOK（一般名詞・地名・公開POI名）
- 提供されたJSONフォーマット通りに返す
- 余計な前置きや解釈は書かない"""


def _generate_narrative_with_ai(theme: str, area: str, stop_names: list, rarity: str) -> dict:
    """Gemini でコース名と物語を生成。失敗時は None。"""
    if not gemini_client:
        return None
    rarity_hint = {
        "legendary": "レア度LR（伝説級）：印象的で詩的に",
        "sr":        "レア度SR：少し凝った言葉選びで",
        "r":         "レア度R：シンプルに魅力を伝えて",
        "n":         "レア度N：気軽に・親しみやすく",
    }.get(rarity, "")

    user_prompt = f"""【お題】
- エリア: {area}
- テーマ: {theme}
- 経由スポット: {', '.join(stop_names)}
- {rarity_hint}

上記から、街歩きコースの名前(name)と物語(story)を JSON で返してください。"""

    try:
        config = genai_types.GenerateContentConfig(
            system_instruction=NARRATIVE_SYSTEM_PROMPT,
            temperature=0.95,
            max_output_tokens=400,
            response_mime_type="application/json",
            response_schema=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                required=["name", "story"],
                properties={
                    "name":  genai_types.Schema(type=genai_types.Type.STRING),
                    "story": genai_types.Schema(type=genai_types.Type.STRING),
                },
            ),
        )
        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=user_prompt,
            config=config,
        )
        text = (response.text or "").strip()
        if not text:
            return None
        data = json.loads(text)
        if not isinstance(data, dict) or "name" not in data or "story" not in data:
            return None
        return {
            "name": str(data["name"])[:60],
            "story": str(data["story"])[:300],
        }
    except Exception as e:
        logger.exception(f"narrative generation failed: {e}")
        return None


def _fallback_narrative(theme: str, area: str, stop_names: list, rarity: str) -> dict:
    """AI 不在時のテンプレ生成"""
    rarity_emoji = {"legendary": "✨", "sr": "🌟", "r": "⭐", "n": ""}
    head = stop_names[0] if stop_names else "街角"
    last = stop_names[-1] if len(stop_names) > 1 else ""
    nm = f"{rarity_emoji.get(rarity, '')}{area}・{theme}{('〜' + last) if last else ''}".strip()
    story = f"{area}を{theme}で巡る街歩き。{head}から始まり、気の向くままに歩く{len(stop_names)}スポットの小さな旅。"
    return {"name": nm[:40], "story": story[:200]}


@app.route("/api/generate-narrative", methods=["POST"])
def generate_narrative():
    """ランダム生成コースに名前と物語を付与する。"""
    data = request.get_json(silent=True) or {}
    theme = (data.get("theme") or "街歩き").strip()[:40]
    area = (data.get("area") or "").strip()[:40]
    rarity = (data.get("rarity") or "n").strip()[:20]
    stops = data.get("stops") or []
    if not isinstance(stops, list):
        stops = []
    stop_names = [str(s)[:60] for s in stops if s][:8]

    if len(stop_names) == 0:
        return jsonify({"error": "no_stops"}), 400

    narrative = _generate_narrative_with_ai(theme, area, stop_names, rarity)
    source = "ai"
    if narrative is None:
        narrative = _fallback_narrative(theme, area, stop_names, rarity)
        source = "fallback"

    return jsonify({**narrative, "source": source})


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


@app.route("/api/subscribe", methods=["POST"])
def subscribe():
    """月額サブスク用 Checkout Session を作成"""
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id") or "anonymous"

    try:
        # price 指定 or 動的生成
        if SUBSCRIPTION_PRICE_ID:
            line_items = [{"price": SUBSCRIPTION_PRICE_ID, "quantity": 1}]
        else:
            line_items = [{
                "price_data": {
                    "currency": "jpy",
                    "unit_amount": SUBSCRIPTION_AMOUNT,
                    "product_data": {"name": SUBSCRIPTION_NAME},
                    "recurring": {"interval": "month"},
                },
                "quantity": 1,
            }]

        session = stripe.checkout.Session.create(
            line_items=line_items,
            mode="subscription",
            success_url=f"{PRIMARY_ORIGIN}/?sub=success&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{PRIMARY_ORIGIN}/?sub=cancel",
            metadata={
                "user_id": user_id,
                "plan": "premium_monthly",
            },
            subscription_data={
                "trial_period_days": SUBSCRIPTION_TRIAL_DAYS,
                "metadata": {"user_id": user_id, "plan": "premium_monthly"},
            },
            locale="ja",
        )
        return jsonify({"url": session.url, "session_id": session.id})
    except stripe.error.StripeError as e:
        logger.exception("subscribe failed")
        return jsonify({"error": "stripe_error", "message": str(e)}), 502


@app.route("/api/subscription-status", methods=["POST"])
def subscription_status():
    """ユーザーIDから現在のサブスク状態を確認"""
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id")
    if not user_id:
        return jsonify({"premium": False}), 200
    try:
        subs = stripe.Subscription.list(limit=10)
        active = False
        sub_id = None
        for s in subs.data:
            md = s.get("metadata") or {}
            if md.get("user_id") != user_id:
                continue
            status = s.get("status")
            if status in ("active", "trialing"):
                active = True
                sub_id = s.id
                break
        return jsonify({
            "premium": active,
            "subscription_id": sub_id,
            "user_id": user_id,
        })
    except Exception as e:
        logger.exception("subscription_status failed")
        return jsonify({"premium": False, "error": str(e)}), 500


@app.route("/api/cancel-subscription", methods=["POST"])
def cancel_subscription():
    """サブスクを期間末でキャンセル設定"""
    data = request.get_json(silent=True) or {}
    sub_id = data.get("subscription_id")
    if not sub_id:
        return jsonify({"error": "missing_subscription_id"}), 400
    try:
        stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
        return jsonify({"ok": True, "cancel_at_period_end": True})
    except Exception as e:
        logger.exception("cancel_subscription failed")
        return jsonify({"error": str(e)}), 500


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
