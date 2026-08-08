---
# yaml-language-server: $schema=../../managed/schemas/proposal.schema.json
schema_version: 1
id: test-quality-gate
status: open
proposed_at_commit: 625022d6cae33f50ec639a97b0360ee89a1c07b9
sources:
  - path: "package.json"
  - path: "vitest.config.ts"
  - path: "convex/expenses.test.ts"
decision:
  by: ""
  reason: ""
---

## 課題

`aro doctor` が `WARN command "test" is empty` を報告している。一方でリポジトリには
vitest + convex-test によるテストが 10 ファイル・217 件存在し（`convex/*.test.ts`、
`convex/ai/*.test.ts`、`lib/*.test.ts`）、`package.json` の `test` script
（`vitest run`）でローカルでは 644ms で全件通過する。

しかし `.ai/project.yaml` の `commands.test` が空文字列のままで、
`quality_gates.required` も `lint` / `typecheck` / `build` のみのため、
ai-review CI と improve ループの品質ゲートではテストが一切実行されない。
AI 実装 PR が既存テストを壊しても、lint / typecheck / build が通れば
required check は緑になってしまう。

## 提案

`.ai/project.yaml` を次の2点だけ変更し、既存のテスト資産を品質ゲートに組み込む:

1. `commands.test` に `"npm run test"` を設定する
2. `quality_gates.required` に `test` を追加する

## 想定する変更範囲

`.ai/project.yaml` の1ファイル・実質2行。`ai.max_changed_files`（40）に対して余裕。

## リスク・見送る理由になりうる点

- `.ai/project.yaml` は `ai.allowed_paths` の対象外（AI 書き込み禁止の設計）なので、
  採用時の実装は improve プロンプトではなく**人間の手編集**になる。Proposal Loop の
  「accepted → improve が実装」という通常フローに乗らない点は運用上の例外となる。
- テストが required gate になると、flaky test が発生した場合にすべての PR が
  ブロックされる。現状 644ms・217 件でネットワーク非依存（convex-test はインメモリ）
  なので flaky リスクは低いが、ゼロではない。
- vitest は `environment: "edge-runtime"`（`@edge-runtime/vm`）で動く。ローカル
  macOS では全件通過を確認済みだが、GitHub Actions の Linux ランナー上での動作は
  未検証（一般には動くはずだが、初回 CI で確認が必要）。
- CI 時間の増加はテスト実行自体は 1 秒未満と軽微（依存インストールは既存ゲートと共通）。
