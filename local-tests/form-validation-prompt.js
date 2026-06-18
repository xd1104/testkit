// B 類測試：註冊表單驗證（產生指令）
// 工具不自己跑，而是產生一段「填好網址 + 內含完整測試指示」的 prompt，
// 使用者複製到自己的 Claude 對話（需有 Claude in Chrome），由 Claude 開瀏覽器實際測、回報。
const id = "form-validation-prompt";
const name = "註冊表單驗證（產生指令）";
const description =
  "這項需要 AI 開瀏覽器，工具不自己跑。按下會產生一段指令，複製到你自己的 Claude 對話（要有 Claude in Chrome），讓 Claude 開瀏覽器實際測這個站的註冊表單、回報結果。適用各種平台。";
const mode = "prompt"; // 標記為 B 類：產生指令、不執行
const inputs = [
  { key: "siteUrl", label: "目標站 URL", placeholder: "https://www.maha6.com" },
];

function buildPrompt(params) {
  const site = (params.siteUrl || "").trim();
  return `請幫我測試這個註冊頁面的「表單驗證」，用瀏覽器（Claude in Chrome）實際操作，最後給我一份條列報告。

目標站：${site}

【先進到註冊表單】
先開 ${site.replace(/\/$/, "")}/register；若那頁沒有表單欄位，回首頁點「Sign up / Register / 註冊」（常是彈窗 modal；按鈕若有動畫點不到就用 JS 觸發）。表單可能響應式有桌機+手機兩份，只操作「看得到」的那份。欄位用型別+標籤判斷（電話、密碼、確認密碼、可能還有帳號/email/推薦碼）。

【逐項檢查，每項給 PASS / FAIL / WARN + 理由】
1. 號碼欄位擋非數字：在電話欄輸入「abc123def」，看欄位有沒有擋掉字母。
2. 逐欄位必填：每個必填欄位各自留空時，能不能擋住註冊（送出鈕變灰，或按下跳必填錯誤）。
3. 電話長度邊界值：先從錯誤訊息找出長度規則（例如 9~10 碼），測太短/合法/太長，看驗證對不對。
4. 密碼規則：用很短的密碼（如 1 碼），看有沒有密碼長度/格式的錯誤提示。
5. 錯誤提示正確性：填錯資料時，畫面有沒有「合理且正確」的錯誤提示（可能在欄位旁的紅字、或右下角 toast、或彈窗任何角落，請廣泛看）。
6. 重複手機號：用一個全新號碼註冊一次，再用同一個號碼註冊，第二次有沒有被擋（出現「已存在/已註冊」）。若該站註冊是多步驟（第一步後跳出選銀行/帳戶名等下一步、手機尚未真正完成註冊）→ 標 WARN。

【注意】測單一欄位的規則時，故意讓「另一個必填欄」無效當擋板，確保送出一定失敗、不會真的建立帳號（只有第 6 項需要真的成功註冊一次）。

【輸出】最後給我一份條列報告：每項一行，PASS/FAIL/WARN + 簡短理由（引用你看到的實際錯誤訊息）。`;
}

module.exports = { id, name, description, mode, inputs, buildPrompt };
