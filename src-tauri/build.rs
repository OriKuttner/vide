/**
 * build.rs - Cargo build script for Tauri native compilation
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

fn main() {
	tauri_build::build()
}
