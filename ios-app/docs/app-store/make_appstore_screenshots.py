#!/usr/bin/env python3
"""App Store 6.9インチ(1320x2868) キャプション付きスクリーンショット生成。
ふたりのこと(twin-diary-native)の同名スクリプトを yorimichi 用に翻案。
生スクショ(docs/app-store/screenshots/raw-*.png, 1206x2622=6.3")を、
オレンジ系ブランドグラデ背景＋見出しキャプションの 1320x2868 に作り込む。

実行: ~/projects/yorimichi-map/.venv-shots/bin/python docs/app-store/make_appstore_screenshots.py
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC = os.path.expanduser("~/projects/yorimichi-map/ios-app/docs/app-store/screenshots")
OUT = os.path.join(SRC, "appstore-6.9")
os.makedirs(OUT, exist_ok=True)

W, H = 1320, 2868
HEADLINE_FONT = "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc"
SUB_FONT = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"

# yorimichi ブランドグラデ（orange #ff9a4d -> #ff6a2e -> pink #ff4d7a）
STOPS = [(0.0, (255, 154, 77)), (0.5, (255, 106, 46)), (1.0, (255, 77, 122))]


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def grad_color(t):
    for i in range(len(STOPS) - 1):
        t0, c0 = STOPS[i]
        t1, c1 = STOPS[i + 1]
        if t0 <= t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0))
    return STOPS[-1][1]


def gradient_bg():
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        c = grad_color(y / (H - 1))
        for x in range(W):
            px[x, y] = c
    return img


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0], img.size[1]], radius, fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def draw_center(draw, lines, font, y, fill, line_gap):
    for ln in lines:
        bbox = draw.textbbox((0, 0), ln, font=font)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        draw.text(((W - w) / 2, y), ln, font=font, fill=fill)
        y += h + line_gap
    return y


# (raw file, [見出し行], サブ) — App Store ストーリー順
SHOTS = [
    ("raw-01-home.png",   ["今日どこ行く？を、", "10秒で。"],       "ガチャを回すだけで、おでかけ先が決まる"),
    ("raw-04-gacha.png",  ["エリアと時間を選んで、", "回すだけ"],   "近くの“ちょっといい寄り道”が当たる"),
    ("raw-02-result.png", ["王道から、", "隠れ家まで"],             "レア度つきでワクワク。当たりは図鑑へ"),
    ("raw-03-map.png",    ["地図で、", "さんぽを楽しむ"],           "現在地から歩けるコースをすぐ表示"),
    ("raw-05-zukan.png",  ["歩いて集めて、", "制覇する"],           "完走したコースは金の「制覇」に格上げ"),
]

hf = ImageFont.truetype(HEADLINE_FONT, 96)
sf = ImageFont.truetype(SUB_FONT, 48)

for idx, (fname, headline, sub) in enumerate(SHOTS, 1):
    bg = gradient_bg()
    draw = ImageDraw.Draw(bg)

    top_y = 160 if len(headline) > 1 else 220
    y = draw_center(draw, headline, hf, top_y, (255, 255, 255), 16)
    draw_center(draw, [sub], sf, y + 30, (255, 255, 255), 0)

    shot = Image.open(os.path.join(SRC, fname)).convert("RGB")
    avail_h = H - 680 - 80
    scale = avail_h / shot.size[1]
    nw, nh = int(shot.size[0] * scale), int(shot.size[1] * scale)
    shot = shot.resize((nw, nh), Image.LANCZOS)
    shot = rounded(shot, 52)
    sx = (W - nw) // 2
    sy = 680

    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([sx, sy + 20, sx + nw, sy + nh + 20], 52, fill=(0, 0, 0, 95))
    shadow = shadow.filter(ImageFilter.GaussianBlur(30))
    bg = Image.alpha_composite(bg.convert("RGBA"), shadow)
    bg.paste(shot, (sx, sy), shot)

    out_path = os.path.join(OUT, f"{idx:02d}.png")
    bg.convert("RGB").save(out_path, "PNG")
    print(f"  {out_path}  {bg.size}")

print("done ->", OUT)
