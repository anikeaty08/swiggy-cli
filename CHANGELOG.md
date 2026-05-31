# 🍽️ Changelog

> 🍽️ **Repo kitchen:** `anikeaty08/swiggy-cli` · Built for Food, Instamart, Dineout, and automation.

All notable changes to `swiggy-cli` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial public scaffold targeting all 35 tools across the three official Swiggy MCP servers (food, instamart, dineout).
- Layer A ergonomic verbs for every server.
- Layer B generic commands: `servers`, `tools`, `schema`, `call`.
- Stable JSON envelope, deterministic exit codes, TSV plain-mode renderer.
- OAuth 2.0 + PKCE flow with `--client-id` / `SWIGGY_OAUTH_CLIENT_ID` (no dynamic client registration upstream).
- Profiles, doctor, config, auth subcommands.
- Docs, AGENTS.md, agent-skills (`skills/*/SKILL.md`).
- GitHub Actions CI + tag-based release pipeline with npm provenance.
- Snapshot contract tests for high-risk ergonomic payloads.
- Cached schema fixtures for every known MCP tool, with live schema validation for generic calls.
- Machine-mode CLI tests, mocked MCP transport tests, and auth refresh tests.
- Human-mode renderers and destructive preflight summaries before checkout, cart clearing, booking, and address deletion.
- Shell completion helper: `swiggy completion bash|zsh|fish`.

[Unreleased]: https://github.com/anikeaty08/swiggy-cli/compare/HEAD...HEAD
