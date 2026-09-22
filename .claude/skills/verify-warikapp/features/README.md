# warikapp verification map

warikapp のユーザー向け挙動を検証するときの正本。まずこの索引を読み、該当する機能ファイルを手順書として使う。

## Baseline preconditions

- `V=.claude/skills/verify-warikapp/scripts/verify.sh` として `$V launch` → `$V doctor` が全 PASS → `$V login` の順で始める。
- アプリは `http://localhost:3100`(`VERIFY_PORT` で変更可)。ユーザーの `npm run dev`(3000)には触らない。
- ログイン後は検証ユーザー「検証エージェント」の世帯にいる。パートナー未参加が既定状態。
- 一意マーカー `検証<HHMMSS>` を店名・品目名に入れて、画面と DB の照合に使う。
- この run が起動していないインスタンスは操作しない。

## Driving conventions

- ブラウザ操作は `$V pw <playwright-cli 引数>`。ハンドルは `getByRole` / `getByLabel` / id セレクタを優先し、ref 番号や座標に依存しない。
- 遷移後は 3〜5 秒待ってから snapshot する。
- 各手順は書いてあるとおりに打つ。引用符付きの名前やフラグを変えない。
- 変更を伴う手順の後は、DB(`npx convex data <table> --limit N --order desc`)でも行を確認する。
- 証跡は `.verify-evidence/<timestamp>-<feature>/` に置き、cleanup で消さない。

## Proof and skip reporting

- 操作の前後と結果を残す(ARIA snapshot と、アプリのヘッダーが写ったスクリーンショット)。
- 変更の証跡には「別のユーザー向け表示で読み直した結果」を含める(例: 登録後にホーム一覧、詳細画面、DB の行)。
- 使った feature ID と入口を証跡ディレクトリの `README.txt` に書く。
- 到達できなかった経路は、試したコマンドと満たせなかった前提条件を添えて報告する。別経路で通ったことを、飛ばした入口の検証にすり替えない。

## Feature entry contract

各機能ファイルは H1 のタイトルと 1 段落の説明で始まり、次の 4 つの H2 をこの順で持つ。

1. `Sub-features`: 短い ID と 1 行の挙動説明。
2. `How to get to it (user POV)`: ユーザーから見た入口すべて。
3. `Driving it with playwright-cli`: `Preconditions:` から始め、操作・コマンド・観測結果を対にした箇条書き。
4. `Gotchas`: 検証を無駄にしたり無効にしたりする罠。

## Features

- [世帯のセットアップ](./setup-household.md) 世帯の作成、招待コード、パートナー参加、表示名変更。
- [支出の手入力](./manual-expense.md) 店名・品目・金額・負担区分を入れて登録し、ホームと DB で確認する。
- [レシートからの支出登録](./receipt-expense.md) 画像アップロード → AI 読み取り → 品目確認 → 登録。外部 AI 境界を含む。
- [支出の詳細・編集・削除](./expense-detail.md) 一覧から詳細へ、編集して保存、削除の確認ダイアログ。
- [精算と精算履歴](./settlement.md) 未精算差額、精算の実行、履歴と取り消し。
- [月別サマリー](./month-book.md) 月の合計・負担の推移・前後の月への移動。
