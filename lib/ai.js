// AI 執行器：透過 headless Claude Code（claude -p）執行測試任務，走使用者的 Claude Code 訂閱，不需 API key。
// 只有本機且有 OAuth token 時可用；線上 Render 沒有 claude CLI，isAvailable() 回 false。
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const TOKEN_FILE = path.join(__dirname, "..", ".claude-token");

// 砍掉整棵程序樹（shell:true 包起來的 claude 孫程序，單純 child.kill() 砍不到，會留殘留）
function killTree(child) {
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch {}
}

// 取得 headless 用的 OAuth token：優先環境變數，其次本機 .claude-token 檔（不進 git）
// token 由 `claude setup-token` 產生
function getToken() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN.trim();
  try {
    const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (t) return t;
  } catch {}
  return null;
}

function hasClaudeCli() {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    execSync(`${which} claude`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// 本機 runner 可用 = 有 claude CLI 且有 token
function isAvailable() {
  return hasClaudeCli() && !!getToken();
}

// 把任務 prompt 交給 Claude Code 執行，回傳 Claude 最後輸出的文字。
// allowedTools 預先放行工具（例如 ["Bash"] 讓它能跑 curl/node），headless 下不會跳權限詢問。
function run(prompt, { allowedTools = [], timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json"];
    if (allowedTools.length) args.push("--allowedTools", allowedTools.join(","));
    const token = getToken();
    const env = token ? { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token } : process.env;
    const child = spawn("claude", args, { shell: true, env });
    let out = "", err = "";
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error("claude 執行逾時"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      let txt = "";
      try { txt = JSON.parse(out).result || ""; } // --output-format json 外層信封
      catch { txt = out.trim(); }                  // 非 JSON（例如「Not logged in」）
      if (!txt && err) txt = err.trim();
      if (/not logged in/i.test(txt))
        return reject(new Error("Claude Code 未登入：請在已登入的終端機啟動本機 runner"));
      resolve(txt);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// 串流執行：邊跑邊回報 Claude 的每一步（onEvent），最後 resolve 最終輸出文字。
// onEvent({ kind: "text"|"tool", text }) —— text 是助理訊息片段，tool 是它執行的工具+指令摘要
function runStream(prompt, { allowedTools = [], timeoutMs = 360000, onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (allowedTools.length) args.push("--allowedTools", allowedTools.join(","));
    const token = getToken();
    const env = token ? { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token } : process.env;
    const child = spawn("claude", args, { shell: true, env });
    let buf = "", finalText = "", loginErr = false;
    const timer = setTimeout(() => { killTree(child); reject(new Error("claude 執行逾時")); }, timeoutMs);

    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === "assistant" && e.message && e.message.content) {
          for (const b of e.message.content) {
            if (b.type === "text" && b.text && b.text.trim() && onEvent)
              onEvent({ kind: "text", text: b.text.trim().slice(0, 140) });
            if (b.type === "tool_use" && onEvent) {
              const cmd = (b.input && (b.input.command || b.input.description)) || b.name;
              onEvent({ kind: "tool", text: String(cmd).replace(/\s+/g, " ").slice(0, 120) });
            }
          }
        } else if (e.type === "result") {
          finalText = e.result || "";
        }
      }
    });
    let errBuf = "";
    child.stderr.on("data", (d) => (errBuf += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      if (/not logged in/i.test(finalText) || /not logged in/i.test(errBuf))
        return reject(new Error("Claude Code 未登入：請在已登入的終端機啟動本機 runner"));
      resolve(finalText);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// 從 Claude 的文字輸出中抽出最後一個 JSON 物件並解析
function extractJson(text) {
  const matches = String(text).match(/\{[\s\S]*\}/g);
  if (!matches) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    try { return JSON.parse(matches[i]); } catch {}
  }
  return null;
}

module.exports = { isAvailable, run, runStream, extractJson };
