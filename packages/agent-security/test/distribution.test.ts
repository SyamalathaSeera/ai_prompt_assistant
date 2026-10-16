import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
describe('standalone built distributions', () => {
  it.each(['agent-security', 'detector'])(
    'exports usable JavaScript and self-contained declarations for %s',
    (name) => {
      const base = resolve(root, 'packages', name);
      const pkg = JSON.parse(readFileSync(resolve(base, 'package.json'), 'utf8')) as {
        exports: { '.': { types: string; import: string } };
      };
      expect(existsSync(resolve(base, pkg.exports['.'].types))).toBe(true);
      const program =
        name === 'agent-security'
          ? `import { createAgentSecurity } from '@ai-prompt-assistant/agent-security'; const core = createAgentSecurity({ tools: [] }); const result = await core.run({ tenantId: 't', principalId: 'p', runId: 'r' }).execute('unknown', {}); console.log(result.code === 'UNKNOWN_TOOL');`
          : `import { detect, ALL_RULES } from '@ai-prompt-assistant/detector'; console.log(detect('ordinary prose').length === 0 && ALL_RULES.length > 0);`;
      const output = execFileSync(
        process.execPath,
        ['--input-type=module', '--eval', program],
        { cwd: base, encoding: 'utf8' },
      );
      expect(output.trim()).toBe('true');
      const js = readFileSync(resolve(base, pkg.exports['.'].import), 'utf8');
      expect(/from ["'](?:\.\.\/|wxt|@\/|langchain|langgraph|langsmith)/.test(js)).toBe(
        false,
      );
    },
  );
});

describe('NodeNext consumers', () => {
  it.each(['detector', 'agent-security'])(
    'typechecks a normal Node ESM consumer of %s',
    (name) => {
      const virtual = resolve(root, 'packages', name, 'consumer.mts');
      const content =
        name === 'agent-security'
          ? "import { createAgentSecurity, type BindingPolicy } from '@ai-prompt-assistant/agent-security'; const policy: BindingPolicy = { grants: [] }; const run = createAgentSecurity({ tools: [] }).run({ tenantId: 't', principalId: 'p', runId: 'r' }); run.bind('synthetic', policy);"
          : "import { detect, type Finding } from '@ai-prompt-assistant/detector'; const result: Finding[] = detect('ordinary prose');";
      const options: ts.CompilerOptions = {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
        strict: true,
        noEmit: true,
        types: ['node'],
        lib: ['lib.es2022.d.ts'],
      };
      const host = ts.createCompilerHost(options);
      const readFile = host.readFile.bind(host);
      const fileExists = host.fileExists.bind(host);
      host.readFile = (path) => (resolve(path) === virtual ? content : readFile(path));
      host.fileExists = (path) => resolve(path) === virtual || fileExists(path);
      const program = ts.createProgram([virtual], options, host);
      expect(ts.getPreEmitDiagnostics(program).map((d) => d.code)).toEqual([]);
    },
  );
});
