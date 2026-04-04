BUN := $(HOME)/.bun/bin/bun
.PHONY: help install test lint format typecheck check build clean dev setup release eval eval-llm
.DEFAULT_GOAL := help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	$(BUN) install

test: ## Run tests
	$(BUN) test

lint: ## Run linter
	$(BUN) run lint

lint-fix: ## Run linter with auto-fix
	$(BUN) run lint:fix

format: ## Format code
	$(BUN) run format

format-check: ## Check code formatting
	$(BUN) run format:check

typecheck: ## Run type checker
	$(BUN) run typecheck

check: lint format-check typecheck test ## Run all checks (lint + format + typecheck + test)

eval: ## Run scan evals (regex only)
	$(BUN) evals/scan/run-eval.ts

eval-llm: ## Run scan evals with LLM (requires ANTHROPIC_API_KEY)
	$(BUN) evals/scan/run-eval.ts --llm

build: ## Compile single binary to dist/skilltree
	$(BUN) build --compile src/cli.ts --outfile dist/skilltree

clean: ## Remove dist/ and node_modules/
	rm -rf dist/ node_modules/

dev: ## Run CLI from source (use ARGS= to pass args)
	$(BUN) run src/cli.ts $(ARGS)

setup: build ## Build and install binary + skill + completions
	@mkdir -p $(HOME)/.skilltree/bin $(HOME)/.skilltree/completions
	@rm -f $(HOME)/.skilltree/bin/skilltree
	@cp dist/skilltree $(HOME)/.skilltree/bin/skilltree
	@$(BUN) run src/cli.ts teach > /dev/null
	@$(BUN) run src/cli.ts completion zsh > $(HOME)/.skilltree/completions/_skilltree
	@$(BUN) run src/cli.ts completion bash > $(HOME)/.skilltree/completions/skilltree.bash
	@echo ""
	@echo "  \033[1mskilltree v$$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9][^"]*\)".*/\1/') installed\033[0m"
	@echo ""
	@echo "  \033[32m✔\033[0m Binary     → ~/.skilltree/bin/skilltree"
	@echo "  \033[32m✔\033[0m Skill      → ~/.claude/skills/skilltree/"
	@echo "  \033[32m✔\033[0m Completions → ~/.skilltree/completions/"
	@echo ""
	@if echo "$$PATH" | grep -q "$(HOME)/.skilltree/bin"; then \
		echo "  PATH already configured."; \
	else \
		echo "  Add to your shell rc file:"; \
		echo "    \033[36mexport PATH=\"\$$HOME/.skilltree/bin:\$$PATH\"\033[0m"; \
	fi
	@echo ""
	@echo "  For tab completions (zsh):"
	@echo "    \033[36msource \$$HOME/.skilltree/completions/_skilltree\033[0m"
	@echo ""
	@echo "  To seed community registries:"
	@echo "    \033[36mskilltree registry init\033[0m"
	@echo ""

release: ## Tag and release a version (usage: make release V=0.2.0)
ifndef V
	$(error Usage: make release V=0.2.0)
endif
	@# Guard: tag must not already exist
	@if git tag -l | grep -q "^v$(V)$$"; then \
		echo "Error: tag v$(V) already exists"; exit 1; \
	fi
	@# Guard: new version must be higher than current
	@CURRENT=$$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/'); \
	if [ "$$(printf '%s\n%s' "$$CURRENT" "$(V)" | sort -V | tail -1)" = "$$CURRENT" ] && [ "$$CURRENT" != "$(V)" ]; then \
		echo "Error: $(V) is lower than current version $$CURRENT"; exit 1; \
	fi; \
	if [ "$$CURRENT" = "$(V)" ]; then \
		echo "Error: $(V) is the same as current version"; exit 1; \
	fi
	@# Guard: working tree must be clean
	@if [ -n "$$(git status --porcelain -- src/ tests/ package.json)" ]; then \
		echo "Error: uncommitted changes in src/, tests/, or package.json. Commit or stash first."; exit 1; \
	fi
	@# Guard: tests must pass
	@echo "Running checks..."
	@$(BUN) test --quiet || (echo "Error: tests failing. Fix before releasing."; exit 1)
	@echo "Releasing v$(V)..."
	@sed -i '' 's/"version": ".*"/"version": "$(V)"/' package.json
	@git add package.json
	@git commit -m "bump: version → $(V)"
	@git tag v$(V)
	@$(MAKE) setup
	@echo ""
	@echo "Released v$(V) — binary installed at ~/.skilltree/bin/skilltree"
