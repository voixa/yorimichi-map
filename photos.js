/* Spot photos from Wikimedia Commons (CC-licensed). Map: stop name -> URL */

/* Perks: 完走特典（提携締結後に解放）
 * status: 'pending' = まだ表示しない（app.js で 'live' のみレンダリング）
 * status: 'live'    = 提携締結済みで表示OK
 *
 * IMPORTANT: 'pending' のままでは絶対に表示しない（景品表示法・優良誤認リスク）。
 * 全店との書面合意後に 'live' に変更すること。
 */
window.YORIMICHI_PERKS = {
  // すべて提携準備中のため、現状は表示されない
};

window.YORIMICHI_PHOTOS = {
  "いせや 総本店": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Typical_yakitori_001.jpg/3840px-Typical_yakitori_001.jpg",
  "さとう (吉祥寺)": "https://upload.wikimedia.org/wikipedia/commons/1/16/Menchi_%28minced_pork%29_katsu.jpg",
  "すずきの惣菜": "https://upload.wikimedia.org/wikipedia/commons/1/16/Menchi_%28minced_pork%29_katsu.jpg",
  "ラドリオ": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Jinbocho_ladrio_2023-10-20%282%29_as.jpg/3840px-Jinbocho_ladrio_2023-10-20%282%29_as.jpg",
  "七井橋通り": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Mitaka_Inokashira_Park_In_Spring_1.JPG/3840px-Mitaka_Inokashira_Park_In_Spring_1.JPG",
  "玉川上水沿いの森": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Mitaka_Inokashira_Park_In_Spring_1.JPG/3840px-Mitaka_Inokashira_Park_In_Spring_1.JPG",
  "中道通り": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/%E5%90%89%E7%A5%A5%E5%AF%BA%E3%82%B5%E3%83%B3%E3%83%AD%E3%83%BC%E3%83%89%E5%95%86%E5%BA%97%E8%A1%97%282025%E5%B9%B4%29.jpg/3840px-%E5%90%89%E7%A5%A5%E5%AF%BA%E3%82%B5%E3%83%B3%E3%83%AD%E3%83%BC%E3%83%89%E5%95%86%E5%BA%97%E8%A1%97%282025%E5%B9%B4%29.jpg",
  "井の頭弁財天": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Mitaka_Inokashira_Park_In_Spring_1.JPG/3840px-Mitaka_Inokashira_Park_In_Spring_1.JPG",
  "井の頭池（早朝）": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Mitaka_Inokashira_Park_In_Spring_1.JPG/3840px-Mitaka_Inokashira_Park_In_Spring_1.JPG",
  "仲見世通り": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Asakusa_Nakamise_2021-12_ac.jpg/3840px-Asakusa_Nakamise_2021-12_ac.jpg",
  "夕やけだんだん": "https://upload.wikimedia.org/wikipedia/commons/6/6f/Yanaka_Ginza_Street_from_Yuyake_Dandan_%28Oct_2024%29.jpg",
  "小ざさ": "https://upload.wikimedia.org/wikipedia/commons/6/60/Youkan_002.jpg",
  "根津神社": "https://upload.wikimedia.org/wikipedia/commons/d/da/Nezu_Shrine_2010.jpg",
  "浅草寺 朝の勤行": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Asakusa_Senso-ji_2021-12_ac_%282%29.jpg/3840px-Asakusa_Senso-ji_2021-12_ac_%282%29.jpg",
  "浅草寺 本堂": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Asakusa_Senso-ji_2021-12_ac_%282%29.jpg/3840px-Asakusa_Senso-ji_2021-12_ac_%282%29.jpg",
  "隅田公園・スカイツリー眺望": "https://upload.wikimedia.org/wikipedia/commons/1/14/Sumida_Park.jpg",
  "雷門": "https://upload.wikimedia.org/wikipedia/commons/e/ed/Senso-ji_Kaminarimon_201503a.jpg",
  "雷門（無人）": "https://upload.wikimedia.org/wikipedia/commons/e/ed/Senso-ji_Kaminarimon_201503a.jpg",
};
