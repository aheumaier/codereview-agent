# Code Review Agent

Automated code review agent using Claude AI and Model Context Protocol (MCP) for GitLab, GitHub, and Bitbucket.

## Features

- 🔍 **Automatic PR Discovery**: Finds open pull requests from the last 7 days
- 🧠 **AI-Powered Reviews**: Uses Claude 3 Opus for intelligent code analysis
- 📝 **Inline Comments**: Posts specific feedback directly on code lines
- 🎯 **Quality Checks**: SOLID principles, OWASP security, performance analysis
- 📊 **Review Tracking**: SQLite database prevents duplicate reviews
- 🔒 **Dry-Run Mode**: Test reviews without posting to PRs

## Quick Start

### Prerequisites

- Node.js 18+
- Claude API key from Anthropic
- GitLab/GitHub/Bitbucket access tokens
- MCP server implementations (optional)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd codereview-agent

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### Configuration

Edit `.env` file with your credentials:

```bash
# Required
CLAUDE_API_KEY=sk-ant-your-key-here

# GitLab (if using)
GITLAB_TOKEN=glpat-your-token
GITLAB_URL=https://gitlab.com

# GitHub (if using)
GITHUB_TOKEN=ghp-your-token

# Bitbucket (if using)
BITBUCKET_USERNAME=your-username
BITBUCKET_APP_PASSWORD=your-app-password

# Settings
DRY_RUN=true  # Set to false to post reviews
```

### Usage

```bash
# Run in dry-run mode (default)
npm start

# Run with live posting
DRY_RUN=false npm start

# Run in development mode with watch
npm run dev

# Run tests
npm test

# Run E2E tests
npm run test:e2e
```

## Configuration Details

The agent is configured via `conf/config.json`:

```json
{
  "review": {
    "maxDaysBack": 7,        // How far back to look for PRs
    "prStates": ["open"],    // PR states to review
    "excludeLabels": ["wip", "draft"], // Skip PRs with these labels
    "minCoveragePercent": 80, // Minimum test coverage required
    "maxComplexity": 10      // Maximum cyclomatic complexity
  },
  "platforms": {
    "gitlab": {
      "enabled": true,       // Enable/disable platform
      "token": "${GITLAB_TOKEN}", // Uses environment variable
      "url": "${GITLAB_URL}"
    }
  },
  "output": {
    "dryRun": "${DRY_RUN}",  // Dry-run mode from env
    "postComments": true,     // Post inline comments
    "postSummary": true,      // Post review summary
    "approveIfNoIssues": false // Auto-approve clean PRs
  }
}
```

## Architecture

The code review agent uses a 4-phase architecture with specialized sub-agents for comprehensive analysis:

### Review Phases

1. **Context Gathering**: Retrieve PR metadata, diffs, and repository context
2. **Parallel Analysis**: Run specialized sub-agents concurrently
   - Test Analysis Agent - Test coverage and quality analysis
   - Security Analysis Agent - OWASP Top 10 vulnerability detection
   - Performance Analysis Agent - Algorithmic complexity and performance
   - Architecture Compliance Agent - SOLID principles and design patterns
3. **Synthesis**: Aggregate findings, resolve conflicts, make decision
4. **Platform Interaction**: Post comments and summary

### Sub-Agents

Sub-agents are defined in `.claude/agents/` using Claude Agent SDK patterns:

- `test-analyzer.md` - Analyzes test coverage, quality, and missing test scenarios
- `security-analyzer.md` - Detects security vulnerabilities per OWASP Top 10
- `performance-analyzer.md` - Identifies algorithmic complexity and performance bottlenecks
- `architecture-analyzer.md` - Validates SOLID principles and design patterns

Each agent operates independently in parallel and returns structured findings in JSON format.

### State Management

Review state is persisted in `data/states/` for:
- **Resilience**: Resume reviews on failure
- **Re-review Detection**: Track reviewed PRs to avoid duplicates
- **Audit Trail**: Maintain checkpoint history for debugging

State transitions: `context_gathering → parallel_analysis → synthesis → output → complete`

## Review Process

1. **Discovery**: Finds PRs from enabled platforms (last 7 days, open state)
2. **Tracking**: Checks if PR was already reviewed (skips if unchanged)
3. **Context Building**: Retrieves diff and file contents via MCP
4. **Analysis**: Claude reviews code for:
   - SOLID principle violations
   - Security vulnerabilities (OWASP Top 10)
   - Performance issues
   - Test coverage
   - Code duplication
5. **Output**: Posts review as PR comments (unless in dry-run mode)
6. **Tracking**: Marks PR as reviewed in SQLite database

## Review Severities

- 🔴 **Critical**: Security vulnerabilities, data loss risks
- 🟡 **Major**: Performance issues, missing tests, design problems
- 🔵 **Minor**: Style issues, suggestions, improvements

## Feature Flags

Control feature rollout and experimentation via `conf/config.json`:

```json
{
  "features": {
    "useStateManagement": true,    // Enable state persistence
    "useSubAgents": true,          // Use parallel sub-agents
    "useDecisionMatrix": true,     // Use decision matrix for approvals
    "legacyMode": false            // Fall back to single-agent mode
  },
  "rollout": {
    "experimentalFeature": 50      // 50% gradual rollout
  }
}
```

### Rollout Mechanism

Features in the `rollout` section use percentage-based gradual deployment:
- `0%` = disabled for all PRs
- `50%` = enabled for 50% of PRs (deterministic by PR ID)
- `100%` = enabled for all PRs

The rollout is deterministic - the same PR will always get the same feature state.

