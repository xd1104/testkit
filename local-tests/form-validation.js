// 本機測試：註冊表單驗證
// 做法：Playwright（用系統 Chrome）開註冊頁、操作欄位、抓下客觀事實（欄位行為、按鈕狀態、出現的訊息），
// 結構性檢查（號碼欄位擋字）直接判定；「必填擋註冊」「錯誤提示對不對」把事實交給 Claude 判斷。
const { chromium } = require("playwright-core");
const ai = require("../lib/ai");

const id = "form-validation";
const name = "註冊表單驗證";
const description =
  "用瀏覽器實際操作註冊表單，檢查：①號碼欄位能否輸入非數字 ②必填未填能否註冊 ③錯誤提示是否正確。結構檢查用 Playwright，訊息對錯交給 Claude 判斷。需要本機有 Chrome。";
const inputs = [
  { key: "siteUrl", label: "目標站 URL", placeholder: "https://www.playdee99.com" },
];

function normUrl(u) {
  let s = (u || "").trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return new URL(s).origin;
}

async function snapshotButtons(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .map((b) => ({ text: (b.innerText || "").trim().slice(0, 20), disabled: !!b.disabled }))
      .filter((b) => b.text)
  );
}

async function run(params, onProgress) {
  const t0 = Date.now();
  const prog = (p) => onProgress && onProgress(p);
  const origin = normUrl(params.siteUrl);
  const report = {
    testId: id,
    name,
    siteUrl: params.siteUrl,
    startedAt: new Date().toISOString(),
    result: "PASS",
    walletHost: origin + "/register",
    steps: [],
    observations: {},
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

    // ── ① 號碼欄位擋非數字（deterministic）──
    prog({ phase: "ai", message: "測試號碼欄位擋字…" });
    await phone.fill("");
    await phone.type("abc123def", { delay: 15 });
    const phoneVal = await phone.inputValue();
    const blockedLetters = !/[a-z]/i.test(phoneVal);
    report.observations.phoneAfterTypingLetters = phoneVal;
    report.steps.push({
      name: "號碼欄位擋非數字",
      status: blockedLetters ? "PASS" : "FAIL",
      detail: `輸入「abc123def」後欄位為「${phoneVal}」，${blockedLetters ? "字母已被擋掉" : "未擋住字母"}`,
    });

    // ── 抓事實：空白狀態 vs 填妥狀態的按鈕 ──
    prog({ phase: "ai", message: "觀察必填/按鈕狀態…" });
    await phone.fill("");
    for (let i = 0; i < (await pwds.count()); i++) await pwds.nth(i).fill("");
    const buttonsEmpty = await snapshotButtons(page);

    await phone.fill("0812345678");
    if ((await pwds.count()) >= 1) await pwds.nth(0).fill("abc123");
    if ((await pwds.count()) >= 2) await pwds.nth(1).fill("abc123");
    await page.waitForTimeout(800);
    const buttonsFilled = await snapshotButtons(page);

    // ── 抓事實：無效輸入後「新出現的文字」(不限顏色，用前後差異找)──
    prog({ phase: "ai", message: "觀察錯誤提示…" });
    const visibleTexts = () =>
      page.evaluate(() => {
        const out = new Set();
        document.querySelectorAll("p,span,small,div,label,[role=alert]").forEach((e) => {
          if (e.children.length) return; // 只取葉節點，避免重複
          const t = (e.innerText || "").trim();
          if (t && t.length > 1 && t.length < 80 && e.offsetParent !== null) out.add(t);
        });
        return [...out];
      });
    const before = new Set(await visibleTexts());
    let mismatchMessages = [];
    if ((await pwds.count()) >= 2) {
      await pwds.nth(0).fill("abc123");
      await pwds.nth(1).fill("");
      await pwds.nth(1).type("different999", { delay: 10 });
      await phone.fill("12"); // 故意太短
      await page.locator("body").click(); // blur
      await page.waitForTimeout(1000);
    }
    const after = await visibleTexts();
    mismatchMessages = after.filter((t) => !before.has(t)).slice(0, 20);
    report.observations.buttonsEmpty = buttonsEmpty;
    report.observations.buttonsFilled = buttonsFilled;
    report.observations.newTextsAfterInvalid = mismatchMessages;

    await browser.close();
    browser = null;

    // ── ②③ 交給 Claude 判斷 ──
    prog({ phase: "ai", message: "Claude 判斷必填與錯誤提示…" });
    const judged = await judge(report.observations);
    report.steps.push(judged.required);
    report.steps.push(judged.errorMsg);
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

// 把觀察到的事實交給 Claude 判斷「必填擋註冊」與「錯誤提示」
async function judge(obs) {
  const fallback = (name) => ({ name, status: "FAIL", detail: "AI 判斷失敗（可人工看 observations）" });
  if (!ai.isAvailable()) {
    return {
      required: { name: "必填未填擋註冊", status: "FAIL", detail: "需要 Claude 判斷，但本機未就緒" },
      errorMsg: { name: "錯誤提示正確性", status: "FAIL", detail: "需要 Claude 判斷，但本機未就緒" },
    };
  }
  const prompt = `你在判斷一個註冊表單的驗證行為是否正確。以下是自動化測到的客觀事實（JSON）：

空白時的按鈕：${JSON.stringify(obs.buttonsEmpty)}
填妥電話+密碼後的按鈕：${JSON.stringify(obs.buttonsFilled)}
輸入無效資料（密碼不一致、電話太短）後「新出現的文字」：${JSON.stringify(obs.newTextsAfterInvalid)}

請判斷兩件事，只回 JSON：
1. 必填未填能不能擋住註冊：正確行為是「空白時註冊鈕 disabled，填妥後 enabled」（或空白時按了會擋）。看按鈕差異判斷。
2. 錯誤提示是否正確：輸入無效資料後，應出現合理的錯誤提示（例如「密碼不一致」「手機號碼格式錯誤」之類）。從「新出現的文字」裡判斷有沒有合理的錯誤提示。注意：那些文字可能混有非錯誤訊息，請只看有沒有看起來像驗證錯誤提示的內容。若完全沒有任何提示，視為 FAIL（該站缺少錯誤提示）。

只輸出這個 JSON，不要其他文字：
{"required":{"status":"PASS"或"FAIL","detail":"<簡短理由>"},"errorMsg":{"status":"PASS"或"FAIL","detail":"<簡短理由>"}}`;
  try {
    const text = await ai.run(prompt, { timeoutMs: 60000 });
    const j = ai.extractJson(text);
    if (!j) throw new Error("no json");
    return {
      required: { name: "必填未填擋註冊", status: j.required.status, detail: j.required.detail },
      errorMsg: { name: "錯誤提示正確性", status: j.errorMsg.status, detail: j.errorMsg.detail },
    };
  } catch {
    return { required: fallback("必填未填擋註冊"), errorMsg: fallback("錯誤提示正確性") };
  }
}

module.exports = { id, name, description, inputs, run };
