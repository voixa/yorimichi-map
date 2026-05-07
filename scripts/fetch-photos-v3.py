"""
最終: 残りスポットを長い間隔で再取得 + 手動キュレートURL
"""
import sys
import urllib.parse
import urllib.request
import json
import io
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 残った重要スポットを手動キュレート（Wikipedia REST APIで個別取得）
RETRY = [
    ("雷門", "雷門"),
    ("仲見世通り", "仲見世通り"),
    ("舟和 本店", "舟和"),
    ("浅草寺 本堂", "浅草寺"),
    ("雷門（無人）", "雷門"),
    ("浅草寺 朝の勤行", "浅草寺"),
    ("隅田公園・スカイツリー眺望", "隅田公園"),
    ("根津神社", "根津神社"),
    ("カヤバ珈琲", "カヤバ珈琲"),
    ("さぼうる", "さぼうる"),
    ("ラドリオ", "ラドリオ"),
]


def fetch_image_rest(title):
    url = "https://ja.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title)
    req = urllib.request.Request(url, headers={"User-Agent": "MachiarukiGacha/0.1 (research) info@in-dx.jp"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
        if data.get("originalimage", {}).get("source"):
            return data["originalimage"]["source"]
        if data.get("thumbnail", {}).get("source"):
            return data["thumbnail"]["source"].replace("/200px-", "/800px-").replace("/240px-", "/800px-")
        return None
    except Exception as e:
        sys.stderr.write(f"Error for {title}: {e}\n")
        return None


def main():
    with open("scripts/photos-final.json", "r", encoding="utf-8") as f:
        content = f.read()
    start = content.find('{')
    existing = json.loads(content[start:])

    result = dict(existing)
    for display_name, title in RETRY:
        if existing.get(display_name):
            continue
        sys.stderr.write(f"Trying {display_name}...\n")
        photo = fetch_image_rest(title)
        time.sleep(2.5)  # very conservative
        if photo:
            result[display_name] = {"url": photo, "title": title}
            sys.stderr.write(f"OK   {display_name} <- {title}\n")
        else:
            result[display_name] = None
            sys.stderr.write(f"MISS {display_name}\n")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
