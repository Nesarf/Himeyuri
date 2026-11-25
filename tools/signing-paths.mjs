// 签名路径：本机的钥匙、allowed_signers 与 ssh-keygen 不写死在源码里。
//
// 为什么要有这一层：这三样原先在五处各写了一遍绝对路径，于是发布出去的源码里带着
// 维护者的用户名、密钥文件名与盘符。那是痕迹，不是材料——可它没必要出去。
//
// 三条都用一个形状：环境变量优先，缺省回到「这台机器与别的机器都成立」的位置。
//   HMYR_SIGNING_KEY     私钥文件
//   HMYR_ALLOWED_SIGNERS allowed_signers
//   HMYR_SSH_KEYGEN      ssh-keygen 这个程序
//
// 缺省值里没有字面量盘符：家目录从 os.homedir() 来，ssh-keygen 从 SystemRoot 或 PATH 来。
// 判据在 tools/check-portability.mjs，它扫的就是「发布出去的源码里还有没有这种东西」。
import os from "node:os";
import path from "node:path";

export const 私钥 = () =>
  process.env.HMYR_SIGNING_KEY || path.join(os.homedir(), ".ssh", "signing_ed25519_20261011");

export const 名单 = () =>
  process.env.HMYR_ALLOWED_SIGNERS || path.join(os.homedir(), ".ssh", "allowed_signers");

export const 钥匙 = () => {
  if (process.env.HMYR_SSH_KEYGEN) return process.env.HMYR_SSH_KEYGEN;
  if (process.platform === "win32" && process.env.SystemRoot) {
    return path.join(process.env.SystemRoot, "System32", "OpenSSH", "ssh-keygen.exe");
  }
  return "ssh-keygen";
};

// 一次拿全三样：调用方多数时候三样都要问一遍「在不在」。
export const 签名位 = () => ({ 钥匙: 钥匙(), 私钥: 私钥(), 名单: 名单() });
