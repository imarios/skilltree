import Anthropic from "@anthropic-ai/sdk";

const MAX_CONTENT_LENGTH = 8000;

/**
 * Model used by `scan --llm`, overridable via `SKILLTREE_LLM_MODEL`.
 *
 * The default tracks the current-generation Sonnet: this is a bulk
 * classification job over truncated content, where Sonnet is the right
 * cost/quality point (#181).
 *
 * It is overridable because the pin will eventually go stale and nothing here
 * can catch that. No test exercises the SDK call — CI has no API key — so a
 * retired model id would reach a user before it reached us. The env var makes
 * that a `export SKILLTREE_LLM_MODEL=...` away rather than a source patch, and
 * lets anyone trade cost against quality without forking.
 */
const DEFAULT_SCAN_MODEL = "claude-sonnet-5";

/**
 * Resolve the scan model. Exported for the same reason `parseEntityList` is:
 * it is the part worth asserting on without an API key.
 *
 * A blank override falls back to the default. An empty `SKILLTREE_LLM_MODEL=`
 * is an unset variable that went through a shell, not a deliberate choice of
 * model, and sending it would only earn a 400.
 */
export function scanModel(): string {
	const override = process.env.SKILLTREE_LLM_MODEL?.trim();
	return override === undefined || override === "" ? DEFAULT_SCAN_MODEL : override;
}

/**
 * LLM-based dependency detection using Claude.
 * Two-phase approach: extract candidates, then verify.
 */
export async function llmScanContent(
	content: string,
	knownEntities: Array<{ name: string; type: string }>,
	selfName?: string,
): Promise<Array<{ name: string; type: string }>> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new Error(
			"ANTHROPIC_API_KEY environment variable is required for --llm scanning.\nSet it with: export ANTHROPIC_API_KEY=sk-...",
		);
	}

	const client = new Anthropic({ apiKey });

	// Truncate content to avoid excessive token usage
	const truncated =
		content.length > MAX_CONTENT_LENGTH ? content.slice(0, MAX_CONTENT_LENGTH) : content;

	try {
		// Phase 1: Extract candidates
		const candidates = await extractCandidates(client, truncated, knownEntities, selfName);
		if (candidates.length === 0) return [];

		// Phase 2: Verify candidates
		return await verifyCandidates(client, truncated, candidates);
	} catch (e) {
		throw describeScanFailure(e);
	}
}

/**
 * The one line of advice worth giving for an API failure, chosen by HTTP
 * status. `undefined` means "nothing useful to add" — the raw SDK message
 * already says everything we know.
 *
 * Status is the axis that matters, not the error class (#185). #182 branched
 * on `APIError` vs `Error` and handed the model-override advice to everything
 * in the first bucket, which meant a rejected key — a 401, very much an
 * `APIError` — was reported as a model problem. Advice that points at the
 * wrong knob is worse than no advice: it costs the user a detour before they
 * get to read the actual error.
 */
function scanFailureAdvice(status: number | undefined, message: string): string | undefined {
	// A retired or unavailable model surfaces as a bare `404 {"type":"error"}`
	// (or a 400 naming the `model` field), which says nothing about which model
	// was asked for or that it can be changed. Since no test exercises this call
	// path, this message is the only thing standing between a stale pin and a
	// confused user (#181).
	if (status === 404 || (status === 400 && /\bmodel\b/i.test(message))) {
		return `If the model "${scanModel()}" is unavailable to you, set SKILLTREE_LLM_MODEL to one that is.`;
	}
	if (status === 401 || status === 403) {
		return "The API key was rejected. Check ANTHROPIC_API_KEY.";
	}
	if (status === 429) {
		return "Rate limited. Wait and re-run — scanning fewer paths at a time also helps.";
	}
	if (status !== undefined && status >= 500) {
		return "The API is failing upstream. Try again in a moment.";
	}
	return undefined;
}

/**
 * Turn an SDK failure into something a user can act on.
 *
 * Non-API failures pass through untouched — a dropped connection shouldn't be
 * rewritten at all, since we have nothing to add to it.
 */
