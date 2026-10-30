#!/bin/sh
# 容器入口：workspace 模板 copy-once 到数据卷（与桌面版 userData 同一语义），然后启动后端
set -e

workspace="${WORKSPACE_PATH:-/app/data/workspace}"
if [ ! -e "$workspace/.template-version" ]; then
  mkdir -p "$workspace"
  cp -Rn /app/workspace-template/. "$workspace/"
  touch "$workspace/.template-version"
fi

cd /app/backend
exec node --import tsx src/index.ts
