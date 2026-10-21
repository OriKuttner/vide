import type * as MonacoType from 'monaco-editor';

/**
 * Interface for snippet and keyword completion definitions across supported languages.
 */
interface CompletionDefinition {
  label: string;
  kind: MonacoType.languages.CompletionItemKind;
  detail: string;
  documentation: string;
  insertText: string;
  isSnippet?: boolean;
  sortText?: string;
}

/**
 * =========================================================================
 * C & C++ Language Completions (Keywords, Standard Library, Snippets)
 * =========================================================================
 */
const C_KEYWORDS = [
  'auto',
  'break',
  'case',
  'char',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extern',
  'float',
  'for',
  'goto',
  'if',
  'inline',
  'int',
  'long',
  'register',
  'restrict',
  'return',
  'short',
  'signed',
  'sizeof',
  'static',
  'struct',
  'switch',
  'typedef',
  'union',
  'unsigned',
  'void',
  'volatile',
  'while',
  'NULL',
  'size_t',
  'bool',
  'true',
  'false',
];

const C_STDLIB_FUNCS: Array<{ name: string; signature: string; doc: string }> = [
  { name: 'printf', signature: 'int printf(const char *format, ...)', doc: 'Prints formatted output to stdout.' },
  { name: 'scanf', signature: 'int scanf(const char *format, ...)', doc: 'Reads formatted input from stdin.' },
  { name: 'malloc', signature: 'void *malloc(size_t size)', doc: 'Allocates uninitialized memory block.' },
  { name: 'calloc', signature: 'void *calloc(size_t num, size_t size)', doc: 'Allocates zero-initialized memory.' },
  { name: 'realloc', signature: 'void *realloc(void *ptr, size_t new_size)', doc: 'Reallocates memory block.' },
  { name: 'free', signature: 'void free(void *ptr)', doc: 'Deallocates allocated memory block.' },
  { name: 'strlen', signature: 'size_t strlen(const char *str)', doc: 'Computes the length of a string.' },
  { name: 'strcpy', signature: 'char *strcpy(char *dest, const char *src)', doc: 'Copies source string to destination.' },
  { name: 'strncpy', signature: 'char *strncpy(char *dest, const char *src, size_t n)', doc: 'Copies up to n characters.' },
  { name: 'strcmp', signature: 'int strcmp(const char *str1, const char *str2)', doc: 'Compares two strings lexicographically.' },
  { name: 'strncmp', signature: 'int strncmp(const char *str1, const char *str2, size_t n)', doc: 'Compares up to n characters.' },
  { name: 'strcat', signature: 'char *strcat(char *dest, const char *src)', doc: 'Concatenates two strings.' },
  { name: 'memcpy', signature: 'void *memcpy(void *dest, const void *src, size_t n)', doc: 'Copies memory area.' },
  { name: 'memset', signature: 'void *memset(void *str, int c, size_t n)', doc: 'Fills memory with a constant byte.' },
  { name: 'fopen', signature: 'FILE *fopen(const char *filename, const char *mode)', doc: 'Opens a file.' },
  { name: 'fclose', signature: 'int fclose(FILE *stream)', doc: 'Closes an open file stream.' },
  { name: 'fread', signature: 'size_t fread(void *ptr, size_t size, size_t nmemb, FILE *stream)', doc: 'Reads data from a stream.' },
  { name: 'fwrite', signature: 'size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream)', doc: 'Writes data to a stream.' },
  { name: 'exit', signature: 'void exit(int status)', doc: 'Terminates calling process immediately.' },
  { name: 'qsort', signature: 'void qsort(void *base, size_t nmemb, size_t size, int (*compar)(const void *, const void *))', doc: 'Sorts array elements.' },
];

