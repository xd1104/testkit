// 測試項目：Provider & Game 數量比對
// 比對主網 vs 測試網的 Provider 清單，以及每個 Provider 底下的 game 清單（誰有誰沒有）
// 完全一致才 PASS。不比 icon —— icon 請用「Provider & Game Icon 比對」（建議數量先對再比 icon）
const { collectSites, inputs } = require("../lib/collect");

const id = "count-compare";
const name = "Provider & Game 數量比對";
const description =
  "比對測試網與主網的 Provider 清單，以及每個 Provider 底下的遊戲清單（誰有誰沒有）。完全一致才 PASS。需填主網 + 測試網兩個網址。";

async function run(params, onProgress) {
  const t0 = Date.now();
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

  const data = await collectSites(params, onProgress);
  report.walletHosts = { main: data.mainHost, test: data.testHost };

  // Provider 清單比對
  report.providerDiff.onlyInMain = data.mainProvs
    .filter((p) => !data.testKeys.has(p.lobbyKey))
    .map((p) => ({ lobbyKey: p.lobbyKey, providerName: p.providerName }));
  report.providerDiff.onlyInTest = data.testProvs
    .filter((p) => !data.mainKeys.has(p.lobbyKey))
    .map((p) => ({ lobbyKey: p.lobbyKey, providerName: p.providerName }));

  // 每個共同 lobby 的 game 清單比對（誰有誰沒有）
  for (const p of data.common) {
    const { main: mg, test: tg } = data.games[p.lobbyKey];
    const testCodes = new Set(tg.map((g) => g.gameCode));
    const mainCodes = new Set(mg.map((g) => g.gameCode));
    const missing = mg
      .filter((g) => !testCodes.has(g.gameCode))
      .map((g) => ({ gameCode: g.gameCode, gameName: g.gameName }));
    const extra = tg
      .filter((g) => !mainCodes.has(g.gameCode))
      .map((g) => ({ gameCode: g.gameCode, gameName: g.gameName }));
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

  report.summary = {
    mainProviders: data.mainProvs.length,
    testProviders: data.testProvs.length,
    providerMissing: report.providerDiff.onlyInMain.length,
    providerExtra: report.providerDiff.onlyInTest.length,
    lobbiesWithGameDiff: report.lobbyDiffs.length,
  };
  report.result =
    report.providerDiff.onlyInMain.length === 0 &&
    report.providerDiff.onlyInTest.length === 0 &&
    report.lobbyDiffs.length === 0
      ? "PASS"
      : "FAIL";
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - t0;
  return report;
}

module.exports = { id, name, description, inputs, run };
