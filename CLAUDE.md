# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an automated code review agent built using Claude Agent SDK (Node.js) that:
- Discovers PRs from version control platforms via MCP (GitHub, GitLab, Bitbucket)
- Analyzes code changes for quality, security, and best practices
- Posts inline comments and review summaries directly on PRs
- Maintains review history in SQLite database

## Development Commands

```bash
npm install              # Install dependencies
npm test                 # Run test suite with coverage
npm run test:watch       # Run tests in watch mode
npm run test:e2e         # Run E2E tests with Playwright
npm run lint             # Lint code
npm run dev              # Development mode with auto-reload
npm start                # Production mode
npm run dry-run          # Test reviews without posting (DRY_RUN=true)
```

### Running Specific Tests
```bash
# Run single test file
npm test tests/unit/review.test.js

# Run tests matching pattern
npm test -- --testNamePattern="parallel reviews"

# Run with Node debugging
NODE_ENV=test node --inspect-brk node_modules/.bin/jest --runInBand
```

## Architecture

### High-Level Flow (4-Phase Architecture)
The agent follows a 4-phase review pipeline:

1. **Context Gathering Phase**
   - **Discovery** (`app/discovery.js`) - Fetches PRs from enabled platforms
   - **Tracking** (`app/tracker.js`) - Checks SQLite DB to skip already-reviewed PRs
   - **Context Building** (`app/context.js`) - Retrieves diffs and file contents via MCP

2. **Parallel Analysis Phase**
   - **Sub-Agent Orchestration** (`app/sub-agent-orchestrator.js`) - Runs specialized agents concurrently
   - **Parallel Execution** - Each agent analyzes independently with isolated context
   - **Timeout Management** - Individual agent timeouts prevent cascade failures

3. **Synthesis Phase**
   - **Finding Aggregation** (`app/review-synthesizer.js`) - Merges findings from all agents
   - **Conflict Resolution** - Deduplicates and prioritizes overlapping issues
   - **Decision Making** (`app/decision-matrix.js`) - Determines approval status

4. **Platform Interaction Phase**
   - **Output** (`app/output.js`) - Posts comments/summary to PR via MCP
   - **State Persistence** (`app/state-manager.js`) - Saves review state for resilience

### Parallel Review System (MECE Merge)

The review engine supports **parallel reviews with MECE (Mutually Exclusive, Collectively Exhaustive) merging**:

- **Dual-temperature reviews**: Runs 2 reviews concurrently with temperatures `[0, 0.3]` (deterministic + creative)
- **Synthesis via Claude**: Uses Claude SDK to intelligently merge duplicate comments
- **38% deduplication efficiency**: Better than similarity-based approaches (30%)
- **Error boundaries**: Individual review failures don't cascade (Promise.all with .catch)
- **Fallback strategy**: Returns first successful review if merge fails

Configuration in `conf/config.json`:
```json
"parallelReviews": {
  "enabled": true,
  "temperatures": [0, 0.3]
}
```

**Critical Implementation Detail**: Review metadata (`_reviewNumber`, `_temperature`) must be cleaned up before returning merged results to prevent memory leaks and exposing internals in posted comments. See `review.js:312-314` and `review.js:322-325`.

### MCP Integration Pattern

The agent uses **Model Context Protocol (MCP)** to interact with VCS platforms:

1. **MCP Server Spawning**: `app/mcp-utils.js` spawns platform-specific MCP servers as child processes
2. **Client Management**: Creates stdio-based MCP clients with connection lifecycle handling
3. **Tool Invocation**: Calls MCP tools like `mcp__gitlab__get_merge_request_diffs`
4. **Response Parsing**: Extracts content from MCP response format

**Example MCP Flow**:
```javascript
// Spawn GitLab MCP server
const { client, transport } = await createConnectedGitLabClient(config.platforms.gitlab);

// Call MCP tool
const response = await client.request({
  method: 'tools/call',
  params: {
    name: 'mcp__gitlab__get_merge_request_diffs',
    arguments: { project_id: 'foo/bar', merge_request_iid: '123' }
  }
});

// Parse response
const diffs = parseMCPResponse(response);
```

