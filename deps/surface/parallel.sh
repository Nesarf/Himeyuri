#!/usr/bin/env bash
# parallel.sh -- 与 deps/surface/parallel.ps1 同一件事，POSIX 这一侧。
#
# 列表文件的每一行是一条命令（原样的命令行）。用后台作业同时起，然后逐条等
# ——它们已经在跑，所以总时间约等于最长的那个。
#
# 为什么并行发生在这里而不是在语言里：语言的求值器是同步的，同步等异步的完成事件
# 会把事件循环堵死（见 design/CONCURRENCY.txt 的补记）。所以「同时起几个」交给一个
# 本来就支持并行的东西 —— 借能力，不复制实现。
#
# 输出形状与 parallel.ps1 逐字段一致：{items:[{cmd,state,output,ms}]}，末行
# HMYR-PARALLEL <条数>。state 的取值也一致：Completed / Failed / Timeout。
#
# 每条的时限用 timeout(1)：它与 Wait-Job -Timeout 同一个意思 —— 上限是每条自己的，
# 不是总时长（并行时总时长取决于最长的那一条，写死会误杀）。
#
# 纯 ASCII：这个文件会被 bash 读，而那条「脚本只许 ASCII」的纪律在这个仓库里
# 已经因为 powershell 的代码页写过一次；bash 没有那个问题，但保持一致更好查。
set -u

LIST=""
OUT=""
TO="30"
while [ $# -gt 0 ]; do
  case "$1" in
    -List) LIST="$2"; shift 2 ;;
    -Out) OUT="$2"; shift 2 ;;
    -TimeoutSec) TO="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -z "$LIST" ] || [ -z "$OUT" ]; then
  echo "usage: parallel.sh -List <file> -Out <out.json> [-TimeoutSec N]" >&2
  exit 2
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

i=0
: > "$TMP/index"
while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  i=$((i + 1))
  start=$(date +%s%3N)
  (
    timeout "$TO" bash -c "$line" > "$TMP/$i.out" 2>&1
    code=$?
    end=$(date +%s%3N)
    printf '%s\n%s\n' "$code" "$((end - start))" > "$TMP/$i.meta"
  ) &
  printf '%s\t%s\n' "$i" "$line" >> "$TMP/index"
done < "$LIST"

: > "$TMP/rows.json"
while IFS="$(printf '\t')" read -r idx cmd; do
  while [ ! -s "$TMP/$idx.meta" ]; do sleep 0.02; done
  code=$(sed -n 1p "$TMP/$idx.meta")
  ms=$(sed -n 2p "$TMP/$idx.meta")
  state=Completed
  [ "$code" = "124" ] && state=Timeout
  [ "$code" != "0" ] && [ "$code" != "124" ] && state=Failed
  # 与 powershell 那侧同一条约定：交回的就是命令自己吐的那一段。
  out=$(cat "$TMP/$idx.out" 2>/dev/null || true)
  jq -cn --arg cmd "$cmd" --arg state "$state" --arg output "$out" --argjson ms "$ms" \
    '{cmd:$cmd,state:$state,output:$output,ms:$ms}' >> "$TMP/rows.json"
done < "$TMP/index"

jq -s '{items: .}' "$TMP/rows.json" > "$OUT"
echo "HMYR-PARALLEL $i"
