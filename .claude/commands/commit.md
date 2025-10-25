---
description: Create conventional commit with proper format
---

I want to commit the implemented changes using conventional commit format.

Please:

1. **Review current changes**:
   - Run `git status` to see modified/new files
   - Run `git diff --stat` to see change summary
   - Show me the list of changed files

2. **Verify tests pass**:
   - Run `npm test`
   - If tests fail, ask if I want to fix them or commit anyway
   - Show test coverage summary

3. **Draft commit message** using conventional commit format:

```
<type>(<scope>): <subject>

<body>

<footer>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Type selection**:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring (no functional changes)
- `docs`: Documentation only
- `test`: Adding/fixing tests
- `chore`: Build, dependencies, tooling
- `perf`: Performance improvement

**Scope**: Component/module name (e.g., `platforms`, `review`, `config`)

**Subject**:
- Imperative mood (e.g., "add", not "added" or "adds")
- No period at end
- Max 50 characters

**Body**:
- Explain WHAT and WHY (not HOW)
- List key changes as bullet points
- Include benefits/improvements
- Max 72 characters per line

**Footer**:
- `BREAKING CHANGE:` if applicable (explain what breaks)
- `Fixes #123` if closing issue
- Always include Claude Code signature

4. **Show me the commit message** and ask:
   "Does this commit message look good, or would you like me to adjust it?"

5. **After approval**, execute:
   ```bash
   git add .
   git commit -m "<message>"
   ```

6. **Verify commit**:
   - Run `git log --oneline -1` to show the commit
   - Ask: "Ready to push to remote? (git push)"

**Example commit messages**:

```
feat(platforms): add GitLab adapter with registry pattern

Implement GitLab platform adapter using Strategy pattern.

Changes:
- Create GitLabAdapter implementing IPlatformAdapter
- Add configuration validation
- Implement PR discovery via MCP
- Add comprehensive unit tests (95% coverage)

Benefits:
- GitLab can now be dynamically enabled/disabled
- Consistent interface with other platforms
- Easy to maintain and extend

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

```
fix(review): prevent memory leak from review metadata

Remove _reviewNumber and _temperature from review objects before
returning merged results.

- Delete metadata after merge completion
- Add tests to verify cleanup
- Update documentation with pitfall warning

Fixes #42

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Important**:
- Never commit without running tests first
- Use HEREDOC format for multi-line messages in bash
- Always include Claude Code signature
