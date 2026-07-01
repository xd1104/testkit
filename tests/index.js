// 測試項目註冊表。之後新增測試項目，在這裡加一行 require 即可。
// 註：帳號流程（註冊/登入/登出）測項已移除——testkit 專注於確定性的比對型測試。
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
