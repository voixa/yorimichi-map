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

try:
    from google.cloud import firestore
    _firestore_available = True
except ImportError:
    firestore = None
    _firestore_available = False

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
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite")

# Firestore: Cloud Run の Application Default Credentials を使用
firestore_client = None
USER_STATE_COLLECTION = "yorimichi_user_state"
if _firestore_available:
    try:
        firestore_client = firestore.Client()
        logger.info("Firestore client initialized")
    except Exception as e:
        logger.warning(f"Firestore init failed: {e}")

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
        "firestore_enabled": firestore_client is not None,
    })


# ----- Firestore: ユーザー状態の同期（オプトイン） -----
# 個人情報は受け取らず、UUID形式のユーザーIDのみで識別。
# クライアントが任意で「クラウド同期」をONにした時のみ動作。
import re as _re
_USER_ID_PATTERN = _re.compile(r"^[a-zA-Z0-9_-]{8,64}$")

def _validate_user_id(uid: str) -> bool:
    return bool(uid and _USER_ID_PATTERN.match(uid))

# 同期可能なフィールド（ホワイトリスト）
_SYNC_FIELDS = {
    "coins", "freeUsedToday", "lastFreeDate",
    "pulls", "pullsSinceSR", "pullsSinceLR",
    "discoveredCourses", "completedCourses",
    "walkCounts", "walkHistory",
    "loginStreak", "lastLoginDate",
    "totalWalkMin", "totalSteps",
    "ratedCourses",
}

@app.route("/api/sync", methods=["POST"])
def sync_user_state():
    """クライアントの状態を Firestore に保存（オプトイン）"""
    if not firestore_client:
        return jsonify({"error": "firestore_disabled"}), 503
    data = request.get_json(silent=True) or {}
    user_id = (data.get("user_id") or "").strip()
    if not _validate_user_id(user_id):
        return jsonify({"error": "invalid_user_id"}), 400

    state = data.get("state") or {}
    if not isinstance(state, dict):
        return jsonify({"error": "invalid_state"}), 400

    # ホワイトリストに含まれるフィールドのみ抽出
    safe_state = {k: v for k, v in state.items() if k in _SYNC_FIELDS}
    # サイズ上限: walkHistoryが長すぎないように
    if isinstance(safe_state.get("walkHistory"), list):
        safe_state["walkHistory"] = safe_state["walkHistory"][-200:]

    try:
        doc_ref = firestore_client.collection(USER_STATE_COLLECTION).document(user_id)
        safe_state["_synced_at"] = firestore.SERVER_TIMESTAMP
        doc_ref.set(safe_state, merge=True)
        return jsonify({"ok": True, "fields_synced": list(safe_state.keys())})
    except Exception as e:
        logger.exception("sync failed")
        return jsonify({"error": "firestore_error", "message": str(e)[:200]}), 502


@app.route("/api/restore", methods=["POST"])
def restore_user_state():
    """Firestore からユーザー状態を取得"""
    if not firestore_client:
        return jsonify({"error": "firestore_disabled"}), 503
    data = request.get_json(silent=True) or {}
    user_id = (data.get("user_id") or "").strip()
    if not _validate_user_id(user_id):
        return jsonify({"error": "invalid_user_id"}), 400
    try:
        doc_ref = firestore_client.collection(USER_STATE_COLLECTION).document(user_id)
        doc = doc_ref.get()
        if not doc.exists:
            return jsonify({"exists": False, "state": None})
        state = doc.to_dict() or {}
        # 内部メタを除去
        synced_at = state.pop("_synced_at", None)
        return jsonify({
            "exists": True,
            "state": state,
            "synced_at": synced_at.isoformat() if synced_at else None,
        })
    except Exception as e:
        logger.exception("restore failed")
        return jsonify({"error": "firestore_error", "message": str(e)[:200]}), 502


# ----- ライブ統計（匿名・集計値のみ） -----
import time as _time

# In-memory 直近アクティビティ集計（インスタンス内のみ）
# 高頻度・低価値なイベントは Firestore に書かずメモリで集計
_LIVE_BUCKET_SIZE = 60  # 60秒バケット
_live_buckets = {
    "active": {},  # ts_minute -> set of user_ids（直近30分）
    "pulls": {},   # ts_minute -> count
    "completes": {},  # ts_minute -> count
}

