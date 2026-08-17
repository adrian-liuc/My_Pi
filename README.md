# pi 配置同步

多机无缝衔接,新电脑两步:

```bash
git clone git@github.com:adrian-liuc/My_Pi.git ~/.pi/agent   # ~/.pi/agent 若非空先删/备份
bash ~/.pi/agent/setup.sh
```

然后手动放回 `auth.json`(OpenRouter API key,安全起见不在仓库里)。

同步内容:settings.json、extensions/、sessions/(对话)、AGENTS.md(记忆)。
本机自动同步:cron 每 30 分钟 push(sync.sh)。
