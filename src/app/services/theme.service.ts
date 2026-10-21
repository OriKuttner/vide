import { Injectable, signal, effect } from '@angular/core';

export type AppTheme = 'light' | 'dark';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  // Default theme is light mode as requested
  readonly currentTheme = signal<AppTheme>('light');

  constructor() {
    // Sync theme class to document body / root
    effect(() => {
      const theme = this.currentTheme();
      if (typeof document !== 'undefined') {
        document.body.classList.remove('theme-light', 'theme-dark');
        document.body.classList.add(`theme-${theme}`);
      }
    });
  }

  public toggleTheme(): void {
    this.currentTheme.update((prev) => (prev === 'light' ? 'dark' : 'light'));
  }

  public setTheme(theme: AppTheme): void {
    this.currentTheme.set(theme);
  }
}
