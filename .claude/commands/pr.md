---
description: Create pull request with comprehensive description
---

I want to create a pull request for the feature branch.

Please:

1. **Verify prerequisites**:
   - Check current branch (must not be main)
   - Check if branch is pushed to remote
   - Check if there are unpushed commits
   - If unpushed commits exist, ask: "Should I push to remote first?"

2. **Gather PR information**:
   - Get branch name
   - Get commit history: `git log main..HEAD --oneline`
   - Get diff summary: `git diff main...HEAD --stat`
   - Identify files changed

3. **Draft PR title**:
   Format: `<type>: <Short description>`

   Examples:
   - `feat: Dynamic platform selection with registry pattern`
   - `fix: Prevent memory leak in review merger`
   - `refactor: Simplify MCP connection management`

4. **Draft PR description** using this template:

```markdown
## Summary
[1-2 sentence overview of what this PR does]

## Changes
- ✅ [Key change 1]
- ✅ [Key change 2]
- ✅ [Key change 3]

## Technical Details
- **Architecture**: [Design patterns used, e.g., Strategy + Registry]
- **Files Added**: [Count and purpose]
- **Files Modified**: [Count and purpose]
- **Lines Changed**: +[additions] -[deletions]

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] E2E tests pass (if applicable)
- [ ] Test coverage: [X]%
- [ ] Manual testing completed

## Performance Impact
- [None / Improves X by Y% / Degrades X by Y%]

## Documentation
- [ ] CLAUDE.md updated (if architecture changed)
- [ ] README.md updated (if user-facing)
- [ ] Inline JSDoc comments added
- [ ] Architecture diagrams updated (if needed)

## Breaking Changes
- [ ] No breaking changes
- [ ] Breaking changes (describe below)

[If breaking changes, explain what breaks and migration path]

## Checklist
- [x] Code follows project conventions
- [x] Tests pass locally
- [x] No console warnings/errors
- [x] Commit messages follow conventional format
- [x] Branch is up to date with main

## Related Issues
Closes #[issue-number]
Relates to #[issue-number]

## Screenshots (if UI changes)
[Add screenshots if applicable]

## Additional Notes
[Any additional context, concerns, or follow-up items]

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

5. **Show me the PR draft** and ask:
   "Does this PR description look good? Any changes needed?"

6. **After approval**, create PR:
   ```bash
   gh pr create \
     --title "[title]" \
     --body "[body]"
   ```

7. **Verify PR created**:
   - Show PR URL
   - Show PR number
   - Ask: "Would you like me to add reviewers or labels?"

**Alternative methods**:

If `gh` CLI not available, provide instructions:
```
Please create PR manually:
1. Go to: https://github.com/[owner]/[repo]/compare/[branch]
2. Use this title: [title]
3. Use this description: [description]
```

**Best Practices**:
- Include all context needed for reviewers
- Link related issues
- Show test evidence
- Explain architectural decisions
- Make it easy to review and merge
