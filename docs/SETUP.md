# セットアップ手順

このシステムは3つの部品で構成されています。

- `app.html` … 入力アプリ本体(ブラウザで開くだけで動く単一HTML)
- `template/article-template.html` … 記事の共通デザインテンプレート
- `gas/code.gs` … Google Apps Script(GAS)のバックエンド。GitHubへの登録とスプレッドシート記録を代行する中継役

初回セットアップとして、以下を順番に行ってください。

---

## 1. GitHub トークンの発行

1. GitHubの [Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) を作成
2. Repository access で **このリポジトリ(lyonshachonikkiautomatic)のみ** を選択
3. Permissions → **Contents: Read and write** を付与(他の権限は不要)
4. 発行されたトークン(`github_pat_...`)を控えておく(この画面を閉じると二度と表示されません)

---

## 2. GitHub Pages の有効化

1. リポジトリの Settings → Pages を開く
2. Source を「Deploy from a branch」、Branch を `main` / `/(root)` に設定して Save
3. 無料プランではリポジトリが **Public** である必要があります

数分後、`https://<GitHubユーザー名>.github.io/<リポジトリ名>/` でアクセスできるようになります。

---

## 3. GAS(Google Apps Script)のセットアップ

1. [script.google.com](https://script.google.com) で新規プロジェクトを作成
2. `Code.gs` の中身をすべて削除し、このリポジトリの `gas/code.gs` の内容を貼り付ける
3. 左メニューの歯車アイコン「プロジェクトの設定」→「スクリプト プロパティ」で以下を追加

   | プロパティ名 | 値の例 | 説明 |
   |---|---|---|
   | `GITHUB_TOKEN` | `github_pat_xxxxx` | 手順1で発行したトークン |
   | `GITHUB_OWNER` | `umichuna` | リポジトリのオーナー名 |
   | `GITHUB_REPO` | `lyonshachonikkiautomatic` | リポジトリ名 |
   | `SHEET_ID` | `1XPMwWYqNSrJLu7x8RCmX4JGaaU1UE-Ep9v-w5bxC1rs` | 記録先スプレッドシートのID(未設定でもこの値が既定で使われます) |
   | `SHEET_NAME` | `社長日記` | 記録先シート名(存在しない場合は自動作成されます) |
   | `DISCORD_WEBHOOK_URL` | (任意) | エラー発生時の通知先。不要なら未設定のままでOK |

4. 上部メニュー「デプロイ」→「新しいデプロイ」
   - 種類: **ウェブアプリ**
   - 実行するユーザー: 自分
   - アクセスできるユーザー: **全員**
5. デプロイ後に表示される **ウェブアプリのURL**(`https://script.google.com/macros/s/.../exec`)を控える

> スプレッドシートには、実行したGoogleアカウントで編集権限が必要です。既存の「社長日記」シートタブがなければ初回実行時に自動作成されます(A:Vol番号 / B:タイトル / C:公開URL / D:公開日 / E:ステータス)。

---

## 4. アプリへのGAS URL設定

`app.html` の先頭付近にある設定値を書き換えます。

```js
const GAS_URL = ""; // ← ここに手順3で控えたウェブアプリのURLを入れる
```

`SPREADSHEET_URL` は既に記録先スプレッドシートのURLが設定済みです。別のシートを使う場合はこちらも書き換えてください。

---

## 5. 動作確認(Vol.005での試験運用)

1. `app.html` をGitHub Pages経由で開く(ローカルで確認する場合は `python3 -m http.server` を実行しブラウザで `http://localhost:8000/app.html` を開く。`file://` で直接開くとテンプレート読み込みがブロックされる場合があります)
2. Vol番号・タイトル・本文を入力し、画面②で写真を割り当てる
3. 画面③でプレビューを確認し、「掲載する」を押す
4. 確認ダイアログでOKすると:
   - 重複チェック → GitHubへHTMLがcommit → 数十秒〜数分でGitHub Pagesに反映
   - スプレッドシートに1行追記(この追記をトリガーに既存の通知システムが自動で動作する想定)
5. 発行されたURLにアクセスし、デザイン・リアクションボタンが正しく表示されるか確認

---

## トラブルシューティング

- **「GASのURLが未設定です」と出る** → 手順4を実施してください
- **プレビューが真っ白** → `template/article-template.html` が同じ階層(または相対パス)にあるか確認。`file://` で開いていないか確認
- **掲載時に「GitHubへのデプロイに失敗しました」** → トークンの権限(Contents: Read and write)とリポジトリ名・オーナー名の設定を確認
- **掲載時に「スプレッドシートへの記録に失敗しました」** → `SHEET_ID` の値と、GASを実行しているGoogleアカウントがそのシートを編集できるか確認。この場合GitHub側の公開自体は完了しているため、シートへは手動で1行追記してください
