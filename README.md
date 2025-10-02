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

### No PRs Found
- Check platform is enabled in config
- Verify access tokens are valid
- Ensure PRs exist in date range

### Review Fails
- Verify Claude API key is valid
- Check API rate limits
- Review error logs for details

### Comments Not Posting
- Ensure DRY_RUN=false
- Check platform permissions
- Verify MCP server is accessible

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