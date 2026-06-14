# 街歩きガチャ — App Store 公開準備 マスターチェックリスト

> 最終更新: 2026-06-14 / bundle id `jp.indx.yorimichi` / iPhone専用 / 主market 日本
> 目的: **Apple Developer 承認が下りた瞬間に最短で審査提出できる**よう、承認不要の準備を全部終わらせておく。
> 凡例: ✅ 完了 / 🟡 着手中・要仕上げ / ⬜ 未着手 / 🔒 承認後しかできない

---

## A. 承認不要で「今やる」 — コード/設定

| 状態 | 項目 | 場所 / メモ |
|------|------|------------|
| ✅ | 死んだ購入ボタンを iOS で非表示 (#shop-btn/#shop-btn-2) | style.css iOS hide / commit `eb0925a` |
| ✅ | FAQの課金・外部商品文言を除去 | index.html FAQ |
| ✅ | 虚偽プライバシー記載の是正 (FAQ・Info.plist・アプリ内ポリシー) | 「送信なし」→実態へ |
| ✅ | NSCameraUsageDescription / NSPhotoLibraryUsageDescription 追加 | Info.plist (カメラ起動クラッシュ防止) |
| ✅ | NSLocationAlwaysAndWhenInUse 削除・armv7→arm64 | Info.plist |
| ✅ | PrivacyInfo.xcprivacy 新規 + pbxproj結線 + 同梱確認 | 2026必須 / commit `eb0925a` |
| ✅ | ITSAppUsesNonExemptEncryption=false | Info.plist (既存) |
| ✅ | ガチャ排出率の事前開示 (4.5.4) | 限定1/隠れ家9/穴場30/定番60 = 既存・到達可 |
| ✅ | アプリ内プライバシーポリシー全面改訂 | index.html #privacy-modal |
| ⬜ | レアUP(確率2倍)モードの排出率も開示 | 任意・4.5.4の完全性向上 |
| 🟡 | StoreKit 2 ブリッジ実装 (no-op差し替え) | 設計=`app-store/iap-products.md`。**検証はSandbox=承認後** |

## B. 承認不要で「今やる」 — コンテンツ/アセット

| 状態 | 項目 | 成果物 |
|------|------|--------|
| ✅ | App Store メタデータ草案 (JA/EN) | `app-store/metadata.md` |
| ✅ | IAP 商品仕様 (ID/価格/名称/説明) | `app-store/iap-products.md` |
| ✅ | App Privacy ニュートリションラベル回答 | `app-store/app-privacy.md` |
| ✅ | プライバシーポリシー (ホスティング用) | `app-store/privacy-policy.md` (要 in-dx.jp 公開) |
| ✅ | 利用規約 (ToS) 草案 | `app-store/terms-of-service.md` (or Apple標準EULA) |
| ✅ | 年齢レーティング回答方針 | ルートボックス=はい/ギャンブル模擬=いいえ/コンテスト=いいえ → 推定12〜16+ |
| ⬜ | スクリーンショット 6.9" 1320×2868 ×5〜8 | iPhone 17 Pro Max シミュレータで撮影 |
| ⬜ | (任意) App Preview 動画 15-30s | |
| ⬜ | サポートURL ページ公開 | yorimichi.in-dx.jp/support 等 |

## C. 🔒 承認後しかできない (App Store Connect)

1. Apple Developer 承認の確認 (`developer.apple.com/account`)。Team `H5AU564JP3`。
2. App記録の作成 (bundle id 登録) + メタデータ入力 (→ B の metadata.md を貼る)
3. Paid Apps 契約 + 銀行/税情報 (IAP前提)
4. IAP 消耗型4種 (+将来サブスク) を登録 → first version に紐付け (→ iap-products.md)
5. App Privacy 質問票の提出 (→ app-privacy.md)
6. 年齢レーティング質問票の提出
7. Xcode で Archive → Upload (署名は自動・Team設定済)
8. TestFlight (内部→外部β。IAPサンドボックス検証)
9. 審査提出 (binary + IAP 同時)

---

## いま提出をブロックしている唯一の前提
**Apple Developer Program の承認**（保留中だった）。これさえ下りれば C を一気に実行できる。
A/B の承認不要タスクはこのチェックリストでほぼ消化済み（残: スクショ撮影・サポートURL公開・StoreKit実装の最終検証）。

## 関連ドキュメント
- 調査の詳細根拠: 本ファイルは3方向監査(ネイティブ設定/Web適合性/審査要件)の統合結果
- 設計: `REDESIGN.md` / Obsidian `Projects/yorimichi-map.md`
