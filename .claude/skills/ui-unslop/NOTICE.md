# NOTICE（warikapp 側の既知事項）

PR #125 で CodeRabbit が挙げた、upstream（a6f121e）の本文に由来する既知の指摘。うちでは未修正。

- references/effects.md の文字グリッド効果のサンプル: cleanup で IntersectionObserver を disconnect していない。未修正: upstream の参考コードで、warikapp はこの効果を使っていないため（採用するときに直す）。
- references/effects.md の同じサンプル: 画面外でも requestAnimationFrame の予約を続ける。未修正: 上と同じ理由（採用するときは画面外で止め、表示時に再開する）。
- references/tokens.md のライト系 muted 色 #7b7266 / #6b7487 は、ページ背景上でコントラスト比 約4.3:1 / 約4.4:1 と 4.5:1 に届かない。未修正: warikapp のアプリではこの2色を使っていないため（grep で確認済み。採用するときは暗くする）。
- SKILL.md のチェック項目「No emoji left in the interface」は、Icons 節の「アイコンや装飾に使う絵文字」より広く読める。未修正: 今回の polish では絵文字を消していないため（適用するときも、利用者が入力した内容の絵文字は残す）。
