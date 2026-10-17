import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
function files(directory: string, extension: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory())
      return ['dist', 'node_modules'].includes(entry.name) ? [] : files(path, extension);
    return path.endsWith(extension) || (extension === '.ts' && path.endsWith('.tsx'))
      ? [path]
      : [];
  });
}
function imports(path: string): { specifier: string; dynamic: boolean }[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const result: { specifier: string; dynamic: boolean }[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      result.push({
        specifier: ts.isStringLiteralLike(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : '',
        dynamic: !ts.isStringLiteralLike(node.moduleSpecifier),
      });
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const arg = node.arguments[0];
      result.push({
        specifier: arg && ts.isStringLiteralLike(arg) ? arg.text : '',
        dynamic: !arg || !ts.isStringLiteralLike(arg),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
const framework = /(?:langchain|langgraph|langsmith)/i;

describe('extension and SDK import boundaries', () => {
  it('confines LangChain, LangGraph and LangSmith dependencies to the example package', () => {
    for (const name of [
      'package.json',
      'packages/agent-security/package.json',
      'packages/detector/package.json',
    ]) {
      const manifest = JSON.parse(readFileSync(resolve(root, name), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(
        Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(
          (name) => framework.test(name),
        ),
      ).toEqual([]);
    }
    const demo = JSON.parse(
      readFileSync(resolve(root, 'examples/langgraph/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(
      ['@langchain/core', '@langchain/langgraph', 'langsmith'].every((name) =>
        Object.hasOwn(demo.dependencies, name),
      ),
    ).toBe(true);
  });

  it('keeps every extension runtime source independent of packages and Node', () => {
    const violations: string[] = [];
    const runtime = ['entrypoints', 'components', 'lib']
      .flatMap((p) => files(resolve(root, p), '.ts'))
      .filter((p) => !/\.test\.tsx?$/.test(p));
    for (const path of runtime)
      for (const entry of imports(path)) {
        const spec = entry.specifier;
        const target = spec.startsWith('@/')
          ? resolve(root, spec.slice(2))
          : spec.startsWith('.')
            ? resolve(dirname(path), spec)
            : '';
        if (
          entry.dynamic ||
          framework.test(spec) ||
          spec.startsWith('node:') ||
          spec.startsWith('@ai-prompt-assistant/') ||
          (target &&
            /^(?:packages|examples)\//.test(relative(root, target).replaceAll('\\', '/')))
        ) {
          violations.push(`${relative(root, path)}: forbidden import`);
        }
      }
    expect(violations).toEqual([]);
  });

  it('keeps SDK runtime imports local or within the small Node builtin allowlist', () => {
    const violations: string[] = [];
    const allowed = new Set([
      'node:crypto',
      'node:buffer',
      'node:perf_hooks',
      'node:util',
    ]);
    for (const path of files(resolve(root, 'packages/agent-security/src'), '.ts'))
      for (const entry of imports(path)) {
        if (
          entry.dynamic ||
          entry.specifier.includes('/examples/') ||
          (!entry.specifier.startsWith('.') && !allowed.has(entry.specifier))
        )
          violations.push(relative(root, path));
      }
    expect(violations).toEqual([]);
  });

  it('keeps the detector facade and original source free of I/O dependencies', () => {
    const violations: string[] = [];
    for (const path of [
      ...files(resolve(root, 'packages/detector/src'), '.ts'),
      ...files(resolve(root, 'lib/detector'), '.ts'),
    ].filter((p) => !p.endsWith('.test.ts'))) {
      for (const entry of imports(path)) {
        const resolved = resolve(dirname(path), entry.specifier);
        const local = relative(root, resolved).replaceAll('\\', '/');
        if (
          entry.dynamic ||
          !entry.specifier.startsWith('.') ||
          !(
            local.startsWith('lib/detector/') ||
            local.startsWith('packages/detector/src/')
          )
        )
          violations.push(relative(root, path));
      }
    }
    expect(violations).toEqual([]);
  });

  it('adds no SDK or agent framework runtime dependency to the extension', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['preact']);
    for (const name of ['detector', 'agent-security']) {
      const package_ = JSON.parse(
        readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8'),
      ) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      expect(package_.dependencies ?? {}).toEqual({});
      expect(package_.optionalDependencies ?? {}).toEqual({});
    }
  });
});

for (const target of ['chrome-mv3', 'firefox-mv2']) {
  const js = files(resolve(root, '.output', target), '.js');
  describe.skipIf(js.length === 0)(`${target} emitted dependency boundary`, () => {
    it('contains no SDK, Node builtin, or agent-framework code in any emitted JavaScript', () => {
      const violations = js
        .filter((path) =>
          /APA_SECRET_|createAgentSecurity|node:(?:crypto|buffer|perf_hooks|util)|langchain|langgraph|langsmith/i.test(
            readFileSync(path, 'utf8'),
          ),
        )
        .map((p) => relative(root, p));
      expect(violations).toEqual([]);
    });
  });
}
