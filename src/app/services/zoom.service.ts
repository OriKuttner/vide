import { Injectable, signal, computed } from '@angular/core';

export const DEFAULT_ZOOM = 1.0;
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 2.5;
export const ZOOM_STEP = 0.1;
export const BASE_FONT_SIZE = 22;

@Injectable({
  providedIn: 'root',
})
export class ZoomService {
  // Current zoom level: 1.0 = 100%, 1.2 = 120%, etc.
  readonly currentZoom = signal<number>(DEFAULT_ZOOM);

  // Computed font size (e.g. 22px * 1.0 = 22px)
  readonly editorFontSize = computed(() => Math.round(BASE_FONT_SIZE * this.currentZoom()));
  readonly zoomPercentage = computed(() => Math.round(this.currentZoom() * 100));

  private isTauriApp = false;
  private isInitialized = false;

  constructor() {
    this.detectTauri();
    this.loadSavedZoom();
    this.registerGlobalKeyListeners();
  }

  private detectTauri(): void {
    if (typeof window !== 'undefined') {
      this.isTauriApp = !!(
        (window as any).__TAURI_INTERNALS__ ||
        (window as any).__TAURI__
      );
    }
  }

  private loadSavedZoom(): void {
    if (typeof window === 'undefined') return;

    try {
      const savedZoom = localStorage.getItem('vector_ide_zoom');
      const savedFontSize = localStorage.getItem('vector_ide_font_size');
      const savedScale = localStorage.getItem('vector_ide_font_scale');

      let zoom = DEFAULT_ZOOM;
      if (savedFontSize === '20' || (!savedZoom && !savedFontSize)) {
        // Upgrade to requested default of 22px
        localStorage.setItem('vector_ide_font_size', '22');
        localStorage.setItem('vector_ide_zoom', '1.00');
        localStorage.setItem('vector_ide_font_scale', '1.00');
        zoom = 1.0;
      } else if (savedZoom) {
        const val = parseFloat(savedZoom);
        if (!isNaN(val) && val >= MIN_ZOOM && val <= MAX_ZOOM) {
          zoom = val;
        }
      } else if (savedScale) {
        const val = parseFloat(savedScale);
        if (!isNaN(val) && val >= MIN_ZOOM && val <= MAX_ZOOM) {
          zoom = val;
        }
      } else if (savedFontSize) {
        const val = parseFloat(savedFontSize);
        if (!isNaN(val) && val >= 10 && val <= 60) {
          zoom = val / BASE_FONT_SIZE;
        }
      }

      this.currentZoom.set(zoom);
      this.applyZoom(zoom);
    } catch (e) {
      console.warn('Failed to load saved zoom from localStorage:', e);
    } finally {
      this.isInitialized = true;
    }
  }

  public async setZoom(level: number): Promise<void> {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(level * 100) / 100));
    this.currentZoom.set(clamped);

    // Save font size and zoom level to localStorage
    try {
      localStorage.setItem('vector_ide_zoom', clamped.toFixed(2));
      localStorage.setItem('vector_ide_font_scale', clamped.toFixed(2));
      localStorage.setItem('vector_ide_font_size', Math.round(BASE_FONT_SIZE * clamped).toString());
    } catch (e) {
      console.warn('Failed to save zoom to localStorage:', e);
    }

    await this.applyZoom(clamped);
  }

  public async zoomIn(): Promise<void> {
    const next = Math.round((this.currentZoom() + ZOOM_STEP) * 10) / 10;
    await this.setZoom(next);
  }

  public async zoomOut(): Promise<void> {
    const next = Math.round((this.currentZoom() - ZOOM_STEP) * 10) / 10;
    await this.setZoom(next);
  }

  public async resetZoom(): Promise<void> {
    await this.setZoom(DEFAULT_ZOOM);
  }

  private async applyZoom(factor: number): Promise<void> {
    if (typeof window === 'undefined') return;

    let appliedTauri = false;
    if (this.isTauriApp) {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const webview = getCurrentWebview();
        if (webview && typeof webview.setZoom === 'function') {
          await webview.setZoom(factor);
          appliedTauri = true;
        }
      } catch (err) {
        console.warn('Tauri webview setZoom failed, fallback to CSS zoom:', err);
      }
    }

    // Set CSS zoom on body if Tauri native zoom is not available
    if (!appliedTauri) {
      (document.body.style as any).zoom = `${factor}`;
    } else {
      (document.body.style as any).zoom = '1';
    }

    // Always update CSS custom properties
    document.documentElement.style.setProperty('--app-zoom', factor.toString());
    document.documentElement.style.setProperty('--app-font-scale', factor.toString());

    // Trigger window resize so Monaco layout recalculates smoothly
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
  }

  private registerGlobalKeyListeners(): void {
    if (typeof window === 'undefined') return;

    // Use capture phase to intercept shortcuts before any child component or Monaco stops propagation
    window.addEventListener(
      'keydown',
      (event: KeyboardEvent) => {
        if (!event.ctrlKey && !event.metaKey) return;

        // Zoom In: Ctrl + '+', Ctrl + '=', Ctrl + NumpadAdd
        if (
          event.key === '+' ||
          event.key === '=' ||
          event.code === 'Equal' ||
          event.code === 'NumpadAdd'
        ) {
          event.preventDefault();
          event.stopPropagation();
          this.zoomIn();
        }
        // Zoom Out: Ctrl + '-', Ctrl + '_', Ctrl + NumpadSubtract
        else if (
          event.key === '-' ||
          event.key === '_' ||
          event.code === 'Minus' ||
          event.code === 'NumpadSubtract'
        ) {
          event.preventDefault();
          event.stopPropagation();
          this.zoomOut();
        }
        // Reset Zoom: Ctrl + '0', Ctrl + Numpad0
        else if (
          event.key === '0' ||
          event.code === 'Digit0' ||
          event.code === 'Numpad0'
        ) {
          event.preventDefault();
          event.stopPropagation();
          this.resetZoom();
        }
      },
      { capture: true, passive: false }
    );

    // Ctrl + Mouse Wheel zoom
    window.addEventListener(
      'wheel',
      (event: WheelEvent) => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          if (event.deltaY < 0) {
            this.zoomIn();
          } else if (event.deltaY > 0) {
            this.zoomOut();
          }
        }
      },
      { capture: true, passive: false }
    );
  }
}
