import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { composePrompt } from '../src/prompt.js';

const root = process.cwd();
const promptSchemaPath = join(root, 'schemas/prompt/v1/llm-prompt.xsd');
const fixtureDirectory = join(root, 'schemas/prompt/v1/fixtures');

interface XmlNode {
  readonly name: string;
  readonly attributes: Record<string, string>;
  readonly children: XmlNode[];
}

function decodeEntities(value: string): string {
  return value.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*"([\s\S]*?)"/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) attributes[match[1]!] = decodeEntities(match[2]!);
  return attributes;
}

function parseXml(source: string): XmlNode {
  const document: XmlNode = { name: '#document', attributes: {}, children: [] };
  const stack: XmlNode[] = [document];
  const tokenPattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?]xml[\s\S]*?[?]>|<\/?[A-Za-z_:][^>]*>/gu;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(source)) !== null) {
    const token = match[0]!;
    if (token.startsWith('<!--') || token.startsWith('<?xml') || token.startsWith('<![CDATA[')) continue;
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim();
      assert.equal(stack.at(-1)?.name, name, `closing tag ${name} must match its opening tag`);
      stack.pop();
      continue;
    }
    const selfClosing = token.endsWith('/>');
    const body = token.slice(1, selfClosing ? -2 : -1).trim();
    const nameMatch = /^([A-Za-z_:][A-Za-z0-9_.:-]*)/u.exec(body);
    assert.ok(nameMatch, `element token must have a name: ${token}`);
    const node: XmlNode = { name: nameMatch[1]!, attributes: parseAttributes(body.slice(nameMatch[0].length)), children: [] };
    stack.at(-1)!.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  assert.equal(stack.length, 1, 'XML elements must be balanced');
  return document;
}

function assertPromptContract(source: string): void {
  const rootNode = parseXml(source).children[0];
  assert.ok(rootNode, 'prompt must contain a root element');
  assert.equal(rootNode.name, 'llmPrompt');
  assert.equal(rootNode.attributes.version, '1');
  const names = rootNode.children.map((child) => child.name);
  const expectedNames = ['task'];
  if (names.includes('taskSchema')) expectedNames.push('taskSchema');
  expectedNames.push('files');
  if (names.includes('outputSchema')) expectedNames.push('outputSchema');
  assert.deepEqual(names, expectedNames);
  const task = rootNode.children.find((child) => child.name === 'task')!;
  assert.equal(typeof task.attributes.instruction, 'string');
  const files = rootNode.children.find((child) => child.name === 'files')!;
  assert.ok(files, 'files container is required');
  for (const file of files.children) {
    assert.equal(file.name, 'file');
    for (const attribute of ['name', 'path', 'type', 'encoding', 'purpose']) assert.equal(typeof file.attributes[attribute], 'string', `${attribute} is required`);
    assert.ok(file.attributes.encoding === 'utf8' || file.attributes.encoding === 'base64', 'encoding must be utf8 or base64');
  }
  const output = rootNode.children.find((child) => child.name === 'outputSchema');
  if (output) assert.equal(typeof output.attributes.instruction, 'string');
}

test('generated prompts and all prompt fixtures obey the XSD contract checks', async () => {
  const xsd = await readFile(promptSchemaPath, 'utf8');
  assert.match(xsd, /id="https:\/\/schemas\.handschuh\.dev\/llm\/prompt\/v1"/u);
  for (const name of ['llmPrompt', 'version', 'task', 'taskSchema', 'files', 'file', 'name', 'path', 'type', 'encoding', 'purpose', 'outputSchema', 'instruction']) {
    assert.match(xsd, new RegExp(`name="${name}"`, 'u'));
  }
  assert.ok((xsd.match(/<xs:documentation>/gu) ?? []).length >= 14, 'public XSD elements and attributes must be documented');
  assertPromptContract(composePrompt({ task: 'task', files: [] }));
  assertPromptContract(composePrompt({ task: 'task', taskSchema: '{"type":"object"}', files: [{ name: 'notes', path: 'notes.txt', type: 'text/plain', purpose: 'Notes', content: 'hello' }], outputSchema: '{"type":"object"}' }));
  assertPromptContract(composePrompt({ task: 'task', files: [{ name: 'image', path: 'image.png', type: 'image/png', encoding: 'base64', purpose: 'Image', content: '[binary attachment supplied separately]' }] }));
  for (const name of ['task-empty-files.xml', 'full-prompt.xml', 'binary-file.xml']) assertPromptContract(await readFile(join(fixtureDirectory, name), 'utf8'));
  for (const name of ['invalid-order.xml', 'invalid-missing-version.xml', 'invalid-encoding.xml', 'invalid-attributes.xml']) {
    const fixture = await readFile(join(fixtureDirectory, name), 'utf8');
    assert.throws(() => assertPromptContract(fixture), /./u, name);
  }
});