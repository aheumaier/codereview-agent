# POC Architecture: Code Review Agent (Simplified)

## Overview

Simple, synchronous, single-threaded execution flow for proof of concept.

```
┌──────────────────────────────────────────────────┐
│              Code Review Agent POC                │
├──────────────────────────────────────────────────┤
│                                                   │
│  CLI → Discover PRs → Build Context → Review     │
│         (via MCP)       (via MCP)    (Claude)    │
│                                                   │
│  → Post Results → Track Reviewed                 │
│     (via MCP)      (JSON file)                   │
│                                                   │
└──────────────────────────────────────────────────┘
```

## Core Principle: Simplicity First

**What makes this POC:**
- No queuing systems
- No caching layers
- No parallel processing
- No complex error handling
- Synchronous execution only
- Direct MCP server usage
- Minimal dependencies

## Directory Structure

```
codereview-agent/
├── app/
│   ├── index.js              # Main entry point
│   ├── discovery.js          # PR discovery via MCP
│   ├── context.js            # Build review context
│   ├── review.js             # Claude-powered review
│   └── output.js             # Post results via MCP
├── conf/
│   └── config.json           # Simple JSON config
├── data/
│   └── reviewed.json         # Tracked PRs (optional)
├── .env                      # Credentials
├── package.json
└── README.md
```

## Component Details

### 1. Main Application (`app/index.js`)

