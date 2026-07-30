# warikapp 本番デプロイ手順書(Phase 9)

計画書 `docs/implementation-plan.md` の11章の作業を、**ダッシュボードで実際に押す順**に開いたもの。
上から順にやれば通る。詰まったら末尾の「症状 → 原因の早見表」を見る。

コードとリポジトリ側の準備は済んでいる(`vercel.json` を含む)。ここに書いてあるのは
**外部サービスのダッシュボードでの作業だけ**で、すべて人間の手作業。

---

## 0. 始める前に

### 現在地

| 項目 | 状態 |
|---|---|
| Convex 本番デプロイ | `accurate-capybara-527` が作成済み。**テーブル0件・環境変数0件**(まだ何も入っていない) |
| Convex 開発デプロイ | `benevolent-koala-496`。`CLERK_JWT_ISSUER_DOMAIN` と `GEMINI_API_KEY` を登録済み |
| Clerk | **本番インスタンス構築済み**(2026-07-31)。Primary domain `warikapp.yamk12nfu.com` = Verified / DNS = Verified / SSL = Issued。Google OAuth は自前の認証情報を登録済み。Issuer は `https://clerk.warikapp.yamk12nfu.com` |
| Vercel | 未Import |
| ドメイン | **`yamk12nfu.com` 取得済み**(Cloudflare Registrar)。アプリは `warikapp.yamk12nfu.com` を使う |

### ⚠️ 先に用意すること: 自分のドメイン

**Clerkの本番インスタンスは、自分が所有するドメインが必須**。Clerkのダッシュボードが指示する
CNAMEレコードを自分で追加する必要があるため、`*.vercel.app` のような借り物のドメインでは作れない。
Vercel側にもそのドメインを追加する(手順3-3)。

**開発インスタンス(`pk_test_...`)のまま公開するのは避けること。** Clerkは開発インスタンスを
「本番のワークロードには適さない」と明言していて、理由はユーザー数上限(100)だけではない:

- 開発インスタンスはセッションを `__clerk_db_jwt` として**クエリ文字列で運ぶ**。この値は
  サーバーログやブラウザ履歴にそのまま残る
- そもそも開発用にセキュリティ姿勢を緩めてある

どうしてもドメインが間に合わないときの暫定運用は 手順1-alt に書いたが、**実運用を始める前に
ドメインを取ること**。取得直後から使える(DNSの反映に最大48時間かかるとClerkは案内しているが、
実際は数分〜数時間で通ることが多い)。

> ⚠️ **一度決めたドメインは後から変えられないと思っておくこと。** Clerk本番インスタンスのIssuerは
> `https://clerk.<Clerkに登録したドメイン>` になり(本構成では
> `https://clerk.warikapp.yamk12nfu.com`)、その文字列が `members.tokenIdentifier` の先頭に
> 焼き付く(`<issuer>|<subject>` の形)。ドメインを変えると既存のメンバー行が一致しなくなり、
> 世帯も支出も精算履歴も**DBに残ったまま誰からも見えなくなる**。
> 救うには新旧の `tokenIdentifier` を対応付ける一回限りのmutationが要る。

### 0-1. ドメインを取る(Cloudflare Registrar)

**この節は取得済み(2026-07-30)。** 記録として残す。
ルートは個人名義、アプリはサブドメインにするという方針で
**ルート `yamk12nfu.com` / アプリ `warikapp.yamk12nfu.com`** にした。

Cloudflare Registrar を使う理由: **原価販売**(レジストリの卸値に上乗せしない。更新時も同じ考え方なので
「初年度だけ激安」が無い。ただしレジストリ自体が値上げすればそれは反映される)、
WHOISプライバシーが無料、DNSの管理画面が速い。今回 Clerk用に5件前後・Vercel用に1件のDNSレコードを
入れるので、そこが素直なのは効く。

