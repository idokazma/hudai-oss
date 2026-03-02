import type { BuiltinSkillTemplate } from '@hudai/shared';

export const BUILTIN_SKILLS: BuiltinSkillTemplate[] = [
  {
    id: 'onboarding',
    name: 'onboarding',
    description: 'Read the codebase library before exploring',
    filename: 'onboarding.md',
    content: `---
name: onboarding
description: Read the codebase library before exploring
---

# Onboarding — Codebase Library

Before doing broad codebase exploration (Glob, Grep, Read across many files), check if a pre-built codebase library exists. This saves significant tokens by giving you architecture, module summaries, and file-level details upfront.

## Steps

1. **Check for the library.** Look for \`~/.hudai/projects/*/library/OVERVIEW.md\`. Find the right project hash by checking \`~/.hudai/projects/*/project.json\` for the matching \`rootPath\`.

2. **Read OVERVIEW.md first.** This gives you:
   - Project description and tech stack
   - Architecture style and key patterns
   - Entry points and build commands
   - Directory map
   - Module index with links to detailed module files

3. **Read the relevant module file.** Based on your task, read \`~/.hudai/projects/{hash}/library/modules/{module-slug}.md\` for the specific module you need. Each module file contains:
   - Module purpose and patterns
   - Public API (key exports to use)
   - Per-file summaries with exports, key logic, dependencies, and gotchas

4. **Only then read raw source.** Once you know exactly which files matter, read them directly. You should rarely need to Glob or Grep broadly — the library tells you where things are.

## When to skip

- If no library exists yet (Hudai hasn't built one), fall back to normal exploration
- If you need to find something very specific that the library wouldn't cover (e.g., a particular error message)
- If the library is stale (files have changed significantly since it was built)

## Key principle

**Read the map before exploring the territory.** The library is your map.
`,
  },
];

export function getBuiltinSkill(id: string): BuiltinSkillTemplate | undefined {
  return BUILTIN_SKILLS.find(s => s.id === id);
}