const C_SNIPPETS: CompletionDefinition[] = [
  {
    label: '#include <stdio.h>',
    kind: 27, // Snippet
    detail: 'Include stdio.h & stdlib.h header',
    documentation: 'Standard C library header inclusion.',
    insertText: '#include <stdio.h>\n#include <stdlib.h>\n\n${0}',
    isSnippet: true,
    sortText: '00_inc_stdio',
  },
  {
    label: 'inc',
    kind: 27,
    detail: '#include <stdio.h>',
    documentation: 'Includes standard IO header.',
    insertText: '#include <${1:stdio.h}>\n${0}',
    isSnippet: true,
    sortText: '00_inc',
  },
  {
    label: 'include',
    kind: 27,
    detail: '#include <header.h>',
    documentation: 'Includes header file.',
    insertText: '#include <${1:stdio.h}>\n${0}',
    isSnippet: true,
    sortText: '00_include',
  },
  {
    label: 'main',
    kind: 27,
    detail: 'int main(int argc, char *argv[]) entry point',
    documentation: 'Standard C program entry point with arguments.',
    insertText: 'int main(int argc, char *argv[]) {\n    ${0}\n    return 0;\n}',
    isSnippet: true,
    sortText: '01_main',
  },
  {
    label: 'func',
    kind: 27,
    detail: 'Function definition',
    documentation: 'Defines a C function.',
    insertText: '${1:void} ${2:function_name}(${3:void}) {\n    ${0}\n}',
    isSnippet: true,
    sortText: '02_func',
  },
  {
    label: 'for',
    kind: 27,
    detail: 'for loop counter',
    documentation: 'Standard index-based for loop.',
    insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:count}; ${1:i}++) {\n    ${0}\n}',
    isSnippet: true,
    sortText: '03_for',
  },
  {
    label: 'while',
    kind: 27,
    detail: 'while loop condition',
    documentation: 'Standard while loop.',
    insertText: 'while (${1:condition}) {\n    ${0}\n}',
    isSnippet: true,
    sortText: '04_while',
  },
  {
    label: 'if',
    kind: 27,
    detail: 'if condition statement',
    documentation: 'Standard conditional statement.',
    insertText: 'if (${1:condition}) {\n    ${0}\n}',
    isSnippet: true,
    sortText: '05_if',
  },
  {
    label: 'ifelse',
    kind: 27,
    detail: 'if-else condition statement',
    documentation: 'Standard if-else branching.',
    insertText: 'if (${1:condition}) {\n    ${2}\n} else {\n    ${0}\n}',
    isSnippet: true,
    sortText: '06_ifelse',
  },
  {
    label: 'struct',
    kind: 27,
    detail: 'struct definition',
    documentation: 'Defines a C structure.',
    insertText: 'struct ${1:Name} {\n    ${0}\n};',
    isSnippet: true,
    sortText: '07_struct',
  },
  {
    label: 'typedef-struct',
    kind: 27,
    detail: 'typedef struct definition',
    documentation: 'Defines a typedef struct alias.',
    insertText: 'typedef struct {\n    ${0}\n} ${1:Name_t};',
    isSnippet: true,
    sortText: '08_typedef_struct',
  },
  {
    label: 'printf',
    kind: 27,
    detail: 'printf format string',
    documentation: 'Formatted print to standard output.',
    insertText: 'printf("${1:%s}\\n", ${2:arg});${0}',
    isSnippet: true,
    sortText: '09_printf',
  },
  {
    label: 'malloc',
    kind: 27,
    detail: 'malloc memory allocation with check',
    documentation: 'Allocates heap memory with a NULL validation guard.',
    insertText: '${1:int} *${2:ptr} = (${1:int} *)malloc(${3:size} * sizeof(${1:int}));\nif (!${2:ptr}) {\n    ${0:return -1;}\n}',
    isSnippet: true,
    sortText: '10_malloc',
  },
];

/**
 * =========================================================================
 * PHP Language Completions (Keywords, Common Functions, Snippets)
 * =========================================================================
 */
