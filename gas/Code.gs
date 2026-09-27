/**
 * ハコベル×タックスナップ インボイスキャンペーン — 回答受け口・メール自動送信（Google Apps Script）
 *
 * 置き場所: スプレッドシート「ハコベル_インボイスキャンペーン_回答」の 拡張機能 > Apps Script
 *
 * 役割
 *  1. 訴求アンケート（index.html）からの POST を受けてシートに1行追記する
 *     - kind=unregistered … 選択肢1のＣ（未登録）。登録手順メールを自動送信
 *     - kind=discount     … 選択肢2（割引のみ）。1人1コードのクーポンを割り当ててメール送信
 *     - kind=diagnosis    … 選択肢3の診断結果（個人情報なし）
 *  2. インボイス申請アンケート（Googleフォーム）の送信時に、クーポンを割り当ててメール送信
 *  3. 毎朝、未登録者にリマインドメールを送る（14日後・30日後・締切7日前）。
 *     申請フォームに同じメールアドレスの回答があれば「申請済み」にして止める
 *
 * 【セットアップ】README.md の「GAS セットアップ手順」を参照。要点:
 *  1. このコードを貼る
 *  2. プロジェクトの設定 > スクリプト プロパティ に下の PROPS を登録
 *  3. エディタで setup を1回実行（シート作成＋トリガー登録。初回は権限の承認が出る）
 *  4. デプロイ > 新しいデプロイ > ウェブアプリ（実行ユーザー=自分 / アクセス=全員）
 *  5. /exec URL を index.html の GAS_URL に貼る
 *
 * スクリプト プロパティ
 *  POST_TOKEN   … index.html の POST_TOKEN と同じ文字列（必須）
 *  FORM_ID      … インボイス申請アンケートのフォームID（必須）
 *  FORM_URL     … 申請アンケートの回答用URL（メール本文に載せる。必須）
 *  WEB_URL      … クーポンを入力する申込先（既定 https://app.taxnap.com）
 *  DEADLINE     … 申請の締切日 yyyy-MM-dd（未定なら空。空のあいだ締切前リマインドは送らない）
 *  SENDER_NAME  … 差出人名（既定「タックスナップ キャンペーン事務局」）
 *  FROM_ALIAS   … 差出人アドレスを共有アドレスにする場合。Gmail の「送信元として追加」済みの別名のみ可（任意）
 *  REPLY_TO     … 返信先アドレス（任意）
 *  CONTACT      … 問い合わせ先の表示文言（未定の間は「？？？」）
 */

