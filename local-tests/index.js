// 本機 AI 測試註冊表（這些測試由 Claude Code 主導執行，只在本機跑）
const aiRegister = require("./register");

const tests = [aiRegister];

const registry = new Map(tests.map((t) => [t.id, t]));

function list() {
  return tests.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description || "",
    inputs: t.inputs,
  }));
}

function get(id) {
  return registry.get(id);
}

module.exports = { list, get };
