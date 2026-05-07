/* ============================================================
 * Yorimichi Map — Curated Courses
 * ------------------------------------------------------------
 * Hand-picked walking courses by area.
 * Each stop has: name, lat, lng, cat, emoji, desc
 *                + photo, bestTime, budget, tags
 * ============================================================ */

window.YORIMICHI_COURSES = [

  // ============== 吉祥寺エリア ==============

  {
    id: 'kichijoji_park',
    name: '吉祥寺 王道・公園と路地裏散歩',    name_en: 'Kichijoji Classic: Parks & Hidden Alleys',
    area: 'kichijoji',
    areaName: '吉祥寺',
    areaName_en: 'Kichijoji',
    areaIcon: '🌳',
    themeIcon: '🌿',
    rarity: 'sr',
    description: '住みたい街No.1の魅力を体感する定番コース。ハーモニカ横丁の昭和情緒から井の頭公園のスワンボートまで、吉祥寺らしさをまるごと味わえます。',
    description_en: "Experience why Kichijoji is Tokyo's most-loved neighborhood. From the retro Showa-era Harmonica Yokocho alleys to the swan boats of Inokashira Park.",
    description_en: 'Experience why Kichijoji is Tokyo\'s most-loved neighborhood. From the retro Showa-era Harmonica Yokocho alleys to the swan boats of Inokashira Park.',
    travelMode: 'walk',
    estimatedMin: 75,
    budget: '¥1,500-3,000',
    tags: ['初めての吉祥寺', '雨でもOK', '定番'],
    origin: { lat: 35.7029, lng: 139.5800, name: '吉祥寺駅 北口', shortLabel: '吉祥寺駅 北口' },
    dest:   { lat: 35.7008, lng: 139.5710, name: '井の頭恩賜公園', name_en: 'Inokashira Park', shortLabel: '井の頭恩賜公園' },
    stops: [
      {
        lat: 35.7038, lng: 139.5800, name: 'ハーモニカ横丁・小ざさ', cat: 'sweets', emoji: '🍶',
        photoBg: 'linear-gradient(135deg, #ff7e3d 0%, #d50000 100%)',
        bestTime: '11:00-22:00', budget: '¥500-2,000', stayMin: 30,
        tags: ['昭和レトロ', '路地', '幻の羊羹'],
        desc: '昭和の闇市の名残ハーモニカ横丁の入口。「小ざさ」の幻の羊羹は早朝6時から行列。100軒以上の小店をハシゴ。'
      },
      {
        lat: 35.7048, lng: 139.5775, name: '中道通り', name_en: 'Nakamichi Street', cat: 'cafe', emoji: '☕',
        photoBg: 'linear-gradient(135deg, #6d4c41 0%, #3e2723 100%)',
        bestTime: '11:00-18:00', budget: '¥1,000-3,000', stayMin: 25,
        tags: ['散策', '雑貨', 'カフェ'],
        desc: '個人店が並ぶ吉祥寺らしい裏通り。雑貨・古着・カフェが詰まっています。'
      },
      {
        lat: 35.7022, lng: 139.5750, name: '七井橋通り', cat: 'sweets', emoji: '🍰',
        photoBg: 'linear-gradient(135deg, #ffd54f 0%, #ff9800 100%)',
        bestTime: '11:00-19:00', budget: '¥500-1,500', stayMin: 20,
        tags: ['食べ歩き', '商店街'],
        desc: '駅から井の頭公園へ続く下り坂の商店街。テイクアウトグルメを片手に公園へ。'
      },
      {
        lat: 35.7008, lng: 139.5710, name: '井の頭恩賜公園', name_en: 'Inokashira Park', cat: 'park', emoji: '🌳',
        photoBg: 'linear-gradient(135deg, #66bb6a 0%, #2e7d32 100%)',
        bestTime: '10:00-16:00', budget: '無料', stayMin: 60,
        tags: ['公園', 'デート', 'ピクニック', 'スワンボート'],
        desc: 'スワンボートと桜並木。週末は大道芸人で賑わいます。'
      },
    ]
  },

  {
    id: 'kichijoji_food',
    name: '吉祥寺 老舗グルメ食べ歩き',
    name_en: 'Kichijoji Old Gourmet: Walking & Tasting',
    area: 'kichijoji',
    areaName: '吉祥寺',
    areaName_en: 'Kichijoji',
    areaIcon: '🌳',
    themeIcon: '🍴',
    rarity: 'r',
    description: 'メンチカツ、焼き鳥、和菓子。地元民が愛し続ける老舗の名物を食べ歩く、吉祥寺の食文化満喫コース。',
    description_en: 'Menchi-katsu, yakitori, traditional sweets. Walk through Kichijoji food culture loved by locals for generations.',
    travelMode: 'walk',
    estimatedMin: 50,
    budget: '¥1,500-2,500',
    tags: ['食べ歩き', '老舗', '名物'],
    origin: { lat: 35.7029, lng: 139.5800, name: '吉祥寺駅 北口', shortLabel: '吉祥寺駅 北口' },
    dest:   { lat: 35.7012, lng: 139.5755, name: '井の頭公園口', shortLabel: '井の頭公園口' },
    stops: [
      {
        lat: 35.7040, lng: 139.5800, name: 'さとう (吉祥寺)', name_en: 'Sato Kichijoji', cat: 'sweets', emoji: '🥩',
        photoBg: 'linear-gradient(135deg, #d84315 0%, #6d4c41 100%)',
        bestTime: '10:00-19:00', budget: '¥200-500', stayMin: 15,
        tags: ['行列', '名物メンチ', '500円以下'],
        desc: '行列必至の名物・元祖丸メンチカツ（200円）。テレビでもおなじみ。'
      },
      {
        lat: 35.7036, lng: 139.5793, name: '小ざさ', name_en: 'Kosasa (Yokan Shop)', cat: 'sweets', emoji: '🍡',
        photoBg: 'linear-gradient(135deg, #d4af37 0%, #ff9800 100%)',
        bestTime: '6:00-9:00', budget: '¥600-1,500', stayMin: 5,
        tags: ['早朝向け', '幻の名物'],
        desc: '一日150本限定の幻の羊羹。最中は午後の楽しみに。'
      },
      {
        lat: 35.7012, lng: 139.5755, name: 'いせや 総本店', name_en: 'Iseya Honten (Yakitori)', cat: 'cafe', emoji: '🍢',
        photoBg: 'linear-gradient(135deg, #c62828 0%, #8d6e63 100%)',
        bestTime: '12:00-22:00', budget: '¥1,000-2,500', stayMin: 45,
        tags: ['焼き鳥', '老舗', '昼飲み'],
        desc: '創業90年の焼き鳥屋。井の頭公園口の煙にひかれて自然と足が向く。'
      },
    ]
  },

  {
    id: 'kichijoji_subculture',
    name: '吉祥寺 古着とサブカル巡り',
    name_en: 'Kichijoji Vintage & Subculture',
    area: 'kichijoji',
    areaName: '吉祥寺',
    areaName_en: 'Kichijoji',
    areaIcon: '🌳',
    themeIcon: '🎭',
    rarity: 'r',
    description: '個性的な古着屋と中古レコード店、サブカル名所を巡る吉祥寺らしい一日。掘り出し物との出会いを楽しんで。',
    description_en: 'Browse unique vintage stores, used record shops, and subculture landmarks. Find your treasure in the alleys.',
    travelMode: 'walk',
    estimatedMin: 80,
    budget: '¥3,000-10,000',
    tags: ['古着', 'サブカル', '掘り出し物'],
    origin: { lat: 35.7029, lng: 139.5800, name: '吉祥寺駅 北口', shortLabel: '吉祥寺駅 北口' },
    dest:   { lat: 35.7034, lng: 139.5793, name: '吉祥寺駅', shortLabel: '吉祥寺駅' },
    stops: [
      {
        lat: 35.7036, lng: 139.5805, name: 'ヴィレッジヴァンガード 吉祥寺店', name_en: 'Village Vanguard Kichijoji', cat: 'bookstore', emoji: '📚',
        photoBg: 'linear-gradient(135deg, #6a1b9a 0%, #ad1457 100%)',
        bestTime: '11:00-22:00', budget: '¥500-3,000', stayMin: 30,
        tags: ['雑貨', 'サブカル', '本'],
        desc: '本とサブカルグッズが詰まった「遊べる本屋」の代表的店舗。'
      },
      {
        lat: 35.7042, lng: 139.5783, name: 'CHICAGO 吉祥寺店', name_en: 'CHICAGO Kichijoji', cat: 'art', emoji: '👕',
        photoBg: 'linear-gradient(135deg, #1565c0 0%, #6a1b9a 100%)',
        bestTime: '11:00-20:00', budget: '¥1,000-5,000', stayMin: 25,
        tags: ['古着', 'アメカジ', 'リーズナブル'],
        desc: '古着とアメカジの定番店。掘り出し物が多く、リーズナブル。'
      },
      {
        lat: 35.7050, lng: 139.5790, name: 'スパイラル レコード', name_en: 'Spiral Records', cat: 'art', emoji: '💿',
        photoBg: 'linear-gradient(135deg, #424242 0%, #1565c0 100%)',
        bestTime: '13:00-20:00', budget: '¥800-5,000', stayMin: 30,
        tags: ['レコード', 'ジャズ', '試聴可'],
        desc: 'ジャズ・ソウル中心の名物中古レコード店。試聴できる店内。'
      },
      {
        lat: 35.7045, lng: 139.5780, name: '中道通り', name_en: 'Nakamichi Street', cat: 'cafe', emoji: '☕',
        photoBg: 'linear-gradient(135deg, #6d4c41 0%, #3e2723 100%)',
        bestTime: '11:00-18:00', budget: '¥1,000-3,000', stayMin: 25,
        tags: ['散策', '雑貨', 'カフェ'],
        desc: '個性派ショップと古民家カフェが並ぶ路地。雑貨屋巡りも楽しい。'
      },
    ]
  },

  {
    id: 'kichijoji_night',
    name: '吉祥寺 夜のハシゴ酒コース',
    name_en: 'Kichijoji Bar Hopping by Night',
    area: 'kichijoji',
    areaName: '吉祥寺',
    areaName_en: 'Kichijoji',
    areaIcon: '🌳',
    themeIcon: '🍻',
    rarity: 'sr',
    description: 'ハーモニカ横丁から始まり、隠れ家バーで夜更けまで。地元民しか知らない夜の吉祥寺。',
    description_en: 'Start at Harmonica Yokocho, end at a hidden alley bar. The local-only nightlife of Kichijoji.',
    travelMode: 'walk',
    estimatedMin: 180,
    budget: '¥4,000-8,000',
    tags: ['夜飲み', 'ハシゴ', '大人'],
    origin: { lat: 35.7029, lng: 139.5800, name: '吉祥寺駅 北口', shortLabel: '吉祥寺駅 北口' },
    dest:   { lat: 35.7029, lng: 139.5800, name: '吉祥寺駅 北口', shortLabel: '吉祥寺駅 北口' },
    stops: [
      {
        lat: 35.7038, lng: 139.5798, name: 'ハーモニカ横丁（夜）', name_en: 'Harmonica Yokocho (Night)', cat: 'sweets', emoji: '🍶',
        photoBg: 'linear-gradient(135deg, #ff5252 0%, #6a1b9a 100%)',
        bestTime: '17:00-20:00', budget: '¥1,500-3,000', stayMin: 60,
        tags: ['立ち飲み', '昭和'],
        desc: '夕方からハシゴ酒のスタート地点。1軒目はサクッと立ち飲みで。'
      },
      {
        lat: 35.7012, lng: 139.5755, name: 'いせや 公園口', name_en: 'Iseya Park Entrance', cat: 'cafe', emoji: '🍢',
        photoBg: 'linear-gradient(135deg, #c62828 0%, #1a1a1a 100%)',
        bestTime: '18:00-22:00', budget: '¥1,500-2,500', stayMin: 60,
        tags: ['焼き鳥', '老舗'],
        desc: '夜の井の頭公園の煙の香り。2軒目は焼き鳥で腹ごしらえ。'
      },
      {
        lat: 35.7045, lng: 139.5780, name: '中道通りの隠れ家バー', name_en: 'Hidden Bar on Nakamichi Street', cat: 'cafe', emoji: '🥃',
        photoBg: 'linear-gradient(135deg, #1a1a1a 0%, #4a148c 100%)',
        bestTime: '21:00-26:00', budget: '¥2,000-4,000', stayMin: 60,
        tags: ['バー', '深夜', 'ウイスキー'],
        desc: '中道通り裏の隠れ家。締めにウイスキーを一杯。'
      },
    ]
  },

  {
    id: 'kichijoji_rainy',
    name: '吉祥寺 雨の日でも楽しめる屋内コース',
    name_en: 'Kichijoji Indoor Rainy-Day Course',
    area: 'kichijoji',
    areaName: '吉祥寺',
    areaName_en: 'Kichijoji',
    areaIcon: '🌳',
    themeIcon: '☔',
    rarity: 'r',
    description: 'デパート、本屋、カフェ、レコード店。雨の日こそ吉祥寺の屋内文化を満喫。',
    description_en: 'Department stores, bookshops, cafes, record stores. Enjoy Kichijoji indoor culture even when it rains.',
    travelMode: 'walk',
    estimatedMin: 100,
    budget: '¥2,000-5,000',
    tags: ['雨でもOK', '屋内', 'のんびり'],
    origin: { lat: 35.7029, lng: 139.5800, name: '吉祥寺駅 アトレ', shortLabel: '吉祥寺駅 アトレ' },
    dest:   { lat: 35.7036, lng: 139.5805, name: '吉祥寺駅', shortLabel: '吉祥寺駅' },
    stops: [
      {
        lat: 35.7029, lng: 139.5800, name: 'アトレ吉祥寺', name_en: 'Atre Kichijoji', cat: 'cafe', emoji: '🛍',
        photoBg: 'linear-gradient(135deg, #6a1b9a 0%, #ec407a 100%)',
        bestTime: '10:00-21:00', budget: '¥500-3,000', stayMin: 30,
        tags: ['駅直結', '雨OK'],
        desc: '駅直結の駅ビル。地下のスイーツ街は雨の日でも満員。'
      },
      {
        lat: 35.7036, lng: 139.5805, name: 'ヴィレッジヴァンガード 吉祥寺店', name_en: 'Village Vanguard Kichijoji', cat: 'bookstore', emoji: '📚',
        photoBg: 'linear-gradient(135deg, #6a1b9a 0%, #ad1457 100%)',
        bestTime: '11:00-22:00', budget: '¥500-3,000', stayMin: 30,
        tags: ['雑貨', '本'],
        desc: '時間を忘れて本とサブカルグッズを物色。'
      },
      {
        lat: 35.7050, lng: 139.5790, name: 'スパイラル レコード', name_en: 'Spiral Records', cat: 'art', emoji: '💿',
        photoBg: 'linear-gradient(135deg, #424242 0%, #1565c0 100%)',
        bestTime: '13:00-20:00', budget: '¥800-5,000', stayMin: 30,
        tags: ['レコード', '試聴可'],
        desc: '雨音を聴きながらジャズのレコードを試聴。'
      },
    ]
  },

  {
    id: 'kichijoji_dawn',
    name: '【限定】霧の井の頭・早朝禁忌の弁天さま',
    name_en: '[Limited] Misty Inokashira & Forbidden Benten Shrine',
    area: 'kichijoji',
    areaName: '吉祥寺',
    areaName_en: 'Kichijoji',
    areaIcon: '🌳',
    themeIcon: '🌅',
    rarity: 'legendary',
    description: '早朝5:30〜のみ味わえる伝説のコース。霧に包まれる井の頭池、デート禁忌の伝承を持つ弁財天、玉川上水沿いの森。観光客が眠る時間に歩く特別な吉祥寺。',
    description_en: 'A legendary course only available 5:30am onwards. The misty Inokashira pond, the Benten shrine with break-up legend, and the forested Tamagawa-josui canal.',
    travelMode: 'walk',
    estimatedMin: 100,
    budget: '¥1,500-3,000（一部施設は事前予約制）',
    tags: ['早朝限定', 'パワースポット', '上級者向け'],
    origin: { lat: 35.7029, lng: 139.5800, name: '吉祥寺駅 公園口', shortLabel: '吉祥寺駅 公園口' },
    dest:   { lat: 35.6975, lng: 139.5740, name: '三鷹の森公園周辺', shortLabel: '三鷹の森公園周辺' },
    stops: [
      {
        lat: 35.7008, lng: 139.5710, name: '井の頭池（早朝）', name_en: 'Inokashira Pond (Dawn)', cat: 'viewpoint', emoji: '🌅',
        photoBg: 'linear-gradient(135deg, #ff8a65 0%, #ffa726 50%, #4fc3f7 100%)',
        bestTime: '5:30-7:00', budget: '無料', stayMin: 20,
        tags: ['早朝限定', '霧', '写真映え'],
        desc: '早朝のみ見られる霧と水面。鴨の親子に出会えることも。'
      },
      {
        lat: 35.6996, lng: 139.5704, name: '井の頭弁財天', name_en: 'Inokashira Benzaiten Shrine', cat: 'shrine', emoji: '⛩️',
        photoBg: 'linear-gradient(135deg, #c2185b 0%, #6a1b9a 100%)',
        bestTime: '6:00-9:00', budget: '無料', stayMin: 15,
        tags: ['パワースポット', '伝承'],
        desc: '関東屈指の弁天様。「カップルで来ると別れる」伝承で有名。'
      },
      {
        lat: 35.7001, lng: 139.5710, name: 'カフェ どんぐり山', name_en: 'Cafe Donguri-yama', cat: 'cafe', emoji: '☕',
        photoBg: 'linear-gradient(135deg, #6d4c41 0%, #4caf50 100%)',
        bestTime: '8:00-17:00', budget: '¥600-1,500', stayMin: 30,
        tags: ['公園内', '隠れ家', '木洩れ日'],
        desc: '公園内の隠れた名カフェ。木洩れ日とコーヒーで一息。'
      },
      {
        lat: 35.6975, lng: 139.5740, name: '玉川上水沿いの森', name_en: 'Tamagawa-josui Canal Forest', cat: 'viewpoint', emoji: '🌳',
        photoBg: 'linear-gradient(135deg, #66bb6a 0%, #1565c0 100%)',
        bestTime: '8:00-17:00', budget: '無料', stayMin: 30,
        tags: ['緑陰', '小鳥', '散策路'],
        desc: '木漏れ日の射す散策路。玉川上水沿いの静かな森を歩く。',
        desc_en: 'A peaceful forest path along the Tamagawa-josui canal with dappled sunlight.'
      },
    ]
  },

  // ============== 谷根千エリア ==============

  {
    id: 'yanesen_classic',
    name: '谷根千 下町情緒・夕やけだんだんコース',
    name_en: 'Yanesen Classic: Sunset Steps & Cat Town',
    area: 'yanesen',
    areaName: '谷中・根津・千駄木',
    areaName_en: 'Yanaka, Nezu & Sendagi',
    areaIcon: '🏮',
    themeIcon: '🐈',
    rarity: 'sr',
    description: '昭和の下町情緒を残す人気エリア。猫に出会える「夕やけだんだん」、千本鳥居の根津神社、老舗カフェまで。',
    description_en: 'The famous old-town atmosphere of Tokyo. Cats at Yuyake-Dandan steps, the thousand torii of Nezu Shrine, and old-school cafes.',
    travelMode: 'walk',
    estimatedMin: 90,
    budget: '¥1,500-3,000',
    tags: ['下町', '猫', '寺社', '定番'],
    origin: { lat: 35.7281, lng: 139.7711, name: '日暮里駅 西口', shortLabel: '日暮里駅 西口' },
    dest:   { lat: 35.7281, lng: 139.7622, name: '千駄木駅', shortLabel: '千駄木駅' },
    stops: [
      {
        lat: 35.7271, lng: 139.7700, name: '夕やけだんだん', name_en: 'Yuyake Dandan (Sunset Steps)', cat: 'viewpoint', emoji: '🌅',
        photoBg: 'linear-gradient(135deg, #ff8a65 0%, #d84315 100%)',
        bestTime: '16:00-18:00', budget: '無料', stayMin: 15,
        tags: ['猫', '夕日', '写真映え'],
        desc: '猫が集まる夕日の階段。富士見の名所で写真映え抜群。'
      },
      {
        lat: 35.7253, lng: 139.7634, name: 'カヤバ珈琲', name_en: 'Kayaba Coffee', cat: 'cafe', emoji: '☕',
        photoBg: 'linear-gradient(135deg, #6d4c41 0%, #3e2723 100%)',
        bestTime: '8:00-18:00', budget: '¥800-1,500', stayMin: 45,
        tags: ['古民家', '老舗', '玉子サンド'],
        desc: '築100年の古民家を改装した名物喫茶。玉子サンドが看板メニュー。'
      },
      {
        lat: 35.7203, lng: 139.7613, name: '根津神社', name_en: 'Nezu Shrine', cat: 'shrine', emoji: '⛩️',
        photoBg: 'linear-gradient(135deg, #c62828 0%, #b71c1c 100%)',
        bestTime: '9:00-17:00', budget: '無料', stayMin: 30,
        tags: ['千本鳥居', 'つつじ', 'パワースポット'],
        desc: '徳川綱吉ゆかりの古社。乙女稲荷の千本鳥居が圧巻。'
      },
      {
        lat: 35.7257, lng: 139.7611, name: '腰塚', name_en: 'Koshizuka (Wagashi)', cat: 'sweets', emoji: '🍡',
        photoBg: 'linear-gradient(135deg, #d4af37 0%, #ff9800 100%)',
        bestTime: '10:00-18:00', budget: '¥300-800', stayMin: 15,
        tags: ['和菓子', '老舗', 'お土産'],
        desc: '昭和10年創業の老舗和菓子店。手土産にも人気。'
      },
    ]
  },

  {
    id: 'yanesen_food',
    name: '谷根千 食べ歩き・揚げたて惣菜の旅',
    name_en: 'Yanesen Street Food: Fried & Fresh',
    area: 'yanesen',
    areaName: '谷中・根津・千駄木',
    areaName_en: 'Yanaka, Nezu & Sendagi',
    areaIcon: '🏮',
    themeIcon: '🍴',
    rarity: 'r',
    description: 'コロッケ、肉まん、メンチ。谷中銀座の食べ歩きパラダイス。手に提げた揚げ物の油の跡が勲章。',
    description_en: 'Croquettes, niku-man, menchi-katsu. The food paradise of Yanaka Ginza shopping street, with oil-stained paper as your medal.',
    travelMode: 'walk',
    estimatedMin: 60,
    budget: '¥1,000-2,000',
    tags: ['食べ歩き', '商店街', '揚げ物'],
    origin: { lat: 35.7281, lng: 139.7711, name: '日暮里駅 西口', shortLabel: '日暮里駅 西口' },
    dest:   { lat: 35.7271, lng: 139.7700, name: '夕やけだんだん', name_en: 'Yuyake Dandan (Sunset Steps)', shortLabel: '夕やけだんだん' },
    stops: [
      {
        lat: 35.7268, lng: 139.7693, name: '谷中銀座商店街', name_en: 'Yanaka Ginza Shopping Street', cat: 'sweets', emoji: '🍢',
        photoBg: 'linear-gradient(135deg, #d84315 0%, #6d4c41 100%)',
        bestTime: '11:00-18:00', budget: '¥500-1,500', stayMin: 60,
        tags: ['商店街', '食べ歩き', '昭和'],
        desc: '夕やけだんだんから続く下町商店街。食べ歩きの聖地。'
      },
      {
        lat: 35.7270, lng: 139.7691, name: 'すずきの惣菜', name_en: 'Suzuki no Sozai (Menchi)', cat: 'sweets', emoji: '🥩',
        photoBg: 'linear-gradient(135deg, #d84315 0%, #ff9800 100%)',
        bestTime: '11:00-19:00', budget: '¥100-500', stayMin: 10,
        tags: ['揚げ物', '元祖', '行列'],
        desc: '元祖メンチカツ。揚げたてを紙に包んで食べ歩く。'
      },
      {
        lat: 35.7269, lng: 139.7695, name: '岡埜栄泉', name_en: 'Okano Eisen', cat: 'sweets', emoji: '🍡',
        photoBg: 'linear-gradient(135deg, #d4af37 0%, #6d4c41 100%)',
        bestTime: '10:00-18:00', budget: '¥300-1,000', stayMin: 15,
        tags: ['和菓子', '老舗', '豆大福'],
        desc: '創業120年。看板の豆大福は売り切れ必至。'
      },
    ]
  },

  {
    id: 'yanesen_temples',
    name: '谷根千 古寺と猫の路地巡り',
    name_en: 'Yanesen Temples & Cat Alleys',
    area: 'yanesen',
    areaName: '谷中・根津・千駄木',
    areaName_en: 'Yanaka, Nezu & Sendagi',
    areaIcon: '🏮',
    themeIcon: '🏯',
    rarity: 'sr',
    description: '谷中霊園、寺町の路地、ノスタルジックな朝の散歩。猫と寺社を辿る静かなコース。',
    description_en: 'Yanaka cemetery, the historic temple alleys, and a quiet morning walk. A peaceful course tracing cats and shrines.',
    travelMode: 'walk',
    estimatedMin: 110,
    budget: '¥500-1,500',
    tags: ['寺社', '猫', '早朝向け', '静か'],
    origin: { lat: 35.7281, lng: 139.7711, name: '日暮里駅 南口', shortLabel: '日暮里駅 南口' },
    dest:   { lat: 35.7203, lng: 139.7613, name: '根津神社', name_en: 'Nezu Shrine', shortLabel: '根津神社' },
    stops: [
      {
        lat: 35.7263, lng: 139.7705, name: '谷中霊園', name_en: 'Yanaka Cemetery', cat: 'park', emoji: '🌸',
        photoBg: 'linear-gradient(135deg, #66bb6a 0%, #a5d6a7 100%)',
        bestTime: '6:00-9:00', budget: '無料', stayMin: 30,
        tags: ['桜', '静か', '早朝'],
        desc: '徳川慶喜も眠る都内屈指の桜の名所。早朝の散策が格別。'
      },
      {
        lat: 35.7220, lng: 139.7665, name: '観音寺の築地塀', name_en: 'Kannon-ji Earthen Wall', cat: 'shrine', emoji: '🏯',
        photoBg: 'linear-gradient(135deg, #6d4c41 0%, #3e2723 100%)',
        bestTime: '9:00-16:00', budget: '無料', stayMin: 15,
        tags: ['歴史', '土塀', '撮影'],
        desc: '区指定有形文化財の土塀。江戸期の風情をそのまま。'
      },
      {
        lat: 35.7234, lng: 139.7642, name: 'カフェ ねんねこ家', name_en: 'Cafe Nennekoya', cat: 'cafe', emoji: '🐈',
        photoBg: 'linear-gradient(135deg, #6d4c41 0%, #ff9800 100%)',
        bestTime: '11:00-18:00', budget: '¥800-1,500', stayMin: 45,
        tags: ['猫', '古民家', 'カフェ'],
        desc: '招き猫だらけの古民家カフェ。本物の看板猫もいます。'
      },
      {
        lat: 35.7203, lng: 139.7613, name: '根津神社', name_en: 'Nezu Shrine', cat: 'shrine', emoji: '⛩️',
        photoBg: 'linear-gradient(135deg, #c62828 0%, #b71c1c 100%)',
        bestTime: '9:00-17:00', budget: '無料', stayMin: 30,
        tags: ['千本鳥居', 'パワースポット'],
        desc: '徳川綱吉ゆかりの古社。'
      },
    ]
  },

  // ============== 神保町エリア ==============

  {
    id: 'jimbocho_books',
    name: '神保町 古本街めぐり王道コース',
    name_en: 'Jimbocho Used Book Streets',
    area: 'jimbocho',
    areaName: '神田・神保町',
    areaName_en: 'Kanda & Jimbocho',
    areaIcon: '📚',
    themeIcon: '📖',
    rarity: 'sr',
    description: '世界最大級の古書店街。100軒以上が並ぶ通りを、純喫茶を挟みながら巡る知的散歩。',
    description_en: "World's largest used book district. Walk through 100+ shops, with retro coffee houses to rest.",
    travelMode: 'walk',
    estimatedMin: 90,
    budget: '¥1,500-5,000',
    tags: ['古本', '老舗喫茶', '雨でもOK'],
    origin: { lat: 35.6957, lng: 139.7595, name: '神保町駅 A1出口', shortLabel: '神保町駅' },
    dest:   { lat: 35.6991, lng: 139.7553, name: '九段下駅', shortLabel: '九段下駅' },
    stops: [
      {
        lat: 35.6960, lng: 139.7580, name: '東京堂書店', name_en: 'Tokyodo Bookstore', cat: 'bookstore', emoji: '📚',
        photoBg: 'linear-gradient(135deg, #6d4c41 0%, #3e2723 100%)',
        bestTime: '10:00-22:00', budget: '¥1,000-3,000', stayMin: 30,
        tags: ['人文書', '老舗', '建物'],
        desc: '人文・思想書に強い1890年創業の老舗。建物自体も登録有形文化財。'
      },
      {
        lat: 35.6963, lng: 139.7572, name: 'さぼうる', name_en: 'Saboru (Coffee)', cat: 'cafe', emoji: '☕',
        photoBg: 'linear-gradient(135deg, #5d4037 0%, #1b1b1b 100%)',
        bestTime: '11:00-22:00', budget: '¥800-1,500', stayMin: 45,
        tags: ['昭和30年創業', '地下喫茶', 'ナポリタン'],
        desc: '昭和30年創業の地下純喫茶。名物ナポリタンと丸太の店内。'
      },
      {
        lat: 35.6970, lng: 139.7565, name: '一誠堂書店', name_en: 'Issendo Bookstore', cat: 'bookstore', emoji: '📜',
        photoBg: 'linear-gradient(135deg, #6d4c41 0%, #d4af37 100%)',
        bestTime: '10:00-18:30', budget: '¥1,000-50,000', stayMin: 30,
        tags: ['美術書', '浮世絵', '希少本'],
        desc: '美術書・浮世絵・古典籍で全国的に有名な老舗古書店。'
      },
      {
        lat: 35.6978, lng: 139.7567, name: 'ラドリオ', name_en: 'Ladrio (Coffee)', cat: 'cafe', emoji: '☕',
        photoBg: 'linear-gradient(135deg, #4a148c 0%, #1a1a1a 100%)',
        bestTime: '12:00-22:30', budget: '¥800-2,000', stayMin: 40,
        tags: ['ウィンナーコーヒー発祥', '昭和24年'],
        desc: '日本のウィンナーコーヒー発祥の店。昭和24年創業の老舗喫茶。'
      },
    ]
  },

  {
    id: 'jimbocho_curry',
    name: '神保町 カレーストリート',
    name_en: 'Jimbocho Curry Street',
    area: 'jimbocho',
    areaName: '神田・神保町',
    areaName_en: 'Kanda & Jimbocho',
    areaIcon: '📚',
    themeIcon: '🍛',
    rarity: 'r',
    description: '神保町は知る人ぞ知るカレーの街。本屋の合間に潜む老舗カレー店をハシゴする昼の冒険。',
    description_en: "Jimbocho is secretly Tokyo's curry capital. Hop between historic curry shops hidden among the bookstores.",
    travelMode: 'walk',
    estimatedMin: 60,
    budget: '¥2,000-3,500',
    tags: ['カレー', 'ハシゴ', 'ランチ向け'],
    origin: { lat: 35.6957, lng: 139.7595, name: '神保町駅 A6出口', shortLabel: '神保町駅' },
    dest:   { lat: 35.6957, lng: 139.7595, name: '神保町駅', shortLabel: '神保町駅' },
    stops: [
      {
        lat: 35.6963, lng: 139.7585, name: '共栄堂', name_en: 'Kyoeido (Sumatra Curry)', cat: 'sweets', emoji: '🍛',
        photoBg: 'linear-gradient(135deg, #d84315 0%, #6d4c41 100%)',
        bestTime: '11:00-21:00', budget: '¥1,000-1,500', stayMin: 40,
        tags: ['昭和初期', 'スマトラカレー', '老舗'],
        desc: '昭和初期創業の老舗。インドネシア風「スマトラカレー」が名物。'
      },
      {
        lat: 35.6968, lng: 139.7593, name: 'ボンディ', name_en: 'Bondy (European Curry)', cat: 'sweets', emoji: '🍛',
        photoBg: 'linear-gradient(135deg, #ff6f00 0%, #e65100 100%)',
        bestTime: '11:00-22:30', budget: '¥1,500-2,000', stayMin: 50,
        tags: ['欧風カレー', '行列', 'チーズ'],
        desc: '日本における欧風カレーの代表格。じゃがいもとチーズ付きで知られる。'
      },
      {
        lat: 35.6960, lng: 139.7570, name: '神田カレーグランプリ巡礼', name_en: 'Kanda Curry Grand Prix Tour', cat: 'sweets', emoji: '🏆',
        photoBg: 'linear-gradient(135deg, #d4af37 0%, #ff9800 100%)',
        bestTime: '11:00-15:00', budget: '無料', stayMin: 30,
        tags: ['歴代受賞店', 'カレーマップ'],
        desc: '神田カレーグランプリの歴代受賞店マップを片手に街を歩く文化体験。'
      },
    ]
  },

  // ============== 浅草エリア ==============

  {
    id: 'asakusa_classic',
    name: '浅草 雷門・仲見世・浅草寺の王道コース',
    name_en: 'Asakusa: Kaminarimon, Nakamise, Sensoji',
    area: 'asakusa',
    areaName: '浅草',
    areaName_en: 'Asakusa',
    areaIcon: '🎎',
    themeIcon: '🏮',
    rarity: 'sr',
    description: '雷門の大提灯から仲見世の食べ歩き、浅草寺の本堂まで。下町情緒と日本文化を一気に体感。',
    description_en: 'From the giant lantern of Kaminarimon, through the Nakamise food street, to the main hall of Sensoji. Old Tokyo and Japanese culture in one walk.',
    travelMode: 'walk',
    estimatedMin: 75,
    budget: '¥1,500-3,000',
    tags: ['観光名所', '食べ歩き', '外国人にも人気'],
    origin: { lat: 35.7100, lng: 139.7967, name: '浅草駅', shortLabel: '浅草駅' },
    dest:   { lat: 35.7148, lng: 139.7967, name: '浅草寺 本堂', name_en: 'Sensoji Main Hall', shortLabel: '浅草寺' },
    stops: [
      {
        lat: 35.7110, lng: 139.7965, name: '雷門', name_en: 'Kaminarimon', cat: 'shrine', emoji: '🏮',
        photoBg: 'linear-gradient(135deg, #c62828 0%, #b71c1c 100%)',
        bestTime: '8:00-20:00', budget: '無料', stayMin: 10,
        tags: ['総門', '巨大提灯', '写真スポット'],
        desc: '浅草寺の総門。3.9m・700kgの巨大提灯は浅草の象徴。'
      },
      {
        lat: 35.7129, lng: 139.7968, name: '仲見世通り', name_en: 'Nakamise Shopping Street', cat: 'sweets', emoji: '🍡',
        photoBg: 'linear-gradient(135deg, #ff6f00 0%, #d84315 100%)',
        bestTime: '10:00-19:00', budget: '¥500-2,000', stayMin: 40,
        tags: ['日本最古級商店街', '食べ歩き', '人形焼き'],
        desc: '日本最古級の商店街。人形焼・雷おこし・揚げ饅頭などを食べ歩き。'
      },
      {
        lat: 35.7138, lng: 139.7968, name: '舟和 本店', name_en: 'Funawa Main Store', cat: 'sweets', emoji: '🍠',
        photoBg: 'linear-gradient(135deg, #d4af37 0%, #ff9800 100%)',
        bestTime: '10:00-21:00', budget: '¥500-1,500', stayMin: 30,
        tags: ['芋ようかん', '明治35年', '甘味処'],
        desc: '明治35年創業。看板の芋ようかんは100年以上愛される名物。'
      },
      {
        lat: 35.7148, lng: 139.7967, name: '浅草寺 本堂', name_en: 'Sensoji Main Hall', cat: 'shrine', emoji: '⛩️',
        photoBg: 'linear-gradient(135deg, #c62828 0%, #d4af37 100%)',
        bestTime: '6:00-17:00', budget: '無料', stayMin: 30,
        tags: ['都内最古', '観音様', 'おみくじ'],
        desc: '都内最古の寺院（628年創建）。本堂で観音様にお参り、おみくじも忘れずに。'
      },
    ]
  },

  {
    id: 'asakusa_hidden',
    name: '【限定】明け方の浅草寺と隅田川',
    name_en: '[Limited] Dawn at Sensoji & Sumida River',
    area: 'asakusa',
    areaName: '浅草',
    areaName_en: 'Asakusa',
    areaIcon: '🎎',
    themeIcon: '🌅',
    rarity: 'legendary',
    description: '観光客がまだ眠る早朝5:00〜の浅草。誰もいない雷門、本堂の朝の勤行、隅田川のスカイツリー。一生に一度の体験。',
    description_en: "5:00am Asakusa with no tourists. The empty Kaminarimon, monks' morning chant, and Sumida riverside view of Skytree. Once-in-a-lifetime experience.",
    travelMode: 'walk',
    estimatedMin: 90,
    budget: '無料',
    tags: ['早朝限定', '静寂', '上級者向け'],
    origin: { lat: 35.7100, lng: 139.7967, name: '浅草駅 早朝', shortLabel: '浅草駅' },
    dest:   { lat: 35.7100, lng: 139.7995, name: '隅田公園', shortLabel: '隅田公園' },
    stops: [
      {
        lat: 35.7110, lng: 139.7965, name: '雷門（無人）', name_en: 'Kaminarimon (No Crowd)', cat: 'shrine', emoji: '🏮',
        photoBg: 'linear-gradient(135deg, #1a237e 0%, #c62828 100%)',
        bestTime: '5:00-6:30', budget: '無料', stayMin: 15,
        tags: ['誰もいない', '写真映え', '神秘'],
        desc: '観光客が来る前の雷門。誰もいない巨大提灯の前で写真を。'
      },
      {
        lat: 35.7148, lng: 139.7967, name: '浅草寺 朝の勤行', name_en: 'Sensoji Morning Service', cat: 'shrine', emoji: '🛕',
        photoBg: 'linear-gradient(135deg, #5d4037 0%, #c62828 100%)',
        bestTime: '6:00-6:30', budget: '無料', stayMin: 30,
        tags: ['お経', '読経', '朝の浅草寺'],
        desc: '毎朝6時から行われる僧侶の朝のお勤め。本堂内で参拝可能。'
      },
      {
        lat: 35.7100, lng: 139.7995, name: '隅田公園・スカイツリー眺望', name_en: 'Sumida Park & Skytree View', cat: 'viewpoint', emoji: '🌅',
        photoBg: 'linear-gradient(135deg, #1976d2 0%, #ff9800 100%)',
        bestTime: '5:30-7:00', budget: '無料', stayMin: 30,
        tags: ['朝日', 'スカイツリー', '隅田川'],
        desc: '隅田川越しのスカイツリー。朝日と一緒の絶景は早朝の特権。'
      },
    ]
  },

];