const PHP_KEYWORDS = [
  'abstract',
  'and',
  'array',
  'as',
  'break',
  'callable',
  'case',
  'catch',
  'class',
  'clone',
  'const',
  'continue',
  'declare',
  'default',
  'die',
  'do',
  'echo',
  'else',
  'elseif',
  'empty',
  'enddeclare',
  'endfor',
  'endforeach',
  'endif',
  'endswitch',
  'endwhile',
  'enum',
  'eval',
  'exit',
  'extends',
  'final',
  'finally',
  'fn',
  'for',
  'foreach',
  'function',
  'global',
  'goto',
  'if',
  'implements',
  'include',
  'include_once',
  'instanceof',
  'insteadof',
  'interface',
  'isset',
  'list',
  'match',
  'namespace',
  'new',
  'or',
  'print',
  'private',
  'protected',
  'public',
  'readonly',
  'require',
  'require_once',
  'return',
  'static',
  'switch',
  'throw',
  'trait',
  'try',
  'unset',
  'use',
  'var',
  'var_dump',
  'while',
  'xor',
  'yield',
  'true',
  'false',
  'null',
];

const PHP_BUILTIN_FUNCS: Array<{ name: string; signature: string; doc: string }> = [
  { name: 'json_encode', signature: 'string json_encode(mixed $value, int $flags = 0)', doc: 'Returns JSON representation of a value.' },
  { name: 'json_decode', signature: 'mixed json_decode(string $json, ?bool $associative = null)', doc: 'Decodes a JSON string.' },
  { name: 'count', signature: 'int count(Countable|array $value)', doc: 'Counts elements in an array or Countable.' },
  { name: 'in_array', signature: 'bool in_array(mixed $needle, array $haystack, bool $strict = false)', doc: 'Checks if value exists in an array.' },
  { name: 'array_merge', signature: 'array array_merge(array ...$arrays)', doc: 'Merges one or more arrays.' },
  { name: 'array_map', signature: 'array array_map(?callable $callback, array $array, array ...$arrays)', doc: 'Applies callback to elements of given arrays.' },
  { name: 'array_filter', signature: 'array array_filter(array $array, ?callable $callback = null)', doc: 'Filters elements using a callback.' },
  { name: 'explode', signature: 'array explode(string $separator, string $string, int $limit = PHP_INT_MAX)', doc: 'Splits a string by a string delimiter.' },
  { name: 'implode', signature: 'string implode(string $separator, array $array)', doc: 'Joins array elements with a glue string.' },
  { name: 'str_replace', signature: 'string|array str_replace(string|array $search, string|array $replace, string|array $subject)', doc: 'Replaces occurrences of search string.' },
  { name: 'str_contains', signature: 'bool str_contains(string $haystack, string $needle)', doc: 'Determines if a string contains given substring.' },
  { name: 'substr', signature: 'string substr(string $string, int $offset, ?int $length = null)', doc: 'Returns portion of a string.' },
  { name: 'strlen', signature: 'int strlen(string $string)', doc: 'Gets string length in bytes.' },
  { name: 'file_get_contents', signature: 'string|false file_get_contents(string $filename)', doc: 'Reads entire file into a string.' },
  { name: 'file_put_contents', signature: 'int|false file_put_contents(string $filename, mixed $data)', doc: 'Writes data to a file.' },
  { name: 'header', signature: 'void header(string $header, bool $replace = true, int $response_code = 0)', doc: 'Sends a raw HTTP header.' },
  { name: 'http_response_code', signature: 'int|bool http_response_code(int $response_code = 0)', doc: 'Gets or sets the HTTP response status code.' },
];

