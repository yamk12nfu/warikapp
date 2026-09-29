# 世帯からの退出とアカウント削除

設定画面の「アカウント」節から、世帯を抜けるか、アプリのアカウントごと消せる。パートナーがいる世帯では確認待ちの精算、未精算支出、下書きが残っていると退出できない。確認待ち中は「精算画面へ」から確認・差し戻しに移れる。退出したメンバーの表示名はパートナーの精算履歴に残る。最後の 1 人が退出すると世帯のデータはレシート画像ごと消える。

## Sub-features

- `leave-blocked` パートナーがいる世帯で未精算(または下書き)の支出があると、確認パネルに理由が出て「退出する」が無効になる。
- `leave-pending` 確認待ち中は開始者・確認者どちらも退出できず、確認パネルに pending の理由と「精算画面へ」リンクが出る。
- `leave` 精算済みなら退出でき、`/setup` に着く。`members` の行は残り、`leftAt` が入り `tokenIdentifier` が消える。
- `leave-solo` パートナーがいない世帯は未精算があっても退出でき、世帯のデータが purge される。
- `delete-account` 世帯から退出したうえで Clerk のユーザーが消え、`/login` に着く。`/setup` からも実行できる。
- `history-keeps-name` 残ったパートナーの精算履歴に退出者の表示名が出続ける。
- `cancel-after-leave` 相手が退出した精算は取り消せない(エラー表示が正常)。

## How to get to it (user POV)

- ヘッダーのメニュー → 設定 → 最下部「アカウント」節の「世帯から退出」「アカウントを削除」。
- 世帯未所属で `/setup` にいるとき、ページ最下部の「アカウントを削除」。
- 確認待ちの精算がある場合、設定の退出パネルにある「精算画面へ」から `/settlement`。

## Driving it with playwright-cli

Preconditions:

- `$V launch` と `$V doctor` が通っている。
- 既定の検証ユーザーは世帯を持っていて壊したくないので、この機能は毎回使い捨てのユーザーで行う: `export WARIKAPP_VERIFY_EXTERNAL_ID=warikapp-verify-leave-$(date +%Y%m%d%H%M)` → `$V login`(世帯を自動作成して `/` に着く)。
- 2 人の世帯が要る手順(`leave-blocked` / `leave-pending` / `leave` / `history-keeps-name`)は、features/setup-household.md の「参加(2 人目)」のとおり 2 人目を作る。1 人目の状態は `$V pw state-save .verify-run/user-a.json` で退避しておく。
- `MARK="検証$(date +%H%M%S)"` を決めてある。

- **2 人目を参加させる。** `npx convex data invitations --limit 1 --order desc` の `code` を控える → `$V pw state-save .verify-run/user-a.json` → `WARIKAPP_VERIFY_EXTERNAL_ID=warikapp-verify-leave-partner-$(date +%H%M) node .claude/skills/verify-warikapp/scripts/clerk-login-url.mjs` で URL を取り、`$V pw cookie-clear` → `$V pw goto "<url>"`。`/setup` で `$V pw click "getByRole('button', { name: '招待コードで参加' })"` → `$V pw fill "#invite-code" "<code>"` → `$V pw fill "#join-display-name" "検証パートナー"` → `$V pw click "getByRole('button', { name: 'この世帯に参加する' })"`。5 秒後 `/`。`$V pw state-save .verify-run/user-b.json`。
- **未精算を作る(1 人目)。** `$V pw state-load .verify-run/user-a.json` → features/manual-expense.md のとおり `$MARK` 付きの支出を 1 件登録する。
- **退出がブロックされる。** `$V pw goto http://localhost:3100/settings`。5 秒後 `$V pw click "getByRole('button', { name: '世帯から退出' })"`。1 秒後の snapshot に `alert: 未精算の支出があります。先に精算してから退出してください` と `button "退出する" [disabled]` が出る。`$V pw screenshot --filename=$E/02-leave-blocked.png`。
- **確認待ち中の退出がブロックされる。** `$V pw goto http://localhost:3100/settlement` → `$V pw fill "#memo" "$MARK 精算"` → `$V pw click "getByRole('button', { name: '精算する' })"`。確認依頼なら `/` に戻る。`/settings` で「世帯から退出」を押し、`alert: 確認待ちの精算があります。確認するか差し戻してから退出してください`、`link "精算画面へ"`、無効な `button "退出する"` を確認する。2 人目の状態に切り替えても同じ blocker が出る。
- **設定から精算画面へ移る。** 確認パネルの「精算画面へ」を押すと `/settlement` が開き、開始者は「取り下げる」、確認者は「確認して完了」「差し戻す」を選べる。
- **確認してから退出する。** 確認者が「確認して完了」を押すと `/settlements` に移る。開始者を再ログインし、`/settings` の「世帯から退出」→「退出する」。5 秒後 `$V pw --raw eval "location.pathname"` が `"/setup"`。
- **差し戻し後の blocker。** 別の確認待ちで確認者が「差し戻す」を選ぶ。開始者のホームに差し戻し通知が出て、`/settings` の blocker が `未精算の支出があります。先に精算してから退出してください` に戻る。未精算のまま退出はできない。
- **DB 確認。** `npx convex data members --limit 5 --order desc` で 1 人目の行が残り、`leftAt` に値があり `tokenIdentifier` が空。2 人目の行は変わらない。
- **アカウントを削除する。** `/setup` の最下部 `$V pw click "getByRole('button', { name: 'アカウントを削除' })"` → `$V pw click "getByRole('button', { name: '削除する' })"`。8 秒後 `location.pathname` が `"/login"`。Clerk 側は `node --env-file=.env.local -e "fetch('https://api.clerk.com/v1/users?external_id=<1人目のexternal_id>',{headers:{Authorization:'Bearer '+process.env.CLERK_SECRET_KEY}}).then(r=>r.json()).then(j=>console.log(j.length))"` が `0`。
- **パートナー側で名前が残る。** `$V pw cookie-clear` → `$V pw state-load .verify-run/user-b.json` → `$V pw goto http://localhost:3100/settlements`。5 秒後の snapshot に `あなた → 検証エージェント` の行がある。`この精算を取り消す` → `dialog-accept` は「退出したメンバーとの精算は取り消せません」になる。
- **1 人の世帯の退出(任意)。** 別の使い捨てユーザーで `$V login` → 支出を 1 件登録 → `/settings` で「世帯から退出」→「退出する」。alert は出ず `/setup` に着く。数秒後 `npx convex data couples --limit 3 --order desc` にその世帯が無く、`expenses` からも `$MARK` の行が消えている。
- **Proof。** `E=$($V evidence leave-household)` に、ブロック表示・退出後の `/setup`・削除後の `/login`・パートナーの精算履歴の snapshot と screenshot、`db-members-*.txt`、Clerk の件数出力を残す。

## Gotchas

- 1 人の世帯では精算ができないので、`leave-blocked` は必ず 2 人の世帯で見る。1 人の世帯で alert が出ないのは仕様(`leave-solo`)。
- `$V cleanup` は `.verify-run/` を消すので、使った external_id と保存した state ファイルは消える。途中で再起動するなら external_id を控えておく。同じ external_id で `$V login` すれば同じユーザーに戻れる。
- アカウント削除は Clerk 開発インスタンスのユーザーを実際に消す。既定の検証ユーザー(`warikapp-verify-agent`)では実行しない。
- 削除後のブラウザは Clerk のセッションが切れているので、次の操作の前に `$V login` をやり直す。
- purge はスケジュールされた関数で数秒遅れて走る。DB を見るのは退出の直後ではなく少し待ってから。
