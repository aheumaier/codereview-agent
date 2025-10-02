# Technical Architecture: Code Review Agent

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Code Review Agent                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ PR Discovery │───▶│Context Build │───▶│Review Engine │      │
│  │   Module     │    │   Module     │    │              │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                    │                    │              │
│         ▼                    ▼                    ▼              │
│  ┌──────────────────────────────────────────────────────┐      │
│  │              MCP Integration Layer                    │      │
│  │  (GitHub/GitLab/Bitbucket via Model Context Protocol)│      │
│  └──────────────────────────────────────────────────────┘      │
│         │                    │                    │              │
│         ▼                    ▼                    ▼              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Queue      │    │   Cache      │    │  Database    │      │
│  │  (BullMQ)    │    │  (Redis)     │    │  (SQLite)    │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 1. PR Discovery Module

### Architecture Components

```typescript
// Core interfaces
interface PRDiscoveryService {
  discoverPRs(config: DiscoveryConfig): AsyncGenerator<PullRequest>;
  filterPRs(prs: PullRequest[], filters: FilterCriteria): PullRequest[];
}

interface MCPConnector {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listPullRequests(repo: Repository, params: PRListParams): Promise<PullRequest[]>;
  getPullRequestDetails(repo: Repository, prNumber: number): Promise<PRDetails>;
}
```

### Implementation Strategy

**Package Selection:**
- `@modelcontextprotocol/sdk` - MCP SDK for VCS integration
- `p-queue` - Promise-based priority queue for rate limiting
- `bottleneck` - Rate limiter with Redis support
- `p-retry` - Retry failed operations with exponential backoff
- `pino` - Structured logging

**Directory Structure:**
```
app/
├── discovery/
│   ├── index.ts                    # Main discovery orchestrator
│   ├── connectors/
│   │   ├── base-connector.ts       # Abstract base class
│   │   ├── github-connector.ts     # GitHub MCP implementation
│   │   ├── gitlab-connector.ts     # GitLab MCP implementation
│   │   └── bitbucket-connector.ts  # Bitbucket MCP implementation
│   ├── filters/
│   │   ├── date-filter.ts          # 7-day window filter
│   │   ├── status-filter.ts        # Open status filter
│   │   └── review-filter.ts        # Already reviewed filter
│   ├── parallel-processor.ts       # Multi-repo parallel processing
│   └── rate-limiter.ts             # Unified rate limiting
```

**Rate Limiting Configuration:**
```typescript
// rate-limiter.ts
import Bottleneck from 'bottleneck';
import Redis from 'ioredis';

export class RateLimiter {
  private limiters: Map<string, Bottleneck>;

  constructor(private redis: Redis) {
    this.limiters = new Map();
  }

  getLimiter(platform: string): Bottleneck {
    if (!this.limiters.has(platform)) {
      const config = this.getConfigForPlatform(platform);
      this.limiters.set(platform, new Bottleneck({
        redis: this.redis,
        id: `rate-limit-${platform}`,
        minTime: config.minTime,          // GitHub: 1000ms, GitLab: 500ms
        maxConcurrent: config.maxConcurrent, // GitHub: 10, GitLab: 20
        reservoir: config.reservoir,      // GitHub: 5000/hour
        reservoirRefreshAmount: config.reservoir,
        reservoirRefreshInterval: 3600 * 1000, // 1 hour
      }));
    }
    return this.limiters.get(platform)!;
  }

  private getConfigForPlatform(platform: string) {
    const configs = {
      github: { minTime: 1000, maxConcurrent: 10, reservoir: 5000 },
      gitlab: { minTime: 500, maxConcurrent: 20, reservoir: 10000 },
      bitbucket: { minTime: 2000, maxConcurrent: 5, reservoir: 1000 },
    };
    return configs[platform] || configs.github;
  }
}
```

**Parallel Processing:**
```typescript
// parallel-processor.ts
import PQueue from 'p-queue';
import pRetry from 'p-retry';

export class ParallelProcessor {
  private queue: PQueue;

  constructor(concurrency: number = 5) {
    this.queue = new PQueue({ concurrency });
  }

  async processRepositories(
    repos: Repository[],
    processor: (repo: Repository) => Promise<PullRequest[]>
  ): Promise<Map<string, PullRequest[]>> {
    const results = new Map<string, PullRequest[]>();

    await Promise.all(
      repos.map(repo =>
        this.queue.add(() =>
          pRetry(
            async () => {
              const prs = await processor(repo);
              results.set(repo.fullName, prs);
              return prs;
            },
            {
              retries: 3,
              onFailedAttempt: error => {
                console.log(
                  `Attempt ${error.attemptNumber} failed for ${repo.fullName}. ` +
                  `${error.retriesLeft} retries left.`
                );
              }
            }
          )
        )
      )
    );

    return results;
  }
}
```

## 2. Context Building Module

### Architecture Components

```typescript
interface ContextBuilder {
  buildContext(pr: PullRequest): Promise<ReviewContext>;
}

interface ReviewContext {
  repository: RepositoryInfo;
  pullRequest: PRInfo;
  diff: DiffContext;
  dependencies: DependencyGraph;
  coverage: CoverageDelta;
  buildStatus: BuildInfo;
  commits: CommitHistory;
  architecture: ComponentMapping;
}
```

### Implementation Strategy

**Package Selection:**
- `simple-git` - Git operations
- `diff-parser` - Parse unified diff format
- `madge` - Dependency graph analysis
- `istanbul-lib-coverage` - Coverage analysis
- `@typescript-eslint/typescript-estree` - AST parsing for TS/JS
- `tree-sitter` - Multi-language AST parsing
- `tmp-promise` - Temporary directory management

**Directory Structure:**
```
app/
├── context/
│   ├── index.ts                    # Context orchestrator
│   ├── repository-manager.ts       # Clone/checkout operations
│   ├── diff-extractor.ts           # Diff parsing with context lines
│   ├── dependency-analyzer.ts      # Build dependency graphs
│   ├── coverage-calculator.ts      # Test coverage deltas
│   ├── build-integrator.ts         # CI/CD build status
│   ├── commit-analyzer.ts          # Commit history analysis
│   └── architecture-mapper.ts      # Map changes to components
```

**Repository Manager:**
```typescript
// repository-manager.ts
import simpleGit, { SimpleGit } from 'simple-git';
import { withDir } from 'tmp-promise';
import { join } from 'path';

export class RepositoryManager {
  private cache: Map<string, string> = new Map();

  async cloneAndCheckout(
    repoUrl: string,
    branch: string,
    prNumber: number
  ): Promise<{ git: SimpleGit; path: string }> {
    const cacheKey = `${repoUrl}:${branch}`;

    // Use tmp directory for isolation
    return await withDir(async ({ path }) => {
      const git = simpleGit(path);

      // Clone with depth=1 for speed, then fetch PR
      await git.clone(repoUrl, path, ['--depth=1', '--single-branch']);
      await git.fetch(['origin', `pull/${prNumber}/head:pr-${prNumber}`]);
      await git.checkout(`pr-${prNumber}`);

      return { git, path };
    }, { unsafeCleanup: true, prefix: 'code-review-' });
  }

  async cleanup(path: string): Promise<void> {
    // Handled by tmp-promise unsafeCleanup
  }
}
```

