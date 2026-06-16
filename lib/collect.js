// 共用：收集主網 + 測試網的完整資料（provider 清單 + 每個共同 lobby 的 game 清單）
// 「數量比對」和「icon 比對」兩個測試都用這個，差別只在拿到資料後怎麼比
const {
  normalizeSite,
  discoverWalletHost,
  fetchProviders,
  fetchLobbyGames,
} = require("./fetcher");

async function collectSites(params, onProgress) {
  const prog = (p) => onProgress && onProgress(p);
  const mainSite = normalizeSite(params.mainUrl);
  const testSite = normalizeSite(params.testUrl);

  // 1. 探測 wallet host
  prog({ phase: "discover", current: 0, total: 1, message: "探測 wallet host…" });
  const [mainHost, testHost] = await Promise.all([
    discoverWalletHost(mainSite),
    discoverWalletHost(testSite),
  ]);

  // 2. 抓兩站 provider 清單
  prog({ phase: "providers", current: 0, total: 1, message: "抓 Provider 清單…" });
  const [mainProvs, testProvs] = await Promise.all([
    fetchProviders(mainHost, mainSite.referer),
    fetchProviders(testHost, testSite.referer),
  ]);

  const mainKeys = new Map(mainProvs.map((p) => [p.lobbyKey, p]));
  const testKeys = new Map(testProvs.map((p) => [p.lobbyKey, p]));
  const common = mainProvs.filter((p) => testKeys.has(p.lobbyKey));

  // 3. 抓每個「兩站都有」的 lobby 的 game 清單
  const games = {}; // lobbyKey -> { main: [...], test: [...] }
  let i = 0;
  for (const p of common) {
    i++;
    prog({
      phase: "games",
      current: i,
      total: common.length,
      message: `抓取 ${p.providerName} (${i}/${common.length})`,
    });
    const [mg, tg] = await Promise.all([
      fetchLobbyGames(mainHost, p.lobbyKey, mainSite.referer),
      fetchLobbyGames(testHost, p.lobbyKey, testSite.referer),
    ]);
    games[p.lobbyKey] = { main: mg, test: tg };
  }

  return { mainHost, testHost, mainProvs, testProvs, mainKeys, testKeys, common, games };
}

const inputs = [
  { key: "mainUrl", label: "主網 URL", placeholder: "https://www.playdee99.com" },
  { key: "testUrl", label: "測試網 URL", placeholder: "https://www.lapdee88.com" },
];

module.exports = { collectSites, inputs };
