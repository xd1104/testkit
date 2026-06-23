// 本機測試註冊表
// 兩種類型：
//   A 類（執行）：buildPrompt → 由 headless Claude Code 跑（如 register），或有 run() 的程式驅動
//   B 類（產生指令，mode:"prompt"）：工具不跑，產生 prompt 給使用者複製到自己的 Claude 對話
const aiRegister = require("./register");
const formValidationPrompt = require("./form-validation-prompt");

const tests = [aiRegister, formValidationPrompt];

const registry = new Map(tests.map((t) => [t.id, t]));

function list() {
  return tests.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description || "",
    category: t.category || "其他",
    mode: t.mode || "auto",
    inputs: t.inputs,
  }));
}

function get(id) {
  return registry.get(id);
}

module.exports = { list, get };
