// 本機 AI 測試：註冊 / 登入 / 登出（由 Claude Code 主導執行，自動適應各站欄位規則）
const id = "ai-register";
const name = "註冊 / 登入 / 登出（AI）";
const description =
  "由你的 Claude Code 實際操作目標站跑「註冊 → 登入 → 登出」。Claude 會自己摸清楚該站的欄位規則（國碼、手機碼數等）並調整，適用各種不同的站。走訂閱、免費。";
const inputs = [
  { key: "siteUrl", label: "目標站 URL", placeholder: "https://www.playdee99.com" },
];

function buildPrompt(params) {
  const site = params.siteUrl;
  return `你是一個自動化測試執行器。請對目標站實際執行「註冊 → 登入 → 登出」測試，最後只用 JSON 回報結果。

目標站：${site}

【背景知識｜這套博弈平台的 API】
- API 在 wallet host。做法：抓目標站首頁 HTML，找到 /_next/static/chunks/pages/_app-*.js，在該檔內容找 HOST_URL，取得 https://wallet.<domain>。
- 所有請求都要帶 header：Origin 與 Referer 設為目標站（${site}）。
- 註冊：POST <wallet>/func/player/register，Content-Type: application/x-www-form-urlencoded。
  欄位：username, password, confirm_password, reg_type, type, countryCode, device_id（UUID v4）, mobile_no。
  其中 reg_type / type / countryCode / mobile_no 的有效值「每個站可能不同」（不同國家、不同手機碼數規則）。
  先用合理預設嘗試；若失敗，讀回傳的錯誤訊息（description 欄位）推斷正確值後重試，最多 5 次。
  成功的判斷：回傳 JSON 的 code === "0"。
- 登入：POST <wallet>/j_spring_security_check，form，參數名是 j_username 與 j_password（注意不是 username/password）。
  成功：code === "0"，且回應的 set-cookie 會有 JSESSIONID。
- 登出：GET <wallet>/func/j_spring_security_logout，請帶上登入拿到的 JSESSIONID cookie。成功：code === "0"。

【帳號】
- username 用 qa + 今天日期(YYMMDD) + 4 碼隨機英數，例如 qa260616a3f9。
- password 用 abc123，confirm_password 與 password 相同。

【執行方式】
- 用 Bash（curl 或 node 都可）實際打這三支 API。
- 三步都要做：先註冊、再用同一組帳密登入、最後登出。

【輸出格式｜非常重要】
全部做完後，你的「最後一則訊息」只輸出以下 JSON，不要任何其他文字、不要 markdown 圍欄：
{
  "walletHost": "https://wallet.<domain>",
  "account": { "username": "<實際用的>", "password": "abc123" },
  "fieldsUsed": { "countryCode": "<最後成功的>", "reg_type": "<...>", "type": "<...>", "mobile_no_len": <數字> },
  "steps": [
    { "name": "註冊", "status": "PASS" 或 "FAIL", "detail": "<簡短說明，例如成功或錯誤訊息、嘗試了幾次>" },
    { "name": "登入", "status": "PASS" 或 "FAIL", "detail": "<...>" },
    { "name": "登出", "status": "PASS" 或 "FAIL", "detail": "<...>" }
  ],
  "result": "PASS"（三步全過）或 "FAIL"
}`;
}

module.exports = { id, name, description, inputs, buildPrompt };