```javascript
import { discoverPRs } from './discovery.js';
import { buildContext } from './context.js';
import { executeReview } from './review.js';
import { postReview } from './output.js';
import { loadConfig } from './config.js';
import { markAsReviewed, wasReviewed } from './tracker.js';

async function main() {
  const config = loadConfig();

  console.log('Starting Code Review Agent POC...');

  // Discover open PRs
  const prs = await discoverPRs(config);
  console.log(`Found ${prs.length} PRs to review`);

  // Process each PR sequentially
  for (const pr of prs) {
    if (wasReviewed(pr)) {
      console.log(`Skipping ${pr.repo}#${pr.number} - already reviewed`);
      continue;
    }

    console.log(`\nReviewing ${pr.repo}#${pr.number}: ${pr.title}`);

    try {
      // Build context
      const context = await buildContext(pr, config);
      console.log(`  - Files changed: ${context.stats.filesChanged}`);

      // Execute review
      const review = await executeReview(context, config);
      console.log(`  - Issues found: ${review.comments.length}`);
      console.log(`  - Decision: ${review.decision}`);

      // Post results
      await postReview(pr, review, config);
      console.log(`  - Review posted ✓`);

      // Track as reviewed
      markAsReviewed(pr);

    } catch (error) {
      console.error(`Failed to review ${pr.repo}#${pr.number}:`, error.message);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
```

### 2. PR Discovery (`app/discovery.js`)

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export async function discoverPRs(config) {
  const allPRs = [];

  // Process each configured platform
  for (const [platform, serverConfig] of Object.entries(config.mcp_servers)) {
    if (!serverConfig.enabled) continue;

    console.log(`Discovering PRs on ${platform}...`);

    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args || [],
      env: { ...process.env, ...serverConfig.env }
    });

    const client = new Client({
      name: 'code-review-agent',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await client.connect(transport);

    // List pull requests via MCP
    const result = await client.callTool({
      name: 'list_pull_requests',
      arguments: {
        state: 'open',
        created_after: new Date(Date.now() - config.review_settings.days_back * 24 * 60 * 60 * 1000).toISOString()
      }
    });

    const prs = JSON.parse(result.content[0].text);

    for (const pr of prs) {
      allPRs.push({
        platform,
        repo: pr.repository,
        number: pr.number,
        id: pr.id,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        baseBranch: pr.base_branch,
        updatedAt: pr.updated_at,
        client // Keep client for later use
      });
    }

    console.log(`  Found ${prs.length} open PRs`);
  }

  return allPRs;
}
```

### 3. Context Builder (`app/context.js`)

```javascript
export async function buildContext(pr, config) {
  const client = pr.client;

  // Get PR diff
  const diffResult = await client.callTool({
    name: 'get_pull_request_diff',
    arguments: {
      pr_number: pr.number
    }
  });

  const diff = JSON.parse(diffResult.content[0].text);

  // Get changed files content (sample up to 10 files for POC)
  const changedFiles = diff.files.slice(0, 10);
  const filesContent = [];

  for (const file of changedFiles) {
    const fileResult = await client.callTool({
      name: 'get_file_content',
      arguments: {
        path: file.path,
        ref: pr.branch
      }
    });

    filesContent.push({
      path: file.path,
      content: fileResult.content[0].text,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes
    });
  }

  return {
    pr: {
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      author: pr.author
    },
    diff: {
      raw: diff.raw_diff,
      files: filesContent
    },
    stats: {
      filesChanged: diff.files.length,
      linesAdded: diff.files.reduce((sum, f) => sum + f.additions, 0),
      linesDeleted: diff.files.reduce((sum, f) => sum + f.deletions, 0)
    }
  };
}
```

### 4. Review Engine (`app/review.js`)

```javascript
import Anthropic from '@anthropic-ai/sdk';

export async function executeReview(context, config) {
  const claude = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY
  });

  // Build review prompt
  const prompt = buildReviewPrompt(context);

  const response = await claude.messages.create({
    model: config.claude.model,
    max_tokens: config.claude.max_tokens,
    temperature: 0.3,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  // Parse Claude's response
  const reviewText = response.content[0].text;
  const jsonMatch = reviewText.match(/```json\n([\s\S]*?)\n```/);

  if (jsonMatch) {
    return JSON.parse(jsonMatch[1]);
  }

  // Fallback parsing
  return parseReviewResponse(reviewText);
}

function buildReviewPrompt(context) {
  return `You are an expert code reviewer. Analyze this pull request and provide a structured review.

## Pull Request
**Repository**: ${context.pr.repo}
**Title**: ${context.pr.title}
**Author**: ${context.pr.author}

## Changes
- Files changed: ${context.stats.filesChanged}
- Lines added: ${context.stats.linesAdded}
- Lines deleted: ${context.stats.linesDeleted}

## Modified Files
${context.diff.files.map(f => `
### ${f.path}
+${f.additions} -${f.deletions}

\`\`\`
${f.content.slice(0, 2000)} ${f.content.length > 2000 ? '...(truncated)' : ''}
\`\`\`
`).join('\n')}

## Review Criteria
Analyze the code for:
1. **Security Issues**: SQL injection, XSS, authentication flaws, exposed secrets
2. **Design Issues**: SOLID principle violations, code smells
3. **Performance Issues**: O(n²) or worse complexity, inefficient queries
4. **Code Quality**: Unclear naming, lack of error handling, duplication

## Response Format
Provide your review in this JSON format:

\`\`\`json
{
  "decision": "approve" | "request-changes" | "comment",
  "summary": "Overall assessment in 2-3 sentences",
  "comments": [
    {
      "file": "path/to/file.js",
      "line": 42,
      "severity": "critical" | "major" | "minor",
      "category": "security" | "performance" | "design" | "quality",
      "message": "Description of the issue",
      "suggestion": "How to fix it"
    }
  ]
}
\`\`\`

**Decision Logic**:
- "request-changes": Any critical issues OR 5+ major issues
- "comment": Major/minor issues but not blocking
- "approve": No significant issues

Provide your review now:`;
}

