---
description: Show current workflow status and suggest next step
---

Show me the current status of the development workflow and what I should do next.

Please:

1. **Detect current context**:
   - Check git branch (am I on feature branch or main?)
   - Check for requirements documents in `docs/requirements/`
   - Check git status (any uncommitted changes?)
   - Check if PR exists for current branch
   - Look back in conversation for approved plans

2. **Show workflow status**:

```markdown
## Workflow Status

### Current Branch
[branch-name] ([ahead/behind main by X commits])

### Requirements Documents
- [x] docs/requirements/feature-x.md (exists)
- [ ] No requirements found

### Implementation Plan
- [x] Plan created and approved in this conversation
- [ ] No plan found - run `/plan`

### Code Status
- Files changed: [X]
- Tests passing: [Yes/No/Unknown]
- Uncommitted changes: [Yes/No]

### Pull Request
- [x] PR #123 created
- [ ] No PR yet

### Current Phase
You are in: [Phase name]
```

3. **Determine next step** based on status:

**If on main branch**:
→ Run `/new-feature` to start a new feature

**If on feature branch with no requirements**:
→ Run `/new-feature` to create requirements document

**If requirements exist but not reviewed**:
→ Run `/review-requirements` to validate requirements

**If requirements good but no plan**:
→ Run `/plan` to create implementation plan

**If plan exists but not implemented**:
→ Run `/implement` to start coding

**If code implemented but not committed**:
→ Run `/commit` to create conventional commit

**If committed but not pushed**:
→ Run `git push` to push to remote

**If pushed but no PR**:
→ Run `/pr` to create pull request

**If PR exists**:
→ Wait for review, or make requested changes

4. **Show recommended commands**:

```markdown
## Next Steps

### Recommended
Run: `/[command]`
Reason: [Why this is the next step]

### Alternative Actions
- `/[other-command]`: [When to use this]
- `/[another-command]`: [When to use this]
```

5. **Provide workflow visualization** showing where we are:

```
[✓] Create feature branch
[✓] Draft requirements
[✓] Review requirements
[→] Create implementation plan  ← YOU ARE HERE
[ ] Implement code
[ ] Run tests
[ ] Commit changes
[ ] Create PR
[ ] Merge to main
```

**Helpful reminders**:
- Check CLAUDE.md for project-specific patterns
- Check docs/development-workflow-with-claude.md for detailed workflow
- Use `/help` to see all available commands
