#!/bin/sh
# Xcode をフルインストールした後に実行する継続スクリプト
# 使い方:  sh ios-app/scripts/mac-continue.sh
#
# 注意: このMacは sudo を使わない方針のため、xcode-select は切り替えず
#       DEVELOPER_DIR 環境変数でフルXcodeを指す（sudo不要）。
set -e

export PATH="$HOME/.local/node/bin:$PATH"

if [ ! -d /Applications/Xcode.app ]; then
  echo "✗ /Applications/Xcode.app が見つかりません。"
  echo "  App Store からフルXcodeをインストールし、一度起動して"
  echo "  追加コンポーネントのインストール(管理者パスワード入力)を済ませてください。"
  exit 1
fi

# sudo なしでフルXcodeを使う
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
echo "DEVELOPER_DIR = $DEVELOPER_DIR"
xcodebuild -version || true

echo "== Capacitor 再同期 =="
cd "$(dirname "$0")/.."
npx cap sync ios

echo "== Xcode でプロジェクトを開く =="
npx cap open ios

cat <<'EOS'

== Xcode が開いたら ==
 1. 左ペインで App ターゲットを選択
 2. Signing & Capabilities → 個人 Apple ID (seijirooo.y@gmail.com) の Team を選択
    (Apple Developer 承認後に Team が選べる)
 3. Bundle ID が jp.indx.yorimichi であることを確認
 4. 上部でシミュレータ (iPhone 15 等) を選び ▶ Run

ヒント: xcode-select を恒久的に切り替えたい場合のみ(任意・sudo要):
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
EOS
