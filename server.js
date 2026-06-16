// 本機測試工具 server：提供前端網頁 + 觸發測試 + 即時進度(SSE) + 歷史紀錄
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const tests = require("./tests");

const PORT = process.env.PORT || 4500;
const RUNS_DIR = path.join(__dirname, "runs");
// 設了 APP_PASSWORD 環境變數就啟用密碼保護（線上部署時設定）；沒設則不擋（本機方便用）
const APP_PASSWORD = process.env.APP_PASSWORD || "";

// 確保歷史資料夾存在（runs/ 被 .gitignore 排除，部署環境不會有，啟動時自動建）
if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });

// 瀏覽器原生 Basic Auth：帳號隨意，密碼要對。EventSource 會自動帶上認證
function checkAuth(req, res) {
  if (!APP_PASSWORD) return true;
  const h = req.headers.authorization || "";
  const b64 = h.split(" ")[1];
  if (b64) {
    const pass = Buffer.from(b64, "base64").toString().split(":")[1];
    if (pass === APP_PASSWORD) return true;
  }
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="testkit"',
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end("需要密碼");
  return false;
}

function send(res, code, type, body) {
  res.writeHead(code, { "Content-Type": type });
  res.end(body);
}
function json(res, code, obj) {
  send(res, code, "application/json; charset=utf-8", JSON.stringify(obj));
}

// 把報告存成歷史檔
function saveRun(report) {
  const runId = report.finishedAt.replace(/[:.]/g, "-") + "_" + report.testId;
  report.runId = runId;
  fs.writeFileSync(
    path.join(RUNS_DIR, runId + ".json"),
    JSON.stringify(report, null, 2)
  );
  return runId;
}

function listRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8"));
        return {
          runId: r.runId,
          testId: r.testId,
          name: r.name,
          result: r.result,
          mainUrl: r.mainUrl,
          testUrl: r.testUrl || r.siteUrl,
          finishedAt: r.finishedAt,
          durationMs: r.durationMs,
          summary: r.summary,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1));
}

const server = http.createServer(async (req, res) => {
  if (!checkAuth(req, res)) return;
  const u = url.parse(req.url, true);

  // 前端首頁
  if (u.pathname === "/" || u.pathname === "/index.html") {
    return send(
      res,
      200,
      "text/html; charset=utf-8",
      fs.readFileSync(path.join(__dirname, "public", "index.html"))
    );
  }

  // 測試項目清單
  if (u.pathname === "/api/tests") {
    return json(res, 200, tests.list());
  }

  // 歷史清單
  if (u.pathname === "/api/runs") {
    return json(res, 200, listRuns());
  }

  // 單筆歷史
  if (u.pathname.startsWith("/api/runs/")) {
    const id = decodeURIComponent(u.pathname.slice("/api/runs/".length));
    const f = path.join(RUNS_DIR, id + ".json");
    if (!fs.existsSync(f)) return json(res, 404, { error: "not found" });
    return send(res, 200, "application/json; charset=utf-8", fs.readFileSync(f));
  }

  // 執行測試（SSE 串流：progress 事件 + 最後 done 事件）
  if (u.pathname === "/api/run") {
    const test = tests.get(u.query.testId);
    if (!test) return json(res, 400, { error: "unknown testId" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const emit = (event, data) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      const report = await test.run(u.query, (p) => emit("progress", p));
      saveRun(report);
      emit("done", report);
    } catch (e) {
      emit("error", { message: String((e && e.message) || e) });
    }
    return res.end();
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`測試工具已啟動 → http://localhost:${PORT}`);
});
