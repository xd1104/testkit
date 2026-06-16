// 通用 HTTPS 請求工具（支援 POST / 自訂 header / cookie），給註冊登入登出這種有流程的測試用
const https = require("https");

function request(url, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: data })
      );
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout: " + url)));
    if (body) req.write(body);
    req.end();
  });
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

module.exports = { request, safeJson };
