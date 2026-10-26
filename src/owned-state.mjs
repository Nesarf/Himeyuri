// owned 的状态机：四个状态、三个动作、一张转移表。
//
// 这一份是唯一真相 —— src/owned-check.mjs 的判定从这里来，而 tools/owned-state.hmoca
// 是它的 HMYR 镜像。两份对同一批输入必须给出同一份判定，test/owned-state.test.mjs 验那件事。
//
// 为什么值得单独抽出来：这套转移是 owned 那四层里唯一「有固定答案」的部分，
// 其余三层都在走树与看名字。而把它抽出来之后，「自举」这句话才有了一个可验的形状 ——
// 不是「把整个检查器用 HMYR 重写」，而是「把它的判定用 HMYR 写一遍，两份对答案」。

export const 空 = "empty";
export const 满 = "full";
export const 关 = "closed";
export const 移 = "moved";

// 一次动作之后的判定。
// 交回 { 态, 错 }：错是 null 或者一句英文（与检查器里的消息同源）。
export function 转移(态, 动作) {
  // 转移出去之后不能再动 —— use-after-move。它排在最前，因为那是最早发生的错。
  if (态 === 移) return { 态, 错: "was moved into another function earlier" };

  if (动作 === "关") {
    // 重复关是幂等的：运行期也不报，所以这里只记状态。
    return { 态: 关, 错: null };
  }
  if (态 === 关) return { 态, 错: "was closed before this point" };

  if (动作 === "放") {
    if (态 === 满) return { 态, 错: "already holds a value here" };
    return { 态: 满, 错: null };
  }
  if (动作 === "取") {
    if (态 === 空) return { 态, 错: "is empty here" };
    return { 态: 空, 错: null };
  }
  return { 态, 错: "unknown action" };
}

// 两个路径的状态汇合：只有完全相同时才保得住，其余一律说不清（交回 null）。
export function 合并(甲, 乙) {
  if (甲 === undefined || 乙 === undefined) return null;
  return 甲 === 乙 ? 甲 : null;
}
