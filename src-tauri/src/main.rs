// main.rs - Native desktop application entry point for Tauri
// Part of Vector IDE
// Written by: Ori Kuttner and Shira (Antigravity agent)

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
	vide_lib::run();
}
