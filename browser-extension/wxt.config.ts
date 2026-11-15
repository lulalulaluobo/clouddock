import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'CloudDock 链接助手',
    description: '将夸克和百度网盘分享链接发送到自己的 CloudDock。',
    permissions: ['storage', 'contextMenus'],
    icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    action: { default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' } },
  },
});
