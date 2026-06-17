# 自動化測試工具 (testkit)

一個本機 / 線上都能跑的自動化測試工具。輸入網址、按按鈕，跑完在網頁顯示測試報告，並可下載報告交給工程師。

目前內建測試項目：**Game 完整度**（主網 vs 測試網 比對）。

---

## 怎麼用

### 本機啟動

在這個資料夾跑：

```powershell
node server.js
```

看到 `測試工具已啟動 → http://localhost:4500` 後，瀏覽器打開 http://localhost:4500。

操作：選測試項目 → 填網址 → 按「開始測試」→ 跑完顯示報告。報告下方可下載 `.md` / `JSON`，或一鍵複製文字。

### 線上版（Render 免費方案）

程式已可部署到 [Render.com](https://render.com)（免費方案）。流程：

1. 把這個 repo 推到 GitHub
2. Render → New Web Service → 選此 repo（會自動讀 `render.yaml`）
3. 在 Environment 設環境變數 `APP_PASSWORD`＝你要的密碼
4. 部署完拿到公開網址，打開時用該密碼登入（帳號隨意）

之後改了程式，`git push` 後 Render 會自動重新部署。

> 免費方案特性：閒置約 15 分鐘會休眠（下次喚醒等 ~30-60 秒）；硬碟是暫時的，歷史紀錄重啟後會清空（報告當下可下載，不受影響）。

### 本機 runner（AI 驅動，跑在你電腦上）

有些測試（例如註冊：欄位規則每站不同）需要「臨機應變」，這種交給 **Claude Code 主導執行**——它自己摸清楚該站規則、執行、判斷、回報。本機 runner 走你的 **Claude Code 訂閱、不需 API key、不額外花錢**。

啟動（要在**已登入 Claude Code 的終端機**執行）：

```powershell
npm run local      # 或 node local.js
```

開 http://localhost:4600，用法跟主工具一樣（同一個網頁 UI）。差別：

- 測試**由 Claude Code 實際操作**（headless `claude -p`，放行 `Bash` 讓它打 API），而不是寫死的程式。
- 因此能適應各種不同的站／規則，不用逐站維護設定。
- 只能在本機跑（線上 Render 沒有登入你的 Claude Code）。
- 測試任務定義在 `local-tests/`（每個是一份給 Claude 的 prompt），執行邏輯在 `local.js` + `lib/ai.js`。

> 線上版 vs 本機 runner：**能寫死的、要常跑的、要線上的 → 線上版（免費、deterministic）**；**要臨機應變的、跨站適應的、要瀏覽器的 → 本機 runner（走訂閱）**。

---

## 測試項目

每個測試項目在網頁上選取後，下方會顯示一段說明（`description`）讓使用者知道它在測什麼。目前有三個：

### 比對型（主網 vs 測試網，讀資料比對，免費、可線上）

**建議先比數量、數量對了再比 icon**（數量都不對的話比 icon 沒意義）：

### 1. Provider & Game 數量比對（`count-compare`）

拿測試網跟主網比對，以下全一致才 PASS：
- Provider 清單（誰有誰沒有，用 `lobbyKey`）
- 每個 Provider 底下的 game 清單（誰有誰沒有，用 `gameCode`）

### 2. Provider & Game Icon 比對（`icon-compare`）

只比「兩站都有」的 Provider / Game 的 icon，全一致才 PASS：
- Provider icon（比路徑/檔名，忽略網域）
- Game icon（比路徑/檔名，忽略網域）

> icon 比對規則：
> - **忽略網域**：每站有自己的圖片網域（例 `img2.tuktukbet99.com` vs `img2.lapdee88.com`），只比路徑。
> - **忽略副檔名**：`.png` 與 `.webp` 只是格式不同、圖視為相同（例 `BNG_385.png` = `BNG_385.webp`），不算差異。
> - 報告仍顯示完整路徑（含副檔名），方便看真正不同的那幾筆。

兩個項目共用同一套抓資料邏輯（`lib/collect.js`），只是拿到資料後比的東西不同。

### 流程型（單站功能測試，E2E）

### 3. 註冊 / 登入 / 登出（`register-login-logout`）

對**單一個站**實際跑一次完整流程，三步都成功才 PASS（會在目標站建立一個 qa 開頭的測試帳號）：

1. **註冊**：`POST <wallet>/func/player/register`（form），欄位 `username, password, confirm_password, reg_type=10, countryCode=+880, type=30, device_id(UUID), mobile_no(10碼)` → 回 `code:0` + loginToken
2. **登入**：`POST <wallet>/j_spring_security_check`（`j_username` / `j_password`）→ 回 `code:0 login success` + JSESSIONID cookie
3. **登出**：`GET <wallet>/func/j_spring_security_logout`（帶 cookie）→ 回 `code:0 logout success`

帳號命名：`qa` + 日期(YYMMDD) + 4 碼隨機（例 `qa260616a3f9`）。`eventData` 那包追蹤資料後端不需要，不送。系統參數 `reg_type/countryCode/type` 是這套品牌（孟加拉）的固定值，換品牌可能要調。

> 此項仍是純 API（輕量、可線上）。前端表單驗證測試（擋字、錯誤提示）才需要瀏覽器，屬於之後的本機 runner。

資料來源（純打 API、不經過 AI、零成本）：

1. 從前台 Next.js `_app` chunk 抓 `HOST_URL` → 得出 `wallet.<domain>`
2. `wallet.<domain>/func/cms/getCmsPageInfo?page=home.game` → Provider 清單（用 `lobbyKey` 去重，**不可用 seq**）
3. `wallet.<domain>/func/comm/getCmsSetting?key=<lobbyKey>` → 該 lobby 的 game 清單

**重要：只比對「啟用」的遊戲。** API 回傳的 `menuList[]` 每款遊戲有 `status` 欄位：
正數（10）= 上架、玩家看得到；負數（-10、-5）= 下架/隱藏、網頁不顯示。
工具只計入 `status > 0` 的遊戲，跟網頁顯示一致。否則會把後台隱藏的遊戲也算進去，造成數量對不上、誤判 FAIL。

---

## 怎麼新增一個測試項目

三步驟，前端 / 報告 / 下載 / 密碼都不用動：

### 1. 在 `tests/` 加一個檔

照 `tests/count-compare.js` 的格式，export 出 `id`、`name`、`inputs`、`run`（要抓兩站資料的話可直接用 `lib/collect.js`）：

```js
module.exports = {
  id: "my-test",                 // 唯一英數 id
  name: "我的測試",               // 下拉選單顯示的名稱
  inputs: [                      // 網頁要使用者填的欄位
    { key: "url", label: "目標 URL", placeholder: "https://..." },
  ],
  // params 是使用者填的值；onProgress 用來回報即時進度
  async run(params, onProgress) {
    onProgress({ phase: "x", current: 1, total: 3, message: "處理中…" });
    // ...做你的測試邏輯...
    return {
      testId: "my-test",
      name: "我的測試",
      result: "PASS",            // 或 "FAIL"
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 123,
      summary: { /* 任意統計欄位 */ },
      // 其他你要顯示在報告的欄位
    };
  },
};
```

回傳的報告物件必備欄位：`testId`、`name`、`result`、`finishedAt`、`durationMs`。其餘可自由設計。

### 2. 在 `tests/index.js` 註冊

```js
const myTest = require("./my-test");
const tests = [gameCompleteness, myTest];   // 加進陣列
```

### 3. 推上去

```powershell
git push
```

Render 自動重新部署，網頁下拉選單就會自動多出新項目。

> 小提醒：新增測試前先想清楚「怎麼算 PASS、怎麼算 FAIL」，那是測試的核心。

---

## 專案結構

```
testkit/
├── server.js                  # 線上版 server：前端 + 觸發測試(SSE) + 歷史 + 密碼
├── local.js                   # 本機 runner：測試交給 Claude Code(headless) 執行
├── package.json               # 啟動設定 (npm start / npm run local)
├── render.yaml                # Render 部署設定
├── lib/
│   ├── fetcher.js             # 抓資料：探測 wallet host、抓 provider、抓 lobby 的 game
│   ├── collect.js             # 共用：一次收集兩站的 provider + game 資料
│   ├── http.js                # 通用 HTTPS 請求（POST/cookie），給流程型測試用
│   └── ai.js                  # 透過 headless Claude Code 執行任務（走訂閱）
├── tests/                     # 線上版測試（deterministic，純程式）
│   ├── index.js               # 測試項目註冊表
│   ├── count-compare.js       # 「Provider & Game 數量比對」
│   ├── icon-compare.js        # 「Provider & Game Icon 比對」
│   └── register-login-logout.js # 「註冊 / 登入 / 登出」E2E（寫死欄位，限對應國家的站）
├── local-tests/               # 本機 runner 測試（AI 驅動，每個是給 Claude 的 prompt）
│   ├── index.js
│   └── register.js            # 「註冊 / 登入 / 登出（AI）」跨站適應
├── public/
│   └── index.html             # 前端網頁（單檔，線上版與本機 runner 共用）
└── runs/                      # 每次測試報告的 JSON（已被 .gitignore 排除）
```

零外部依賴，純 Node（需 Node 18 以上）。本機 runner 另需安裝並登入 Claude Code。