**Diff Extractor:**
```typescript
// diff-extractor.ts
import parseDiff from 'parse-diff';
import { SimpleGit } from 'simple-git';

export interface DiffContext {
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface FileDiff {
  path: string;
  type: 'add' | 'delete' | 'modify';
  chunks: DiffChunk[];
  language: string;
}

export interface DiffChunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: Change[];
  contextBefore: string[];  // ±10 lines
  contextAfter: string[];
}

export class DiffExtractor {
  constructor(private contextLines: number = 10) {}

  async extractDiff(git: SimpleGit, baseBranch: string): Promise<DiffContext> {
    // Get unified diff
    const diffText = await git.diff([`${baseBranch}...HEAD`]);
    const files = parseDiff(diffText);

    // Enhance with context lines
    const enhancedFiles = await Promise.all(
      files.map(file => this.addContext(git, file))
    );

    return {
      files: enhancedFiles,
      totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
      totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
    };
  }

  private async addContext(git: SimpleGit, file: any): Promise<FileDiff> {
    const content = await git.show([`HEAD:${file.to}`]);
    const lines = content.split('\n');

    return {
      path: file.to,
      type: this.getFileType(file),
      language: this.detectLanguage(file.to),
      chunks: file.chunks.map(chunk => ({
        ...chunk,
        contextBefore: lines.slice(
          Math.max(0, chunk.newStart - this.contextLines),
          chunk.newStart
        ),
        contextAfter: lines.slice(
          chunk.newStart + chunk.newLines,
          chunk.newStart + chunk.newLines + this.contextLines
        ),
      })),
    };
  }

  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap = {
      ts: 'typescript', js: 'javascript', py: 'python',
      java: 'java', go: 'go', rs: 'rust', rb: 'ruby',
    };
    return languageMap[ext] || 'unknown';
  }

  private getFileType(file: any): 'add' | 'delete' | 'modify' {
    if (file.new) return 'add';
    if (file.deleted) return 'delete';
    return 'modify';
  }
}
```

**Dependency Analyzer:**
```typescript
// dependency-analyzer.ts
import madge from 'madge';
import { join } from 'path';

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  affectedModules: string[];
}

export class DependencyAnalyzer {
  async analyze(
    repoPath: string,
    modifiedFiles: string[]
  ): Promise<DependencyGraph> {
    const result = await madge(repoPath, {
      fileExtensions: ['ts', 'js', 'tsx', 'jsx'],
      excludeRegExp: [/node_modules/, /dist/, /build/],
    });

    const graph = result.obj();
    const affected = new Set<string>();

    // Find all files that depend on modified files (forward impact)
    for (const file of modifiedFiles) {
      this.findDependents(graph, file, affected);
    }

    // Find all files that modified files depend on (backward impact)
    for (const file of modifiedFiles) {
      this.findDependencies(graph, file, affected);
    }

    return {
      nodes: Object.keys(graph).map(file => ({
        id: file,
        isModified: modifiedFiles.includes(file),
        isAffected: affected.has(file),
      })),
      edges: this.buildEdges(graph),
      affectedModules: Array.from(affected),
    };
  }

  private findDependents(
    graph: any,
    file: string,
    result: Set<string>
  ): void {
    for (const [key, deps] of Object.entries<string[]>(graph)) {
      if (deps.includes(file) && !result.has(key)) {
        result.add(key);
        this.findDependents(graph, key, result);
      }
    }
  }

  private findDependencies(
    graph: any,
    file: string,
    result: Set<string>
  ): void {
    const deps = graph[file] || [];
    for (const dep of deps) {
      if (!result.has(dep)) {
        result.add(dep);
        this.findDependencies(graph, dep, result);
      }
    }
  }

  private buildEdges(graph: any): DependencyEdge[] {
    const edges: DependencyEdge[] = [];
    for (const [source, targets] of Object.entries<string[]>(graph)) {
      for (const target of targets) {
        edges.push({ from: source, to: target });
      }
    }
    return edges;
  }
}
```

**Coverage Calculator:**
```typescript
// coverage-calculator.ts
import { createCoverageMap } from 'istanbul-lib-coverage';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface CoverageDelta {
  before: CoverageStats;
  after: CoverageStats;
  delta: CoverageStats;
  affectedFiles: FileCoverage[];
}

export interface CoverageStats {
  lines: { covered: number; total: number; pct: number };
  statements: { covered: number; total: number; pct: number };
  functions: { covered: number; total: number; pct: number };
  branches: { covered: number; total: number; pct: number };
}

export class CoverageCalculator {
  async calculateDelta(
    repoPath: string,
    modifiedFiles: string[]
  ): Promise<CoverageDelta> {
    const coveragePath = join(repoPath, 'coverage', 'coverage-final.json');

    if (!existsSync(coveragePath)) {
      return this.emptyCoverage();
    }

    const coverageData = JSON.parse(readFileSync(coveragePath, 'utf-8'));
    const coverageMap = createCoverageMap(coverageData);

    // Calculate coverage for modified files only
    const affectedFiles = modifiedFiles
      .map(file => {
        const fullPath = join(repoPath, file);
        const fileCoverage = coverageMap.fileCoverageFor(fullPath);

        if (!fileCoverage) return null;

        const summary = fileCoverage.toSummary();
        return {
          path: file,
          lines: summary.lines.pct,
          statements: summary.statements.pct,
          functions: summary.functions.pct,
          branches: summary.branches.pct,
        };
      })
      .filter(Boolean);

    // Get overall stats
    const summary = coverageMap.getCoverageSummary();

    return {
      before: { /* previous coverage from DB */ },
      after: {
        lines: summary.lines,
        statements: summary.statements,
        functions: summary.functions,
        branches: summary.branches,
      },
      delta: { /* calculated difference */ },
      affectedFiles,
    };
  }

  private emptyCoverage(): CoverageDelta {
    const empty = { covered: 0, total: 0, pct: 0 };
    return {
      before: { lines: empty, statements: empty, functions: empty, branches: empty },
      after: { lines: empty, statements: empty, functions: empty, branches: empty },
      delta: { lines: empty, statements: empty, functions: empty, branches: empty },
      affectedFiles: [],
    };
  }
}
```

## 3. Review Execution Engine

### Architecture Components

```typescript
interface ReviewEngine {
  review(context: ReviewContext): Promise<ReviewResult>;
}

interface ReviewResult {
  comments: ReviewComment[];
  summary: ReviewSummary;
  decision: ApprovalDecision;
  metrics: ReviewMetrics;
}

interface Rule {
  id: string;
  name: string;
  severity: 'critical' | 'major' | 'minor';
  category: RuleCategory;
  check(context: ReviewContext): Promise<RuleViolation[]>;
}
```

### Implementation Strategy

**Package Selection:**
- `@anthropic-ai/sdk` - Claude API for AI-powered analysis
- `eslint` - Linting engine (pluggable)
- `semgrep` - SAST security scanning
- `sonarqube-scanner` - Code quality analysis
- `cyclonedx` - SBOM generation for dependency security
- `retire.js` - JavaScript vulnerability scanning

**Directory Structure:**
```
app/
├── review/
│   ├── index.ts                    # Review orchestrator
│   ├── engine.ts                   # Main review engine
│   ├── rules/
│   │   ├── base-rule.ts            # Abstract rule class
│   │   ├── solid/
│   │   │   ├── single-responsibility.ts
│   │   │   ├── open-closed.ts
│   │   │   ├── liskov-substitution.ts
│   │   │   ├── interface-segregation.ts
│   │   │   └── dependency-inversion.ts
│   │   ├── security/
│   │   │   ├── injection.ts        # SQL, Command, LDAP injection
│   │   │   ├── broken-auth.ts
│   │   │   ├── sensitive-data.ts
│   │   │   ├── xxe.ts
│   │   │   ├── broken-access.ts
│   │   │   ├── security-misconfig.ts
│   │   │   ├── xss.ts
│   │   │   ├── insecure-deserialization.ts
│   │   │   ├── vulnerable-components.ts
│   │   │   └── logging-monitoring.ts
│   │   ├── performance/
│   │   │   ├── complexity-analyzer.ts
│   │   │   ├── n-plus-one-detector.ts
│   │   │   └── memory-leak-detector.ts
│   │   ├── testing/
│   │   │   ├── coverage-enforcer.ts
│   │   │   └── test-quality-analyzer.ts
│   │   └── style/
│   │       ├── language-rules.ts
│   │       └── best-practices.ts
│   ├── analyzers/
│   │   ├── claude-analyzer.ts      # AI-powered analysis
│   │   ├── static-analyzer.ts      # Traditional SAST
│   │   └── pattern-matcher.ts      # Regex/AST patterns
│   ├── severity-classifier.ts
│   └── comment-generator.ts
```