1. [Cloudflare](https://dash.cloudflare.com/sign-up) でアカウントを作る(無料プランでよい)
2. ダッシュボード左メニュー → **Domain Registration** → **Register Domain**
3. `yamk12nfu` で検索 → TLDを選ぶ(`.com` が無難)→ カートへ
4. 登録者の連絡先情報を入力する。**実在の情報を入れること**(ICANNの登録者情報として使われる)。
   WHOISには Cloudflare の代理情報が出るので、個人情報は公開されない
5. クレジットカードを登録して購入(`.com` で年10ドル前後 + ICANN手数料)
6. 購入すると、そのドメインは**自動的にCloudflareのゾーンとして追加され、ネームサーバーも
   Cloudflareになる**。DNSレコードはこのゾーンに入れていく(手順1-2 / 手順3-3)

**購入直後の確認:**

- [ ] **Auto-renew は ON のまま**にしておく(既定でON)。切ると失効する
- [ ] 登録が通っているかをレジストリ側で確認する(下記)

> **ICANNの登録者確認メールは、Cloudflareでは基本的に届かない。** ICANNは登録者メールの検証を
> 求めるが、Cloudflare Registrar は**Cloudflareアカウントのメールアドレス**でそれを満たすため、
> アカウント作成時に認証済みなら改めてメールは飛ばない。届かなくても異常ではないので待たなくてよい
> (届いた場合だけリンクを踏む)。
>
> 気になるときはメールを探すのではなく、**レジストリ側の状態を見るのが確実**:
>
> ```bash
> whois yamk12nfu.com | grep -i "domain status"
> ```
>
> - `addPeriod` … 登録直後5日間のグレース期間。正常
> - `clientTransferProhibited` … レジストラが掛ける移管ロック。正常
> - **`clientHold` … これが付いていたら要対応。** この間ドメインは名前解決しない。
>   原因は登録者検証の滞留だけでなく、支払い不備や紛争などもありうるので、
>   WHOISだけで断定せずCloudflareのダッシュボードの表示を見ること
>
> 実測(2026-07-30): `addPeriod` と `clientTransferProhibited` のみ。検証待ちではない

**知っておくこと:**

- Cloudflare Registrar は **CloudflareのDNSを使うことが前提**。他社DNSには向けられない
- 登録から **60日間は他レジストラへ移管できない**(ICANN規定)
- ⚠️ **Clerk用のDNSレコードは、プロキシ(オレンジの雲)を必ずOFFにする。** ONだとClerkの
  ドメイン検証が通らない(手順1-2 で再掲)

### 用意するもの

- Googleアカウント(Google Cloud Console と Google AI Studio 用)
- Clerk / Vercel / Cloudflare のアカウント
- クレジットカード(ドメイン購入用)
- ドメイン(手順0-1)

### 所要時間の目安

ドメイン購入が15分ほど。そこからDNSの反映待ちを除いて 1〜1.5時間。DNSを待つ場合はそこで一度中断できる(手順1-2 まで進めて放置 → 反映後に 手順1-3 から再開)。

### 全体の順序

ドメインが Clerk と Vercel の両方に要るので、行ったり来たりする。迷ったらこの並びに戻る。

```
0-1 Cloudflare Registrar でドメインを取る
1-1 Clerk本番インスタンス作成
1-2 Clerk Domains にドメイン登録 → CNAMEをDNSに追加(反映待ち)
1-3 Clerk でリダイレクトURIを表示 → Google Cloud で OAuthクライアント作成 → Clerkに貼る
1-4 JWTテンプレート convex を作成 → Issuer URL を控える
1-5 Allowed Subdomains を有効化(リストは空のまま)
1-6 SSL certificates が Issued か確認(ボタンが出ていれば押す)
1-7 pk_live / sk_live を控える
2   Convex prod に環境変数を登録
3   Vercel に Import(環境変数3つ)→ Deploy → ドメイン追加 → 許可オリジンを足して再デプロイ
4   ローカルでの事前確認(3 の前にやってもよい)
```

---

## 1. Clerk 本番インスタンス + Google OAuth

**ここの設定漏れが本番ログイン失敗のほぼすべて。** 順番どおりにやること
(ClerkでリダイレクトURIを表示 → Googleで登録 → Clerkに貼り戻す、という往復になる)。

### 1-1. 本番インスタンスを作る

1. [Clerk Dashboard](https://dashboard.clerk.com) を開く
2. 左上のインスタンス切替(`Development` と出ているところ)→ **Create production instance**
3. 「開発インスタンスの設定をコピーするか」を聞かれたらコピーする(**ただしソーシャル認証の
   認証情報はコピーされない**。共有のものは本番では使えないため。これが 1-3 の作業になる)

### 1-2. ドメインとDNS

1. Clerk Dashboard → **Domains**
2. **`warikapp.yamk12nfu.com`** を入力(ルートではなくアプリ用のサブドメイン)
3. **サブドメインを入れた場合、Clerkは「Primary application か Secondary application か」を聞いてくる。**
   **Secondary application を選ぶ。** 理由: `yamk12nfu.com` は他のプロジェクトでも使う前提なので、
   このアプリのClerk基盤はアプリのサブドメイン配下(`clerk.warikapp.yamk12nfu.com`)に閉じ込めたい。
   Primary を選ぶとルート直下(`clerk.yamk12nfu.com`)を取ってしまう。
   ⚠️ 以降の手順で使うリダイレクトURIとIssuer URLは**必ずClerkの画面に出ている実物をコピーする**こと
   (この手順書の値は選択がSecondaryだった場合の想定形)
4. Clerkが**追加すべきDNSレコードの一覧**を出す。CNAMEが5件前後
   (`clerk`, `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey` など)。
   この画面は開いたままにして、下の 1-2a で1件ずつCloudflareに入れる
5. 全部入れ終わったらClerkの画面で **Verify** を押し、レコードが緑になるまで待つ

#### 1-2a. Cloudflare にレコードを入れる

> ✅ **DNSがCloudflareなら、Clerkが自動で入れてくれる。** Clerkの画面に
> 「Authorize DNS records from Clerk」が出たら、そちらを使うほうが確実
> (一回限りの認可で、以降Clerkが勝手に変更することはない)。
> 表示される5件が下の表と同じ形(`clerk.warikapp` / `accounts.warikapp` /
> `clkmail.warikapp` / `clk._domainkey.warikapp` / `clk2._domainkey.warikapp`、
> すべて **DNS only**)であることだけ確認して Authorize を押す。
> **この場合、下の手入力は不要**。二重付与とプロキシONの罠を両方回避できるので、
> 手入力より安全。手入力するのは、この連携が出ないときだけ。

<details>
<summary>手入力する場合(Clerkの自動連携が出ないとき)</summary>

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Websites** → `yamk12nfu.com` → **DNS** → **Records**
2. **Add record** を押し、Clerkの一覧の1件ぶんを入れる:

| 欄 | 入れるもの |
|---|---|
| Type | `CNAME` |
| **Name** | Clerkが表示している名前(下の⚠️を読むこと) |
| **Target** | Clerkが表示している値をそのまま貼る |
| **Proxy status** | **DNS only(グレーの雲)** ← 既定はProxiedなので**必ず切り替える** |
| TTL | `Auto` のままでよい |

3. Clerkの一覧の件数ぶん繰り返す

> ⚠️ **Name 欄の二重付与に注意。** CloudflareのName欄は**ゾーン名が自動で補われる**。
> Clerkは完全修飾名(`clerk.warikapp.yamk12nfu.com`)で表示するので、そのまま貼ると
> `clerk.warikapp.yamk12nfu.com.yamk12nfu.com` になりうる。
>
> **確実なのは、入力後にレコード一覧に表示された名前がClerkの表示と一字一句一致しているかを
> 目で確かめること。** ずれていたら、`.yamk12nfu.com` を除いた部分
> (`clerk.warikapp`)だけを入れ直す。

> ⚠️ **Proxy status は必ず DNS only。** オレンジの雲(Proxied)のままだと、CloudflareがCNAMEを
> 自分のIPで隠してしまい、**Clerkのドメイン検証が永久に通らない**。
> `_` で始まる名前(`clk._domainkey` など)は元からプロキシできないのでグレーのままになる。
> 切り替えが要るのは `clerk` / `accounts` / `clkmail` あたり。

</details>

#### 1-2b. 入ったかを自分で確認する

Clerkの Verify を押す前に、手元から引けるか確かめられる。反映は数分〜数時間。

```bash
for n in clerk accounts clkmail clk._domainkey clk2._domainkey; do
  h="$n.warikapp.yamk12nfu.com"
  printf "%-20s CNAME=%-40s A=%s\n" "$n" "$(dig +short "$h" CNAME | tr '\n' ' ')" "$(dig +short "$h" A | tr '\n' ' ')"
done
```

判定:

| 結果 | 状態 |
|---|---|
| **CNAME に Clerk のターゲットが返る** | **正常**(DNS only)。Verify を押してよい |
| **CNAME が空で、A だけ返る** | **Proxied のまま**。Cloudflareで DNS only に切り替える |
| CNAME も A も空 | 未反映か、Name の間違い(1-2a の二重付与) |

> ⚠️ **判定に使うのは「CNAMEが返るかどうか」だけ。IPアドレスでは判定できない。**
> Cloudflareはプロキシ中のCNAMEを flatten するので、Proxiedだと**CNAME問い合わせが空**になり
> A問い合わせにCloudflareのIPが返る — これが見分け方。
>
> 一方、**IPが `104.x` / `172.64.x`(Cloudflareのanycast)でも異常ではない**。
> Clerkのバックエンド自体がCloudflareの裏にあるため、正常な DNS only の状態でも
> A問い合わせはこれらのIPを返す(実測: `clerk` → `frontend-api.clerk.services.` →
> `worker.clerkprod-cloudflare.net.` → `104.18.34.146` / `172.64.153.110`)。
> IPだけ見て「プロキシされている」と誤診しないこと。

### 1-3. Google Cloud Console で OAuth クライアントを作る

まず **Clerk 側でリダイレクトURIを表示させる**:

1. Clerk Dashboard(本番インスタンス)→ **SSO Connections** → **Google**
2. **Use custom credentials** をONにする
3. 表示される **Authorized Redirect URI**(`https://clerk.warikapp.yamk12nfu.com/v1/oauth_callback` の形)を
   コピーしておく。この画面は開いたままにする

次に [Google Cloud Console](https://console.cloud.google.com):

1. プロジェクトを作る(名前は何でもよい。例: `warikapp`)
2. **APIとサービス → OAuth同意画面**
   - User Type: **外部(External)**
   - アプリ名 / ユーザーサポートメール / デベロッパーの連絡先情報 を入力
   - スコープ: `openid` / `userinfo.email` / `userinfo.profile` の3つで足りる
   - ⚠️ **公開ステータス**: 「テスト」のままだと**テストユーザーに登録したGoogleアカウントしか
     ログインできない**。2人ぶんのアカウントをテストユーザーに登録するか、「公開」にする。
     ここが「自分は入れるのにパートナーが入れない」の原因になる
3. **APIとサービス → 認証情報 → 認証情報を作成 → OAuth クライアント ID**
   - アプリケーションの種類: **ウェブアプリケーション**
   - **承認済みの JavaScript 生成元**: `https://warikapp.yamk12nfu.com` を入れる。
     Clerkの手順が明示的に要求している
   - **承認済みのリダイレクト URI**: 上でコピーしたClerkのURIを貼る
     - ⚠️ 末尾スラッシュの有無・大文字小文字の違いでも一致しない。**貼り付けるだけで手打ちしない**
   - 作成 → **クライアントID** と **クライアントシークレット** をコピー

Clerkに戻る:

4. 1-3 の Google の画面に **Client ID** と **Client Secret** を貼って保存

### 1-4. JWTテンプレート `convex` を作る

1. Clerk Dashboard(本番インスタンス)→ **Configure** → **JWT Templates** → **New template** → **Convex**
2. ⚠️ **テンプレート名は `convex`(小文字)のまま変えない**。`convex/auth.config.ts` の
   `applicationID: "convex"` と一致している必要がある
3. 保存し、**Issuer URL**(`https://clerk.warikapp.yamk12nfu.com` の形)をコピー → 手順2 で使う

### 1-5. Allowed Subdomains を有効化する(リストは空のまま)

1. Clerk Dashboard(本番)→ **Domains** → **Allowed subdomains** タブ
2. **Enable allowed subdomains** を **ON**
3. **リストには何も足さない**

**なぜ空でよいか**: この設定が制限するのは「**プライマリドメイン配下**のサブドメイン」。
手順1-2 で Secondary application を選んだので、**プライマリドメインはアプリ自身
(`warikapp.yamk12nfu.com`)**。プライマリドメインは**常に許可される**ので、
アプリは何も登録しなくても動く。入力欄に入れようとしても
`Subdomain cannot be the domain itself` で弾かれるのはこのため。

**なぜONにするか**: OFFのままだと `なにか.warikapp.yamk12nfu.com` が**すべて許可**されたままになる。
ONで空リストにすると「プライマリドメインだけ許可」= 最も狭い状態になる。
今そういうホストは無いが、将来足したときに黙って許可されるのを防げる。

> 「Allowed subdomains is enabled but no subdomains have been added.
> This will prevent all subdomains from accessing the application.」という警告が出るが、
> **これは意図どおり**。止めたいのはまさに「サブドメインからのアクセス」で、
> アプリ本体はプライマリドメインなので影響を受けない。
>
> ⚠️ ONにしたら**必ず本番URLでログインし直して確認すること**(手順3-5)。
> 万一ログインできなくなったらOFFに戻せばよい。この設定は即時に効き、いつでも戻せる。

> **手順1-2 で Primary application を選んでいた場合は話が別。** プライマリドメインが
> `yamk12nfu.com`(ルート)になり、アプリは `warikapp.yamk12nfu.com` = その配下のサブドメイン
> なので、**空リストのままだとアプリ自身が弾かれる**。この場合は
> `warikapp.yamk12nfu.com` を明示的に登録する。どちらの状態かは、この画面に表示されている
> プライマリドメイン名で判別できる。

**補足 — `CLERK_AUTHORIZED_PARTIES`(手順3-4)との関係**: あちらが効くのは Next.js の Proxy を
通るリクエストだけで、**画面のデータはClerkのJWTを直接Convexへ送る経路で流れている**
(`convex/auth.config.ts` は Issuer と `applicationID` しか検証しない)。つまり Proxy 側の検査は
Convexへの直接アクセスには効かない。サブドメイン経由の迂回を塞ぐのはこちらの設定。

### 1-6. 証明書を確認する

Clerk Dashboard → **Domains**(Primary タブ)を開き、3つとも緑になっていることを確認する:

| 項目 | あるべき状態 |
|---|---|
| Primary domain | `warikapp.yamk12nfu.com` **Verified** |
| DNS configuration | **Verified** |
| SSL certificates | **Issued** ← これが本番インスタンス有効化のゴール |

**完了条件は `SSL certificates: Issued` の表示**。`Deploy certificates` ボタンが出ていれば押す。
出ていなければ既に発行済み(必要条件が揃った時点で発行が済んでいることがある)。
**ボタンの有無ではなく Issued 表示で判断する。**

手元からも確認できる:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://clerk.warikapp.yamk12nfu.com/.well-known/openid-configuration
```

`200` が返れば証明書もFrontend APIも生きている。

> ⚠️ 同じ画面の `Danger zone` にある **Change domain** は押さないこと。ドメインを変えると
> Issuer が変わり、`members.tokenIdentifier` が全件一致しなくなる(手順0 の警告)。

### 1-7. 本番APIキーを控える

Clerk Dashboard → **API Keys** → `pk_live_...`(Publishable key)と `sk_live_...`(Secret key)を
コピー → 手順3 で使う。

---

## 1-alt. ドメインが間に合わないときの暫定運用(推奨しない)

Clerkの**開発インスタンスは本番URLからでも動く**ので、ドメインの取得・DNS反映を待つ間の
つなぎとしては使える。**ただし恒久的な運用にはしないこと**(手順0 のとおり、Clerk自身が本番の
ワークロードには適さないと明言している)。

- 使うキーは今の `pk_test_...` / `sk_test_...`(`.env.local` にあるもの)
- Issuer URL も今 Convex の dev に入れているもの(`npx convex env get CLERK_JWT_ISSUER_DOMAIN` で確認できる)
- Google OAuth の自前設定は不要(Clerkの共有認証がそのまま使える)

受け入れることになるもの:

| 制約 | 中身 |
|---|---|
| **セッションの扱い** | 開発インスタンスは `__clerk_db_jwt` を**クエリ文字列で運ぶ**。サーバーログ・ブラウザ履歴・拡張機能から見える。ここが「推奨しない」の主因 |
| **セキュリティ姿勢** | 開発用に全体的に緩めてある(Clerkのドキュメントの表現) |
| ユーザー数 | 上限100ユーザー。インスタンス間でユーザーデータは移せない |
| 同意画面 | Googleのログイン画面に Clerk の名前が出る(自分のアプリ名にはならない) |
| 本番への移行 | あとからドメインを取って 手順1 をやり直せる。**そのときユーザーは作り直しになる**(招待からやり直し) |

> **手順2 以降では「本番Clerkの値」を「開発Clerkの値」に読み替えること**
> (Convexのprodには開発ClerkのIssuer URLを入れる)。手順1-5 / 手順1-6 は不要。
>
> 暫定で始めた場合は、レシートや精算の実データを入れる前にドメインを用意して 手順1 に移ること。
> データが増えてからだとユーザーの作り直しが痛くなる。

---

## 2. Convex 本番環境の環境変数

`accurate-capybara-527`(prod)に登録する。**`.env.local` でもVercelでもない**
— AI呼び出しの action は Convex 側で動くので、Convex に置かないと届かない。

### 必須(2つ)

| 変数 | 値 | 未設定だとどうなるか |
|---|---|---|
| `CLERK_JWT_ISSUER_DOMAIN` | 手順1-4 の Issuer URL | **デプロイ自体が失敗する**(`convex/auth.config.ts` が読む) |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) のAPIキー | レシート読み取りが「AIの設定が未完了です」で止まる |

### 任意(2つ)

| 変数 | 既定値 | 入れる意味 |
|---|---|---|
| `RECEIPT_AI_PROVIDER` | `gemini` | Claudeに切り替えるとき `claude` にする(要 `ANTHROPIC_API_KEY`) |
| `RECEIPT_AI_MODEL` | `gemini-3.6-flash` | モデルを固定したいとき。コード側の既定が将来変わっても本番の挙動が動かない |

### コマンドでやる場合

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN 'https://clerk.warikapp.yamk12nfu.com' --prod
```

APIキーはシェル履歴に残したくないので、値を省いて対話入力にする:

```bash
npx convex env set GEMINI_API_KEY --prod
```

登録できたか確認(名前だけ見るなら `--names-only` を付ける。値も出るので画面共有中は注意):

```bash
npx convex env list --names-only --prod
```

ダッシュボードからやる場合は [Convex Dashboard](https://dashboard.convex.dev/d/accurate-capybara-527) →
右上で **Production** を選択 → **Settings → Environment Variables**。

---

## 3. Vercel

> **順序に注意**: 環境変数は Import 画面(Configure Project)で入れられるが、
> **ドメインはプロジェクトが作られてからでないと追加できない**。
> `CLERK_AUTHORIZED_PARTIES` は本番URLが確定してから入れるので、最後に足して再デプロイになる。
>
> ```
> 3-1 Import(Configure Project で 3-2 の環境変数を入れてから Deploy)
> 3-2 環境変数(CLERK_AUTHORIZED_PARTIES を除く3つ)
> 3-3 Settings → Domains でカスタムドメインを追加
> 3-4 CLERK_AUTHORIZED_PARTIES を足して再デプロイ
> 3-5 仕上げ
> ```

### 3-1. Import

1. [Vercel](https://vercel.com/new) → GitHub の `warikapp` リポジトリを Import
2. Framework Preset は `Next.js` が自動検出される(そのままでよい)
3. **Configure Project の画面で 手順3-2 の環境変数3つを入れてから** Deploy を押す
   (入れずにDeployすると `CONVEX_DEPLOY_KEY` が無くて初回ビルドが落ちる。落ちても
   あとから環境変数を入れて再デプロイすれば直る)
4. ⚠️ **Build Command は触らない**。リポジトリの `vercel.json` に書いてあり、そちらが
   ダッシュボードの設定より優先される:

   ```json
   {
     "buildCommand": "npx convex deploy --cmd 'npm run build'",
     "ignoreCommand": "[ \"$VERCEL_ENV\" != production ]"
   }
   ```

   - `buildCommand`: Convex関数とフロントを**同時に**デプロイする。ダッシュボードにだけ書くと
     設定がリポジトリに残らず、プロジェクトを作り直したときに消える。消えると
     「フロントは新しいのに Convex 関数は古い」という気づきにくい壊れ方をする
   - `ignoreCommand`: 本番以外(PRのプレビュー)のビルドを**丸ごと止める**。プレビュービルドが
     本番用のデプロイキーで `npx convex deploy` を走らせて**本番のConvex関数を書き換える**
     事故を、設定ミスがあっても起きないようにするため。プレビュー環境が欲しくなったら
     Convex側でプレビュー用デプロイキーを発行したうえで、この行を消す

### 3-2. 環境変数(Import時に入れる3つ)

Import画面の **Environment Variables**(あとから足すなら Settings → Environment Variables)。

| 変数 | 値 | Environment |
|---|---|---|
| `CONVEX_DEPLOY_KEY` | Convex Dashboard → **Production** → Settings → **Deploy Keys** → *Generate Production Deploy Key* | ⚠️ **Production だけにチェック** |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_...`(手順1-7) | Production |
| `CLERK_SECRET_KEY` | `sk_live_...`(手順1-7) | Production |

> ⚠️ Vercelで環境変数を足すと **既定で Production / Preview / Development の3つ全部にチェックが入る**。
> `CONVEX_DEPLOY_KEY` は必ず Production だけに絞る(`ignoreCommand` で二重に防いではいるが、
> 元を断っておく)。

> ⚠️ **`NEXT_PUBLIC_CONVEX_URL` は設定しない**。`npx convex deploy --cmd` がビルド時に
> 本番のURL(`https://accurate-capybara-527.convex.cloud`)を自動で渡す。手で入れると、将来
> デプロイ先を変えたときに古い値が残って「本番なのに開発のデータが見える」状態になる。

Deployが成功すると、ビルドログに `Deploying to https://accurate-capybara-527.convex.cloud` の
ような行が出る。これが出ていれば Convex 側も一緒にデプロイされている。

### 3-3. カスタムドメインを追加する

**Clerk本番インスタンスを使うなら必須。** `*.vercel.app` のままでは本番のClerkキーが使えない(手順0)。

1. Vercel の **Settings → Domains** → `warikapp.yamk12nfu.com` を追加
   (手順1-2 で Clerk に登録したのと**同じFQDN**)
2. Vercelが追加すべきDNSレコードを表示する。サブドメインなので通常は **CNAME 1件**:

| 欄 | 入れるもの |
|---|---|
| Type | `CNAME`(Vercelの表示に従う) |
| Name | `warikapp`(Cloudflareがゾーン名を補うので、`warikapp.yamk12nfu.com` と二重にしない) |
| Target | Vercelが表示する値をそのまま貼る(`cname.vercel-dns.com` 系) |
| **Proxy status** | **DNS only(グレーの雲)** |
| TTL | `Auto` |

3. Vercelの画面でドメインが有効(Valid Configuration)になるまで待つ

> ⚠️ **ここも Proxy status は DNS only にする。** Cloudflareのプロキシを通すと、Vercel側の
> 証明書発行が通らなかったり、CloudflareのSSLモード次第でリダイレクトループになる。
> Cloudflareのキャッシュ/WAFは今回使わないので、素通しでよい。

> 手順1-2 で入れた `clerk.warikapp` などとは**別名のレコード**。競合しないので両方が並ぶ。

確認:

```bash
dig +short warikapp.yamk12nfu.com
```

### 3-4. `CLERK_AUTHORIZED_PARTIES` を足して再デプロイ

本番URLが確定してから入れる。

| 変数 | 値 | Environment |
|---|---|---|
| `CLERK_AUTHORIZED_PARTIES` | `https://warikapp.yamk12nfu.com`(複数あればカンマ区切り) | Production |

入れたら **Deployments → 最新 → Redeploy**。

> これを入れると `proxy.ts` が「このオリジンから来たトークンだけを受け付ける」ようClerkに指示する。
> Clerkは `azp` と**完全一致**で判定する。`proxy.ts` は値を http(s) のオリジンに正規化するので、
> 末尾スラッシュ・大文字・`:443` は吸収される。
>
> 値はカンマ区切りの**1件ずつ**処理され、http(s)のオリジンとして解釈できたものだけが残る。
> 症状は「残ったオリジンの集合」で決まる:
>
> | 残ったオリジン | `proxy.ts` が渡すもの | 症状 |
> |---|---|---|
> | 本番オリジンを含む | 残ったオリジンすべて | 正常。ただし余分なオリジンを書いていれば、そのぶん**許可範囲が広がる** |
> | 1件以上あるが本番オリジンを含まない | 残ったオリジンすべて | **全員ログインできなくなる** |
> | 0件 | **何も渡さない** | 検査なしに倒れる(保護が掛からない) |
>
> ログに出る警告は2種類:
>
> - **解釈できなかった値**は、残りの件数にかかわらず1件ずつ警告が出る
> - 残りが**0件**になったときは、それに加えて「検査を行いません」の警告が出る。
>   ただし**未設定・空文字のときは出ない**(そもそも設定していないので既定の挙動)
>
> **「本番オリジンを含まない」こと自体には警告が出ない。** 値としては正しいオリジンなので、
> `proxy.ts` からは書き間違いだと分からない。**全員ログインできなくなったらここを疑う**
> (解釈できない値が混ざっていればその値の警告は出るが、それは別の話)。
>
> 必ず `https://` から書くこと。設定後は必ずログインし直して確認する。

> ⚠️ **これだけでは足りない。** 効くのは Next.js の Proxy を通るリクエストだけで、画面のデータは
> ClerkのJWTを直接Convexへ送る経路で流れている。サブドメインからの迂回は
> **Clerkの Allowed Subdomains(手順1-5)** の領分。空リストで有効化しておけば、
> プライマリドメイン以外は塞がれる。

### 3-5. デプロイ後の仕上げ

1. カスタムドメインで本番URLを開き、Googleログインが通ることを確認する
2. Clerk Dashboard(本番インスタンス)→ **Paths** で、サインイン後のリダイレクト先が
   `/` になっていることを確認する
3. `docs/verification-checklist.md` の「6. 本番デプロイ・運用」を上から潰す

---

## 4. デプロイ前にローカルで潰せること

外部サービスを触る前にこれを通しておくと、Vercelのビルドログで初めて気づく、を減らせる。

```bash
npx tsc --noEmit && npm run lint && npx vitest run && npm run build
```

```bash
npx convex dev --once
```

`npx convex dev --once` は **開発デプロイ**に対して、本番デプロイと同じことをやる
(型チェック → バンドル → スキーマとインデックスの反映)。ここを通ればコード側の問題は
ほぼ出尽くす。

本番に対して「何が変わるか」だけ見たいときは:

```bash
npx convex deploy --dry-run
```

> このコマンドは **本番を対象にする**ので、実行途中で
> 「Do you want to push your code to your prod deployment ... now?」と聞かれる。
> **`--dry-run` が付いている限り、`y` と答えても実際のデプロイは行われない**
> (`Deployed` ではなく `Would have deployed` と出る。`--cmd` のビルドも実行されない)。
> むしろ `n` と答えるとその手前でCLIが終了して、見たかった差分が出ない。
>
> ⚠️ 危ないのは **`--dry-run` の付け忘れ**のほう。同じプロンプトが出て、`y` と答えると
> **本当にデプロイされる**。コマンドをコピペしたら実行前に末尾を必ず確認すること。

**本番デプロイで初めて出る失敗は、実質2つしかない**:

1. `CLERK_JWT_ISSUER_DOMAIN` が prod に未登録 → 手順2 で解決(ローカルからは
   `npx convex env list --prod` で事前に確認できる)
2. 既存の本番データがスキーマに合わない → **今回は起きない**。本番DBはテーブル0件
   (`npx convex data --prod` で確認済み)。データが入ってからスキーマを変えるときは、
   ここが本番だけで落ちる箇所になる

---

## 5. コスト上限とアラート

### Gemini(既定のAIプロバイダ)

計画書の初期版はAnthropicコンソール前提だったが、既定プロバイダが Gemini になったので
**Google AI Studio 側**で設定する。

1. [Google AI Studio](https://aistudio.google.com) → **Spend** ページ
2. **Monthly spend cap** → **Edit spend cap** で、プロジェクトごとの月額上限を設定する
   - プロジェクトの編集者 / オーナー / 管理者の権限が要る
3. 課金を有効にしていない(無料枠のまま)なら、そもそもレート制限で頭打ちになるので
   上限設定は必須ではない。ただし**無料枠で使えるモデルは限られる**ので、
   `gemini-3.6-flash` が 429 で断られるようなら課金を有効にする

> アプリ側にも歯止めがある: 読み取り30回/時/世帯、アップロードURL発行60回/時/世帯
> (`convex/rateLimits.ts`)。連打やスクリプトでの暴走はここで止まる。

Claudeに切り替えている場合は [Anthropic Console](https://console.anthropic.com) の
Limits でワークスペースの月額上限を設定する。

### Convex

[Convex Dashboard](https://dashboard.convex.dev/d/accurate-capybara-527) → **Usage** で、
関数呼び出し数・データベース帯域・**File Storage** を見る。File Storage は
レシート画像が積み上がる場所で、TBD-002(置き去りアップロードの掃除)の判断材料になる
(計画書の11章 参照)。

---

## 6. 動かし始める

1. 本番URLを自分のスマホで開いて Googleログイン → 世帯を作る
2. 設定画面から招待コードを発行してパートナーに渡す
3. パートナーが**別のGoogleアカウント**でログイン → 招待コードで参加

通しの確認項目は `docs/verification-checklist.md` を使う。

---

## 7. 症状 → 原因の早見表

| 症状 | 原因 | 対処 |
|---|---|---|
| Vercelのビルドが `CONVEX_DEPLOY_KEY` 関連で落ちる | キーが未設定、またはEnvironmentがProductionになっていない | 手順3-2 |
| ビルドは通るが、開いたら画面が真っ白 | `NEXT_PUBLIC_CONVEX_URL` を手で入れて古い値を指している | Vercelから消して再デプロイ(手順3-2) |
| Convexのデプロイが auth.config で落ちる | prod に `CLERK_JWT_ISSUER_DOMAIN` が無い | 手順2 |
| ログイン画面までは出るが Google を押すとエラー | GoogleのOAuthクライアントのリダイレクトURIがClerkのものと一致していない | 手順1-3。**貼り直す**(手打ちしない) |
| 自分はログインできるがパートナーができない | OAuth同意画面が「テスト」のままで、相手がテストユーザーに入っていない | 手順1-3 の2 |
| ログインは通るがアプリが「ログインしてください」のまま | ClerkのJWTテンプレート名が `convex` になっていない / prodのIssuer URLが開発インスタンスのもの | 手順1-4、手順2 |
| レシート読み取りが「AIの設定が未完了です」 | prod に `GEMINI_API_KEY` が無い(devにしか入っていない) | 手順2 |
| レシート読み取りが「AIモデル『…』が使えません」 | `RECEIPT_AI_MODEL` の綴り間違い、またはそのキーで使えないモデル | 手順2。消せばコード側の既定に戻る |
| レシート読み取りが「AIの利用上限に達したか、残高が不足」 | Gemini側のレート制限か残高切れ | 手順5 |
| PRを出すとVercelのチェックが「Skipped」になる | `ignoreCommand` の意図どおりの動作 | 問題なし(手順3-1) |
| **`CLERK_AUTHORIZED_PARTIES` を入れた直後から全員ログインできない** | 値が本番URLと**別のオリジン**を指している(別ドメイン・タイポ・`http` と `https` の取り違え)。Clerkは完全一致で判定する | 手順3-4。切り分けは変数を消して再デプロイ(消せば検査なしに戻る) |
| `CLERK_AUTHORIZED_PARTIES` を入れたのに効いていない | http(s)のオリジンとして解釈できる値が**1件も残らなかった**ため、`proxy.ts` が検査なしに倒した(`example.com` のようにスキームが無い、`ftp://` などの別スキーム、`,` だけ)。**このときは締め出しにはならない** | 手順3-4。Vercelの実行ログに `CLERK_AUTHORIZED_PARTIES:` で始まる警告が出る |
| **Clerkのドメイン検証がいつまでも緑にならない** | ①Proxy status が Proxied(オレンジ)のまま ②Name欄でゾーン名が二重になっている ③単に未反映 | 手順1-2a / 手順1-2b。**CNAMEが空でAだけ返るなら①**、両方空なら②か③(IPの値では判定できない) |
| Vercelのドメインが Valid Configuration にならない | 同上。Vercel用CNAMEも DNS only にする | 手順3-3 |
| Clerkの Allowed Subdomains で `Subdomain cannot be the domain itself` と出る | 入力欄はプライマリドメイン「配下」のサブドメイン用。本構成ではプライマリドメインがアプリ自身なので**入れるものが無い**(設定不要) | 手順1-5 |
| 本番でエラーが「Server Error」としか出ない | 素の `Error` を投げている箇所がある | 画面に出す文言は `ConvexError` で投げる(計画書の12章「初心者がハマりやすいポイント集」の #12) |
