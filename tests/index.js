// 測試項目註冊表。之後新增測試項目，在這裡加一行 require 即可。
const countCompare = require("./count-compare");
const iconCompare = require("./icon-compare");
const registerLoginLogout = require("./register-login-logout");

const tests = [countCompare, iconCompare, registerLoginLogout];

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
