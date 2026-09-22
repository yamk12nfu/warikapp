# 支出の詳細・編集・削除

ホーム一覧の支出を開くと `/expenses/<id>` で内訳(品目・負担・立て替え額)が見え、`編集` で `/expenses/<id>/edit` に移って保存し直せる。`削除` は確認ダイアログの後に消える。精算済みの支出は分類だけ変えられる。

## Sub-features

- `detail-view` 一覧の支出リンクから詳細に入り、店名・日付・支払者・品目・合計・立て替え額が出る。
- `detail-category` `分類を保存` で分類だけ変更できる(精算済みでも可)。
- `detail-edit` `編集` → ExpenseEditor で店名や品目を変えて `変更を保存する`。詳細に戻ると反映されている。
- `detail-delete` `削除` → `window.confirm` を受け入れると一覧から消える。
- `detail-hidden` 他世帯・存在しない ID は同じ「見つからない」表示になる。

## How to get to it (user POV)

- ホーム(`/`)の支出一覧のリンク。
- 月別サマリー(`/months/<YYYY-MM>`)の支出リンク。
- 精算の内訳(`/settlements/<id>`)の支出リンク。
- URL 直打ち `http://localhost:3100/expenses/<id>`。

## Driving it with playwright-cli

Preconditions:

- `$V login` 済み。マーカー付きの未精算支出が 1 件ある(なければ manual-expense.md の手順で作る)。

- **詳細を開く。** `/` で `$V pw click "getByRole('link', { name: /$MARK ストア/ })"`。URL が `/expenses/<id>`、見出しに店名、`合計` `¥250`、`編集` と `削除` のボタン。`$V pw --raw snapshot > $E/01-detail.yml`。
- **分類を変える。** `#expense-category` 相当の select を `$V pw select "<selector>" "food"` などで変えて `$V pw click "getByRole('button', { name: '分類を保存' })"`。`npx convex data expenses --limit 3 --order desc` の該当行の `category` が変わる。
- **編集する。** `$V pw click "getByRole('link', { name: '編集' })"` → URL `/expenses/<id>/edit` → `$V pw fill "#store-name" "$MARK ストア(編集)"` → `$V pw click "getByRole('button', { name: '変更を保存する' })"`。詳細に戻り店名が変わっている。DB でも `storeName` が変わる。
- **削除する。** 詳細で `$V pw click "getByRole('button', { name: '削除' })"` → `$V pw dialog-accept`。`/` に戻り、一覧に `$MARK` がない。`npx convex data expenses --limit 5 --order desc | grep -c "$MARK"` が `0`。
- **見つからない表示。** `$V pw goto http://localhost:3100/expenses/nonexistent`。エラーではなく「見つからない」系の表示と `ホームへ` リンク(ID の存在を漏らさない)。
- **Proof。** `E=$($V evidence expense-detail)` に、詳細・編集後・削除後の snapshot / screenshot と DB 出力。

## Gotchas

- `削除` は `window.confirm` を出す。`dialog-accept` を続けて呼ばないとブラウザが止まったように見える。
- 精算済みの支出では `編集` が無効ボタンになり、`分類を保存` だけが効く。編集検証は未精算の支出で行う。
- 編集画面の保存ボタンのラベルは状態依存(下書きなら `この支出を確定する`、確定済みなら `変更を保存する`)。
- 削除した支出はホームから消えるが、証跡の snapshot は削除前に取っておく。
