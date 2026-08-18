// 把状态栏里多个扩展徽章（caveman / galbot / ponytail）从一行拆成每行一个。
// 复用 pi 内置 FooterComponent 渲染前两行（pwd + token/model 统计），
// 只把第三行的合并状态行替换成每状态一行。
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FooterComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.ui?.setFooter) return;

    ctx.ui.setFooter((_tui, _theme, footerData) => {
      // FooterComponent 要 Session，用 ctx 的活 getter 拼最小等价物。
      const session = {
        get state() {
          return { model: ctx.model, thinkingLevel: ctx.thinkingLevel };
        },
        get sessionManager() {
          return ctx.sessionManager;
        },
        getContextUsage: () => ctx.getContextUsage(),
        // ponytail: Kimi 订阅标记不读，stub false；用 Kimi 订阅再补。
        modelRuntime: { isUsingSubscription: () => false },
      };

      class MultiLineFooter extends FooterComponent {
        render(width: number): string[] {
          const lines = super.render(width); // [pwd, stats, 合并状态行?]
          const base = lines.slice(0, 2);
          const statuses = [...footerData.getExtensionStatuses().entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, t]) => t)
            .filter((t) => t && t.trim());
          for (const t of statuses) base.push(truncateToWidth(t, width, "…"));
          return base;
        }
      }

      return new MultiLineFooter(session as never, footerData);
    });
  });
}
