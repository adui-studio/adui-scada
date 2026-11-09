// Hide the extra Windows console for non-debug builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    adui_scada_desktop_lib::run()
}
