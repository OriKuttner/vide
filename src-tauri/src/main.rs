// main.rs - Native desktop application entry point for Tauri
// Part of Vector IDE
// Written by: Ori Kuttner and Shira (Antigravity agent)

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
	// Disable GTK overlay scrolling so scrollbars stay permanently visible and do not fade out
	#[cfg(target_os = "linux")]
	unsafe {
		std::env::set_var("GTK_OVERLAY_SCROLLING", "0");
	}

	vide_lib::run();
}