### Configuration System

Configuration uses **environment variable substitution**:
- Pattern: `"${ENV_VAR_NAME}"` in `conf/config.json`
- Resolution: `app/config.js` replaces at runtime
- Fallback: Uses raw string if env var not set

**Example**:
```json
{
  "claude": {
    "apiKey": "${CLAUDE_API_KEY}",  // Replaced with process.env.CLAUDE_API_KEY
    "model": "claude-sonnet-4-5-20250929",
    "tier": 1  // Claude API tier (1-4) for rate limiting
  },
  "review": {
    "maxTokensPerPR": 50000,  // Token budget per PR
    "adaptiveExecution": {
      "enabled": true,
      "thresholds": {
        "smallFiles": 10,
        "smallLOC": 500,
        "mediumFiles": 30,
        "mediumLOC": 2000,
        "largeFiles": 100,
        "largeLOC": 5000,
        "complexityThreshold": 0.7
      }
    }
  }
}
```

### Review Prompt Template

The review prompt is loaded from `data/promt.md` (note: typo in filename is intentional for backwards compatibility):
- **Lazy loading**: Cached in `Review.getPromptTemplate()` on first use
- **Senior reviewer persona**: 15+ years experience, security-focused
- **False positive prevention**: Explicit rules to avoid flagging official SDKs, parameters as hardcoded values
- **Verification requirements**: Must trace variable flow, verify line numbers before flagging issues

### Error Handling Architecture

**Retry Logic** (`app/utils/retry.js`):
- Exponential backoff with jitter
- Configurable max retries (default: 3)
- Custom retry predicates for rate limiting (429, 529 status codes)
- Tracks retry attempts for logging

**Error Boundaries**:
- Parallel reviews use `.catch()` to prevent cascade failures
- Each module wraps errors with context (platform, tool, config key)
- Top-level handler in `app/index.js` provides error-specific messaging

### Database Schema

SQLite database (`data/reviews.db`) prevents duplicate reviews:

```sql
CREATE TABLE reviews (
  platform TEXT,
  repository TEXT,
  pr_id TEXT,
  sha TEXT,
  reviewed_at DATETIME,
  pr_updated_at DATETIME,
  decision TEXT,
  summary TEXT,
  comments_json TEXT,
  UNIQUE(platform, repository, pr_id, pr_updated_at)
);
```

**Key behavior**: Re-reviews PR only if `pr_updated_at` timestamp changes (indicates new commits).

## Testing Infrastructure

### Jest Configuration

**Babel Transformation** (required for ESM):
- `jest.config.js` uses `babel-jest` to transform ES modules
- `.babelrc` configured with `@babel/preset-env` targeting Node 18
- `modules: "auto"` allows Babel to handle module transformation

**Critical Testing Patterns**:

1. **Mock Hoisting for MCP SDK**:
   ```javascript
   // Mocks MUST come before imports
   jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
     Client: jest.fn()
   }));

   // NOW safe to import
   import Output from '../../app/output.js';
   ```

2. **Dependency Injection**:
   - Export classes, not singletons: `export default Review` (not `new Review()`)
   - Tests instantiate fresh instances: `review = new Review()`
   - Mock client injection: `review.anthropic = mockClient`

3. **Timer Handling**:
   - Most tests use `jest.useFakeTimers()` for retry logic
   - Some retry tests require `jest.useRealTimers()` to avoid timing issues
   - Always restore timers in `afterEach()`

4. **Import.meta.url Limitation**:
   - `app/config.js` uses `import.meta.url` for file paths
   - Jest cannot handle this even with babel-plugin-transform-import-meta
   - Solution: Skip config tests, validate via integration tests instead

### Test Coverage Requirements

