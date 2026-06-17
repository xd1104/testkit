// 本機測試：註冊表單驗證（跨平台適應版）
// Playwright（系統 Chrome）操作註冊表單；結構性檢查寫死、模糊判斷交給 Claude。
// 適應不同平台：表單可能在 /register 頁、也可能是點「Sign up」開的彈窗；欄位用型別+placeholder 辨識。
// 涵蓋：①號碼欄位擋字 ②逐欄位必填 ③電話長度邊界值 ④密碼規則 ⑤錯誤提示正確 ⑥重複手機號
const { chromium } = require("playwright-core");
const ai = require("../lib/ai");

const id = "form-validation";
const name = "註冊表單驗證";
const description =
  "用瀏覽器實際操作註冊表單，完整檢查：號碼擋字、逐欄位必填、電話長度邊界值、密碼規則、錯誤提示正確性、重複手機號。會自動適應不同平台（/register 頁或 Sign up 彈窗）。結構檢查用 Playwright，訊息對錯交給 Claude。需要本機有 Chrome。";
const inputs = [{ key: "siteUrl", label: "目標站 URL", placeholder: "https://www.playdee99.com" }];

function normUrl(u) {
  let s = (u || "").trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return new URL(s).origin;
}
const digits = (n) => "0".repeat(Math.max(0, n - 1)) + "9"; // n 碼數字（避免全 0 被當空）
const randPhone = () => "08" + Math.floor(10000000 + Math.random() * 89999999);

// 正確的可見判斷（offsetParent 對 position:fixed 的彈窗永遠是 null，不能用）。以字串注入到 page 內 eval。
const VIS = `(el)=>{const r=el.getClientRects();if(!r.length||r[0].width<=0||r[0].height<=0)return false;const s=getComputedStyle(el);return s.visibility!=='hidden'&&s.display!=='none';}`;
const pwCount = (page) => page.evaluate((s) => [...document.querySelectorAll("input[type=password]")].filter(eval(s)).length, VIS);
const visibleTexts = (page) =>
  page.evaluate((s) => {
    const vis = eval(s); const out = new Set();
    document.querySelectorAll("p,span,small,div,label,[role=alert]").forEach((e) => {
      if (e.children.length) return;
      const t = (e.innerText || "").trim();
      if (t && t.length > 1 && t.length < 80 && vis(e)) out.add(t);
    });
    return [...out];
  }, VIS);
const allButtons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b, i) => ({ i, text: (b.innerText || "").trim().slice(0, 24), disabled: !!b.disabled }))
  );

// 開啟註冊表單：先試 /register，沒表單就回首頁 JS 點 Sign up 開彈窗。以「有 >=2 個密碼欄」判定註冊表單出現
async function openRegisterForm(page, origin) {
  await page.goto(origin + "/register", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if ((await pwCount(page)) >= 2) return true;
  await page.goto(origin + "/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const re = /sign\s*up|register|create account|join now|join|註冊|สมัคร/i;
    const el = [...document.querySelectorAll("button,a")].find((x) => re.test((x.innerText || "") + " " + (x.getAttribute && x.getAttribute("aria-label") || "")));
    if (el) el.click();
  });
  await page.waitForTimeout(3000);
  return (await pwCount(page)) >= 2;
}

