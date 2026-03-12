# Global OpenCode Instructions

## .local/ Directory Convention

Every git repository should use a `.local/` directory at the repo root for temporary, session-scoped information. This is a universal convention across all projects.

### Rules

1. **Before writing anything to `.local/`**, ensure it exists and is listed in the repo's `.gitignore`. If `.gitignore` does not contain `.local/`, add it before creating any files.
2. **Use `.local/CONTEXT.md`** as the standard location for dumping research results, analysis notes, and other temporary context gathered during a session.
3. **Content in `.local/` is ephemeral.** It may be useful across sessions but is not permanent documentation. Do not reference `.local/` files as authoritative sources in commits or PRs.
4. **Do not commit `.local/` contents.** The directory must always be gitignored.

### When to Write to .local/CONTEXT.md

- After researching a codebase to answer a question
- When gathering context that may be useful later in the session
- When summarizing findings from multiple files or sources
- When capturing decisions or trade-offs considered during a task

### Format for .local/CONTEXT.md

Use clear markdown headings. Append new sections rather than overwriting previous content. Include timestamps or topic headers so entries remain useful across sessions.

```markdown
## <Topic> — <Date or short description>

<Content>
```
