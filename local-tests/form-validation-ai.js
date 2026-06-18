// 本機測試：註冊表單驗證（AI 主導版）
// 由 Claude Code 開瀏覽器、自己看畫面隨機應變地操作註冊表單。用於寫死版搞不定的平台（彈窗、奇怪結構等）。
const id = "form-validation-ai";
const name = "註冊表單驗證（AI）";
const description =
  "由你的 Claude Code 開瀏覽器，自己看畫面操作註冊表單做驗證。比寫死版慢但能適應各種平台（彈窗、特殊結構）。走訂閱、免費。需要本機有 Chrome。";
const inputs = [{ key: "siteUrl", label: "目標站 URL", placeholder: "https://momowin.fun" }];

function buildPrompt(params) {
  const site = params.siteUrl;
  const origin = site.replace(/\/$/, "");
  return `你是自動化測試執行器，用 Playwright 對目標站的「註冊表單」做驗證測試，最後只輸出一個 JSON 報告。

目標站：${site}

⚠️ 效率要求（重要，別重蹈覆轍）：
- 直接寫「一支完整的 Playwright 腳本」涵蓋全部 6 項，用 Write 寫成暫存檔（例如 _fv_run.js）再 node 執行，**一次跑完**。
- 不要反覆重寫腳本、不要一項一項分開跑、不要狂截圖（用 DOM 文字傾印除錯就好，截圖很慢）。
- 下面已經把這類網站的眉角寫給你了，照做即可，不需要從頭診斷。
- 腳本跑完請刪掉暫存檔。

【環境】node_modules 已裝 playwright-core。用系統 Chrome、不下載瀏覽器：
  const { chromium } = require("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext()).newPage();

【已知眉角｜這類博弈站(Next.js/React SPA)幾乎都適用，照做就好】
1. 輸入框是 React 受控元件：**一定要用 Playwright 的 locator.fill()/type() 來填**（會觸發 React 事件）；千萬不要在 page.evaluate 裡直接設 el.value（不會生效，這就是會讀到空值的坑）。
2. 判斷元素可見：用 getClientRects().length>0 且寬高>0（**不要用 offsetParent**，position:fixed 的彈窗它永遠是 null）。
3. 進註冊表單：先 page.goto("${origin}/register")；若沒出現密碼欄，回 ${origin}/ 首頁，用 page.evaluate 找文字含 sign up/register/註冊 的 button/a 並呼叫 el.click()（**用 JS click**，因為註冊鈕常有無限動畫，Playwright 的 click 會因「not stable」逾時）。註冊常是彈窗 modal。
4. 響應式站可能有桌機+手機兩份重複表單：只操作「可見」的那份（用上面第 2 點的可見判斷過濾 input）。
5. 欄位用 type+placeholder 辨識：電話 = type number/tel 或 placeholder 含 phone/mobile/手機/เบอร（**注意有些站電話是 type=text**）；密碼 = type password（第 1 個=密碼、第 2 個=確認密碼）；可能還有 username、email、推薦碼(optional 可不填)。
6. 送出鈕：常是「欄位正下方那顆」按鈕；用 JS click 點它（避開動畫 not stable）。送出可能是「按下才驗證」(不是變灰)。
7. 錯誤訊息位置不固定（欄位旁紅字、或**右下角 toast**、或彈窗任何角落）：用「送出前 vs 送出後」整頁可見文字的差集來抓新出現的訊息，不要只找特定元素。
8. **元素會 stale**：彈窗 re-render 後舊的 elementHandle 會失效（讀回 undefined）。**用 Playwright 的 locator（page.locator(...)）而非 elementHandle，每次操作前重新定位**；每次 fill 後立刻讀回確認值有進去。
9. **小心登入/註冊頁籤**：彈窗常有 Login/Register 切換。請確認你在「註冊」那一頁（有 2 個密碼欄=密碼+確認密碼 才是註冊）。找送出鈕時要找「註冊表單內」那顆，點完若畫面出現「Don't have an account / 切到登入」代表點錯了（點到登入鈕），要改點正確的註冊送出鈕。

【要測的 6 項】
1. 號碼欄位擋非數字：電話欄 fill/type「abc123def」，讀回欄位值看有沒有擋掉字母。
2. 逐欄位必填：每個必填欄位各自留空時，是否擋住註冊（送出鈕變灰，或按下跳必填錯誤）。
3. 電話長度邊界值：先從錯誤訊息弄清長度規則（如 9~10 碼），測不足/合法/超過，看驗證對不對。
4. 密碼規則：用很短密碼（如 1 碼），看有沒有密碼長度/格式錯誤提示；完全沒規則也說明。
5. 錯誤提示正確性：填錯資料時有沒有「合理正確」的錯誤提示（用第 7 點方式廣抓）。
6. 重複手機號：用全新號碼註冊一次，再用同號碼註冊，第二次是否被擋（「已存在/已註冊」）。若是多步驟（第一步後跳「選銀行/帳戶名」等下一步、手機尚未真正完成註冊）→ 無法確認 → WARN。

【安全】測單欄位規則時，讓「另一必填欄」無效當擋板，確保送出必失敗、不會真的建帳號（只有第 6 項需真的成功註冊一次）。

【判斷】程式抓到事實後，你（Claude）依事實判斷每項 PASS/FAIL/WARN，detail 寫清楚理由（引用實際訊息）。

【輸出｜最後一則訊息只輸出這個 JSON，不要其他文字、不要 markdown 圍欄】
{
 "fieldsFound": ["實際辨識到的欄位"],
 "formLocation": "如何找到表單（/register 或 點Sign up彈窗）",
 "steps": [
  {"name":"號碼欄位擋非數字","status":"PASS或FAIL或WARN","detail":"簡短"},
  {"name":"逐欄位必填","status":"...","detail":"..."},
  {"name":"電話長度邊界值","status":"...","detail":"..."},
  {"name":"密碼規則","status":"...","detail":"..."},
  {"name":"錯誤提示正確性","status":"...","detail":"..."},
  {"name":"重複手機號","status":"...","detail":"..."}
 ],
 "result":"PASS（無任何FAIL）或FAIL"
}`;
}

module.exports = { id, name, description, inputs, buildPrompt };
