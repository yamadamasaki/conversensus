//! conversensus の macOS アプリ本体 (step1 Phase 8)
//!
//! **このシェルの仕事は 2 つだけである。**
//!
//! 1. 同梱したデーモン (sidecar) を起動し、**アプリと同じ寿命で確実に終わらせる** (設計 D1)
//! 2. デーモンに **`DATA_DIR` を明示的に渡す** (設計 D2)
//!
//! 2 が要るのは、コンパイル済みバイナリの中では `import.meta.dir` が `/$bunfs/root` に
//! なり、デーモン既定のデータ置き場が `/data` (ルート直下) へ化けるからである。
//! 渡さないとアプリは起動直後に `EROFS` で死ぬ (計画 §2.2 で実測)。
//!
//! 1 が要るのは、孤児プロセスが残ると次の起動でポートを掴めず、デーモンが
//! `EADDRINUSE` で死ぬからである (計画 §2.3)。

use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// sidecar の名前。`src-tauri/binaries/<この名前>-<target triple>` に置く
const DAEMON_BIN: &str = "conversensusd";

/// デーモンの待受ポート (設計 D3)。
///
/// **開発用の 3000 は使わない。** この開発機では `bun run dev:server` が動いている
/// ことが多く、3000 を掴みに行くと日常的に衝突して起動できない (計画 §2.3)。
const DAEMON_PORT: &str = "39847";

/// 起動したデーモン。終了時に落とすために持っておく
struct Daemon(Mutex<Option<CommandChild>>);

impl Daemon {
    /// デーモンを終了させる。**二度呼ばれても安全である**
    /// (`take` で取り出すので、2 回目は None になる)
    fn stop(&self) {
        if let Some(child) = self.0.lock().expect("Daemon の Mutex").take() {
            // 失敗しても続ける — 既に死んでいる場合もここに来る
            let _ = child.kill();
        }
    }
}

/// デーモンを起動し、その標準出力・標準エラーをアプリのログへ流す。
///
/// **ログを捨てない。** 配布物では利用者の手掛かりがログしか無いので、
/// デーモンが何を言って死んだかが分からなくなると診断できなくなる (設計 D5)。
///
/// 戻り値のエラー型が `Box<dyn Error>` なのは、**shell プラグインのエラーが
/// `tauri::Error` へ変換できない**ためである (`From` が実装されていない)。
/// `setup` の戻り値型と同じにして、そのまま `?` で運べるようにする。
fn spawn_daemon(
    app: &tauri::AppHandle,
    data_dir: &std::path::Path,
) -> Result<CommandChild, Box<dyn std::error::Error>> {
    let (mut rx, child) = app
        .shell()
        .sidecar(DAEMON_BIN)?
        .env("DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("PORT", DAEMON_PORT)
        // **アプリが強制終了されたときの保険** (設計 D1)。正常終了なら Tauri が
        // sidecar を kill するが、`kill -9` された場合はここが唯一の逃げ道である。
        // 残った孤児は同じポートを掴んだまま次回の起動を壊す (実測済み)
        .env("PARENT_PID", std::process::id().to_string())
        .spawn()?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[daemon] {}", String::from_utf8_lossy(&line).trim_end())
                }
                CommandEvent::Stderr(line) => {
                    log::error!("[daemon] {}", String::from_utf8_lossy(&line).trim_end())
                }
                // **終了は必ず残す。** 黙って消えるのが一番困る
                CommandEvent::Terminated(payload) => {
                    log::error!("[daemon] 終了しました: code={:?}", payload.code)
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // OS 標準のアプリケーションサポート配下 (設計 D2)。
            // **開発時のリポジトリ内 `data/` とは別の場所**であり、混ざらない
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            log::info!("data dir: {}", data_dir.display());

            let child = spawn_daemon(app.handle(), &data_dir)?;
            app.manage(Daemon(Mutex::new(Some(child))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        // **終了の合図は 2 つある。** `ExitRequested` は最後のウィンドウが閉じたとき、
        // `Exit` は実際に終わる直前。前者だけだと `Cmd+Q` で取りこぼす経路があるので
        // 両方で落とす (`stop` は二度呼ばれても安全)
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            handle.state::<Daemon>().stop();
        }
    });
}
