# 自動化測試工具 (testkit)

一個本機 / 線上都能跑的自動化測試工具。輸入網址、按按鈕，跑完在網頁顯示測試報告，並可下載報告交給工程師。純 API、確定性比對，零外部依賴。

目前內建測試項目：**Provider & Game 數量比對**、**Provider & Game Icon 比對**（皆為主網 vs 測試網比對）。

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

> 需要「臨機應變、跨站適應」的瀏覽器功能測試（註冊表單驗證、登入/登出 E2E、XSS/SQLi 等）不在 testkit 範圍內，改用 **web-tester Skill**（`/網站測試`）。testkit 專注於確定性、可重現、可排程的純 API 比對。

---

## 測試項目

每個測試項目在網頁上選取後，下方會顯示一段說明（`description`）讓使用者知道它在測什麼。目前有兩個（皆為比對型：主網 vs 測試網，讀資料比對，免費、可線上）。

**建議先比數量、數量對了再比 icon**（數量都不對的話比 icon 沒意義）：

### 1. Provider & Game 數量比對（`count-compare`）

拿測試網跟主網比對，以下全一致才 PASS：
- **總 Provider 清單**（誰有誰沒有）
- **每個遊戲種類各差了哪些 Provider**（slot / lc / sport / arcade / fish / p2p…，排除 `home` 聚合類）。同一家 provider 兩站都有、但被歸到不同種類也會被抓出來。
- **每個遊戲種類的 Provider 排序**（以主網為準，只比兩站都有的那幾家的相對順序）。報告會列出「主網順序 / 測試網順序」兩排，並標出測試網哪幾家位置變了（例如 `SA GAMING 主#2→測#3`）。
- **每個共同 Provider 底下的 game 清單**（誰有誰沒有，用 `gameCode`）

> **Provider 身分用「正規化後的名稱」跨站配對，不用 `lobbyKey`。** 原因：同一家 provider 的 `lobbyKey` 在不同站不一定相同（例如 PRAGMATIC），有些同一家還會用不同名稱（例如 MICRO GAMING / MG Plus）。正規化＝小寫＋只留英數（`Micro Gaming`／`MICRO GAMING`／`MicroGaming` 自動視為同一家），真正不同名的同一家再靠 `lib/providers.js` 的別名表對應。同一家的多個 lobby（slot 一個、live casino 一個…）會合併成一筆、遊戲清單取聯集。

### 2. Provider & Game Icon 比對（`icon-compare`）

只比「兩站都有」的 Provider / Game 的 icon，全一致才 PASS：
- Provider icon（比路徑/檔名，忽略網域）
- Game icon（比路徑/檔名，忽略網域）

> icon 比對規則：
> - **忽略網域**：每站有自己的圖片網域（例 `img2.tuktukbet99.com` vs `img2.lapdee88.com`），只比路徑。
> - **忽略副檔名**：`.png` 與 `.webp` 只是格式不同、圖視為相同（例 `BNG_385.png` = `BNG_385.webp`），不算差異。
> - 報告仍顯示完整路徑（含副檔名），方便看真正不同的那幾筆。

兩個項目共用同一套抓資料邏輯（`lib/collect.js`），只是拿到資料後比的東西不同。

### 比對型測試的資料來源（純打 API、不經過 AI、零成本）：

1. 從前台 Next.js `_app` chunk 抓 `HOST_URL` → 得出 `wallet.<domain>`
2. `wallet.<domain>/func/cms/getCmsPageInfo?page=home.game` → Provider 清單（**不可用 seq**；抓下來後用正規化名稱當身分、合併同一家的多個 lobby）
3. `wallet.<domain>/func/comm/getCmsSetting?key=<lobbyKey>` → 該 lobby 的 game 清單（一家有多個 lobby 就逐一抓再取聯集）

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
const tests = [countCompare, iconCompare, myTest];   // 加進陣列
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
├── server.js                  # server：前端 + 觸發測試(SSE) + 歷史 + 密碼
├── package.json               # 啟動設定 (npm start)
├── render.yaml                # Render 部署設定
├── lib/
│   ├── fetcher.js             # 抓資料：探測 wallet host、抓 provider、抓 lobby 的 game
│   ├── providers.js           # provider 名稱正規化 + 別名表（跨站配對身分）
│   └── collect.js             # 共用：一次收集兩站的 provider + game 資料
├── tests/                     # 測試項目（deterministic，純程式）
│   ├── index.js               # 測試項目註冊表
│   ├── count-compare.js       # 「Provider & Game 數量比對」
│   └── icon-compare.js        # 「Provider & Game Icon 比對」
├── public/
│   └── index.html             # 前端網頁（單檔）
└── runs/                      # 每次測試報告的 JSON（已被 .gitignore 排除）
```

零外部依賴，純 Node（需 Node 18 以上）。