def _trim_buckets(now_min):
    """30分より古いバケットを削除"""
    cutoff = now_min - 30
    for kind in _live_buckets:
        for k in list(_live_buckets[kind].keys()):
            if k < cutoff:
                _live_buckets[kind].pop(k, None)

# ----- コース人気ランキング（直近7日） -----
# heartbeat の pull イベント時にコースIDを記録 → 集計
_course_pull_buckets = {}  # course_id -> { ts_min: count }

def _record_course_pull(course_id):
    if not course_id or not isinstance(course_id, str):
        return
    if len(course_id) > 80:
        return
    now_min = int(_time.time() // 60)
    if course_id not in _course_pull_buckets:
        _course_pull_buckets[course_id] = {}
    _course_pull_buckets[course_id][now_min] = _course_pull_buckets[course_id].get(now_min, 0) + 1
    # 7日より古いバケットを削除
    cutoff = now_min - 7 * 24 * 60
    for cid in list(_course_pull_buckets.keys()):
        for k in list(_course_pull_buckets[cid].keys()):
            if k < cutoff:
                _course_pull_buckets[cid].pop(k, None)
        if not _course_pull_buckets[cid]:
            _course_pull_buckets.pop(cid, None)


@app.route("/api/popular-courses", methods=["GET"])
def popular_courses():
    """直近7日のコース別 pull 数で人気ランキング"""
    ranked = []
    for cid, buckets in _course_pull_buckets.items():
        total = sum(buckets.values())
        ranked.append({"course_id": cid, "pulls_7d": total})
    ranked.sort(key=lambda x: -x["pulls_7d"])
    return jsonify({
        "courses": ranked[:10],
        "total_pulls_7d": sum(r["pulls_7d"] for r in ranked),
    })


@app.route("/api/heartbeat", methods=["POST"])
def heartbeat():
    """ユーザーが「いる」ことを匿名で記録（直近30分のアクティブ数集計用）"""
    data = request.get_json(silent=True) or {}
    user_id = (data.get("user_id") or "").strip()[:64]
    event = (data.get("event") or "").strip()  # "tick" | "pull" | "complete"
    now_min = int(_time.time() // _LIVE_BUCKET_SIZE)
    _trim_buckets(now_min)
    if user_id:
        _live_buckets["active"].setdefault(now_min, set()).add(user_id[:32])
    if event == "pull":
        _live_buckets["pulls"][now_min] = _live_buckets["pulls"].get(now_min, 0) + 1
        # course_id があれば人気ランキングにも記録
        course_id = (data.get("course_id") or "").strip()
        if course_id:
            _record_course_pull(course_id)
    elif event == "complete":
        _live_buckets["completes"][now_min] = _live_buckets["completes"].get(now_min, 0) + 1
    return jsonify({"ok": True})


@app.route("/api/live-stats", methods=["GET"])
def live_stats():
    """直近30分のアクティブ数 / pulls / completes を返す（匿名集計）"""
    now_min = int(_time.time() // _LIVE_BUCKET_SIZE)
    _trim_buckets(now_min)
    # active: 直近30分のユニークユーザー数
    all_active = set()
    for s in _live_buckets["active"].values():
        all_active.update(s)
    pulls_30 = sum(_live_buckets["pulls"].values())
    completes_30 = sum(_live_buckets["completes"].values())
    # 直近5分のアクティブ
    cutoff5 = now_min - 5
    active5 = set()
    for k, s in _live_buckets["active"].items():
        if k >= cutoff5:
            active5.update(s)
    return jsonify({
        "active_30min": len(all_active),
        "active_5min": len(active5),
        "pulls_30min": pulls_30,
        "completes_30min": completes_30,
        "ts": int(_time.time()),
    })


# ----- 公開プロフィール（オプトイン・スナップショット） -----
PUBLIC_PROFILE_COLLECTION = "yorimichi_public_profiles"
import secrets as _secrets

@app.route("/api/public-profile", methods=["POST"])
def create_public_profile():
    """ユーザーの実績スナップショットを公開可能なURLとして保存"""
    if not firestore_client:
        return jsonify({"error": "firestore_disabled"}), 503
    data = request.get_json(silent=True) or {}
    user_id = (data.get("user_id") or "").strip()
    if not _validate_user_id(user_id):
        return jsonify({"error": "invalid_user_id"}), 400
    snapshot = data.get("snapshot") or {}
    if not isinstance(snapshot, dict):
        return jsonify({"error": "invalid_snapshot"}), 400

    # 公開しても安全なフィールドだけホワイトリスト
    safe = {
        "display_name": str(snapshot.get("display_name", ""))[:30],
        "level": int(snapshot.get("level") or 0),
        "xp": int(snapshot.get("xp") or 0),
        "completed_courses_count": int(snapshot.get("completed_courses_count") or 0),
        "discovered_courses_count": int(snapshot.get("discovered_courses_count") or 0),
        "total_walk_min": int(snapshot.get("total_walk_min") or 0),
        "login_streak": int(snapshot.get("login_streak") or 0),
        "favorite_area": str(snapshot.get("favorite_area", ""))[:30],
        "badges": [str(b)[:30] for b in (snapshot.get("badges") or [])][:20],
        "completed_course_ids": [str(c)[:80] for c in (snapshot.get("completed_course_ids") or [])][:50],
    }

    # 公開ID（短い・推測困難）
    public_id = _secrets.token_urlsafe(8)
    safe["_owner_user_id"] = user_id
    safe["_created_at"] = firestore.SERVER_TIMESTAMP

    try:
        firestore_client.collection(PUBLIC_PROFILE_COLLECTION).document(public_id).set(safe)
        return jsonify({"public_id": public_id, "url": f"{PRIMARY_ORIGIN}/profile.html?id={public_id}"})
    except Exception as e:
        logger.exception("public profile create failed")
        return jsonify({"error": "firestore_error"}), 502


@app.route("/api/public-profile", methods=["GET"])
def get_public_profile():
    """公開IDからプロフィール取得"""
    if not firestore_client:
        return jsonify({"error": "firestore_disabled"}), 503
    public_id = (request.args.get("id") or "").strip()
    if not public_id or not _re.match(r"^[A-Za-z0-9_-]{8,32}$", public_id):
        return jsonify({"error": "invalid_id"}), 400
    try:
        doc = firestore_client.collection(PUBLIC_PROFILE_COLLECTION).document(public_id).get()
        if not doc.exists:
            return jsonify({"exists": False}), 404
        data = doc.to_dict() or {}
        # _owner_user_id, _created_at は外部に出さない
        owner = data.pop("_owner_user_id", None)
        created = data.pop("_created_at", None)
        return jsonify({
            "exists": True,
            "profile": data,
            "created_at": created.isoformat() if created else None,
        })
    except Exception as e:
        logger.exception("public profile get failed")
        return jsonify({"error": "firestore_error"}), 502


@app.route("/api/delete-user-data", methods=["POST"])
def delete_user_data():
    """ユーザー要求でクラウド側のデータを完全削除（GDPR/個人情報保護法対応）"""
    if not firestore_client:
        return jsonify({"error": "firestore_disabled"}), 503
    data = request.get_json(silent=True) or {}
    user_id = (data.get("user_id") or "").strip()
    if not _validate_user_id(user_id):
        return jsonify({"error": "invalid_user_id"}), 400
    try:
        doc_ref = firestore_client.collection(USER_STATE_COLLECTION).document(user_id)
        doc_ref.delete()
        return jsonify({"ok": True})
    except Exception as e:
        logger.exception("delete failed")
        return jsonify({"error": "firestore_error", "message": str(e)[:200]}), 502


# ----- AI コース生成 -----

NARRATIVE_SYSTEM_PROMPT = """あなたは「街歩きガチャ」というアプリのコース命名・物語生成エンジンです。
入力された **エリア名** と **経由スポット** を使って、心が踊る散歩コースの名前と短い物語を生成します。

【厳守ルール】
1. 出力は JSON のみ（前置き・後書き禁止）
2. **コース名(name)** : 10〜22文字
   - 与えられたエリア名 または スポット名を1つは含めること
   - 「・」「〜」を1〜2個使ってOK、句読点最小限
3. **物語(story)** : 60〜120文字
   - 与えられたスポット名のうち 2件以上 を必ず本文に登場させること
   - 読み手の足取りを誘うトーン（過度な比喩や抽象は避ける）
   - 「お城」「冒険」「秘密の泉」など実在しない要素は禁止
4. 商標・著名人・アニメ作品名は使わない（例: ジブリ・宮崎駿・ポケモン等は禁止）
5. 与えられた情報以外の固有名詞を勝手に追加しない"""


def _generate_narrative_with_ai(theme: str, area: str, stop_names: list, rarity: str) -> dict:
    """Gemini でコース名と物語を生成。503/UNAVAILABLE は最大2回までリトライ。"""
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
        # gemini-2.5-flash-lite は thinking 無し・短い構造化出力に最適
        # gemini-2.5-flash を使う場合は thinking_budget=0 でも余裕を持たせる
        config_kwargs = dict(
            system_instruction=NARRATIVE_SYSTEM_PROMPT,
            temperature=0.95,
            max_output_tokens=2048,
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
        # thinking 機構があるモデル向けに budget=0 を試す
        try:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(thinking_budget=0)
        except Exception:
            pass
        config = genai_types.GenerateContentConfig(**config_kwargs)
        # 503 / UNAVAILABLE は短時間で復旧することが多いのでリトライ
        import time
        last_err = None
        response = None
        for attempt in range(3):
            try:
                response = gemini_client.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=user_prompt,
                    config=config,
                )
                break
            except Exception as e:
                last_err = e
                msg = str(e)
                if "503" in msg or "UNAVAILABLE" in msg or "overloaded" in msg.lower():
                    time.sleep(0.8 * (attempt + 1))
                    continue
                raise
        if response is None:
            raise last_err if last_err else RuntimeError("no response")
        text = (response.text or "").strip()
        # 詳細ログ（debugging用）
        finish_reason = None
        usage = None
        try:
            if response.candidates and len(response.candidates) > 0:
                finish_reason = response.candidates[0].finish_reason
            usage = response.usage_metadata
        except Exception:
            pass
        logger.info(f"Gemini response: len={len(text)} finish={finish_reason} usage={usage} preview={text[:160]!r}")
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


# ----- AI 写真描写（Gemini Vision） -----
# ----- AI スポットガイド（撮影ヒント・豆知識・楽しみ方） -----
# ----- AI ウォークレポート（完走後の振り返り） -----
@app.route("/api/walk-report", methods=["POST"])
def walk_report():
    """完走したコースの情報から、心象風景的な散歩レポートを生成"""
    if not gemini_client:
        return jsonify({"error": "ai_disabled"}), 503
    data = request.get_json(silent=True) or {}
    course_name = (data.get("course_name") or "").strip()[:80]
    area = (data.get("area") or "").strip()[:40]
    visited_stops = data.get("visited_stops") or []
    if not isinstance(visited_stops, list):
        visited_stops = []
    visited_stops = [str(s)[:60] for s in visited_stops][:8]
    duration_min = int(data.get("duration_min") or 0)
    photos_taken = int(data.get("photos_taken") or 0)
    weather_code = data.get("weather_code")
    hour = int(data.get("hour") or 12)

    # 時間帯ヒント
    time_hint = "朝"
    if hour < 5: time_hint = "深夜"
    elif hour < 9: time_hint = "早朝"
    elif hour < 12: time_hint = "午前中"
    elif hour < 15: time_hint = "昼下がり"
    elif hour < 18: time_hint = "夕方"
    else: time_hint = "夜"

    weather_hint = ""
    if isinstance(weather_code, int):
        if weather_code == 0: weather_hint = "・快晴の日"
        elif 1 <= weather_code <= 3: weather_hint = "・曇り空の下"
        elif 51 <= weather_code <= 67: weather_hint = "・雨の中"

    if not course_name or not visited_stops:
        return jsonify({"error": "insufficient_input"}), 400

    prompt = (
        f"あなたは散歩ライター。ユーザーが完走したコースを振り返る、俳句と短い物語を書きます。\n"
        f"\n"
        f"【入力データ - これらは実在の地名・店舗名です。そのまま使ってOKです】\n"
        f"- コース名: {course_name}\n"
        f"- エリア: {area}\n"
        f"- 訪問スポット: {' → '.join(visited_stops)}\n"
        f"- 所要時間: 約{duration_min}分\n"
        f"- 写真撮影: {photos_taken}枚\n"
        f"- 時間帯: {time_hint}{weather_hint}\n"
        f"\n"
        f"【出力する2つの要素】\n"
        f"\n"
        f"1. haiku（俳句）: 五七五（17音）の俳句1句。スポット名や季節感を盛り込む。\n"
        f"   例: 「カヤバ珈琲 湯気の向こうに 桜散る」「夕やけだんだん 猫が見送る 春の暮れ」\n"
        f"\n"
        f"2. essay（物語）: 110-160字の散歩エッセイ。\n"
        f"   - 二人称「あなた」を使う\n"
        f"   - **訪問スポットを最低2件、文中にそのまま登場させる**\n"
        f"     例: 「カヤバ珈琲で一息ついた」「夕やけだんだんの石段を下る」\n"
        f"   - スポット名を勝手に変えたり省略したりしない\n"
        f"\n"
        f"【共通ルール】\n"
        f"- 入力にない固有名詞（実在しない建物・人名）は追加しない\n"
        f"- 商標・著名人・ジブリ・ポケモン等は使わない\n"
        f"- 詩的だが過剰な比喩は避ける\n"
        f"\n"
        f'JSON: {{"haiku": "...", "essay": "..."}}'
    )

    try:
        config_kwargs = dict(
            temperature=0.9,
            max_output_tokens=2048,
            response_mime_type="application/json",
            response_schema=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                required=["haiku", "essay"],
                properties={
                    "haiku": genai_types.Schema(type=genai_types.Type.STRING),
                    "essay": genai_types.Schema(type=genai_types.Type.STRING),
                },
            ),
        )
        try:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(thinking_budget=0)
        except Exception:
            pass
        config = genai_types.GenerateContentConfig(**config_kwargs)
        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=config,
        )
        text = (response.text or "").strip()
        if not text:
            return jsonify({"error": "empty"}), 502
        result = json.loads(text)
        haiku = str(result.get("haiku", ""))[:80]
        essay = str(result.get("essay", ""))[:400]
        # 後方互換: report = haiku + essay の組み合わせ
        report = (f"《{haiku}》\n\n{essay}" if haiku and essay else (haiku or essay))
        return jsonify({"report": report, "haiku": haiku, "essay": essay})
    except Exception as e:
        logger.exception("walk_report failed")
        return jsonify({"error": "server_error"}), 502


@app.route("/api/spot-guide", methods=["POST"])
def spot_guide():
    """スポット名+エリアから「撮るべき写真」「豆知識」「楽しみ方」を3行生成"""
    if not gemini_client:
        return jsonify({"error": "ai_disabled"}), 503
    data = request.get_json(silent=True) or {}
    stop_name = (data.get("stop_name") or "").strip()[:60]
    area = (data.get("area") or "").strip()[:40]
    cat = (data.get("category") or "").strip()[:40]
    if not stop_name:
        return jsonify({"error": "no_stop_name"}), 400

    prompt = (
        f"日本のスポット「{stop_name}」（エリア:{area}・カテゴリ:{cat}）について、"
        "散歩中の人向けに3つの一般的なヒントを生成してください。\n"
        "\n"
        "【重要なルール】\n"
        "1. **特定の固有名詞・年号・歴史的事実は絶対に書かない**（誤情報を防ぐため）\n"
        "2. このカテゴリの場所一般に当てはまる助言だけを書く\n"
        "3. 「五重塔」「茶室」など、ある可能性があるが不明な施設名は書かない\n"
        "4. 「実際に見て確認するのが楽しい」スタンスで記述\n"
        "\n"
        "出力（各行30-50字）:\n"
        "- photo: このスポット周辺で見つけやすい撮影モチーフのヒント（被写体の種類のみ・固有名詞なし）\n"
        "- trivia: このカテゴリの場所を訪れる時の一般的な作法・観点（事実主張なし）\n"
        "- enjoy: 散歩を楽しむ一般的な過ごし方の提案\n"
        "\n"
        "悪い例: 「江戸時代に建てられた五重塔を撮る」（事実主張・固有施設名）\n"
        "良い例: 「鳥居や石灯籠など、神社らしい構造物を見つけて切り取る」\n"
        "\n"
        '商標・著名キャラ・ジブリ等は使わない。\n'
        'JSON: {"photo":"...","trivia":"...","enjoy":"..."}'
    )

    try:
        config_kwargs = dict(
            temperature=0.7,
            max_output_tokens=2048,
            response_mime_type="application/json",
            response_schema=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                required=["photo", "trivia", "enjoy"],
                properties={
                    "photo":  genai_types.Schema(type=genai_types.Type.STRING),
                    "trivia": genai_types.Schema(type=genai_types.Type.STRING),
                    "enjoy":  genai_types.Schema(type=genai_types.Type.STRING),
                },
            ),
        )
        try:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(thinking_budget=0)
        except Exception:
            pass
        config = genai_types.GenerateContentConfig(**config_kwargs)
        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=config,
        )
        text = (response.text or "").strip()
        if not text:
            return jsonify({"error": "empty"}), 502
        result = json.loads(text)
        return jsonify({
            "photo":  str(result.get("photo", ""))[:80],
            "trivia": str(result.get("trivia", ""))[:120],
            "enjoy":  str(result.get("enjoy", ""))[:80],
        })
    except Exception as e:
        logger.exception("spot_guide failed")
        return jsonify({"error": "server_error"}), 502


