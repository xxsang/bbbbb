# bbbbb

[English](README.md) | [简体中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md)

<p align="center"><img src="assets/readme/bbbbb-logo.svg" width="128" alt="bbbbb"></p>

**対応が必要なときに iPhone へ通知。**

bbbbb（ビー・ファイブ）は、ビルド結果、コーディングエージェントからの質問、デプロイの承認依頼を、iPhone のプライベートな受信箱にまとめます。通知を見逃しても、アプリを開いて確認できます。

「要対応」には質問、失敗、承認依頼、未完了の作業を、解決するまで残します。それ以外は「アクティビティ」に表示します。通知元は送信専用で、受信箱の読み取りやコマンドの実行はできません。

<p align="center"><a href="https://apps.apple.com/us/app/bbbbb-coding-agent-alerts/id6791204016"><img src="assets/readme/download-on-the-app-store.svg" height="60" alt="App Store"></a></p>

[bbbbb.app](https://bbbbb.app/?lang=ja)

## 近日公開：v1.5

アプリが英語、簡体字中国語、スペイン語、日本語、ドイツ語、フランス語、ブラジルポルトガル語に対応します。履歴保存と CSV 書き出しも改善します。Web サイトは7言語で利用できます。アプリの更新はまだ App Store に公開されていません。

## 使い始める

コーディングエージェントには `Set up bbbbb at bbbbb.app/setup` と指示してください。エージェントが HTTP 通知元を準備します。iPhone で一時 QR コードを読み取るか6桁のコードを入力し、接続を承認してください。エージェントが非公開リンクを保存してテストメッセージを送信します。アプリや自動化サービスには、iPhone の「アプリ・自動化を接続」を使います。

設定後は、保存済みの `BBBBB_SOURCE_URL` を使って直接送信できます。送信側が分類を選びます。応答が必要な場合は要対応、それ以外はアクティビティを使います。通知元の URL はプロンプトやログに含めないでください。

```sh
curl -X POST "$BBBBB_SOURCE_URL"
```

### CLI を使う場合

```sh
npm install --global @bbbbbapp/cli
bbbbb setup --name "My Mac"
bbbbb run -- npm test
```

npm を利用できない場合は、検証済みの [GitHub Release](https://github.com/xxsang/bbbbb/releases) を使ってください。[CLI ガイド](https://bbbbb.app/docs/cli-source/?lang=ja)に詳しい手順があります。

### コーディングエージェント用スキル

```sh
sh scripts/install-bbbbb-notify-skill.sh
```

インストール後、エージェントに次のように指示します。

> この作業で bbbbb を使ってください。完了時に通知し、私の対応が必要な場合だけ Attention を送ってください。途中経過の通知は不要です。

## ガイド

[macOS](https://bbbbb.app/docs/macos/?lang=ja) · [Linux](https://bbbbb.app/docs/linux/?lang=ja) · [Windows](https://bbbbb.app/docs/windows/?lang=ja) · [HTTP](https://bbbbb.app/docs/http-source/?lang=ja) · [CLI](https://bbbbb.app/docs/cli-source/?lang=ja)

## プランと上限

無料プランは基本機能をすべて含み、直近30日間に1,000件まで受信できます。再接続後に同期できるよう、最新100件を暗号化して最長7日間保管します。

Plus は公開後60日間は4.99米ドルの買い切りで、今後追加される機能も含まれます。サブスクリプションではありません。2026年10月26日から通常価格6.99米ドルになります。現在の地域別価格は App Store に表示されます。

Plus は直近30日間の上限が10,000件となり、最新500件を最長30日間保管し、端末内での JSON・CSV 書き出しに対応します。無料プランは引き続き利用できます。

1日単位の利用上限はありません。安全対策として、受信箱ごとに1分あたり20件の送信上限があります。受信上限はすべての通知元で共有されます。通知元を追加しても上限は変わりません。

## プライバシー

CLI は送信前に、HTTP は保存前にイベントを暗号化します。通知元は履歴を読むことができません。通知にはメッセージの詳細を表示しません。送信者が書いた内容は翻訳せず、そのまま保持します。

開発者向けコアは [Apache License 2.0](LICENSE) で公開しています。iPhone アプリは別の製品です。

<sub>Apple、Apple ロゴ、App Store は、米国およびその他の国と地域で登録された Apple Inc. の商標です。</sub>