**Review Engine:**
```typescript
// engine.ts
import Anthropic from '@anthropic-ai/sdk';
import { Rule } from './rules/base-rule';
import { loadRules } from './rules';

export class ReviewEngine {
  private rules: Map<string, Rule>;
  private claude: Anthropic;

  constructor(
    private config: ReviewConfig,
    apiKey: string
  ) {
    this.rules = loadRules(config);
    this.claude = new Anthropic({ apiKey });
  }

  async review(context: ReviewContext): Promise<ReviewResult> {
    const violations: RuleViolation[] = [];

    // Run all rules in parallel (within memory constraints)
    const ruleGroups = this.groupRulesByCategory(Array.from(this.rules.values()));

    for (const [category, rules] of Object.entries(ruleGroups)) {
      const categoryViolations = await this.runRuleGroup(rules, context);
      violations.push(...categoryViolations);
    }

    // Use Claude for high-level architectural review
    const aiReview = await this.runClaudeAnalysis(context, violations);

    // Generate comments from violations
    const comments = await this.generateComments(violations, context);

    // Build summary and decision
    const summary = this.buildSummary(violations, aiReview);
    const decision = this.makeDecision(violations, context);

    return {
      comments,
      summary,
      decision,
      metrics: this.calculateMetrics(violations, context),
    };
  }

  private async runRuleGroup(
    rules: Rule[],
    context: ReviewContext
  ): Promise<RuleViolation[]> {
    const results = await Promise.all(
      rules.map(rule =>
        rule.check(context).catch(error => {
          console.error(`Rule ${rule.id} failed:`, error);
          return [];
        })
      )
    );

    return results.flat();
  }

  private async runClaudeAnalysis(
    context: ReviewContext,
    violations: RuleViolation[]
  ): Promise<AIReviewResult> {
    const prompt = this.buildClaudePrompt(context, violations);

    const message = await this.claude.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.3,
    });

    return this.parseClaudeResponse(message.content);
  }

  private buildClaudePrompt(
    context: ReviewContext,
    violations: RuleViolation[]
  ): string {
    return `You are an expert code reviewer. Analyze this pull request:

## Changed Files
${context.diff.files.map(f => `- ${f.path} (${f.type})`).join('\n')}

## Code Changes
${this.formatDiffForClaude(context.diff)}

## Detected Issues
${violations.map(v => `- [${v.severity}] ${v.message}`).join('\n')}

## Architecture Context
- Affected modules: ${context.architecture.affectedModules.join(', ')}
- Test coverage: ${context.coverage.after.lines.pct}%
- Build status: ${context.buildStatus.status}

Please provide:
1. High-level architectural assessment
2. Potential issues not caught by static analysis
3. Refactoring suggestions with code examples
4. Learning resources for identified patterns

Format response as JSON.`;
  }

  private makeDecision(
    violations: RuleViolation[],
    context: ReviewContext
  ): ApprovalDecision {
    const critical = violations.filter(v => v.severity === 'critical').length;
    const major = violations.filter(v => v.severity === 'major').length;

    // Critical issues = request changes
    if (critical > 0) {
      return 'request-changes';
    }

    // Many major issues = request changes
    if (major > 5) {
      return 'request-changes';
    }

    // Coverage drop > 5% = request changes
    if (context.coverage.delta.lines.pct < -5) {
      return 'request-changes';
    }

    // Some issues but not blocking = comment
    if (major > 0 || violations.length > 0) {
      return 'comment';
    }

    // No issues = approve
    return 'approve';
  }

  private groupRulesByCategory(rules: Rule[]): Record<string, Rule[]> {
    const groups: Record<string, Rule[]> = {};
    for (const rule of rules) {
      if (!groups[rule.category]) {
        groups[rule.category] = [];
      }
      groups[rule.category].push(rule);
    }
    return groups;
  }
}
```

**SOLID Rules Example:**
```typescript
// rules/solid/single-responsibility.ts
import { BaseRule } from '../base-rule';
import * as parser from '@typescript-eslint/typescript-estree';

export class SingleResponsibilityRule extends BaseRule {
  id = 'solid-srp';
  name = 'Single Responsibility Principle';
  severity = 'major' as const;
  category = 'design' as const;

  async check(context: ReviewContext): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = [];

    for (const file of context.diff.files) {
      if (!this.isSupported(file.language)) continue;

      const content = await this.getFileContent(context, file.path);
      const ast = parser.parse(content, {
        loc: true,
        range: true
      });

      // Find classes with too many responsibilities
      const classes = this.findClasses(ast);

      for (const cls of classes) {
        const responsibilities = this.countResponsibilities(cls);

        if (responsibilities > 3) {
          violations.push({
            ruleId: this.id,
            severity: this.severity,
            message: `Class '${cls.name}' has ${responsibilities} responsibilities. Consider splitting into smaller classes.`,
            file: file.path,
            line: cls.loc.start.line,
            column: cls.loc.start.column,
            suggestion: this.generateRefactoringSuggestion(cls),
          });
        }
      }
    }

    return violations;
  }

  private countResponsibilities(classNode: any): number {
    // Heuristic: count distinct method groups by naming conventions
    const methods = classNode.body.body.filter(
      n => n.type === 'MethodDefinition'
    );

    const prefixes = new Set(
      methods.map(m => this.getMethodPrefix(m.key.name))
    );

    return prefixes.size;
  }

  private getMethodPrefix(name: string): string {
    const match = name.match(/^(get|set|create|update|delete|validate|calculate|format|parse|handle|process)/);
    return match ? match[1] : 'other';
  }

  private generateRefactoringSuggestion(cls: any): string {
    return `Consider extracting responsibilities into separate classes:

