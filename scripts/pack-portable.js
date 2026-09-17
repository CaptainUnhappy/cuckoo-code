#!/usr/bin/env node
/**
 * 便携版打包脚本（Windows）
 *
 * 产物：dist/cuckoo-code-win-v${version}-portable.zip
 * 结构：zip 内单层稳定目录 Cuckoo-Code/，含
 *   - Cuckoo-Code.exe 等 electron-builder --dir 原生产物
 *   - portable.flag   便携模式标记（exe 同级；存在 → 数据写 data/，不碰 %APPDATA%）
 *   - data/           数据目录（空，首次运行后保存全部数据）
 *   - 使用说明.md     使用与升级说明（新版覆盖解压即可升级，data 保留）
 *
 * 流程：electron-builder --dir → 注入便携文件 → tar(-a) 打 zip → 还原目录名。
 * 零 npm 依赖：压缩使用 Windows 10+ / GitHub Actions windows runner 自带的 bsdtar。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const distDir = path.join(root, 'dist');
const unpackedDir = path.join(distDir, 'win-unpacked');
const stageDir = path.join(distDir, 'Cuckoo-Code');
const outZip = path.join(distDir, 'cuckoo-code-win-v' + pkg.version + '-portable.zip');
const APP_FOLDER_NAME = 'Cuckoo-Code';

function fail(msg) {
  console.error('[pack-portable] 失败: ' + msg);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.capture ? 'pipe' : 'inherit', shell: process.platform === 'win32', encoding: 'utf-8' });
  if (r.error || r.status !== 0) {
    fail((r.error ? String(r.error) : '命令退出码 ' + r.status) + '：' + cmd + ' ' + args.join(' '));
  }
  return r;
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// 1. 构建未打包目录
console.log('[pack-portable] 1/4 electron-builder --win --dir ...');
run('npx', ['electron-builder', '--win', '--dir', '--publish', 'never']);
if (!fs.existsSync(path.join(unpackedDir, 'Cuckoo-Code.exe'))) {
  fail('未找到 ' + unpackedDir + '\\Cuckoo-Code.exe，构建产物异常');
}

// 2. 注入便携文件
console.log('[pack-portable] 2/4 注入 portable.flag / data/ / 使用说明.md ...');
fs.writeFileSync(path.join(unpackedDir, 'portable.flag'), '', 'utf-8');
fs.mkdirSync(path.join(unpackedDir, 'data'), { recursive: true });
fs.writeFileSync(path.join(unpackedDir, 'data', '.gitkeep'), '', 'utf-8');
const readme = [
  '# Cuckoo Code 便携版 使用说明',
  '',
  '## 使用',
  '1. 解压到任意可写目录（示例：D:\\Apps\\Cuckoo-Code）',
  '2. 运行 Cuckoo-Code.exe',
  '',
  '所有数据（窗口列表、会话、MCP 配置、自定义 Provider、日志）都保存在本目录的 data\\ 文件夹内，',
  '不会在 C:\\Users\\你\\AppData 下创建任何文件夹。',
  '',
  '## 升级（数据保留）',
  '1. 下载新版 cuckoo-code-win-vX.Y.Z-portable.zip',
  '2. 直接解压覆盖到当前目录（仅替换程序文件，data\\ 与 portable.flag 会原样保留）',
  '3. 重新运行 Cuckoo-Code.exe，历史数据全部还在',
  '',
  '## 便携开关',
  '- portable.flag 是便携模式标记：删除它后，数据改存 %APPDATA%\\cuckoo-ai-pro-session（与安装版一致）。',
  '- 多份便携版可放在不同目录同时运行，数据互不干扰。',
  '',
  '## 更新检查',
  '- 菜单「帮助 → 检查更新」只做版本检测：便携版不支持自动安装，发现新版会引导你打开下载页。',
  '',
].join('\r\n');
fs.writeFileSync(path.join(unpackedDir, '使用说明.md'), readme, 'utf-8');

// 3. 打 zip（顶层稳定目录 Cuckoo-Code/，覆盖解压即升级）
console.log('[pack-portable] 3/4 打包 zip ...');
if (spawnSync('tar', ['--version'], { shell: process.platform === 'win32' }).status !== 0) {
  fail('未找到 tar（bsdtar）。Windows 10+ 自带；或在 PowerShell 中手动压缩 win-unpacked。');
}
rmrf(stageDir);
let renamed = false;
try {
  fs.renameSync(unpackedDir, stageDir);
  renamed = true;
  rmrf(outZip);
  run('tar', ['-a', '-c', '-f', outZip, '-C', distDir, APP_FOLDER_NAME]);
} finally {
  // 还原目录名，保证后续 NSIS 构建与重复执行不受影响
  if (renamed && fs.existsSync(stageDir)) {
    try { fs.renameSync(stageDir, unpackedDir); } catch (_) { /* 保留暂存目录，不影响产物 */ }
  }
}

// 4. 校验产物
console.log('[pack-portable] 4/4 校验产物 ...');
const check = spawnSync('tar', ['-tf', outZip], { shell: process.platform === 'win32', encoding: 'utf-8' });
const names = check.status === 0 ? check.stdout.split(/\r?\n/) : [];
const mustHave = [
  APP_FOLDER_NAME + '/Cuckoo-Code.exe',
  APP_FOLDER_NAME + '/portable.flag',
  APP_FOLDER_NAME + '/data/',
  APP_FOLDER_NAME + '/使用说明.md',
];
const missing = mustHave.filter((n) => !names.includes(n));
if (missing.length > 0) fail('zip 缺少必需条目: ' + missing.join(', '));

console.log('[pack-portable] 完成: ' + outZip);
console.log('[pack-portable] 使用：解压 zip → 运行 Cuckoo-Code/ 里的 Cuckoo-Code.exe');
