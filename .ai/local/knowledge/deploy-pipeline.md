# warikapp: デプロイパイプライン（Vercel と Convex 本番の連動）

> 根拠: `vercel.json`(buildCommand / ignoreCommand)、`app/(app)/home-client.tsx`(デプロイ順の防御コード)。
> 本ファイルは派生した索引・要約であり、正本は上記ソースである。

## デプロイの流れ

- `vercel.json` の `ignoreCommand` が `$VERCEL_GIT_COMMIT_REF != main` でビルドをスキップするため、
  **main 以外のブランチは一切デプロイされない**(PR 段階では Vercel の Preview Deployment も作られない。
  Vercel の check には「Canceled by Ignored Build Step」と表示される)
- main へのマージで初めて本番ビルドが走り、`buildCommand` が
  `npx convex deploy --cmd 'npm run build'` のため、**フロント(Next.js)の本番デプロイと
  Convex 関数の本番デプロイが同一ビルド内で一緒に実行される**

## 非自明な制約: 同時だが原子的ではない

フロントと Convex は同じビルドでデプロイされるが原子的ではなく、**新旧が一時的に混在する瞬間がある**。
このためクライアント側にはデプロイ順の防御パターンが存在する:

- 例: `app/(app)/home-client.tsx` の `balance.paidBySelf ?? 0` —
  コメントに「フロントが先に新しくなり、Convex側がまだ旧関数(このフィールドを返さない)の間でも
  落ちないようにする」と明記されている

## 変更時の注意

- Convex の query / mutation が返すフィールドを**追加**する場合、クライアント側は
  そのフィールドが「まだ無い」瞬間を `?? 0` 等でフォールバックする(上記の防御パターンを踏襲する)
- スキーマや関数の互換性を**壊す**変更(フィールド削除・型変更・関数削除)は、
  この防御パターンが前提になる。旧クライアント/旧関数の混在期間に両方が動くよう、
  段階的な移行(追加 → 移行 → 削除の複数リリース)を検討する
- PR 段階で動作確認できるのはローカル環境のみ(Preview Deployment は無い)。
  デプロイの検証は main マージ後の本番ビルドが最初になる
