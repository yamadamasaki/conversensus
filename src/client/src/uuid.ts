// biome-ignore lint/style/useConst: テスト時に差し替え可能にするため let を使用
export let generateId: () => string = () => crypto.randomUUID();