// ============================================================
// シート定義。key = 送信ペイロードのキー / label = シートの見出し
// key は index.html と対応するため変更しない。label は変えてよい
// ============================================================
var SHEETS = {
  unregistered: {
    name: '未登録者',
    cols: [
      { key: 'received_at',   label: '受信時刻(JST)' },
      { key: 'name',          label: '氏名' },
      { key: 'email',         label: 'メールアドレス' },
      { key: 'driver_id',     label: 'ドライバーID' },
      { key: 'consent',       label: '同意' },
      { key: 'company_id',    label: '配布元コード' },
      { key: 'mail_guide',    label: '手順メール送信' },
      { key: 'mail_r1',       label: 'リマインド1(14日後)' },
      { key: 'mail_r2',       label: 'リマインド2(30日後)' },
      { key: 'mail_r3',       label: 'リマインド3(締切前)' },
      { key: 'applied',       label: '申請済み' },
      { key: 'user_agent',    label: 'ブラウザ情報' }
    ]
  },
  discount: {
    name: '割引のみ',
    cols: [
      { key: 'received_at',   label: '受信時刻(JST)' },
      { key: 'name',          label: '氏名' },
      { key: 'email',         label: 'メールアドレス' },
      { key: 'driver_id',     label: 'ドライバーID' },
      { key: 'reasons',       label: '登録しない理由(複数)' },
      { key: 'reason_free',   label: '理由(自由記述)' },
      { key: 'consent',       label: '同意' },
      { key: 'company_id',    label: '配布元コード' },
      { key: 'coupon',        label: '配布クーポン' },
      { key: 'user_agent',    label: 'ブラウザ情報' }
    ]
  },
  diagnosis: {
    name: '診断ログ',
    cols: [
      { key: 'received_at',   label: '受信時刻(JST)' },
      { key: 'method',        label: '申告方法' },
      { key: 'uriage',        label: '売上(円)' },
      { key: 'keihi',         label: '経費(円)' },
      { key: 'tedori_now',    label: '手取り(いま/2027年分)' },
      { key: 'tedori_blue',   label: '手取り(青色・登録なし)' },
      { key: 'tedori_invoice',label: '手取り(青色・登録あり)' },
      { key: 'ctax',          label: '消費税(3割特例)' },
      { key: 'next_choice',   label: '診断後に選んだ案内' },
      { key: 'company_id',    label: '配布元コード' },
      { key: 'user_agent',    label: 'ブラウザ情報' }
    ]
  },
  applied: {
    name: '申請フォーム回答',
    cols: [
      { key: 'received_at',   label: '受信時刻(JST)' },
      { key: 'status',        label: '登録状況' },
      { key: 'invoice_no',    label: 'インボイス登録番号' },
      { key: 'name',          label: '氏名' },
      { key: 'driver_id',     label: 'ドライバーID' },
      { key: 'email',         label: 'タックスナップ登録メール' },
      { key: 'consent',       label: '同意' },
      { key: 'coupon',        label: '配布クーポン' },
      { key: 'check_paid',    label: '有料契約の確認(手作業)' },
      { key: 'check_nta',     label: '国税庁で番号確認(手作業)' },
      { key: 'sent_hacobell', label: 'ハコベル連携日(手作業)' }
    ]
  },
  coupons: {
    name: 'クーポン在庫',
    cols: [
      { key: 'code',          label: 'コード' },
      { key: 'state',         label: '状態(空欄=未使用)' },
      { key: 'email',         label: '配布先メール' },
      { key: 'route',         label: '配布経路' },
      { key: 'sent_at',       label: '配布日時' }
    ]
  },
  log: {
    name: '送信ログ',
    cols: [
      { key: 'at',            label: '日時(JST)' },
      { key: 'type',          label: '種別' },
      { key: 'email',         label: '宛先' },
      { key: 'result',        label: '結果' }
    ]
  }
};

// 申請フォームの設問タイトル → 保存キー（フォームの設問名を変えたらここも直す）
var FORM_TITLES = {
  'インボイス登録の状況を教えてください': 'status',
  'インボイス登録番号（T＋13桁）': 'invoice_no',
  '氏名（フルネーム）': 'name',
  'ハコベルのドライバーID': 'driver_id',
  'タックスナップに登録しているメールアドレス': 'email',
  '個人情報の提供への同意': 'consent'
};

// ============================================================
// 設定
// ============================================================
function prop_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === '') ? (fallback === undefined ? '' : fallback) : v;
}
function nowJst_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
}

// ============================================================
// セットアップ（エディタから1回だけ実行）
// ============================================================
function setup() {
  Object.keys(SHEETS).forEach(function (k) { getSheet_(k); });

  // 既存のトリガーを消してから登録し直す（二重登録で同じメールが2通届くのを防ぐ）
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyReminder').timeBased().atHour(9).everyDays(1)
    .inTimezone('Asia/Tokyo').create();
  var formId = prop_('FORM_ID');
  if (formId) {
    ScriptApp.newTrigger('onApplyFormSubmit').forForm(formId).onFormSubmit().create();
  } else {
    throw new Error('スクリプト プロパティ FORM_ID が未設定です');
  }
  Logger.log('セットアップ完了: シート作成・トリガー登録（毎朝9時のリマインド／フォーム送信時のクーポン送付）');
}

