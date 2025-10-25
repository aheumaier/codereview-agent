---
description: Create implementation plan from requirements document
---

I want to work in **plan mode** to create an implementation plan.

**IMPORTANT**: This command creates a plan but does NOT implement code.

Please:

1. **Find the requirements document**:
   - Look for `.md` files in `docs/requirements/` (excluding TEMPLATE.md)
   - If multiple exist, ask me which feature to plan
   - If none exist, tell me to run `/new-feature` first

2. **Read and analyze the requirements**:
   - Read the entire requirements document
   - Identify all "Must Have" requirements (section 3.1)
   - Note technical constraints (section 6)
   - Understand success criteria (section 10)

3. **Ask clarifying questions** if:
   - Any requirement is ambiguous
   - Technical approach is unclear
   - Dependencies are missing
   - Constraints conflict
   - Performance/scalability targets are vague

4. **Create detailed implementation plan** with:
   - **Phase breakdown** (if multi-phase feature)
   - **Files to create** (with estimated lines and purpose)
   - **Files to modify** (with specific changes and line numbers)
   - **Tests to write** (with coverage targets)
   - **Dependencies to add** (npm packages, versions)
   - **Success criteria checklist**
   - **Estimated time per phase**
   - **Risk assessment**

5. **Present the plan in this format**:

```markdown
# Implementation Plan: [Feature Name]

## Overview
[Brief summary of approach and architecture patterns]

## Phase 1: [Phase Name] (Estimated: X hours/days)

### Files to Create:
1. `path/to/file.js` (~100 lines)
   - Purpose: [What it does]
   - Key components: [Classes, functions]
   - Dependencies: [What it imports]

### Files to Modify:
1. `path/to/existing.js`
   - Lines to change: [Specific line ranges if known]
   - Changes: [What will be modified]
   - Reason: [Why this change]

### Tests to Create:
1. `tests/unit/feature.test.js` (~200 lines)
   - Test cases: [List key scenarios]
   - Coverage target: 90%+

### Success Criteria:
- [ ] All files created
- [ ] Tests pass
- [ ] No breaking changes

## Risks & Mitigations:
- Risk: [Description] → Mitigation: [How to prevent]

## Estimated Total Time: [X hours/days/weeks]
```

6. **Wait for my approval**:
   - Show the complete plan
   - Highlight any risks or concerns
   - Ask: "Does this plan look good, or would you like me to adjust anything?"

**Do NOT start implementing code until I explicitly approve the plan.**

If I say "approved" or "looks good", ask me:
"Should I implement all phases at once, or would you like me to implement Phase 1 first and wait for your review?"
