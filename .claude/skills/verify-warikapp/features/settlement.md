# 精算と精算履歴

`/settlement` に未精算差額と対象の支出が並び、メモを添えて `精算する` で精算が確定する。`/settlements` に履歴が並び、直近 1 件だけ `この精算を取り消す` で戻せる。

## Sub-features

- `settle-balance` ホームと `/settlement` の `未精算差額` が未精算支出の立て替え額の合計と一致する。
- `settle-blocked-partner` パートナー未参加だと `パートナーが参加してから精算できます` が出て `精算する` が無効。
- `settle-blocked-draft` 下書きがあると `確定または削除してから精算してください` が出て精算できない。
- `settle-execute` `精算する` で `/settlements/<id>` に移り、対象の支出が `精算の内訳` に並ぶ。ホームの未精算差額が 0 になる。
- `settle-cancel` `/settlements` の直近の精算で `この精算を取り消す` → confirm → 支出が未精算に戻る。
- `settle-cap` 未精算が多いと古い順に上限件数だけ対象になり、その旨の注意が出る。

## How to get to it (user POV)

- ホーム(`/`)の `未精算差額` カード(`/settlement` へのリンク)。
- ヘッダーのメニューから「精算」。
- ホーム下部の「精算履歴」リンク → `/settlements`。
- URL 直打ち `http://localhost:3100/settlement`、`http://localhost:3100/settlements`。

## Driving it with playwright-cli

Preconditions:

- `$V login` 済み。`settle-execute` にはパートナーが参加した世帯が要る(setup-household.md の「参加(2 人目)」を先に行う)。既定の検証ユーザーだけの世帯では `settle-blocked-partner` までしか検証できない。
- マーカー付きの確定済み未精算支出が 1 件以上ある。

- **未精算差額。** `$V pw goto http://localhost:3100/settlement`。見出し `精算`、`未精算差額` の金額、`精算の対象(N件)` の一覧にマーカー付き支出。金額はホームの `未精算差額` と同じ。
- **パートナー未参加の抑止。** 1 人だけの世帯なら `パートナーが参加してから精算できます` が出て `$V pw --raw eval "el => el.disabled" "getByRole('button', { name: '精算する' })"` が `true`。
- **精算する。** 2 人の世帯で `$V pw fill "#memo" "$MARK 精算"` → `$V pw click "getByRole('button', { name: '精算する' })"`。5 秒後 URL が `/settlements/<id>`、見出し `精算の内訳`、`支出(N件)` にマーカー付き支出。`npx convex data settlements --limit 1 --order desc` に `memo` がマーカー付きの行、`npx convex data expenses --limit 5 --order desc` の該当行に `settlementId` が入る。
- **ホームに戻る。** `/` の `未精算差額` が `¥0`、一覧(既定 `未精算` フィルタ)にマーカー付き支出がなく、`すべて` を押すと出る。
- **取り消す。** `$V pw goto http://localhost:3100/settlements` → 直近の行の `$V pw click "getByRole('button', { name: 'この精算を取り消す' })"` → `$V pw dialog-accept`。行が消え、`/` の未精算差額が戻る。DB の `settlements` 行が消え(または取り消し状態になり)、`expenses` の `settlementId` が外れる。
- **Proof。** `E=$($V evidence settlement)` に、精算前 `/settlement`、精算後 `/settlements/<id>`、ホーム、取り消し後の snapshot / screenshot と DB 出力。

## Gotchas

- 端数は品目ごとに `Math.round` される。合計 × 割合で暗算した値と 1 円ずれることがある。証拠は画面の `立て替え額` と DB の値で突き合わせる。
- 取り消しは直近 1 件だけ。2 つ前の精算に取り消しボタンは出ない。
- 取り消しも `window.confirm` を出す。`dialog-accept` を忘れない。
- 対象件数の上限(古い順)がある。大量に支出を作ると `settle-cap` の注意が出て、全件が対象にならないのは仕様。
