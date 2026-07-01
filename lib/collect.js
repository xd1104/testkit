// 共用：收集主網 + 測試網的完整資料（provider 清單 + 每個共同 provider 的 game 清單）
// 「數量比對」和「icon 比對」兩個測試都用這個，差別只在拿到資料後怎麼比。
// provider 身分用 canonical 名稱（見 lib/providers.js），跨站一致；不用 lobbyKey 配對。
const {
  normalizeSite,
  discoverWalletHost,
  fetchProviders,
  fetchLobbyGames,
} = require("./fetcher");

// 抓一家 provider 底下「所有 lobby」的 game，聯集去重（gameCode）。
// 同一家可能有多個 lobby（slot / live casino…），要全部合起來才是這家的完整遊戲清單。
async function fetchProviderGames(host, lobbyKeys, referer) {
  const lists = await Promise.all(
    lobbyKeys.map((k) => fetchLobbyGames(host, k, referer))
  );
  const byCode = new Map();
  for (const list of lists)
    for (const g of list) if (!byCode.has(g.gameCode)) byCode.set(g.gameCode, g);
  return [...byCode.values()];
}

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

  // 2. 抓兩站 provider 清單（已用 canonical 名稱去重、合併同一家的多個 lobby）
  prog({ phase: "providers", current: 0, total: 1, message: "抓 Provider 清單…" });
  const [mainProvs, testProvs] = await Promise.all([
    fetchProviders(mainHost, mainSite.referer),
    fetchProviders(testHost, testSite.referer),
  ]);

  const mainByCanon = new Map(mainProvs.map((p) => [p.canon, p]));
  const testByCanon = new Map(testProvs.map((p) => [p.canon, p]));
  const common = mainProvs.filter((p) => testByCanon.has(p.canon));

  // 3. 抓每個「兩站都有」的 provider 的 game 清單（各站用自己的 lobbyKeys 聯集）
  const games = {}; // canon -> { main: [...], test: [...] }
  let i = 0;
  for (const p of common) {
    i++;
    prog({
      phase: "games",
      current: i,
      total: common.length,
      message: `抓取 ${p.providerName} (${i}/${common.length})`,
    });
    const tp = testByCanon.get(p.canon);
    const [mg, tg] = await Promise.all([
      fetchProviderGames(mainHost, p.lobbyKeys, mainSite.referer),
      fetchProviderGames(testHost, tp.lobbyKeys, testSite.referer),
    ]);
    games[p.canon] = { main: mg, test: tg };
  }

  return { mainHost, testHost, mainProvs, testProvs, mainByCanon, testByCanon, common, games };
}

const inputs = [
  { key: "mainUrl", label: "主網 URL", placeholder: "https://www.playdee99.com" },
  { key: "testUrl", label: "測試網 URL", placeholder: "https://www.lapdee88.com" },
];

module.exports = { collectSites, inputs };
