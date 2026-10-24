/**
 * main.ts - Main entry point bootstrapping Angular application
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

if (typeof window !== 'undefined') {
	window.addEventListener('error', (event) => {
		console.error('Unhandled UI Error:', event.error || event.message);
		try {
			(window as any).__TAURI__?.core
				?.invoke('log_to_terminal', {
					level: 'ERROR',
					message: `UI Unhandled Error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
				})
				.catch(() => {});
		} catch {}
	});

	window.addEventListener('unhandledrejection', (event) => {
		console.error('Unhandled Promise Rejection:', event.reason);
		try {
			(window as any).__TAURI__?.core
				?.invoke('log_to_terminal', {
					level: 'ERROR',
					message: `UI Unhandled Rejection: ${event.reason?.message || event.reason}`,
				})
				.catch(() => {});
		} catch {}
	});
}

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