const PHP_SNIPPETS: CompletionDefinition[] = [
  {
    label: '<?php',
    kind: 27,
    detail: 'PHP opening tag with strict types',
    documentation: 'Standard modern PHP opening tag.',
    insertText: '<?php\n\ndeclare(strict_types=1);\n\n${0}',
    isSnippet: true,
    sortText: '00_php_tag',
  },
  {
    label: 'php',
    kind: 27,
    detail: '<?php opening tag',
    documentation: 'Opens PHP script.',
    insertText: '<?php\n\n${0}',
    isSnippet: true,
    sortText: '00_php',
  },
  {
    label: 'function',
    kind: 27,
    detail: 'function declaration',
    documentation: 'Defines a PHP function with typed parameters and return type.',
    insertText: 'function ${1:functionName}(${2:$params}): ${3:void}\n{\n    ${0}\n}',
    isSnippet: true,
    sortText: '01_func',
  },
  {
    label: 'func',
    kind: 27,
    detail: 'function declaration (shortcut)',
    documentation: 'Defines a PHP function.',
    insertText: 'function ${1:functionName}(${2:$params}): ${3:void}\n{\n    ${0}\n}',
    isSnippet: true,
    sortText: '01_func_short',
  },
  {
    label: 'pubf',
    kind: 27,
    detail: 'public function method declaration',
    documentation: 'Defines a public class method.',
    insertText: 'public function ${1:methodName}(${2:$param}): ${3:void}\n{\n    ${0}\n}',
    isSnippet: true,
    sortText: '02_pubf',
  },
  {
    label: 'prif',
    kind: 27,
    detail: 'private function method declaration',
    documentation: 'Defines a private class method.',
    insertText: 'private function ${1:methodName}(${2:$param}): ${3:void}\n{\n    ${0}\n}',
    isSnippet: true,
    sortText: '02_prif',
  },
  {
    label: 'class',
    kind: 27,
    detail: 'Class declaration with constructor promotion',
    documentation: 'Defines a modern PHP 8+ class.',
    insertText: 'class ${1:ClassName}\n{\n    public function __construct(\n        public ${2:string} $${3:name},\n    ) {\n    }\n\n    ${0}\n}',
    isSnippet: true,
    sortText: '03_class',
  },
  {
    label: 'foreach',
    kind: 27,
    detail: 'foreach loop ($items as $item)',
    documentation: 'Iterates over an array or iterable.',
    insertText: 'foreach (${1:$items} as ${2:$item}) {\n    ${0}\n}',
    isSnippet: true,
    sortText: '04_foreach',
  },
  {
    label: 'foreach-kv',
    kind: 27,
    detail: 'foreach loop with key/value ($items as $key => $value)',
    documentation: 'Iterates over keys and values.',
    insertText: 'foreach (${1:$items} as ${2:$key} => ${3:$value}) {\n    ${0}\n}',
    isSnippet: true,
    sortText: '04_foreach_kv',
  },
  {
    label: 'for',
    kind: 27,
    detail: 'for loop counter',
    documentation: 'Standard index for loop.',
    insertText: 'for ($${1:i} = 0; $${1:i} < ${2:count}; $${1:i}++) {\n    ${0}\n}',
    isSnippet: true,
    sortText: '05_for',
  },
  {
    label: 'if',
    kind: 27,
    detail: 'if condition statement',
    documentation: 'Standard conditional statement.',
    insertText: 'if (${1:condition}) {\n    ${0}\n}',
    isSnippet: true,
    sortText: '06_if',
  },
  {
    label: 'ifelse',
    kind: 27,
    detail: 'if-else condition statement',
    documentation: 'Branching if-else block.',
    insertText: 'if (${1:condition}) {\n    ${2}\n} else {\n    ${0}\n}',
    isSnippet: true,
    sortText: '06_ifelse',
  },
  {
    label: 'trycatch',
    kind: 27,
    detail: 'try-catch block with Throwable',
    documentation: 'Catches any Throwable exception.',
    insertText: 'try {\n    ${1}\n} catch (\\Throwable $e) {\n    ${0:// Handle error}\n}',
    isSnippet: true,
    sortText: '07_trycatch',
  },
  {
    label: 'echo',
    kind: 27,
    detail: 'echo output statement',
    documentation: 'Outputs one or more strings.',
    insertText: 'echo ${1:$var};${0}',
    isSnippet: true,
    sortText: '08_echo',
  },
  {
    label: 'json-api',
    kind: 27,
    detail: 'JSON API response header and exit',
    documentation: 'Sends JSON response header, encodes array and exits.',
    insertText: 'header("Content-Type: application/json; charset=utf-8");\necho json_encode([\n    "success" => true,\n    "data" => ${1:[]},\n]);\nexit;${0}',
    isSnippet: true,
    sortText: '09_json_api',
  },
];

/**
 * =========================================================================
 * Bash / Shell Scripting Completions
 * =========================================================================
 */
