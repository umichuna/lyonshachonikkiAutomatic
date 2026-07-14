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
const HEADER_ROW = ["更新日", "掲載終了日", "タイトル", "URL", "処理", "取り消し"];

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

// GitHubに問い合わせて、オーナー名・リポジトリ名の「正式な綴り(大文字小文字)」を取得する。
// GitHub Pages は公開URLのリポジトリ名部分の大文字小文字を区別するため、
// スクリプトプロパティ GITHUB_REPO の綴りがずれていてもここで正しい綴りに補正する。
// 取得結果は 6 時間キャッシュし、毎回のAPI呼び出しを避ける。取得失敗時は設定値のまま。
function getCanonicalNames_(cfg) {
  const fallback = { owner: cfg.githubOwner, repo: cfg.githubRepo };
  const cache = CacheService.getScriptCache();
  const cacheKey = "canon:" + cfg.githubOwner + "/" + cfg.githubRepo;
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) { /* 壊れていたら取り直す */ } }
  try {
    const res = UrlFetchApp.fetch(`https://api.github.com/repos/${cfg.githubOwner}/${cfg.githubRepo}`, {
      headers: { Authorization: `Bearer ${cfg.githubToken}`, Accept: "application/vnd.github+json" },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() === 200) {
      const j = JSON.parse(res.getContentText());
      const result = {
        owner: (j.owner && j.owner.login) || cfg.githubOwner,
        repo: j.name || cfg.githubRepo,
      };
      cache.put(cacheKey, JSON.stringify(result), 21600); // 6時間
      return result;
    }
  } catch (e) { /* 通信失敗時はフォールバック */ }
  return fallback;
}

// 公開URL(…/<repo>/volXXX.html)のリポジトリ名部分を、正式な綴りに置き換える。
function fixRepoCase_(url, canonicalRepo) {
  return String(url || "").replace(/(\.github\.io\/)[^/]+(\/)/i, `$1${canonicalRepo}$2`);
}

// 記事を取り消す(取り下げる): 掲載終了日(B)を今日にし、F列に「取り消し」印を付ける。
// Vol番号で該当行を照合(保存先パスや綴りに依存しない)。GitHubファイル・E列は触らない。
function cancelArticle_(cfg, volNo) {
  if (!volNo) return jsonOut_({ success: false, error: "volNo は必須です。" });
  const sheet = getSheet_(cfg);
  const values = sheet.getDataRange().getValues();
  // F1(ヘッダー)が空なら「取り消し」ラベルを付け、一覧を分かりやすくする。
  if (!String((values[0] || [])[5] || "").trim()) sheet.getRange(1, 6).setValue("取り消し");
  const today = new Date();
  for (let i = 1; i < values.length; i++) {
    const rowVol = volFromUrl_(values[i][3]);
    if (rowVol && rowVol.padStart(3, "0") === volNo.padStart(3, "0")) {
      const row = i + 1;
      sheet.getRange(row, 2).setValue(today);        // B 掲載終了日=今日(取り下げ)
      sheet.getRange(row, 6).setValue("取り消し");    // F 取り消し印
      return jsonOut_({ success: true });
    }
  }
  return jsonOut_({ success: false, error: `Vol.${volNo} が掲載履歴に見つかりませんでした。` });
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
      const canon = getCanonicalNames_(cfg);
      const items = [];
      if (lastRow >= 2) {
        const rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues(); // A〜F(Fは取り消し印)
        rows.forEach(row => {
          const title = String(row[2] || "");
          const url = String(row[3] || "");
          if (!title && !url) return; // 空行スキップ
          items.push({
            vol: volFromUrl_(url),
            title: title,
            startDate: formatCellDate_(row[0]),
            endDate: formatCellDate_(row[1]),
            url: fixRepoCase_(url, canon.repo), // 古い行の綴りずれもここで補正して返す
            canceled: String(row[5] || "").trim() === "取り消し", // F列
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

    // ── 記事の取り消し(取り下げ)──
    //  掲載終了日(B)を今日にして表示から外し、F列に「取り消し」印を付ける。
    //  GitHubのファイル・Vol番号・E列(処理)は残す(採番はずれない・再通知しない)。
    if (payload.action === "cancel") {
      return cancelArticle_(cfg, String(payload.volNo || "").trim());
    }

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
    const folderPath = `past-articles`;
    const filePath = `${folderPath}/${fileName}`;
    const apiBase = `https://api.github.com/repos/${cfg.githubOwner}/${cfg.githubRepo}/contents/${filePath}`;
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

    // 公開URLは設定値の綴りに依存せず、GitHubが返す正式名称(大文字小文字が正)で組み立てる。
    // これで GITHUB_REPO の綴りがずれていても、公開URL・シート記録・通知はすべて正しいURLになる。
    const canon = getCanonicalNames_(cfg);
    const publishedUrl = `https://${canon.owner}.github.io/${canon.repo}/${filePath}`;

    // ── 3. スプレッドシート ──
    //  更新: Vol番号一致の既存行を探し A/B/C/D を上書き(E=処理 は触らない
    //        → 処理="済" が保たれ再通知なし・行も増えない)。D(URL)は保存先変更
    //        (直下→past-articles/)に追随させ、古いデッドリンクを新URLへ移行する。
    //        URL完全一致だと保存先パスが変わった際に旧行を拾えず重複行になるため、
    //        ファイル名 volXXX.html から取れるVol番号で照合する(パス差異・大文字小文字に強い)。
    //  新規: 1行追記(E=空 → 既存通知システムが未処理として拾い、処理後に自分で「済」にする)。
    try {
      let updated = false;
      if (isUpdate) {
        const values = sheet.getDataRange().getValues();
        for (let i = 1; i < values.length; i++) {
          const rowVol = volFromUrl_(values[i][3]);
          if (rowVol && rowVol.padStart(3, "0") === volNo.padStart(3, "0")) {
            const row = i + 1;
            sheet.getRange(row, 1).setValue(startDate);    // A 更新日/開始日
            sheet.getRange(row, 2).setValue(endDate);      // B 掲載終了日
            sheet.getRange(row, 3).setValue(title);        // C タイトル
            sheet.getRange(row, 4).setValue(publishedUrl); // D URL(保存先変更に追随)
            sheet.getRange(row, 6).setValue("");           // F 再掲載したら「取り消し」印を解除
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
