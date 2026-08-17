#!/usr/bin/env bash
# 新电脑:clone 本仓库到 ~/.pi/agent 后,跑这个一次即恢复
set -e
DEST="$HOME/.pi/agent"

# 1. pi 本体(没有就装)
command -v pi >/dev/null 2>&1 || npm install -g @earendil-works/pi-coding-agent

# 2. 装回 packages(ponytail/caveman 等)
pi update --extensions

# 3. 唯一手动项:API key
[ -f "$DEST/auth.json" ] || echo "⚠️  把 auth.json(OpenRouter key)放回 $DEST/"

echo "✅ 完成,启动 pi 即可无缝衔接"
