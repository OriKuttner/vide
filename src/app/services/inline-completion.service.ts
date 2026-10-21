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
            return { items: [] };
          }

          // Abort previous in-flight AI request if any
          if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
          }

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

          // 1. Try AI FIM completion first if enabled and server is online
          if (
            this.aiService.isEnabled() &&
            this.aiService.isServerOnline() &&
            prefix.trim().length >= 2
          ) {
            const controller = new AbortController();
            this.currentAbortController = controller;

            token.onCancellationRequested(() => {
              controller.abort();
            });

            // Small typing debounce of 120ms to save CPU cycles
            await new Promise((resolve) => setTimeout(resolve, 120));

            if (token.isCancellationRequested || controller.signal.aborted) {
              return { items: [] };
            }

            try {
              const aiSuggestion = await this.aiService.getInfillCompletion(
                prefix,
                suffix,
                controller.signal
              );

              if (aiSuggestion && aiSuggestion.length > 0) {
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
            } catch {
              // Ignore network aborts and fallback
            }
          }

          // 2. Fallback to smart heuristic / template suggestions
          if (trimmedLinePrefix.length < 2) {
            return { items: [] };
          }

          const suggestionText = this.getSmartSuggestion(language, trimmedLinePrefix);
          if (!suggestionText) {
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
}
