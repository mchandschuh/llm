# WI-0009 Prompt XML Schema Design

## Status and evidence boundary

This document is design output `A-004` for `OUT-004`. It specifies the XSD and
fixtures that the implementation task must add and validate.

## Target path

```text
schemas/prompt/v1/llm-prompt.xsd
```

The schema namespace/version should identify `llm/prompt/v1`. The generated
prompt currently has this structure:

```xml
<llmPrompt version="1">
  <task instruction="..." taskSchema="...">...</task>
  <taskSchema><![CDATA[{...}]]></taskSchema>
  <files>
    <file name="..." path="..." type="..." encoding="utf8" purpose="...">...</file>
  </files>
  <outputSchema instruction="..."><![CDATA[{...}]]></outputSchema>
</llmPrompt>
```

## Contract requirements

The XSD must define and document:

- `llmPrompt` as the root element;
- required `version` attribute with value `1`;
- required `task` element with an instruction attribute and escaped/CDATA text;
- optional `taskSchema` element;
- required `files` container, including an empty container;
- repeated `file` elements with `name`, `path`, `type`, `encoding`, and `purpose`;
- `encoding` values `utf8` and `base64`;
- optional `outputSchema` element with its instruction attribute;
- ordering of task, taskSchema, files, and outputSchema;
- descriptive `xs:documentation` annotations for every public element and
  attribute.

The XSD validates XML structure, not JSON Schema semantics inside CDATA. JSON
Schema validation remains the responsibility of the existing JSON Schema
validator and completion lifecycle.

## Fixtures and validation

The implementation task must add representative XML fixtures for:

1. task plus empty files;
2. taskSchema, one text file, and outputSchema;
3. a base64/binary file placeholder;
4. invalid ordering, missing version, invalid encoding, and missing required
   attributes.

The exact XML validation command and validator must be recorded in the later
validation task. The design task requires that the generated prompt from
`src/prompt.ts` can be validated against this XSD without changing the XML
projection semantics accidentally.
