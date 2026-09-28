// 実ブラウザで全経路を通してスクショ（文字あふれ・崩れの目視確認用）
// 実行: node tools/shot.js  → shots/*.png
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'warning') console.log('送信:', m.text().slice(0, 200)); });
  const url = 'file://' + process.cwd() + '/index.html';
  const shot = async name => { await p.waitForTimeout(450); await p.screenshot({ path: `shots/${name}.png`, fullPage: true }); };
  const pick = async (container, text) => p.click(`#${container} .opt-btn:has-text("${text}")`);
  const next = async () => p.click('.slide.active .btn-next:not([disabled])');

  // イントロ
  await p.goto(url); await p.waitForTimeout(800); await shot('01_intro');
  await next(); await shot('02_choice');

  // 選択肢1 → Ｂ → 申請フォーム案内
  await pick('optsChoice', 'キャッシュバックを受けたい'); await next();
  await pick('optsStatus', 'まだ番号を伝えていない'); await shot('03_status'); await next();
  console.log('Bのフォームリンク:', await p.getAttribute('#applyLink', 'href'));
  await shot('04_apply_B');

  // Ｃ → 入力 → 完了
  await p.click('.slide.active .btn-back'); await pick('optsStatus', 'まだインボイス登録'); await next();
  await p.fill('#uName', '山田 太郎'); await p.fill('#uEmail', 'bad'); await p.fill('#uPhone', '090-1234');
  await shot('05_unreg_error');
  await p.fill('#uEmail', 'test@example.com'); await p.fill('#uPhone', '０９０－１２３４－５６７８'); await p.check('#uConsent'); await shot('06_unreg_filled');
  await next(); await p.waitForTimeout(300); await shot('07_unreg_done');

  // 選択肢2 → 青色申告だけ
  await p.goto(url); await next(); await pick('optsChoice', '青色申告だけしたい'); await next();
  await p.fill('#dName', '山田 花子'); await p.fill('#dEmail', 'hanako@example.com'); await p.fill('#dPhone', '08011112222');
  await pick('optsReason', '消費税'); await pick('optsReason', 'その他'); await p.fill('#reasonOther', 'テスト');
  await p.check('#dConsent'); console.log('契約歴チェック前の送信ボタン無効:', await p.isDisabled('#dSubmit')); await p.check('#dNew'); await shot('08_discount'); await next(); await p.waitForTimeout(300); await shot('09_discount_done');

  // 選択肢3 → 診断（白色・500万・経費40%）
  await p.goto(url); await next(); await pick('optsChoice', '確かめたい'); await next();
  await pick('optsMethod', '白色申告'); await shot('10_diag_method'); await next();
  await p.click('#uriageChips .chip:has-text("500万")'); await shot('11_diag_uriage'); await next();
  await p.click('#keihiChips .chip:has-text("40%")'); await shot('12_diag_keihi'); await next();
  await shot('13_result_500');
  console.log('結果:', (await p.textContent('#resLead')).trim());
  // 診断 → 青色申告だけへ
  await p.click('#sResult .btn-sub'); await shot('14_result_to_discount');

  // 診断 → すでに青色（e-Tax）→ 診断しない案内
  await p.goto(url); await next(); await pick('optsChoice', '確かめたい'); await next();
  await pick('optsMethod', 'e-Tax'); await next(); await shot('15_diag_blue_already');
  await p.click('#sBlueAlready .btn-next'); await shot('16_blue_to_unreg');

  console.log('JSエラー:', errors.length ? errors : 'なし');
  await b.close();
})();