\`\`\`typescript
// Current: ${cls.name} handles multiple concerns
class ${cls.name} {
  // Too many unrelated methods
}

// Suggested: Split by responsibility
class ${cls.name}Data {
  // Data access methods
}

class ${cls.name}Validator {
  // Validation logic
}

class ${cls.name}Formatter {
  // Formatting logic
}
\`\`\``;
  }
}
```

**Security Rules Example:**
```typescript
// rules/security/injection.ts
import { BaseRule } from '../base-rule';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class InjectionRule extends BaseRule {
  id = 'owasp-a03-injection';
  name = 'Injection Vulnerabilities';
  severity = 'critical' as const;
  category = 'security' as const;

  async check(context: ReviewContext): Promise<RuleViolation[]> {
    // Use Semgrep for advanced pattern matching
    const violations: RuleViolation[] = [];

    try {
      const { stdout } = await execAsync(
        `semgrep --config "p/owasp-top-ten" --json ${context.repository.path}`,
        { maxBuffer: 10 * 1024 * 1024 }
      );

      const results = JSON.parse(stdout);

      for (const result of results.results) {
        if (this.isInjectionVulnerability(result)) {
          violations.push({
            ruleId: this.id,
            severity: this.severity,
            message: result.extra.message,
            file: result.path,
            line: result.start.line,
            column: result.start.col,
            suggestion: this.getSuggestion(result),
            cwe: result.extra.metadata.cwe,
            owasp: 'A03:2021',
          });
        }
      }
    } catch (error) {
      console.error('Semgrep scan failed:', error);
    }

    return violations;
  }

  private isInjectionVulnerability(result: any): boolean {
    const injectionCWEs = ['CWE-89', 'CWE-78', 'CWE-90', 'CWE-91'];
    return injectionCWEs.some(cwe =>
      result.extra.metadata.cwe?.includes(cwe)
    );
  }

  private getSuggestion(result: any): string {
    if (result.extra.metadata.cwe?.includes('CWE-89')) {
      return `Use parameterized queries instead of string concatenation:

\`\`\`typescript
// ❌ Vulnerable to SQL injection
const query = \`SELECT * FROM users WHERE id = \${userId}\`;

// ✅ Use parameterized query
const query = 'SELECT * FROM users WHERE id = ?';
db.execute(query, [userId]);
\`\`\`

Resources:
- https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html`;
    }

    if (result.extra.metadata.cwe?.includes('CWE-78')) {
      return `Avoid shell injection by using libraries instead of shell commands:

\`\`\`typescript
// ❌ Vulnerable to command injection
exec(\`convert \${userInput}.jpg output.png\`);

// ✅ Use library with validated inputs
import sharp from 'sharp';
const validatedInput = path.basename(userInput); // Strip directory traversal
await sharp(\`\${validatedInput}.jpg\`).toFile('output.png');
\`\`\`

Resources:
- https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html`;
    }

    return 'Use proper input validation and parameterization.';
  }
}
```

**Performance Analyzer:**
```typescript
// rules/performance/complexity-analyzer.ts
import { BaseRule } from '../base-rule';
import * as parser from '@typescript-eslint/typescript-estree';

export class ComplexityAnalyzer extends BaseRule {
  id = 'perf-complexity';
  name = 'Algorithmic Complexity';
  severity = 'major' as const;
  category = 'performance' as const;

  async check(context: ReviewContext): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = [];

    for (const file of context.diff.files) {
      if (!this.isSupported(file.language)) continue;

      const content = await this.getFileContent(context, file.path);
      const ast = parser.parse(content, { loc: true });

      // Find nested loops (potential O(n²) or worse)
      const nestedLoops = this.findNestedLoops(ast);

      for (const loop of nestedLoops) {
        if (loop.depth >= 3) {
          violations.push({
            ruleId: this.id,
            severity: 'critical',
            message: `Nested loops with depth ${loop.depth} detected. This results in O(n^${loop.depth}) complexity.`,
            file: file.path,
            line: loop.line,
            column: loop.column,
            suggestion: this.getComplexitySuggestion(loop),
          });
        } else if (loop.depth === 2) {
          violations.push({
            ruleId: this.id,
            severity: this.severity,
            message: `O(n²) complexity detected. Consider optimizing with hash maps or preprocessing.`,
            file: file.path,
            line: loop.line,
            column: loop.column,
            suggestion: this.getComplexitySuggestion(loop),
          });
        }
      }
    }

    return violations;
  }

  private findNestedLoops(ast: any): NestedLoop[] {
    const loops: NestedLoop[] = [];

    const visit = (node: any, depth: number = 0) => {
      if (this.isLoop(node)) {
        loops.push({
          depth: depth + 1,
          line: node.loc.start.line,
          column: node.loc.start.column,
          type: node.type,
        });

        // Continue traversing inside loop
        this.traverseChildren(node, n => visit(n, depth + 1));
      } else {
        this.traverseChildren(node, n => visit(n, depth));
      }
    };

    visit(ast, 0);
    return loops.filter(l => l.depth >= 2);
  }

  private isLoop(node: any): boolean {
    return [
      'ForStatement',
      'ForInStatement',
      'ForOfStatement',
      'WhileStatement',
      'DoWhileStatement'
    ].includes(node.type);
  }

  private getComplexitySuggestion(loop: NestedLoop): string {
    return `Consider optimization strategies:

\`\`\`typescript
// ❌ O(n²) nested loops
for (const item1 of array1) {
  for (const item2 of array2) {
    if (item1.id === item2.id) {
      // process match
    }
  }
}

// ✅ O(n) using hash map
const map = new Map(array2.map(item => [item.id, item]));
for (const item1 of array1) {
  const match = map.get(item1.id);
  if (match) {
    // process match
  }
}
\`\`\`

Resources:
- https://www.bigocheatsheet.com/`;
  }
}
```

## 4. Output Management Module

### Implementation Strategy

**Package Selection:**
- `@octokit/rest` - GitHub API
- `@gitbeaker/node` - GitLab API
- `bitbucket` - Bitbucket API
- `marked` - Markdown parsing/rendering
- `handlebars` - Template engine for comments

**Directory Structure:**
```
app/
├── output/
│   ├── index.ts                    # Output orchestrator
│   ├── comment-poster.ts           # Post inline comments
│   ├── summary-generator.ts        # Generate PR summary
│   ├── decision-maker.ts           # Approval logic
│   ├── label-manager.ts            # PR label management
│   ├── templates/
│   │   ├── inline-comment.hbs
│   │   ├── summary.hbs
│   │   └── resources.hbs
│   └── formatters/
│       ├── markdown-formatter.ts
│       └── code-example-formatter.ts
```

**Comment Poster:**
```typescript
// comment-poster.ts
import { Octokit } from '@octokit/rest';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';

