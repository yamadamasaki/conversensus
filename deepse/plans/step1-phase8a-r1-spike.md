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

*(未実施)*

---

## 8. この spike の後にどうなるか

| S2/S3 の結果 | R1 の格付け | 次のアクション |
|---|---|---|
| S1→S2 が通り arm64 バイナリが出る | **切り分け済** (原因 = toolchain 設定) | Phase 8 の設計から R1 を落とす。使い込みフェイズへ |
| S2 が失敗する | **残存** (H1 棄却) | 原因を Phase 8 の設計課題へ格上げ。B2 継続 (§7 の B2 案) の判断材料にする |
| S2 は通るが S3 で React Flow が壊れる | **主犯は H2** | 「Safari で使い込む」判断がいっそう正しくなる。#51 の優先度を上げる |

いずれの結果でも、**次は使い込みフェイズ** (`../requirements/user-test-environment.md` §7)。
Phase 8 本体はその後である。

---

## References

- `../architecture/step1.md` §7 (配布形態 B1/B2 の比較), §9 R1
- `./step1-implementation.md` §2 Phase 8 (配布形態 / VPS)
- `../requirements/user-test-environment.md` §7 (Safari での使い込み手順)
- GitHub issue #51 「non-chrome web ブラウザに対応する」 — WebKit で現に壊れている箇所
- `./step1-phase7-range-fetch.md` §5.1 — 投棄前提 spike の先例 (p7-0)
