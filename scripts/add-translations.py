"""
courses.js に英訳フィールド (_en) を一括追加。
"""
import re
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Course-level translations (id -> {name_en, description_en})
COURSE_TR = {
    'kichijoji_park': {
        'name_en': 'Kichijoji Classic: Parks & Hidden Alleys',
        'description_en': "Experience why Kichijoji is Tokyo's most-loved neighborhood. From the retro Showa-era Harmonica Yokocho alleys to the swan boats of Inokashira Park.",
    },
    'kichijoji_food': {
        'name_en': 'Kichijoji Old Gourmet: Walking & Tasting',
        'description_en': 'Menchi-katsu, yakitori, traditional sweets. Walk through Kichijoji food culture loved by locals for generations.',
    },
    'kichijoji_subculture': {
        'name_en': 'Kichijoji Vintage & Subculture',
        'description_en': 'Browse unique vintage stores, used record shops, and subculture landmarks. Find your treasure in the alleys.',
    },
    'kichijoji_night': {
        'name_en': 'Kichijoji Bar Hopping by Night',
        'description_en': "Start at Harmonica Yokocho, end at a hidden alley bar. The local-only nightlife of Kichijoji.",
    },
    'kichijoji_rainy': {
        'name_en': 'Kichijoji Indoor Rainy-Day Course',
        'description_en': 'Department stores, bookshops, cafes, record stores. Enjoy Kichijoji indoor culture even when it rains.',
    },
    'kichijoji_dawn': {
        'name_en': '[Limited] Misty Inokashira & Forbidden Benten Shrine',
        'description_en': 'A legendary course only available 5:30am onwards. The misty Inokashira pond, the Benten shrine with break-up legend, and the Ghibli world.',
    },
    'yanesen_classic': {
        'name_en': "Yanesen Classic: Sunset Steps & Cat Town",
        'description_en': "The famous old-town atmosphere of Tokyo. Cats at Yuyake-Dandan steps, the thousand torii of Nezu Shrine, and old-school cafes.",
    },
    'yanesen_food': {
        'name_en': 'Yanesen Street Food: Fried & Fresh',
        'description_en': 'Croquettes, niku-man, menchi-katsu. The food paradise of Yanaka Ginza shopping street, with oil-stained paper as your medal.',
    },
    'yanesen_temples': {
        'name_en': 'Yanesen Temples & Cat Alleys',
        'description_en': 'Yanaka cemetery, the historic temple alleys, and a quiet morning walk. A peaceful course tracing cats and shrines.',
    },
    'jimbocho_books': {
        'name_en': 'Jimbocho Used Book Streets',
        'description_en': "World's largest used book district. Walk through 100+ shops, with retro coffee houses to rest.",
    },
    'jimbocho_curry': {
        'name_en': 'Jimbocho Curry Street',
        'description_en': "Jimbocho is secretly Tokyo's curry capital. Hop between historic curry shops hidden among the bookstores.",
    },
    'asakusa_classic': {
        'name_en': 'Asakusa: Kaminarimon, Nakamise, Sensoji',
        'description_en': 'From the giant lantern of Kaminarimon, through the Nakamise food street, to the main hall of Sensoji. Old Tokyo and Japanese culture in one walk.',
    },
    'asakusa_hidden': {
        'name_en': '[Limited] Dawn at Sensoji & Sumida River',
        'description_en': "5:00am Asakusa with no tourists. The empty Kaminarimon, monks' morning chant, and Sumida riverside view of Skytree. Once-in-a-lifetime experience.",
    },
}

# Area-level translations - already in courses.js areaName_en, but ensure courses too
AREA_TR = {
    '吉祥寺': 'Kichijoji',
    '谷中・根津・千駄木': 'Yanaka, Nezu & Sendagi',
    '神田・神保町': 'Kanda & Jimbocho',
    '浅草': 'Asakusa',
}

