import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MODES = ["off", "lite", "full", "ultra", "wenyan-lite", "wenyan-full", "wenyan-ultra"] as const;
type Mode = (typeof MODES)[number];

const ICONS: Record<Mode, string> = {
  off: "",
  lite: "🌿",
  full: "⚡",
  ultra: "🔥",
  "wenyan-lite": "📜",
  "wenyan-full": "📜",
  "wenyan-ultra": "📜",
};

const isMode = (s: string): s is Mode => (MODES as readonly string[]).includes(s);

export default function (pi: ExtensionAPI) {
  let mode: Mode = "full";

  function sync(ctx?: { ui?: { setStatus?: (id: string, value: string | undefined) => void; theme?: any } }) {
    const ui = ctx?.ui;
    if (!ui?.setStatus) return;
    let theme;
    try { theme = ui.theme; } catch { return; }
    if (!theme?.fg) return;

    if (mode === "off") {
      ui.setStatus("caveman", "");
      return;
    }
    ui.setStatus(
      "caveman",
      theme.fg("accent", "●") +
        " 🗿 " +
        theme.fg("muted", "caveman: ") +
        theme.fg("text", `${ICONS[mode]} ${mode.toUpperCase()}`),
    );
  }

  pi.registerCommand("caveman", {
    description: `Switch caveman mode: ${MODES.join("|")}`,
    handler: async (args, ctx) => {
      const arg = (args || "").trim().toLowerCase();

      if (!arg) {
        ctx.ui.notify(`Caveman mode: ${mode}. Use ${MODES.join("/")}`, "info");
        return;
      }

      if (!isMode(arg)) {
        ctx.ui.notify(`Unknown caveman mode "${arg}". Use ${MODES.join("/")}`, "warning");
        return;
      }

      mode = arg;
      sync(ctx);
      ctx.ui.notify(`Caveman mode: ${mode}`, "info");

      const message = arg === "off" ? "stop caveman" : `/skill:caveman ${arg}`;
      if (ctx.isIdle?.() === false) {
        pi.sendUserMessage(message, { deliverAs: "followUp" });
      } else {
        pi.sendUserMessage(message);
      }
    },
  });

  pi.on("input", async (event, ctx) => {
    if (event?.source === "extension") return;
    const text = String(event?.text || "").trim().toLowerCase();
    if (mode !== "off" && (text === "stop caveman" || text === "normal mode")) {
      mode = "off";
      sync(ctx);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    mode = "full";
    sync(ctx);
  });
}
