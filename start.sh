#!/bin/bash
# Firecrawl 手动启动脚本：启动 Playwright 服务和 API 服务
# 使用方式:
#   ./start.sh          # 前台运行，Ctrl+C 停止
#   ./start.sh -d       # 后台 daemon 模式
#   ./start.sh --stop   # 停止后台服务

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="${SCRIPT_DIR}/logs"
LOG_FILE="${LOG_DIR}/firecrawl.log"
PID_FILE="${SCRIPT_DIR}/.firecrawl.pids"
PLAYWRIGHT_PORT=3100

# 解析参数
DAEMON_MODE=false
STOP_MODE=false
for arg in "$@"; do
  case "$arg" in
    -d|--daemon) DAEMON_MODE=true ;;
    -s|--stop)   STOP_MODE=true ;;
  esac
done

# --stop: 停止后台服务
if [[ "$STOP_MODE" == true ]]; then
  echo "=== 停止 Firecrawl 服务 ==="
  killed=0
  for port in 3000 3002 3004 3005 3006 3007 3008 3009 3010 3011 "$PLAYWRIGHT_PORT"; do
    pid=$(lsof -ti ":$port" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
      kill -9 $pid 2>/dev/null || true
      echo "✓ 已终止端口 $port (PID: $pid)"
      killed=$((killed + 1))
    fi
  done
  [[ -f "$PID_FILE" ]] && rm -f "$PID_FILE"
  [[ $killed -gt 0 ]] && echo "已停止 $killed 个进程" || echo "没有运行中的服务"
  exit 0
fi

# 用于存储子进程 PID，便于退出时清理
PLAYWRIGHT_PID=""

cleanup() {
  echo ""
  echo "正在停止服务..."
  if [[ -n "$PLAYWRIGHT_PID" ]] && kill -0 "$PLAYWRIGHT_PID" 2>/dev/null; then
    kill "$PLAYWRIGHT_PID" 2>/dev/null || true
    echo "已停止 Playwright 服务 (PID: $PLAYWRIGHT_PID)"
  fi
  exit 0
}

# 前台模式才 trap SIGINT
[[ "$DAEMON_MODE" != true ]] && trap cleanup SIGINT SIGTERM

echo "=== Firecrawl 手动启动 ==="

# 1. 检查 Redis
if ! redis-cli ping &>/dev/null; then
  echo "警告: Redis 未运行。请先启动 Redis:"
  echo "  redis-server"
  echo "或在另一个终端运行: brew services start redis"
  exit 1
fi
echo "✓ Redis 已就绪"

# 2. 检查 RabbitMQ（rabbitmqctl 或端口 5672）
if ! rabbitmqctl status &>/dev/null && ! nc -z localhost 5672 2>/dev/null; then
  echo "警告: RabbitMQ 未运行。请先启动:"
  echo "  brew services start rabbitmq"
  exit 1
fi
echo "✓ RabbitMQ 已就绪"

# 3. 加载 apps/api 环境变量
API_ENV="${SCRIPT_DIR}/apps/api/.env"
if [[ -f "$API_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$API_ENV"
  set +a
  echo "✓ 已加载 apps/api/.env"
else
  echo "警告: apps/api/.env 不存在，API 将使用默认或内置配置"
fi

# 4. Playwright 端口（固定 3100，与 apps/api/.env 一致）
PLAYWRIGHT_PORT=3100

# 5. 清理可能占用的端口（3100=Playwright, 3002=API, 3000=备用）
for port in 3000 "$PLAYWRIGHT_PORT" 3002; do
  pid=$(lsof -ti ":$port" 2>/dev/null || true)
  if [[ -n "$pid" ]]; then
    echo "终止占用端口 $port 的进程 (PID: $pid)..."
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    sleep 2
  fi
done

# 6. 启动 Playwright 服务（后台）
echo ""
echo "启动 Playwright 服务 (apps/playwright-service-ts)..."
cd "$SCRIPT_DIR/apps/playwright-service-ts"
if [[ ! -d "node_modules" ]]; then
  pnpm install
fi
if [[ ! -f "dist/api.js" ]]; then
  pnpm build
fi
if [[ "$DAEMON_MODE" == true ]]; then
  mkdir -p "$LOG_DIR"
  PORT=$PLAYWRIGHT_PORT nohup pnpm start >> "$LOG_FILE" 2>&1 &
  PLAYWRIGHT_PID=$!
else
  PORT=$PLAYWRIGHT_PORT pnpm start &
  PLAYWRIGHT_PID=$!
fi
cd "$SCRIPT_DIR"

# 等待 Playwright 启动
echo "等待 Playwright 服务就绪..."
for i in {1..15}; do
  if curl -sf "http://localhost:${PLAYWRIGHT_PORT}/health" >/dev/null 2>&1; then
    echo "✓ Playwright 已就绪 (端口 $PLAYWRIGHT_PORT)"
    break
  fi
  if [[ $i -eq 15 ]]; then
    echo "警告: Playwright 可能尚未完全启动，继续启动 API..."
  fi
  sleep 2
done

# 7. 启动 API 服务
echo ""
echo "启动 API 服务 (apps/api)..."
cd "$SCRIPT_DIR/apps/api"
if [[ ! -d "node_modules" ]]; then
  pnpm install
fi

if [[ "$DAEMON_MODE" == true ]]; then
  # 后台 daemon 模式：nohup 启动，输出到日志
  mkdir -p "$LOG_DIR"
  echo "以 daemon 模式启动，日志: $LOG_FILE"
  nohup pnpm start >> "$LOG_FILE" 2>&1 &
  API_PID=$!
  echo "$PLAYWRIGHT_PID" > "$PID_FILE"
  echo "$API_PID" >> "$PID_FILE"
  sleep 3
  if kill -0 "$API_PID" 2>/dev/null; then
    echo ""
    echo "✓ 服务已在后台启动"
    echo "  Playwright: http://localhost:$PLAYWRIGHT_PORT"
    echo "  API:        http://localhost:3002"
    echo "  日志:       $LOG_FILE"
    echo "  停止:       ./start.sh --stop"
    exit 0
  else
    echo "✗ API 启动失败，请查看日志: tail -f $LOG_FILE"
    kill "$PLAYWRIGHT_PID" 2>/dev/null || true
    exit 1
  fi
else
  # 前台模式
  echo "API 将在 http://localhost:3002 运行"
  echo "按 Ctrl+C 停止所有服务"
  echo ""
  pnpm start
fi
