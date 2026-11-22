# CLAUDE.md

All Play is a voice-first, accessibility-focused game portal. Spider Solitaire is the first game; the platform is built to host many games on one data-driven engine. This file governs how work is done. What gets built lives in `docs/`.

## 1. Sources of Truth

- `docs/day-0-designs/0-day-0-project-idea.md` - product brief. Its Appendix (Claude Clarifications) records decisions that are binding.
- `docs/day-0-designs/data-model.md` - every persisted entity. Model, DAO and table names match it exactly.
- `docs/day-0-designs/game-engine.md` - engine interface, rules document format, session API.
- `docs/day-0-designs/action-decision.md` - voice to action flow.
- `docs/day-0-designs/authn-authz.md` - identities, roles, route tiers.
- `docs/day-0-designs/cdk-stacks.md` - stacks, pipeline, codebase layout (Section 11), tooling (Section 12).
- `docs/day-0-designs/spider-solitaire.md` - Spider rules document.

Do not re-decide what these documents state. If a task conflicts with a spec, stop and propose a spec change first. If a spec is silent, ask before choosing.

## 2. Directory Lock

Code goes only into `backend/`, `web-app/`, `cdk/` and `ios/`, following the layout in `cdk-stacks.md` Section 11. A new top-level directory, Lambda bundle, stack, or DynamoDB table requires a spec change committed before the code.

## 3. Definition of Done

A task touching a package is not done until, in this run, after the last change, for every affected package:

1. `npm run build` succeeds.
2. `npm run lint` passes with zero warnings.
3. `npm run test:coverage` passes with coverage at or above 95% for lines, branches, functions and statements.

Run only the affected packages. If a gate cannot run, report the task as partial and name the gate. Never lower a threshold, add a lint suppression, or exclude a file from coverage to get a gate to pass without asking first.

## 4. Deploy Safety Gate

Any command that creates, changes or deletes AWS resources (`cdk deploy`, `cdk destroy`, `cdk bootstrap`, mutating AWS CLI calls, `scripts/grant-admin.sh`) needs explicit user confirmation immediately before that run, every time. `cdk synth` and `cdk diff` do not. Prefer letting the pipeline deploy.

Every AWS CLI and CDK command uses the `allplays` profile, passed explicitly as `--profile allplays`. Never use the default or nyc311 profiles. `.claude/settings.json` sets `AWS_PROFILE=allplays` for the session, and the `.claude/hooks/aws-profile-guard.py` hook blocks any other profile, inline credentials, an unset `AWS_PROFILE`, and any `aws`/`cdk`/`sam` call without `--profile allplays`. AWS Emulator calls aimed at `127.0.0.1` are the only exception. `npm run lint` runs the same check over every npm and shell script. Never weaken the hook; if it blocks something legitimate, ask.

## 5. Architecture Rules

- The game engine (`backend/src/game-engine/`) is pure and isolated: no I/O, clock or randomness, and it imports only itself and `zod`. Others import only its `index.ts`.
- Games are rules documents. Never add game-specific code to the engine; add a generic primitive instead.
- Clients never compute game rules. They render the server's view and legal actions.
- The LLM only selects from server-built candidates. Game state changes only through the game session service.
- Backend layering: controller (zod-parse the trigger payload first) -> service -> DAO. Controllers never call DAOs.
- The caller's identity comes from `resolveCaller`, never from a request body.
- Web: components call hooks, hooks call services. Every service has a live and an in-memory implementation.
- Accessibility is a requirement: keyboard-first, large targets, WCAG 2.2 AA, respect reduced motion.

## 6. Coding Conventions

- TypeScript strict everywhere. No `any`. Every external input is parsed with zod.
- One type per file in `models/`, a TypeScript type plus its zod schema.
- Enum values are ALL_CAPS strings.
- Block comments only (`/* */`, `/** */`), prose at most 500 characters. Comment the why, not the what.
- Component files are PascalCase and under 200 lines; other files are camelCase.
- Tests mirror the source tree. CDK tests use fine-grained assertions, never snapshots.
- No emojis anywhere in code or docs, and no icons in specs or docs. The apps may draw icons (inline SVG), each with a text alternative for assistive technology.

Lint rules enforce these conventions (`cdk-stacks.md` Section 12). Fix the code, not the rule.

## 7. Specs and Docs

- Specs are declarative: they state what the system does, not options it might take.
- Specs break work into legs. Each leg is one commit and is listed in the spec's legs table.
- When implementation changes a decision, update the spec in the same commit.

## 8. Commits

Commit only when asked or when executing a leg. One leg per commit. Format:

`[<type>] - <message>` where type is `feat`, `bugfix`, `docs` or `chore`.

Never commit secrets, `.env` files, `cdk.out/`, `coverage/` or `build/`.
