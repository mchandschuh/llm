import type { NormalizedRequest, PromptParts, ReferenceFile } from './types.js';

function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

function fileXml(file: ReferenceFile & { readonly content: string }): string {
  const attrs = `name="${attribute(file.name)}" path="${attribute(file.path)}" type="${attribute(file.type)}" purpose="${attribute(file.purpose)}"`;
  return `    <file ${attrs}>${cdata(file.content)}</file>`;
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
    task: request.task.value,
    taskSchema: request.taskSchema?.value,
    files: request.files,
    outputSchema: request.outputSchema?.value,
  });
}

export function composeCorrectionPrompt(request: NormalizedRequest, previousResult: string, validationErrors: readonly string[]): string {
  const correctionSchema = JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['originalTask', 'previousResult', 'validationErrors', 'correctionInstruction'],
    properties: {
      originalTask: { description: 'The original task data.', type: 'string' },
      previousResult: { description: 'The prior provider result.', type: 'string' },
      validationErrors: { type: 'array', items: { type: 'string' } },
      correctionInstruction: { type: 'string' },
    },
  });
  const correctionTask = JSON.stringify({
    originalTask: request.task.value,
    previousResult,
    validationErrors: validationErrors.slice(0, 10),
    correctionInstruction: 'Return only JSON that satisfies the outputSchema.',
  });
  return composePrompt({
    task: correctionTask,
    taskSchema: correctionSchema,
    files: request.files,
    outputSchema: request.outputSchema?.value,
  });
}