window.YORIMICHI_REGIONS = [
  { id: 'tokyo',   country: 'JP', name: '東京',           name_en: 'Tokyo',   icon: '🗼', enabled: true,  centerLat: 35.6812, centerLng: 139.7671 },
  { id: 'kyoto',   country: 'JP', name: '京都',           name_en: 'Kyoto',   icon: '🍵', enabled: false, comingSoon: true, centerLat: 35.0116, centerLng: 135.7681 },
  { id: 'osaka',   country: 'JP', name: '大阪',           name_en: 'Osaka',   icon: '🐙', enabled: false, comingSoon: true, centerLat: 34.6937, centerLng: 135.5023 },
  { id: 'venezia', country: 'IT', name: 'ヴェネツィア', name_en: 'Venezia', icon: '🛶', enabled: false, comingSoon: true, centerLat: 45.4408, centerLng: 12.3155 },
];

window.YORIMICHI_AREAS = [
  { id: 'kichijoji', name: '吉祥寺',     name_en: 'Kichijoji',  icon: '🌳', enabled: true,  region: 'tokyo' },
  { id: 'yanesen',   name: '谷根千',     name_en: 'Yanesen',    icon: '🏮', enabled: true,  region: 'tokyo' },
  { id: 'jimbocho',  name: '神保町',     name_en: 'Jimbocho',   icon: '📚', enabled: true,  region: 'tokyo' },
  { id: 'asakusa',   name: '浅草',       name_en: 'Asakusa',    icon: '🎎', enabled: true,  region: 'tokyo' },
  { id: 'meiji',     name: '原宿表参道', name_en: 'Harajuku-Omotesando', icon: '🌸', enabled: false, comingSoon: true, region: 'tokyo' },
  { id: 'shimokita', name: '下北沢',     name_en: 'Shimokitazawa', icon: '🎸', enabled: false, comingSoon: true, region: 'tokyo' },
];
