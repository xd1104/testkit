// 負責跟目標站要資料：探測 wallet host、抓 provider 清單、抓每個 lobby 的 game 清單
const https = require("https");
const { canonicalProvider } = require("./providers");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

function httpGet(url, referer) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": UA, Referer: referer || "" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout: " + url)));
  });
}

// 把使用者輸入的網址正規化成 origin（https://host），並產生 referer
function normalizeSite(input) {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const url = new URL(u);
  return { origin: url.origin, referer: url.origin + "/" };
}

// 從首頁 HTML 找 _app chunk，再從 chunk 內容抓 HOST_URL（wallet host）
async function discoverWalletHost(site) {
  const home = await httpGet(site.origin + "/", site.referer);
  const m = home.body.match(/\/_next\/static\/chunks\/pages\/_app-[^"']+\.js/);
  if (!m) throw new Error("找不到 _app chunk：" + site.origin);
  const chunk = await httpGet(site.origin + m[0], site.referer);
  const h = chunk.body.match(/https:\/\/wallet\.[a-zA-Z0-9._-]+/);
  if (!h) throw new Error("chunk 內找不到 wallet host：" + site.origin);
  return h[0];
}

// 抓 home.game 的 provider 清單。用 canonical 名稱去重（跨站一致），不用 lobbyKey/seq。
// 同一家 provider 的多個 lobby（例如 slot 一個、live casino 一個）會合併成一筆：
// lobbyKeys 收集全部、categories 取聯集。
// 回傳 { providers, categoryOrder }：
//   - providers: 去重後的 provider 陣列
//   - categoryOrder: { 種類代碼: [canon 依 API 出現順序，種類內去重] }，用來比對排序（seq 不可靠，改用陣列實際順序）
async function fetchProviders(walletHost, referer) {
  const r = await httpGet(
    walletHost + "/func/cms/getCmsPageInfo?page=home.game",
    referer
  );
  const d = JSON.parse(r.body);
  if (!d.result || !d.result.categoryList)
    throw new Error("getCmsPageInfo 回傳格式異常");
  const map = new Map(); // canon -> { canon, providerName, icon, lobbyKeys:Set, categories:Set }
  const categoryOrder = {}; // category -> [canon ...]（依 API 順序、種類內去重）
  for (const cat of d.result.categoryList) {
    const catCode = cat.category;
    if (!categoryOrder[catCode]) categoryOrder[catCode] = [];
    const seenInCat = new Set(categoryOrder[catCode]);
    for (const blk of cat.data || []) {
      for (const o of blk.obj || []) {
        if (!o.lobbyKey) continue;
        const canon = canonicalProvider(o.providerName);
        if (!map.has(canon))
          map.set(canon, {
            canon,
            providerName: o.providerName, // 顯示用（取第一個遇到的寫法）
            icon: iconPath(o.imageUrl), // 只留路徑，忽略網域
            lobbyKeys: new Set(),
            categories: new Set(),
          });
        const p = map.get(canon);
        p.lobbyKeys.add(o.lobbyKey);
        p.categories.add(catCode);
        if (!seenInCat.has(canon)) {
          seenInCat.add(canon);
          categoryOrder[catCode].push(canon);
        }
      }
    }
  }
  const providers = [...map.values()].map((p) => ({ ...p, lobbyKeys: [...p.lobbyKeys] }));
  return { providers, categoryOrder };
}

// 把 icon 完整 URL 正規化成「只留路徑」，因為每站圖片網域不同，比網域沒意義
function iconPath(u) {
  if (!u) return "";
  try {
    return new URL(u).pathname;
  } catch {
    return String(u);
  }
}

// 抓單一 lobby 底下的 game 清單（gameCode 集合）
async function fetchLobbyGames(walletHost, lobbyKey, referer) {
  const r = await httpGet(
    walletHost + "/func/comm/getCmsSetting?key=" + encodeURIComponent(lobbyKey),
    referer
  );
  let d;
  try {
    d = JSON.parse(r.body);
  } catch {
    return [];
  }
  const list = (d.result && d.result.menuList) || [];
  // 只算實際會顯示給玩家的遊戲：status 正數=顯示，負數(-10/-5)=停用/隱藏，網頁不會列出
  return list
    .filter((g) => Number(g.status) > 0)
    .map((g) => ({
      gameCode: g.gameCode,
      gameName: g.gameName,
      status: g.status,
      icon: iconPath(g.imgUrl), // 只留路徑，忽略網域
    }));
}

module.exports = {
  normalizeSite,
  discoverWalletHost,
  fetchProviders,
  fetchLobbyGames,
};
