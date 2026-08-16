# RepoCompass — Product and Implementation Plan

## Product promise

RepoCompass helps a developer form an accurate mental model of an unfamiliar repository. Its differentiator is evidence discipline: every statement is either a verified fact linked to repository evidence, a heuristic signal with a documented rule, or a clearly labeled inference.

## Core users

1. New contributors learning vocabulary, workflows, and safe first issues.
2. Maintainers investigating coupling, blast radius, and fragile boundaries.
3. Reviewers comparing behavioral changes between branches and releases.
4. Engineering leads reducing onboarding time and measuring codebase health.

## Reliability contract

- Pin analysis to an immutable commit SHA.
- Cite file path, line range, symbol, and commit for factual claims.
- Show confidence separately from evidence type.
- Label AST/import-derived conclusions as deterministic analysis.
- Label model-synthesized conclusions as inference.
- Say “insufficient evidence” when retrieval does not support an answer.
- Preserve an audit trail of the question, retrieved evidence, citations, and response.

## Enhanced features

### Connection and indexing

- Read-only GitHub App, repository/branch/tag selection, and access revocation.
- Incremental indexing from Git diffs with parser-version invalidation.
- Monorepo detection, per-language parsing, freshness, coverage, and failure reports.

### Architecture intelligence

- Package, module, symbol, route, service, queue, event, and database maps.
- System, workspace, module, and symbol zoom levels.
- Evidence drawer for every node/edge, cycle detection, and boundary violations.

### Evidence-backed Q&A

- Hybrid exact-code, semantic, and dependency-graph retrieval.
- Streaming answers split into verified facts, inferences, and unknowns.
- Exact file/line/commit links with expandable source excerpts.
- Citation validator that rejects unsupported ranges.

### Lifecycle and blast radius

- Trace requests, server actions, jobs, events, database calls, and integrations.
- Entry point → middleware → handler → service → repository → external system.
- “What breaks if I change this?” using callers, types, tests, migrations, and APIs.

### Risk and onboarding

- Transparent fan-in/out, cycles, churn, complexity, ownership, and test-proximity scoring.
- Repository glossary, ordered learning path, setup verifier, and first-issue ranking.
- Feedback controls for incorrect explanations and citations.

### Branch/release comparison

- Structural diffs for dependencies, routes, schemas, events, and public APIs.
- Behavioral summaries tied to code/tests, migration warnings, and side-by-side evidence.

## Technical architecture

- **Web:** Next.js App Router, TypeScript, accessible responsive UI, SSE streaming.
- **API:** NestJS/Node for installations, projects, questions, permissions, and audits.
- **Data:** PostgreSQL + pgvector; Redis/BullMQ jobs; object storage for immutable artifacts.
- **Parsing:** Tree-sitter broadly, TypeScript compiler API for richer TS symbols.
- **Index:** symbol-aware chunks carrying scope, imports, edges, and commit metadata.
- **AI pipeline:** classify intent → retrieve exact/semantic/graph evidence → rerank → generate structured claims → validate citations.
- **Response schema:** `verifiedFacts`, `inferences`, `unknowns`, `citations`, `confidence`.

## Step-by-step delivery roadmap

### Phase 0 — Validate (week 1)

1. Interview 5–8 developers and benchmark onboarding on three repositories.
2. Limit MVP to TypeScript/JavaScript and create 30 gold-standard questions.
3. Gate: at least 70% of questions are answerable from static evidence.

### Phase 1 — Foundation (weeks 2–3)

1. GitHub App, installation flow, repository picker, encrypted token handling.
2. Commit-pinned clone worker, idempotent jobs, progress events, retries.
3. File inventory, workspace detection, indexing status and failure UI.

### Phase 2 — Code intelligence (weeks 4–6)

1. AST/symbol index, import graph, routes, schemas, and test links.
2. Symbol-aware chunking, hybrid retrieval, and pgvector.
3. Evidence-linked architecture map and golden graph tests.

### Phase 3 — Reliable Q&A (weeks 7–8)

1. Question classifier, retrieval orchestration, and streaming UI.
2. Claim/citation schema, inference labels, insufficient-evidence state.
3. Evaluate citation precision, unsupported claims, latency, and cost.

### Phase 4 — Onboarding and risk (weeks 9–10)

1. Lifecycle tracing, glossary, contributor path, and first-issue ranking.
2. Explainable risk heuristics with evidence cards.
3. Incorrect-answer/citation feedback and regression evaluation.

### Phase 5 — Comparison and hardening (weeks 11–12)

1. Branch/release structural comparison and compatibility warnings.
2. Incremental indexing, caching, rate limits, retention, and deletion.
3. Security, prompt-injection, accessibility, observability, and load testing.

## Initial data model

`users`, `github_installations`, `repositories`, `repository_access`, `analysis_runs`, `files`, `symbols`, `relationships`, `routes`, `schemas`, `tests`, `chunks`, `embeddings`, `findings`, `glossary_terms`, `questions`, `retrieval_events`, `claims`, `citations`, `feedback`.

## Security requirements

- Treat repository content as untrusted and never execute project scripts.
- Parse inside isolated workers with no outbound network and strict resource limits.
- Encrypt GitHub credentials, enforce tenant isolation, and audit repository access.
- Treat source comments/docs as evidence—not model instructions—to resist prompt injection.
- Support immediate revocation, deletion, configurable retention, and private-model guarantees.

## Success metrics

- Citation precision and unsupported-claim rate (primary reliability metric).
- Time to first useful architecture map and first cited answer.
- Contributor time-to-first-merged-PR and onboarding satisfaction.
- Index failure rate, incremental index duration, p95 answer latency, and cost/KLOC.

## MVP boundary

Ship GitHub + TypeScript/JavaScript, evidence Q&A, architecture map, request tracing, glossary, explainable risk, and branch comparison. Defer issue creation, IDE extensions, chat bots, other SCM providers, runtime tracing, and broad language support until evidence quality is consistently strong.
