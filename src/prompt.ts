import type { FileEncoding, InlineJsonSchema, NormalizedRequest, PromptParts, ReferenceFile, TaskValue } from './types.js';

function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

function text(value: TaskValue | InlineJsonSchema): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function fileXml(file: ReferenceFile & { readonly content: string }): string {
  const encoding: FileEncoding = file.encoding ?? 'utf8';
  const attrs = `name="${attribute(file.name)}" path="${attribute(file.path)}" type="${attribute(file.type)}" encoding="${attribute(encoding)}" purpose="${attribute(file.purpose)}"`;
  const body = encoding === 'base64' ? '[binary attachment supplied separately]' : cdata(file.content);
  return `    <file ${attrs}>${body}</file>`;
}

export function composePrompt(parts: PromptParts): string {
  const taskSchemaAttribute = parts.taskSchema ? ` taskSchema="${attribute(parts.taskSchema)}"` : '';
  const taskInstruction = parts.taskSchema ? ' The task data must satisfy the referenced taskSchema.' : '';
  const outputInstruction = parts.outputSchema ? ' The generated output must satisfy the referenced outputSchema.' : '';
  const sections = [
    '<llmPrompt version="1">',
    `  <task${taskSchemaAttribute} instruction="${attribute(`Provide task data to the model.${taskInstruction}`)}">${cdata(parts.task)}</task>`,
  ];
  if (parts.taskSchema) sections.push(`  <taskSchema>${cdata(parts.taskSchema)}</taskSchema>`);
  sections.push('  <files>');
  for (const file of parts.files) sections.push(fileXml(file));
  sections.push('  </files>');
  if (parts.outputSchema) {
    sections.push(`  <outputSchema instruction="${attribute(`The output must be JSON and satisfy the referenced outputSchema.${outputInstruction}`)}">${cdata(parts.outputSchema)}</outputSchema>`);
  }
  sections.push('</llmPrompt>');
  return sections.join('\n');
}

export function composeRequestPrompt(request: NormalizedRequest): string {
  return composePrompt({
    task: text(request.task),
    taskSchema: request.taskSchema ? JSON.stringify(request.taskSchema) : undefined,
    files: request.files,
    outputSchema: request.outputSchema ? JSON.stringify(request.outputSchema) : undefined,
  });
}

export function composeCorrectionPrompt(request: NormalizedRequest, previousResult: string, validationErrors: readonly string[]): string {
  const correctionSchema = JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'LLM Output Correction Task',
    description: 'A bounded correction request containing the original task, rejected provider output, and schema violations that must be fixed.',
    type: 'object',
    additionalProperties: false,
    required: ['originalTask', 'previousResult', 'validationErrors', 'correctionInstruction'],
    properties: {
      originalTask: { description: 'The original task data supplied to the provider.', type: 'string' },
      previousResult: { description: 'The complete provider result that failed output validation.', type: 'string' },
      validationErrors: {
        description: 'The bounded, sanitized schema violations identified by the host validator.',
        type: 'array',
        items: { description: 'One schema violation expressed as a bounded path and message.', type: 'string' },
      },
      correctionInstruction: { description: 'The instruction to return only output that satisfies the configured outputSchema.', type: 'string' },
    },
    examples: [{
      originalTask: '{"operation":"summarize"}',
      previousResult: '{"ok":"wrong type"}',
      validationErrors: ['/ok must be boolean'],
      correctionInstruction: 'Return only JSON that satisfies the outputSchema.',
    }],
  });
  const correctionTask = JSON.stringify({
    originalTask: text(request.task),
    previousResult,
    validationErrors: validationErrors.slice(0, 10),
    correctionInstruction: 'Return only JSON that satisfies the outputSchema.',
  });
  return composePrompt({
    task: correctionTask,
    taskSchema: correctionSchema,
    files: request.files,
    outputSchema: request.outputSchema ? JSON.stringify(request.outputSchema) : undefined,
  });
}