// 辨識欄位（回傳每個可見 input 的 index[在可見集合內] 與語意 kind）
async function locateFields(page) {
  return page.evaluate((s) => {
    const vis = eval(s);
    const all = [...document.querySelectorAll("input")]; // i = 全域索引（與 page.locator("input").nth(i) 一致）
    // 以「可見的 電話+密碼 欄位之共同祖先」當作註冊表單容器，只取容器內欄位 → 排除聊天框/搜尋框，也鎖定可見的那份表單
    const visIn = all.filter(vis);
    const phoneRe = /phone|mobile|tel|เบอร|手機|電話|号码|號碼/;
    const anchors = visIn.filter((e) => e.type === "password");
    const phoneEl = visIn.find((e) => e.type === "number" || e.type === "tel" || phoneRe.test((e.placeholder || "").toLowerCase()));
    if (phoneEl) anchors.push(phoneEl);
    let container = anchors[0] || null;
    if (container) { while (container && !anchors.every((a) => container.contains(a))) container = container.parentElement; }
    container = container || document.body;
    const fields = [];
    let pwSeen = 0;
    all.forEach((e, i) => {
      if (!vis(e) || !container.contains(e)) return; // 只取「表單容器內」的可見欄位
      const ph = (e.placeholder || "").toLowerCase();
      const type = e.type;
      if (["checkbox", "radio", "hidden", "submit", "button"].includes(type)) return;
      let kind;
      if (type === "password") { pwSeen++; kind = pwSeen === 1 ? "password" : "confirm"; }
      else if (type === "email" || /e-?mail|郵|信箱/.test(ph)) kind = "email";
      else if (type === "number" || type === "tel" || /phone|mobile|tel|เบอร|手機|電話|号码|號碼/.test(ph)) kind = "phone";
      else if (/refer|invit|推薦|邀請|optional|選填|ไม่จำเป็น/.test(ph)) kind = "optional";
      else kind = "text";
      fields.push({ i, kind, type });
    });
    return fields;
  }, VIS);
}

