# 月別サマリー

`/months` は今月の `/months/<YYYY-MM>` にリダイレクトし、その月の合計・分類別内訳・`負担の推移`・支出一覧と、前後の月への移動リンクを表示する。MCP の `monthly_summary` と同じ集計。

## Sub-features

- `month-redirect` `/months` が JST の今月に飛ぶ。
- `month-totals` `この月の合計` に月内の確定済み支出の合計と、自分・相手それぞれの負担が出る。
- `month-categories` 分類ごとの内訳が並ぶ(分類を変えると動く)。
- `month-nav` 前の月・次の月リンクで `YYYY-MM` が動き、支出のない月は空の表示になる。
- `month-expense-link` 月内の支出リンクから詳細(`/expenses/<id>`)に入れる。

## How to get to it (user POV)

- ヘッダーのメニューから「月別」(ラベルは snapshot で確認)。
- URL 直打ち `http://localhost:3100/months`、`http://localhost:3100/months/2026-09`。
- 月別画面の前後リンク。

## Driving it with playwright-cli

Preconditions:

- `$V login` 済み。今月にマーカー付きの確定済み支出が 1 件以上ある(manual-expense.md)。

- **リダイレクト。** `$V pw goto http://localhost:3100/months`。5 秒後 `$V pw --raw eval "location.pathname"` が `"/months/$(TZ=Asia/Tokyo date +%Y-%m)"`。
- **合計。** 見出しが `2026年9月` のような月ラベル、`この月の合計` の金額が今月の確定済み支出の合計(マーカー付き支出を含む)。`$V pw --raw snapshot > $E/01-month.yml`。
- **分類の反映。** expense-detail.md の「分類を変える」を行ってから `$V pw reload` すると、分類別内訳の該当分類に金額が移る。
- **前後の月。** 前の月リンクを `$V pw click "getByRole('link', { name: /前/ })"`(正確な名前は snapshot で確認)。URL の月が 1 つ減り、支出がなければ空の表示。次の月リンクで戻る。
- **支出へ。** 月内の支出リンクを押すと `/expenses/<id>` に入る。
- **Proof。** `E=$($V evidence month-book)` に、今月・前月の snapshot / screenshot。合計の突き合わせには `npx convex data expenses --limit 20 --order desc` を `$E/db-expenses.txt` に残し、月内のマーカー付き行の金額を足して画面の合計と一致することを README.txt に書く。

## Gotchas

- 月の境界は JST。UTC の日付で今月を決めると月末・月初にずれる。
- 下書き(draft)の支出は合計に入らない。レシート検証の下書きが残っていると合計が期待とずれる。
- 検証ユーザーの世帯には他の run の支出も溜まる。合計の照合は「マーカー付き支出を含むか」「DB の月内合計と一致するか」で行い、固定値を期待しない。
