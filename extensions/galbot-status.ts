// galbot-sdk 的 pi 扩展：状态栏 + 常驻文字注入 + 只读执法 + /galbot 切模式。
//
// 与 Claude Code 侧共用 flag 文件（~/.claude/.galbot-mode）和同一份判读器
// （adapters/claude-code/hook.py）。这里不重抄规则，两边一致靠调同一个 Python。
//
// 装法见 install.sh：复制到 ~/.pi/agent/extensions/，不是软链（那个目录
// 会同步到 GitHub，软链在别的机器上是断的）。

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const MODES = ["local", "read", "off"] as const;
type Mode = (typeof MODES)[number];
const DEFAULT_MODE: Mode = "local";

// 复制到 pi 的扩展目录后就离开了仓库，所以仓库路径要能被覆盖
const REPO = process.env.GALBOT_SKILL_REPO || join(homedir(), "galbot-sdk-skill");
const HOOK = join(REPO, "adapters", "claude-code", "hook.py");

const isMode = (s: string): s is Mode => (MODES as readonly string[]).includes(s);

function flagPath(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), ".galbot-mode");
}

// flag 一行：`<mode> [HPU_IP] [XCU_IP]`
function readFlag(): { mode: Mode; hpu?: string; xcu?: string } {
  try {
    const parts = readFileSync(flagPath(), "utf8").trim().split(/\s+/);
    let m = (parts[0] || "").toLowerCase();
    m = { offline: "local", readonly: "read" }[m] ?? m;   // 旧写法
    const cut = (v?: string) => v?.replace(/\+$/, "");   // 旧 flag 的连通性标记
    return { mode: isMode(m) ? m : DEFAULT_MODE, hpu: cut(parts[1]), xcu: cut(parts[2]) };
  } catch {
    return { mode: DEFAULT_MODE };
  }
}

function readMode(): Mode {
  const env = String(process.env.GALBOT_SKILL_MODE || "").trim().toLowerCase();
  return isMode(env) ? env : readFlag().mode;
}

// 换了 HPU 就必须重给 XCU，两台机器的 XCU 地址无关，留着会连到另一台机器人
function writeMode(mode: Mode, hpu?: string, xcu?: string): void {
  const prev = readFlag();
  let keepHpu = hpu, keepXcu = xcu;
  if (!hpu) {
    keepHpu = prev.hpu;
    if (!xcu) keepXcu = prev.xcu;
  } else if (!xcu && hpu === prev.hpu) {
    keepXcu = prev.xcu;
  }
  const p = flagPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, [mode, keepHpu, keepXcu].filter(Boolean).join(" "), "utf8");
}

function residentText(mode: Mode): string {
  if (mode === "off") return "";
  try {
    return execFileSync("python3", [HOOK, "resident", mode],
      { encoding: "utf8", timeout: 5000 });
  } catch {
    return ""; // python 不在或仓库被挪走，徽章和拦截仍要能用
  }
}

// 拦不拦交给 Python 判，退出码 2 = 拦。off 也要走这条 —— 它只关常驻提示，不关拦截。
function denyReason(mode: Mode, command: string): string | null {
  try {
    execFileSync("python3", [HOOK, "guard"], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, GALBOT_SKILL_MODE: mode },
    });
    return null;
  } catch (e: any) {
    if (e?.status === 2) return String(e.stderr || "").trim() || "galbot-sdk：当前模式不允许这条命令。";
    return null; // 判读器本身出错：pi 侧放行，Claude Code 侧仍有一道
  }
}

export default function (pi: ExtensionAPI) {
  let mode: Mode = readMode();
  let busy = false;

  function sync(ctx?: any) {
    const ui = ctx?.ui;
    if (!ui?.setStatus) return;
    let theme: any;
    try { theme = ui.theme; } catch { return; }
    if (!theme?.fg) return;
    // off 也要显：静默关掉最危险，看不出是护栏关了还是 skill 根本没装
    // 亮的是权限高的那个：徽章醒目 = 这个会话能碰机器人。
    // 两端地址都显，占位符用 ASCII（中文宽度算不准会挤歪后面的徽章）：
    // 现场多台 G1 时「连的哪台」比「什么模式」更要紧，XCU 缺不缺决定能不能查急停。
    const f = readFlag();
    const label = mode === "read"
      ? theme.fg("accent", `🔗 READ (HPU:${f.hpu || "NONE"})(XCU:${f.xcu || "NONE"})`)
      : mode === "local" ? theme.fg("muted", "💻 LOCAL")
        : theme.fg("dim", "💤 OFF");
    const dot = busy ? theme.fg("accent", "●") : theme.fg("dim", "○");
    ui.setStatus("galbot", dot + " ✨ " + theme.fg("muted", "galbot: ") + label);
  }

  pi.registerCommand("galbot", {
    description: `Switch galbot-sdk mode: ${MODES.join("|")}`,
    handler: async (args, ctx) => {
      const parts = (args || "").trim().split(/\s+/).filter(Boolean);
      const arg = (parts[0] || "").toLowerCase();
      const ok = (v?: string) => (/^[\w.-]+$/.test(v || "") ? v : undefined);
      if (!arg || arg === "status") {
        const f = readFlag();
        ctx.ui.notify(`galbot-sdk 模式: ${f.mode}`
          + (f.hpu ? `，HPU ${f.hpu}` : "") + (f.xcu ? `，XCU ${f.xcu}` : ""), "info");
        return;
      }
      if (!isMode(arg)) {
        ctx.ui.notify(`未知模式 "${arg}"，只能是 ${MODES.join(" / ")}`, "warning");
        return;
      }
      mode = arg;
      writeMode(mode, ok(parts[1]), ok(parts[2]));   // /galbot read <HPU> [XCU]
      sync(ctx);
      const f = readFlag();
      const target = f.hpu
        ? `${f.hpu}${f.xcu ? " / XCU " + f.xcu : "（XCU 未指定，跑不了 precheck）"}`
        : "未指定，先问用户要 HPU IP";
      ctx.ui.notify(
        mode === "read" ? `galbot-sdk: read，目标 ${target}，机器人只读`
          : mode === "local" ? "galbot-sdk: local，不连机器人，ssh/scp 会被拦"
            : "galbot-sdk: off，拦截已关", "info");
    },
  });

  // 只读执法。pi 的 tool_call 可以 block，跟 Claude Code 的 PreToolUse 同级。
  pi.on("tool_call", async (event) => {
    if (event?.toolName !== "bash") return;
    mode = readMode();   // 每次现读：模式可能被 Claude Code 侧或人手改过
    const command = String((event as any)?.input?.command || "");
    if (!command) return;
    const reason = denyReason(mode, command);
    if (reason) return { block: true, reason };
  });

  pi.on("before_agent_start", async (event: any) => {
    mode = readMode();
    const text = residentText(mode);
    if (!text) return;
    const base = event?.systemPrompt ? `${event.systemPrompt}\n\n` : "";
    return { systemPrompt: `${base}${text}` };
  });

  pi.on("session_start", async (_event, ctx) => { mode = readMode(); sync(ctx); });
  pi.on("agent_start", async (_event, ctx) => { busy = true; sync(ctx); });
  pi.on("agent_end", async (_event, ctx) => { busy = false; sync(ctx); });
}
