# Short Memory — General Phase 1

## Coverage baseline
- Overall: 71.29% lines, 79.06% functions
- Target: 95% lines

## Files to cover
- [ ] git.ts (21% → 95%)
- [ ] graph.ts (58% → 90%)
- [ ] installer.ts (64% → 95%)
- [ ] remove.ts (28% → 95%)
- [ ] llm.ts (2% → 80%)
- [ ] scanner.ts (71% → 95%)
- [ ] migrate.ts (86% → 95%)

## Key decisions
- Use local bare git repos as fixtures (file:// protocol, no network)
- Mock Anthropic SDK by extracting parseJsonResponse as testable + testing error path
- Don't test cli.ts directly (commander wiring, covered by integration)
