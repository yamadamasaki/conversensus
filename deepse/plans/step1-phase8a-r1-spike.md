# step1 Phase 8a: R1 (ARM64 / Rosetta) 切り分け — spike 計画

> **投棄前提の spike である**。成果物はコードではなく本書の「実施結果」節に書き込まれる観測記録だけ。
> conversensus 本体のコードは 1 行も変更しない (p7-0 の cursor spike と同じ流儀)。
>
> 位置づけ: Phase 8 (Tauri 単一バイナリ配布) の**前**に、R1 だけを切り離して潰す。
> Phase 8 本体 (パッケージング・署名・updater・VPS 役割変更) は使い込みフェイズの**後**に回す
> (2026-07-31 のユーザー決定、§1.2)。

---

## 1. なぜ今か

### 1.1 R1 とは何だったか

`deepse/architecture/step1.md` §7 / §9 が挙げているリスク:

> **R1**: ARM64/Rosetta の再燃 (Tauri) — 着手前に最小再現で切り分け

本プロジェクトは当初 Tauri ベースで開始したが、**ARM64 / Rosetta の問題**でうまく動かず、
「まずグラフエディタが作れることを確認する」ため Tauri を後回しにして Web 構成で作り直した
(§2 の経緯)。step0 以降のすべての実装はこの回避の結果である。

つまり R1 は「起きるかもしれないリスク」ではなく、**一度このプロジェクトを実際に方向転換させた
既往症**である。Phase 8 の全体を組む前に、これが今も生きているのかを確かめる価値がある。

### 1.2 順序の決定 (2026-07-31)

Phase 7 完了後、「使い込みフェイズを Tauri 化の前に入れるべきか」を検討し、**入れる**と決めた。
判断の骨子は、Tauri 化のリスクが性質の異なる 2 つに分かれることである。

| リスク | 性質 | 機能を積むと |
|---|---|---|
| **エンジン差 (webview)** | macOS の Tauri は WKWebView = WebKit。Chrome (Blink) と描画も API も違う | **比例して増える**。UI 機能 1 つごとに検証対象が 1 つ増える |
| **パッケージング** | R1、sidecar 同梱、データディレクトリ、CSP、署名・notarization、updater | **増えない**。機能数と独立した一度きりの固定費 |

→ 比例して増える方 (エンジン差) を先に潰し、固定費 (パッケージング) は後回しにする。
そしてエンジン差の検証に **Tauri は要らない** — Safari を開けば同じ WebKit で確かめられる
(手順は `../requirements/user-test-environment.md` §7)。

**本 spike だけが例外的に前倒しになる理由**: R1 はエンジン差でもパッケージングでもなく、
**「Tauri がそもそも成立するか」という土台の疑問**だからである。これを未解決のまま数ヶ月
使い込むと、最後に「Tauri は無理でした」となったとき使い込みの前提 (単一バイナリで配る)
ごと崩れる。半日で答えが出るものを先に出しておく。

### 1.3 スコープ

- **目標**: R1 が今も生きているかを判定し、生きているなら原因を特定する
- **非目標** (§5): Phase 8 本体に属するものは一切やらない

---

## 2. 🔴 事前調査で判明した事実 (2026-07-31 実測)

**spike を始める前の環境調査で、R1 の原因候補が 1 つ見つかった。**

| 項目 | 実測値 | 出典 |
|---|---|---|
| CPU アーキテクチャ | **arm64** | `uname -m` |
| macOS | 26.6 | `sw_vers` |
| bun | **arm64** (1.3.8) | `file $(which bun)` → `Mach-O 64-bit executable arm64` |
| Node.js | **arm64** (v24.14.0) | `node -p process.arch` |
| **rustup default host** | 🔴 **x86_64-apple-darwin** | `rustup show` |
| **インストール済 toolchain** | 🔴 **`stable-x86_64-apple-darwin` のみ** | `rustup show` |
| **インストール済 target** | 🔴 `wasm32-unknown-unknown`, `x86_64-apple-darwin` (**`aarch64-apple-darwin` が無い**) | `rustup show` |
| `rustc -vV` の host | **x86_64-apple-darwin** (1.94.0) | `rustc -vV` |
| PATH 上の brew | `/usr/local/bin/brew` (x86_64, Rosetta) が先。`/opt/homebrew/bin/brew` (arm64) も存在する | `which -a brew` / `brew config` |

**arm64 のマシンに、arm64 のフロントエンド toolchain (bun / node) と、x86_64 の Rust toolchain が
同居している。** `cargo build` の既定ターゲットは host = `x86_64-apple-darwin` なので、
**Tauri の Rust シェルは何もしなければ Intel バイナリとしてビルドされ Rosetta 上で動く**。

