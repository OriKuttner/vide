/**
 * omniflux.language.ts - OmniFlux syntax definition and Monarch tokens for Monaco editor
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import type * as MonacoType from 'monaco-editor';

/**
 * OmniFlux Language Definition for Monaco Editor.
 * Includes Monarch tokens provider, language configuration, and built-in snippets.
 */

export const OMNIFLUX_LANGUAGE_ID = 'omniflux';

export function registerOmniFlux(monaco: typeof MonacoType): void {
  // Check if already registered
  const registeredLanguages = monaco.languages.getLanguages();
  if (registeredLanguages.some((lang) => lang.id === OMNIFLUX_LANGUAGE_ID)) {
    return;
  }

  // Register language ID
  monaco.languages.register({
    id: OMNIFLUX_LANGUAGE_ID,
    extensions: ['.of'],
    aliases: ['OmniFlux', 'omniflux'],
    mimetypes: ['text/x-omniflux'],
  });

  // Language configuration (brackets, comments, auto-closing pairs)
  monaco.languages.setLanguageConfiguration(OMNIFLUX_LANGUAGE_ID, {
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });

  // Monarch tokenizer for syntax coloring
  monaco.languages.setMonarchTokensProvider(OMNIFLUX_LANGUAGE_ID, {
    defaultToken: '',
    tokenPostfix: '.of',

    keywords: [
      'every',
      'wait',
      'seconds',
      'minutes',
      'hours',
      'on start',
      'on shutdown',
      'return',
      'if',
      'else',
      'as',
      'int',
      'float',
      'string',
      'var',
      'const',
      'fn',
      'define task',
      'with params',
    ],

    routingKeywords: [
      'listen on port',
      'start server on port',
      'when receiving',
      'request to',
      'respond with status',
      'and json',
      'from body',
      'from query',
      'GET',
      'POST',
      'PUT',
      'DELETE',
    ],

    nativeFunctions: [
      'db_query',
      'cache_set',
      'cache_get',
      'file_read',
      'file_write',
      'print',
    ],

    operators: [
      '=',
      '>',
      '<',
      '!',
      '~',
      '?',
      ':',
      '==',
      '<=',
      '>=',
      '!=',
      '&&',
      '||',
      '++',
      '--',
      '+',
      '-',
      '*',
      '/',
      '&',
      '|',
      '^',
      '%',
    ],

    // Common regular expressions
    symbols: /[=><!~?:&|+\-*\/\^%]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

    tokenizer: {
      root: [
        // Multi-word keywords and phrases (check first before identifiers)
        [/listen\s+on\s+port\b/, 'keyword.routing'],
        [/start\s+server\s+on\s+port\b/, 'keyword.routing'],
        [/when\s+receiving\b/, 'keyword.routing'],
        [/request\s+to\b/, 'keyword.routing'],
        [/respond\s+with\s+status\b/, 'keyword.routing'],
        [/and\s+json\b/, 'keyword.routing'],
        [/from\s+body\b/, 'keyword.routing'],
        [/from\s+query\b/, 'keyword.routing'],
        [/on\s+start\b/, 'keyword.control'],
        [/on\s+shutdown\b/, 'keyword.control'],
        [/define\s+task\b/, 'storage.type'],
        [/with\s+params\b/, 'storage.type'],

        // HTTP verbs
        [/\b(GET|POST|PUT|DELETE)\b/, 'keyword.other.http'],

        // Global / Sigil variables ($var)
        [/\$[a-zA-Z_]\w*/, 'variable.name'],

        // Identifiers and single-word keywords
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@nativeFunctions': 'support.function',
              '@default': 'identifier',
            },
          },
        ],

        // Whitespace and comments
        { include: '@whitespace' },

        // Delimiters and operators
        [/[{}()\[\]]/, '@brackets'],
        [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],

        // Numbers
        [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
        [/\d+/, 'number'],

        // Strings
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, { token: 'string.quote', bracket: '@open', next: '@string_double' }],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/'/, { token: 'string.quote', bracket: '@open', next: '@string_single' }],
      ],

      whitespace: [
        [/[ \t\r\n]+/, 'white'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
      ],

      comment: [
        [/[^\/*]+/, 'comment'],
        [/\/\*/, 'comment', '@push'],
        ['\\*/', 'comment', '@pop'],
        [/[\/*]/, 'comment'],
      ],

      string_double: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
      ],

      string_single: [
        [/[^\\']+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
      ],
    },
  });

  // Snippets & Completion Items for OmniFlux
  monaco.languages.registerCompletionItemProvider(OMNIFLUX_LANGUAGE_ID, {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: MonacoType.languages.CompletionItem[] = [
        {
          label: 'listen on port',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'listen on port ${1:3000}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Initialize web server on port',
          range,
        },
        {
          label: 'when receiving GET',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'when receiving GET request to "${1:/api/route}":\n    ${0:// Handle request}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Create a GET route handler',
          range,
        },
        {
          label: 'when receiving POST',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'when receiving POST request to "${1:/api/route}":\n    const ${2:param} = ${2:param} from body\n    ${0:// Handle request}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Create a POST route handler',
          range,
        },
        {
          label: 'when receiving PUT',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'when receiving PUT request to "${1:/api/route}":\n    const ${2:param} = ${2:param} from body\n    ${0:// Handle request}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Create a PUT route handler',
          range,
        },
        {
          label: 'when receiving DELETE',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'when receiving DELETE request to "${1:/api/route}":\n    const ${2:id} = ${2:id} from query\n    ${0:// Handle request}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Create a DELETE route handler',
          range,
        },
        {
          label: 'respond with status and json',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'respond with status ${1:200} and json {"${2:ok}": ${3:true}}${0}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Respond to HTTP request with status code and JSON payload',
          range,
        },
        {
          label: 'from query',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'const ${1:param} = ${1:param} from query${0}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Extract query parameter from URL in route',
          range,
        },
        {
          label: 'define task with params',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'define task ${1:taskName} with params (${2:$param1}) {\n    ${0:// Task implementation}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Define an OmniFlux background task with parameters',
          range,
        },
        {
          label: 'every (timer loop)',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'every ${1:10} seconds {\n    ${0}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Define a repeating timer loop',
          range,
        },
        {
          label: 'wait',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'wait ${1:2} seconds',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Delay execution',
          range,
        },
        {
          label: 'db_query',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'const ${1:results} = db_query("${2:SELECT * FROM table}", [${3}])',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Execute SQL database query',
          range,
        },
        {
          label: 'cache_set',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'cache_set("${1:key}", ${2:value}, ${3:3600})',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Cache a value with TTL',
          range,
        },
        {
          label: 'cache_get',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'const ${1:val} = cache_get("${2:key}")${0}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Retrieve a value from the cache by key',
          range,
        },
        {
          label: 'file_read',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'const ${1:content} = file_read("${2:path/to/file.txt}")${0}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Read entire content of a file into a variable',
          range,
        },
        {
          label: 'file_write',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'file_write("${1:path/to/file.txt}", ${2:content})${0}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Write content to a file',
          range,
        },
        {
          label: 'on start',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'on start {\n    ${0}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Executes immediately on startup',
          range,
        },
        {
          label: 'on shutdown',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'on shutdown {\n    ${0:// Cleanup resources}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Executes clean shutdown handlers upon service termination',
          range,
        },
      ];

      return { suggestions };
    },
  });
}
