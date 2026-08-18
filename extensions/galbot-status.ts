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
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
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

// flag 文件一行：`<mode> [HPU_IP] [XCU_IP]`。带地址是为了「切到 readonly」
// 这一步就把要连哪台机器人定下来 —— 现场常有多台 G1，问晚了就会连错。
// XCU 单独记：它只在内网、必须从 HPU 跳，地址每台机器不同，
// 而工作模式、急停、关节故障的日志只在那一端。
// 地址尾部的 `+` 表示实测连上过（由 galbot_hook.py verify 打上）。
// 没有 `+` 就只是"有人输入过这个字符串"，敲错一位也看不出来。
function readFlag(): { mode: Mode; hpu?: string; xcu?: string;
                       hpuOk: boolean; xcuOk: boolean } {
  try {
    const parts = readFileSync(flagPath(), "utf8").trim().split(/\s+/);
    const m = (parts[0] || "").toLowerCase();
    const cut = (v?: string) => v?.replace(/\+$/, "");
    return {
      mode: isMode(m) ? m : DEFAULT_MODE,
      hpu: cut(parts[1]), xcu: cut(parts[2]),
      hpuOk: !!parts[1]?.endsWith("+"), xcuOk: !!parts[2]?.endsWith("+"),
    };
  } catch {
    return { mode: DEFAULT_MODE, hpuOk: false, xcuOk: false };
  }
}

/** 未验证的地址不显示出来：把"输入过"显示成"连上了"是在撒谎。
 *  占位符用 ASCII——终端里中文宽度算不准，会把后面的徽章挤歪。 */
function shown(addr?: string, ok?: boolean): string {
  return !addr ? "NULL" : ok ? addr : "DOWN";
}

function readMode(): Mode {
  const env = String(process.env.GALBOT_SKILL_MODE || "").trim().toLowerCase();
  if (isMode(env)) return env;
  return readFlag().mode;
}

function writeMode(mode: Mode, hpu?: string, xcu?: string): void {
  // 没给就沿用上次的。但换了 HPU 就必须重给 XCU —— 两台机器的 XCU 地址无关，
  // 留着上一台的会让 agent 连到别人的机器上去。
  // 换地址就清掉已验证标记 —— 新地址还没连过，沿用旧标记等于替它撒谎
  const prev = readFlag();
  let keepHpu = hpu, keepXcu = xcu;
  let okH = false, okX = false;
  if (!hpu) {
    keepHpu = prev.hpu; okH = prev.hpuOk;
    if (!xcu) { keepXcu = prev.xcu; okX = prev.xcuOk; }
  } else if (!xcu && hpu === prev.hpu) {
    okH = prev.hpuOk; keepXcu = prev.xcu; okX = prev.xcuOk;
  }
  const tag = (a?: string, ok?: boolean) => (a ? a + (ok ? "+" : "") : undefined);
  const p = flagPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p,
    [mode, tag(keepHpu, okH), tag(keepXcu, okX)].filter(Boolean).join(" "), "utf8");
}

// 常驻正文缓存：before_agent_start 每轮都触发，每轮 spawn 一次 python 是
// 白花的 30ms。缓存键带上 SKILL.md 的 mtime —— 只按模式缓存的话，改了
// SKILL.md 的 resident 块，这个 pi 进程就一直用旧正文，得重启才更新；
// Claude Code 侧 hook 每次是新进程，没这问题，两边不该有这个不对称。
// 一次 statSync 的代价远小于一次 spawn。
const residentCache = new Map<string, string>();
function residentText(mode: Mode): string {
  if (mode === "off") return "";
  let stamp = "0";
  try {
    stamp = String(statSync(join(REPO, "SKILL.md")).mtimeMs);
  } catch {
    // SKILL.md 读不到：仍然缓存，只是拿不到新正文
  }
  const cacheKey = `${mode}@${stamp}`;
  const hit = residentCache.get(cacheKey);
  if (hit !== undefined) return hit;
  let text = "";
  try {
    text = execFileSync("python3", [HOOK, "resident", mode], { encoding: "utf8", timeout: 5000 });
  } catch {
    text = ""; // python 不在或仓库被挪走 —— 徽章和拦截仍要能用
  }
  residentCache.set(cacheKey, text);
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
  let busy = false;

  function sync(ctx?: any) {
    const ui = ctx?.ui;
    if (!ui?.setStatus) return;
    let theme: any;
    try { theme = ui.theme; } catch { return; }
    if (!theme?.fg) return;
    if (mode === "off") { ui.setStatus("galbot", ""); return; }
    // 亮的是权限高的那个：徽章醒目 = 这个会话能碰机器人。
    // 跟 caveman/ponytail「强度高才亮」相反，这里危险的是权限不是强度。
    // readonly 一定把目标 IP 显出来：现场多台 G1 时，
    // 「连的哪台」比「什么模式」更要紧。
    // 两端都显：现场多台 G1 时「连的哪台」比「什么模式」更要紧，而 XCU 缺不缺
    // 直接决定能不能查工作模式与急停——显式写成「未指定」比不显示更有用。
    const f = readFlag();
    const label = mode === "readonly"
      ? theme.fg("accent",
          `🔓 RO (HPU:${shown(f.hpu, f.hpuOk)})(XCU:${shown(f.xcu, f.xcuOk)})`)
      : theme.fg("muted", "🔒 OFFLINE");
    // 跟同一条状态栏上的 caveman / ponytail 对齐：前导圆点，跑起来实心、空闲空心
    const dot = busy ? theme.fg("accent", "●") : theme.fg("dim", "○");
    ui.setStatus("galbot", dot + " 🤖 " + theme.fg("muted", "galbot: ") + label);
  }

  pi.registerCommand("galbot", {
    description: `Switch galbot-sdk mode: ${MODES.join("|")}`,
    handler: async (args, ctx) => {
      const parts = (args || "").trim().split(/\s+/).filter(Boolean);
      const arg = (parts[0] || "").toLowerCase();
      // 后两个参数是地址：/galbot readonly <HPU_IP> [XCU_IP]
      const ok = (v?: string) => (/^[\w.-]+$/.test(v || "") ? v : undefined);
      const hpu = ok(parts[1]);
      const xcu = ok(parts[2]);
      if (!arg || arg === "status") {
        const f = readFlag();
        ctx.ui.notify(
          `galbot-sdk 模式: ${f.mode}` +
            (f.hpu ? `，HPU ${f.hpu}${f.hpuOk ? "（已连上）" : "（未验证）"}` : "") +
            (f.xcu ? `，XCU ${f.xcu}${f.xcuOk ? "（已连上）" : "（未验证）"}` : ""),
          "info");
        return;
      }
      if (!isMode(arg)) {
        ctx.ui.notify(`未知模式 "${arg}"，只能是 ${MODES.join(" / ")}`, "warning");
        return;
      }
      mode = arg;
      writeMode(mode, hpu, xcu);
      sync(ctx);
      const f = readFlag();
      const target = f.hpu
        ? `${f.hpu}${f.xcu ? " / XCU " + f.xcu : "（XCU 未指定，跑不了 precheck）"}`
        + "，先跑 galbot_hook.py verify 确认连得上"
        : "未指定，先问用户要 HPU IP";
      ctx.ui.notify(
        mode === "readonly"
          ? `galbot-sdk: readonly —— 目标 ${target}，机器人只读`
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

  pi.on("agent_start", async (_event, ctx) => { busy = true; sync(ctx); });
  pi.on("agent_end", async (_event, ctx) => { busy = false; sync(ctx); });
}
