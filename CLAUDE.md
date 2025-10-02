# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an automated code review agent built using Claude Agent SDK (Node.js) that:
- Discovers PRs from version control platforms via MCP (GitHub, GitLab, Bitbucket)
- Analyzes code changes for quality, security, and best practices
- Posts inline comments and review summaries directly on PRs
- Maintains review history in SQLite database

## Architecture

### Directory Structure
- `app/` - Main application code (agent logic, review engine, MCP integrations)
- `conf/` - Configuration files (review rules, platform credentials, thresholds)
- `data/` - SQLite database for review history
- `logs/` - Application logs and decision reasoning

### Key Components
1. **PR Discovery Module** - Connects to VCS platforms, filters PRs (last 7 days, open, unreviewed)
2. **Context Builder** - Clones repos, extracts diffs (±10 lines), analyzes dependencies/coverage/builds
3. **Review Engine** - Analyzes against SOLID principles, OWASP Top 10, performance, 80% test coverage
4. **Output Handler** - Posts inline comments (critical/major/minor), summary with approval decision

## Development Commands

Since this is a Node.js project with Claude Agent SDK, expect:
```bash
npm install              # Install dependencies
npm test                 # Run test suite
npm run lint             # Lint code
npm run dev              # Development mode
npm start                # Production mode
npm run dry-run          # Test reviews without posting
```

## Review Criteria

The agent evaluates PRs against:
- **Design**: SOLID principles, design patterns
- **Security**: OWASP Top 10 vulnerabilities
- **Performance**: Algorithmic complexity (O(n)), database query efficiency
- **Testing**: Minimum 80% test coverage
- **Style**: Language-specific best practices

Review severities: `critical` (blocking), `major` (should fix), `minor` (suggestion)

## Configuration

Configuration file (likely `conf/review-rules.json` or `.yaml`) will define:
- Review rule thresholds (coverage %, complexity limits)
- Platform credentials/tokens
- Repository inclusion/exclusion patterns
- Severity escalation rules

## Database Schema

SQLite database (`data/reviews.db`) stores:
- Review history per PR
- Decision reasoning/rationale
- Previously reviewed PR identifiers
- Review metrics and outcomes

## Implementation Notes

- Use MCP protocol for VCS platform integrations
- Implement parallel repository processing
- Map code changes to architectural components/modules
- Include learning resources in review feedback
- Support dry-run mode for testing without posting comments
- Log all decisions with detailed reasoning for audit trail