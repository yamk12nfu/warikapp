---
# yaml-language-server: $schema=../../managed/schemas/execution-plan.schema.json
schema_version: 1
id: warikapp-scheduled-local-rollout
status: active
current_stage: dry-run
next_action:
  id: collect-read-only-evidence
  description: plans check/status/nextのJSONを収集し、repositoryへの変更がないことを確認する
updated_at: 2026-08-18
proposals: []
permissions:
  commit: false
  push: false
  draft_pr: false
  merge: false
stages:
  - id: dry-run
    status: active
  - id: local-changes
    status: pending
  - id: remote-branch
    status: pending
  - id: draft-pr
    status: pending
---

# warikapp scheduled-local rollout

## 目的

warikappが会話、Hermes設定、GitHub Issueに依存せず、repository内のExecution Planから現在Stage、次操作、許可された副作用を決定できることを確認する。

このPlanはwarikapp固有のlocal stateであり、ARO distribution syncでは上書きしない。

## 現在のStage: DRY_RUN

このStageで許可するのは読み取り専用の評価だけである。

- `aro plans check/status/next`の実行
- JSON evidenceのhost側durable logへの保存
- blocker、Plan、Stage、next action、permissionsの確認

次の操作は禁止する。

- Codex、Claude Codeその他の実装agentの起動
- repository fileの変更
- worktree作成
- commit、push、PR作成、merge
- Proposal statusの変更
- Stage promotion

## 実行契約

callerはcwdに依存せず、warikappのabsolute repo rootを明示する。

```bash
aro plans check --repo <absolute-warikapp-repo-root> --strict --json
aro plans status --repo <absolute-warikapp-repo-root> --json
aro plans next --repo <absolute-warikapp-repo-root> --json
```

`plans next`の期待値:

- `ok: true`
- `runnable: true`
- Plan: `warikapp-scheduled-local-rollout`
- Stage: `dry-run`
- next action: `collect-read-only-evidence`
- `permissions.commit/push/draft_pr/merge`: すべて`false`
- blocker: 0件

## DRY_RUN DoD

- absolute repo rootを使った3コマンドが終了コード0で完走する
- active Planが1件だけ選択される
- active Stageと`current_stage`が`dry-run`で一致する
- next actionが決定的に返る
- permissionsがすべてfalseで返る
- 実行前後で`git status --short`に差分がない
- 実行中にagent、worktree、commit、push、PRを作成しない
- evidenceへbase SHA、実行時刻、コマンド結果、Git無変更を記録する

## Promotion境界

`local-changes`以降へのpromotionは別PRにし、人間がmergeするまで実行しない。成功したDRY_RUNや経過時間だけから自動昇格しない。

`permissions.merge`はすべてのStageで常に`false`とする。
