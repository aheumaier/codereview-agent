# Feature Requirements: [Feature Name]

> **Template Version:** 1.0 (Optimized for AI Agents)
> **Created:** YYYY-MM-DD
> **Status:** Draft | In Review | Approved | Implemented
> **Owner:** [Your Name]
> **AI Agent:** Claude Code

---

## Quick Reference

| Property | Value |
|----------|-------|
| **Feature Name** | [Short descriptive name] |
| **Priority** | Critical / High / Medium / Low |
| **Complexity** | High / Medium / Low |
| **Estimated Effort** | [hours/days/weeks] |
| **Target Release** | [version or date] |
| **Dependencies** | [other features, libraries, or none] |

---

## 1. Objective

**In one sentence, what problem does this feature solve?**

[Clear, concise problem statement]

**Example:**
> Enable dynamic platform selection so the agent only initializes configured platforms (GitHub, GitLab, Confluence) without errors for missing configurations.

---

## 2. Background & Context

**Why is this needed?**

[Provide context for AI agents and future developers]

**Current State:**
- [What exists today]
- [What's the problem or limitation]

**Desired State:**
- [What should exist after this feature]
- [How it improves the situation]

**Example:**
```
Current State:
- All platforms are attempted even if not configured
- Missing configs cause errors and crashes
- Adding new platforms requires modifying 4+ core files

Desired State:
- Only configured platforms are initialized
- Missing configs are gracefully handled
- New platforms added via plugin pattern (no core changes)
```

---

## 3. Functional Requirements

### 3.1 Must Have (Critical)

These requirements are **mandatory** for the feature to be considered complete.

- **FR-1**: [Requirement]
  - **Acceptance Criteria:**
    - [ ] [Specific, testable criterion]
    - [ ] [Specific, testable criterion]
  - **Validation:** [How to verify this requirement is met]

- **FR-2**: [Requirement]
  - **Acceptance Criteria:**
    - [ ] [Specific, testable criterion]
  - **Validation:** [How to verify]

**Example:**
```markdown
- **FR-1**: Platform Configuration Validation
  - **Acceptance Criteria:**
    - [ ] System validates each platform config before initialization
    - [ ] Invalid configs return clear error messages
    - [ ] System continues with valid platforms if some invalid
  - **Validation:** Run with mix of valid/invalid configs, verify only valid platforms load

- **FR-2**: Dynamic Platform Registry
  - **Acceptance Criteria:**
    - [ ] Registry maintains list of available platform adapters
    - [ ] Only configured platforms are included in active list
    - [ ] Can query "which platforms are ready?"
  - **Validation:** Call registry.getConfiguredPlatforms() returns only valid ones
```

### 3.2 Should Have (Important but not Critical)

These requirements enhance the feature but can be deferred if needed.

- **FR-3**: [Requirement]
  - **Acceptance Criteria:**
    - [ ] [Specific criterion]
  - **Defer Condition:** [When this can be moved to later phase]

**Example:**
```markdown
- **FR-3**: Health Monitoring
  - **Acceptance Criteria:**
    - [ ] Periodic health checks for each platform
    - [ ] Platform availability metrics collected
  - **Defer Condition:** If timeline is tight, implement in Phase 2
```

### 3.3 Could Have (Nice to Have)

These are enhancements that add value but are optional.

- **FR-4**: [Requirement]
- **FR-5**: [Requirement]

### 3.4 Won't Have (Out of Scope)

Explicitly list what is **NOT** included in this feature to avoid scope creep.

- ❌ [What we're NOT doing]
- ❌ [What we're NOT doing]
- ❌ [What we're NOT doing]

**Example:**
```markdown
- ❌ Not migrating existing GitLab integration (reuse as-is)
- ❌ Not implementing Bitbucket (stub only)
- ❌ Not adding user authentication to platforms
- ❌ Not creating admin UI for configuration
```

---

## 4. Non-Functional Requirements

### 4.1 Performance

- **NFR-1**: [Performance target]
  - **Measurement:** [How to measure]
  - **Acceptance:** [Acceptable range]

**Example:**
```markdown
- **NFR-1**: Platform discovery must complete in < 10s
  - **Measurement:** Time from start to all PRs discovered
  - **Acceptance:** 95th percentile < 10s with 3 platforms

- **NFR-2**: Memory usage per platform adapter < 50MB
  - **Measurement:** Process memory before/after adapter init
  - **Acceptance:** Heap growth < 50MB per adapter
```

### 4.2 Scalability

- **NFR-3**: [Scalability requirement]

**Example:**
```markdown
- **NFR-3**: Support up to 10 concurrent platforms
  - **Validation:** Test with 10 different platform adapters
```

### 4.3 Reliability

- **NFR-4**: [Reliability requirement]

**Example:**
```markdown
- **NFR-4**: 99% uptime for platform operations
  - **Implementation:** Circuit breaker prevents cascade failures
  - **Validation:** Chaos testing with simulated platform failures
```

### 4.4 Security

- **NFR-5**: [Security requirement]

**Example:**
```markdown
- **NFR-5**: Platform credentials never logged
  - **Validation:** Code review + grep for token logging
```

### 4.5 Maintainability

- **NFR-6**: [Maintainability requirement]

**Example:**
```markdown
- **NFR-6**: Adding new platform takes < 2 hours
  - **Validation:** Time a developer adding Confluence adapter
```

---

## 5. Technical Design

### 5.1 Architecture Approach

**Preferred architectural pattern:**

[Strategy / Factory / Singleton / Observer / etc.]

**Rationale:**

[Why this pattern is appropriate]

**Example:**
```markdown
**Pattern:** Strategy + Registry

**Rationale:**
- Strategy pattern: Each platform is an interchangeable algorithm
- Registry pattern: Centralized discovery and management
- Benefits: OCP compliance, easy to extend, testable in isolation
```

### 5.2 Components

List major components to be created/modified:

| Component | Type | Responsibility | Location |
|-----------|------|----------------|----------|
| [Component Name] | Class / Module / Function | [What it does] | [File path] |

**Example:**
```markdown
| Component | Type | Responsibility | Location |
|-----------|------|----------------|----------|
| IPlatformAdapter | Abstract Class | Define platform interface | app/platforms/IPlatformAdapter.js |
| PlatformRegistry | Singleton Class | Manage platform adapters | app/platforms/PlatformRegistry.js |
| GitLabAdapter | Concrete Class | GitLab-specific implementation | app/platforms/GitLabAdapter.js |
```

### 5.3 Data Models

**New or modified data structures:**

```javascript
// Example
const PlatformConfig = {
  enabled: boolean,
  mcpServer: {
    type: 'npx' | 'docker' | 'node',
    package: string,
    version: string
  },
  env: object,
  // ... platform-specific fields
};
```

### 5.4 API / Interface Design

**Public interfaces that other modules will use:**

```javascript
// Example
class IPlatformAdapter {
  isConfigured(): boolean;
  getName(): string;
  getCapabilities(): object;
  discoverPullRequests(): Promise<PR[]>;
  buildContext(pr): Promise<Context>;
  postReview(pr, review): Promise<void>;
}
```

### 5.5 Dependencies

**External libraries or modules required:**

- [ ] Library: [name and version]
  - **Purpose:** [Why needed]
  - **Alternatives considered:** [Other options]

**Example:**
```markdown
- [ ] @modelcontextprotocol/sdk: ^0.5.0
  - **Purpose:** MCP client communication
  - **Alternatives:** Direct stdio implementation (too complex)

- [ ] None (using Node.js built-ins)
```

---

## 6. Technical Constraints

### 6.1 Must Use

**Technologies, patterns, or libraries that MUST be used:**

- [Technology]: [Reason]

**Example:**
```markdown
- **Node.js ESM**: Project uses ES modules, must continue
- **Jest**: Testing framework already in use
- **MCP Protocol**: Standard for platform communication
```

### 6.2 Cannot Modify

**Files, modules, or systems that CANNOT be changed:**

- [File/Module]: [Reason]

**Example:**
```markdown
- `app/review.js`: Core review logic, do not touch
- `data/reviews.db`: Database schema frozen (backward compat)
- Existing environment variable names (breaking change)
```

### 6.3 Must Be Compatible With

**Systems or versions that must remain compatible:**

- [System]: [Version/Constraint]

**Example:**
```markdown
- Node.js: >= 18.0.0
- Existing GitLab integration: Must continue working unchanged
- Current configuration format: Backward compatible
```

---

## 7. Testing Requirements

### 7.1 Unit Tests

- **Coverage Target:** [percentage]%
- **Key Test Scenarios:**
  - [ ] [Scenario]
  - [ ] [Scenario]

**Example:**
```markdown
- **Coverage Target:** 90%
- **Key Test Scenarios:**
  - [ ] Platform with valid config returns isConfigured() = true
  - [ ] Platform with missing token returns isConfigured() = false
  - [ ] Registry only returns configured platforms
  - [ ] Invalid adapter registration throws error
```

### 7.2 Integration Tests

- **Test Scenarios:**
  - [ ] [End-to-end scenario]

**Example:**
```markdown
- [ ] Discover PRs from GitLab only when only GitLab configured
- [ ] Discover PRs from multiple platforms in parallel
- [ ] Graceful handling when platform MCP server unavailable
```

### 7.3 Edge Cases

**Specific edge cases that must be tested:**

- [ ] [Edge case]

**Example:**
```markdown
- [ ] No platforms configured (returns empty array, no errors)
- [ ] All platforms misconfigured (logs warning, continues)
- [ ] Platform becomes unavailable mid-review (circuit breaker)
- [ ] Very large number of PRs (pagination, memory limits)
```

---

## 8. Documentation Requirements

### 8.1 Code Documentation

- [ ] JSDoc for all public methods
- [ ] Inline comments for complex logic
- [ ] README for new modules

### 8.2 User Documentation

- [ ] Update `CLAUDE.md` with architecture changes
- [ ] Update `README.md` if user-facing changes
- [ ] Create migration guide if breaking changes

### 8.3 Architecture Documentation

- [ ] Update architecture diagrams
- [ ] Document design decisions
- [ ] Add to `docs/` if new pattern introduced

**Example:**
```markdown
- [x] Create docs/platform-dynamic-selection-architecture.md
- [ ] Update CLAUDE.md with platform adapter section
- [ ] Add class diagram for platform hierarchy
```

---

## 9. Migration & Rollback

### 9.1 Migration Path

**If this changes existing functionality:**

- **Current State:** [How it works now]
- **New State:** [How it will work]
- **Migration Steps:**
  1. [Step]
  2. [Step]

### 9.2 Backward Compatibility

- **Breaking Changes:** Yes / No
- **If Yes, describe:**

**Example:**
```markdown
- **Breaking Changes:** No
- **Compatibility:** Existing configs continue to work unchanged
- **New configs:** Optional mcpServer field, defaults to current behavior
```

### 9.3 Rollback Plan

**If deployment fails, how to rollback:**

1. [Rollback step]
2. [Rollback step]

**Example:**
```markdown
1. Disable new feature via feature flag
2. Restart service with previous version
3. Verify existing functionality works
4. Investigate issue and fix
```

---

## 10. Success Criteria

**How do we know this feature is complete and successful?**

### 10.1 Functional Success

- [ ] All "Must Have" requirements implemented
- [ ] All acceptance criteria met
- [ ] All test scenarios pass

### 10.2 Quality Success

- [ ] Code coverage >= [target]%
- [ ] No critical bugs
- [ ] Performance targets met
- [ ] Documentation complete

### 10.3 Validation

**How to demonstrate success:**

```bash
# Example validation script
npm test -- --coverage
npm run test:integration
npm run benchmark
```

---

## 11. Timeline & Phases

**Break into phases if large feature:**

| Phase | Description | Duration | Deliverables |
|-------|-------------|----------|--------------|
| 1 | [Phase name] | [time] | [What's done] |
| 2 | [Phase name] | [time] | [What's done] |

**Example:**
```markdown
| Phase | Description | Duration | Deliverables |
|-------|-------------|----------|--------------|
| 1 | Foundation | 1 week | IPlatformAdapter, Registry, ConnectionManager |
| 2 | GitLab Adapter | 1 week | Working GitLabAdapter with tests |
| 3 | GitHub Adapter | 1 week | Working GitHubAdapter with tests |
| 4 | Core Refactoring | 1 week | Remove switch statements, use adapters |
| 5 | Testing | 1 week | Integration tests, E2E tests |
```

---

## 12. Risks & Mitigation

**What could go wrong?**

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| [Risk description] | High/Med/Low | High/Med/Low | [How to prevent/handle] |

**Example:**
```markdown
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Breaking existing GitLab integration | Medium | High | Comprehensive testing before refactor |
| MCP SDK breaking changes | Low | High | Pin SDK version, test before upgrading |
| Performance regression | Medium | Medium | Benchmark before/after, optimize if needed |
| Developer learning curve | High | Low | Detailed docs, code examples, templates |
```

---

## 13. Open Questions & Decisions

**Questions that need answers before implementation:**

- [ ] **Q1:** [Question]
  - **Decision:** [To be decided / Decided: ...]
  - **Rationale:** [Why]

**Example:**
```markdown
- [ ] **Q1:** Should we use in-memory or Redis for rate limiting?
  - **Decision:** In-memory for MVP, Redis in Phase 2
  - **Rationale:** Simpler to implement, defer complexity

- [x] **Q2:** Which design pattern for platform adapters?
  - **Decision:** Strategy + Registry pattern
  - **Rationale:** Aligns with SOLID, proven pattern for plugin systems
```

---

## 14. References

**Related documents, issues, PRs:**

- Architecture Docs: [link]
- Related Issues: [#123, #456]
- Design Discussions: [link to discussion]
- External Resources: [relevant articles, RFCs]

**Example:**
```markdown
- Architecture: docs/platform-dynamic-selection-architecture.md
- Related Issue: #42 (Platform crashes with missing config)
- Design Pattern: https://refactoring.guru/design-patterns/strategy
- MCP Protocol: https://modelcontextprotocol.io/
```

---

## 15. AI Agent Instructions

**Specific instructions for Claude Code or other AI agents:**

### 15.1 Plan Mode Workflow

```
When you read this requirements document:

1. **Analyze thoroughly**
   - Understand the objective
   - Identify all must-have requirements
   - Note technical constraints

2. **Ask clarifying questions if:**
   - Any requirement is ambiguous
   - Technical approach is unclear
   - Dependencies are missing
   - Constraints conflict

3. **Create implementation plan with:**
   - Phase breakdown (if multi-phase)
   - Files to create (with estimated lines)
   - Files to modify (with specific changes)
   - Tests to write
   - Success criteria checklist
   - Estimated time per phase

4. **Wait for approval**
   - Show complete plan
   - Highlight risks or concerns
   - Don't start coding until approved

5. **Implement incrementally**
   - One phase at a time
   - Show progress after each file
   - Run tests frequently
   - Request review before next phase
```

### 15.2 Code Style & Patterns

**Follow these patterns:**

- Use ES6+ features (async/await, destructuring, etc.)
- Export classes, not instances (for testability)
- Add JSDoc comments to all public methods
- Follow existing code style in the project
- Use descriptive variable names
- Keep functions small (<50 lines)

### 15.3 Testing Patterns

**For each component:**

```javascript
// 1. Test happy path
describe('FeatureName', () => {
  it('should work with valid input', () => {
    // Test
  });
});

// 2. Test edge cases
it('should handle null input', () => {});
it('should handle empty input', () => {});

// 3. Test error cases
it('should throw on invalid input', () => {});
```

### 15.4 Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Types:** feat, fix, refactor, docs, test, chore, perf

---

## 16. Approval Signatures

**Sign off when requirements are approved:**

- [ ] **Product Owner:** [Name] - [Date]
- [ ] **Tech Lead:** [Name] - [Date]
- [ ] **Architect:** [Name] - [Date]

**Notes:**
[Any approval notes or conditions]

---

## 17. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | YYYY-MM-DD | [Name] | Initial draft |
| 1.1 | YYYY-MM-DD | [Name] | Added X, removed Y |

---

## Template Usage Notes

**How to use this template:**

1. **Copy this file:**
   ```bash
   cp docs/requirements/TEMPLATE.md docs/requirements/my-feature.md
   ```

2. **Fill in all sections:**
   - Don't skip sections (write "N/A" if not applicable)
   - Be specific and measurable
   - Use examples liberally

3. **Review with AI agent:**
   ```
   Claude, please review docs/requirements/my-feature.md
   and ask clarifying questions.
   ```

4. **Iterate until clear:**
   - Answer AI questions
   - Refine requirements
   - Add missing details

5. **Activate plan mode:**
   ```
   Plan mode: Read docs/requirements/my-feature.md
   and create implementation plan.
   ```

**Tips for AI agents:**
- ✅ Clear, specific requirements → better plans
- ✅ Constraints listed → fewer iterations
- ✅ Success criteria defined → know when done
- ❌ Vague requirements → back-and-forth clarifications
- ❌ Missing constraints → rework after implementation

**This template is optimized for:**
- Human readability (clear structure)
- AI agent parsing (consistent format)
- Completeness (covers all aspects)
- Actionability (specific, testable criteria)

---

**Questions about this template?**
See `docs/development-workflow-with-claude.md` for usage guide.
