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
  return `你是自動化測試執行器，對目標站實際跑「註冊 → 登入 → 登出」，最後只輸出 JSON。請快、別繞路。

目標站：${site}

【重要執行原則】
- 一律用 curl 做 HTTP，不要用 node -e 或寫檔（避免 shell 引號問題、也別碰 Write 工具）。
- 所有請求帶 header：-H "Origin: ${site.replace(/\/$/, "")}" -H "Referer: ${site}" -H "User-Agent: Mozilla/5.0"。
- 不要在 minified JS 裡亂 grep 試半天；照下面的明確步驟做。

【步驟 1：找 wallet host】
curl -s "${site}" 取首頁，grep 出 /_next/static/chunks/pages/_app-*.js 的路徑，curl 該檔，grep "HOST_URL"，得到 https://wallet.<domain>。

【步驟 2：找這個站的註冊預設值（國碼等，每站不同）】
這套平台的註冊欄位預設值放在「register 頁的 chunk」。做法：
- curl -s "${site}" 首頁，grep 出 /_next/static/chunks/pages/register-*.js 的路徑（若首頁沒有，先 grep buildId，再看 _buildManifest.js）。
- curl 該 register chunk，grep "countryCode" → 會看到類似 countryCode:"+66",type:"30" 這種預設值。
- 用這裡讀到的 countryCode（含 +）與 type。reg_type 一般是 "10"（若失敗再試 "20"）。

【步驟 3：註冊】POST <wallet>/func/player/register，Content-Type application/x-www-form-urlencoded，用 curl -d 帶這些欄位：
  username, password=abc123, confirm_password=abc123, reg_type, type, countryCode（步驟2讀到的）, device_id（隨機 UUID）, mobile_no
  - mobile_no：用該國合理的手機號（例如泰國 0 開頭 10 碼）。若回 code 不是 "0"，讀 description 調整（多半是手機碼數或國碼），最多重試 3 次。
  - 帳號 username：優先用 qa+今天YYMMDD+4碼隨機；若該站要求 username 必須是手機號，就改用 mobile_no 當 username。
  - 成功 = 回傳 JSON 的 code === "0"。

【步驟 4：登入】curl -s -c cookies 暫存檔 POST <wallet>/j_spring_security_check，-d "j_username=<剛註冊的>&j_password=abc123"（參數名是 j_username / j_password）。成功 = code === "0"。

【步驟 5：登出】curl -s -b 同一個 cookie 暫存檔 GET <wallet>/func/j_spring_security_logout。成功 = code === "0"。

【輸出｜最後一則訊息只輸出這個 JSON，不要其他文字、不要 markdown 圍欄】
{
  "walletHost": "https://wallet.<domain>",
  "account": { "username": "<實際用的>", "password": "abc123" },
  "fieldsUsed": { "countryCode": "<最後成功>", "reg_type": "<...>", "type": "<...>", "mobile_no": "<最後成功>" },
  "steps": [
    { "name": "註冊", "status": "PASS"或"FAIL", "detail": "<簡短，例如 success / 錯誤訊息 / 試了幾次>" },
    { "name": "登入", "status": "PASS"或"FAIL", "detail": "<...>" },
    { "name": "登出", "status": "PASS"或"FAIL", "detail": "<...>" }
  ],
  "result": "PASS"或"FAIL"
}`;
}

module.exports = { id, name, description, inputs, buildPrompt };
