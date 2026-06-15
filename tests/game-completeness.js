// 測試項目：Game 完整度
// 定義：拿測試網跟主網比對，Provider 清單 + 每個 Provider 底下的 game 清單完全一致才 PASS
const {
  normalizeSite,
  discoverWalletHost,
  fetchProviders,
  fetchLobbyGames,
} = require("../lib/fetcher");

const id = "game-completeness";
const name = "Game 完整度";
const inputs = [
  { key: "mainUrl", label: "主網 URL", placeholder: "https://www.playdee99.com" },
  { key: "testUrl", label: "測試網 URL", placeholder: "https://www.lapdee88.com" },
];

// 比對兩個 gameCode 清單
function diffGames(mainGames, testGames) {
  const mainMap = new Map(mainGames.map((g) => [g.gameCode, g]));
  const testMap = new Map(testGames.map((g) => [g.gameCode, g]));
  const missing = mainGames
    .filter((g) => !testMap.has(g.gameCode))
    .map((g) => ({ gameCode: g.gameCode, gameName: g.gameName }));
  const extra = testGames
    .filter((g) => !mainMap.has(g.gameCode))
    .map((g) => ({ gameCode: g.gameCode, gameName: g.gameName }));
  return { missing, extra };
}

// onProgress({ phase, current, total, message }) 回報即時進度
async function run(params, onProgress) {
  const report = {
    testId: id,
    name,
    mainUrl: params.mainUrl,
    testUrl: params.testUrl,
    startedAt: new Date().toISOString(),
    result: "PASS",
    walletHosts: {},
    summary: {},
    providerDiff: { onlyInMain: [], onlyInTest: [] },
    lobbyDiffs: [],
  };
  const t0 = Date.now();
  const prog = (p) => onProgress && onProgress(p);

  // 1. 正規化 + 探測 wallet host
  const mainSite = normalizeSite(params.mainUrl);
  const testSite = normalizeSite(params.testUrl);
  prog({ phase: "discover", current: 0, total: 1, message: "探測 wallet host…" });
  const [mainHost, testHost] = await Promise.all([
    discoverWalletHost(mainSite),
    discoverWalletHost(testSite),
  ]);
  report.walletHosts = { main: mainHost, test: testHost };

  // 2. 抓兩站 provider 清單
  prog({ phase: "providers", current: 0, total: 1, message: "抓 Provider 清單…" });
  const [mainProvs, testProvs] = await Promise.all([
    fetchProviders(mainHost, mainSite.referer),
    fetchProviders(testHost, testSite.referer),
  ]);

  // 3. 比對 provider 清單
  const mainKeys = new Map(mainProvs.map((p) => [p.lobbyKey, p]));
  const testKeys = new Map(testProvs.map((p) => [p.lobbyKey, p]));
  report.providerDiff.onlyInMain = mainProvs
    .filter((p) => !testKeys.has(p.lobbyKey))
    .map((p) => ({ lobbyKey: p.lobbyKey, providerName: p.providerName }));
  report.providerDiff.onlyInTest = testProvs
    .filter((p) => !mainKeys.has(p.lobbyKey))
    .map((p) => ({ lobbyKey: p.lobbyKey, providerName: p.providerName }));

  // 4. 對「兩站都有」的 lobby 比對 game 清單
  const common = mainProvs.filter((p) => testKeys.has(p.lobbyKey));
  const total = common.length;
  let i = 0;
  for (const p of common) {
    i++;
    prog({
      phase: "games",
      current: i,
      total,
      message: `比對 ${p.providerName} (${i}/${total})`,
    });
    const [mg, tg] = await Promise.all([
      fetchLobbyGames(mainHost, p.lobbyKey, mainSite.referer),
      fetchLobbyGames(testHost, p.lobbyKey, testSite.referer),
    ]);
    const { missing, extra } = diffGames(mg, tg);
    if (missing.length || extra.length) {
      report.lobbyDiffs.push({
        lobbyKey: p.lobbyKey,
        providerName: p.providerName,
        mainCount: mg.length,
        testCount: tg.length,
        missing,
        extra,
      });
    }
  }

  // 5. 彙總與判定
  report.summary = {
    mainProviders: mainProvs.length,
    testProviders: testProvs.length,
    providerMissing: report.providerDiff.onlyInMain.length,
    providerExtra: report.providerDiff.onlyInTest.length,
    lobbiesWithGameDiff: report.lobbyDiffs.length,
  };
  const ok =
    report.providerDiff.onlyInMain.length === 0 &&
    report.providerDiff.onlyInTest.length === 0 &&
    report.lobbyDiffs.length === 0;
  report.result = ok ? "PASS" : "FAIL";
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - t0;
  return report;
}

module.exports = { id, name, inputs, run };
