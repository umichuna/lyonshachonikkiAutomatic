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
 * 【連携シートの列構成(社長日記専用タブ・1行目ヘッダー)】
 *   A: 更新日(= 掲載開始日)  B: 掲載終了日  C: タイトル  D: URL  E: 処理
 *   ※ Vol番号の列は無い。Volはファイル名(volXXX.html)用。
 *   ※ 採番は「タイトル列(C)のデータ行数 + 1」。
 *
 * 必要な Script Properties(スクリプト プロパティ):
 *   GITHUB_TOKEN        … リポジトリの Contents:Read/Write 権限を持つ GitHub トークン
 *   GITHUB_OWNER        … 例: "umichuna"
 *   GITHUB_REPO         … 例: "lyonshachonikkiAutomatic"
 *   SHEET_ID            … 記録先スプレッドシートのID
 *   SHEET_NAME          … 記録先シート(タブ)名(未設定時は "社長日記")
 *   DISCORD_WEBHOOK_URL … エラー通知先(任意・未設定なら通知はスキップ)
 *   NOTIFY_URL          … 新規掲載時に叩く通知GASのウェブアプリURL(任意・未設定ならスキップ)
 *                         ※別途、通知用GASを doPost(e) 付きでウェブアプリ(アクセス:全員)として公開し、そのURLを設定
 */

const DEFAULT_SHEET_ID = "1XPMwWYqNSrJLu7x8RCmX4JGaaU1UE-Ep9v-w5bxC1rs";
const DEFAULT_SHEET_NAME = "社長日記";
const HEADER_ROW = ["更新日", "掲載終了日", "タイトル", "URL", "処理"];

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const cfg = {
    githubToken: props.getProperty("GITHUB_TOKEN"),
    githubOwner: props.getProperty("GITHUB_OWNER"),
    githubRepo: props.getProperty("GITHUB_REPO"),
    sheetId: props.getProperty("SHEET_ID") || DEFAULT_SHEET_ID,
    sheetName: props.getProperty("SHEET_NAME") || DEFAULT_SHEET_NAME,
    discordWebhookUrl: props.getProperty("DISCORD_WEBHOOK_URL"),
    notifyUrl: props.getProperty("NOTIFY_URL"),
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

// 新規掲載時に通知GAS(ウェブアプリ)を叩く。失敗しても本処理は止めない。
function callNotifyGas_(cfg, info) {
  if (!cfg.notifyUrl) return;
  try {
    UrlFetchApp.fetch(cfg.notifyUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(info),
      muteHttpExceptions: true,
      followRedirects: true,
    });
  } catch (e) {
    notifyDiscord_(cfg, `⚠️ Vol.${info.vol} の公開通知(NOTIFY_URL)呼び出しに失敗しました: ${e.message}`);
  }
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

// ISO文字列(YYYY-MM-DD)を Date に変換。不正なら今日。
function isoToDate_(iso) {
  const p = String(iso || "").split("-");
  if (p.length !== 3) return new Date();
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return isNaN(d.getTime()) ? new Date() : d;
}

function formatCellDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy.MM.dd");
  return String(v || "");
}

// URL(…/volXXX.html)から Vol番号を取り出す
function volFromUrl_(url) {
  const m = String(url || "").match(/vol(\d+)\.html/i);
  return m ? m[1] : "";
}

/* ════════════════════════════════════════════════
   GET: ?action=next_vol / ?action=history
   ════════════════════════════════════════════════ */
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || "";
  try {
    const cfg = getConfig_();
    const sheet = getSheet_(cfg);
    const lastRow = sheet.getLastRow();

    if (action === "next_vol") {
      // タイトル列(C)の2行目以降の非空セル数 + 1(専用タブ前提の行数ベース)
      let count = 0;
      if (lastRow >= 2) {
        const titles = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
        count = titles.filter(r => String(r[0]).trim() !== "").length;
      }
      const next = String(count + 1).padStart(3, "0");
      return jsonOut_({ success: true, nextVol: next });
    }

    if (action === "history") {
      const items = [];
      if (lastRow >= 2) {
        const rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
        rows.forEach(row => {
          const title = String(row[2] || "");
          const url = String(row[3] || "");
          if (!title && !url) return; // 空行スキップ
          items.push({
            vol: volFromUrl_(url),
            title: title,
            startDate: formatCellDate_(row[0]),
            endDate: formatCellDate_(row[1]),
            url: url,
          });
        });
      }
      items.reverse(); // 新しい順
      return jsonOut_({ success: true, items: items });
    }

    return jsonOut_({ success: false, error: "不明なaction指定です。" });
  } catch (err) {
    return jsonOut_({ success: false, error: err.message });
  }
}

