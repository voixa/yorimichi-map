"""
Wikipedia REST API（より緩いレート制限）で残りスポットの画像URLを取得。
既存のJSONとマージ。
"""
import sys
import urllib.parse
import urllib.request
import json
import io
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 既に MISS だったもののみ再挑戦（より幅広い検索ワードで）
RETRY_SPOTS = [
    ("中道通り", ["吉祥寺サンロード商店街", "吉祥寺"]),
    ("七井橋通り", ["井の頭恩賜公園"]),
    ("小ざさ", ["小ざさ", "羊羹"]),
    ("さとう (吉祥寺)", ["メンチカツ", "吉祥寺"]),
    ("いせや 総本店", ["焼鳥", "井の頭恩賜公園"]),
    ("ヴィレッジヴァンガード 吉祥寺店", ["ヴィレッジヴァンガード"]),
    ("CHICAGO 吉祥寺店", ["古着"]),
    ("井の頭池（早朝）", ["井の頭恩賜公園"]),
    ("井の頭弁財天", ["井の頭恩賜公園", "弁才天"]),
    ("玉川上水沿いの森", ["玉川上水", "井の頭恩賜公園"]),
    ("夕やけだんだん", ["夕やけだんだん", "谷中"]),
    ("カヤバ珈琲", ["カヤバ珈琲店", "カヤバ珈琲"]),
    ("根津神社", ["根津神社"]),
    ("腰塚", ["和菓子"]),
    ("すずきの惣菜", ["メンチカツ"]),
    ("岡埜栄泉", ["大福"]),
    ("さぼうる", ["神保町"]),
    ("ラドリオ", ["ウィンナーコーヒー"]),
    ("共栄堂", ["カレーライス"]),
    ("ボンディ", ["神田カレー", "カレーライス"]),
    ("雷門", ["雷門"]),
    ("仲見世通り", ["仲見世通り"]),
    ("舟和 本店", ["芋ようかん"]),
    ("浅草寺 本堂", ["浅草寺"]),
    ("雷門（無人）", ["雷門"]),
    ("浅草寺 朝の勤行", ["浅草寺"]),
    ("隅田公園・スカイツリー眺望", ["隅田公園", "東京スカイツリー"]),
]


def fetch_image_rest(title):
    """REST API で記事サマリ＋サムネを取得"""
    url = "https://ja.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title)
    req = urllib.request.Request(url, headers={"User-Agent": "YorimichiMap/0.1 (research)"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
        if data.get("originalimage", {}).get("source"):
            return data["originalimage"]["source"]
        if data.get("thumbnail", {}).get("source"):
            # Upgrade thumbnail to larger size
            return data["thumbnail"]["source"].replace("/200px-", "/800px-").replace("/240px-", "/800px-")
        return None
    except Exception as e:
        sys.stderr.write(f"Error for {title}: {e}\n")
        return None


def main():
    # Load existing
    try:
        with open("scripts/photos.json", "r", encoding="utf-8") as f:
            content = f.read()
        # Find JSON start (skip stderr that may have been mixed in)
        start = content.find('{')
        existing = json.loads(content[start:])
    except Exception:
        existing = {}

    result = dict(existing)
    for display_name, candidates in RETRY_SPOTS:
        if existing.get(display_name):
            continue  # already have it
        photo = None
        used = None
        for cand in candidates:
            photo = fetch_image_rest(cand)
            time.sleep(0.3)
            if photo:
                used = cand
                break
        if photo:
            result[display_name] = {"url": photo, "title": used}
            sys.stderr.write(f"OK   {display_name} <- {used}\n")
        else:
            result[display_name] = None
            sys.stderr.write(f"MISS {display_name}\n")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
