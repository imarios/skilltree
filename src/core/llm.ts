import Anthropic from "@anthropic-ai/sdk";

const MAX_CONTENT_LENGTH = 8000;

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

	// Phase 1: Extract candidates
	const candidates = await extractCandidates(client, truncated, knownEntities, selfName);
	if (candidates.length === 0) return [];

	// Phase 2: Verify candidates
	const verified = await verifyCandidates(client, truncated, candidates);
	return verified;
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
		model: "claude-sonnet-4-6",
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
		model: "claude-sonnet-4-6",
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
