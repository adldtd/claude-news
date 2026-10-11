# claude-news

A Claude Code skill that turns a repository's recent activity into a newspaper. You pick the time
window, sources and style on a local website; Claude reads the commits, PRs, issues, tickets, CI runs
and docs, writes a handful of short news articles, and lays them out on the same page.

It works like [lavish-axi](https://github.com/kunchenguid/lavish-axi): the agent drives a small CLI
that serves the site and long-polls for what you do in the browser.

## Install

```sh
ln -s ~/Projects/claude-news/skills/claude-news ~/.claude/skills/claude-news
```

Requires Node 20+ and git. GitHub sources need an authenticated `gh`; Linear/Jira sources need a
matching MCP server or tool in the Claude session.

## Use

In any repo, run `/claude-news` (or ask Claude "what's the news in this repo?"). Claude prints a
local URL; open it, choose your options, press **Go to press**, and watch the edition arrive.

## CLI

```text
claude-news scan     [--repo PATH] [--refresh]     check git access and detect sources
claude-news notes    [--repo PATH] <notes.md>      save Claude's notes on the repo for later editions
claude-news serve    [--repo PATH] [--foreground]  start (or reuse) the site and print its URL
claude-news url      [--repo PATH] [--timeout S]   wait for this session's site and print its URL
claude-news wait     [--repo PATH] [--timeout S]   block until the user presses Go to press
claude-news status   [--repo PATH] <message>       show a progress line on the site
claude-news publish  [--repo PATH] <articles.json> validate and publish the edition
claude-news stop     [--repo PATH]                 stop the site
```

State lives in `$TMPDIR/claude-news/<repo-hash>/` (override with `CLAUDE_NEWS_STATE_ROOT`). The
server binds to 127.0.0.1 only and stops itself after 3 idle hours.

The form remembers the wires, house style and word limit you last sent to press, per repo, in
`~/.config/claude-news/preferences.json` (follows `XDG_CONFIG_HOME`; override the folder with
`CLAUDE_NEWS_CONFIG_DIR`).

`serve` starts a detached server that outlives the agent session. `serve --foreground` runs the
server in its own process instead. The skill starts it as a Claude Code background task, so the site
stops when the session ends (or when the task hits its 2-hour limit), and then finds its URL with
`url`. A foreground server belongs to the session that started it.

`serve` reuses a running server only if it was started from the same code, and a foreground
`serve` also requires the same session. Otherwise it stops the old server and starts a new one.
A new server numbers its editions after the ones already saved, so none is overwritten.

## Repo knowledge

The first scan of a repo is a full one: it greps the repo for Linear and Jira links and reads the
last 300 commits for ticket keys. Later scans reuse that and only look at new activity. After the
first edition, Claude saves short notes on the repo (what it is, its jargon, its conventions) with
`claude-news notes`, and later editions read those instead of the README and other context files.

Both live in `~/.cache/claude-news/<repo-hash>/` (follows `XDG_CACHE_HOME`; override the folder
with `CLAUDE_NEWS_CACHE_DIR`), so they survive a reboot. The next scan is a full one again when a
context file changes, more than 300 commits have landed, a month has passed, or you run
`scan --refresh`. A full scan marks the notes stale, and Claude rewrites them after the next edition.

## Saving and printing

Once an edition is published, the ⋯ button in the bottom-right corner offers **Save edition as
HTML**, **Print** and **New edition**. Saving downloads the edition as one HTML file named
`<repo>-edition-<N>-<date>.html`, with the site's styles, viewer and Markdown renderer inlined. It
opens in any browser without the server, and reads like the live page. It leaves out local paths
and your identity, but keeps the repository name, branch, house style, editor's notes and token
count shown under *About this edition*. Printing, from the menu or with Ctrl+P, lays out every
article in order.

The ⋯ button is also there before an edition is published, with **Switch to dark mode** (or light).
The page follows your system theme until you pick one; the choice is remembered in this browser.
Printing is always light.

## Token count

While an edition is being written, the site shows how many tokens Claude has used since you pressed
**Go to press**. The finished edition shows the same total. The CLI sends `CLAUDE_CODE_SESSION_ID`
with each call. The server reads that session's transcript, and any subagent transcripts, under
`$CLAUDE_CONFIG_DIR/projects` (default `~/.claude/projects`). It counts each model call once. The
total covers input, cache writes, cache reads and output; hover over the count to see each part.
Without a session ID, no count is shown.

The page, and any saved edition, loads Libre Franklin and Source Serif 4 from Google Fonts. Offline,
it uses system fonts instead.

## Writing styles

Each file in `styles/` is a house style the user can pick. The frontmatter sets `label`,
`description` and `default`; the body is the guide Claude follows. `broadsheet.md` is the only one
so far.

## Develop

```sh
npm test
```

No dependencies. `web/vendor/marked.min.js` is a vendored copy of [marked](https://github.com/markedjs/marked) v15.0.12 (MIT).
