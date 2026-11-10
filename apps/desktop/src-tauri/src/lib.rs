// V0.1 不提供设备命令、文件系统访问权限或 PLC 通信。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("ADui SCADA 桌面端启动失败");
}
