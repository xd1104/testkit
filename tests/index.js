// 測試項目註冊表。之後新增測試項目，在這裡加一行 require 即可。
// 註：register-login-logout.js（確定性帳號流程）已從清單移除，帳號流程改用 local-tests 的 AI 版。
const countCompare = require("./count-compare");
const iconCompare = require("./icon-compare");

const tests = [countCompare, iconCompare];

const registry = new Map(tests.map((t) => [t.id, t]));

function list() {
  return tests.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description || "",
    category: t.category || "其他",
    inputs: t.inputs,
  }));
}

function get(id) {
  return registry.get(id);
}

module.exports = { list, get };