// ============================================================
// 訴求アンケートからの受信
// ============================================================
function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return jsonOut_({ ok: false, error: 'busy' }); }

  try {
    if (!e || !e.postData || !e.postData.contents) return jsonOut_({ ok: false, error: 'empty_body' });
    var data = JSON.parse(e.postData.contents);

    var expected = prop_('POST_TOKEN');
    if (!expected || data._token !== expected) return jsonOut_({ ok: false, error: 'unauthorized' });

    var kind = data._kind;
    if (!SHEETS[kind] || ['unregistered', 'discount', 'diagnosis'].indexOf(kind) < 0) {
      return jsonOut_({ ok: false, error: 'bad_kind' });
    }
    data.received_at = nowJst_();

    if (kind === 'unregistered') {
      data.mail_guide = sendGuideMail_(data) ? nowJst_() : '送信失敗';
    }
    if (kind === 'discount') {
      data.coupon = issueCoupon_(data.email, '割引のみ', data.name);
    }
    appendRow_(kind, data);
    return jsonOut_({ ok: true });
  } catch (err) {
    console.error(err);
    return jsonOut_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** 動作確認用。/exec を開くと件数が見える（個人情報は返さない） */
function doGet() {
  var out = { ok: true };
  ['unregistered', 'discount', 'diagnosis', 'applied'].forEach(function (k) {
    out[k] = Math.max(getSheet_(k).getLastRow() - 1, 0);
  });
  out.coupons_left = countUnusedCoupons_();
  return jsonOut_(out);
}

// ============================================================
// 申請フォーム送信時（インストール型トリガー）
// ============================================================
function onApplyFormSubmit(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = { received_at: nowJst_() };
    e.response.getItemResponses().forEach(function (ir) {
      var key = FORM_TITLES[ir.getItem().getTitle()];
      if (!key) return;
      var v = ir.getResponse();
      data[key] = Array.isArray(v) ? v.join(', ') : String(v).trim();
    });
    if (data.invoice_no) data.invoice_no = normalizeInvoiceNo_(data.invoice_no);
    data.coupon = data.email ? issueCoupon_(data.email, '申請フォーム', data.name) : '';
    appendRow_('applied', data);
    markApplied_(data.email);
  } finally {
    lock.releaseLock();
  }
}

/** 全角→半角、先頭Tの補完（照合しやすくするため。元の入力の意味は変えない） */
function normalizeInvoiceNo_(s) {
  s = String(s).replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  }).replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(s)) s = 'T' + s;
  return s;
}

// ============================================================
// クーポン（1人1コード）
// ============================================================
/**
 * 同じメールアドレスには同じコードを返す（再申請で2枚目を渡さない）。
 * 在庫が無いときは「在庫切れ」と記録し、メールでは後日送付と案内する。
 * 在庫を補充したら sendPendingCoupons を実行すると未送付の人に送る。
 */
function issueCoupon_(email, route, name) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return '';
  var sh = getSheet_('coupons');
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, 5).getValues() : [];

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][2]).toLowerCase() === email) {
      sendCouponMail_(email, name, rows[i][0]);
      return rows[i][0];
    }
  }
  for (var j = 0; j < rows.length; j++) {
    if (rows[j][0] && !rows[j][1]) {
      sh.getRange(j + 2, 2, 1, 4).setValues([['配布済', email, route, nowJst_()]]);
      sendCouponMail_(email, name, rows[j][0]);
      return rows[j][0];
    }
  }
  sendCouponMail_(email, name, '');
  return '在庫切れ（未送付）';
}

function countUnusedCoupons_() {
  var sh = getSheet_('coupons');
  var last = sh.getLastRow();
  if (last < 2) return 0;
  return sh.getRange(2, 1, last - 1, 2).getValues()
    .filter(function (r) { return r[0] && !r[1]; }).length;
}

/** 在庫切れで未送付になった人に、補充後まとめて送る（エディタから手動実行） */
function sendPendingCoupons() {
  ['discount', 'applied'].forEach(function (kind) {
    var sh = getSheet_(kind);
    var cols = SHEETS[kind].cols.map(function (c) { return c.key; });
    var ci = cols.indexOf('coupon'), ei = cols.indexOf('email'), ni = cols.indexOf('name');
    var last = sh.getLastRow();
    if (last < 2) return;
    var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
    vals.forEach(function (r, idx) {
      if (String(r[ci]).indexOf('在庫切れ') === 0) {
        var code = issueCoupon_(r[ei], kind === 'discount' ? '割引のみ' : '申請フォーム', r[ni]);
        sh.getRange(idx + 2, ci + 1).setValue(code);
      }
    });
  });
}

