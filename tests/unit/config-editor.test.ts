import { describe, it, expect } from 'vitest';
import { Document } from 'yaml';
import {
  applyConfigEdits,
  applyEditsToDocument,
  coerceFieldValue,
  fieldCategory,
  redactSecrets,
  resetAllEdits,
  walkConfigFields,
} from '../../src/app/config-editor.js';

const defaults = {
  server: {
    apiKey: 'default-key',
    enableWebSearch: false,
    port: 3003,
    instructions: { fallback: 'Be concise.' },
  },
  conversations: { enableSync: false },
};

describe('walkConfigFields', () => {
  it('marks overrides and hides secret values', () => {
    const fields = walkConfigFields(defaults, {
      server: { apiKey: 'real-secret', enableWebSearch: true },
    });
    const key = fields.find((f) => f.path === 'server.apiKey');
    const search = fields.find((f) => f.path === 'server.enableWebSearch');
    expect(key?.kind).toBe('secret');
    expect(key?.value).toBeNull();
    expect(key?.overridden).toBe(true);
    expect(search?.value).toBe(true);
    expect(search?.overridden).toBe(true);
  });

  it('exposes dropdown choices for enums', () => {
    const fields = walkConfigFields({
      auth: { method: 'browser' },
      log: { level: 'info' },
      server: { reasoning: { default: 'none' } },
    }, {});
    expect(fields.find((f) => f.path === 'auth.method')?.choices).toEqual(['login', 'browser', 'rclone']);
    expect(fields.find((f) => f.path === 'log.level')?.choices).toContain('debug');
    expect(fields.find((f) => f.path === 'server.reasoning.default')?.kind).toBe('choice');
  });

  it('puts everyday knobs, prompts, and glue in sidebar categories', () => {
    const fields = walkConfigFields({
      server: {
        enableWebSearch: false,
        allowedModels: ['lumo'],
        instructions: { forTools: 'protocol', template: '{{tools}}' },
      },
    }, {});
    expect(fields.find((f) => f.path === 'server.allowedModels')?.kind).toBe('stringList');
    expect(fields.find((f) => f.path === 'server.enableWebSearch')?.hint).toMatch(/web_search/i);
    expect(fields.find((f) => f.path === 'server.enableWebSearch')?.label).toMatch(/web search/i);
    expect(fields.find((f) => f.path === 'server.enableWebSearch')?.category).toBe('tools');
    expect(fields.find((f) => f.path === 'server.instructions.forTools')?.category).toBe('prompts');
    expect(fields.find((f) => f.path === 'server.instructions.template')?.category).toBe('expert');
    expect(fieldCategory('cli.instructions.forLocalActions')).toBe('cli');
    expect(fieldCategory('cli.instructions.template')).toBe('expert');
  });

  it('aliases CLI injectInto copy and keeps a distinct label', () => {
    const fields = walkConfigFields({
      server: { instructions: { injectInto: 'last' } },
      cli: { instructions: { injectInto: 'first' } },
    }, {});
    const server = fields.find((f) => f.path === 'server.instructions.injectInto');
    const cli = fields.find((f) => f.path === 'cli.instructions.injectInto');
    expect(cli?.label).toMatch(/^CLI:/);
    expect(cli?.more).toBe(server?.more);
    expect(cli?.choices).toEqual(server?.choices);
  });

  it('ships extraModels as one array with four lite/max combos', () => {
    const fields = walkConfigFields({
      server: { extraModels: [] },
    }, {});
    const extra = fields.find((f) => f.path === 'server.extraModels');
    expect(extra?.kind).toBe('json');
    expect(extra?.examples).toHaveLength(1);
    expect(extra?.examples?.[0]?.label).toMatch(/four aliases/i);
    const value = extra?.examples?.[0]?.value ?? '';
    expect(value).toMatch(/lumo-lite-fast/);
    expect(value).toMatch(/lumo-lite-thinking/);
    expect(value).toMatch(/lumo-max-fast/);
    expect(value).toMatch(/lumo-max-thinking/);
    expect(JSON.parse(value)).toHaveLength(4);
    expect(extra?.more).toMatch(/same array/i);
  });
});

describe('redactSecrets', () => {
  it('strips server.apiKey', () => {
    const redacted = redactSecrets({
      server: { apiKey: 'real-secret', port: 3003 },
    });
    expect(redacted.server.apiKey).toBeNull();
    expect(redacted.server.port).toBe(3003);
  });
});

describe('applyConfigEdits', () => {
  it('writes overrides and ignores empty secret', () => {
    const next = applyConfigEdits(
      { server: { apiKey: 'keep-me' } },
      defaults,
      {
        changes: {
          'server.enableWebSearch': true,
          'server.apiKey': '',
        },
      },
    );
    expect(next).toEqual({
      server: { apiKey: 'keep-me', enableWebSearch: true },
    });
  });

  it('resets a path and drops empty parents', () => {
    const next = applyConfigEdits(
      { conversations: { enableSync: true } },
      defaults,
      { resets: ['conversations.enableSync'] },
    );
    expect(next).toEqual({});
  });

  it('rejects unknown paths', () => {
    expect(() => applyConfigEdits({}, defaults, { changes: { 'server.nope': true } }))
      .toThrow(/Unknown config path/);
  });

  it('resetAllEdits keeps the API key path out of resets', () => {
    const edits = resetAllEdits(defaults);
    expect(edits.resets).toContain('server.port');
    expect(edits.resets).not.toContain('server.apiKey');
    const next = applyConfigEdits(
      { server: { apiKey: 'keep-me', port: 9999, enableWebSearch: true } },
      defaults,
      edits,
    );
    expect(next).toEqual({ server: { apiKey: 'keep-me' } });
  });

  it('skips reset paths that are not in the YAML document', () => {
    const doc = new Document({ server: { apiKey: 'keep-me', port: 9999 } });
    applyEditsToDocument(doc, defaults, {
      resets: ['server.enableWebSearch', 'server.port', 'conversations.enableSync'],
    });
    expect(doc.toJS()).toEqual({ server: { apiKey: 'keep-me' } });
  });

  it('parses comma-separated model lists', () => {
    expect(coerceFieldValue('server.allowedModels', ['lumo'], 'lumo, lumo-max')).toEqual(['lumo', 'lumo-max']);
  });
});
