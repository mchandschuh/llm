import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJsonSchemaRegistry } from 'schema-validate';
import { LlmFailure } from '../src/errors.js';
import { constructRequestParameters, type RequestParameterAssignment } from '../src/request-parameters.js';

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.test/request-parameters/v1',
  type: 'object',
  additionalProperties: false,
  required: ['audience', 'filters', 'sections', 'metadata'],
  properties: {
    audience: { type: 'string', enum: ['engineering', 'public'] },
    enabled: { type: 'boolean' },
    retries: { type: 'integer', minimum: 0, maximum: 5 },
    filters: {
      type: 'object',
      additionalProperties: false,
      required: ['owner'],
      properties: { owner: { type: 'string' } },
    },
    sections: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: { title: { type: 'string' } },
      },
    },
    metadata: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
  },
} as const;

function assignments(values: readonly [string, string][]): readonly RequestParameterAssignment[] {
  return values.map(([path, value]) => ({ path, value }));
}

function assertParameterFailure(operation: () => unknown, message: RegExp): void {
  assert.throws(operation, (error: unknown) => {
    assert.equal(error instanceof LlmFailure, true);
    assert.equal((error as LlmFailure).code, 'CONFIGURATION_INVALID');
    assert.equal((error as LlmFailure).phase, 'configuration');
    assert.match((error as Error).message, message);
    assert.ok((error as Error).message.length <= 500);
    return true;
  });
}

test('WI-0016-10000000_TC-ROOT-PROPERTIES constructs typed roots and rejects unknown or reserved roots', () => {
  const result = constructRequestParameters({
    schema,
    defaults: { audience: 'engineering', filters: { owner: 'default' }, sections: [{ title: 'Default' }], metadata: {} },
    assignments: assignments([
      ['enabled', 'true'],
      ['retries', '3'],
      ['audience', 'public'],
      ['filters.owner', 'michael'],
      ['sections[0].title', 'Overview'],
    ]),
  });
  assert.deepEqual(result, {
    audience: 'public',
    enabled: true,
    retries: 3,
    filters: { owner: 'michael' },
    sections: [{ title: 'Overview' }],
    metadata: {},
  });
  assertParameterFailure(() => constructRequestParameters({ schema, assignments: assignments([['unknown', 'value']]) }), /not allowed/u);
  assertParameterFailure(() => constructRequestParameters({ schema, assignments: assignments([['parameter', 'value']]) }), /reserved root/u);
});

test('WI-0016-10000000_TC-NESTED-PATHS updates objects, arrays, maps, and object-valued assignments without conflicts', () => {
  const result = constructRequestParameters({
    schema,
    parameters: '{"audience":"engineering","filters":{"owner":"michael"},"sections":[{"title":"One"}],"metadata":{"region":"us"}}',
    assignments: assignments([
      ['sections[0].title', 'Status'],
      ['metadata[environment]', 'test'],
    ]),
  });
  assert.deepEqual(result, {
    audience: 'engineering',
    filters: { owner: 'michael' },
    sections: [{ title: 'Status' }],
    metadata: { region: 'us', environment: 'test' },
  });
  const objectValue = constructRequestParameters({
    schema,
    parameters: { audience: 'engineering', filters: { owner: 'michael' }, sections: [{ title: 'One' }], metadata: {} },
    assignments: assignments([['filters', '{"owner":"public"}']]),
  });
  assert.deepEqual(objectValue.filters, { owner: 'public' });
  assertParameterFailure(() => constructRequestParameters({ schema, assignments: assignments([['sections[2].title', 'Sparse']]) }), /sparse|invalid array index/u);
  assertParameterFailure(() => constructRequestParameters({ schema, assignments: assignments([['filters', '{"owner":"x"}'], ['filters.owner', 'michael']]) }), /conflict/u);
  assertParameterFailure(() => constructRequestParameters({ schema, assignments: assignments([['audience', 'one'], ['audience', 'two']]) }), /duplicated/u);
});

test('WI-0016-10000000_TC-FULL-OBJECT accepts full JSON and applies documented precedence', () => {
  const result = constructRequestParameters({
    schema,
    defaults: { audience: 'engineering', filters: { owner: 'default' }, sections: [{ title: 'Default' }], metadata: {} },
    parameters: '{"audience":"engineering","filters":{"owner":"full"},"sections":[{"title":"Full"}],"metadata":{}}',
    assignments: assignments([['audience', 'public'], ['filters.owner', 'michael']]),
  });
  assert.deepEqual(result, {
    audience: 'public',
    filters: { owner: 'michael' },
    sections: [{ title: 'Full' }],
    metadata: {},
  });
  assertParameterFailure(() => constructRequestParameters({ schema, parameters: '{' }), /--parameters.*valid JSON/u);
  assertParameterFailure(() => constructRequestParameters({ schema, parameters: '[]' }), /--parameters.*JSON object/u);
  assertParameterFailure(() => constructRequestParameters({ schema, parameters: { audience: 'engineering', filters: { owner: 'full' }, sections: [{ title: 'Full' }], metadata: {} }, assignments: assignments([['filters', 'x']]) }), /valid JSON/u);
});

test('WI-0016-10000000_TC-SCHEMA-VALIDATION validates the final object and rejects unsupported metadata', () => {
  const valid = constructRequestParameters({
    schema,
    parameters: { audience: 'engineering', filters: { owner: 'michael' }, sections: [{ title: 'Status' }], metadata: {} },
  });
  assert.equal(valid.audience, 'engineering');
  assert.equal(createJsonSchemaRegistry({ rules: [] }).validateSchema(schema, { documentPath: '/tmp/request.parameters.schema.json', rules: [] }).valid, true);
  assertParameterFailure(() => constructRequestParameters({ schema, parameters: { audience: 'invalid', filters: { owner: 'michael' }, sections: [{ title: 'Status' }], metadata: {} } }), /schema|invalid/u);
  assertParameterFailure(() => constructRequestParameters({ schema, parameters: { audience: 'engineering', filters: { owner: 'michael' }, sections: [{ title: 'Status' }], metadata: {}, extra: true } }), /schema|additional/u);
  // WI-0023 supports validation.function; a source that is not a function expression still fails closed.
  assertParameterFailure(() => constructRequestParameters({ schema: { ...schema, 'x-llm-req-parameter': { validation: { function: 'validate' } } } }), /Custom validation metadata at '<root>' is invalid/u);
  assertParameterFailure(() => constructRequestParameters({ schema: undefined, defaults: { audience: 'engineering' } }), /schema is required/u);
});