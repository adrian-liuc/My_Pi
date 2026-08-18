// galbot-sdk 的 pi 扩展：状态栏 + 常驻文字注入 + 只读执法 + /galbot 切模式。
//
// 与 Claude Code 侧共用同一个 flag 文件和同一份常驻正文：
//   模式  ~/.claude/.galbot-mode（一个单词）
//   正文  SKILL.md 里的 <!-- resident:MODE --> 块
//   判读  hooks/galbot_hook.py，拦不拦由它说了算
// 这里不重抄任何规则 —— 两边行为一致靠的是调同一个 Python，不是靠两份实现对齐。
//
// 装法见仓内 hooks/install.sh（复制到 ~/.pi/agent/extensions/，不是软链 ——
// 那个目录是会同步到 GitHub 的 git 仓，软链在别的机器上会指向不存在的路径）。

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const MODES = ["offline", "readonly", "off"] as const;
type Mode = (typeof MODES)[number];
const DEFAULT_MODE: Mode = "offline";

// 复制到 pi 的扩展目录后就离开了仓库，所以仓库路径要能被覆盖。
const REPO = process.env.GALBOT_SKILL_REPO || join(homedir(), "galbot-sdk-skill");
const HOOK = join(REPO, "hooks", "galbot_hook.py");

const isMode = (s: string): s is Mode => (MODES as readonly string[]).includes(s);

function flagPath(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), ".galbot-mode");
}

function readMode(): Mode {
  const env = String(process.env.GALBOT_SKILL_MODE || "").trim().toLowerCase();
  if (isMode(env)) return env;
  try {
    const m = readFileSync(flagPath(), "utf8").trim().toLowerCase();
    return isMode(m) ? m : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function writeMode(mode: Mode): void {
  const p = flagPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, mode, "utf8");
}

// 常驻正文取一次缓存住：before_agent_start 每轮都触发，每轮 spawn 一次
// python 是白花的 30ms。正文只在 SKILL.md 改动后变，会话内不会变。
const residentCache = new Map<string, string>();
function residentText(mode: Mode): string {
  if (mode === "off") return "";
  const hit = residentCache.get(mode);
  if (hit !== undefined) return hit;
  let text = "";
  try {
    text = execFileSync("python3", [HOOK, "resident", mode], { encoding: "utf8", timeout: 5000 });
  } catch {
    text = ""; // python 不在或仓库被挪走 —— 徽章和拦截仍要能用
  }
  residentCache.set(mode, text);
  return text;
}

/** 拦不拦交给 Python 判，退出码 2 = 拦。两侧同一套规则，不在 TS 里重写一遍。 */
function denyReason(mode: Mode, command: string): string | null {
  if (mode === "off") return null;
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
    return null; // 判读器自己坏了：pi 侧放行，Claude Code 侧仍有一道
  }
}

export default function (pi: ExtensionAPI) {
  let mode: Mode = readMode();

  function sync(ctx?: any) {
    const ui = ctx?.ui;
    if (!ui?.setStatus) return;
    let theme: any;
    try { theme = ui.theme; } catch { return; }
    if (!theme?.fg) return;
    if (mode === "off") { ui.setStatus("galbot", ""); return; }
    // 亮的是权限高的那个：徽章醒目 = 这个会话能碰机器人。
    // 跟 caveman/ponytail「强度高才亮」相反，这里危险的是权限不是强度。
    const label = mode === "readonly"
      ? theme.fg("accent", "🔓 READONLY")
      : theme.fg("muted", "🔒 OFFLINE");
    ui.setStatus("galbot", "🤖 " + theme.fg("muted", "galbot: ") + label);
  }

  pi.registerCommand("galbot", {
    description: `Switch galbot-sdk mode: ${MODES.join("|")}`,
    handler: async (args, ctx) => {
      const arg = (args || "").trim().toLowerCase();
      if (!arg || arg === "status") {
        ctx.ui.notify(`galbot-sdk 模式: ${mode}`, "info");
        return;
      }
      if (!isMode(arg)) {
        ctx.ui.notify(`未知模式 "${arg}"，只能是 ${MODES.join(" / ")}`, "warning");
        return;
      }
      mode = arg;
      writeMode(mode);
      sync(ctx);
      ctx.ui.notify(
        mode === "readonly"
          ? "galbot-sdk: readonly —— 机器人只读，写操作仍然拦截"
          : mode === "offline"
            ? "galbot-sdk: offline —— 不连机器人，ssh/scp 会被拦"
            : "galbot-sdk: off —— 拦截已关",
        "info",
      );
    },
  });

  // 只读执法。pi 的 tool_call 可以 block，跟 Claude Code 的 PreToolUse 同级。
  pi.on("tool_call", async (event) => {
    if (event?.toolName !== "bash") return;
    mode = readMode(); // 每次现读：模式可能被 Claude Code 侧或人手改过
    if (mode === "off") return;
    const command = String((event as any)?.input?.command || "");
    if (!command) return;
    const reason = denyReason(mode, command);
    if (reason) return { block: true, reason };
  });

  pi.on("before_agent_start", async (event: any) => {
    mode = readMode();
    if (mode === "off") return;
    const text = residentText(mode);
    if (!text) return;
    const base = event?.systemPrompt ? `${event.systemPrompt}\n\n` : "";
    return { systemPrompt: `${base}${text}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    mode = readMode();
    sync(ctx);
  });
}
