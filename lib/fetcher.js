// 負責跟目標站要資料：探測 wallet host、抓 provider 清單、抓每個 lobby 的 game 清單
const https = require("https");

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

// 抓 home.game 的 provider 清單，用 lobbyKey 去重（不可用 seq）
async function fetchProviders(walletHost, referer) {
  const r = await httpGet(
    walletHost + "/func/cms/getCmsPageInfo?page=home.game",
    referer
  );
  const d = JSON.parse(r.body);
  if (!d.result || !d.result.categoryList)
    throw new Error("getCmsPageInfo 回傳格式異常");
  const map = new Map(); // lobbyKey -> { lobbyKey, providerName, categories:Set }
  for (const cat of d.result.categoryList) {
    for (const blk of cat.data || []) {
      for (const o of blk.obj || []) {
        if (!o.lobbyKey) continue;
        if (!map.has(o.lobbyKey))
          map.set(o.lobbyKey, {
            lobbyKey: o.lobbyKey,
            providerName: o.providerName,
            categories: new Set(),
          });
        map.get(o.lobbyKey).categories.add(cat.category);
      }
    }
  }
  return [...map.values()];
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
    }));
}

module.exports = {
  normalizeSite,
  discoverWalletHost,
  fetchProviders,
  fetchLobbyGames,
};
