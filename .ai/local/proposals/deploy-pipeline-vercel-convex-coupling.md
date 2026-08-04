---
schema_version: 1
id: deploy-pipeline-vercel-convex-coupling
status: done
decision:
  by: yamk12nfu
proposed_at_commit: 7706532ca85b4362d7d8861ae52cfb166dbd4bd6
# 注: app/(app)/home-client.tsx も根拠だが、aro が source path の括弧を
# glob メタ文字として拒否するため(route group パス非対応)、本文での言及に留める
sources:
  - path: "vercel.json"
---

## 提案: デプロイパイプライン(Vercel と Convex の連動)の knowledge entry

タイトル案: 「deploy-pipeline: main マージで Vercel と Convex 本番が同時デプロイされる」

`vercel.json` の `ignoreCommand` により main 以外のブランチはビルドがスキップされ、
PR 段階では一切デプロイされない(Vercel の Preview Deployment も作られない)。
main へのマージで初めて本番ビルドが走り、`buildCommand` が
`npx convex deploy --cmd 'npm run build'` のため **フロントの本番デプロイと
Convex 関数の本番デプロイが同一ビルド内で一緒に実行される**。

非自明な点: 同時とはいえ原子的ではないため、フロントと Convex の新旧が
一時的に混在する瞬間があり、クライアント側には防御コードが存在する
(例: `app/(app)/home-client.tsx` の `balance.paidBySelf ?? 0` —
「フロントが先に新しくなり、Convex側がまだ旧関数の間でも落ちない」ためと
コメントで明記)。スキーマや関数の互換性を壊す変更ではこの防御パターンが
前提になるため、デプロイ順序の制約として knowledge に残す価値がある。
