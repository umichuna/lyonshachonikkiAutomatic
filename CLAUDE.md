# 社長日記 自動生成・公開システム - 状況報告書（次回セッションで必ずここを読む）

> **このファイルの役割**: 修正・調査を始める前に必ず読む「現状のスナップショット」。
> `AGENTS.md` と内容は同一（Claude Code / Codex どちらが開いても同じ情報が手に入るように）。
> 詳細な機能説明は `README.md`、初回セットアップ手順は `docs/SETUP.md`、
> 要件は `要件定義書.MD` を参照。このファイルは「運用状態・直近の変更・未対応事項」専用。

最終更新: 2026-09-11（**下書き保存機能を追加**。詳細は「直近の修正履歴」参照。）

## プロジェクト概要
タイトル・本文・写真を入力するだけで社長日記のHTML記事を生成し、GitHub Pagesでの公開と
スプレッドシートへの記録までを自動化するシステム。`app.html`（入力アプリ、単一HTML）が
GAS（`gas/code.gs`）へPOSTし、GASがGitHub Contents APIで`past-articles/volXXX.html`へ
commitしつつスプレッドシートへ記録する。GitHub Actions等のCI/CDは無く、**GASが中継の中心**。

## 現在の運用状態（最重要）

- **本番の中継処理は`gas/code.gs`のみ**。`syachonikkigenerate.py`・`lyonshachonikkiUI.HTML`は
  README.mdが明記する通り「開発時の参考資産」で、本番からは一切呼ばれない（削除は
  **オーナー確認待ち**、下記「未着手の改善候補」参照）。
- **外部呼び出しには全てリトライを入れている（2026-09-08〜）**: GitHub APIへの3呼び出し
  （既存ファイルチェック・commit・`getCanonicalNames_`のリポジトリ名問い合わせ）は
  `fetchWithRetry_`（指数バックオフ、5xx/例外のみリトライ・4xxは即時返却）でラップ済み。
  **Discord Webhook（`notifyDiscord_`）・通知GAS（`callNotifyGas_`）は意図的にリトライしない**
  （失敗通知自体の遅延・Discordのレート制限誘発を避けるため）。
- **失敗通知自体が失敗した場合も実行ログに残る（2026-09-08〜）**: `notifyDiscord_`の`catch`は
  以前は完全な握り潰しだったが、`console.error`でApps Scriptの実行トランスクリプト
  （Cloud Logging）に残すよう修正済み。
- **週次データ整合性チェックを新設（2026-09-08〜）**: `validateArticleIntegrity_`が
  シートのURL列（D）が指す`past-articles/volXXX.html`の実在をGitHub Contents APIと突合し、
  リンク切れがあれば`DISCORD_WEBHOOK_URL`へ通知する（makasetenet-automationの
  `validate_master.py`と同じ役割）。トリガーは毎週月曜9時。**GASの時間主導トリガーとして
  `setupWeeklyIntegrityTrigger_()`を初回に1回だけ手動実行する必要がある**（`docs/SETUP.md`
  「4-3」参照）。**このオーナー作業が未実施の場合、チェックは動いていない**。
- **CI/CD（GitHub Actions）は意図的に導入していない**: このリポジトリの本番経路はGAS単体
  （静的HTML＋Apps Script）で完結しており、lint/testを流すビルドパイプライン自体が存在しない。
  GAS側の変更はコード変更のたびに`clasp push`または Apps Script エディタへの貼り付けが必要
  （`clasp`設定はこのリポジトリには無いため、現状は手動貼り付け運用。`docs/SETUP.md`手順3参照）。
- **Vol番号の採番は「シートのタイトル列(C)のデータ行数 + 1」に依存**（`doGet`の`?action=next_vol`）。
  手動でシートの行を編集すると採番がずれる既知の脆弱性（`docs/SETUP.md`トラブルシューティング
  に記載済み）。今回のメンテナンスでは変更していない。
- **下書き保存機能を追加（2026-09-11〜）**: `app.html`の②プレビュー・掲載画面に
  「下書き保存」ボタンを追加。`gas/code.gs`の`doPost`に`action:"draft"`を追加し、
  `saveDraft_`が`drafts/volXXX.html`へcommitして確認用URLのみ返す。
  **スプレッドシートへの記録・`notifyDiscord_`/`callNotifyGas_`による通知は一切行わない**。
  `past-articles/`とは別パスのため、正式掲載時の「既に掲載済み」重複チェック・Vol採番
  （`?action=next_vol`はタイトル列(C)の行数依存）・週次整合性チェック
  （`past-articles/`のみ突合）には影響しない。**下書きURLは正式な掲載ではない**
  （スタッフ通知・シート記録なし）ため、正式掲載するには従来どおりプレビュー画面の
  「掲載する」を押す必要がある（その場合`past-articles/volXXX.html`へ別途commitされる）。

## ファイル構成

| ファイル/フォルダ | 役割 |
|---|---|
| `app.html` | 入力アプリ本体（ブラウザで開くだけで動く単一HTML） |
| `template/article-template.html` | 記事の共通デザインテンプレート |
| `gas/code.gs` | GASバックエンド（GitHubへのHTML登録・スプレッドシート記録・週次整合性チェック） |
| `past-articles/` | 生成された記事HTML(`volXXX.html`)の保存先(正式掲載分) |
| `drafts/` | 下書き保存(`action:"draft"`)のHTML保存先。シート不記録・通知なし |
| `docs/SETUP.md` | 初回セットアップ手順（GitHub トークン・Pages・GAS デプロイ・週次チェック設置） |
| `syachonikkigenerate.py` / `lyonshachonikkiUI.HTML` | 開発時の参考資産。**本番未使用**（削除はオーナー確認待ち） |

