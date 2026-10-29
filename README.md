# llm

Provider-agnostic structured LLM completion CLI and Node.js library.

## Agent skill installation

The repository includes an installer for the agent skill document and its local
JSON schemas. Pass the parent skills directory as its only argument:

```bash
./scripts/install_agent_skill.mjs "$HOME/.cline/skills"
```

The installer creates:

```text
$HOME/.cline/skills/llm/SKILL.md -> <this checkout>/SKILL.md
$HOME/.cline/skills/llm/schemas  -> <this checkout>/schemas
```

Both links are siblings under the installed `llm` directory so relative schema
references such as `./schemas/request/v1/request.schema.json` continue to work
when an agent loads the linked `SKILL.md`. The installer is safe to rerun when
the expected links already exist and refuses to overwrite unexpected files,
directories, or links to another source.

The destination directory may be anywhere:

```bash
/home/michael/src/github/llm/scripts/install_agent_skill.mjs /tmp/agent-skills
```

This produces `/tmp/agent-skills/llm/SKILL.md` and
`/tmp/agent-skills/llm/schemas` pointing back to the checkout containing the
installer.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The CLI is available as `llm` when the user-local npm link is installed. See
`SKILL.md` for request/response contracts, CLI usage, provider configuration,
and Node.js library examples.
