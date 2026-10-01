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
claude-news scan     [--repo PATH]                 check git access and detect sources
claude-news serve    [--repo PATH]                 start (or reuse) the site and print its URL
claude-news wait     [--repo PATH] [--timeout S]   block until the user presses Go to press
claude-news status   [--repo PATH] <message>       show a progress line on the site
claude-news publish  [--repo PATH] <articles.json> validate and publish the edition
claude-news stop     [--repo PATH]                 stop the site
```

State lives in `$TMPDIR/claude-news/<repo-hash>/` (override with `CLAUDE_NEWS_STATE_ROOT`). The
server binds to 127.0.0.1 only and stops itself after 3 idle hours.

## Writing styles

Each file in `styles/` is a house style the user can pick. The frontmatter sets `label`,
`description` and `default`; the body is the guide Claude follows. `broadsheet.md` is the only one
so far.

## Develop

```sh
npm test
```

No dependencies. `web/vendor/marked.min.js` is a vendored copy of [marked](https://github.com/markedjs/marked) v15.0.12 (MIT).
