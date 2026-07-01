// 跨站 provider 身分正規化。
// 為什麼需要：provider 的 lobbyKey 在不同站不一定相同（例如 PRAGMATIC 兩站 key 不同），
// 有些同一家還會用不同名稱（例如 MICRO GAMING / MG Plus）。所以跨站比對要用「正規化後的名稱」
// 當身分，而不是 lobbyKey；同一家的不同寫法會收斂成同一個 canonical key。

// 別名 → 標準名（左右都用正規化後的形式：全小寫、只留英數）。
// 只在「同一家但正規化後仍不同字」時才需要加，例如 MG Plus 對到 Micro Gaming。
// 註：大小寫、空格、標點的差異（Micro Gaming / MICRO GAMING / MicroGaming）normName 已自動收斂，不必列。
const ALIASES = {
  "mgplus": "microgaming",
};

// 名稱正規化：小寫、去掉所有非英數字元（空格、標點、大小寫差異一律無視）。
// 若整個名稱都不是英數（極端情況），退回用去空白小寫，避免變成空字串。
function normName(name) {
  const s = String(name || "").toLowerCase();
  const alnum = s.replace(/[^a-z0-9]+/g, "");
  return alnum || s.trim().replace(/\s+/g, " ");
}

// 跨站一致的 provider 身分 key
function canonicalProvider(name) {
  const n = normName(name);
  return ALIASES[n] || n;
}

module.exports = { canonicalProvider, normName };