// 把所有必填欄位填有效值；overrides 依 kind 覆蓋（值為 "" 代表清空）
async function fillValid(page, fields, overrides = {}) {
  const rnd = Math.random().toString(36).slice(2, 8);
  const dft = { phone: randPhone(), password: "abc123", confirm: "abc123", email: "qa" + rnd + "@test.com", text: "qa" + rnd };
  for (const f of fields) {
    if (f.kind === "optional") continue;
    const v = overrides[f.kind] !== undefined ? overrides[f.kind] : dft[f.kind];
    if (v === undefined) continue;
    const loc = page.locator("input").nth(f.i);
    try { await loc.fill(""); if (v !== "") await loc.fill(v); } catch {}
  }
}
async function checkAllTC(page) {
  const cbs = page.locator("input[type=checkbox]");
  const n = await cbs.count();
  for (let i = 0; i < n; i++) { try { await cbs.nth(i).check({ timeout: 800 }); } catch {} }
}
// 幾何定位送出鈕：在「最低欄位下方、且水平對齊」的按鈕（比靠 disabled 切換通用，適用按下才驗證的站）
async function findSubmitIndex(page, fields) {
  return page.evaluate(({ idxs }) => {
    const all = [...document.querySelectorAll("input")];
    const boxes = idxs.map((i) => all[i]).filter(Boolean).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    if (!boxes.length) return -1;
    const lowest = Math.max(...boxes.map((b) => b.bottom));
    const cx = boxes[0].left + boxes[0].width / 2;
    const btns = [...document.querySelectorAll("button")];
    let best = -1, bestDist = 1e9;
    btns.forEach((b, i) => {
      const r = b.getBoundingClientRect();
      if (r.width < 40 || r.height < 10 || r.bottom <= 0) return;
      if (r.top < lowest - 8) return; // 必須在欄位下方
      const dist = (r.top - lowest) + Math.abs(r.left + r.width / 2 - cx) * 0.3;
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  }, { idxs: fields.map((f) => f.i) });
}
// JS 點按鈕（繞過動畫造成的 not stable）
async function jsClick(page, btnIndex) {
  await page.evaluate((i) => { const b = document.querySelectorAll("button")[i]; if (b) b.click(); }, btnIndex);
}
// 重新開表單 → 填表 → 送出 → 回傳新出現的文字
async function freshCapture(page, origin, btnIndex, overrides) {
  await openRegisterForm(page, origin);
  const fields = await locateFields(page);
  await fillValid(page, fields, overrides);
  await checkAllTC(page);
  await page.waitForTimeout(300);
  const before = new Set(await visibleTexts(page));
  await jsClick(page, btnIndex);
  await page.waitForTimeout(1300);
  return (await visibleTexts(page)).filter((t) => !before.has(t)).slice(0, 12);
}

async function run(params, onProgress) {
  const t0 = Date.now();
  const prog = (m) => onProgress && onProgress({ phase: "ai", message: m });
  const origin = normUrl(params.siteUrl);
  const report = { testId: id, name, siteUrl: params.siteUrl, startedAt: new Date().toISOString(), result: "PASS", walletHost: origin, steps: [], observations: {} };
  const obs = report.observations;

  let browser;
  try {
    prog("開啟瀏覽器、找註冊表單…");
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    if (!(await openRegisterForm(page, origin))) {
      report.steps.push({ name: "找註冊表單", status: "FAIL", detail: "試過 /register 與點 Sign up，都找不到含密碼欄的註冊表單" });
      throw new Error("no-form");
    }
    let fields = await locateFields(page);
    obs.fields = fields.map((f) => f.kind);
    const phoneF = fields.find((f) => f.kind === "phone");
    const hasPwd = fields.some((f) => f.kind === "password");
    if (!phoneF || !hasPwd) {
      report.steps.push({ name: "找註冊表單", status: "FAIL", detail: "找不到電話或密碼欄位。實際欄位：" + obs.fields.join(",") });
      throw new Error("no-form");
    }

    // ① 號碼欄位擋非數字
    prog("① 測號碼欄位擋字…");
    const ph = page.locator("input").nth(phoneF.i);
    await ph.fill(""); await ph.type("abc123def", { delay: 12 });
    const pv = await ph.inputValue();
    const blocked = !/[a-z]/i.test(pv);
    report.steps.push({ name: "號碼欄位擋非數字", status: blocked ? "PASS" : "FAIL", detail: `輸入 abc123def → 欄位「${pv}」，${blocked ? "字母被擋掉" : "未擋住（此欄可能改用送出時驗證）"}` });

    // 找送出鈕：幾何定位（欄位正下方那顆），並判斷它是否會隨填寫切換 disabled（給必填檢查用）
    prog("觀察送出鈕…");
    await fillValid(page, fields); await checkAllTC(page); await page.waitForTimeout(500);
    const regIndex = await findSubmitIndex(page, fields);
    obs.registerButtonFound = regIndex >= 0;
    let toggles = false;
    if (regIndex >= 0) {
      const fullDisabled = (await allButtons(page)).find((b) => b.i === regIndex)?.disabled;
      await fillValid(page, fields, Object.fromEntries(fields.map((f) => [f.kind, ""])));
      await page.waitForTimeout(400);
      const emptyDisabled = (await allButtons(page)).find((b) => b.i === regIndex)?.disabled;
      toggles = emptyDisabled === true && fullDisabled === false;
    }
    obs.submitToggles = toggles;

    // ② 逐欄位必填（若送出鈕會隨填寫切換 disabled 才用按鈕狀態判斷；否則無法用此法）
    prog("② 測逐欄位必填…");
    if (regIndex < 0) {
      report.steps.push({ name: "逐欄位必填", status: "FAIL", detail: "找不到送出鈕，無法測試" });
    } else if (!toggles) {
      report.steps.push({ name: "逐欄位必填", status: "WARN", detail: "此站送出鈕不隨填寫變灰（採送出時驗證），無法用按鈕狀態逐欄判斷必填" });
    } else {
      const reqKinds = [...new Set(fields.filter((f) => ["phone", "password", "confirm", "email", "text"].includes(f.kind)).map((f) => f.kind))];
      const res = [];
      for (const kind of reqKinds) {
        await fillValid(page, fields); await checkAllTC(page);
        await fillValid(page, fields, { [kind]: "" }); await page.waitForTimeout(350);
        const b = (await allButtons(page)).find((x) => x.i === regIndex);
        res.push({ kind, blocks: !!(b && b.disabled) });
      }
      obs.requiredPerField = res;
      report.steps.push({ name: "逐欄位必填", status: res.every((r) => r.blocks) ? "PASS" : "FAIL", detail: res.map((r) => `${r.kind}:${r.blocks ? "有擋" : "沒擋"}`).join("、") });
    }

    // ③ 電話長度邊界值（擋板：confirm 不一致）
    prog("③ 測電話長度邊界值…");
    obs.phoneBoundary = [];
    if (regIndex >= 0) {
      for (const len of [8, 9, 10, 11]) {
        const msgs = await freshCapture(page, origin, regIndex, { phone: digits(len), confirm: "different999" });
        obs.phoneBoundary.push({ len, messages: msgs });
      }
    }

    // ④ 密碼規則（有效電話 + 很短且一致的密碼）
    prog("④ 測密碼規則…");
    if (regIndex >= 0) obs.passwordRuleMessages = await freshCapture(page, origin, regIndex, { phone: randPhone(), password: "1", confirm: "1" });

    // ⑥ 重複手機號
    prog("⑥ 測重複手機號（會建立一個測試帳號）…");
    const dupPhone = randPhone();
    obs.duplicate = { phone: dupPhone };
    try {
      obs.duplicate.firstRegisterMessages = await freshCapture(page, origin, regIndex, { phone: dupPhone });
      await page.waitForTimeout(1200);
      const ctx2 = await browser.newContext();
      const page2 = await ctx2.newPage();
      if (await openRegisterForm(page2, origin)) {
        const f2 = await locateFields(page2);
        await fillValid(page2, f2, { phone: dupPhone }); await checkAllTC(page2);
        await page2.waitForTimeout(300);
        const idx2 = await findSubmitIndex(page2, f2);
        const before2 = new Set(await visibleTexts(page2));
        await jsClick(page2, idx2 >= 0 ? idx2 : regIndex);
        await page2.waitForTimeout(1300);
        obs.duplicate.secondRegisterMessages = (await visibleTexts(page2)).filter((t) => !before2.has(t)).slice(0, 12);
      }
      await ctx2.close();
    } catch (e) { obs.duplicate.error = String(e.message).slice(0, 100); }

    await browser.close(); browser = null;

    prog("Claude 判斷各項結果…");
    const j = await judge(obs);
    report.steps.push(j.boundary, j.passwordRule, j.errorMsg, j.duplicate);
  } catch (e) {
    if (e.message !== "no-form") report.steps.push({ name: "執行", status: "FAIL", detail: String(e.message).slice(0, 150) });
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }

  report.result = report.steps.length && !report.steps.some((s) => s.status === "FAIL") ? "PASS" : "FAIL";
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - t0;
  return report;
}

async function judge(obs) {
  const fb = (name) => ({ name, status: "FAIL", detail: "AI 判斷失敗，可看 observations" });
  const result = { boundary: fb("電話長度邊界值"), passwordRule: fb("密碼規則"), errorMsg: fb("錯誤提示正確性"), duplicate: fb("重複手機號") };
  if (!ai.isAvailable()) { for (const k in result) result[k].detail = "需要 Claude 判斷但本機未就緒"; return result; }
  const prompt = `你在審核一個註冊表單的驗證行為。以下是自動化測到的客觀事實（JSON）。測單一欄位時會故意讓另一欄無效當擋板，所以訊息可能同時有多種錯誤，請只看你要判斷的那種。

電話長度邊界（每長度送出後的訊息；擋板=密碼不一致）：${JSON.stringify(obs.phoneBoundary || [])}
密碼1碼但電話有效時的訊息：${JSON.stringify(obs.passwordRuleMessages || [])}（出現密碼長度/格式錯誤=有規則PASS；出現「選銀行/帳戶名」等下一步欄位=短密碼被接受沒規則FAIL）
重複手機號：${JSON.stringify(obs.duplicate || {})}（第二次出現「已存在/已註冊」=PASS；明確沒擋=FAIL；若第一次送出後出現銀行/下一步欄位代表多步驟、手機尚未真正註冊完成而無法確認=WARN）

只回這個 JSON：
{"boundary":{"status":"PASS/FAIL","detail":"短(8)要擋、合法(9~10)不該有長度錯、過長(11)要擋"},
"passwordRule":{"status":"PASS/FAIL","detail":"..."},
"errorMsg":{"status":"PASS/FAIL","detail":"整體錯誤訊息是否清楚正確"},
"duplicate":{"status":"PASS/FAIL/WARN","detail":"..."}}`;
  try {
    const j = ai.extractJson(await ai.run(prompt, { timeoutMs: 90000 }));
    if (!j) throw new Error("no json");
    const mk = (name, o) => ({ name, status: o && (o.status === "PASS" || o.status === "WARN") ? o.status : "FAIL", detail: (o && o.detail) || "" });
    return { boundary: mk("電話長度邊界值", j.boundary), passwordRule: mk("密碼規則", j.passwordRule), errorMsg: mk("錯誤提示正確性", j.errorMsg), duplicate: mk("重複手機號", j.duplicate) };
  } catch { return result; }
}

module.exports = { id, name, description, inputs, run };
