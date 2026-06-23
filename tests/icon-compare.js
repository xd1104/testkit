// 測試項目：Provider & Game Icon 比對
// 只比「兩站都有」的 Provider / Game 的 icon（比路徑/檔名，忽略網域），icon 全一致才 PASS
// 建議先跑「Provider & Game 數量比對」確認數量對了，再跑這個比 icon
const { collectSites, inputs } = require("../lib/collect");

const id = "icon-compare";
const name = "Provider & Game Icon 比對";
const description =
  "比對兩站都有的 Provider / 遊戲的 icon（只比路徑，忽略網域與副檔名）。icon 全一致才 PASS。建議先過數量比對再跑這個。需填主網 + 測試網兩個網址。";

// 比 icon 時忽略副檔名（.png / .webp 等只是格式不同，圖視為相同）
const stripExt = (s) => String(s || "").replace(/\.[a-z0-9]+$/i, "");
const sameIcon = (a, b) => stripExt(a) === stripExt(b);

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
    providerIconDiffs: [],
    lobbyDiffs: [],
  };

  const data = await collectSites(params, onProgress);
  report.walletHosts = { main: data.mainHost, test: data.testHost };

  // Provider icon 比對（只比兩站都有的）
  for (const p of data.mainProvs) {
    const t = data.testKeys.get(p.lobbyKey);
    if (t && !sameIcon(p.icon, t.icon)) {
      report.providerIconDiffs.push({
        lobbyKey: p.lobbyKey,
        providerName: p.providerName,
        mainIcon: p.icon,
        testIcon: t.icon,
      });
    }
  }

  // Game icon 比對（每個共同 lobby，比兩邊都有的 gameCode 的 icon）
  for (const p of data.common) {
    const { main: mg, test: tg } = data.games[p.lobbyKey];
    const testMap = new Map(tg.map((g) => [g.gameCode, g]));
    const iconChanged = mg
      .filter((g) => testMap.has(g.gameCode) && !sameIcon(g.icon, testMap.get(g.gameCode).icon))
      .map((g) => ({
        gameCode: g.gameCode,
        gameName: g.gameName,
        mainIcon: g.icon,
        testIcon: testMap.get(g.gameCode).icon,
      }));
    if (iconChanged.length) {
      report.lobbyDiffs.push({
        lobbyKey: p.lobbyKey,
        providerName: p.providerName,
        mainCount: mg.length,
        testCount: tg.length,
        missing: [],
        extra: [],
        iconChanged,
      });
    }
  }

  report.summary = {
    mainProviders: data.mainProvs.length,
    testProviders: data.testProvs.length,
    providerIconDiff: report.providerIconDiffs.length,
    gameIconDiff: report.lobbyDiffs.reduce((n, d) => n + d.iconChanged.length, 0),
  };
  report.result =
    report.providerIconDiffs.length === 0 && report.lobbyDiffs.length === 0
      ? "PASS"
      : "FAIL";
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - t0;
  return report;
}

const category = "遊戲";
module.exports = { id, name, description, category, inputs, run };