- **Target**: 80% coverage (statements, branches, functions, lines)
- **Current**: `review.js` at 94.4% statements, 83.01% branches
- **Exemptions**: `app/config.js` (import.meta.url issues), `app/index.js` (E2E tested)

## Review Criteria

The agent evaluates PRs against:
- **Design**: SOLID principles, design patterns
- **Security**: OWASP Top 10 vulnerabilities (verified, not assumed)
- **Performance**: Algorithmic complexity (O(n)), database query efficiency
- **Testing**: Minimum 80% test coverage
- **Style**: Language-specific best practices

Review severities: `critical` (blocking), `major` (should fix), `minor` (suggestion)

## Platform-Specific Implementation Status

### GitLab (Fully Implemented)
- MCP server: `@zereight/mcp-gitlab` or similar
- Discovers merge requests via `mcp__gitlab__list_merge_requests`
- Gets diffs via `mcp__gitlab__get_merge_request_diffs`
- Posts comments via `mcp__gitlab__create_merge_request_thread`
- Posts summary via `mcp__gitlab__create_note`

### GitHub (Stub)
- `app/discovery.js`: Returns empty array `[]`
- Placeholder for future MCP implementation

### Bitbucket (Stub)
- `app/discovery.js`: Returns empty array `[]`
- Placeholder for future MCP implementation

## Sub-Agent Development

### Sub-Agent Architecture

This project uses specialized AI agents for focused analysis tasks. Each agent is responsible for a specific aspect of code review.

### Adding New Sub-Agents

1. **Create agent definition** in `.claude/agents/`:
   ```yaml
   ---
   description: Analyzes code for specific concerns
   model: sonnet
   tools:
     - Read
     - Grep
     - Glob
   ---

   You are a specialized code analysis agent focused on [specific area].

   Analyze the provided code changes and return findings in JSON format...
   ```

2. **Register in SubAgentOrchestrator** (`app/sub-agent-orchestrator.js`):
   ```javascript
   const agentTasks = [
     { agent: 'your-analyzer', category: 'your_category' },
     // ... other agents
   ];
   ```

3. **Add unit tests** in `tests/unit/sub-agent-orchestrator.test.js`

### Agent Output Format

All sub-agents must return structured JSON conforming to this schema:

```json
{
  "findings": [
    {
      "file": "path/to/file.js",
      "line": 42,
      "severity": "critical|major|minor",
      "category": "test|security|performance|architecture",
      "message": "Clear description of the issue",
      "suggestion": "Actionable fix recommendation",
      "confidence": 0.95  // Optional: 0-1 confidence score
    }
  ],
  "metrics": {
    // Agent-specific metrics
    "testsAnalyzed": 10,
    "coveragePercent": 85.5
  },
  "summary": "Optional high-level summary of analysis"
}
```

### State-Managed Review Flow

When implementing features that interact with reviews:

1. **Load existing state** if resuming:
   ```javascript
   const stateManager = new StateManager('data/states');
   const state = await stateManager.loadState(prId);
   ```

2. **Follow phase transitions**:
   ```javascript
   // Valid transitions
   await state.transitionTo('context_gathering');
   await state.transitionTo('parallel_analysis');
   await state.transitionTo('synthesis');
   await state.transitionTo('output');
   await state.transitionTo('complete');
   ```

3. **Checkpoint after each phase**:
   ```javascript
   state.data.context = contextData;
   await stateManager.saveState(state);
   ```

4. **Handle partial failures gracefully**:
   ```javascript
   // Some agents can fail without blocking review
   const results = await Promise.allSettled(agentPromises);
   const successfulResults = results
     .filter(r => r.status === 'fulfilled')
     .map(r => r.value);
   ```

### Feature Flag Usage

Check feature flags before using new functionality:

```javascript
const featureFlags = FeatureFlags.fromConfig(config);

// Simple feature check
if (featureFlags.isEnabled('useSubAgents')) {
  // Use sub-agent architecture
  const orchestrator = new SubAgentOrchestrator();
  findings = await orchestrator.analyzeInParallel(context);
} else {
  // Fall back to legacy single-agent mode
  findings = await review.analyzeSingle(context);
}

// Rollout percentage check (deterministic by PR)
if (featureFlags.isEnabledForPR('experimentalFeature', pr.id)) {
  // Use experimental feature for this specific PR
  // Same PR always gets same decision (stable)
}
```

### Review Decision Matrix

The DecisionMatrix determines approval status based on finding severity:

```javascript
// Thresholds configured in conf/config.json
const decision = decisionMatrix.makeDecision(findings, metrics);

// Decision logic:
// - Any critical findings → 'changes_requested'
// - >3 major findings → 'needs_work'
// - Coverage delta < -5% → 'needs_work'
// - Only minor issues → 'approved_with_comments'
// - No issues → 'approved'
```

Configure thresholds in `conf/config.json`:
```json
{
  "decisionMatrix": {
    "maxMajorIssues": 3,
    "minCoverageDelta": -5,
    "blockOnCritical": true
  }
}
```

### Parallel Execution Best Practices

1. **Isolate agent context**: Each agent gets its own context copy
2. **Set reasonable timeouts**: Default 30s per agent
3. **Handle failures gracefully**: Use Promise.allSettled()
4. **Log individual agent errors**: Don't let one failure hide others
5. **Implement retry logic**: For transient API failures

### Adaptive Execution Strategy

The agent uses an adaptive execution strategy (`app/utils/adaptive-execution.js`) that selects the optimal review mode based on PR characteristics:

**Execution Modes**:
- `SEQUENTIAL`: Small PRs (<10 files, <500 LOC) - token efficiency prioritized
- `PARALLEL`: Medium PRs with high complexity - faster reviews
- `INCREMENTAL_BATCH`: Large PRs (30-100 files) - prevents context overflow
- `REJECT_TOO_LARGE`: PRs exceeding thresholds - require splitting

**Complexity Factors** (0-1 score):
- Security-sensitive files (+0.3): auth, crypto, session, password
- Architectural changes (+0.3): schema, migration, config, API routes
- Breaking changes (+0.4): keywords in PR description
- Low test coverage (+0.2): <30% test files
- Large file changes (+0.1): >500 LOC in single file
- Dependency changes (+0.2): package.json, requirements.txt, etc.

**Usage**:
```javascript
import { AdaptiveExecutionStrategy, ExecutionMode } from './utils/adaptive-execution.js';

const strategy = new AdaptiveExecutionStrategy(config);
const decision = strategy.selectStrategy(pr);

if (decision.mode === ExecutionMode.PARALLEL) {
  // Run parallel review
} else if (decision.mode === ExecutionMode.SEQUENTIAL) {
  // Run sequential review
}
```

### Rate Limiting & Token Management

**Token Bucket Rate Limiter** (`app/utils/rate-limiter.js`):
- Implements client-side token bucket algorithm matching Claude API behavior
- Prevents 429 errors through proactive throttling
- Tracks three metrics: RPM (requests/min), ITPM (input tokens/min), OTPM (output tokens/min)
- Continuous refill model (not fixed windows)

**Configuration by Claude API Tier**:
```javascript
const limits = {
  1: { rpm: 50, itpm: 30000, otpm: 8000 },
  2: { rpm: 100, itpm: 60000, otpm: 16000 },
  3: { rpm: 300, itpm: 150000, otpm: 40000 },
  4: { rpm: 500, itpm: 300000, otpm: 80000 }
};
```

**Usage**:
```javascript
import { createRateLimiters } from './utils/rate-limiter.js';

const { rpm, itpm, otpm } = createRateLimiters(config);

// Acquire tokens before API call
await itpm.acquire(estimatedInputTokens);
await otpm.acquire(estimatedOutputTokens);
await rpm.acquire(1);

// Make API call
const response = await anthropic.messages.create(...);
```

