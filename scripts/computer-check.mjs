import { windowsDesktop } from '../src/computer/windows.mjs';

// Read-only native smoke check. Never moves the mouse, types, or saves images.
try {
  const windows = await windowsDesktop('windows');
  const inspection = await windowsDesktop('inspect');
  const screenshot = await windowsDesktop('screenshot');
  if (!windows.ok || !inspection.ok || !screenshot.image?.startsWith('data:image/jpeg;base64,')) throw Error('桌面返回内容不完整。');
  if (screenshot.image_width !== Math.min(1280,screenshot.screen.width) || Math.abs(screenshot.image_height/screenshot.image_width-screenshot.screen.height/screenshot.screen.width)>0.01) throw Error('截图尺寸或比例错误。');
  console.log(JSON.stringify({ ok: true, platform: process.platform, visible_windows: windows.windows.length,
    controls: inspection.controls.length, screen: screenshot.screen,
    image_width: screenshot.image_width, image_height: screenshot.image_height,
    image_bytes: Buffer.from(screenshot.image.split(',')[1], 'base64').length,
    note: '已验证原生桥接、窗口枚举、控件读取与截图；未执行鼠标键盘操作。' }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
