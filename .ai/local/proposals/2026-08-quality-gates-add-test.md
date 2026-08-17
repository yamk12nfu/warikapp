---
# yaml-language-server: $schema=../../managed/schemas/proposal.schema.json
schema_version: 1
id: quality-gates-add-test
status: done
proposed_at_commit: fffddaa08019f84a04972041c0f2836c7579e763
# 注: 根拠の中心は .ai/project.yaml の commands.test が空であること
# (aro doctor の WARN)だが、sources に .ai/** は使えないため本文での言及に留める
sources:
  - path: "package.json"
  - path: "vitest.config.ts"
decision:
  by: yamk12nfu
---

## 課題

`aro doctor` が `WARN command "test" is empty` を報告している。一方でリポジトリには
実体のあるテストスイートが存在する:

- `package.json` に `"test": "vitest run"` が定義済み
- `vitest.config.ts` で convex-test + edge-runtime のテスト環境が整備済み
- テストファイルは 23 件、362 テストが全て通過し、実行時間は約 1.9 秒

つまり「テストがないから空」ではなく、「テストはあるのに quality gate に
組み込まれていない」状態である。`.ai/project.yaml` の `quality_gates.required` は
lint / typecheck / build のみで、AI の変更ループや CI がテストを必須チェックとして
実行しない。

## 提案

`.ai/project.yaml` を次のように更新する:

1. `commands.test` を `"npm test"` に設定する
2. `quality_gates.required` に `test` を追加する

これにより aro の quality gate(AI 実装ループの検証・CI)でテストが必ず実行され、
doctor の WARN も解消される。

## 想定する変更範囲

- `.ai/project.yaml` のみ(1 ファイル、2 行程度)。`ai.max_changed_files: 40` に余裕で収まる。

## リスク・見送る理由になりうる点

- **`.ai/project.yaml` は AI の書き込み対象外**(`allowed_paths` に含まれない)。
  採用されても improve プロンプトでは実装できず、人間が直接編集する必要がある。
  提案としては「人間への依頼」に近い。
- required gate が 1 つ増えるため、将来テストが不安定化(flaky 化)すると
  全ての AI ループ・CI のブロッカーになる。現状 362 件 / 約 1.9 秒で安定しているが、
  外部 API(Convex / Clerk / AI)へ依存するテストが増えた場合は注意が必要。
- CI 実行時間は増えるが、現状の実測では約 1.9 秒のため実害は小さい。
