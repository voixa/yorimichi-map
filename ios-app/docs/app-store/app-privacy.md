# App Privacy（ニュートリションラベル）回答 — App Store Connect 用

> コードのデータフロー監査に基づく。`PrivacyInfo.xcprivacy` と整合させること（同梱済）。
> Tracking（クロスアプリ追跡）: **なし**。第三者広告SDK: なし。データ販売: なし。

バックエンド: Google Cloud Run（日本リージョン）`yorimichi-api-...run.app`。識別子は端末ごとのランダムUUID（氏名等とは非連結だが、永続IDなので「ユーザーに紐づく」扱い）。

| データ種別 | 収集 | 目的 | ユーザーに紐づく | 追跡に使用 | 送信先 |
|-----------|------|------|----------------|-----------|--------|
| 正確な位置情報 (Precise Location) | ✅ | アプリ機能 | はい | いいえ | 自社API・地図/ルート/住所(OSM/OSRM/Nominatim)・AI解説 |
| 写真/動画 (Photos or Videos) | ✅ | アプリ機能 | はい | いいえ | 自社API（AI説明生成・任意操作時のみ） |
| ユーザーID (User ID = 匿名UUID) | ✅ | アプリ機能・分析 | はい | いいえ | 自社API |
| 製品操作 (Product Interaction / 利用状況) | ✅ | 分析 | はい | いいえ | 自社API (heartbeat/sync/live-stats) |
| その他ユーザーコンテンツ (Other User Content) | ✅ | アプリ機能 | はい | いいえ | 自社API（スポット投稿・報告・評価） |
| クラッシュ/診断 (Crash Data / Diagnostics) | ✅ | アプリ機能 | はい | いいえ | 自社API (/api/errors) |
| 購入 (Purchases) | （IAP実装後）✅ | アプリ機能 | はい | いいえ | Apple/自社（IAP導入時に追加） |

注:
- **収集しないもの**: 氏名・メール・電話・住所（フォーム）・連絡先・健康・金融情報・正確な広告ID(IDFA)。アカウント登録なし。
- データ削除手段あり（`/api/delete-user-data`・問い合わせ info@in-dx.jp）→ App Privacyの「データ削除のリクエスト方法」に記載。
- 質問票では各データ種別ごとに「目的」を選ぶ：基本「アプリの機能」、利用状況とUUIDは「分析」も。
- 「トラッキング」は全項目 No（ATTプロンプト不要・NSUserTrackingUsageDescription不要）。