const SHELL_SNIPPETS: CompletionDefinition[] = [
  {
    label: 'shebang',
    kind: 27,
    detail: 'Bash script header with strict error handling',
    documentation: 'Standard Bash shebang with set -euo pipefail for robust scripting.',
    insertText: '#!/usr/bin/env bash\nset -euo pipefail\n\n${0}',
    isSnippet: true,
    sortText: '01_shebang',
  },
  {
    label: 'func',
    kind: 27,
    detail: 'Function definition with local variables',
    documentation: 'Defines a Bash function with local arguments.',
    insertText: '${1:function_name}() {\n  local ${2:arg1}="\${1:-}"\n  ${0:# implementation}\n}',
    isSnippet: true,
    sortText: '02_func',
  },
  {
    label: 'if',
    kind: 27,
    detail: 'If condition block',
    documentation: 'Standard bash [[ ... ]] conditional expression.',
    insertText: 'if [[ ${1:condition} ]]; then\n  ${0:# code}\nfi',
    isSnippet: true,
    sortText: '03_if',
  },
  {
    label: 'ifelse',
    kind: 27,
    detail: 'If-Else condition block',
    documentation: 'Standard bash if-else conditional block.',
    insertText: 'if [[ ${1:condition} ]]; then\n  ${2:# code}\nelse\n  ${0:# fallback}\nfi',
    isSnippet: true,
    sortText: '04_ifelse',
  },
  {
    label: 'for-in',
    kind: 27,
    detail: 'For-in loop iterating over array elements',
    documentation: 'Iterates safely over array elements in bash.',
    insertText: 'for ${1:item} in "\${${2:items}[@]}"; do\n  ${0:echo "$${1:item}"}\ndone',
    isSnippet: true,
    sortText: '05_for_in',
  },
  {
    label: 'while-read',
    kind: 27,
    detail: 'While read loop for line-by-line reading',
    documentation: 'Safely reads input or files line by line using IFS= read -r.',
    insertText: 'while IFS= read -r ${1:line}; do\n  ${0:echo "$${1:line}"}\ndone < "${2:filename.txt}"',
    isSnippet: true,
    sortText: '06_while_read',
  },
  {
    label: 'case',
    kind: 27,
    detail: 'Case pattern matching block',
    documentation: 'Bash case/esac pattern matching statement.',
    insertText: 'case "${1:\$var}" in\n  ${2:pattern})\n    ${3:# code}\n    ;;\n  *)\n    ${0:# default}\n    ;;\nesac',
    isSnippet: true,
    sortText: '07_case',
  },
  {
    label: 'file-exists',
    kind: 27,
    detail: 'Check if file exists (-f)',
    documentation: 'Conditional check for file existence.',
    insertText: 'if [[ -f "${1:filepath}" ]]; then\n  ${0:# file exists}\nfi',
    isSnippet: true,
    sortText: '08_file_exists',
  },
  {
    label: 'dir-exists',
    kind: 27,
    detail: 'Check if directory exists (-d)',
    documentation: 'Conditional check for directory existence.',
    insertText: 'if [[ -d "${1:dirpath}" ]]; then\n  ${0:# directory exists}\nfi',
    isSnippet: true,
    sortText: '09_dir_exists',
  },
  {
    label: 'script-dir',
    kind: 27,
    detail: 'Get directory of current script',
    documentation: 'Resolves the absolute directory path where the current bash script resides.',
    insertText: 'SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"\n${0}',
    isSnippet: true,
    sortText: '10_script_dir',
  },
];

/**
 * =========================================================================
 * Python Completions
 * =========================================================================
 */
