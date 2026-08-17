#!/usr/bin/env bash
# 同步 pi 配置到 GitHub:cron 定期跑
export PATH="/usr/bin:/bin:$PATH"
cd "$HOME/.pi/agent" || exit 1
git pull --rebase --autostash --quiet || true
git add -A
git commit -m "sync $(date '+%F %T')" --quiet || true
git push --quiet || true