**Token Budget Manager** (`app/utils/token-budget-manager.js`):
- Tracks token usage per PR and per agent
- Enforces maximum token budget per review
- Pre-flight checks with 20% safety margin
- Provides detailed usage reports and agent breakdown

**Usage**:
```javascript
import TokenBudgetManager from './utils/token-budget-manager.js';

const budget = new TokenBudgetManager(50000); // 50k token limit

// Wrap API calls
const response = await budget.trackCall(
  'security-analyzer',
  () => anthropic.messages.create(...),
  estimatedTokens
);

// Get usage report
const report = budget.getReport();
console.log(`Used ${report.percentUsed} of budget`);
```

### Validator Agent (MECE Consolidation)

The validator agent (`.claude/agents/validator.md`) performs **Mutually Exclusive, Collectively Exhaustive** consolidation of findings from all sub-agents:

**Key Responsibilities**:
1. **MECE Categorization**: Ensures each finding belongs to exactly one category
2. **Deduplication**: Merges findings for same file/line with semantic similarity
3. **Confidence Validation**: Filters low-confidence findings (thresholds: critical=always keep, major>=0.7, minor>=0.8)
4. **False Positive Filtering**: Removes SDK methods, config parameters, test mocks
5. **Severity Validation**: Ensures accurate severity levels

**Output Format**:
```json
{
  "findings": [
    {
      "file": "path/to/file.js",
      "line": 42,
      "severity": "critical",
      "category": "security",
      "message": "Clear description",
      "suggestion": "Specific fix",
      "evidence": ["agent1: ...", "agent2: ..."],
      "confidence": 0.95,
      "sources": ["security-analyzer", "architecture-analyzer"]
    }
  ],
  "validationStats": {
    "totalInputFindings": 50,
    "duplicatesRemoved": 15,
    "lowConfidenceFiltered": 8,
    "falsePositivesRemoved": 3,
    "finalCount": 24
  }
}
```

### Code Churn Analysis (Utility Scripts)

**Bash Churn Analysis** (`scripts/churn-analysis.sh`):
```bash
# Analyze file churn over time period
./scripts/churn-analysis.sh --period "3 months" --threshold 5

# Outputs files changed more than threshold times
```

**.NET Namespace Churn** (`scripts/dotnet-namespace-churn.py`):
```bash
# Analyze namespace-level churn for .NET projects
python3 scripts/dotnet-namespace-churn.py --period "1 month" --threshold 1

# Useful for identifying architectural hotspots
```

**Integration with Review Process**:
- High churn files may indicate technical debt
- Can trigger more thorough architectural reviews
- Helps prioritize refactoring efforts

## Common Pitfalls

1. **Memory Leak**: Always delete `_reviewNumber` and `_temperature` from review objects before returning
2. **Mock Order**: MCP SDK mocks must be hoisted before imports in test files
3. **Singleton Pattern**: Don't export singleton instances - breaks testing with fresh state
4. **Config Validation**: `app/config.js` tests fail due to import.meta.url - use integration tests
5. **Dry-Run Mode**: Check `config.output.dryRun` to avoid polluting review history database
6. **Agent Output Format**: Ensure all agents return valid JSON with required fields
7. **State Corruption**: Always use atomic writes when saving state files
8. **Feature Flag Caching**: Feature flags are evaluated per-PR, don't cache globally
9. **Rate Limiter Sequence**: Always acquire rate limiter tokens BEFORE making API calls, not after
10. **Token Budget Rollback**: Budget manager auto-rolls back on API call failures - don't manually adjust
11. **Adaptive Strategy PR Format**: Ensure PR object has `files` array with `additions`/`deletions` for proper strategy selection
12. **Validator Agent Confidence**: Don't blindly trust confidence scores - validator may adjust based on multiple agent consensus
13. **Churn Analysis Path**: Run churn scripts from repository root, not from scripts directory
14. **Budget Exceeded Errors**: Catch `TokenBudgetExceededError` separately from generic errors for graceful degradation
