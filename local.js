// 本機 runner：跑在你自己的電腦上，測試由 Claude Code（headless）主導執行，走你的訂閱、不需 API key。
// 用途：跨站適應的測試（例如註冊，欄位規則每站不同），以及之後的瀏覽器表單驗證測試。
// 啟動：在「已登入 Claude Code 的終端機」執行  node local.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const onlineTests = require("./tests");       // 確定性/API 測試（數量比對、icon 比對、註冊登入登出）
const localOnlyTests = require("./local-tests"); // AI / 產生指令類
const ai = require("./lib/ai");

// 本機 runner 顯示「全部」測試：確定性 + AI/產生指令
const allTests = {
  list: () => [...localOnlyTests.list(), ...onlineTests.list()], // 通用(帳號)在前、遊戲在後
  get: (id) => localOnlyTests.get(id) || onlineTests.get(id),
};

const PORT = process.env.LOCAL_PORT || 4600;
const RUNS_DIR = path.join(__dirname, "runs");
if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });

function send(res, code, type, body) { res.writeHead(code, { "Content-Type": type }); res.end(body); }
function json(res, code, obj) { send(res, code, "application/json; charset=utf-8", JSON.stringify(obj)); }

function saveRun(report) {
  const runId = report.finishedAt.replace(/[:.]/g, "-") + "_" + report.testId;
  report.runId = runId;
  fs.writeFileSync(path.join(RUNS_DIR, runId + ".json"), JSON.stringify(report, null, 2));
  return runId;
}
function listRuns() {
  return fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json")).map((f) => {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8"));
      return { runId: r.runId, testId: r.testId, name: r.name, result: r.result,
        testUrl: r.testUrl || r.siteUrl, finishedAt: r.finishedAt, durationMs: r.durationMs };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1));
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);

  if (u.pathname === "/" || u.pathname === "/index.html")
    return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(path.join(__dirname, "public", "index.html")));
  if (u.pathname === "/api/tests") return json(res, 200, allTests.list());

  // B 類：產生指令（不執行，回傳填好網址的 prompt 給使用者複製）
  if (u.pathname === "/api/prompt") {
    const test = allTests.get(u.query.testId);
    if (!test || typeof test.buildPrompt !== "function")
      return json(res, 400, { error: "unknown testId or not a prompt test" });
    return json(res, 200, { prompt: test.buildPrompt(u.query) });
  }

  if (u.pathname === "/api/runs") return json(res, 200, listRuns());
  if (u.pathname.startsWith("/api/runs/")) {
    const id = decodeURIComponent(u.pathname.slice("/api/runs/".length));
    const f = path.join(RUNS_DIR, id + ".json");
    if (!fs.existsSync(f)) return json(res, 404, { error: "not found" });
    return send(res, 200, "application/json; charset=utf-8", fs.readFileSync(f));
  }

  if (u.pathname === "/api/run") {
    const test = allTests.get(u.query.testId);
    if (!test) return json(res, 400, { error: "unknown testId" });
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const t0 = Date.now();
    try {
      let report;
      if (typeof test.run === "function") {
        // 程式驅動的本機測試（例如 Playwright 表單驗證）
        report = await test.run(u.query, (p) => emit("progress", p));
      } else {
        // Claude 主導的本機測試（buildPrompt → headless Claude Code 執行）
        emit("progress", { phase: "ai", message: "Claude 啟動中…" });
        let n = 0;
        const text = await ai.runStream(test.buildPrompt(u.query), {
          allowedTools: ["Bash", "Write"],
          timeoutMs: 540000,
          onEvent: (ev) => {
            n++;
            const icon = ev.kind === "tool" ? "🔧" : "💬";
            emit("progress", { phase: "ai", message: `(${n}) ${icon} ${ev.text}` });
          },
        });
        report = ai.extractJson(text);
        if (!report) throw new Error("Claude 沒有回傳可解析的 JSON 報告");
        Object.assign(report, {
          testId: test.id, name: test.name, siteUrl: u.query.siteUrl,
          startedAt: new Date(t0).toISOString(), finishedAt: new Date().toISOString(),
          durationMs: Date.now() - t0,
        });
        if (!report.result) report.result = (report.steps || []).every((s) => s.status === "PASS") ? "PASS" : "FAIL";
      }
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
  console.log(`本機 runner 已啟動 → http://localhost:${PORT}`);
  if (ai.isAvailable()) {
    console.log("✓ claude CLI + OAuth token 就緒（測試會走你的 Claude Code 訂閱）");
  } else {
    console.log("⚠️  尚未就緒。請確認：");
    console.log("   1) 已安裝 claude CLI");
    console.log("   2) 已用 `claude setup-token` 產生 token，並把 token 放進專案根目錄的 .claude-token 檔");
    console.log("      （或設環境變數 CLAUDE_CODE_OAUTH_TOKEN）");
  }
});