## Platform Support

### GitLab (Fully Implemented)
- Discovers merge requests
- Gets diffs and file contents
- Posts inline comments on code
- Posts review summaries
- Can approve MRs

### GitHub (Stub - To Be Implemented)
- Returns empty PR list
- Placeholder for future implementation

### Bitbucket (Stub - To Be Implemented)
- Returns empty PR list
- Placeholder for future implementation

## MCP Integration

The agent uses Model Context Protocol (MCP) to interact with version control platforms:

1. Install MCP server for your platform (e.g., `@zereight/mcp-gitlab`)
2. Configure the path in `config.json` or environment variables
3. The agent will spawn MCP servers as needed for API interactions

## Database Schema

Reviews are tracked in SQLite (`data/reviews.db`):

```sql
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  platform TEXT,
  repository TEXT,
  pr_id TEXT,
  sha TEXT,
  reviewed_at DATETIME,
  decision TEXT,
  summary TEXT,
  comments_count INTEGER,
  issues_found INTEGER
);
```

## Rollback Procedures

### Emergency Rollback

If issues arise with the new sub-agent architecture, follow these steps:

1. **Disable new features immediately**:
   ```json
   // In conf/config.json
   {
     "features": {
       "useSubAgents": false,
       "useStateManagement": false,
       "legacyMode": true
     }
   }
   ```

2. **Revert to previous stable version**:
   ```bash
   # Identify last stable commit
   git log --oneline -10

   # Revert recent changes (adjust number as needed)
   git revert HEAD~3

   # Reinstall dependencies
   npm install

   # Run tests to verify
   npm test

   # Restart agent
   npm start
   ```

3. **Notify team** of rollback with reason and impact assessment

### Data Recovery

If state corruption occurs in `data/states/`:

```bash
# Backup corrupted states
cp -r data/states data/states.backup.$(date +%Y%m%d-%H%M%S)

# Clear state directory
rm -rf data/states/*

# Reviews will restart from scratch
# Agent will rebuild state as it processes PRs
```

### Performance Degradation

If sub-agents cause timeout issues:

1. **Reduce parallelism**: Set `useSubAgents: false` in config
2. **Check Claude API limits**: Monitor rate limiting responses
3. **Review agent logs**: Check `logs/` for timeout patterns

## Testing

```bash
# Unit tests (Jest)
npm test

# Watch mode
npm run test:watch

# E2E tests (Playwright)
npm run test:e2e

# Linting
npm run lint
```

## Project Structure

```
codereview-agent/
├── app/
│   ├── index.js        # Main orchestrator
│   ├── config.js       # Configuration loader
│   ├── discovery.js    # PR discovery
│   ├── context.js      # Context builder
│   ├── review.js       # Claude integration
│   ├── output.js       # Review posting
│   └── tracker.js      # Review tracking
├── conf/
│   └── config.json     # Configuration file
├── tests/
│   ├── unit/          # Unit tests
│   └── e2e/           # Integration tests
├── data/              # SQLite database
└── logs/              # Application logs
```

## Troubleshooting

### Common Issues

#### No PRs Found
- Check platform is enabled in config
- Verify access tokens are valid
- Ensure PRs exist in date range

#### Review Fails
- Verify Claude API key is valid
- Check API rate limits
- Review error logs for details

#### Comments Not Posting
- Ensure DRY_RUN=false
- Check platform permissions
- Verify MCP server is accessible

### Sub-Agent Issues

#### Sub-agent not found
**Symptom**: `Error: Agent 'test-analyzer' not found`

**Solution**:
```bash
# Verify agent file exists
ls .claude/agents/test-analyzer.md

# Check YAML frontmatter is valid
head -n 10 .claude/agents/test-analyzer.md

# Ensure file has correct structure:
# ---
# description: Agent description
# model: sonnet
# tools:
#   - Read
#   - Grep
# ---
```

#### State persistence fails
**Symptom**: `Error: ENOENT: no such file or directory, open 'data/states/...'`

**Solution**:
```bash
# Create state directory
mkdir -p data/states

# Check permissions
chmod 755 data/states

# Verify write access
touch data/states/test && rm data/states/test
```

#### Parallel analysis timeout
**Symptom**: Review takes >5 minutes or times out

**Solution**:
1. Check Claude API rate limits in logs
2. Reduce parallelism in config:
   ```json
   { "features": { "useSubAgents": false } }
   ```
3. Check individual agent timeouts in `SubAgentOrchestrator`
4. Review network connectivity to Claude API

#### Conflicting review findings
**Symptom**: Same issue reported multiple times or contradictory feedback

**Solution**:
1. Check synthesis logic in `ReviewSynthesizer`
2. Verify deduplication is working
3. Review agent prompts for overlapping responsibilities
4. Check `DecisionMatrix` thresholds

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| CLAUDE_API_KEY | Anthropic API key | Yes |
| GITLAB_TOKEN | GitLab personal access token | If using GitLab |
| GITLAB_URL | GitLab instance URL | If using GitLab |
| GITHUB_TOKEN | GitHub personal access token | If using GitHub |
| BITBUCKET_USERNAME | Bitbucket username | If using Bitbucket |
| BITBUCKET_APP_PASSWORD | Bitbucket app password | If using Bitbucket |
| DRY_RUN | Run without posting (true/false) | No (default: true) |
| MCP_GITLAB_PATH | Path to GitLab MCP server | If using GitLab |

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests first (TDD)
4. Implement features
5. Ensure all tests pass
6. Submit a pull request

## Support

For issues or questions, please open an issue on the repository.