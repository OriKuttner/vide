/**
 * markdown.pipe.ts - Markdown renderer pipe for chat messages with syntax highlighting and copy button
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

// Configure marked with custom code block renderer and copy button
marked.use({
  renderer: {
    code(token: any, lang?: string) {
      const codeText = typeof token === 'object' && token !== null ? (token.text || '') : String(token || '');
      const codeLang = typeof token === 'object' && token !== null ? (token.lang || '') : (lang || '');
      const normLang = (codeLang || '').trim().toLowerCase();
      const isExplicitRtl = normLang === 'email-he' || normLang === 'he' || normLang === 'hebrew' || normLang === 'rtl' || (normLang === 'email' && /[\u0590-\u05FF]/.test(codeText));
      const dir = isExplicitRtl ? 'rtl' : 'ltr';
      const textAlign = isExplicitRtl ? 'right' : 'left';
      const escapedCode = codeText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      return `<div class="code-block-wrapper my-2 ${dir}" dir="${dir}" style="direction: ${dir} !important; text-align: ${textAlign} !important; position: relative;">` +
        `<button type="button" class="copy-code-btn" onclick="copyChatCodeToClipboard(this)" title="Copy Code">` +
        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>` +
        `<span>Copy</span></button>` +
        `<pre class="code-pre" style="direction: ${dir} !important; text-align: ${textAlign} !important;"><code class="language-${codeLang || 'text'}">${escapedCode}</code></pre></div>`;
    },
    link(token: any, href?: string, title?: string, text?: string) {
      const linkHref = (typeof token === 'object' && token !== null ? token.href : href) || '';
      const linkTitle = (typeof token === 'object' && token !== null ? token.title : title) || '';
      const linkText = (typeof token === 'object' && token !== null ? (token.text || token.href) : text) || linkHref;
      const titleAttr = linkTitle ? ` title="${String(linkTitle).replace(/"/g, '&quot;')}"` : '';
      return `<a href="${linkHref}" target="_blank" rel="noopener noreferrer"${titleAttr}>${linkText}</a>`;
    }
  }
});

if (typeof window !== 'undefined') {
  (window as any).copyChatCodeToClipboard = function(btn: HTMLElement) {
    if (!btn) return;
    const wrapper = btn.closest('.code-block-wrapper');
    const codeEl = wrapper ? wrapper.querySelector('code') : null;
    if (!codeEl) return;
    const textToCopy = codeEl.innerText.trim();
    navigator.clipboard.writeText(textToCopy).then(() => {
      const span = btn.querySelector('span');
      if (span) span.innerText = 'Copied!';
      setTimeout(() => {
        if (span) span.innerText = 'Copy';
      }, 2000);
    }).catch(err => console.error('Failed to copy code:', err));
  };
}

const markdownCache = new Map<string, SafeHtml>();

@Pipe({
  name: 'markdown',
  standalone: true,
  pure: true
})
export class MarkdownPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(content: string | null | undefined): SafeHtml {
    if (!content) return '';

    const cached = markdownCache.get(content);
    if (cached) {
      return cached;
    }

    try {
      const parsed = marked.parse(content) as string;
      const safeHtml = this.sanitizer.bypassSecurityTrustHtml(parsed);

      // Cache the result (evicting oldest entry if exceeding 1000 items)
      if (markdownCache.size > 1000) {
        const firstKey = markdownCache.keys().next().value;
        if (firstKey !== undefined) {
          markdownCache.delete(firstKey);
        }
      }
      markdownCache.set(content, safeHtml);
      return safeHtml;
    } catch {
      return content;
    }
  }
}
