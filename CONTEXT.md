# Claude News

Turns a repository's recent activity into a newspaper that the user commissions and reads on a local site.

## Language

**Edition**:
One newspaper produced for a single commission: a numbered set of articles covering one time window of one repository.
_Avoid_: Report, issue, digest

**Article**:
One short news story within an edition, with a headline, byline, body and sources.
_Avoid_: Story card, post, item

**In Brief**:
The one article in an edition that rounds up news too small for its own story, as short linked items. It does not count toward the target.
_Avoid_: Round-up, misc, other news

**Target**:
The number of full stories an edition aims for. It defaults to about 7 per 12 hours of window (3 to 15), and the user can lower it to 3 or raise it by half that (at most 5). It is a ceiling, not a quota: Claude never pads to reach it.
_Avoid_: Max, quota, limit

**Colophon**:
The "About this edition" note: which repository and branch it covers, the house style, the target and word limit, the editor's notes and the tokens it took to write.
_Avoid_: Metadata, footer, info panel
