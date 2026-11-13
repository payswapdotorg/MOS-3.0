#!/usr/bin/env node
// MOS 品牌图标与安装器素材生成器（纯 Node 实现，零原生依赖）。
//
// 背景：MOS 是独立产品身份（org.payswap.mos），安装包的 mac/win/linux 图标、NSIS 安装器
// 图标、DMG 背景与 AppImage hicolor 图标集都不能复用上游 ZCode 图标（并排安装时无法区分，
// 也避免上游商标混淆）。CI 打包机不保证安装图像工具链，所以这里用 node:zlib 手写 PNG 编码、
// 用超采样光栅化绘制几何徽标 —— 全程确定性输出，同一输入永远得到同一字节序列（release
// manifest 可复算）。
//
// 产物（build/mos-brand/，electron-builder 配置按 flavor=mos 切换引用）：
//   mos-icon.png / mos-icon_windows.png / mos-icon_installer.png  1024x1024
//   mos-icon.ico / mos-icon_installer.ico                          16..256 多尺寸
//   mos-icons/{16x16..1024x1024}.png                                linux hicolor 集
//   mos-dmg_background.png                                          540x380（与上游背景同尺寸）
//
// 用法：node scripts/mos-brand-assets.mjs [--out <dir>]（bundle 流程经 prepare:mos-brand 调用）
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Icns, IcnsImage } from "@fiahfy/icns";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");