これは「ARM64 / Rosetta の問題」という当時のラベルと正確に一致する。

> **注意**: これは*原因候補*であって確定ではない。当時の失敗が本当にこれだったかを示す
> 記録は残っていない。§3 の仮説として扱い、§4 で検証する。

### 2.1 副次的な発見 (本 spike のスコープ外)

`/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib` は**存在する** (arm64 Homebrew と openssl@3 が
インストール済)。プロジェクトメモリの「arm64 Homebrew が無いので GitNexus MCP が動かない」は
現状と合っていない可能性がある。GitNexus の再調査は本 spike の対象外だが、CLAUDE.md が
impact 分析を要求している以上、別途確かめる価値がある。

---

## 3. 仮説

### H1 (主仮説): 原因は Rust toolchain が x86_64 であること

- **根拠**: §2 の実測。arm64 マシンで host target が x86_64
- **予測**: `aarch64-apple-darwin` の toolchain を入れて既定にすれば、Tauri は普通にビルドできる
- **反証条件**: aarch64 toolchain に切り替えても S2 (素の Tauri shell) が同じ失敗をするなら **H1 は棄却**
- **含意**: H1 が正しければ **R1 は Tauri の欠陥ではなく環境設定の問題**であり、リスクとしては
  ほぼ消える。Phase 8 の設計は「配布」だけを考えればよくなる

### H2: 真犯人は webview (WKWebView) 側で、Rust ではない

- **根拠**: 当時の記憶が「ARM64/Rosetta」とラベルされていても、実際は React Flow が
  WKWebView で動かなかった可能性がある。**issue #51「少なくとも safari では動いていない」は
  現在進行形の事実**であり、Safari と Tauri の webview は同じ WebKit である
- **切り分け**: **シェルが起動して白画面 / 描画崩れなら H2 側、ビルドが通らないなら H1 側**
- **本 spike での扱い**: H2 は**切り分けるが解決しない**。解決は使い込みフェイズで #51 として行う
  (それがまさに「Safari で使い込む」という決定の中身である)

### H3: 当時の失敗は当時固有で、いま再現しない

- **根拠**: 当時から Tauri v1 → v2、macOS も 26 まで進んでいる。bun も当時と違う
- **含意**: 「再現しない」も立派な結論である。**再現しないことを確かめずに恐れ続けるのが最も高くつく**

---

## 4. 検証手順

**時間箱: 合計 半日 (最大 1 日)。S3 で 2 時間詰まったら止めて記録する。**

各ステップは「止め条件」を持つ。詰まったら次へ進まず、観測を §7 に書いて撤収してよい —
**この spike の成果物は「動いた」ではなく「何が起きたかの記録」である**。

### S0. 現状記録 (5 分)

変更を加える前に、戻せるように現状を記録する。

```shell
uname -m; sw_vers -productVersion
rustup show                      # 既定 toolchain 名を控える (復帰用)
rustc -vV | grep host
bun --version; node -p process.arch
xcode-select -p                  # Command Line Tools の場所
```

> **復帰コマンド**: `rustup default stable-x86_64-apple-darwin`

### S1. ツールチェインの是正 (15 分) — H1 の直接検証

```shell
rustup toolchain install stable-aarch64-apple-darwin
rustup default stable-aarch64-apple-darwin
rustc -vV | grep host            # aarch64-apple-darwin になること
```

- **止め条件**: インストールが失敗する / host が変わらない → H1 の検証不能。観測を記録して S2 へ
- **⚠️ これはマシン全体の設定を変える**。他プロジェクトの Rust ビルドに影響しうるので、
  spike 後に戻すかどうかはユーザー判断とする (§6)

### S2. 素の Tauri v2 シェルが立つか (30 分) — H1 / H3 の判定

**リポジトリの外**の一時ディレクトリで、最小の Tauri v2 アプリを作って動かす。
conversensus 固有の要因を混ぜないためである。

```shell
cd $(mktemp -d)
bun create tauri-app             # vanilla か react、bun を選ぶ
cd <app>
bun install
bun run tauri dev                # ウィンドウが出るか
bun run tauri build              # バイナリが出るか
file src-tauri/target/release/<app>   # arm64 と言うか
```

- **判定 PASS**: ウィンドウが出て、`file` が `arm64` と言う
- **判定 FAIL**: ビルドが通らない → **H1 棄却**。エラー全文を §7 に記録する。これが R1 の実体
- **止め条件**: 初回ビルドは Rust の依存を大量に取るので長い (10〜20 分)。それ自体は失敗ではない