@app.route("/api/describe-photo", methods=["POST"])
def describe_photo():
    """ユーザーが撮影した写真を Gemini が一文で描写する。"""
    if not gemini_client:
        return jsonify({"error": "ai_disabled", "description": ""}), 503
    data = request.get_json(silent=True) or {}
    image_b64 = (data.get("image") or "").strip()
    stop_name = (data.get("stop_name") or "")[:60]
    area_name = (data.get("area") or "")[:40]
    if not image_b64:
        return jsonify({"error": "no_image"}), 400
    # data:image/jpeg;base64,XXX 形式の場合は剥がす
    if image_b64.startswith("data:"):
        try:
            image_b64 = image_b64.split(",", 1)[1]
        except Exception:
            return jsonify({"error": "bad_data_url"}), 400

    from base64 import b64decode
    try:
        image_bytes = b64decode(image_b64)
    except Exception:
        return jsonify({"error": "bad_base64"}), 400
    if len(image_bytes) > 2_500_000:  # 2.5MB 上限
        return jsonify({"error": "image_too_large"}), 413
    if len(image_bytes) < 200:
        return jsonify({"error": "image_too_small"}), 400

    user_prompt = (
        f"街歩き中の写真です。場所: {stop_name or '街角'}（{area_name or '日本の街'}）。\n"
        "特徴を一文（20〜60文字）で描写してください。固有名詞を勝手に追加せず、"
        "見えるものを具体的に。商標やキャラクター名は使わないでください。\n"
        'JSON で返答: {"description": "..."}'
    )
    try:
        config = genai_types.GenerateContentConfig(
            temperature=0.6,
            max_output_tokens=2048,
            response_mime_type="application/json",
            response_schema=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                required=["description"],
                properties={"description": genai_types.Schema(type=genai_types.Type.STRING)},
            ),
        )
        try:
            config.thinking_config = genai_types.ThinkingConfig(thinking_budget=0)
        except Exception:
            pass

        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[
                genai_types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                user_prompt,
            ],
            config=config,
        )
        text = (response.text or "").strip()
        if not text:
            return jsonify({"error": "empty_response"}), 502
        result = json.loads(text)
        desc = str(result.get("description", ""))[:200]
        return jsonify({"description": desc})
    except Exception as e:
        logger.exception("describe_photo failed")
        return jsonify({"error": "server_error", "message": str(e)[:200]}), 502


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


