---
name: polyglot-review
description: Multi-language code review
dependencies:
  - code-review
---

# Polyglot Review

## Language-Specific Rules

If the PR contains Python files, use the `python-coding` skill. For TypeScript files, apply the `typescript-coding` skill. For all other languages, fall back to the `general-coding` skill.

## Security

If the code handles user authentication or sensitive data, also load the cybersecurity skill for a security-focused review pass.

## Performance

For performance-critical paths, there is no dedicated skill yet — use your best judgment and benchmark before and after.
