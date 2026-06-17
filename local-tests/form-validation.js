// 本機測試：註冊表單驗證（完整版）
// Playwright（系統 Chrome）操作註冊表單、抓客觀事實；結構性檢查直接判定，錯誤訊息/邊界對錯交給 Claude 判斷。
// 涵蓋：①號碼欄位擋字 ②逐欄位必填 ③電話長度邊界值 ④密碼規則 ⑤錯誤提示正確 ⑥重複手機號
// 安全設計：測長度/密碼規則時，故意讓「另一欄」無效當擋板，確保送出必失敗、不會真的建帳號；只有「重複手機號」會建一個帳號。
const { chromium } = require("playwright-core");
const ai = require("../lib/ai");

const id = "form-validation";
const name = "註冊表單驗證";
const description =
  "用瀏覽器實際操作註冊表單，完整檢查：號碼擋字、逐欄位必填、電話長度邊界值、密碼規則、錯誤提示正確性、重複手機號。結構檢查用 Playwright，訊息對錯交給 Claude 判斷。需要本機有 Chrome。";
const inputs = [
  { key: "siteUrl", label: "目標站 URL", placeholder: "https://www.playdee99.com" },
];

function normUrl(u) {
  let s = (u || "").trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return new URL(s).origin;
}
const digits = (n) => "1".repeat(n);

const allButtons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b, i) => ({ i, text: (b.innerText || "").trim().slice(0, 24), disabled: !!b.disabled }))
  );
const visibleTexts = (page) =>
  page.evaluate(() => {
    const out = new Set();
    document.querySelectorAll("p,span,small,div,label,[role=alert]").forEach((e) => {
      if (e.children.length) return;
      const t = (e.innerText || "").trim();
      if (t && t.length > 1 && t.length < 80 && e.offsetParent !== null) out.add(t);
    });
    return [...out];
  });

// 找電話/密碼欄位 locator
function fields(page) {
  return { phone: page.locator("input[type=number]").first(), pwds: page.locator("input[type=password]") };
}
async function setForm(page, { phone, pwd, confirm }) {
  const { phone: ph, pwds } = fields(page);
  if (phone != null) { await ph.fill(""); if (phone) await ph.fill(phone); }
  const n = await pwds.count();
  if (pwd != null && n >= 1) { await pwds.nth(0).fill(""); if (pwd) await pwds.nth(0).fill(pwd); }
  if (confirm != null && n >= 2) { await pwds.nth(1).fill(""); if (confirm) await pwds.nth(1).fill(confirm); }
}
async function checkAllTC(page) {
  const cbs = page.locator("input[type=checkbox]");
  const n = await cbs.count();
  for (let i = 0; i < n; i++) { try { await cbs.nth(i).check({ timeout: 1000 }); } catch {} }
}
// 按送出鈕並回傳「新出現的文字」
async function submitAndCapture(page, regIndex) {
  const before = new Set(await visibleTexts(page));
  try { await page.locator("button").nth(regIndex).click({ timeout: 4000 }); }
  catch { try { await page.locator("button").nth(regIndex).click({ force: true }); } catch {} }
  await page.waitForTimeout(1200);
  return (await visibleTexts(page)).filter((t) => !before.has(t)).slice(0, 12);
}
// 重新載入頁面（全新、無殘留 toast）→ 填表 → 送出 → 抓訊息。最可靠，避免相同 toast 殘留漏抓
async function freshCapture(page, origin, regIndex, values) {
  await page.goto(origin + "/register", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1800);
  await setForm(page, values);
  await page.waitForTimeout(300);
  return submitAndCapture(page, regIndex);
}

