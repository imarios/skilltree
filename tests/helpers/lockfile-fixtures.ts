// Lockfile fixture builders for tests.
//
// `LockfileEntry.commit` is non-optional (see `src/types.ts`), but tsc cannot
// catch the omission in hand-rolled fixtures because every field is
// structural. The historical fix was to remember to add `commit: "HEAD"` in
// every new lockfile fixture site — and it kept getting forgotten (see
// issue #117). Use these builders so the required defaults exist in one place.
//
// Usage:
//   import { emptyLockfile, localEntry, remoteEntry } from "../helpers/lockfile-fixtures";
//   const lock = emptyLockfile();                       // valid, empty
//   const lock2 = { ...emptyLockfile(), packages: { foo: localEntry("foo") } };
//   const lock3 = { ...emptyLockfile(["claude", "codex"]), packages: { ... } };
//
// Always builders, never constants — each test gets its own object so mutation
// in one test can't leak.

import type { DependencyGroup, EntityType, Lockfile, LockfileEntry } from "../../src/types.js";

export function emptyLockfile(installTargets: string[] = ["claude"]): Lockfile {
	return { lockfile_version: 1, install_targets: installTargets, packages: {} };
}

export interface LocalEntryOpts {
	type?: EntityType;
	group?: DependencyGroup;
	deps?: string[];
	/** Override `./skills/<name>` when the test wants a non-conventional path. */
	path?: string;
	/** YAML-key aliasing for collision tests. */
	name?: string;
}

export function localEntry(name: string, opts: LocalEntryOpts = {}): LockfileEntry {
	const entry: LockfileEntry = {
		source: "local",
		path: opts.path ?? `./skills/${name}`,
		type: opts.type ?? "skill",
		group: opts.group ?? "prod",
		commit: "HEAD",
		dependencies: opts.deps ?? [],
	};
	if (opts.name) entry.name = opts.name;
	return entry;
}

export interface RemoteEntryOpts {
	type?: EntityType;
	group?: DependencyGroup;
	deps?: string[];
	repo?: string;
	path?: string;
	version?: string;
	commit?: string;
	name?: string;
}

export function remoteEntry(name: string, opts: RemoteEntryOpts = {}): LockfileEntry {
	const entry: LockfileEntry = {
		repo: opts.repo ?? `github.com/example/${name}`,
		path: opts.path ?? `skills/${name}`,
		type: opts.type ?? "skill",
		group: opts.group ?? "prod",
		version: opts.version ?? "1.0.0",
		// `commit` is non-optional in LockfileEntry — defaulting to a stable
		// placeholder lets tests pass through readLockfile / diff helpers
		// without surprises. Override when the test cares about the value.
		commit: opts.commit ?? "abc123",
		dependencies: opts.deps ?? [],
	};
	if (opts.name) entry.name = opts.name;
	return entry;
}
