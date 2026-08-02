@AGENTS.md

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

<!-- aro-knowledge-start -->

## Repo Knowledge の鮮度対応

セッション開始時に SessionStart hook が `aro knowledge check` を実行し、結果がコンテキストに注入される。

- stale な entry が報告されていたら、最初の応答で「knowledge を更新するか」を一度だけ提案すること（作業の割り込みはしない。提案が断られたらそのセッションでは再提案しない）。
- 更新することになったら `.ai/managed/prompts/knowledge-refresh.md` を読み、Repo Knowledge を1単位だけ更新する。
- `aro` は PATH にない。各 subcommand は `node /Users/makinokaedenari/yamk12nfu/ai-repo-ops/packages/aro-cli/bin/aro` で実行する。
- 更新後は `knowledge check --strict` を通し、差分と根拠を提示して人間の確認を待つ。commit・PR・merge は人間の判断。

<!-- aro-knowledge-end -->
