/**
 * 社長日記 自動生成・公開システム — GAS バックエンド
 *
 * 役割:
 *   - 入力アプリ(app.html)からのリクエストを受け、GitHubへのHTML登録と
 *     スプレッドシートへの記録を行う中継役。GitHubトークンはここに保管し、
 *     ブラウザ側には一切渡さない。
 *
 * セットアップ手順は docs/SETUP.md を参照。
 * このファイルの内容をそのまま GAS プロジェクトの Code.gs に貼り付けて使用する。
 *
 * 必要な Script Properties(スクリプト プロパティ):
 *   GITHUB_TOKEN        … リポジトリの Contents:Read/Write 権限を持つ GitHub トークン
 *   GITHUB_OWNER        … 例: "umichuna"
 *   GITHUB_REPO         … 例: "lyonshachonikkiautomatic"
 *   SHEET_ID            … 記録先スプレッドシートのID
 *   SHEET_NAME          … 記録先シート名(未設定時は "社長日記")
 *   DISCORD_WEBHOOK_URL … エラー通知先(任意・未設定なら通知はスキップ)
 */

const DEFAULT_SHEET_ID = "1XPMwWYqNSrJLu7x8RCmX4JGaaU1UE-Ep9v-w5bxC1rs";
const DEFAULT_SHEET_NAME = "社長日記";
const HEADER_ROW = ["Vol番号", "タイトル", "公開URL", "公開日", "ステータス"];

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const cfg = {
    githubToken: props.getProperty("GITHUB_TOKEN"),
    githubOwner: props.getProperty("GITHUB_OWNER"),
    githubRepo: props.getProperty("GITHUB_REPO"),
    sheetId: props.getProperty("SHEET_ID") || DEFAULT_SHEET_ID,
    sheetName: props.getProperty("SHEET_NAME") || DEFAULT_SHEET_NAME,
    discordWebhookUrl: props.getProperty("DISCORD_WEBHOOK_URL"),
  };
  if (!cfg.githubToken || !cfg.githubOwner || !cfg.githubRepo) {
    throw new Error("GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO がスクリプトプロパティに設定されていません。");
  }
  return cfg;
}

function getSheet_(cfg) {
  const ss = SpreadsheetApp.openById(cfg.sheetId);
  let sheet = ss.getSheetByName(cfg.sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(cfg.sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER_ROW);
  }
  return sheet;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function notifyDiscord_(cfg, message) {
  if (!cfg.discordWebhookUrl) return;
  try {
    UrlFetchApp.fetch(cfg.discordWebhookUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ content: message }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    // 通知失敗はこれ以上握りつぶす(本処理の成否には影響させない)
  }
}

function normalizeVolDigits_(raw) {
  const m = String(raw || "").match(/(\d+)/);
  return m ? m[1].replace(/^0+/, "") || "0" : null;
}

/* ════════════════════════════════════════════════
   GET: ?action=next_vol / ?action=history
   ════════════════════════════════════════════════ */
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || "";
  try {
    const cfg = getConfig_();
    const sheet = getSheet_(cfg);

    if (action === "next_vol") {
      const values = sheet.getDataRange().getValues();
      let maxVol = 0;
      for (let i = 1; i < values.length; i++) {
        const digits = normalizeVolDigits_(values[i][0]);
        if (digits !== null) maxVol = Math.max(maxVol, parseInt(digits, 10));
      }
      const next = String(maxVol + 1).padStart(3, "0");
      return jsonOut_({ success: true, nextVol: next });
    }

    if (action === "history") {
      const values = sheet.getDataRange().getValues();
      const items = [];
      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        if (!row[0]) continue;
        items.push({
          volNo: String(row[0]),
          title: String(row[1] || ""),
          url: String(row[2] || ""),
          date: row[3] instanceof Date ? Utilities.formatDate(row[3], Session.getScriptTimeZone(), "yyyy.MM.dd") : String(row[3] || ""),
          status: String(row[4] || ""),
        });
      }
      items.reverse();
      return jsonOut_({ success: true, items: items });
    }

    return jsonOut_({ success: false, error: "不明なaction指定です。" });
  } catch (err) {
    return jsonOut_({ success: false, error: err.message });
  }
}

/* ════════════════════════════════════════════════
   POST: 掲載処理
   body: { volNo: "005", title: "...", dateStr: "2026.07.10", html: "<!DOCTYPE ...>" }
   ════════════════════════════════════════════════ */
function doPost(e) {
  let cfg;
  try {
    cfg = getConfig_();
  } catch (err) {
    return jsonOut_({ success: false, error: err.message });
  }

  try {
    const payload = JSON.parse(e.postData.contents);
    const volNo = String(payload.volNo || "").trim();
    const title = String(payload.title || "").trim();
    const dateStr = String(payload.dateStr || "").trim();
    const html = String(payload.html || "");

    if (!volNo || !title || !html) {
      return jsonOut_({ success: false, error: "volNo / title / html は必須です。" });
    }

    const sheet = getSheet_(cfg);
    const volDigits = normalizeVolDigits_(volNo);

    // ── 1. 重複チェック(シート側) ──
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (normalizeVolDigits_(values[i][0]) === volDigits) {
        return jsonOut_({ success: false, error: `Vol.${volNo} は既に掲載済みです。` });
      }
    }

    const fileName = `vol${volNo}.html`;
    const apiBase = `https://api.github.com/repos/${cfg.githubOwner}/${cfg.githubRepo}/contents/${fileName}`;
    const authHeaders = {
      Authorization: `Bearer ${cfg.githubToken}`,
      Accept: "application/vnd.github+json",
    };

    // ── 2. 念のためGitHub側にも同名ファイルがないか確認(既存ファイルの上書き事故防止) ──
    const checkRes = UrlFetchApp.fetch(apiBase, { headers: authHeaders, muteHttpExceptions: true });
    if (checkRes.getResponseCode() === 200) {
      return jsonOut_({ success: false, error: `GitHub上に ${fileName} が既に存在します。` });
    }

    // ── 3. GitHubへcommit ──
    const commitRes = UrlFetchApp.fetch(apiBase, {
      method: "put",
      headers: authHeaders,
      contentType: "application/json",
      payload: JSON.stringify({
        message: `Vol.${volNo} を公開`,
        content: Utilities.base64Encode(html, Utilities.Charset.UTF_8),
        branch: "main",
      }),
      muteHttpExceptions: true,
    });
    if (commitRes.getResponseCode() >= 300) {
      throw new Error(`GitHubへのデプロイに失敗しました(${commitRes.getResponseCode()}): ${commitRes.getContentText()}`);
    }

    const publishedUrl = `https://${cfg.githubOwner}.github.io/${cfg.githubRepo}/${fileName}`;

    // ── 4. スプレッドシートへ1行追記 ──
    try {
      sheet.appendRow([`Vol.${volNo}`, title, publishedUrl, dateStr, "公開済み"]);
    } catch (sheetErr) {
      notifyDiscord_(cfg, `⚠️ Vol.${volNo} はGitHubへの公開に成功しましたが、スプレッドシートへの記録に失敗しました。手動で追記してください。\nURL: ${publishedUrl}\nエラー: ${sheetErr.message}`);
      return jsonOut_({ success: false, error: "GitHubへの公開は完了しましたが、スプレッドシートへの記録に失敗しました。担当者へ連絡してください。" });
    }

    return jsonOut_({ success: true, url: publishedUrl });
  } catch (err) {
    notifyDiscord_(cfg, `🚨 社長日記の掲載処理でエラーが発生しました: ${err.message}`);
    return jsonOut_({ success: false, error: err.message });
  }
}
