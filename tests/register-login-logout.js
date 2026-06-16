// 測試項目：註冊 / 登入 / 登出（單站功能測試，E2E）
// 對一個站實際跑「註冊 → 登入 → 登出」一輪，三步都成功才 PASS。會在該站建立一個 qa 開頭的測試帳號。
const { normalizeSite, discoverWalletHost } = require("../lib/fetcher");
const { request, safeJson } = require("../lib/http");

const id = "register-login-logout";
const name = "註冊 / 登入 / 登出";
const description =
  "對單一個站實際跑一次「註冊 → 登入 → 登出」流程，三步都成功才 PASS。會在目標站建立一個 qa 開頭的測試帳號（密碼 abc123）。";
const inputs = [
  { key: "siteUrl", label: "目標站 URL", placeholder: "https://www.8etestabcz.xyz" },
];

// 平台固定的註冊系統參數（這套品牌：孟加拉 +880）
const REG_TYPE = "10";
const COUNTRY_CODE = "+880";
const TYPE = "30";

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// qa + 日期(YYMMDD) + 4 碼隨機 = 12 字，看得出是 QA 測試帳號、哪天建的、且幾乎不重複
function genUsername() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const ymd = String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate());
  return "qa" + ymd + Math.random().toString(36).slice(2, 6);
}

async function run(params, onProgress) {
  const t0 = Date.now();
  const prog = (p) => onProgress && onProgress(p);
  const site = normalizeSite(params.siteUrl);
  const username = genUsername();
  const password = "abc123";

  const report = {
    testId: id,
    name,
    siteUrl: params.siteUrl,
    startedAt: new Date().toISOString(),
    result: "PASS",
    account: { username, password },
    steps: [],
  };

  prog({ phase: "discover", current: 0, total: 3, message: "探測 wallet host…" });
  const walletHost = await discoverWalletHost(site);
  report.walletHost = walletHost;
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "Mozilla/5.0",
    Origin: site.origin,
    Referer: site.referer,
  };

  const finish = (result) => {
    report.result = result;
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - t0;
    return report;
  };
  const addStep = (name, json, raw) => {
    const ok = json.code === "0";
    report.steps.push({
      name,
      status: ok ? "PASS" : "FAIL",
      detail: json.description || (raw || "").slice(0, 120),
    });
    return ok;
  };

  // 1. 註冊
  prog({ phase: "register", current: 1, total: 3, message: `註冊 ${username}…` });
  const regBody = new URLSearchParams({
    username,
    password,
    confirm_password: password,
    reg_type: REG_TYPE,
    countryCode: COUNTRY_CODE,
    type: TYPE,
    device_id: uuid(),
    mobile_no: "1" + Math.floor(100000000 + Math.random() * 899999999),
  }).toString();
  const reg = await request(walletHost + "/func/player/register", {
    method: "POST",
    headers,
    body: regBody,
  });
  if (!addStep("註冊", safeJson(reg.body), reg.body)) return finish("FAIL");

  // 2. 登入（用剛註冊的帳密，拿 session cookie）
  prog({ phase: "login", current: 2, total: 3, message: "登入…" });
  const login = await request(walletHost + "/j_spring_security_check", {
    method: "POST",
    headers,
    body:
      "j_username=" + encodeURIComponent(username) + "&j_password=" + encodeURIComponent(password),
  });
  if (!addStep("登入", safeJson(login.body), login.body)) return finish("FAIL");
  const cookies = (login.headers["set-cookie"] || [])
    .map((c) => c.split(";")[0])
    .join("; ");

  // 3. 登出（帶 cookie）
  prog({ phase: "logout", current: 3, total: 3, message: "登出…" });
  const logout = await request(walletHost + "/func/j_spring_security_logout", {
    method: "GET",
    headers: { ...headers, Cookie: cookies },
  });
  addStep("登出", safeJson(logout.body), logout.body);

  return finish(report.steps.every((s) => s.status === "PASS") ? "PASS" : "FAIL");
}

module.exports = { id, name, description, inputs, run };