# ----- エラー収集（軽量・PII保護） -----
# 個人情報を保存しないため、user_id 以外は受け取らない設計
@app.route("/api/errors", methods=["POST"])
def report_error():
    """フロントの未処理エラーをサーバー側ログに残す"""
    data = request.get_json(silent=True) or {}
    user_id = (data.get("user_id") or "anon")[:64]
    msg = (data.get("message") or "")[:500]
    src = (data.get("source") or "")[:200]
    line = data.get("line")
    col = data.get("col")
    stack = (data.get("stack") or "")[:2000]
    ua = (request.headers.get("user-agent") or "")[:200]
    logger.error(
        "client_error user=%s ua=%r msg=%r src=%r line=%s col=%s stack=%r",
        user_id, ua, msg, src, line, col, stack
    )
    return jsonify({"ok": True}), 200


# ----- コース評価 -----
@app.route("/api/course-rating", methods=["POST"])
def course_rating():
    """完走後のユーザー評価（1-5）と任意コメント"""
    data = request.get_json(silent=True) or {}
    user_id = (data.get("user_id") or "anon")[:64]
    course_id = (data.get("course_id") or "")[:80]
    try:
        rating = int(data.get("rating") or 0)
    except Exception:
        rating = 0
    if not (1 <= rating <= 5):
        return jsonify({"error": "invalid_rating"}), 400
    comment = (data.get("comment") or "")[:500]
    duration = data.get("duration_min")
    logger.info(
        "rating user=%s course=%s rating=%d comment=%r dur=%s",
        user_id, course_id, rating, comment, duration
    )
    return jsonify({"ok": True}), 200


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
