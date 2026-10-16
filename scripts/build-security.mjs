import { build } from 'vite';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = process.argv[2] ? [process.argv[2]] : ['detector', 'agent-security'];
for (const name of names) {
  if (!['detector', 'agent-security'].includes(name)) throw new Error('Unknown package');
  const base = resolve(root, 'packages', name);
  const configFile = ts.readConfigFile(resolve(base, 'tsconfig.json'), ts.sys.readFile);
  if (configFile.error) throw new Error('Invalid TypeScript config');
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, base);
  const program = ts.createProgram(config.fileNames, config.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    process.stderr.write(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: (f) => f,
        getNewLine: () => '\n',
      }),
    );
    process.exitCode = 1;
    break;
  }
  const emitted = program.emit();
  if (emitted.emitSkipped) throw new Error('Declaration emit failed');
  // Source uses bundler resolution; distributed ESM types must also support NodeNext.
  function rewriteDeclarations(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        rewriteDeclarations(file);
        continue;
      }
      if (!entry.name.endsWith('.d.ts')) continue;
      const text = readFileSync(file, 'utf8');
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const edits = [];
      function visit(node) {
        if (
          ts.isStringLiteral(node) &&
          node.text.startsWith('.') &&
          (ts.isImportDeclaration(node.parent) ||
            ts.isExportDeclaration(node.parent) ||
            ts.isLiteralTypeNode(node.parent))
        ) {
          const base = resolve(dirname(file), node.text);
          const suffix = existsSync(base + '.d.ts')
            ? '.js'
            : existsSync(resolve(base, 'index.d.ts'))
              ? '/index.js'
              : '';
          if (suffix)
            edits.push({
              start: node.getStart(source) + 1,
              end: node.getEnd() - 1,
              value: node.text + suffix,
            });
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      let output = text;
      for (const edit of edits.sort((a, b) => b.start - a.start))
        output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
      writeFileSync(file, output);
    }
  }
  rewriteDeclarations(resolve(base, 'dist/types'));
  await build({
    configFile: false,
    root,
    build: {
      outDir: resolve(base, 'dist'),
      emptyOutDir: false,
      lib: {
        entry: resolve(base, 'src/index.ts'),
        formats: ['es'],
        fileName: () => 'index.js',
      },
      minify: false,
      sourcemap: false,
      rolldownOptions: { external: (id) => id.startsWith('node:') },
    },
  });
}