### S3. React Flow が WKWebView で動くか (1〜2 時間) — H2 の判定・**本題**

S2 のシェルの frontend を **conversensus クライアントの production build** に差し替える。

```shell
# conversensus 側
bun run build                                  # src/client/dist/ が出る
bun run dev:server                             # デーモンは通常どおり :3000 で別プロセス

# spike 側: tauri.conf.json の frontendDist を dist/ の実パスへ向けて
bun run tauri dev
```

**見るもの** (これが spike の中心):

| 観点 | 見方 |
|---|---|
| React Flow の描画 | ノード・エッジ・ラベルが出るか |
| インタラクション | ノードのドラッグ、ズーム、パン、選択 |
| localhost への fetch | ファイル一覧が出るか (= `http://localhost:3000` に届いているか) |
| localStorage | `atproto_session` / deviceId / 移行 marker の 3 つが読み書きできるか |

- **CSP で fetch が止まった場合**: Tauri の既定 CSP は `connect-src` を絞るので、
  `http://localhost:3000` の許可設定が要る。**これは設定で解ける問題であって R1 ではない** —
  解決したら 1 行記録して先へ進む。深追いしない (Phase 8 本体の仕事)
- **止め条件**: 2 時間

### S4. 既知の WebKit 不具合の突き合わせ (30 分) — **使い込み戦略の裏取り**

**「Safari で使い込めば WebKit 適合の証跡になる」という §1.2 の前提そのものを検証する。**

issue #51 で報告されている壊れ方が、Safari と Tauri webview で**同じかどうか**を見る。

