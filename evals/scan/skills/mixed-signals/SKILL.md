---
name: full-stack-review
description: Full-stack code review combining multiple disciplines
dependencies:
  - code-review
---

# Full-Stack Review

## Frontend

Use the `typescript-coding` skill for all React and TypeScript files. Follow its patterns for type safety and component structure.

## Backend

For Python services, apply the python-coding skill. Ensure all endpoints have proper type hints and follow PEP 8.

## Cross-Cutting Concerns

The general-coding skill provides foundational principles that apply everywhere — clean code, test hygiene, and code quality.

## What This Skill Is Not

This is not a replacement for the `cybersecurity` skill. While we check for obvious security issues during review, dedicated security analysis requires specialized tools. We also don't cover the `splunk` skill's domain — log analysis is out of scope.

## Optional Enhancements

If the project uses CI/CD, you might want to also load the `deployment` skill, but it's entirely optional and depends on your workflow.
