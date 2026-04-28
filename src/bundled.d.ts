// Bun's `with { type: "text" }` import attribute — typed as `string`.
declare module "*.md" {
	const content: string;
	export default content;
}
