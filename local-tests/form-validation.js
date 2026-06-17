// 本機測試：註冊表單驗證
// 做法：Playwright（用系統 Chrome）開註冊頁、操作欄位、抓下客觀事實，
// 結構性檢查（號碼欄位擋字、必填擋註冊）直接判定；錯誤提示文字交給 Claude 判斷是否合理。
const { chromium } = require("playwright-core");
const ai = require("../lib/ai");

const id = "form-validation";
const name = "註冊表單驗證";
const description =
  "用瀏覽器實際操作註冊表單，檢查：①號碼欄位能否輸入非數字 ②必填未填能否註冊 ③填錯資料有沒有正確的錯誤提示。結構檢查用 Playwright，錯誤提示對錯交給 Claude 判斷。需要本機有 Chrome。";
const inputs = [
  { key: "siteUrl", label: "目標站 URL", placeholder: "https://www.playdee99.com" },
];

function normUrl(u) {
  let s = (u || "").trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return new URL(s).origin;
}

// 抓所有按鈕（含 DOM 索引與 disabled 狀態）
const allButtons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b, i) => ({
      i, text: (b.innerText || "").trim().slice(0, 24), disabled: !!b.disabled,
    }))
  );

// 抓畫面上可見的短文字（葉節點），用來比前後差異找出新出現的訊息（含 toast）
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

async function run(params, onProgress) {
  const t0 = Date.now();
  const prog = (p) => onProgress && onProgress(p);
  const origin = normUrl(params.siteUrl);
  const report = {
    testId: id, name, siteUrl: params.siteUrl,
    startedAt: new Date().toISOString(), result: "PASS",
    walletHost: origin + "/register", steps: [], observations: {},
  };

  let browser;
  try {
    prog({ phase: "ai", message: "開啟瀏覽器…" });
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    prog({ phase: "ai", message: "載入註冊頁…" });
    await page.goto(origin + "/register", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    const phone = page.locator("input[type=number]").first();
    const pwds = page.locator("input[type=password]");
    if (!(await phone.count()) || !(await pwds.count())) {
      report.steps.push({ name: "找註冊表單", status: "FAIL", detail: "在 /register 找不到電話/密碼欄位（此站註冊頁結構可能不同）" });
      throw new Error("no-form");
    }
    const npw = await pwds.count();
    const fillPwds = async (a, b) => { if (npw >= 1) await pwds.nth(0).fill(a); if (npw >= 2) await pwds.nth(1).fill(b == null ? a : b); };

    // ── ① 號碼欄位擋非數字（deterministic）──
    prog({ phase: "ai", message: "測試號碼欄位擋字…" });
    await phone.fill("");
    await phone.type("abc123def", { delay: 15 });
    const phoneVal = await phone.inputValue();
    const blocked = !/[a-z]/i.test(phoneVal);
    report.steps.push({
      name: "號碼欄位擋非數字", status: blocked ? "PASS" : "FAIL",
      detail: `輸入「abc123def」後欄位為「${phoneVal}」，${blocked ? "字母已被擋掉" : "未擋住字母"}`,
    });

    // ── 找出「註冊」送出鈕：空白時 disabled、填妥後 enabled 的那顆（跨語言）──
    prog({ phase: "ai", message: "觀察必填/按鈕狀態…" });
    await phone.fill(""); await fillPwds("", "");
    await page.waitForTimeout(400);
    const btnEmpty = await allButtons(page);
    await phone.fill("0812345678"); await fillPwds("abc123", "abc123");
    await page.waitForTimeout(700);
    const btnFilled = await allButtons(page);
    const regBtn = btnFilled.find((b) => b.disabled === false && (btnEmpty.find((e) => e.i === b.i) || {}).disabled === true);
    report.observations.buttonsEmpty = btnEmpty.filter((b) => b.text);
    report.observations.registerButton = regBtn || null;

    // ── ② 必填未填擋註冊（deterministic）──
    report.steps.push({
      name: "必填未填擋註冊",
      status: regBtn ? "PASS" : "FAIL",
      detail: regBtn
        ? `送出鈕「${regBtn.text}」空白時 disabled、填妥後 enabled，正確攔截`
        : "找不到「空白時鎖住、填妥才開」的送出鈕（無法確認有擋）",
    });

    // ── ③ 抓錯誤提示：填無效資料 → 按 Register → 收 toast 訊息 ──
    prog({ phase: "ai", message: "觸發並蒐集錯誤提示…" });
    const clickRegister = async () => {
      if (!regBtn) return;
      try { await page.locator("button").nth(regBtn.i).click({ timeout: 4000 }); }
      catch { try { await page.locator("button").nth(regBtn.i).click({ force: true }); } catch {} }
    };
    const before = new Set(await visibleTexts(page));
    const collected = new Set();
    const grab = async () => { for (const t of await visibleTexts(page)) if (!before.has(t)) collected.add(t); };

    // 情境 A：電話太短
    await phone.fill("12"); await fillPwds("abc123", "abc123");
    await clickRegister(); await page.waitForTimeout(900); await grab();
    // 情境 B：兩次密碼不一致
    await phone.fill("0812345678"); await fillPwds("abc123", "different999");
    await clickRegister(); await page.waitForTimeout(900); await grab();

    report.observations.errorMessages = [...collected].slice(0, 20);

    await browser.close(); browser = null;

    // ── 錯誤提示對不對 → 交給 Claude 判斷 ──
    prog({ phase: "ai", message: "Claude 判斷錯誤提示…" });
    report.steps.push(await judgeMessages(report.observations.errorMessages));
  } catch (e) {
    if (e.message !== "no-form")
      report.steps.push({ name: "執行", status: "FAIL", detail: String(e.message).slice(0, 150) });
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }

  report.result = report.steps.length && report.steps.every((s) => s.status === "PASS") ? "PASS" : "FAIL";
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - t0;
  return report;
}

// 把蒐集到的訊息交給 Claude 判斷「錯誤提示是否合理正確」
async function judgeMessages(messages) {
  if (!messages || !messages.length)
    return { name: "錯誤提示正確性", status: "FAIL", detail: "填錯資料後沒有出現任何錯誤提示" };
  if (!ai.isAvailable())
    return { name: "錯誤提示正確性", status: "FAIL", detail: "需要 Claude 判斷但本機未就緒。實際訊息：" + messages.join(" / ") };
  const prompt = `一個註冊表單在輸入「電話太短」和「兩次密碼不一致」後，畫面出現了這些文字（可能混有非錯誤訊息的雜訊）：
${JSON.stringify(messages)}

請判斷：這裡面有沒有「合理且正確的驗證錯誤提示」（例如提示電話位數錯誤、密碼不一致等）？只回 JSON：
{"status":"PASS"或"FAIL","detail":"<簡短理由，並引用你認為是錯誤提示的那幾句>"}`;
  try {
    const j = ai.extractJson(await ai.run(prompt, { timeoutMs: 60000 }));
    if (!j || !j.status) throw new Error("no json");
    return { name: "錯誤提示正確性", status: j.status, detail: j.detail };
  } catch {
    return { name: "錯誤提示正確性", status: "FAIL", detail: "AI 判斷失敗。實際訊息：" + messages.join(" / ") };
  }
}

module.exports = { id, name, description, inputs, run };
