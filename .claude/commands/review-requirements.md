---
description: Review and validate requirements document
---

I want you to review my requirements document and help me improve it.

Please:

1. **Find the requirements document**:
   - Look for `.md` files in `docs/requirements/` (excluding TEMPLATE.md)
   - If multiple exist, ask me which one to review
   - If none exist, tell me to run `/new-feature` first

2. **Read the entire document**

3. **Analyze completeness** - Check if these critical sections are filled in:
   - [ ] **Objective** (Section 1): Clear one-sentence problem statement
   - [ ] **Background & Context** (Section 2): Current vs. Desired state
   - [ ] **Must Have Requirements** (Section 3.1): Specific, testable criteria
   - [ ] **Technical Constraints** (Section 6): Must use / Cannot modify
   - [ ] **Testing Requirements** (Section 7): Coverage targets and scenarios
   - [ ] **Success Criteria** (Section 10): How to verify completion

4. **Ask clarifying questions** for any:
   - Vague or ambiguous requirements
   - Missing acceptance criteria
   - Unclear technical constraints
   - Unspecified performance targets
   - Missing test scenarios
   - Undefined success criteria

5. **Provide feedback** in this format:

```markdown
## Requirements Review: [Feature Name]

### ✅ Strengths
- [What's good about the requirements]

### ⚠️ Issues Found

#### Critical (Must Fix):
1. **[Section Name]**: [Issue description]
   - **Problem**: [What's wrong]
   - **Suggestion**: [How to fix]

#### Recommended (Should Fix):
2. **[Section Name]**: [Issue description]
   - **Suggestion**: [How to improve]

#### Optional (Could Improve):
3. **[Section Name]**: [Enhancement suggestion]

### ❓ Clarifying Questions
1. [Question about requirement X]
2. [Question about constraint Y]
3. [Question about success criteria Z]

### 📋 Completeness Checklist
- [x] Objective is clear and specific
- [ ] Must Have requirements are testable
- [x] Technical constraints are documented
- [ ] Success criteria are measurable

### 🎯 Recommendation
[Ready for planning / Needs refinement / Major gaps to address]
```

6. **Offer to help** with:
   - Drafting missing sections
   - Making requirements more specific
   - Adding acceptance criteria
   - Defining success metrics

**Review Criteria**:

- **Specific**: "Reduce latency to <100ms" not "Make it faster"
- **Measurable**: Can we test if it's done?
- **Achievable**: Is it realistic?
- **Relevant**: Does it solve the problem?
- **Time-bound**: What's the timeline?

**Red Flags**:
- ❌ Vague objectives like "Improve system"
- ❌ Requirements without acceptance criteria
- ❌ No technical constraints specified
- ❌ Success criteria missing or not measurable
- ❌ "Should have" items that are actually "Must have"
- ❌ Conflicting constraints

**After review**, ask:
"Would you like me to update the requirements document with these suggestions, or would you prefer to make the changes yourself?"