// ============================================================
// リマインド（毎朝9時）
// ============================================================
function dailyReminder() {
  var sh = getSheet_('unregistered');
  var cols = SHEETS.unregistered.cols.map(function (c) { return c.key; });
  var last = sh.getLastRow();
  if (last < 2) return;
  var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
  var appliedEmails = appliedEmailSet_();
  var today = new Date();
  var deadline = prop_('DEADLINE') ? new Date(prop_('DEADLINE') + 'T23:59:59+09:00') : null;

  vals.forEach(function (r, idx) {
    var row = idx + 2;
    var get = function (k) { return r[cols.indexOf(k)]; };
    var set = function (k, v) { sh.getRange(row, cols.indexOf(k) + 1).setValue(v); };
    var email = String(get('email')).trim().toLowerCase();
    if (!email || get('applied')) return;
    if (appliedEmails[email]) { set('applied', nowJst_()); return; }
    if (deadline && today > deadline) return;

    var start = new Date(String(get('received_at')).replace(' ', 'T') + '+09:00');
    var days = Math.floor((today - start) / 86400000);

    if (days >= 14 && !get('mail_r1')) {
      set('mail_r1', sendReminderMail_(r, cols, 1) ? nowJst_() : '送信失敗');
    } else if (days >= 30 && !get('mail_r2')) {
      set('mail_r2', sendReminderMail_(r, cols, 2) ? nowJst_() : '送信失敗');
    } else if (deadline && !get('mail_r3') && (deadline - today) / 86400000 <= 7) {
      set('mail_r3', sendReminderMail_(r, cols, 3) ? nowJst_() : '送信失敗');
    }
  });
}

/** 申請フォームに回答済みのメールアドレス一覧（大文字小文字は区別しない） */
function appliedEmailSet_() {
  var set = {};
  var sh = getSheet_('applied');
  var cols = SHEETS.applied.cols.map(function (c) { return c.key; });
  var last = sh.getLastRow();
  if (last < 2) return set;
  sh.getRange(2, cols.indexOf('email') + 1, last - 1, 1).getValues().forEach(function (r) {
    var v = String(r[0]).trim().toLowerCase();
    if (v) set[v] = true;
  });
  return set;
}

function markApplied_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return;
  var sh = getSheet_('unregistered');
  var cols = SHEETS.unregistered.cols.map(function (c) { return c.key; });
  var last = sh.getLastRow();
  if (last < 2) return;
  var ei = cols.indexOf('email'), ai = cols.indexOf('applied');
  sh.getRange(2, 1, last - 1, cols.length).getValues().forEach(function (r, idx) {
    if (String(r[ei]).trim().toLowerCase() === email && !r[ai]) {
      sh.getRange(idx + 2, ai + 1).setValue(nowJst_());
    }
  });
}

// ============================================================
// メール本文
// ============================================================
var NTA_INVOICE_URL = 'https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice.htm';

function footer_() {
  return [
    '',
    '――――――――――――――――',
    'ハコベル×タックスナップ 1年目の利用料キャッシュバックキャンペーン',
    '運営：株式会社タックスナップ',
    'お問い合わせ：' + prop_('CONTACT', '？？？'),
    'プライバシーポリシー：https://taxnap.com/privacy_policy',
    '※ このメールは、キャンペーンにお申し込みいただいた方にお送りしています。',
    '　 今後の案内が不要な場合は、このメールにその旨ご返信ください。'
  ].join('\n');
}

function sendGuideMail_(d) {
  var body = [
    (d.name || '') + ' 様',
    '',
    'ハコベル×タックスナップ「1年目の利用料キャッシュバック」キャンペーンにお申し込みいただき、ありがとうございます。',
    'インボイス登録の手順をお送りします。',
    '',
    '■ インボイス登録の手順',
    '1. 税務署に「適格請求書発行事業者の登録申請書」を提出します',
    '   マイナンバーカードがあれば、e-Tax でスマホから提出できます',
    '   2027年1月1日から登録するには、2026年12月17日（木）までに申請してください',
    '   国税庁の案内：' + NTA_INVOICE_URL,
    '2. 税務署から登録の通知が届きます（届くまでの期間は時期により異なります）',
    '3. 通知に記載された登録番号（T＋13桁）を、下の申請フォームに入力してください',
    '   ' + prop_('FORM_URL'),
    '',
    '■ ご注意',
    '・インボイス登録をすると課税事業者となり、登録日から消費税の申告・納税が必要になります',
    '　（納税額を軽くする特例があります。詳しくは上記の国税庁の案内をご覧ください）',
    '・申請フォームの送信後、ハコベル特別価格（1年目19,800円）のクーポンをお送りします',
    '・キャッシュバックの条件：2027年のハコベル経由の取引額が100万円以上、かつインボイス番号をハコベルに登録していること',
    '　（2028年1月を目処に、ハコベルから19,800円をキャッシュバックします）',
    prop_('DEADLINE') ? '・申請の締切：' + prop_('DEADLINE') : '・申請の締切：？？？',
    '',
    '登録番号が届くまで、何度かリマインドのメールをお送りします。',
    footer_()
  ].join('\n');
  return mail_(d.email, '【タックスナップ】インボイス登録の手順のご案内', body, 'guide');
}

