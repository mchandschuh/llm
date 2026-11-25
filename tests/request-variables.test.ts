import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmFailure } from '../src/errors.js';
import { substituteRequestAssets, substituteRequestVariables } from '../src/request-variables.js';

const parameters = {
  audience: 'engineering',
  filters: { owner: 'michael' },
  sections: [{ title: 'Status' }],
  metadata: { region: 'us-east-1' },
  text: 'dollars $ and "quotes"\n雪',
  values: ['one', 2],
};

function assertVariableFailure(operation: () => unknown, message: RegExp): void {
  assert.throws(operation, (error: unknown) => {
    assert.equal(error instanceof LlmFailure, true);
    assert.equal((error as LlmFailure).code, 'CONFIGURATION_INVALID');
    assert.equal((error as LlmFailure).phase, 'configuration');
    assert.match((error as Error).message, message);
    assert.ok((error as Error).message.length <= 500);
    return true;
  });
}

test('WI-0017-10000000_TC-EXACT-SYNTAX replaces exact placeholders and nested paths only', () => {
  assert.equal(
    substituteRequestVariables('Hello $${audience}$$ owned by $${filters.owner}$$ / $${sections[0].title}$$.', parameters),
    'Hello engineering owned by michael / Status.',
  );
  assert.equal(substituteRequestVariables('Near misses: ${audience}, $${audience}, $${audience}$, and $$$${audience}$$.', parameters), 'Near misses: ${audience}, $${audience}, $${audience}$, and $$$${audience}$$.');
});

test('WI-0017-10000000_TC-VALUE-SERIALIZATION serializes complex and special values safely', () => {
  assert.equal(substituteRequestVariables('$${filters}$$', parameters), '{"owner":"michael"}');
  assert.equal(substituteRequestVariables('$${values}$$', parameters), '["one",2]');
  assert.equal(substituteRequestVariables('$${text}$$', parameters), 'dollars $ and "quotes"\n雪');
  assert.equal(substituteRequestVariables('repeat $${audience}$$ / $${audience}$$', parameters), 'repeat engineering / engineering');
});

test('WI-0017-10000000_TC-COMPLETE-ASSET-PASS substitutes every asset source consistently', () => {
  const assets = substituteRequestAssets({
    prompt: 'Report for $${audience}$$',
    system: 'Owner: $${filters.owner}$$',
    task: '{"title":"$${sections[0].title}$$"}',
    output: '{"region":"$${metadata[region]}$$"}',
  }, parameters);
  assert.deepEqual(assets, {
    prompt: 'Report for engineering',
    system: 'Owner: michael',
    task: '{"title":"Status"}',
    output: '{"region":"us-east-1"}',
  });
});

test('WI-0017-10000000_TC-MISSING-VALUES fails boundedly before unresolved placeholders can remain', () => {
  assertVariableFailure(() => substituteRequestVariables('$${missing}$$', parameters), /missing.*not defined/u);
  assertVariableFailure(() => substituteRequestVariables('$${filters.missing}$$', parameters), /filters\.missing.*not defined/u);
  assertVariableFailure(() => substituteRequestVariables('$${sections[3].title}$$', parameters), /sections\[3\].title.*not defined/u);
  assertVariableFailure(() => substituteRequestVariables('$${filters[bad path]}$$', parameters), /invalid path/u);
});