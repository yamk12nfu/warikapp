# warikapp: ai-review CI の検証対象（ローカル HEAD と main とのマージ結果の違い)

> 根拠: `.github/workflows/ai-review.yml`(発火条件・central workflow への委譲・push 時の設計意図コメント)。
> 本ファイルは派生した索引・要約であり、正本は上記ソースである。

## 発火と委譲

- `pull_request`(opened / synchronize / reopened)と `push`(main)で発火し、検証本体は
  `yamk12nfu/ai-repo-ops` の reusable workflow(`ai-review.reusable.yml@v1`)に委譲される。
  strict 条件などの詳細な検証ロジックはこの repo ではなく配布元 ai-repo-ops 側にある
- GitHub Actions の `pull_request` イベントで checkout されるのは PR ブランチそのものではなく、
  **PR を最新の base(main)にマージした merge ref** である。つまり CI の guard / knowledge check /
  proposals check は「main とのマージ結果」を検証する
- main への `push` では proposals check のみ実行される。ファイル内コメントに
  「並行 PR の merge で混入した proposal id の重複を、merge 後の状態に対する検証で
  決定的に検出するため」と設計意図が明記されている

## 非自明な帰結: ローカルで PASS しても CI で fail し得る

- ローカルの `aro guard` / `aro proposals check` は**自分の worktree の HEAD** を検証する。
  ローカル main が origin/main より遅れていると、手元で全て PASS しても、CI では
  「進んだ main とのマージ結果」に対する検証で fail し得る
  (例: proposal の source が main 側で変更済みなら `source.stale`)
- この repo は main へ直接 commit せず GitHub 上で merge する運用のため、
  ローカル main は merge 後に自動では進まず、この乖離が起きやすい

## 実務上の前提

- aro 系の作業(propose / improve / knowledge-refresh / harvest)の開始前に
  `git fetch origin main` を実行し、ローカル main と origin/main の一致を確認してから
  ブランチを切る
- CI の proposals check が stale で落ちたら、「main が先に進んで proposal の根拠が
  変わった」を第一仮説として `git log <proposed_at_commit>..origin/main` を確認する
- PR 段階で Vercel の Preview Deployment が無いのと同様(deploy-pipeline 参照)、
  ai-review の結果も「マージされたらどうなるか」を表すものとして読む
