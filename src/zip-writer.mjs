// 一个最小的 ZIP 写入器：给一个目录，压成一个不压缩过头的 zip。
//
// 为什么要有这一页：tools/package.mjs 原来用 powershell 的 Compress-Archive 压包，
// 而那是 Windows 的命令。2026-11-03 给 Linux 补这一条时发现 WSL 里连 zip 命令都
// 没有（只有 unzip），于是最省的路是不借任何外部命令 —— Node 自带 deflateRawSync
// 与 crc32，而 ZIP 这个格式这个仓库本来就熟（self/zip.hmoca 是语言那一侧的同一件事，
// zip 套件二十八项验过它）。
//
// 只写「一个目录里的所有文件」这一种：不写目录项、不写注释、不加密、不分卷。
// 那正是打包这一件需要的最小形状，多一条都用不到。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const 走目录 = (根) => {
  const 出 = [];
  const 递 = (相对) => {
    const 全 = 相对 ? path.join(根, 相对) : 根;
    for (const 名 of fs.readdirSync(全).sort()) {
      const 相 = 相对 ? 相对 + "/" + 名 : 名;
      if (fs.statSync(path.join(根, 相)).isDirectory()) 递(相);
      else 出.push(相);
    }
  };
  递("");
  return 出;
};

export const 压目录 = (根, 出) => {
  const 文件册 = 走目录(根);
  const 部件批 = [];
  const 中央册 = [];
  let 偏 = 0;
  // DOS 时间戳取 1980-01-01 00:00：zip 里没有「不知道」这一说，而固定值让
  // 同一份内容压两次得到同一串字节 —— 可复现比「看起来新」重要。
  const 时 = 0, 日 = 0x21;
  for (const 相 of 文件册) {
    const 原 = fs.readFileSync(path.join(根, 相));
    const 压 = zlib.deflateRawSync(原);
    const 名 = Buffer.from(相, "utf8");
    const crc = zlib.crc32(原);

    const 本地 = Buffer.alloc(30);
    本地.writeUInt32LE(0x04034b50, 0);
    本地.writeUInt16LE(20, 4);        // 需要的版本
    本地.writeUInt16LE(0x0800, 6);    // 文件名是 UTF-8
    本地.writeUInt16LE(8, 8);         // deflate
    本地.writeUInt16LE(时, 10);
    本地.writeUInt16LE(日, 12);
    本地.writeUInt32LE(crc, 14);
    本地.writeUInt32LE(压.length, 18);
    本地.writeUInt32LE(原.length, 22);
    本地.writeUInt16LE(名.length, 26);
    本地.writeUInt16LE(0, 28);
    部件批.push(本地, 名, 压);

    const 央 = Buffer.alloc(46);
    央.writeUInt32LE(0x02014b50, 0);
    央.writeUInt16LE(20, 4);          // 写它的版本
    央.writeUInt16LE(20, 6);          // 读它需要的版本
    央.writeUInt16LE(0x0800, 8);
    央.writeUInt16LE(8, 10);
    央.writeUInt16LE(时, 12);
    央.writeUInt16LE(日, 14);
    央.writeUInt32LE(crc, 16);
    央.writeUInt32LE(压.length, 20);
    央.writeUInt32LE(原.length, 24);
    央.writeUInt16LE(名.length, 28);
    央.writeUInt16LE(0, 30);
    央.writeUInt16LE(0, 32);
    央.writeUInt16LE(0, 34);
    央.writeUInt16LE(0, 36);
    央.writeUInt32LE(0, 38);
    央.writeUInt32LE(偏, 42);
    中央册.push(央, 名);

    偏 += 本地.length + 名.length + 压.length;
  }
  const 中央 = Buffer.concat(中央册);
  const 尾 = Buffer.alloc(22);
  尾.writeUInt32LE(0x06054b50, 0);
  尾.writeUInt16LE(0, 4);
  尾.writeUInt16LE(0, 6);
  尾.writeUInt16LE(文件册.length, 8);
  尾.writeUInt16LE(文件册.length, 10);
  尾.writeUInt32LE(中央.length, 12);
  尾.writeUInt32LE(偏, 16);
  尾.writeUInt16LE(0, 20);
  fs.writeFileSync(出, Buffer.concat([...部件批, 中央, 尾]));
  return 文件册.length;
};