// ── MOS 视觉标识（刻意与上游 ZCode 图标区分：深炭底 + 琥珀 M + 青色底缘） ──
export const MOS_COLORS = {
  background: [20, 24, 31],
  mark: [240, 180, 41],
  accent: [45, 212, 191],
  installerBackground: [240, 180, 41],
  installerMark: [20, 24, 31],
  backgroundTop: [24, 29, 38],
  backgroundBottom: [15, 18, 24],
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crc32Table;
function crc32(buffer) {
  if (!crc32Table) {
    crc32Table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crc32Table[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** RGBA 像素缓冲（行主序）编码为 8-bit RGBA PNG（color type 6）。 */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: expected ${width * height * 4} bytes, got ${rgba.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 压缩/滤波/隔行均为 0（deflate + 每行 filter byte 0 —— 尺寸小，滤波收益可忽略）。
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.subarray(y * stride, (y + 1) * stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 多尺寸 PNG-in-ICO（Vista+ 格式）：每项为独立 PNG，Windows 与跨平台工具均支持。 */
export function encodeIco(pngEntries) {
  const count = pngEntries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  const dataBuffers = [];
  let offset = 6 + 16 * count;
  pngEntries.forEach((png, index) => {
    const sizeByte = png.width >= 256 ? 0 : png.width;
    const base = index * 16;
    entries.writeUInt8(sizeByte, base);
    entries.writeUInt8(sizeByte, base + 1);
    entries.writeUInt8(0, base + 2); // palette
    entries.writeUInt8(0, base + 3); // reserved
    entries.writeUInt16LE(1, base + 4); // color planes
    entries.writeUInt16LE(32, base + 6); // bits per pixel
    entries.writeUInt32LE(png.data.length, base + 8);
    entries.writeUInt32LE(offset, base + 12);
    dataBuffers.push(png.data);
    offset += png.data.length;
  });
  return Buffer.concat([header, entries, ...dataBuffers]);
}

// ── 几何光栅化（4x 超采样 + 盒式降采样抗锯齿） ──
const SUPER = 4;

/** 点到线段距离平方（单位坐标系）。 */
function segmentDistanceSq(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  const qx = x1 + t * dx - px;
  const qy = y1 + t * dy - py;
  return qx * qx + qy * qy;
}

/** 单位坐标 rounded-square 覆盖测试（radius 为圆角半径）。 */
function roundedSquareCoverage(px, py, radius) {
  const cx = Math.max(radius, Math.min(1 - radius, px));
  const cy = Math.max(radius, Math.min(1 - radius, py));
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** 按 alpha 混合 target 到 rgba 像素（premultiplied 输入假设：背景已铺底）。 */
function blendInto(rgba, target, alpha) {
  if (alpha <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    rgba[channel] = Math.round(rgba[channel] * (1 - alpha) + target[channel] * alpha);
  }
}

/** M 的四段笔画（单位坐标，butt cap）：左竖、右竖、左斜、右斜。 */
const MOS_MARK_SEGMENTS = [
  [0.295, 0.27, 0.295, 0.73],
  [0.705, 0.27, 0.705, 0.73],
  [0.295, 0.27, 0.5, 0.575],
  [0.705, 0.27, 0.5, 0.575],
];
const MOS_MARK_STROKE_WIDTH = 0.155;
const MOS_BADGE_RADIUS = 0.225;
const MOS_ACCENT_TOP = 0.845;

/**
 * MOS 应用/安装器图标（size x size RGBA）。
 * variant "app"：深炭圆角方底 + 琥珀 M + 青色底缘；variant "installer"：琥珀底 + 深炭 M。
 *
 * 超采样后按层计数再一次性合成：逐采样点以 1/16 alpha 顺序混合时，n 次混合的累积覆盖是
 * (1-1/16)^16 ≈ 0.64，图标会整体偏暗；这里每个图层只做一次全额混合，覆盖率为采样命中比。
 */
export function renderMosIcon(size, variant = "app") {
  const isInstaller = variant === "installer";
  const background = isInstaller ? MOS_COLORS.installerBackground : MOS_COLORS.background;
  const mark = isInstaller ? MOS_COLORS.installerMark : MOS_COLORS.mark;
  const accent = isInstaller ? MOS_COLORS.installerMark : MOS_COLORS.accent;
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SUPER);
  const half = MOS_MARK_STROKE_WIDTH / 2;
  const sampleCount = SUPER * SUPER;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let badgeSamples = 0;
      let markSamples = 0;
      let accentSamples = 0;
      for (let sy = 0; sy < SUPER; sy += 1) {
        for (let sx = 0; sx < SUPER; sx += 1) {
          const px = (x * SUPER + sx + 0.5) * step;
          const py = (y * SUPER + sy + 0.5) * step;
          if (!roundedSquareCoverage(px, py, MOS_BADGE_RADIUS)) continue;
          badgeSamples += 1;
          if (py >= MOS_ACCENT_TOP) {
            // 底缘 accent 条。
            accentSamples += 1;
            continue;
          }
          const onMark = MOS_MARK_SEGMENTS.some(
            ([x1, y1, x2, y2]) => segmentDistanceSq(px, py, x1, y1, x2, y2) <= half * half,
          );
          if (onMark) {
            markSamples += 1;
          }
        }
      }
      const pixel = Buffer.from([0, 0, 0, 0]);
      if (badgeSamples > 0) {
        // 徽标底色（straight alpha：覆盖率即 alpha）。
        pixel[0] = background[0];
        pixel[1] = background[1];
        pixel[2] = background[2];
        pixel[3] = Math.round((255 * badgeSamples) / sampleCount);
        if (markSamples > 0) {
          blendInto(pixel, mark, markSamples / sampleCount);
        }
        if (accentSamples > 0) {
          blendInto(pixel, accent, accentSamples / sampleCount);
        }
      }
      pixel.copy(rgba, (y * size + x) * 4);
    }
  }
  return rgba;
}

/** DMG 背景：纵向渐变 + 中央低对比 M 水印（默认 540x380，与上游 dmg_background 同尺寸）。 */
export function renderMosDmgBackground(width = 540, height = 380) {
  const rgba = Buffer.alloc(width * height * 4);
  const half = 0.0775;
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1);
    const base = [
      Math.round(
        MOS_COLORS.backgroundTop[0] +
          (MOS_COLORS.backgroundBottom[0] - MOS_COLORS.backgroundTop[0]) * t,
      ),
      Math.round(
        MOS_COLORS.backgroundTop[1] +
          (MOS_COLORS.backgroundBottom[1] - MOS_COLORS.backgroundTop[1]) * t,
      ),
      Math.round(
        MOS_COLORS.backgroundTop[2] +
          (MOS_COLORS.backgroundBottom[2] - MOS_COLORS.backgroundTop[2]) * t,
      ),
    ];
    for (let x = 0; x < width; x += 1) {
      const px = x / (width - 1);
      const py = y / (height - 1);
      const pixel = Buffer.from([...base, 255]);
      const onMark = MOS_MARK_SEGMENTS.some(
        ([x1, y1, x2, y2]) => segmentDistanceSq(px, py, x1, y1, x2, y2) <= half * half,
      );
      if (onMark) {
        // 水印：低对比度提亮，不干扰安装引导内容。
        blendInto(pixel, MOS_COLORS.mark, 0.08);
      }
      pixel.copy(rgba, (y * width + x) * 4);
    }
  }
  return rgba;
}

const HICOLOR_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// PNG 编码的 ICNS 图标类型（Apple icon type 规范）：ic07=128 ic08=256 ic09=512 ic10=1024。
const ICNS_PNG_TYPES = [
  { size: 128, osType: "ic07" },
  { size: 256, osType: "ic08" },
  { size: 512, osType: "ic09" },
  { size: 1024, osType: "ic10" },
];

/** 由 PNG 尺寸集编码 .icns（DMG 卷图标需要原生 ICNS，dmg-builder 不接受 png）。 */
export function encodeIcns(pngBySize) {
  const icns = new Icns();
  for (const { size, osType } of ICNS_PNG_TYPES) {
    const png = pngBySize.get(size);
    if (!png) {
      throw new Error(`encodeIcns: missing ${size}x${size} PNG for osType ${osType}`);
    }
    icns.append(IcnsImage.fromPNG(png, osType));
  }
  return icns.data;
}

/** 生成完整 MOS 品牌素材集，返回相对路径清单（相对 outputDir）。 */
export function generateMosBrandAssets(outputDir) {
  const targetDir = resolve(outputDir ?? resolve(desktopRoot, "build", "mos-brand"));
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(resolve(targetDir, "mos-icons"), { recursive: true });
  const written = [];
  const write = (relative, data) => {
    writeFileSync(resolve(targetDir, relative), data);
    written.push(relative);
  };
  write("mos-icon.png", encodePng(1024, 1024, renderMosIcon(1024, "app")));
  write("mos-icon_windows.png", encodePng(1024, 1024, renderMosIcon(1024, "app")));
  write("mos-icon_installer.png", encodePng(1024, 1024, renderMosIcon(1024, "installer")));
  write(
    "mos-icon.ico",
    encodeIco(
      ICO_SIZES.map((size) => ({
        width: size,
        data: encodePng(size, size, renderMosIcon(size, "app")),
      })),
    ),
  );
  // mac .icns（app 与安装器两套；安装器 icns 供 DMG 卷图标）。
  const appPngBySize = new Map(
    ICNS_PNG_TYPES.map(({ size }) => [size, encodePng(size, size, renderMosIcon(size, "app"))]),
  );
  const installerPngBySize = new Map(
    ICNS_PNG_TYPES.map(({ size }) => [
      size,
      encodePng(size, size, renderMosIcon(size, "installer")),
    ]),
  );
  write("mos-icon.icns", encodeIcns(appPngBySize));
  write("mos-icon_installer.icns", encodeIcns(installerPngBySize));
  write(
    "mos-icon_installer.ico",
    encodeIco(
      ICO_SIZES.map((size) => ({
        width: size,
        data: encodePng(size, size, renderMosIcon(size, "installer")),
      })),
    ),
  );
  for (const size of HICOLOR_SIZES) {
    write(`mos-icons/${size}x${size}.png`, encodePng(size, size, renderMosIcon(size, "app")));
  }
  write("mos-dmg_background.png", encodePng(540, 380, renderMosDmgBackground()));
  return { targetDir, written };
}

const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  const { targetDir, written } = generateMosBrandAssets();
  process.stdout.write(`[mos-brand-assets] wrote ${written.length} files to ${targetDir}\n`);
}