function sendReminderMail_(r, cols, n) {
  var name = r[cols.indexOf('name')];
  var email = r[cols.indexOf('email')];
  var lead = {
    1: 'インボイス登録の進み具合はいかがでしょうか。',
    2: '税務署から登録番号の通知は届きましたか。',
    3: '申請の締切が近づいています（締切：' + prop_('DEADLINE') + '）。'
  }[n];
  var body = [
    (name || '') + ' 様',
    '',
    lead,
    '登録番号（T＋13桁）が届いたら、こちらの申請フォームに入力してください。',
    prop_('FORM_URL'),
    '',
    'まだ登録申請をしていない方は、国税庁の案内から手続きできます。',
    NTA_INVOICE_URL,
    '',
    '※ すでに申請フォームを送信済みの方は、行き違いですのでご容赦ください。',
    footer_()
  ].join('\n');
  return mail_(email, '【タックスナップ】インボイス登録番号のご入力のお願い', body, 'reminder' + n);
}

function sendCouponMail_(email, name, code) {
  var web = prop_('WEB_URL', 'https://app.taxnap.com');
  var body = code ? [
    (name || '') + ' 様',
    '',
    'ハコベル特別価格（安心プラン1年目 19,800円・税抜）のクーポンをお送りします。',
    '',
    '■ クーポンコード：' + code,
    '',
    '■ 使い方',
    '1. こちらからタックスナップにログイン（初めての方は新規登録）：' + web,
    '2. 料金プランの画面で「安心プラン」を選び、クーポンコードを入力してお申し込みください',
    '',
    '■ ご注意',
    '・割引はWebからのお申し込みに限ります（App Store／Google Play での購入には使えません）',
    '・クーポンはお一人さま1回限り、初めてのご契約に限り使えます',
    '・キャッシュバックは、2027年のハコベル経由の取引額が100万円以上で、インボイス番号をハコベルに登録している方が対象です（2028年1月を目処）',
    footer_()
  ].join('\n') : [
    (name || '') + ' 様',
    '',
    'お申し込みありがとうございます。',
    'ただいまクーポンの準備中のため、準備ができしだい、このメールアドレスにお送りします。',
    footer_()
  ].join('\n');
  return mail_(email, '【タックスナップ】ハコベル特別価格クーポンのお届け', body, code ? 'coupon' : 'coupon_pending');
}

function mail_(to, subject, body, type) {
  to = String(to || '').trim();
  if (!to) return false;
  try {
    var opts = { name: prop_('SENDER_NAME', 'タックスナップ キャンペーン事務局') };
    if (prop_('FROM_ALIAS')) opts.from = prop_('FROM_ALIAS');
    if (prop_('REPLY_TO')) opts.replyTo = prop_('REPLY_TO');
    GmailApp.sendEmail(to, subject, body, opts);
    log_(type, to, 'OK');
    return true;
  } catch (err) {
    log_(type, to, 'NG: ' + err);
    return false;
  }
}

// ============================================================
// シート共通
// ============================================================
function getSheet_(kind) {
  var def = SHEETS[kind];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
  if (sh.getLastRow() === 0) {
    var labels = def.cols.map(function (c) { return c.label; });
    sh.getRange(1, 1, 1, labels.length).setValues([labels]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 先頭が = + - @ の入力は数式として実行されないよう ' を付ける */
function safe_(v) {
  v = String(v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function appendRow_(kind, data) {
  var row = SHEETS[kind].cols.map(function (c) {
    var v = data[c.key];
    if (v === undefined || v === null) return '';
    return safe_(Array.isArray(v) ? v.join(', ') : String(v));
  });
  getSheet_(kind).appendRow(row);
}

function log_(type, to, result) {
  getSheet_('log').appendRow([nowJst_(), type, to, result]);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
