// 非调试构建时隐藏额外的 Windows 控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    adui_scada_desktop_lib::run()
}