const PYTHON_SNIPPETS: CompletionDefinition[] = [
  {
    label: 'ifmain',
    kind: 27,
    detail: "if __name__ == '__main__': entry point",
    documentation: 'Standard Python main execution entry point guard.',
    insertText: "if __name__ == '__main__':\n    ${1:main()}${0}",
    isSnippet: true,
    sortText: '01_ifmain',
  },
  {
    label: 'def',
    kind: 27,
    detail: 'Function definition',
    documentation: 'Defines a Python function with docstring and type hints.',
    insertText: 'def ${1:function_name}(${2:args}) -> ${3:None}:\n    """${4:Description}"""\n    ${0:pass}',
    isSnippet: true,
    sortText: '02_def',
  },
  {
    label: 'def-async',
    kind: 27,
    detail: 'Async function definition',
    documentation: 'Defines an asynchronous Python coroutine function.',
    insertText: 'async def ${1:function_name}(${2:args}) -> ${3:None}:\n    """${4:Description}"""\n    ${0:pass}',
    isSnippet: true,
    sortText: '03_def_async',
  },
  {
    label: 'class',
    kind: 27,
    detail: 'Class definition with __init__',
    documentation: 'Defines a standard Python class with initializer.',
    insertText: 'class ${1:ClassName}:\n    """${2:Class docstring}"""\n\n    def __init__(self, ${3:args}) -> None:\n        ${0:pass}',
    isSnippet: true,
    sortText: '04_class',
  },
  {
    label: 'try-except',
    kind: 27,
    detail: 'Try-Except error handling block',
    documentation: 'Python try/except/finally exception handling structure.',
    insertText: 'try:\n    ${1:pass}\nexcept ${2:Exception} as e:\n    ${0:print(f"Error: {e}")}',
    isSnippet: true,
    sortText: '05_try_except',
  },
  {
    label: 'with-open',
    kind: 27,
    detail: 'Safe file handling with context manager',
    documentation: 'Opens a file safely using context manager.',
    insertText: 'with open("${1:filename.txt}", "${2:r}", encoding="utf-8") as ${3:f}:\n    ${0:content = f.read()}',
    isSnippet: true,
    sortText: '06_with_open',
  },
];

/**
 * =========================================================================
 * TypeScript / JavaScript Completions
 * =========================================================================
 */
const TS_JS_SNIPPETS: CompletionDefinition[] = [
  {
    label: 'afn',
    kind: 27,
    detail: 'Async function declaration',
    documentation: 'Defines an asynchronous function returning a Promise.',
    insertText: 'async function ${1:functionName}(${2:params}): Promise<${3:void}> {\n  ${0}\n}',
    isSnippet: true,
    sortText: '01_afn',
  },
  {
    label: 'arrow',
    kind: 27,
    detail: 'Const arrow function',
    documentation: 'Defines an arrow function assigned to a const variable.',
    insertText: 'const ${1:functionName} = (${2:params}) => {\n  ${0}\n};',
    isSnippet: true,
    sortText: '02_arrow',
  },
  {
    label: 'try-catch-ts',
    kind: 27,
    detail: 'Try-Catch block',
    documentation: 'Standard try/catch error handling block.',
    insertText: 'try {\n  ${1}\n} catch (error) {\n  console.error(${0:error});\n}',
    isSnippet: true,
    sortText: '03_try_catch_ts',
  },
  {
    label: 'fetch-json',
    kind: 27,
    detail: 'Fetch API JSON call',
    documentation: 'Performs an async fetch request parsing JSON response.',
    insertText: 'const response = await fetch("${1:https://api.example.com/data}", {\n  headers: { "Content-Type": "application/json" },\n});\nconst data = await response.json();\n${0}',
    isSnippet: true,
    sortText: '04_fetch_json',
  },
];

/**
 * Builds Monaco CompletionItems from keywords, functions, and snippets.
 */
