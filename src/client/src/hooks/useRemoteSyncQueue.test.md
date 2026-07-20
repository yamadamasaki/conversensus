# useRemoteSyncQueue テスト仕様

## 何を

`useRemoteSyncQueue` (step1 W3d5-5) をテストする。ATProto セッションと `SYNC_TO_REMOTE`
フラグから remote 送信キューを組み立てる (または作らない) 判断と、キューの同一性を検証する。

## なぜ

このフックは**「remote へ送るかどうか」を決める唯一のスイッチ**。3 つの契約が乗っている:

- **未ログイン時 local-only (2026-07-19 確定事項)**: `session=null` で null を返さないと、
  未ログインのユーザにまで remote 経路が生える。W3d からの退行なしを保証する境界。
- **安全弁 `SYNC_TO_REMOTE` (§3.4・§7 で新設を判断)**: 送信は**外部 (PDS) への書き込み**なので、
  ログアウトせずに止められる手段が要る。フラグ off でログイン中でも null になることを固定する。
- **キューの同一性**: キューは未送信 batch を抱えている。再レンダーのたびに作り直すと**未送信が
  静かに消える** (キューごと捨てられる)。同じ session なら同一インスタンスを返すことを固定する。
  逆に session が変われば別 repo への送信になるので作り直すのが正しい。

## どのように

`renderHook` でフックを張り、`enabled` を明示指定して env フラグに依存させない (テストの再現性)。
session は `did` だけのスタブで足りる — `AtprotoSyncProvider` の構築はネットワークを叩かず、
実際の送信先はモジュールレベルの agent が決めるため。

- `session=null, enabled=true` → null。
- `session=あり, enabled=true` → キューが生成され、初期 `pendingCount` は 0。
- `session=あり, enabled=false` → null (安全弁)。
- 同じ session で再レンダー → 同一インスタンス (`toBe`)。
