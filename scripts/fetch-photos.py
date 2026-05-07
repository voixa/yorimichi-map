"""
Wikipedia API から各スポットの画像URLを取得するスクリプト。
出力：JSON（スポット名 → URL）
"""
import sys
import urllib.parse
import urllib.request
import json
import io
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 検索対象（スポット名と、Wikipedia検索用の代替候補）
SPOTS = [
    # (表示名, Wikipedia検索キーワード候補リスト)
    ("ハーモニカ横丁・小ざさ", ["ハーモニカ横丁 (吉祥寺)", "ハーモニカ横丁"]),
    ("中道通り", ["吉祥寺中道通り", "中道通り (吉祥寺)"]),
    ("七井橋通り", ["七井橋通り"]),
    ("井の頭恩賜公園", ["井の頭恩賜公園", "井の頭公園"]),
    ("小ざさ", ["小ざさ", "小ざさ (和菓子店)"]),
    ("さとう (吉祥寺)", ["さとう (吉祥寺)", "吉祥寺 さとう"]),
    ("いせや 総本店", ["いせや (居酒屋)", "いせや 吉祥寺"]),
    ("ヴィレッジヴァンガード 吉祥寺店", ["ヴィレッジヴァンガード"]),
    ("CHICAGO 吉祥寺店", ["シカゴ (古着店)"]),
    ("井の頭池（早朝）", ["井の頭池", "井の頭恩賜公園"]),
    ("井の頭弁財天", ["井の頭弁財天"]),
    ("玉川上水沿いの森", ["玉川上水", "井の頭恩賜公園"]),
    ("夕やけだんだん", ["夕やけだんだん"]),
    ("カヤバ珈琲", ["カヤバ珈琲"]),
    ("根津神社", ["根津神社"]),
    ("腰塚", ["腰塚 (和菓子店)", "千駄木 腰塚"]),
    ("谷中銀座商店街", ["谷中銀座", "谷中銀座商店街"]),
    ("すずきの惣菜", ["谷中銀座 すずき"]),
    ("岡埜栄泉", ["岡埜栄泉"]),
    ("谷中霊園", ["谷中霊園"]),
    ("観音寺の築地塀", ["観音寺 (台東区)"]),
    ("東京堂書店", ["東京堂書店"]),
    ("さぼうる", ["さぼうる (喫茶店)", "さぼうる"]),
    ("一誠堂書店", ["一誠堂書店"]),
    ("ラドリオ", ["ラドリオ (喫茶店)", "ラドリオ"]),
    ("共栄堂", ["共栄堂 (カレー)"]),
    ("ボンディ", ["欧風カレー ボンディ", "ボンディ (カレー)"]),
    ("雷門", ["雷門"]),
    ("仲見世通り", ["仲見世通り", "浅草仲見世"]),
    ("舟和 本店", ["舟和"]),
    ("浅草寺 本堂", ["浅草寺"]),
    ("雷門（無人）", ["雷門"]),
    ("浅草寺 朝の勤行", ["浅草寺"]),
    ("隅田公園・スカイツリー眺望", ["隅田公園", "東京スカイツリー"]),
]


def fetch_image(title):
    """Wikipedia ページから代表画像 URL を取得する。"""
    url = (
        "https://ja.wikipedia.org/w/api.php"
        "?action=query"
        "&prop=pageimages"
        "&format=json"
        "&pithumbsize=800"
        "&titles=" + urllib.parse.quote(title)
    )
    req = urllib.request.Request(url, headers={"User-Agent": "YorimichiMap/0.1 (research)"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
        pages = data.get("query", {}).get("pages", {})
        for pid, page in pages.items():
            if pid == "-1":
                return None  # ページが存在しない
            thumb = page.get("thumbnail")
            if thumb and "source" in thumb:
                return thumb["source"]
        return None
    except Exception as e:
        sys.stderr.write(f"Error for {title}: {e}\n")
        return None


def main():
    result = {}
    for display_name, candidates in SPOTS:
        photo = None
        used_title = None
        for cand in candidates:
            photo = fetch_image(cand)
            time.sleep(0.6)  # rate limit avoidance
            if photo:
                used_title = cand
                break
        if photo:
            result[display_name] = {"url": photo, "title": used_title}
            sys.stderr.write(f"OK   {display_name} <- {used_title}\n")
        else:
            result[display_name] = None
            sys.stderr.write(f"MISS {display_name}\n")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