| 対象 | コード | Safari での既知の症状 (#51) | Tauri webview では? |
|---|---|---|---|
| import ボタン | `src/client/src/Sidebar.tsx:199` (`<input type="file">` + `FileReader`) | はみ出して表示され、クリックしても実行されない | ← ここを埋める |
| 貼り付け (Cmd+V) | `src/client/src/GraphEditor.tsx:760` (`navigator.clipboard.read()`) | 未報告。Safari はユーザー操作要件と対応フォーマットが Chrome と違う | ← ここを埋める |

- **同じ壊れ方をする → Safari が WKWebView の代理として機能する**。使い込みフェイズを
  Safari で回す判断が裏付けられる。**これが本 spike のもう 1 つの成果物である**
- **違う壊れ方をする → Safari は代理にならない**。使い込み中に Tauri での定期確認が要る、
  という重い結論になるので、その場合は Phase 8 の順序を再検討する

### S5. 撤収 (15 分)

- 一時ディレクトリを消す (`rm -rf`)。**spike のコードは残さない**
- `rustup default` を戻すかはユーザー判断 (§6)
- 観測結果を §7 に書く。**PASS だけでなく、詰まった箇所・回避した箇所も書く**

---

## 5. 非目標 (Phase 8 本体に属するもの — 本 spike ではやらない)

順序の決定 (§1.2) の要点は「固定費を今払わない」ことなので、以下は**意図的に触れない**。

- bun デーモンの sidecar 同梱 (`bun build --compile` + Tauri sidecar) とプロセス寿命管理
- データディレクトリの OS 標準化 (`data/` → アプリケーションサポート配下)
- 自動更新 (updater) とマニフェスト署名
- コード署名 / notarization (Apple Developer 登録が要る)
- Windows (WebView2) / Linux (WebKitGTK) 対応
- VPS の役割変更 (D6) と firehose 卒業 / Jetstream 化
- **conversensus 本体のコード修正** — #51 の修正も含めてやらない (使い込みフェイズの仕事)

---

## 6. リスクと注意

| リスク | 影響 | 緩和 |
|---|---|---|
| `rustup default` の変更がマシン全体に効く | 他プロジェクトの Rust ビルドが変わる | S0 で既定名を控え、復帰コマンドを本書に残す。戻すかはユーザー判断 |
| 初回 Tauri ビルドが重い | 時間・ディスク (数 GB) | 時間箱内なら許容。超えたら中断して記録 |
| macOS 26 + Tauri v2 の組合せが未知 | S2 が想定外の失敗をする | それ自体が R1 の答えなので、失敗も成果として記録する |
| spike が Phase 8 本体に膨らむ | 使い込みフェイズが後ろへずれる | §5 の非目標を都度参照する。CSP のような「解けるが本題でない」ものは 1 行記録して進む |

---

## 7. 実施結果

<!-- spike 実行後にここへ観測を書く。S0〜S4 の各ステップについて、
     PASS/FAIL だけでなく「何が起きたか」を残すこと。
     H1 / H2 / H3 のどれが支持され、どれが棄却されたかを明記する。 -->

### S0. 現状記録 (2026-08-02 実測)

§2 の事前調査 (2026-07-31) を**測り直した**。ユーザーが PATH 設定を変更したため、
古い記録をそのまま信用せず全項目を再測定している。

| 項目 | 2026-08-02 実測値 | 2026-07-31 からの変化 |
|---|---|---|
| CPU アーキテクチャ | arm64 | — |
| macOS | 26.6 | — |
| bun | 1.3.8 | — |
| Node.js | **v26.5.0 / arm64** (`/opt/homebrew/bin/node`) | 🔄 v24.14.0 (nvm) → v26.5.0 (arm64 Homebrew) |
| PATH 上の brew | **`/opt/homebrew/bin/brew` (arm64) が先** | 🔄 逆転。x86_64 が先だったのが解消 |
| rustup default host | **x86_64-apple-darwin** | ❌ 変化なし |
| インストール済 toolchain | **`stable-x86_64-apple-darwin` のみ** | ❌ 変化なし |
| インストール済 target | `wasm32-unknown-unknown`, `x86_64-apple-darwin` | ❌ 変化なし (`aarch64-apple-darwin` 無し) |
| `rustc -vV` の host | x86_64-apple-darwin | ❌ 変化なし |
| Xcode CLT | `/Applications/Xcode.app/Contents/Developer` | — |
| ディスク空き | 63 GiB | (S2 の Tauri ビルドには十分) |

**新たに判明した事実 (§2 になかったもの)**:

1. **`rustup` 自身が x86_64 バイナリで、Rosetta 上で動いている。**
   ```
   $ rustup show
   warn: Rustup is not running natively. It's running under emulation of x86_64-apple-darwin.
   warn: For best compatibility and performance you should reinstall rustup for your native CPU.

   $ file $(which rustup) $(which cargo) $(which rustc)
   /Users/yamadamasaki/.cargo/bin/rustup: Mach-O 64-bit executable x86_64
   /Users/yamadamasaki/.cargo/bin/cargo:  Mach-O 64-bit executable x86_64
   /Users/yamadamasaki/.cargo/bin/rustc:  Mach-O 64-bit executable x86_64
   ```
   rustup 本体が Rosetta 下で入っており、その結果として default host が x86_64 になっている。
   **§2 の H1 (「Rust toolchain が x86_64」) は、より深い層 — rustup の導入自体が
   Rosetta 下で行われた — に根がある。** これは「当時 Rosetta 環境で環境構築した」という
   R1 の経緯と整合する。

2. **Rust は Homebrew 経由ではなく rustup.rs 経由で導入されている** (`brew list` に rust なし、
   実体は `~/.cargo/bin/`)。したがって PATH の brew 順序の是正は Rust には波及していない。
   PATH 問題が直っても R1 の根が残っているのはこのためである。

**S0 の含意**: 「マシンは arm64 なのに Rust だけ x86_64」という §2 の観測は今日も生きている。
H1 は依然として主仮説として有効。ただし是正方法は 2 通りあり、S1 で選択が必要になった (下記)。

> **復帰コマンド**: `rustup default stable-x86_64-apple-darwin`
> (toolchain `stable-x86_64-apple-darwin` は削除しないので、いつでも戻せる)

### S1. ツールチェインの是正 — **PASS** (方式はユーザー選択)

S0 で「rustup 自身が x86_64」と判明したため、是正方法を 2 案に整理してユーザーに確認した。
選択は **「toolchain 追加のみ」** (計画書 §4 S1 どおり。rustup 本体の入れ直しはしない)。

**計画書になかった障害**: `rustup toolchain install` / `rustup default` の**どちらも拒否された**。

```
$ rustup toolchain install stable-aarch64-apple-darwin
error: toolchain 'stable-aarch64-apple-darwin' may not be able to run on this system
note: to build software for that platform, try `rustup target add aarch64-apple-darwin` instead
note: add the `--force-non-host` flag to install the toolchain anyway
```

Rosetta 下の rustup は自分の host を x86_64 だと信じているので、**aarch64 toolchain を
「エミュレータが要る非 host toolchain」と誤認して拒む**。マシンは実際には arm64 なので
この判定は誤りであり、`--force-non-host` で通した (install と default の両方に必要)。

```shell
rustup toolchain install stable-aarch64-apple-darwin --force-non-host
rustup default stable-aarch64-apple-darwin --force-non-host
```

**結果**:

| 項目 | S1 前 | S1 後 |
|---|---|---|
| `rustc -vV` host | x86_64-apple-darwin | ✅ **aarch64-apple-darwin** |
| `cargo -vV` host | x86_64-apple-darwin | ✅ **aarch64-apple-darwin** |
| rustc version | 1.94.0 | 1.97.1 (2026-07-14) |
| active toolchain | stable-x86_64-apple-darwin | stable-aarch64-apple-darwin |
| `file .../stable-aarch64-apple-darwin/bin/rustc` | — | `Mach-O 64-bit executable arm64` |

`rustup show` の `Default host:` は x86_64 のまま表示されるが、これは **rustup 自身の
インストール時 host** であって cargo の既定ターゲットではない。実際にビルドを決めるのは
active toolchain の host であり、そちらは aarch64 になっている。

**この時点での H1 への含意**: 「x86_64 toolchain しか無い」状態は解消できた。
ただし *H1 が正しいか* は S2 (実際に Tauri がビルドできるか) を見るまで判定しない。

### S2. 素の Tauri v2 シェル — **PASS (完全)**

リポジトリ外の scratchpad に最小の Tauri v2 アプリを作成した。

```shell
bun create tauri-app r1spike --manager bun --template react-ts \
  --tauri-version 2 --identifier com.conversensus.r1spike
bun install && bun run tauri build
```

構成: Tauri 2.11.5 / wry 0.55.1 / tao 0.35.3 / React 19.2.8 / Vite 7.3.6。

**結果: ビルドは一発で通った。詰まりも回避も一切なし。**

| 判定項目 | 結果 |
|---|---|
| `cargo build` (release) | ✅ **`Finished in 1m 02s`** — 警告・エラーゼロ |
| バイナリ生成 | ✅ `target/release/r1spike` (9.6 MB) |
| **`file` / `lipo -archs`** | ✅ **`Mach-O 64-bit executable arm64`** / `arm64` (単一アーキ) |
| バンドル | ✅ `r1spike.app` と **`r1spike_0.1.0_aarch64.dmg`** (2.8 MB) |
| 署名 | ✅ `Format=app bundle with Mach-O thin (arm64)` / `Signature=adhoc` |
| **ウィンドウ起動** | ✅ 下記のとおり確認 |

**ウィンドウ起動の確認方法** (screencapture / osascript がこの環境では権限不足だったため代替した):

`open r1spike.app` 後、プロセスは 1 分 28 秒生存し続け (起動失敗なら即終了する)、
**WKWebView のヘルパープロセス 3 つが app の直後の PID で生成された**:

```
55847  r1spike                                    ← app 本体
55944  com.apple.WebKit.GPU
55945  com.apple.WebKit.Networking
55946  com.apple.WebKit.WebContent
```

これらが r1spike のものであることは因果テストで確定した — **`kill 55847` の 3 秒後、
55944/55945/55946 がすべて消滅した**。つまり WKWebView は初期化され、
レンダラプロセスまで立ち上がっている。

> **ビルド時間について**: 計画書 §4 S2 は初回 10〜20 分を見込んでいたが、実測 **1 分 2 秒**
> だった (Tauri の Rust 依存は約 300 crate)。§6 の「初回ビルドが重い」リスクは空振り。

**H1 / H3 の判定**:

- **H1 (原因は Rust toolchain が x86_64) は支持された。** S1 で toolchain を aarch64 に
  是正した直後、Tauri は何の小細工もなく arm64 バイナリを吐いた。
- **H3 (当時固有で再現しない) も部分的に支持される。** ただし H1 と H3 は排他ではない —
  「環境が x86_64 のままだった当時は失敗し、是正した今は通る」なら両方正しい。
  **本 spike は S1 前の状態で S2 を試していないので、「x86_64 toolchain なら本当に失敗したか」
  は検証していない** (ユーザー判断でツールチェイン是正を先行させたため)。
  これは意図的な未検証であり、実務上は問題にならない (直った以上、元に戻す理由がない)。
- **R1 は Tauri の欠陥ではない。** 少なくとも「Tauri v2 のシェルが arm64 で成立するか」
  という土台の疑問には ✅ が付いた。

**副次的な発見 (計画書の前提の訂正)**: 計画書 §4 S3 は「Tauri の既定 CSP は `connect-src` を
絞るので localhost:3000 の許可設定が要る」と想定していたが、**`bun create tauri-app` が生成する
`tauri.conf.json` は `"csp": null` (= CSP 無効)** だった。既定では絞られない。
CSP を張るのは Phase 8 本体で明示的に設定する場合の話になる。

### S3. React Flow が WKWebView で動くか — **PASS (本題は通った)**

S2 のシェルの `frontendDist` を conversensus クライアントの production build に差し替えた。

**結果 (計画書 §4 S3 の「見るもの」の表に対応)**:

| 観点 | 結果 |
|---|---|
| React Flow の描画 | ✅ ノード・エッジ・ラベルが出る |
| インタラクション (ドラッグ/ズーム/パン/選択) | ✅ 「操作も普通にできます」(ユーザー目視) |
| localhost への fetch | ✅ ファイル一覧 4 件が表示される |
| localStorage | ✅ 診断ページで `rw-ok`。ATProto ログイン (alice.test) も成立した |
| **描画品質** | ⚠️ **「ぼんやりした (解像度低い) 感じ」** → S4 で正体を特定 |

**ここに至るまでに 3 つの偽の原因を潰した。記録として残す価値があるので順に書く。**

#### 障害 1: 計画書の手順の穴 — `bun run build` は VPS を向く (**真の原因**)

最初、ファイル一覧が空だった。CORS を全開にした使い捨てプローブを :3000 に立てても
**リクエストが 1 本も届かなかった**。原因は Tauri でも WebKit でもなく、**ビルド設定**である。

```
src/client/.env.production:  VITE_API_BASE=https://api.conversensus.site
```

`bun run build` は vite の production モードなので `.env.production` を読み、
**dist には VPS の URL が焼き込まれる**。Tauri アプリは最初から本番 VPS と話しており、
`localhost:3000` には用が無かった。ATProto ログインが通ったのも本物の PDS だったからである。

```shell
# 正しい手順
VITE_API_BASE=http://localhost:3000 bun run --cwd src/client build
```

> **計画書 §4 S3 への訂正**: 手順は `bun run build` とだけ書いていたが、
> (a) root に `build` スクリプトは無い (`bun run --cwd src/client build`)、
> (b) **`VITE_API_BASE` を明示しないとローカルデーモンを向かない**。
> この 2 点を書いていなかったため、切り分けに約 40 分を溶かした。

#### 障害 2: CORS — 実在するが自明に解ける

サーバの CORS は `http://localhost:` 前綴りのみ許可 (`src/server/src/index.ts:71`)。
Tauri の origin は **`tauri://localhost`** なのでこれに該当しない。実測:

```
$ curl -D- -H "Origin: tauri://localhost" http://localhost:3000/files
HTTP/1.1 200 OK                      ← Access-Control-Allow-Origin ヘッダが無い = ブラウザは破棄
$ curl -D- -H "Origin: http://localhost:5173" http://localhost:3000/files
Access-Control-Allow-Origin: http://localhost:5173
```

既存の `ALLOWED_ORIGIN` 環境変数で解決した (**conversensus のコードは変更していない**)。

```shell
ALLOWED_ORIGIN='tauri://localhost' bun run dev:server
```

Phase 8 本体では「デーモンが Tauri の origin を許可する」設定が要る、という 1 行の宿題。
**R1 ではない。**

#### 障害 3: ATS (App Transport Security) — **疑ったが空振り**

「https の PDS は通るのに http の localhost だけ出ていかない」ため、macOS の ATS が
cleartext HTTP を遮断している仮説を立て、`src-tauri/Info.plist` に
`NSAllowsLocalNetworking` / `NSAllowsArbitraryLoads` を入れて A/B を取った。

| ATS 例外 | :3000 へのリクエスト |
|---|---|
| あり | 届く |
| **なし** | **届く** |

**ATS 例外は不要**。`tauri://localhost` (secure context) から `http://localhost:3000` への
fetch は素で通る。mixed content ブロックも起きていない。**Phase 8 で Info.plist に
ATS 例外を入れる必要はない** (この A/B はその判断を先に確定させた分だけ価値がある)。

#### 到達点の実測値 (webview 内から採取)

スクリーンショットも devtools もこの環境では権限不足で使えなかったため、**webview 内から
ローカルのプローブへ値を送り返す診断ページ**を作って観測した。

```json
{"devicePixelRatio":1,"innerSize":"1400x868","screen":"2560x1440",
 "mq2x":false,"isSecureContext":true,"origin":"tauri://localhost",
 "hasClipboard":true,"hasClipboardRead":"function","hasClipboardWrite":"function",
 "hasFileReader":"function","hasShowOpenFilePicker":"undefined","localStorage":"rw-ok",
 "ua":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"}
```

- `origin` = **`tauri://localhost`** (macOS の Tauri v2 の custom scheme)。CORS 設定の根拠
- `isSecureContext: true` — secure context 扱いだが http://localhost への fetch は通る
- `showOpenFilePicker: undefined` — WebKit は File System Access API 非対応。
  `<input type="file">` + `FileReader` に頼っている現在の実装は方向として正しい
- **UA が `Intel Mac OS X 10_15_7` と言うのは WebKit の凍結 UA 文字列**であって、
  アーキテクチャの証拠ではない。arm64 判定に使わないこと

### S4. 既知の WebKit 不具合の突き合わせ — **PASS: Safari は代理として機能する**

**本 spike のもう 1 つの成果物。** 同一の `dist` を 3 経路で見比べた
(Tauri / Safari `localhost:4173` / Chrome `localhost:4173`)。

| 対象 | Chrome (Blink) | Safari (WebKit) | Tauri (WKWebView) | 判定 |
|---|---|---|---|---|
| **テキスト描画の鮮明さ** | 鮮明 | **ぼやける** | **ぼやける** | ✅ Safari = Tauri |
| **import ボタン** (#51) | 正常 | 壊れる | **同じ壊れ方** | ✅ Safari = Tauri |
| 貼り付け Cmd+V | — | — | — | ⏭ 未検証 (下記) |

**S3 で観測した「ぼんやり」の正体**: HiDPI の取りこぼしではない。
ディスプレイは Mac Studio に接続した **DELL の非 Retina モニタ** (2560x1440) であり、
`devicePixelRatio: 1` は**正しい値**である。Chrome だけが鮮明に見えるのは
**Blink と WebKit のテキストラスタライズの差** — 非 Retina では WebKit の方が柔らかく出る。
つまり Tauri 固有の不具合ではなく、**エンジン差そのもの**である。

**→ 結論: `tauri://` の webview と Safari は、描画品質でも既知の破損 (#51) でも同一に振る舞う。
§1.2 の「Safari を開けば同じ WebKit で確かめられる」という前提は実測で裏付けられた。**
使い込みフェイズを Safari で回す判断はこのまま進めてよい。

**未検証として残すもの**: Cmd+V の画像貼り付けはユーザー判断で飛ばした
(クリップボードに画像を用意する手間に対して得るものが小さい)。
`navigator.clipboard.read` が function として存在することは診断ページで確認済みだが、
**実際にユーザー操作要件を満たして画像が取れるかは未確認**。使い込みフェイズで拾う。

### S5. 撤収 — 完了

- 一時ディレクトリ (Tauri 雛形 + 診断ページ + Rust ビルド成果物、計 3.0 GB) を削除。
  **spike のコードは残していない**
- 起動していたプロセス (Tauri アプリ / `:3000` デーモン / `:4173` preview) をすべて停止
- **conversensus 本体のコードは 1 行も変更していない** (`git status` で確認済み。
  差分は本計画書のみ。`src/client/dist/` は gitignore 対象)

**ツールチェインの最終状態** (§6 の「戻すかはユーザー判断」への回答):
ユーザーが **rustup 本体を arm64 でインストールし直した** (S1 で見送った選択肢)。

| 項目 | 最終状態 |
|---|---|
| `rustup` / `cargo` / `rustc` の実体 | ✅ `Mach-O 64-bit executable arm64` |
| `rustup show` の Default host | ✅ **`aarch64-apple-darwin`** (S0 では x86_64) |
| インストール済 toolchain | `stable-aarch64-apple-darwin` のみ |
| `Rustup is not running natively` 警告 | ✅ 消えた (`--force-non-host` はもう要らない) |

> **注意**: `~/.cargo` をクリーンにしたため、**S0 時点で入っていた `wasm32-unknown-unknown`
> target は消えている**。wasm を使う他プロジェクトがあれば
> `rustup target add wasm32-unknown-unknown` で入れ直す必要がある。

---

## 7.1 結論 — 仮説の判定

| 仮説 | 判定 | 根拠 |
|---|---|---|
| **H1**: 原因は Rust toolchain が x86_64 | ✅ **支持** | aarch64 toolchain に是正した直後、Tauri v2 は無改造で 1 分 2 秒でビルドが通り、arm64 バイナリと `aarch64.dmg` を吐いた |
| **H2**: 真犯人は webview (WKWebView) 側 | ⚠️ **限定的に支持** | React Flow の描画・操作・fetch・localStorage はすべて動く (H2 は「Tauri が成立しない理由」ではない)。ただし**エンジン差は実在する** — テキスト描画が Blink より柔らかく、#51 の import ボタンは現に壊れる |
| **H3**: 当時固有で再現しない | ⚠️ **判定不能 (意図的)** | S1 でツールチェインを是正してから S2 を実行したため、「x86_64 のままなら失敗したか」は試していない。直った以上、元に戻して確かめる実益がない |

**R1 の最終格付け: 切り分け済 (原因 = 環境設定)。Tauri の欠陥ではない。**

R1 の実体は「rustup が Rosetta 下で導入されており、default host が x86_64 だった」ことである。
これは Rust 側の環境事情であって、Tauri にも macOS 26 にも WebKit にも問題はなかった。
**Phase 8 の設計から R1 を落としてよい。**

### 7.2 Phase 8 本体への申し送り (この spike で確定した設定事項)

R1 とは別に、Tauri 化で実際に必要になる設定が 3 つ確定した。いずれも軽い。

| 事項 | 結論 | 根拠 |
|---|---|---|
| デーモンの CORS | **`tauri://localhost` を許可する必要がある** (既存の `ALLOWED_ORIGIN` で足りる) | `http://localhost:` 前綴りしか許可していない (`src/server/src/index.ts:71`) |
| クライアントのビルド | **`VITE_API_BASE` をローカルデーモンへ向ける必要がある** | `.env.production` が VPS を指すため、素の `build` は Tauri でも VPS と話す |
| Info.plist の ATS 例外 | **不要** (A/B で確認済み) | 例外なしでも `tauri://localhost` → `http://localhost:3000` の fetch は通る |

CSP は雛形が `null` なので既定では問題にならない (張るなら Phase 8 で明示的に)。

### 7.3 この spike の進め方についての記録

- **所要時間: 約 1 時間** (時間箱は半日、最大 1 日)。S2 の初回ビルドも 1 分 2 秒で、
  §6 の「初回ビルドが重い」リスクは空振りだった
- **時間の大半 (約 40 分) は S3 の偽の原因 3 つを潰すのに使った**。うち 1 つ (`VITE_API_BASE`)
  は計画書の手順の穴が原因であり、本質的な作業ではなかった
- **観測手段の制約**: この環境では `screencapture` (画面収録権限) も `osascript`
  (アクセシビリティ権限) も devtools も使えなかった。代替として
  (a) WebKit ヘルパープロセスの生死による webview 起動判定、
  (b) webview 内から localhost のプローブへ値を送り返す診断ページ、
  (c) ユーザーによる目視、の 3 つを組み合わせた。
  **(b) は今後も Tauri の中身を機械的に観測する手段として使える**

---

## 8. この spike の後にどうなるか

| S2/S3 の結果 | R1 の格付け | 次のアクション |
|---|---|---|
| **✅ 実際の結果**: S1→S2 が通り arm64 バイナリが出た | **切り分け済** (原因 = toolchain 設定) | Phase 8 の設計から R1 を落とす。使い込みフェイズへ |
| S2 が失敗する | **残存** (H1 棄却) | 原因を Phase 8 の設計課題へ格上げ。B2 継続 (§7 の B2 案) の判断材料にする |
| S2 は通るが S3 で React Flow が壊れる | **主犯は H2** | 「Safari で使い込む」判断がいっそう正しくなる。#51 の優先度を上げる |

**実際に起きたのは 1 行目**である (§7.1)。加えて S4 で、**Safari が WKWebView の代理として
機能することが実測で裏付けられた** — 描画のぼやけ方も #51 の import ボタンの壊れ方も、
Safari と Tauri で一致し、Chrome だけが違った。3 行目の「使い込みフェイズを Safari で回す」
という判断も、別ルートから補強されたことになる。

次は予定どおり **使い込みフェイズ** (`../requirements/user-test-environment.md` §7)。
Phase 8 本体はその後である。持ち越す宿題は §7.2 の 3 点と、
未検証のまま残した Cmd+V の画像貼り付け。

---

## References

- `../architecture/step1.md` §7 (配布形態 B1/B2 の比較), §9 R1
- `./step1-implementation.md` §2 Phase 8 (配布形態 / VPS)
- `../requirements/user-test-environment.md` §7 (Safari での使い込み手順)
- GitHub issue #51 「non-chrome web ブラウザに対応する」 — WebKit で現に壊れている箇所
- `./step1-phase7-range-fetch.md` §5.1 — 投棄前提 spike の先例 (p7-0)