export function describeScanFailure(e: unknown): Error {
	if (!(e instanceof Anthropic.APIError)) {
		return e instanceof Error ? e : new Error(String(e));
	}

	const advice = scanFailureAdvice(e.status, e.message);
	return new Error(
		`Claude API error while scanning: ${e.message}${advice === undefined ? "" : `\n${advice}`}`,
		// Keep the SDK error reachable: the rewritten message is for the
		// user, the cause is for whoever debugs it.
		{ cause: e },
	);
}

async function extractCandidates(
	client: Anthropic,
	content: string,
	knownEntities: Array<{ name: string; type: string }>,
	selfName?: string,
): Promise<Array<{ name: string; type: string }>> {
	const entityList = knownEntities
		.filter((e) => e.name !== selfName)
		.map((e) => `- ${e.name} (${e.type})`)
		.join("\n");

	const response = await client.messages.create({
		model: scanModel(),
		max_tokens: 1024,
		messages: [
			{
				role: "user",
				content: `Identify which entities from the known list this content REQUIRES as dependencies to function correctly.

Known entities:
${entityList}

Content to analyze:
${content}

A dependency IS REQUIRED if the content:
- Instructs to "use", "load", "apply", "refer to", or "follow" it
- References it as a prerequisite, foundation, or tool to use
- Gives conditional instructions to use it ("if Python, use X" — X is still required)
- Describes it as helping accomplish the skill's purpose ("X helps identify..." — active use)
- Directs the reader to read, skim, or learn from it

A dependency is NOT required if:
- Negated: "not a replacement for X", "don't use X", "does NOT use X"
- Purely optional: "you might want to", "entirely optional", "depends on your workflow"
- Historical: "used to depend on X", "removed in v2"
- Only used as a comparison or contrast: "unlike X", "as an example"
- Plural/generic reference: "use dedicated skills" (not a specific skill name)

Return ONLY a JSON array of objects with name and type fields. Example: [{"name": "python-coding", "type": "skill"}]
If no dependencies found, return: []`,
			},
		],
	});

	return parseJsonResponse(response);
}

async function verifyCandidates(
	client: Anthropic,
	content: string,
	candidates: Array<{ name: string; type: string }>,
): Promise<Array<{ name: string; type: string }>> {
	const candidateList = candidates.map((c) => `- ${c.name} (${c.type})`).join("\n");

	const response = await client.messages.create({
		model: scanModel(),
		max_tokens: 1024,
		messages: [
			{
				role: "user",
				content: `Verify which of these candidate dependencies are ACTUALLY required by the content below.

Candidates to verify:
${candidateList}

Content:
${content}

CONFIRM a dependency if the content:
- Instructs the reader to use, load, apply, follow, read, or refer to it
- Uses it as a tool: "X helps identify...", "use X for..."
- Gives conditional instructions: "if Python files, use X" (conditional use IS a dependency)
- Directs learning from it: "read X", "skim X", "review X's guidelines"
- In YAML frontmatter dependencies or skills list

REJECT a dependency if:
- Negated: "not a replacement for X", "don't use X", "does NOT use X"
- Explicitly optional: "entirely optional", "depends on your workflow"
- Historical/removed: "used to depend on", "removed that dependency"
- Only mentioned as example, comparison, or contrast: "unlike X", "consider X as an example"
- Generic/plural reference without naming a specific entity

Return ONLY confirmed dependencies as a JSON array: [{"name": "skill-name", "type": "skill"}]
If none confirmed, return: []`,
			},
		],
	});

	return parseJsonResponse(response);
}

function parseJsonResponse(response: Anthropic.Message): Array<{ name: string; type: string }> {
	const text = response.content[0]?.type === "text" ? response.content[0].text : "";
	return parseEntityList(text);
}

/**
 * Parse a JSON array of {name, type} objects from text.
 * Handles markdown code blocks, invalid JSON, and non-conforming objects.
 */
export function parseEntityList(text: string): Array<{ name: string; type: string }> {
	const jsonMatch = text.match(/\[[\s\S]*\]/);
	if (!jsonMatch) return [];

	try {
		const parsed = JSON.parse(jsonMatch[0]) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(item): item is { name: string; type: string } =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as Record<string, unknown>).name === "string" &&
				typeof (item as Record<string, unknown>).type === "string",
		);
	} catch {
		return [];
	}
}
