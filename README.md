# 社長日記 自動生成・公開システム

タイトル・本文・写真を入力するだけで、社長日記のHTML記事を生成し、GitHub Pagesでの公開URL発行とスプレッドシートへの記録までを自動化するシステムです。

詳細な要件は [`要件定義書.MD`](./要件定義書.MD) を参照してください。

## 構成

| ファイル/フォルダ | 内容 |
|---|---|
| `app.html` | 入力アプリ本体。ブラウザで開くだけで動く単一HTML(タブ切り替え式・4画面) |
| `template/article-template.html` | 記事の共通デザインテンプレート(Vol.001〜004と同一デザイン) |
| `gas/code.gs` | Google Apps Script バックエンド。GitHubへのHTML登録とスプレッドシート記録を代行する中継役 |
| `docs/SETUP.md` | 初回セットアップ手順 |
| `syachonikkigenerate.py` / `lyonshachonikkiUI.HTML` | 開発時の参考資産(Python版生成ロジック・UIモック) |

## 全体フロー

```
入力アプリ(app.html)で下書き作成・写真設定・プレビュー
        ↓「掲載する」
GAS(gas/code.gs)が中継
   ├─ Vol番号の重複チェック
   ├─ GitHub Contents API で volXXX.html をこのリポジトリへcommit
   └─ スプレッドシートへ1行追記(Vol/タイトル/URL/公開日/ステータス)
        ↓
GitHub Pagesが自動デプロイ → 公開URL発行
```

## セットアップ

初回のみ、GitHubトークンの発行・GitHub Pagesの有効化・GASのデプロイが必要です。
手順は [`docs/SETUP.md`](./docs/SETUP.md) を参照してください。