async function run(params, onProgress) {
  const t0 = Date.now();
  const prog = (m) => onProgress && onProgress({ phase: "ai", message: m });
  const origin = normUrl(params.siteUrl);
  const report = {
    testId: id, name, siteUrl: params.siteUrl, startedAt: new Date().toISOString(),
    result: "PASS", walletHost: origin + "/register", steps: [], observations: {},
  };
  const obs = report.observations;

  let browser;
  try {
    prog("開啟瀏覽器、載入註冊頁…");
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(origin + "/register", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    const { phone, pwds } = fields(page);
    if (!(await phone.count()) || !(await pwds.count())) {
      report.steps.push({ name: "找註冊表單", status: "FAIL", detail: "在 /register 找不到電話/密碼欄位" });
      throw new Error("no-form");
    }

    // ① 號碼欄位擋非數字
    prog("① 測號碼欄位擋字…");
    await phone.fill(""); await phone.type("abc123def", { delay: 12 });
    const pv = await phone.inputValue();
    const blocked = !/[a-z]/i.test(pv);
    report.steps.push({ name: "號碼欄位擋非數字", status: blocked ? "PASS" : "FAIL", detail: `輸入 abc123def → 欄位「${pv}」，${blocked ? "字母被擋掉" : "未擋住"}` });

    // 找送出鈕（空白 disabled、填妥 enabled 的那顆）
    prog("觀察送出鈕…");
    await setForm(page, { phone: "", pwd: "", confirm: "" }); await page.waitForTimeout(400);
    const bEmpty = await allButtons(page);
    await setForm(page, { phone: "0812345678", pwd: "abc123", confirm: "abc123" }); await page.waitForTimeout(700);
    const bFull = await allButtons(page);
    const regBtn = bFull.find((b) => !b.disabled && (bEmpty.find((e) => e.i === b.i) || {}).disabled === true);
    const regIndex = regBtn ? regBtn.i : -1;

    // ② 逐欄位必填（用送出鈕是否反灰判斷）
    prog("② 測逐欄位必填…");
    if (regIndex < 0) {
      report.steps.push({ name: "逐欄位必填", status: "FAIL", detail: "找不到會隨填寫切換 enable/disable 的送出鈕，無法逐欄判斷" });
    } else {
      const checkField = async (label, patch) => {
        await setForm(page, { phone: "0812345678", pwd: "abc123", confirm: "abc123" });
        await setForm(page, patch); await page.waitForTimeout(400);
        const b = (await allButtons(page)).find((x) => x.i === regIndex);
        return { label, blocksWhenEmpty: !!(b && b.disabled) };
      };
      const reqResults = [];
      reqResults.push(await checkField("電話", { phone: "" }));
      reqResults.push(await checkField("密碼", { pwd: "" }));
      if ((await pwds.count()) >= 2) reqResults.push(await checkField("確認密碼", { confirm: "" }));
      obs.requiredPerField = reqResults;
      const allBlock = reqResults.every((r) => r.blocksWhenEmpty);
      report.steps.push({
        name: "逐欄位必填",
        status: allBlock ? "PASS" : "FAIL",
        detail: reqResults.map((r) => `${r.label}:${r.blocksWhenEmpty ? "有擋" : "沒擋"}`).join("、"),
      });
    }

    // ③ 電話長度邊界值（擋板：兩次密碼不一致，確保不會真的註冊）
    prog("③ 測電話長度邊界值…");
    obs.phoneBoundary = [];
    if (regIndex >= 0) {
      for (const len of [8, 9, 10, 11]) {
        // 每個長度都重新載入頁面，確保抓到的訊息是這次送出的（避免相同 toast 殘留）
        const msgs = await freshCapture(page, origin, regIndex, { phone: digits(len), pwd: "abc123", confirm: "different999" });
        obs.phoneBoundary.push({ len, messages: msgs });
      }
    }

    // ④ 密碼規則（用「有效電話」當基礎，讓密碼錯誤能單獨顯現；密碼填很短且兩次一致）
    prog("④ 測密碼規則…");
    if (regIndex >= 0) {
      const pwPhone = "08" + Math.floor(10000000 + Math.random() * 89999999); // 10 碼有效
      obs.passwordRuleMessages = await freshCapture(page, origin, regIndex, { phone: pwPhone, pwd: "1", confirm: "1" });
    }

    // ⑤ 一般錯誤提示（電話太短 + 密碼不一致已涵蓋在上面的訊息裡，交給 AI 一起判斷）

    // ⑥ 重複手機號：先用全新號碼真的註冊一次，再開新 context 用同號碼註冊看擋不擋
    prog("⑥ 測重複手機號（會建立一個測試帳號）…");
    const dupPhone = "09" + Math.floor(10000000 + Math.random() * 89999999); // 10 碼
    obs.duplicate = { phone: dupPhone };
    try {
      // 第一次註冊（重新載入 → valid + 勾選條款）
      await page.goto(origin + "/register", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1800);
      await setForm(page, { phone: dupPhone, pwd: "abc123", confirm: "abc123" });
      await checkAllTC(page); await page.waitForTimeout(300);
      const firstMsgs = await submitAndCapture(page, regIndex);
      obs.duplicate.firstRegisterMessages = firstMsgs;
      await page.waitForTimeout(1500);
      // 第二次：全新 context（未登入），同一號碼
      const ctx2 = await browser.newContext();
      const page2 = await ctx2.newPage();
      await page2.goto(origin + "/register", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page2.waitForTimeout(2500);
      const reg2 = (await allButtons(page2)); // 重新定位送出鈕索引（同站結構一致，沿用 regIndex 應可，但保險起見重算）
      await setForm(page2, { phone: dupPhone, pwd: "abc123", confirm: "abc123" });
      await checkAllTC(page2); await page2.waitForTimeout(300);
      // 用同樣方式找送出鈕：填妥後 enabled 且文字與 regBtn 相同
      let idx2 = regIndex;
      const cand = reg2.find((b) => regBtn && b.text === regBtn.text && !b.disabled);
      if (cand) idx2 = cand.i;
      obs.duplicate.secondRegisterMessages = await submitAndCapture(page2, idx2);
      await ctx2.close();
    } catch (e) {
      obs.duplicate.error = String(e.message).slice(0, 100);
    }

    await browser.close(); browser = null;

    // ── 把觀察交給 Claude 一次判斷（邊界、密碼規則、錯誤提示、重複號）──
    prog("Claude 判斷各項結果…");
    const judged = await judge(obs);
    report.steps.push(judged.boundary, judged.passwordRule, judged.errorMsg, judged.duplicate);
  } catch (e) {
    if (e.message !== "no-form")
      report.steps.push({ name: "執行", status: "FAIL", detail: String(e.message).slice(0, 150) });
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }

  // WARN（無法確認）不算失敗；只要沒有 FAIL 就算 PASS
  report.result = report.steps.length && !report.steps.some((s) => s.status === "FAIL") ? "PASS" : "FAIL";
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - t0;
  return report;
}

async function judge(obs) {
  const fb = (name) => ({ name, status: "FAIL", detail: "AI 判斷失敗，可看 observations 人工確認" });
  const result = { boundary: fb("電話長度邊界值"), passwordRule: fb("密碼規則"), errorMsg: fb("錯誤提示正確性"), duplicate: fb("重複手機號") };
  if (!ai.isAvailable()) {
    for (const k of Object.keys(result)) result[k].detail = "需要 Claude 判斷但本機未就緒";
    return result;
  }
  const prompt = `你在審核一個註冊表單的驗證行為是否正確。以下是自動化測到的客觀事實（JSON）。每個情境都「故意讓另一欄無效」以避免真的註冊，所以訊息裡可能同時有多種錯誤，請只看你要判斷的那種。

電話長度邊界（每個長度送出後出現的訊息；擋板=密碼不一致）：
${JSON.stringify(obs.phoneBoundary)}

密碼很短(1碼)、但電話用有效號碼時出現的訊息：
${JSON.stringify(obs.passwordRuleMessages || [])}
（判讀：若出現密碼長度/格式的錯誤提示=有規則(PASS)；若出現「選銀行/帳戶名」等下一步欄位=短密碼被接受、該站沒有密碼長度規則(FAIL，屬資安弱點)。）

重複手機號（先用新號碼註冊、再用同號碼註冊）：
${JSON.stringify(obs.duplicate || {})}
（注意：有些站註冊是「多步驟」，第一次送出後若出現「選銀行/帳戶名/帳號」之類欄位，代表只是進到下一步、帳號可能尚未建立完成，此時重複檢查可能不準，請在 detail 說明這個情況。）

請判斷四件事，只回這個 JSON（不要其他文字）：
{
 "boundary": {"status":"PASS或FAIL","detail":"電話長度驗證是否正確：短的(如8碼)要被擋、合法長度(如9~10)不該出現長度錯誤、過長(11)要被擋。引用觀察說明"},
 "passwordRule": {"status":"PASS或FAIL","detail":"密碼太短時有沒有出現密碼規則的錯誤提示；若該站根本沒有密碼長度規則也說明"},
 "errorMsg": {"status":"PASS或FAIL","detail":"整體錯誤提示是否清楚正確（電話、密碼不一致等訊息合不合理）"},
 "duplicate": {"status":"PASS或FAIL或WARN","detail":"用已註冊的手機號再註冊，第二次有沒有被擋（出現類似『已存在/已被註冊』的訊息）=PASS；明確沒擋=FAIL；若因該站註冊為多步驟、手機在第一步尚未真正註冊完成而無法確認=WARN"}
}`;
  try {
    const j = ai.extractJson(await ai.run(prompt, { timeoutMs: 90000 }));
    if (!j) throw new Error("no json");
    const mk = (name, o) => {
      const s = o && (o.status === "PASS" || o.status === "WARN") ? o.status : "FAIL";
      return { name, status: s, detail: (o && o.detail) || "" };
    };
    return {
      boundary: mk("電話長度邊界值", j.boundary),
      passwordRule: mk("密碼規則", j.passwordRule),
      errorMsg: mk("錯誤提示正確性", j.errorMsg),
      duplicate: mk("重複手機號", j.duplicate),
    };
  } catch {
    return result;
  }
}

module.exports = { id, name, description, inputs, run };