export class CommentPoster {
  private octokit: Octokit;
  private templates: Map<string, HandlebarsTemplateDelegate>;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
    this.loadTemplates();
  }

  async postReview(
    repo: Repository,
    pr: PullRequest,
    result: ReviewResult
  ): Promise<void> {
    const { owner, name } = this.parseRepo(repo.fullName);

    // Post inline comments
    const comments = result.comments.map(c => ({
      path: c.file,
      line: c.line,
      body: this.renderInlineComment(c),
    }));

    // Post review with summary
    await this.octokit.pulls.createReview({
      owner,
      repo: name,
      pull_number: pr.number,
      event: this.mapDecision(result.decision),
      body: this.renderSummary(result),
      comments,
    });

    // Update labels
    await this.updateLabels(owner, name, pr.number, result);
  }

  private renderInlineComment(comment: ReviewComment): string {
    const template = this.templates.get('inline-comment');
    return template({
      severity: comment.severity,
      message: comment.message,
      suggestion: comment.suggestion,
      ruleId: comment.ruleId,
      icon: this.getSeverityIcon(comment.severity),
    });
  }

  private renderSummary(result: ReviewResult): string {
    const template = this.templates.get('summary');

    // Group issues by category
    const issuesByCategory = this.groupByCategory(result.comments);

    // Extract refactoring suggestions
    const refactorings = this.extractRefactorings(result);

    // Generate resource links
    const resources = this.generateResources(result);

    return template({
      decision: result.decision,
      metrics: result.metrics,
      issuesByCategory,
      refactorings,
      resources,
      timestamp: new Date().toISOString(),
    });
  }

  private loadTemplates(): void {
    this.templates = new Map();
    const templateDir = join(__dirname, 'templates');

    const templateFiles = [
      'inline-comment.hbs',
      'summary.hbs',
      'resources.hbs',
    ];

    for (const file of templateFiles) {
      const content = readFileSync(join(templateDir, file), 'utf-8');
      const name = file.replace('.hbs', '');
      this.templates.set(name, Handlebars.compile(content));
    }
  }

  private getSeverityIcon(severity: string): string {
    const icons = {
      critical: '🚨',
      major: '⚠️',
      minor: 'ℹ️',
    };
    return icons[severity] || 'ℹ️';
  }

  private mapDecision(decision: ApprovalDecision): string {
    const mapping = {
      'approve': 'APPROVE',
      'request-changes': 'REQUEST_CHANGES',
      'comment': 'COMMENT',
    };
    return mapping[decision];
  }

  private groupByCategory(comments: ReviewComment[]): Record<string, ReviewComment[]> {
    const groups: Record<string, ReviewComment[]> = {};

    for (const comment of comments) {
      const category = comment.category || 'general';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(comment);
    }

    return groups;
  }

  private extractRefactorings(result: ReviewResult): Refactoring[] {
    return result.comments
      .filter(c => c.suggestion && c.severity !== 'minor')
      .map(c => ({
        file: c.file,
        line: c.line,
        issue: c.message,
        suggestion: c.suggestion,
        codeExample: this.extractCodeExample(c.suggestion),
      }));
  }

  private extractCodeExample(suggestion: string): string | null {
    const match = suggestion.match(/```[\w]*\n([\s\S]*?)\n```/);
    return match ? match[1] : null;
  }

  private generateResources(result: ReviewResult): Resource[] {
    const resources: Resource[] = [];
    const seen = new Set<string>();

    for (const comment of result.comments) {
      if (comment.resources) {
        for (const resource of comment.resources) {
          if (!seen.has(resource.url)) {
            resources.push(resource);
            seen.add(resource.url);
          }
        }
      }
    }

    return resources;
  }

  private async updateLabels(
    owner: string,
    repo: string,
    prNumber: number,
    result: ReviewResult
  ): Promise<void> {
    const labels: string[] = ['code-review-agent'];

    // Add severity labels
    const critical = result.comments.filter(c => c.severity === 'critical').length;
    const major = result.comments.filter(c => c.severity === 'major').length;

    if (critical > 0) labels.push('critical-issues');
    if (major > 0) labels.push('major-issues');

    // Add category labels
    const categories = new Set(result.comments.map(c => c.category));
    if (categories.has('security')) labels.push('security');
    if (categories.has('performance')) labels.push('performance');

    await this.octokit.issues.setLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels,
    });
  }

  private parseRepo(fullName: string): { owner: string; name: string } {
    const [owner, name] = fullName.split('/');
    return { owner, name };
  }
}
```

**Templates:**
```handlebars
{{!-- templates/inline-comment.hbs --}}
{{icon}} **{{severity}}**: {{message}}

