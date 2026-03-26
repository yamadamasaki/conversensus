import { GlobalRegistrator } from '@happy-dom/global-registrator';

// environment = "happy-dom" (bunfig.toml) が有効な場合は既に DOM が利用可能なため
// 二重登録を避けるためにスキップする
if (typeof globalThis.document === 'undefined') {
  GlobalRegistrator.register();
}