## 直近の修正履歴

- **2026-09-11（下書き保存機能）**: オーナー依頼。`app.html`②プレビュー・掲載画面に
  「下書き保存」ボタンを追加し、`gas/code.gs`に`action:"draft"`（`saveDraft_`）を新設。
  `drafts/volXXX.html`へcommitし確認URLのみ返す(シート不記録・通知なし)。
- **2026-09-08（全体メンテナンス初回・CLAUDE.md新設）**: オーナーの依頼で全自作システムに
  自動メンテナンス体制を広げる一環として対応。①`gas/code.gs`のGitHub API呼び出し3箇所に
  `fetchWithRetry_`（指数バックオフ、3回まで）を追加。②`notifyDiscord_`の`catch`が
  完全な握り潰しだったのを`console.error`でログに残すよう修正。③`validateArticleIntegrity_`
  （週次、シート×GitHub実ファイルの突合）と設置用関数`setupWeeklyIntegrityTrigger_`を新設し
  `docs/SETUP.md`に手順を追記。④このCLAUDE.mdを新規作成（従来は状況報告書が存在しなかった）。
  **`setupWeeklyIntegrityTrigger_`の実行はオーナー作業として未実施**（下記参照）。

## 未着手の改善候補

- **【要オーナー作業】週次整合性チェックのトリガー未設置**: `setupWeeklyIntegrityTrigger_()`を
  Apps Scriptエディタから一度だけ手動実行する必要がある（`docs/SETUP.md`「4-3」参照）。
  実行するまで`validateArticleIntegrity_`は自動では動かない。
- **死んだ参考資産の削除可否（オーナー確認待ち）**: `syachonikkigenerate.py`・
  `lyonshachonikkiUI.HTML`はREADME.md自身が「開発時の参考資産」と明記し本番から未使用と
  確認済み。削除するかはオーナー判断。
- **Vol番号の採番がシートの行数依存**: シートを手動編集すると採番がずれる既知の脆弱性
  （`docs/SETUP.md`トラブルシューティング参照）。影響は限定的だが、行の直接削除ではなく
  「取り消し」機能を使う運用ルールで回避している。恒久対応（例: 採番用の専用カウンタセル）は
  未着手。
- **GAS側の反映はclasp未導入で手動貼り付け運用**: `gas/code.gs`を変更したら、
  Apps Scriptエディタで`Code.gs`の中身を貼り替えてデプロイし直す必要がある
  （`makasetenet-automation`/`aqualingua-app`のような自動デプロイの仕組みは無い）。
  `clasp`導入は本リポジトリの規模では過剰と判断し、今回は見送り。
- **【要オーナー作業・2026-09-12発覚】GitHubトークンが401(Bad credentials)で無効化されている
  可能性**: 下書き保存機能のテスト中に発覚。まず`action:"draft"`未対応の(貼り替え前の)
  GASが動いていたため「titleが無いとエラー」になり(①)、title付きで再送すると実際に
  GitHub Contents APIへcommitしにいって401が返った(②)。②は`gas/code.gs`のコードの
  問題ではなく、スクリプトプロパティ`GITHUB_TOKEN`が無効/期限切れ/取り消し済みであることを
  示す典型的な症状。**下書き保存に限らず通常の「掲載する」も同じトークンを使うため、
  トークンが無効なら本番の掲載処理自体が全て失敗する状態**。対応: (1) 最新の`gas/code.gs`を
  Apps Scriptエディタに貼り替えて再デプロイ(`action:"draft"`を有効化)、(2) GitHubで
  Fine-grained personal access tokenを再発行(Contents: Read and write, 対象リポジトリのみ)し、
  スクリプトプロパティ`GITHUB_TOKEN`を新しい値に更新(`docs/SETUP.md`手順1・3参照)。

## デプロイ手順

### `gas/code.gs`変更時
1. Apps Scriptエディタで`Code.gs`の中身を新しい`gas/code.gs`の内容に貼り替える
2. 上部メニュー「デプロイ」→「デプロイを管理」→ 既存のウェブアプリデプロイを編集し、
   新しいバージョンで更新する（URLは変わらない）
3. `app.html`側の`GAS_URL`は変更不要（同じURLのまま新バージョンが有効になる）

### `app.html`等の静的ファイル変更時
`git push`するだけでGitHub Pagesが自動反映する（数分かかることがある）。

## 作業ルール

- 外部I/O（GitHub API等）はリトライを入れる（`fetchWithRetry_`参照）。失敗通知自体
  （Discord・通知GAS）はリトライしない。
- 失敗は握り潰さず、最低限`console.error`で実行ログに残す。可能なら`notifyDiscord_`で通知する。
- 使い捨てスクリプトの削除・仕様変更はオーナー確認を得てから行う。

## メンテナンスルール（このファイル自体の運用）

**このファイルは「今読んでも正しい」状態を維持することが最優先。** 何かを修正・調査したら、
その都度以下を更新すること:
1. 「現在の運用状態」セクション（挙動が変わった場合）
2. 「直近の修正履歴」（要点1〜2行を追記）
3. 「未着手の改善候補」（消化した項目を削除、新たに見つかった課題を追加）
