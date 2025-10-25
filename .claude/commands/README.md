# Claude Code Workflow Commands

This directory contains custom slash commands that automate the development workflow described in `docs/development-workflow-with-claude.md`.

## Available Commands

### `/new-feature` - Start New Feature
**Purpose**: Create feature branch and requirements document

**Usage**:
```
/new-feature
```

**What it does**:
1. Asks for feature name
2. Creates `feature/<name>` branch
3. Copies requirements template
4. Opens requirements for editing

**When to use**: Starting any new feature or significant change

---

### `/review-requirements` - Validate Requirements
**Purpose**: Review requirements document for completeness and clarity

**Usage**:
```
/review-requirements
```

**What it does**:
1. Finds requirements document
2. Analyzes completeness
3. Asks clarifying questions
4. Provides structured feedback
5. Suggests improvements

**When to use**: After drafting requirements, before creating plan

---

### `/plan` - Create Implementation Plan
**Purpose**: Generate detailed implementation plan from requirements

**Usage**:
```
/plan
```

**What it does**:
1. Reads requirements document
2. Asks clarifying questions
3. Creates phase-by-phase plan
4. Lists files to create/modify
5. Estimates effort
6. Waits for approval

**When to use**: After requirements are finalized

**Important**: Does NOT implement code, only creates plan

---

### `/implement` - Execute Implementation
**Purpose**: Implement the approved plan incrementally

**Usage**:
```
/implement
```

**What it does**:
1. Verifies approved plan exists
2. Implements phase by phase
3. Shows progress after each file
4. Runs tests after each phase
5. Waits for approval between phases

**When to use**: After plan is approved

**Best practice**: Implement one phase at a time

---

### `/commit` - Create Conventional Commit
**Purpose**: Commit changes with proper conventional commit format

**Usage**:
```
/commit
```

**What it does**:
1. Reviews changed files
2. Runs tests
3. Drafts commit message (conventional format)
4. Shows preview
5. Commits after approval

**When to use**: After implementation is complete and tested

**Format**: Follows conventional commits specification

---

### `/pr` - Create Pull Request
**Purpose**: Create PR with comprehensive description

**Usage**:
```
/pr
```

**What it does**:
1. Checks branch status
2. Pushes if needed
3. Drafts PR title and description
4. Creates PR via GitHub CLI
5. Returns PR URL

**When to use**: After committing and pushing changes

**Requires**: `gh` CLI installed (or provides manual instructions)

---

### `/workflow-status` - Check Workflow Progress
**Purpose**: Show current status and suggest next step

**Usage**:
```
/workflow-status
```

**What it does**:
1. Detects current workflow phase
2. Shows what's completed
3. Recommends next command
4. Displays progress visualization

**When to use**: Anytime you're unsure what to do next

---

## Typical Workflow

### For a New Feature:

```bash
# 1. Start new feature
/new-feature
# → Creates branch and requirements doc

# 2. Fill in requirements
# (Edit docs/requirements/my-feature.md)

# 3. Review requirements
/review-requirements
# → Get feedback and refine

# 4. Create implementation plan
/plan
# → Review and approve plan

# 5. Implement phase by phase
/implement
# → Code gets created incrementally

# 6. Commit changes
/commit
# → Creates conventional commit

# 7. Create pull request
/pr
# → PR ready for review
```

### Check Status Anytime:

```bash
/workflow-status
# Shows where you are and what to do next
```

---

## Command Chaining Example

**Scenario**: Implementing a new rate limiting feature

```bash
# Day 1: Setup and planning
/new-feature
# Feature name: rate-limiting
# → Creates feature/rate-limiting branch
# → Creates docs/requirements/rate-limiting.md

# Fill in requirements (manually edit the file)

/review-requirements
# → Claude reviews, asks questions
# → Refine requirements based on feedback

/plan
# → Claude creates 3-phase implementation plan
# → Review and approve

# Day 2: Implementation Phase 1
/implement
# "Implement Phase 1 only"
# → Token bucket algorithm implementation
# → Tests created
# → Phase 1 complete

# Day 3: Implementation Phase 2
/implement
# "Continue with Phase 2"
# → Rate limiter integration
# → Tests pass
# → Phase 2 complete

# Day 4: Final phase and PR
/implement
# "Continue with Phase 3"
# → Documentation and examples
# → All tests pass

/commit
# → Creates commit with detailed message

/pr
# → PR created with comprehensive description
```

---

## Benefits

✅ **Consistency**: Every feature follows the same process
✅ **Automation**: Reduces manual work and mistakes
✅ **Documentation**: Forces proper documentation at each step
✅ **Review**: Plan review before implementation reduces rework
✅ **Quality**: Tests and commit messages are standardized
✅ **Traceability**: Clear connection from requirements → plan → code → PR

---

## Customization

You can customize these commands by editing the `.md` files in this directory.

**Command file structure**:
```markdown
---
description: Short description shown in /help
---

[Detailed instructions for Claude Code]
```

**Tips for customization**:
- Add project-specific checks
- Adjust templates to match your team's standards
- Add additional validation steps
- Integrate with other tools (linters, formatters, etc.)

---

## Integration with Existing Workflow

These commands implement the workflow described in:
- `docs/development-workflow-with-claude.md` - Comprehensive workflow guide
- `docs/requirements/TEMPLATE.md` - Requirements template
- `CLAUDE.md` - Project-specific guidelines

They are designed to work together as a complete system.

---

## Troubleshooting

**Command not found**:
- Make sure you're using Claude Code (not regular Claude)
- Commands must be in `.claude/commands/` directory
- File must end in `.md`

**Command doesn't work as expected**:
- Check command file syntax
- Ensure prerequisites are met (e.g., requirements exist)
- Try `/workflow-status` to see current state

**Need help**:
- Run `/help` to see all commands
- Check `docs/development-workflow-with-claude.md`
- Ask Claude: "Explain the /[command-name] command"

---

## Version History

- **v1.0** (2025-01-17): Initial command set created
  - 6 core workflow commands
  - 1 status command
  - Full workflow automation

---

**Questions?**
- See `docs/development-workflow-with-claude.md` for detailed workflow
- See `CLAUDE.md` for project-specific patterns
- Ask Claude for help anytime!
