import { Injectable, inject } from '@angular/core';
import type * as MonacoType from 'monaco-editor';
import { AiService } from './ai.service';

@Injectable({
  providedIn: 'root',
})
export class InlineCompletionService {
  private readonly aiService = inject(AiService);
  private currentAbortController: AbortController | null = null;

  /**
   * Registers inline completion providers (Ghost Text) for all supported languages.
   * Powered by local llama-server (FIM) with smart heuristic fallback.
   */
  public registerProviders(monaco: typeof MonacoType): void {
    const supportedLanguages = [
      'omniflux',
      'typescript',
      'javascript',
      'php',
      'c',
      'cpp',
      'perl',
      'shell',
      'python',
      'rust',
      'sql',
      'json',
      'html',
      'css',
      'markdown',
    ];

    for (const language of supportedLanguages) {
      monaco.languages.registerInlineCompletionsProvider(language, {
        provideInlineCompletions: async (model, position, _context, token) => {
          if (token.isCancellationRequested) {
            this.aiService.isGenerating.set(false);
            return { items: [] };
          }

          // 1. Abort previous in-flight AI request if any and immediately hide widget
          if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
          }
          this.aiService.isGenerating.set(false);

          const controller = new AbortController();
          this.currentAbortController = controller;

          token.onCancellationRequested(() => {
            controller.abort();
            this.aiService.isGenerating.set(false);
          });

          // Debounce 400ms: continuous typing never triggers AI or displays the widget
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 400);
            controller.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve();
            });
          });

          if (token.isCancellationRequested || controller.signal.aborted) {
            this.aiService.isGenerating.set(false);
            return { items: [] };
          }

          // 2. Fresh sample of model content and position AFTER debounce and auto-closing settled
          const offset = model.getOffsetAt(position);
          const fullContent = model.getValue();

          // Prefix: up to 2500 characters before cursor
          const prefixStart = Math.max(0, offset - 2500);
          const prefix = fullContent.substring(prefixStart, offset);

          // Suffix: up to 1000 characters after cursor
          const suffixEnd = Math.min(fullContent.length, offset + 1000);
          const suffix = fullContent.substring(offset, suffixEnd);

          const textBeforeCursorOnLine = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          const trimmedLinePrefix = textBeforeCursorOnLine.trim();

          // 3. Try AI FIM completion first if enabled and server is online
          if (
            this.aiService.isEnabled() &&
            this.aiService.isServerOnline() &&
            prefix.trim().length >= 2
          ) {
            try {
              let aiSuggestion = await this.aiService.getInfillCompletion(
                prefix,
                suffix,
                controller.signal
              );

              if (aiSuggestion && aiSuggestion.length > 0) {
                aiSuggestion = this.deduplicateOverlap(aiSuggestion, prefix, suffix);
                if (aiSuggestion.trim().length > 0) {
                  return {
                    items: [
                      {
                        insertText: aiSuggestion,
                        range: new monaco.Range(
                          position.lineNumber,
                          position.column,
                          position.lineNumber,
                          position.column
                        ),
                      },
                    ],
                  };
                }
              }
            } catch {
              // Ignore network aborts and fallback
            }
          }

          // 4. Fallback to smart heuristic / template suggestions
          if (trimmedLinePrefix.length < 2) {
            return { items: [] };
          }

          const rawSuggestion = this.getSmartSuggestion(language, trimmedLinePrefix);
          if (!rawSuggestion) {
            return { items: [] };
          }

          const suggestionText = this.deduplicateOverlap(rawSuggestion, prefix, suffix);
          if (suggestionText.trim().length === 0) {
            return { items: [] };
          }

          return {
            items: [
              {
                insertText: suggestionText,
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column
                ),
              },
            ],
          };
        },
        disposeInlineCompletions: () => {},
      });
    }
  }

  private getSmartSuggestion(language: string, currentPrefix: string): string | null {
    if (language === 'omniflux') {
      if ('when receiving'.startsWith(currentPrefix) || currentPrefix.endsWith('when receiving')) {
        return ' GET request to "/api/v1/users":\n    respond with status 200 and json {"ok": true}';
      }
      if ('listen on'.startsWith(currentPrefix) || currentPrefix.endsWith('listen')) {
        return ' on port 8080';
      }
      if (currentPrefix.endsWith('every')) {
        return ' 10 seconds {\n    print("Heartbeat tick");\n}';
      }
      if (currentPrefix.endsWith('db_query(') || currentPrefix.endsWith('db_query')) {
        return '("SELECT id, name FROM users WHERE active = 1", [])';
      }
      if (currentPrefix.endsWith('cache_set')) {
        return '("session_" + $user_id, $token, 3600)';
      }
      if (currentPrefix.endsWith('on start')) {
        return ' {\n    print("Vector Engine Initialized");\n}';
      }
      if (currentPrefix.endsWith('on shutdown')) {
        return ' {\n    print("Vector Engine Shutting Down");\n}';
      }
      if (currentPrefix.endsWith('define task')) {
        return ' processQueue with params ($queueName) {\n    print("Processing " + $queueName);\n}';
      }
      if (currentPrefix.endsWith('respond with')) {
        return ' status 200 and json {"status": "ok"}';
      }
      if (currentPrefix.endsWith('file_read')) {
        return '("data/config.json")';
      }
      if (currentPrefix.endsWith('file_write')) {
        return '("data/output.txt", $data)';
      }
    }

    if (language === 'typescript' || language === 'javascript') {
      if (currentPrefix.endsWith('export async function')) {
        return ' handleRequest(req: Request): Promise<Response> {\n  return new Response("OK");\n}';
      }
      if (currentPrefix.endsWith('const response = await')) {
        return ' fetch(endpoint, { headers: { "Content-Type": "application/json" } });';
      }
    }

    if (language === 'php') {
      if (currentPrefix.endsWith('public function')) {
        return ' getDetails(): array {\n        return $this->data;\n    }';
      }
    }

    if (language === 'shell') {
      if (currentPrefix.endsWith('#!') || currentPrefix === '#') {
        return '/usr/bin/env bash\nset -euo pipefail\n';
      }
      if (currentPrefix.endsWith('if [[')) {
        return ' -f "$1" ]]; then\n  echo "File found"\nfi';
      }
      if (currentPrefix.endsWith('while read')) {
        return ' -r line; do\n  echo "$line"\ndone < "$1"';
      }
    }

    if (language === 'python') {
      if (currentPrefix.endsWith('if __name__')) {
        return " == '__main__':\n    main()";
      }
      if (currentPrefix.endsWith('def main():')) {
        return '\n    """Main entry point."""\n    pass';
      }
    }

    return null;
  }

  /**
   * Deduplicates both prefix collisions (leading opening brackets/quotes already typed)
   * and suffix collisions (trailing closing brackets/parentheses, quotes, and punctuation)
   * in AI suggestions.
   */
  private deduplicateOverlap(suggestion: string, prefix: string, suffix: string): string {
    let cleaned = suggestion;
    const trimmedPrefix = prefix.trimEnd();
    const trimmedSuffix = suffix.trimStart();

    // 1. Prefix Collision: If suggestion starts with an opening bracket/quote that was already typed right before cursor
    for (const openChar of ['{', '(', '[', '"', "'", '`']) {
      if (trimmedPrefix.endsWith(openChar) && cleaned.trimStart().startsWith(openChar)) {
        const idx = cleaned.indexOf(openChar);
        cleaned = cleaned.substring(idx + 1);
      }
    }

    // 2. Suffix Collision: Deduplicate closing curly braces: }
    if (trimmedSuffix.startsWith('}')) {
      let openCount = (cleaned.match(/\{/g) || []).length;
      let closeCount = (cleaned.match(/\}/g) || []).length;
      while (closeCount > openCount && /\}[;\s]*$/.test(cleaned)) {
        cleaned = cleaned.replace(/\s*\}\s*;?\s*$/, '');
        closeCount--;
      }
      // If the suggestion is multiline and suffix begins with '}' on the same line,
      // ensure there is a newline before the closing brace so it stays on its own line
      if (cleaned.includes('\n') && !suffix.startsWith('\n') && !suffix.startsWith('\r\n')) {
        if (!cleaned.endsWith('\n')) {
          cleaned += '\n';
        }
      }
    }

    // 3. Suffix Collision: Deduplicate closing parentheses: )
    if (trimmedSuffix.startsWith(')')) {
      let openCount = (cleaned.match(/\(/g) || []).length;
      let closeCount = (cleaned.match(/\)/g) || []).length;
      while (closeCount > openCount && /\)[;\s]*$/.test(cleaned)) {
        cleaned = cleaned.replace(/\s*\)\s*;?\s*$/, '');
        closeCount--;
      }
    }

    // 4. Suffix Collision: Deduplicate closing square brackets: ]
    if (trimmedSuffix.startsWith(']')) {
      let openCount = (cleaned.match(/\[/g) || []).length;
      let closeCount = (cleaned.match(/\]/g) || []).length;
      while (closeCount > openCount && /\][;\s]*$/.test(cleaned)) {
        cleaned = cleaned.replace(/\s*\]\s*;?\s*$/, '');
        closeCount--;
      }
    }

    // 5. Suffix Collision: Deduplicate semicolon if suffix immediately starts with semicolon
    if (trimmedSuffix.startsWith(';') && cleaned.trimEnd().endsWith(';')) {
      cleaned = cleaned.replace(/;\s*$/, '');
    }

    // 6. Suffix Collision: Deduplicate closing quotes if suffix immediately starts with matching quote
    for (const q of ['"', "'", '`']) {
      if (trimmedSuffix.startsWith(q)) {
        const count = cleaned.split(q).length - 1;
        if (count % 2 === 1 && cleaned.trimEnd().endsWith(q)) {
          cleaned = cleaned.slice(0, cleaned.lastIndexOf(q));
        }
      }
    }

    return cleaned;
  }
}