function createLanguageItems(
  monaco: typeof MonacoType,
  keywords: string[],
  funcs: Array<{ name: string; signature: string; doc: string }>,
  snippets: CompletionDefinition[],
  range: MonacoType.IRange
): MonacoType.languages.CompletionItem[] {
  const items: MonacoType.languages.CompletionItem[] = [];

  // 1. Snippets (top priority)
  for (const s of snippets) {
    items.push({
      label: s.label,
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: s.detail,
      documentation: s.documentation,
      insertText: s.insertText,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      sortText: s.sortText || `00_${s.label}`,
      range,
    });
  }

  // 2. Standard Functions
  for (const f of funcs) {
    items.push({
      label: f.name,
      kind: monaco.languages.CompletionItemKind.Function,
      detail: f.signature,
      documentation: f.doc,
      insertText: `${f.name}(\${1})`,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      sortText: `10_${f.name}`,
      range,
    });
  }

  // 3. Keywords
  for (const kw of keywords) {
    items.push({
      label: kw,
      kind: monaco.languages.CompletionItemKind.Keyword,
      detail: `Keyword: ${kw}`,
      documentation: `Standard language keyword '${kw}'.`,
      insertText: kw,
      sortText: `20_${kw}`,
      range,
    });
  }

  return items;
}

/**
 * Registers completion providers, hover providers, and signature help for a language.
 */
function registerLanguageSupport(
  monaco: typeof MonacoType,
  languageId: string,
  keywords: string[],
  funcs: Array<{ name: string; signature: string; doc: string }>,
  snippets: CompletionDefinition[]
): void {
  // Completion Items
  monaco.languages.registerCompletionItemProvider(languageId, {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range: MonacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = createLanguageItems(monaco, keywords, funcs, snippets, range);
      return { suggestions };
    },
  });

  // Hover Provider (Displays signatures and docs on mouse hover)
  if (funcs.length > 0 || keywords.length > 0) {
    const funcMap = new Map(funcs.map((f) => [f.name, f]));
    const kwSet = new Set(keywords);

    monaco.languages.registerHoverProvider(languageId, {
      provideHover: (model, position) => {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const func = funcMap.get(word.word);
        if (func) {
          return {
            range: new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn
            ),
            contents: [
              { value: `\`\`\`${languageId}\n${func.signature}\n\`\`\`` },
              { value: func.doc },
            ],
          };
        }

        if (kwSet.has(word.word)) {
          return {
            range: new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn
            ),
            contents: [{ value: `**${languageId} keyword**: \`${word.word}\`` }],
          };
        }

        return null;
      },
    });
  }

  // Signature Help Provider (Displays parameter popup when typing function name and '(')
  if (funcs.length > 0) {
    const funcMap = new Map(funcs.map((f) => [f.name, f]));

    monaco.languages.registerSignatureHelpProvider(languageId, {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: (model, position) => {
        const lineContent = model.getLineContent(position.lineNumber);
        const textBefore = lineContent.substring(0, position.column - 1);
        const match = textBefore.match(/([a-zA-Z_]\w*)\s*\([^()]*$/);
        if (!match) return null;

        const fnName = match[1];
        const func = funcMap.get(fnName);
        if (!func) return null;

        return {
          value: {
            signatures: [
              {
                label: func.signature,
                documentation: func.doc,
                parameters: [],
              },
            ],
            activeSignature: 0,
            activeParameter: 0,
          },
          dispose: () => {},
        };
      },
    });
  }
}

let allSnippetsRegistered = false;

/**
 * Registers all built-in completions, snippets, hover, and signature help across all languages.
 */
export function registerAllLanguageSnippets(monaco: typeof MonacoType): void {
  if (allSnippetsRegistered) {
    return;
  }
  allSnippetsRegistered = true;

  // C and C++
  registerLanguageSupport(monaco, 'c', C_KEYWORDS, C_STDLIB_FUNCS, C_SNIPPETS);
  registerLanguageSupport(monaco, 'cpp', C_KEYWORDS, C_STDLIB_FUNCS, C_SNIPPETS);

  // PHP
  registerLanguageSupport(monaco, 'php', PHP_KEYWORDS, PHP_BUILTIN_FUNCS, PHP_SNIPPETS);

  // Bash / Shell
  registerLanguageSupport(monaco, 'shell', [], [], SHELL_SNIPPETS);

  // Python
  registerLanguageSupport(monaco, 'python', [], [], PYTHON_SNIPPETS);

  // TypeScript and JavaScript
  registerLanguageSupport(monaco, 'typescript', [], [], TS_JS_SNIPPETS);
  registerLanguageSupport(monaco, 'javascript', [], [], TS_JS_SNIPPETS);
}