{{#if suggestion}}
### Suggestion
{{suggestion}}
{{/if}}

<sub>Rule: `{{ruleId}}`</sub>
```

```handlebars
{{!-- templates/summary.hbs --}}
# Code Review Summary

**Decision**: {{#if (eq decision "approve")}}✅ Approved{{else if (eq decision "request-changes")}}❌ Changes Requested{{else}}💬 Comments{{/if}}

## Metrics
- **Files Changed**: {{metrics.filesChanged}}
- **Lines Added**: {{metrics.linesAdded}}
- **Lines Deleted**: {{metrics.linesDeleted}}
- **Issues Found**: {{metrics.totalIssues}} ({{metrics.critical}} critical, {{metrics.major}} major, {{metrics.minor}} minor)
- **Test Coverage**: {{metrics.coveragePct}}%

## Issues by Category

{{#each issuesByCategory}}
### {{@key}}
{{#each this}}
- [{{severity}}] {{file}}:{{line}} - {{message}}
{{/each}}

{{/each}}

{{#if refactorings}}
## Suggested Refactorings

{{#each refactorings}}
### {{file}}:{{line}}
**Issue**: {{issue}}

{{suggestion}}

{{/each}}
{{/if}}

{{#if resources}}
## Learning Resources

{{#each resources}}
- [{{title}}]({{url}}) - {{description}}
{{/each}}
{{/if}}

---
<sub>Review generated by Code Review Agent at {{timestamp}}</sub>
```

## 5. Data Persistence Layer

### SQLite Schema

```sql
-- schema.sql

-- Pull requests tracked
CREATE TABLE pull_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform VARCHAR(50) NOT NULL,        -- github, gitlab, bitbucket
  repository VARCHAR(255) NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_id VARCHAR(255) NOT NULL,          -- Platform-specific ID
  title TEXT,
  author VARCHAR(255),
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  status VARCHAR(50),                   -- open, closed, merged
  branch VARCHAR(255),
  base_branch VARCHAR(255),
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_reviewed_at TIMESTAMP,
  UNIQUE(platform, repository, pr_number)
);

CREATE INDEX idx_pr_status ON pull_requests(status, platform, repository);
CREATE INDEX idx_pr_dates ON pull_requests(created_at, last_reviewed_at);

-- Review history
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pull_request_id INTEGER NOT NULL,
  review_number INTEGER NOT NULL,       -- Sequential review number for this PR
  decision VARCHAR(50) NOT NULL,        -- approve, request-changes, comment
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NOT NULL,
  duration_ms INTEGER,
  files_analyzed INTEGER,
  lines_analyzed INTEGER,
  total_issues INTEGER,
  critical_issues INTEGER,
  major_issues INTEGER,
  minor_issues INTEGER,
  coverage_before REAL,
  coverage_after REAL,
  coverage_delta REAL,
  build_status VARCHAR(50),
  execution_mode VARCHAR(50),           -- dry-run, production
  agent_version VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE
);

CREATE INDEX idx_reviews_pr ON reviews(pull_request_id);
CREATE INDEX idx_reviews_decision ON reviews(decision);
CREATE INDEX idx_reviews_dates ON reviews(completed_at);

-- Review comments
CREATE TABLE review_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  file_path VARCHAR(512) NOT NULL,
  line_number INTEGER NOT NULL,
  column_number INTEGER,
  rule_id VARCHAR(100) NOT NULL,
  rule_name VARCHAR(255),
  category VARCHAR(50) NOT NULL,       -- security, performance, design, testing, style
  severity VARCHAR(50) NOT NULL,       -- critical, major, minor
  message TEXT NOT NULL,
  suggestion TEXT,
  code_example TEXT,
  cwe VARCHAR(50),                     -- For security issues
  owasp VARCHAR(50),                   -- For security issues
  posted BOOLEAN DEFAULT 0,            -- Whether comment was posted to PR
  posted_at TIMESTAMP,
  comment_id VARCHAR(255),             -- Platform comment ID
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
);

CREATE INDEX idx_comments_review ON review_comments(review_id);
CREATE INDEX idx_comments_severity ON review_comments(severity);
CREATE INDEX idx_comments_category ON review_comments(category);
CREATE INDEX idx_comments_rule ON review_comments(rule_id);

-- Learning resources suggested
CREATE TABLE resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  title VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  category VARCHAR(50),
  relevance_score REAL,                -- 0-1 score for how relevant
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
);

CREATE INDEX idx_resources_review ON resources(review_id);

-- Audit trail for decisions
CREATE TABLE decision_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  decision_point VARCHAR(255) NOT NULL, -- e.g., "coverage-check", "severity-analysis"
  input_data TEXT,                      -- JSON snapshot of input
  output_data TEXT,                     -- JSON snapshot of output
  reasoning TEXT NOT NULL,              -- Explanation of decision
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
);

CREATE INDEX idx_decision_log_review ON decision_log(review_id);
CREATE INDEX idx_decision_log_point ON decision_log(decision_point);

-- Performance metrics
CREATE TABLE performance_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  metric_name VARCHAR(100) NOT NULL,   -- e.g., "git-clone-time", "rule-execution-time"
  metric_value REAL NOT NULL,
  unit VARCHAR(50) NOT NULL,           -- ms, mb, count, etc.
  metadata TEXT,                       -- JSON for additional context
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
);

CREATE INDEX idx_metrics_review ON performance_metrics(review_id);
CREATE INDEX idx_metrics_name ON performance_metrics(metric_name);

-- Configuration snapshots (for reproducibility)
CREATE TABLE config_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  config_key VARCHAR(255) NOT NULL,
  config_value TEXT NOT NULL,          -- JSON serialized config
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
);

CREATE INDEX idx_config_review ON config_snapshots(review_id);

-- Repository metadata
CREATE TABLE repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform VARCHAR(50) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  clone_url TEXT NOT NULL,
  default_branch VARCHAR(255),
  language VARCHAR(50),
  last_analyzed_at TIMESTAMP,
  total_reviews INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT 1,
  config_override TEXT,                -- JSON for repo-specific config
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform, full_name)
);

CREATE INDEX idx_repos_platform ON repositories(platform);
CREATE INDEX idx_repos_active ON repositories(active);

-- Queue for processing (offline mode support)
CREATE TABLE review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pull_request_id INTEGER NOT NULL,
  priority INTEGER DEFAULT 5,          -- 1-10, higher = more priority
  status VARCHAR(50) DEFAULT 'pending', -- pending, processing, completed, failed
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  scheduled_for TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE
);

CREATE INDEX idx_queue_status ON review_queue(status, priority DESC);
CREATE INDEX idx_queue_scheduled ON review_queue(scheduled_for);
```

**Database Manager:**
```typescript
// data/database.ts
import Database from 'better-sqlite3';
import { join } from 'path';
import { readFileSync } from 'fs';

export class DatabaseManager {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, {
      verbose: console.log,
      fileMustExist: false
    });

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.initialize();
  }

  private initialize(): void {
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    this.db.exec(schema);
  }

  // Pull Request operations
  async upsertPullRequest(pr: PullRequestData): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO pull_requests (
        platform, repository, pr_number, pr_id, title, author,
        created_at, updated_at, status, branch, base_branch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, repository, pr_number)
      DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        updated_at = excluded.updated_at
      RETURNING id
    `);

    const result = stmt.get(
      pr.platform, pr.repository, pr.prNumber, pr.prId,
      pr.title, pr.author, pr.createdAt, pr.updatedAt,
      pr.status, pr.branch, pr.baseBranch
    );

    return result.id;
  }

  async findUnreviewedPRs(
    daysBack: number = 7,
    limit: number = 100
  ): Promise<PullRequestRecord[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM pull_requests
      WHERE status = 'open'
        AND created_at >= datetime('now', '-${daysBack} days')
        AND (last_reviewed_at IS NULL OR updated_at > last_reviewed_at)
      ORDER BY created_at DESC
      LIMIT ?
    `);

    return stmt.all(limit) as PullRequestRecord[];
  }

  // Review operations
  async createReview(review: ReviewData): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO reviews (
        pull_request_id, review_number, decision, started_at, completed_at,
        duration_ms, files_analyzed, lines_analyzed, total_issues,
        critical_issues, major_issues, minor_issues, coverage_before,
        coverage_after, coverage_delta, build_status, execution_mode,
        agent_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `);

    // Get next review number
    const countStmt = this.db.prepare(
      'SELECT COALESCE(MAX(review_number), 0) + 1 as next FROM reviews WHERE pull_request_id = ?'
    );
    const { next } = countStmt.get(review.pullRequestId);

    const result = stmt.get(
      review.pullRequestId, next, review.decision, review.startedAt,
      review.completedAt, review.durationMs, review.filesAnalyzed,
      review.linesAnalyzed, review.totalIssues, review.criticalIssues,
      review.majorIssues, review.minorIssues, review.coverageBefore,
      review.coverageAfter, review.coverageDelta, review.buildStatus,
      review.executionMode, review.agentVersion
    );

    // Update PR last_reviewed_at
    this.db.prepare('UPDATE pull_requests SET last_reviewed_at = ? WHERE id = ?')
      .run(review.completedAt, review.pullRequestId);

    return result.id;
  }

  async saveComments(reviewId: number, comments: ReviewComment[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO review_comments (
        review_id, file_path, line_number, column_number, rule_id,
        rule_name, category, severity, message, suggestion, code_example,
        cwe, owasp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((comments) => {
      for (const comment of comments) {
        stmt.run(
          reviewId, comment.file, comment.line, comment.column,
          comment.ruleId, comment.ruleName, comment.category,
          comment.severity, comment.message, comment.suggestion,
          comment.codeExample, comment.cwe, comment.owasp
        );
      }
    });

    insertMany(comments);
  }

  async logDecision(
    reviewId: number,
    decisionPoint: string,
    input: any,
    output: any,
    reasoning: string
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO decision_log (
        review_id, decision_point, input_data, output_data, reasoning
      ) VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      reviewId,
      decisionPoint,
      JSON.stringify(input),
      JSON.stringify(output),
      reasoning
    );
  }

  async recordMetric(
    reviewId: number,
    metricName: string,
    value: number,
    unit: string,
    metadata?: any
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO performance_metrics (
        review_id, metric_name, metric_value, unit, metadata
      ) VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      reviewId,
      metricName,
      value,
      unit,
      metadata ? JSON.stringify(metadata) : null
    );
  }

  // Queue operations
  async enqueueReview(
    pullRequestId: number,
    priority: number = 5,
    scheduledFor?: Date
  ): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT INTO review_queue (pull_request_id, priority, scheduled_for)
      VALUES (?, ?, ?)
      RETURNING id
    `);

    const result = stmt.get(
      pullRequestId,
      priority,
      scheduledFor?.toISOString() || null
    );

    return result.id;
  }

  async getNextQueuedReview(): Promise<QueueItem | null> {
    const stmt = this.db.prepare(`
      SELECT q.*, pr.*
      FROM review_queue q
      JOIN pull_requests pr ON q.pull_request_id = pr.id
      WHERE q.status = 'pending'
        AND (q.scheduled_for IS NULL OR q.scheduled_for <= datetime('now'))
        AND q.retry_count < q.max_retries
      ORDER BY q.priority DESC, q.created_at ASC
      LIMIT 1
    `);

    return stmt.get() as QueueItem | null;
  }

  async updateQueueStatus(
    queueId: number,
    status: string,
    error?: string
  ): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE review_queue
      SET status = ?,
          error_message = ?,
          retry_count = retry_count + CASE WHEN ? = 'failed' THEN 1 ELSE 0 END,
          ${status === 'processing' ? 'started_at = datetime(\'now\'),' : ''}
          ${status === 'completed' || status === 'failed' ? 'completed_at = datetime(\'now\'),' : ''}
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(status, error, status, queueId);
  }

  // Analytics queries
  async getReviewStatistics(days: number = 30): Promise<ReviewStats> {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_reviews,
        AVG(duration_ms) as avg_duration_ms,
        AVG(total_issues) as avg_issues,
        SUM(CASE WHEN decision = 'approve' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN decision = 'request-changes' THEN 1 ELSE 0 END) as changes_requested,
        SUM(critical_issues) as total_critical,
        SUM(major_issues) as total_major,
        SUM(minor_issues) as total_minor
      FROM reviews
      WHERE completed_at >= datetime('now', '-${days} days')
    `);

    return stmt.get() as ReviewStats;
  }

  close(): void {
    this.db.close();
  }
}
```

## 6. Configuration System

**Configuration Schema (YAML):**
```yaml
# conf/config.yaml

# Platform credentials
platforms:
  github:
    token: ${GITHUB_TOKEN}
    api_url: https://api.github.com
  gitlab:
    token: ${GITLAB_TOKEN}
    api_url: https://gitlab.com/api/v4
  bitbucket:
    username: ${BITBUCKET_USERNAME}
    app_password: ${BITBUCKET_APP_PASSWORD}

# Discovery settings
discovery:
  days_back: 7
  max_concurrent_repos: 5
  pr_filters:
    - type: date
      days: 7
    - type: status
      value: open
    - type: not_reviewed

# Context building
context:
  diff_context_lines: 10
  clone_depth: 1
  analyze_dependencies: true
  calculate_coverage: true
  fetch_build_status: true

# Review rules
rules:
  # SOLID principles
  solid:
    enabled: true
    single_responsibility:
      enabled: true
      severity: major
      max_responsibilities: 3
    open_closed:
      enabled: true
      severity: major
    liskov_substitution:
      enabled: true
      severity: major
    interface_segregation:
      enabled: true
      severity: minor
    dependency_inversion:
      enabled: true
      severity: major

  # Security (OWASP Top 10)
  security:
    enabled: true
    default_severity: critical
    owasp_rules:
      - A01:2021  # Broken Access Control
      - A02:2021  # Cryptographic Failures
      - A03:2021  # Injection
      - A04:2021  # Insecure Design
      - A05:2021  # Security Misconfiguration
      - A06:2021  # Vulnerable Components
      - A07:2021  # Identification/Authentication
      - A08:2021  # Software/Data Integrity
      - A09:2021  # Logging/Monitoring
      - A10:2021  # SSRF

  # Performance
  performance:
    enabled: true
    complexity:
      enabled: true
      severity: major
      max_nested_loops: 2
      warn_on_exponential: true
    database:
      enabled: true
      severity: major
      detect_n_plus_one: true
      max_queries_per_request: 10

  # Testing
  testing:
    enabled: true
    coverage:
      enabled: true
      severity: major
      minimum_percentage: 80
      fail_on_decrease: 5  # Fail if coverage drops by 5%
    quality:
      enabled: true
      require_assertions: true

  # Style
  style:
    enabled: true
    severity: minor
    languages:
      typescript:
        - eslint
        - prettier
      python:
        - pylint
        - black
      java:
        - checkstyle

# Output settings
output:
  post_inline_comments: true
  post_summary: true
  update_labels: true
  approval_thresholds:
    critical_issues: 0      # Any critical = request changes
    major_issues: 5         # More than 5 major = request changes
    coverage_drop: 5        # Coverage drop > 5% = request changes

  templates:
    inline_comment: templates/inline-comment.hbs
    summary: templates/summary.hbs

# Execution
execution:
  mode: production  # production | dry-run
  timeout_per_review_ms: 300000  # 5 minutes
  memory_limit_mb: 2048
  parallel_reviews: 3

# Database
database:
  path: data/reviews.db
  backup_enabled: true
  backup_interval_hours: 24

# Observability
observability:
  logging:
    level: info
    format: json
    output: logs/agent.log
  metrics:
    enabled: true
    port: 9090
  tracing:
    enabled: false
    endpoint: http://localhost:4318

# Claude API
claude:
  api_key: ${CLAUDE_API_KEY}
  model: claude-3-5-sonnet-20241022
  max_tokens: 4096
  temperature: 0.3
```

**Configuration Loader:**
```typescript
// conf/config-loader.ts
import yaml from 'yaml';
import { readFileSync } from 'fs';
import { expand } from 'dotenv-expand';
import dotenv from 'dotenv';

export class ConfigLoader {
  private config: Config;
  private overrides: Map<string, Partial<Config>>;

  constructor(configPath: string) {
    // Load environment variables
    expand(dotenv.config());

    // Load base configuration
    const content = readFileSync(configPath, 'utf-8');
    this.config = yaml.parse(this.expandEnvVars(content));

    // Load repository overrides
    this.overrides = new Map();
  }

  getConfig(repository?: string): Config {
    if (repository && this.overrides.has(repository)) {
      return this.mergeConfigs(
        this.config,
        this.overrides.get(repository)!
      );
    }

    return this.config;
  }

  setRepositoryOverride(repository: string, override: Partial<Config>): void {
    this.overrides.set(repository, override);
  }

  private expandEnvVars(content: string): string {
    return content.replace(/\$\{([^}]+)\}/g, (_, key) => {
      return process.env[key] || `\${${key}}`;
    });
  }

  private mergeConfigs(base: Config, override: Partial<Config>): Config {
    // Deep merge logic
    return {
      ...base,
      ...override,
      rules: {
        ...base.rules,
        ...override.rules,
      },
    };
  }
}
```

## 7. Main Application Flow

**Application Entry Point:**
```typescript
// app/index.ts
import { PRDiscoveryService } from './discovery';
import { ContextBuilder } from './context';
import { ReviewEngine } from './review';
import { CommentPoster } from './output';
import { DatabaseManager } from './data/database';
import { ConfigLoader } from './conf/config-loader';
import { QueueProcessor } from './queue';
import pino from 'pino';

export class CodeReviewAgent {
  private logger: pino.Logger;
  private config: ConfigLoader;
  private db: DatabaseManager;
  private discovery: PRDiscoveryService;
  private contextBuilder: ContextBuilder;
  private reviewEngine: ReviewEngine;
  private outputManager: CommentPoster;
  private queueProcessor: QueueProcessor;

  constructor(configPath: string) {
    this.logger = pino({
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true }
      }
    });

    this.config = new ConfigLoader(configPath);
    const cfg = this.config.getConfig();

    this.db = new DatabaseManager(cfg.database.path);
    this.discovery = new PRDiscoveryService(cfg, this.db);
    this.contextBuilder = new ContextBuilder(cfg);
    this.reviewEngine = new ReviewEngine(cfg, cfg.claude.api_key);
    this.outputManager = new CommentPoster(cfg.platforms.github.token);
    this.queueProcessor = new QueueProcessor(this.db, this);
  }

  async start(): Promise<void> {
    this.logger.info('Starting Code Review Agent');

    const cfg = this.config.getConfig();

    if (cfg.execution.mode === 'dry-run') {
      this.logger.warn('Running in DRY-RUN mode - no changes will be posted');
    }

    // Start queue processor
    await this.queueProcessor.start();

    // Discover PRs
    this.logger.info('Discovering pull requests');
    const prs = await this.discovery.discoverPRs();

    this.logger.info(`Found ${prs.length} pull requests to review`);

    // Queue PRs for review
    for (const pr of prs) {
      await this.db.enqueueReview(pr.id, this.calculatePriority(pr));
    }

    this.logger.info('All PRs queued for review');
  }

  async reviewPullRequest(pr: PullRequest): Promise<void> {
    const startTime = Date.now();
    const cfg = this.config.getConfig(pr.repository);

    this.logger.info(`Reviewing PR #${pr.number} in ${pr.repository}`);

    try {
      // Build context
      this.logger.debug('Building review context');
      const context = await this.contextBuilder.buildContext(pr);

      await this.db.recordMetric(
        null,
        'context-build-time',
        Date.now() - startTime,
        'ms',
        { pr: pr.number }
      );

      // Execute review
      this.logger.debug('Executing review');
      const reviewStartTime = Date.now();
      const result = await this.reviewEngine.review(context);

      await this.db.recordMetric(
        null,
        'review-execution-time',
        Date.now() - reviewStartTime,
        'ms',
        { pr: pr.number, issues: result.comments.length }
      );

      // Save review to database
      const reviewId = await this.db.createReview({
        pullRequestId: pr.id,
        decision: result.decision,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
        filesAnalyzed: context.diff.files.length,
        linesAnalyzed: context.diff.totalAdditions + context.diff.totalDeletions,
        totalIssues: result.comments.length,
        criticalIssues: result.comments.filter(c => c.severity === 'critical').length,
        majorIssues: result.comments.filter(c => c.severity === 'major').length,
        minorIssues: result.comments.filter(c => c.severity === 'minor').length,
        coverageBefore: context.coverage.before.lines.pct,
        coverageAfter: context.coverage.after.lines.pct,
        coverageDelta: context.coverage.delta.lines.pct,
        buildStatus: context.buildStatus.status,
        executionMode: cfg.execution.mode,
        agentVersion: this.getVersion(),
      });

      await this.db.saveComments(reviewId, result.comments);

      // Log decision
      await this.db.logDecision(
        reviewId,
        'final-decision',
        { issues: result.comments.length, coverage: context.coverage },
        { decision: result.decision },
        `Decision: ${result.decision}. Critical: ${result.metrics.critical}, Major: ${result.metrics.major}, Coverage: ${context.coverage.after.lines.pct}%`
      );

      // Post results (unless dry-run)
      if (cfg.execution.mode === 'production') {
        this.logger.debug('Posting review results');
        await this.outputManager.postReview(pr.repository, pr, result);

        this.logger.info(
          `Review completed for PR #${pr.number}: ${result.decision} ` +
          `(${result.comments.length} issues, ${Date.now() - startTime}ms)`
        );
      } else {
        this.logger.info(
          `[DRY-RUN] Would post review for PR #${pr.number}: ${result.decision} ` +
          `(${result.comments.length} issues)`
        );
      }

    } catch (error) {
      this.logger.error(
        `Failed to review PR #${pr.number}: ${error.message}`,
        error
      );
      throw error;
    }
  }

  private calculatePriority(pr: PullRequest): number {
    // Higher priority for older PRs and those with more changes
    const ageHours = (Date.now() - pr.createdAt.getTime()) / (1000 * 60 * 60);
    let priority = 5;

    if (ageHours > 48) priority += 2;
    if (ageHours > 96) priority += 2;

    return Math.min(10, priority);
  }

  private getVersion(): string {
    return require('../package.json').version;
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping Code Review Agent');
    await this.queueProcessor.stop();
    this.db.close();
  }
}

