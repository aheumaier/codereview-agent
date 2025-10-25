---
description: Implement the approved plan incrementally
---

I want to implement the feature based on the approved plan.

**Prerequisites**: You must have already created and approved an implementation plan using `/plan`.

Please:

1. **Verify plan exists**:
   - Check if we have an approved implementation plan in this conversation
   - If no plan exists, tell me to run `/plan` first

2. **Confirm incremental approach**:
   - Ask me: "Should I implement all phases, or implement Phase 1 and wait for review?"
   - Default to incremental (one phase at a time)

3. **For each phase**:

   a. **Before implementing**:
      - Show which phase you're about to implement
      - List files that will be created/modified
      - Ask for confirmation

   b. **During implementation**:
      - Create files one at a time
      - After each file, show me what you created
      - Ask if I want to review before moving to next file
      - Use established patterns from CLAUDE.md:
        - Export classes, not singletons
        - Add JSDoc comments
        - Follow ES6+ conventions
        - Keep functions small (<50 lines)

   c. **After implementation**:
      - Run tests: `npm test`
      - Show test results
      - If tests fail, fix issues
      - Show summary of changes

4. **Summary after each phase**:

```markdown
## Phase [N] Complete

### Files Created ([X]):
- path/to/file.js ([Y] lines) - [Purpose]

### Files Modified ([X]):
- path/to/file.js (+[additions] -[deletions]) - [Changes]

### Test Results:
- Tests: [passed/total]
- Coverage: [X]%

### Next Steps:
[What comes next - either next phase or ready for commit]
```

5. **Wait for phase approval**:
   - After completing a phase, ask: "Ready to proceed to Phase [N+1], or would you like me to make changes?"
   - Don't proceed to next phase without approval

6. **When all phases complete**:
   - Show comprehensive summary
   - Run full test suite
   - Ask if ready to commit

**Implementation Guidelines**:
- Follow patterns from `CLAUDE.md`
- Match the approved plan exactly
- If you need to deviate from plan, ask permission first
- Write tests alongside code (TDD approach)
- Keep me informed of progress

If at any point you encounter issues:
- Explain the problem
- Propose solutions
- Wait for my decision
