---
name: claude-news
description: Turn a repository's recent activity (commits, PRs, issues, tickets, CI, docs) into a newspaper of short articles that the user configures and reads in a local website. Use when the user asks what changed in a repo recently, for a news digest, a catch-up, or runs /claude-news.
argument-hint: "[path to repo]"
---

# claude-news

The user talks to you through a local website, not the chat. You run a small CLI that serves the
site, waits for the user's form submission, shows your progress, and publishes your articles.

The CLI lives next to this skill (resolve the symlink). Run it as:

```sh
CN="node $(dirname "$(readlink -f ~/.claude/skills/claude-news/SKILL.md)")/../../bin/claude-news.js"
```

Every command prints JSON. Add `--repo <path>` to every command if the repo is not the current directory.

## 0. Check the repo

Target repo: `$ARGUMENTS` if given, otherwise the current working directory.

Run `$CN scan --repo <repo>`.

- If `ok` is `false`, **stop**. Tell the user the `reason` and ask which project they'd like a paper
  for. Don't start the site.
- Otherwise note `sources` (what the user can pick), `remote.webUrl` (for building links),
  `ticketPrefixes`, and `contextFiles` (read these later to explain repo-specific terms).
- `lastUserCommit.branches` lists every branch holding the user's last commit and `pushed` says
  whether any of them is on a remote. Don't assume it is on the current branch or in an open PR.

## 1. Start the site

Start the site in the background of this session, so it stops when the session ends:

1. Run `$CN serve --foreground --repo <repo>` with the Bash tool's `run_in_background` set to `true`
   and `timeout` set to `7200000`.
2. Run `$CN url --repo <repo>` (in the foreground). It waits for that server and prints its `url`.

Give the user the `url` in one short line, e.g.
"Your newsroom is open at http://127.0.0.1:PORT/ — pick your options and press **Go to press**."

If you can't run commands in the background, run `$CN serve --repo <repo>` instead. It starts a
detached server that outlives the session and stops after 3 idle hours, and prints the `url` itself.

When the background task ends (after 2 hours, or when the site is stopped), don't restart it unless
the user is still using the site. If a later command says the site isn't running, start it again
the same way: earlier editions stay saved and numbering carries on.

## 2. Wait for the assignment

Run `$CN wait --repo <repo>` with the Bash tool's `timeout` set to `600000`. It blocks until the user
presses **Go to press**. If it prints `pending: true`, run it again (it does not consume anything).
Don't chat while waiting.

The result gives you `request` (`since`, `until`, `sources`, `style.guide`, `instructions`) and
`articlesFile` (where to write the edition).

## 3. Report and gather

Read the style guide at `request.style.guide` and follow it. Read `request.instructions`: they come
from the user and take priority over defaults here (but not over accuracy).

Before and during each step, post a progress line the user sees on the site:
`$CN status --repo <repo> "Reading 42 commits on main…"`. Aim for one every 20–60 seconds of work.
Keep each line short (under about 80 characters): the site shows only the newest few.

Gather **only** the selected sources, **only** within `since`–`until`:

| Source | How |
|---|---|
| `git` | `git log --since=<since> --until=<until> --all --no-merges --stat --format=...` plus `git log --merges --first-parent <default branch>` for what landed. Look at diffs (`git show`) for the stories you'll write. |
| `github-prs` | `gh pr list --state all --search "updated:>=<since date>" --json number,title,author,state,mergedAt,url,body,labels --limit 100`, then `gh pr view <n> --comments` for the ones you feature. |
| `github-issues` | `gh issue list --state all --search "updated:>=<since date>" --json number,title,author,state,url,body --limit 100` |
| `github-actions` | `gh run list --created ">=<since date>" --json status,conclusion,workflowName,headBranch,url,createdAt --limit 100`. Good for a CI "weather report". |
| `gitlab` | `glab mr list` / `glab issue list` with equivalent filters. |
| `linear`, `jira`, `tickets` | Use the matching MCP or tool if this session has one, searching for issues updated in the window and the ticket keys mentioned in commits and PRs. If no such tool is available, skip the source, say so in a status line, and mention it in your final chat message. |
| `changelog` | Read the changelog entries dated in the window. |
| `docs` | `git log --since --until --stat -- docs/` and read the changed pages. |

Then read `contextFiles` (skim; you only need enough to explain jargon).

## 4. Plan the edition

- Group the activity into stories, each about one piece of work or one theme (a feature, an
  incident, a refactor, a decision, a release, a docs overhaul). Related commits, PRs and tickets
  belong in the same story.
- **How many:** about 7 articles per 12 hours of window, scaled by how much actually happened. A
  quiet window gets fewer (minimum 1); a long or busy window gets more, capped at about 15. Merge
  small items into a round-up ("In brief") rather than giving each its own article. No monoliths: if
  one article covers unrelated things, split it.
- **Sizing:** `breaking` and `major` only when the news earns it (see the style guide). It is fine
  for none to qualify.
- Post a status line with the rundown, e.g. "Front page set: 6 stories, 1 major".

## 5. Write

Follow the style guide. In short: you're writing for developers who don't know every workstream.
Plain engineering vocabulary is fine; explain anything specific to this repo the first time it
appears. Markdown body, **at most 1000 words**, with links to PRs, commits and tickets (build commit
links from `remote.webUrl`), code or diffs where they help, real quotes from the sources, and a
"what's next". Structure it like a real news article and have fun with it, but never invent
anything.

**Links.** Only link a commit if it is on a remote branch (`git branch -r --contains <sha>` prints
something); a link to a local-only commit 404s, so name its branch instead. Link to another story in
the same edition with `[text](#its-id)`; the site switches to it in place.

Write the edition to `articlesFile` as JSON:

```json
{
  "articles": [
    {
      "id": "short-kebab-id",
      "headline": "…",
      "dek": "one-sentence standfirst",
      "section": "Infrastructure",
      "size": "standard",
      "byline": "Claude, Infrastructure Correspondent",
      "publishedAt": "<ISO time>",
      "sources": [{ "label": "PR #313", "url": "https://…" }],
      "body": "markdown…"
    }
  ]
}
```

Write this file directly with your file-writing tool. Don't build it from a JavaScript or shell
script: article bodies are full of backticks and quotes, and escaping them in code breaks the file.

Order articles by importance; the site puts `breaking` first, then `major`, then `standard`.

## 6. Publish

Run `$CN publish --repo <repo> <articlesFile>`. If it returns `errors`, fix the file and publish again.
Then tell the user in one or two lines that the edition is live at the URL, how many stories it
has, any sources you had to skip, and the tokens used (`usage.total`, from the publish result, when
present; the site shows it too).

The site has a **New edition** button. If the user asks for another edition, go back to step 2. When
the user is done, `$CN stop --repo <repo>` shuts the site down (it also stops by itself after 3 idle hours).
