# Releasing @rafters/ledger

The whole process, so it is a procedure and not folklore. Three phases: accumulate, version, publish. Nothing here is optional; the one manual judgment call is the moment you decide a release happens.

## Phase 1 -- accumulate (every PR)

Every PR that changes behavior carries a changeset file:

```bash
pnpm changeset
# or write .changeset/<slug>.md by hand:
#   ---
#   "@rafters/ledger": patch | minor
#   ---
#   One paragraph a consumer can act on. Name behavior changes and
#   breaking changes explicitly ("BREAKING:" prefix).
```

Bump rules at 0.x (repo convention, precedent 0.1 -> 0.2): breaking changes bump **minor**, everything else **patch**. `major` is reserved for 1.0.

The changeset IS the changelog entry -- write it for the consumer reading release notes, not for the reviewer who already saw the diff. A PR with no changeset is claiming it has no consumer-visible effect; reviewers should challenge that claim.

## Phase 2 -- version (one PR per release)

When the accumulated set warrants a release:

```bash
git switch -c release/<x.y.z>
pnpm changeset version   # consumes .changeset/*.md -> bumps package.json, writes CHANGELOG.md
```

Then, before committing:

1. **Read the generated CHANGELOG section.** Changesets concatenates blindly. Fix markdown mangling (underscores become emphasis), and fix entries that later work invalidated -- a changeset written in PR N can be made stale by PR N+3, and the changelog is permanent.
2. **Check for stale changesets.** A leftover `.changeset/*.md` describing an already-published version means a past release was cut by hand; delete it rather than consuming it (this happened: `initial-release.md` described 0.2.0 and survived to the 0.3.0 cut).
3. `pnpm preflight` must be green.

The version PR goes through the same pipeline as any other: simplify gate, pr-write gate against the release issue, review if the diff warrants it, `legion pr merge`.

## Phase 3 -- publish (tag push, CI does the rest)

Publishing is tag-driven. Nobody runs `npm publish` from a laptop:

```bash
git switch main && git pull --ff-only
git tag v<x.y.z>          # on the version PR's merge commit
git push origin v<x.y.z>  # tags are outside legion push's branch-only surface
```

`.github/workflows/release.yml` fires on `v*`: install, build, `npm publish --access=public --provenance` (OIDC trusted publishing -- no token lives anywhere), then `gh release create` with generated notes.

Verify, do not assume:

```bash
npm view @rafters/ledger version   # shows the new version once the workflow finishes
```

## Why this shape

- **Changeset-per-PR** front-loads the changelog while context is fresh; release day is assembly, not archaeology.
- **Tag-driven CI publish with provenance** means the artifact provably came from this repo's CI, and no credential exists to leak.
- **The version PR through normal gates** means the changelog itself gets reviewed -- which is where stale entries (see phase 2) get caught.