/* ════════════════════════════════════════════════
   POST: 掲載処理
   body: { volNo:"005", title:"...", startDate:"2026-07-10", endDate:"2036-07-10", html:"<!DOCTYPE ...>" }
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
    const startDate = isoToDate_(payload.startDate);
    const endDate = isoToDate_(payload.endDate);
    const html = String(payload.html || "");
    const isUpdate = payload.isUpdate === true;   // 掲載済み記事の上書き更新か

    if (!volNo || !title || !html) {
      return jsonOut_({ success: false, error: "volNo / title / html は必須です。" });
    }

    const sheet = getSheet_(cfg);

    const fileName = `vol${volNo}.html`;
    const apiBase = `https://api.github.com/repos/${cfg.githubOwner}/${cfg.githubRepo}/contents/${fileName}`;
    const authHeaders = {
      Authorization: `Bearer ${cfg.githubToken}`,
      Accept: "application/vnd.github+json",
    };

    // ── 1. 既存ファイルの有無・sha を取得(更新時は上書きに sha が必要)──
    let existingSha = null;
    const checkRes = UrlFetchApp.fetch(apiBase, { headers: authHeaders, muteHttpExceptions: true });
    if (checkRes.getResponseCode() === 200) {
      existingSha = JSON.parse(checkRes.getContentText()).sha;
    }
    // 新規掲載なのに既に存在 → 誤上書き防止で拒否
    if (existingSha && !isUpdate) {
      return jsonOut_({ success: false, error: `Vol.${volNo}(${fileName})は既に掲載済みです。修正する場合はアプリの「この記事を修正する」から操作してください。` });
    }

    // ── 2. GitHubへcommit(更新時は sha を付けて上書き)──
    const commitPayload = {
      message: isUpdate ? `Vol.${volNo} を更新` : `Vol.${volNo} を公開`,
      content: Utilities.base64Encode(html, Utilities.Charset.UTF_8),
      branch: "main",
    };
    if (existingSha) commitPayload.sha = existingSha;
    const commitRes = UrlFetchApp.fetch(apiBase, {
      method: "put",
      headers: authHeaders,
      contentType: "application/json",
      payload: JSON.stringify(commitPayload),
      muteHttpExceptions: true,
    });
    if (commitRes.getResponseCode() >= 300) {
      throw new Error(`GitHubへのデプロイに失敗しました(${commitRes.getResponseCode()}): ${commitRes.getContentText()}`);
    }

    const publishedUrl = `https://${cfg.githubOwner}.github.io/${cfg.githubRepo}/${fileName}`;

    // ── 3. スプレッドシート ──
    //  更新: URL(D列)一致の既存行を探し A/B/C のみ上書き(D=URL・E=処理 は触らない
    //        → 処理="済" が保たれ再通知なし・行も増えない)。
    //  新規: 1行追記(E=空 → 既存通知システムが未処理として拾い、処理後に自分で「済」にする)。
    try {
      let updated = false;
      if (isUpdate) {
        const values = sheet.getDataRange().getValues();
        for (let i = 1; i < values.length; i++) {
          if (String(values[i][3]) === publishedUrl) {
            const row = i + 1;
            sheet.getRange(row, 1).setValue(startDate); // A 更新日/開始日
            sheet.getRange(row, 2).setValue(endDate);   // B 掲載終了日
            sheet.getRange(row, 3).setValue(title);     // C タイトル
            updated = true;
            break;
          }
        }
      }
      if (!updated) {
        sheet.appendRow([startDate, endDate, title, publishedUrl, ""]);
      }
    } catch (sheetErr) {
      notifyDiscord_(cfg, `⚠️ Vol.${volNo} はGitHubへの${isUpdate ? "更新" : "公開"}に成功しましたが、スプレッドシートへの記録に失敗しました。手動で確認してください。\nURL: ${publishedUrl}\nエラー: ${sheetErr.message}`);
      return jsonOut_({ success: false, error: "GitHubへの反映は完了しましたが、スプレッドシートへの記録に失敗しました。担当者へ連絡してください。" });
    }

    // ── 4. 新規掲載のときだけ、通知GAS(ウェブアプリ)を叩く(修正=上書き更新では叩かない)──
    if (!isUpdate) {
      callNotifyGas_(cfg, {
        vol: volNo,
        title: title,
        url: publishedUrl,
        date: Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy-MM-dd"),
      });
    }

    return jsonOut_({ success: true, url: publishedUrl });
  } catch (err) {
    notifyDiscord_(cfg, `🚨 社長日記の掲載処理でエラーが発生しました: ${err.message}`);
    return jsonOut_({ success: false, error: err.message });
  }
}
