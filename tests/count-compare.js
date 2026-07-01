// 測試項目：Provider & Game 數量比對
// 比對主網 vs 測試網的：
//   1. 總 Provider 清單（誰有誰沒有）
//   2. 每個遊戲種類（slot/lc/sport/arcade/fish/p2p…）各差了哪些 Provider
//   3. 每個共同 Provider 底下的 game 清單（誰有誰沒有，用 gameCode）
// 三者全一致才 PASS。不比 icon —— icon 請用「Provider & Game Icon 比對」（建議數量先對再比 icon）
// Provider 身分用 canonical 名稱（見 lib/providers.js）跨站配對，不用 lobbyKey。
const { collectSites, inputs } = require("../lib/collect");

const id = "count-compare";
const name = "Provider & Game 數量比對";
const description =
  "比對測試網與主網的 Provider 清單、每個遊戲種類各差了哪些 Provider，以及每個 Provider 底下的遊戲清單。全部一致才 PASS。需填主網 + 測試網兩個網址。";

// 遊戲種類代碼 → 顯示名稱（對照網站分頁）。
// home 是「總覽」聚合類、非真正遊戲種類，不列入逐種類比對。
const CAT_LABELS = {
  slot: "SLOT", lc: "LIVE CASINO", sport: "SPORT", arcade: "ARCADE",
  fish: "FISHING", p2p: "P2P", table: "TABLE", esport: "ESPORT",
  lottery: "LOTTERY", cockfight: "COCKFIGHT",
};
const EXCLUDED_CATS = new Set(["home"]);
const catLabel = (c) => CAT_LABELS[c] || String(c).toUpperCase();

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
    categories: [],
    lobbyDiffs: [],
  };

  const data = await collectSites(params, onProgress);
  report.walletHosts = { main: data.mainHost, test: data.testHost };

  const provInfo = (p) => ({ providerName: p.providerName, canon: p.canon });

  // 1. 總 Provider 清單比對（用 canonical 名稱）
  report.providerDiff.onlyInMain = data.mainProvs
    .filter((p) => !data.testByCanon.has(p.canon))
    .map(provInfo);
  report.providerDiff.onlyInTest = data.testProvs
    .filter((p) => !data.mainByCanon.has(p.canon))
    .map(provInfo);

  // 2. 每個遊戲種類各差了哪些 Provider（排除 home 聚合類）
  const allCats = new Set();
  for (const p of data.mainProvs) for (const c of p.categories) allCats.add(c);
  for (const p of data.testProvs) for (const c of p.categories) allCats.add(c);
  const cats = [...allCats].filter((c) => !EXCLUDED_CATS.has(c)).sort();
  const nameOf = (c) => (data.mainByCanon.get(c) || data.testByCanon.get(c) || {}).providerName || c;
  let categoriesWithDiff = 0;
  let categoriesWithOrderDiff = 0;
  for (const cat of cats) {
    const mainIn = data.mainProvs.filter((p) => p.categories.has(cat));
    const testIn = data.testProvs.filter((p) => p.categories.has(cat));
    const mainCatCanon = new Set(mainIn.map((p) => p.canon));
    const testCatCanon = new Set(testIn.map((p) => p.canon));
    const onlyInMain = mainIn.filter((p) => !testCatCanon.has(p.canon)).map(provInfo);
    const onlyInTest = testIn.filter((p) => !mainCatCanon.has(p.canon)).map(provInfo);
    if (onlyInMain.length || onlyInTest.length) categoriesWithDiff++;

    // 排序比對（以主網為準）：只比兩站都有的 provider 的相對順序
    const mainSeq = (data.mainOrder[cat] || []).filter((c) => testCatCanon.has(c));
    const testSeq = (data.testOrder[cat] || []).filter((c) => mainCatCanon.has(c));
    const orderDiffers = mainSeq.join("|") !== testSeq.join("|");
    let order = null;
    if (orderDiffers) {
      categoriesWithOrderDiff++;
      const testPos = new Map(testSeq.map((c, i) => [c, i]));
      const moved = [];
      mainSeq.forEach((c, i) => {
        const j = testPos.get(c);
        if (j !== i) moved.push({ providerName: nameOf(c), mainPos: i + 1, testPos: j + 1 });
      });
      order = { mainSeq: mainSeq.map(nameOf), testSeq: testSeq.map(nameOf), moved };
    }

    report.categories.push({
      category: cat,
      label: catLabel(cat),
      mainCount: mainIn.length,
      testCount: testIn.length,
      onlyInMain,
      onlyInTest,
      orderDiffers,
      order,
    });
  }

  // 3. 每個共同 provider 的 game 清單比對（誰有誰沒有）
  for (const p of data.common) {
    const { main: mg, test: tg } = data.games[p.canon];
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
        providerName: p.providerName,
        canon: p.canon,
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
    categoriesWithDiff,
    categoriesWithOrderDiff,
    lobbiesWithGameDiff: report.lobbyDiffs.length,
  };
  report.result =
    report.providerDiff.onlyInMain.length === 0 &&
    report.providerDiff.onlyInTest.length === 0 &&
    categoriesWithDiff === 0 &&
    categoriesWithOrderDiff === 0 &&
    report.lobbyDiffs.length === 0
      ? "PASS"
      : "FAIL";
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - t0;
  return report;
}

const category = "遊戲";
module.exports = { id, name, description, category, inputs, run };