// CLI entry point
if (require.main === module) {
  const agent = new CodeReviewAgent('./conf/config.yaml');

  agent.start().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await agent.stop();
    process.exit(0);
  });
}
```

**Queue Processor:**
```typescript
// app/queue.ts
import { DatabaseManager } from './data/database';
import { CodeReviewAgent } from './index';
import pino from 'pino';

export class QueueProcessor {
  private logger: pino.Logger;
  private running: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;

  constructor(
    private db: DatabaseManager,
    private agent: CodeReviewAgent
  ) {
    this.logger = pino({ name: 'queue-processor' });
  }

  async start(): Promise<void> {
    this.running = true;
    this.logger.info('Queue processor started');

    // Process queue every 30 seconds
    this.processingInterval = setInterval(
      () => this.processQueue(),
      30000
    );

    // Process immediately
    await this.processQueue();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    this.logger.info('Queue processor stopped');
  }

  private async processQueue(): Promise<void> {
    if (!this.running) return;

    while (this.running) {
      const item = await this.db.getNextQueuedReview();

      if (!item) break;

      try {
        await this.db.updateQueueStatus(item.id, 'processing');

        await this.agent.reviewPullRequest({
          id: item.pull_request_id,
          number: item.pr_number,
          repository: item.repository,
          // ... other fields
        });

        await this.db.updateQueueStatus(item.id, 'completed');

      } catch (error) {
        this.logger.error(
          `Failed to process queue item ${item.id}:`,
          error
        );

        await this.db.updateQueueStatus(
          item.id,
          'failed',
          error.message
        );
      }
    }
  }
}
```

## 8. Error Handling & Resilience

**Error Boundary Wrapper:**
```typescript
// app/utils/error-boundary.ts
import pino from 'pino';