function parseReviewResponse(text) {
  // Fallback parser if JSON not found
  return {
    decision: 'comment',
    summary: text.slice(0, 200),
    comments: []
  };
}
```

### 5. Output Handler (`app/output.js`)

```javascript
export async function postReview(pr, review, config) {
  if (config.review_settings.dry_run) {
    console.log('\n[DRY RUN] Would post review:');
    console.log(`  Decision: ${review.decision}`);
    console.log(`  Summary: ${review.summary}`);
    console.log(`  Comments: ${review.comments.length}`);
    review.comments.forEach(c => {
      console.log(`    - ${c.file}:${c.line} [${c.severity}] ${c.message}`);
    });
    return;
  }

  const client = pr.client;

  // Map decision to platform event
  const eventMap = {
    'approve': 'APPROVE',
    'request-changes': 'REQUEST_CHANGES',
    'comment': 'COMMENT'
  };

  // Format summary with issue breakdown
  const formattedSummary = formatSummary(review);

  // Post review via MCP
  await client.callTool({
    name: 'create_pull_request_review',
    arguments: {
      pr_number: pr.number,
      event: eventMap[review.decision],
      body: formattedSummary,
      comments: review.comments.map(c => ({
        path: c.file,
        line: c.line,
        body: formatComment(c)
      }))
    }
  });
}

function formatSummary(review) {
  const critical = review.comments.filter(c => c.severity === 'critical').length;
  const major = review.comments.filter(c => c.severity === 'major').length;
  const minor = review.comments.filter(c => c.severity === 'minor').length;

  return `# Code Review Summary

${review.summary}

## Issues Found
- 🚨 Critical: ${critical}
- ⚠️  Major: ${major}
- ℹ️  Minor: ${minor}

${review.comments.length > 0 ? '## Details\nSee inline comments for specific issues.' : '✅ No issues found!'}

---
*Generated by Code Review Agent*`;
}

function formatComment(comment) {
  const icons = {
    critical: '🚨',
    major: '⚠️',
    minor: 'ℹ️'
  };

  return `${icons[comment.severity]} **${comment.severity.toUpperCase()}** - ${comment.category}

${comment.message}

${comment.suggestion ? `### Suggestion\n${comment.suggestion}` : ''}`;
}
```

### 6. Tracking System (`app/tracker.js`)

```javascript
import fs from 'fs';
import path from 'path';

const TRACKING_FILE = path.join(process.cwd(), 'data', 'reviewed.json');

export function wasReviewed(pr) {
  const reviewed = loadReviewed();
  const key = `${pr.platform}:${pr.repo}#${pr.number}`;

  // Check if reviewed and PR hasn't been updated since
  if (reviewed[key]) {
    const reviewedAt = new Date(reviewed[key]);
    const updatedAt = new Date(pr.updatedAt);
    return updatedAt <= reviewedAt;
  }

  return false;
}

export function markAsReviewed(pr) {
  const reviewed = loadReviewed();
  const key = `${pr.platform}:${pr.repo}#${pr.number}`;
  reviewed[key] = new Date().toISOString();
  saveReviewed(reviewed);
}

function loadReviewed() {
  try {
    if (fs.existsSync(TRACKING_FILE)) {
      return JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf-8'));
    }
  } catch (error) {
    console.warn('Failed to load tracking file:', error.message);
  }
  return {};
}

