## Automated Code Review Process Flow with Claude Code SDK + GitHub MCP

### State Management Architecture

**Global Review State:**
```
{
  pr_id, branch, base_branch, files_changed[], 
  commits[], review_status, findings[], 
  validation_results{}, ci_status, iteration_count
}
```

### Process Flow Steps

#### Phase 1: Context Gathering
**Step 1.1: PR Metadata Collection**
- State: `{pr_details, linked_issues, author_history}`
- Validates: PR size, description completeness, linked tickets exist
- MCP Actions: `get_merge_request`, `get_issue`, `list_commits`
- Consistency: Cache PR state snapshot at start

**Step 1.2: Repository Context Loading**
- State: `{project_structure, dependencies, architecture_patterns}`
- Validates: Project type, framework detection, coding standards file
- MCP Actions: `get_repository_tree`, `get_file_contents` (for config files)
- Consistency: Load project rules once, apply uniformly

**Step 1.3: Diff Analysis**
- State: `{changed_files[], additions, deletions, modified_methods[]}`
- Validates: File types, change scope, breaking changes
- MCP Actions: `get_merge_request_diffs`, `get_branch_diffs`
- Consistency: Parse diff once, reference throughout

#### Phase 2: Parallel Analysis (Sub-agent Candidates)

**Step 2.1: Test Analysis Agent**
- State: `{test_coverage_delta, new_tests[], modified_tests[], test_quality_score}`
- Validates: 
  - Test presence for new functionality
  - Test naming conventions
  - Assertion quality
- MCP Actions: `get_file_contents` for test files
- Consistency: Define test pattern rules upfront

**Step 2.2: Security Analysis Agent**
- State: `{security_findings[], severity_levels[], vulnerable_patterns[]}`
- Validates:
  - Input sanitization
  - Auth checks
  - Crypto usage
  - Dependency vulnerabilities
- MCP Actions: `get_file_contents`, cross-reference with security rules
- Consistency: Use predefined security checklist

**Step 2.3: Performance Analysis Agent**
- State: `{performance_risks[], query_analysis[], complexity_scores{}}`
- Validates:
  - O(n²) or worse algorithms
  - Database query patterns
  - Memory allocation patterns
- MCP Actions: `get_file_contents` for implementation files
- Consistency: Apply same complexity thresholds

**Step 2.4: Architecture Compliance Agent**
- State: `{pattern_violations[], dependency_issues[], layer_violations[]}`
- Validates:
  - Design pattern adherence
  - Module boundaries
  - Circular dependencies
- MCP Actions: `get_file_contents`, analyze import statements
- Consistency: Load architecture rules from config

#### Phase 3: Synthesis and Decision

**Step 3.1: Finding Aggregation**
- State: `{all_findings[], severity_map{}, conflict_resolution[]}`
- Validates: No contradicting findings between agents
- Process: Merge and deduplicate findings from sub-agents
- Consistency: Priority rules for conflicting assessments

**Step 3.2: Comment Generation**
- State: `{comments[], suggestions[], blocking_issues[]}`
- Validates: Comment relevance, actionability
- MCP Actions: Prepare batch comment payload
- Consistency: Use comment templates for common issues

**Step 3.3: Review Decision**
- State: `{decision: approve|request_changes|comment, rationale}`
- Validates: All blocking issues addressed
- Process: Apply decision matrix based on findings
- Consistency: Documented approval criteria

#### Phase 4: GitHub Interaction

**Step 4.1: Comment Posting**
- State: `{posted_comments[], thread_ids[]}`
- MCP Actions: `create_merge_request_thread`, `create_note`
- Consistency: Batch all comments in single review

**Step 4.2: Status Update**
- State: `{review_status: completed, summary_posted}`
- MCP Actions: `update_merge_request`
- Consistency: Always post summary even if approved

### Sub-agent Architecture

**Use Sub-agents for:**
- Test Analysis Agent: Specialized test pattern recognition
- Security Agent: Security-specific ruleset and CVE knowledge  
- Performance Agent: Algorithm complexity analysis
- Documentation Agent: API contract and docs validation

**Single Agent for:**
- Context gathering (sequential, dependent)
- Finding synthesis (needs full context)
- GitHub interactions (maintain session state)

### Consistency Mechanisms

1. **Rule Configuration:**
```
review_rules.yml:
- blocking_thresholds
- complexity_limits  
- required_test_coverage
- security_patterns
```

2. **Decision Matrix:**
```
If critical_security_issues > 0: REQUEST_CHANGES
If test_coverage_delta < -5%: REQUEST_CHANGES  
If complexity_increase > threshold: REQUEST_CHANGES
If only_minor_issues: APPROVE_WITH_COMMENTS
Else: APPROVE
```

3. **State Checkpoints:**
- Save state after each phase
- Enable resume on timeout/failure
- Track review iterations to prevent loops

4. **Validation Gates:**
- Each step outputs standardized finding format
- Validate finding schema before aggregation
- Ensure deterministic severity assignment

### Error Handling States

**Partial Failure:**
- State: `{completed_steps[], failed_steps[], partial_findings[]}`
- Action: Post partial review with disclaimer
- MCP: `create_note` with limitation notice

**Re-review Detection:**
- State: `{previous_findings[], addressed_items[], new_issues[]}`
- Process: Diff current findings against previous
- Focus: Review only changed portions

This architecture ensures consistent, reproducible reviews by separating concerns into specialized agents while maintaining central state coordination.