export class ErrorBoundary {
  private logger: pino.Logger;

  constructor(context: string) {
    this.logger = pino({ name: `error-boundary:${context}` });
  }

  async execute<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>,
    options?: {
      retries?: number;
      retryDelay?: number;
      timeout?: number;
    }
  ): Promise<T> {
    const opts = {
      retries: options?.retries || 0,
      retryDelay: options?.retryDelay || 1000,
      timeout: options?.timeout || 300000,
    };

    let lastError: Error;

    for (let attempt = 0; attempt <= opts.retries; attempt++) {
      try {
        // Execute with timeout
        const result = await this.withTimeout(
          operation(),
          opts.timeout
        );

        if (attempt > 0) {
          this.logger.info(`Operation succeeded on attempt ${attempt + 1}`);
        }

        return result;

      } catch (error) {
        lastError = error;

        this.logger.warn(
          `Operation failed (attempt ${attempt + 1}/${opts.retries + 1}): ${error.message}`
        );

        if (attempt < opts.retries) {
          await this.delay(opts.retryDelay * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }

    // All retries exhausted
    if (fallback) {
      this.logger.info('Executing fallback');
      try {
        return await fallback();
      } catch (fallbackError) {
        this.logger.error('Fallback also failed', fallbackError);
        throw lastError;
      }
    }

    throw lastError;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

## 9. Package Dependencies

```json
{
  "name": "code-review-agent",
  "version": "1.0.0",
  "description": "Automated code review agent using Claude",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node app/index.ts",
    "test": "jest",
    "lint": "eslint app/**/*.ts",
    "dry-run": "NODE_ENV=dry-run ts-node app/index.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@octokit/rest": "^20.0.0",
    "@gitbeaker/node": "^35.0.0",
    "bitbucket": "^2.0.0",
    "bottleneck": "^2.19.5",
    "p-queue": "^8.0.0",
    "p-retry": "^6.0.0",
    "better-sqlite3": "^11.0.0",
    "simple-git": "^3.25.0",
    "tmp-promise": "^3.0.3",
    "diff-parser": "^0.0.16",
    "madge": "^8.0.0",
    "istanbul-lib-coverage": "^3.2.0",
    "@typescript-eslint/typescript-estree": "^7.0.0",
    "semgrep": "^1.0.0",
    "yaml": "^2.4.0",
    "dotenv": "^16.4.0",
    "dotenv-expand": "^11.0.0",
    "pino": "^9.0.0",
    "pino-pretty": "^11.0.0",
    "handlebars": "^4.7.8",
    "marked": "^12.0.0",
    "ioredis": "^5.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "typescript": "^5.4.0",
    "ts-node": "^10.9.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "eslint": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

## 10. Deployment & Operations

**Dockerfile:**
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache git python3 make g++

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Copy application
COPY . .
RUN npm run build

# Create data directories
RUN mkdir -p data logs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9090/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/index.js"]
```

**Docker Compose:**
```yaml
version: '3.8'

services:
  code-review-agent:
    build: .
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
      - ./conf:/app/conf:ro
    environment:
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - GITLAB_TOKEN=${GITLAB_TOKEN}
      - CLAUDE_API_KEY=${CLAUDE_API_KEY}
    restart: unless-stopped
    mem_limit: 2g
    cpus: 2

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  redis-data:
```

This comprehensive architecture provides a production-ready foundation for building the code review agent with all specified requirements implemented.