function saveReviewed(data) {
  try {
    fs.mkdirSync(path.dirname(TRACKING_FILE), { recursive: true });
    fs.writeFileSync(TRACKING_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to save tracking file:', error.message);
  }
}
```

## Configuration

### `conf/config.json`

```json
{
  "mcp_servers": {
    "github": {
      "enabled": true,
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "gitlab": {
      "enabled": true,
      "command": "npx",
      "args": ["-y", "@zereight/mcp-gitlab"],
      "env": {
        "GITLAB_TOKEN": "${GITLAB_TOKEN}",
        "GITLAB_URL": "https://gitlab.com"
      }
    },
    "bitbucket": {
      "enabled": false,
      "command": "npx",
      "args": ["-y", "@aashari/mcp-server-atlassian-bitbucket"],
      "env": {
        "BITBUCKET_USERNAME": "${BITBUCKET_USERNAME}",
        "BITBUCKET_APP_PASSWORD": "${BITBUCKET_APP_PASSWORD}"
      }
    }
  },
  "review_settings": {
    "days_back": 7,
    "dry_run": false
  },
  "claude": {
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 4096
  }
}
```

### `.env`

```bash
CLAUDE_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
GITLAB_TOKEN=glpat-...
BITBUCKET_USERNAME=user
BITBUCKET_APP_PASSWORD=app-password
```

## Dependencies

### `package.json`

```json
{
  "name": "code-review-agent",
  "version": "0.1.0",
  "type": "module",
  "description": "POC: Automated code review using Claude and MCP",
  "main": "app/index.js",
  "scripts": {
    "start": "node app/index.js",
    "dry-run": "node app/index.js --dry-run"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "dotenv": "^16.4.0"
  }
}
```

## Setup & Usage

### Installation

```bash
# Clone repository
git clone <repo-url>
cd codereview-agent

# Install dependencies
npm install

# Configure
cp .env.example .env
# Edit .env with your tokens

# Edit conf/config.json if needed
```

### Running

```bash
# Test with dry run (no posting)
npm run dry-run

# Run actual reviews
npm start
```

### Expected Output

```
Starting Code Review Agent POC...
Discovering PRs on github...
  Found 3 open PRs
Discovering PRs on gitlab...
  Found 2 open PRs
Found 5 PRs to review

Reviewing myorg/myrepo#123: Add new feature
  - Files changed: 5
  - Issues found: 3
  - Decision: comment
  - Review posted ✓

Reviewing myorg/myrepo#124: Fix bug
  - Files changed: 2
  - Issues found: 0
  - Decision: approve
  - Review posted ✓

Done!
```

## What's NOT Included (Intentionally)

For POC simplification:

- ❌ Queueing (BullMQ, Redis)
- ❌ Parallel processing
- ❌ Rate limiting (MCP handles it)
- ❌ Retry mechanisms
- ❌ Database (SQLite)
- ❌ Repository cloning
- ❌ Dependency analysis
- ❌ Coverage calculation
- ❌ Custom rule engine
- ❌ Template system
- ❌ Metrics collection
- ❌ Error boundaries
- ❌ Docker deployment
- ❌ Health checks
- ❌ TypeScript compilation

**Why?** These are production concerns. POC proves the concept works first.

## Success Criteria for POC

✅ Discovers open PRs via MCP servers
✅ Retrieves PR diffs and file contents
✅ Sends context to Claude for analysis
✅ Receives structured review from Claude
✅ Posts review comments back to PRs
✅ Tracks reviewed PRs to avoid duplicates
✅ Works with GitHub, GitLab, and Bitbucket

## Next Steps After POC

**If POC succeeds**, consider adding:

1. **Phase 1** (Week 2-3):
   - Simple SQLite database (1-2 tables)
   - Basic web UI to view reviews
   - Configuration per repository

2. **Phase 2** (Month 2):
   - Add rate limiting if hitting API limits
   - Implement retry for failed reviews
   - Add more sophisticated prompts

3. **Phase 3** (Month 3+):
   - Queue system if volume requires it
   - Metrics for monitoring
   - Advanced rule customization

## Key Differences from Full Architecture

| Aspect | POC | Production |
|--------|-----|------------|
| Execution | Synchronous | Async/Queue |
| Storage | JSON file | SQLite/Postgres |
| Error Handling | Basic try/catch | Retry + fallback |
| Deployment | Local Node.js | Docker/K8s |
| Monitoring | console.log | Metrics/traces |
| Dependencies | 3 packages | 40+ packages |
| Lines of Code | ~500 | ~2500 |
| Setup Time | 15 minutes | 2+ hours |

## Conclusion

This POC architecture eliminates 90% of the complexity while maintaining 100% of the core functionality needed to validate the concept. It can be built in days instead of weeks and provides clear proof that Claude can effectively review code via MCP integration.

Once validated, thoughtful additions can be made based on real needs rather than anticipated problems.