# Selected stop translations
STOP_TR = {
    'ハーモニカ横丁': 'Harmonica Yokocho',
    '小ざさ': 'Kosasa (Yokan Shop)',
    '中道通り': 'Nakamichi Street',
    '井の頭恩賜公園': 'Inokashira Park',
    'さとう (吉祥寺)': 'Sato Kichijoji',
    'いせや 総本店': 'Iseya Honten (Yakitori)',
    'ヴィレッジヴァンガード 吉祥寺店': 'Village Vanguard Kichijoji',
    'CHICAGO 吉祥寺店': 'CHICAGO Kichijoji',
    'スパイラル レコード': 'Spiral Records',
    'ハーモニカ横丁（夜）': 'Harmonica Yokocho (Night)',
    'いせや 公園口': 'Iseya Park Entrance',
    '中道通りの隠れ家バー': 'Hidden Bar on Nakamichi Street',
    'アトレ吉祥寺': 'Atre Kichijoji',
    '井の頭池（早朝）': 'Inokashira Pond (Dawn)',
    '井の頭弁財天': 'Inokashira Benzaiten Shrine',
    'カフェ どんぐり山': 'Cafe Donguri-yama',
    '三鷹の森ジブリ美術館': 'Ghibli Museum, Mitaka',
    '夕やけだんだん': 'Yuyake Dandan (Sunset Steps)',
    'カヤバ珈琲': 'Kayaba Coffee',
    '根津神社': 'Nezu Shrine',
    '腰塚': 'Koshizuka (Wagashi)',
    '谷中銀座商店街': 'Yanaka Ginza Shopping Street',
    'すずきの惣菜': 'Suzuki no Sozai (Menchi)',
    '岡埜栄泉': 'Okano Eisen',
    '谷中霊園': 'Yanaka Cemetery',
    '観音寺の築地塀': 'Kannon-ji Earthen Wall',
    'カフェ ねんねこ家': 'Cafe Nennekoya',
    '東京堂書店': 'Tokyodo Bookstore',
    'さぼうる': 'Saboru (Coffee)',
    '一誠堂書店': 'Issendo Bookstore',
    'ラドリオ': 'Ladrio (Coffee)',
    '共栄堂': 'Kyoeido (Sumatra Curry)',
    'ボンディ': 'Bondy (European Curry)',
    '神田カレーグランプリ巡礼': 'Kanda Curry Grand Prix Tour',
    '雷門': 'Kaminarimon',
    '仲見世通り': 'Nakamise Shopping Street',
    '舟和 本店': 'Funawa Main Store',
    '浅草寺 本堂': 'Sensoji Main Hall',
    '雷門（無人）': 'Kaminarimon (No Crowd)',
    '浅草寺 朝の勤行': 'Sensoji Morning Service',
    '隅田公園・スカイツリー眺望': 'Sumida Park & Skytree View',
}


def add_course_translations(content):
    for course_id, tr in COURSE_TR.items():
        # Find the course block
        pattern = re.compile(
            r"(id:\s*'" + course_id + r"',\s*\n\s*name:\s*'[^']+',)",
            re.DOTALL
        )
        replacement = r"\1\n    name_en: " + repr(tr['name_en'])
        content = pattern.sub(replacement, content)

        # Add description_en after description
        pattern_desc = re.compile(
            r"(id:\s*'" + course_id + r"',[^}]*?description:\s*'[^']+',)",
            re.DOTALL
        )
        replacement_desc = r"\1\n    description_en: " + repr(tr['description_en']) + ","
        content = pattern_desc.sub(replacement_desc, content)

        # Add areaName_en if missing
        area_jp = re.search(r"id:\s*'" + course_id + r"',[^}]*?areaName:\s*'([^']+)'", content, re.DOTALL)
        if area_jp:
            jp = area_jp.group(1)
            en = AREA_TR.get(jp)
            if en and ('areaName_en' not in content[area_jp.start():area_jp.end()+200]):
                pattern_area = re.compile(
                    r"(id:\s*'" + course_id + r"',[^}]*?areaName:\s*'" + re.escape(jp) + r"',)",
                    re.DOTALL
                )
                replacement_area = r"\1\n    areaName_en: " + repr(en) + ","
                content = pattern_area.sub(replacement_area, content)
    return content


def add_stop_translations(content):
    for jp, en in STOP_TR.items():
        # Match: name: '<jp>',
        pattern = re.compile(
            r"name:\s*'" + re.escape(jp) + r"',",
        )
        replacement = "name: '" + jp + "', name_en: " + repr(en) + ","
        content = pattern.sub(replacement, content)
    return content


def main():
    with open('courses.js', encoding='utf-8') as f:
        content = f.read()
    content = add_course_translations(content)
    content = add_stop_translations(content)
    with open('courses.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Translation injection complete.')


if __name__ == '__main__':
    main()
