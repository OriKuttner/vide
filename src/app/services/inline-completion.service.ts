import { Injectable } from '@angular/core';
import type * as MonacoType from 'monaco-editor';

@Injectable({
  providedIn: 'root',
})
export class InlineCompletionService {
  /**
   * Registers inline completion providers (Ghost Text) for all supported languages.
   * This is the exact mechanism used by AI code assistants like Antigravity IDE and Copilot.
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
    ];

    for (const language of supportedLanguages) {
      monaco.languages.registerInlineCompletionsProvider(language, {
        provideInlineCompletions: async (model, position) => {
          const textBeforeCursor = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          const trimmed = textBeforeCursor.trim();
          if (trimmed.length < 2) {
            return { items: [] };
          }

          const suggestionText = this.getSmartSuggestion(language, trimmed);
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
