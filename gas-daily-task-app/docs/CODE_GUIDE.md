# 🔧 まいにちタスク コード解説（はじめての人向け）

この資料では、アプリがどんなしくみで動いているかを、プログラミングが初めての人にもわかるように説明します。

---

## 1. 全体のしくみ

このアプリは、次の3つが協力して動いています。

```
 ┌──────────────┐   お願い（関数を呼ぶ）   ┌──────────────┐   読み書き   ┌──────────────────┐
 │  スマホの画面  │ ───────────────────▶ │   Code.gs     │ ──────────▶ │ スプレッドシート   │
 │ （index.html）│ ◀─────────────────── │ （Googleの    │ ◀────────── │（データの保存場所）│
 └──────────────┘      結果を返す         │  サーバー上）  │              └──────────────────┘
                                         │               │   質問       ┌──────────────────┐
                                         │               │ ──────────▶ │ AI（Gemini/OpenAI）│
                                         └──────────────┘ ◀────────── └──────────────────┘
                                                              コメント
```

レストランにたとえると…

| アプリの部品 | たとえ | 役割 |
|---|---|---|
| `index.html`（画面） | ホール係 | お客さん（あなた）の注文を聞いて、料理（結果）を見せる |
| `Code.gs`（サーバー） | 厨房 | 注文を受けて、倉庫から材料を出し入れし、料理を作る |
| スプレッドシート | 倉庫 | データ（グループ・タスク・記録）をしまっておく |
| AI | 専門の料理人 | 記録を見て、コメントという「特別料理」を作る |

---

## 2. データの保存方法（スプレッドシートの設計）

データは4つのシート（表）に分けて保存します。

### グループ シート
| グループID | グループ名 | 色 | 作成日時 |
|---|---|---|---|
| g1a2b3c4d | ヘルス管理 | #4f46e5 | 2026/09/27 10:00 |

### タスク シート
| タスクID | グループID | タスク名 | 並び順 | 作成日時 |
|---|---|---|---|---|
| t9f8e7d6c | g1a2b3c4d | ストレッチ10分 | 3 | … |

### 記録 シート
| 日付 | グループID | タスクID | 状況 | 更新日時 |
|---|---|---|---|---|
| 2026-09-27 | g1a2b3c4d | t9f8e7d6c | done | … |

### AIコメント シート
| 日付 | グループID | コメント | 作成者 | 作成日時 |
|---|---|---|---|---|
| 2026-09-27 | g1a2b3c4d | すばらしい一日でした！… | ai | … |

### ポイント：「ID」でつなぐ
タスク名を直接記録に書かず、**ID（背番号のようなもの）** で記録しています。
こうすると、タスク名を「ストレッチ10分」→「ストレッチ15分」に変えても、過去の記録はそのままつながります。

- `g` で始まるのがグループID、`t` で始まるのがタスクID です
- 先頭に文字を付けているのは、スプレッドシートが勝手に数字として扱わないようにするためです

### 状況の値
| 画面の表示 | 保存される値 |
|---|---|
| ✅ やった | `done` |
| 🔺 半分できた | `half` |
| ❌ やってない | `none` |
| （未記録） | 行が作られない |

---

## 3. `Code.gs`（サーバー側）の説明

`Code.gs` は、大きく5つのパートに分かれています。

### パート1：設定

```js
const MAX_TASKS_PER_GROUP = 10; // 1グループに登録できるタスクの最大数
const MAX_GROUPS = 10;          // 作成できるグループの最大数
```

`const` は「変わらない値に名前を付ける」という意味です。
たとえばタスクの上限を5個にしたければ、`10` を `5` に変えるだけでOKです。

`TABLES` には、4つのシートの名前と列の並びが書いてあります。
プログラムの中では英語の名前（`name` など）、スプレッドシートの見出しには日本語（`グループ名` など）を使うように対応づけています。

### パート2：Webアプリの入り口

```js
function doGet() {
  setup_();
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('まいにちタスク')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}
```

- `doGet` は **WebアプリのURLを開いたときに、GASが自動で呼ぶ特別な関数** です
- `setup_()` でシートがなければ作り、
- `index.html` を画面として返しています
- `viewport` の設定は「スマホの画面幅に合わせて表示してね」という指示です

`onOpen` はスプレッドシートを開いたときに自動で呼ばれ、メニューに「📋 タスクアプリ」を追加します。

### パート3：画面から呼ばれる関数

画面（index.html）から「これをして！」とお願いされる関数たちです。

| 関数 | やること |
|---|---|
| `getInitialData()` | 起動時に、グループ・タスク一覧と今日の日付などをまとめて返す |
| `saveGroup(input)` | グループを追加（IDなし）または名前変更（IDあり） |
| `deleteGroup(id)` | グループと、その中のタスク・記録・コメントを削除 |
| `saveTask(input)` | タスクを追加または名前変更。**10個を超えるとエラー** |
| `deleteTask(id)` | タスクと、その記録を削除 |
| `getDayRecords(groupId, date)` | ある日の記録とAIコメントを返す |
| `saveDayRecords(groupId, date, statusMap)` | ある日の記録を保存（登録・修正） |
| `deleteDayRecords(groupId, date)` | ある日の記録を削除 |
| `getMonthSummary(groupId, year, month)` | カレンダー・一覧表用に1か月分を集計（日ごと・タスクごと・タスク×日の表） |
| `generateAIComment(groupId, date)` | AIにコメントを作ってもらい保存 |

> 💡 GASでは、名前の最後に `_`（アンダースコア）が付いた関数は **画面から呼べない「裏方専用」** になります。
> 大事な処理を勝手に呼ばれないようにするための工夫です。

#### 例：タスクの10個制限

```js
const inGroup = rows.filter(r => String(r.groupId) === input.groupId);
if (inGroup.length >= MAX_TASKS_PER_GROUP) {
  throw new Error('タスクは1グループにつき' + MAX_TASKS_PER_GROUP + '個までです');
}
```

1. `filter` で「同じグループのタスクだけ」を取り出し
2. その数（`length`）が10以上なら
3. `throw new Error(...)` でエラーにして、追加をやめます。
   このメッセージは画面に「⚠️ タスクは1グループにつき10個までです」と表示されます。

画面側でも10個になると入力欄を使えなくしていますが、**サーバー側でもチェックする** のが安全なプログラムの基本です（画面のチェックだけだと、すり抜けられる可能性があるため）。

#### 例：記録の保存（登録と修正を同じしくみで）

```js
deleteRowsWhere_('records', r => String(r.groupId) === groupId && dateStr_(r.date) === date);
appendRows_('records', rows);
```

「その日の古い記録をいったん全部消して、新しい記録を書き直す」という方法です。
こうすると、**初めての登録も、あとからの修正も、同じ処理** で済みます。

### パート4：AIとの通信

```js
function callAI_(prompt) {
  ...
  res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post',
    headers: { 'x-goog-api-key': p.getProperty('GEMINI_API_KEY') },
    payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
    ...
  });
```

- `UrlFetchApp.fetch` は、**インターネット上の別のサービスに手紙を送る** 命令です
- 宛先（URL）はAIのサービス、手紙の中身（`payload`）はAIへの質問文（プロンプト）です
- APIキーは `PropertiesService`（スクリプトプロパティ）から読み出しています。**コードに直接書かないことで、キーが他人に見られるのを防ぎます**
- `GEMINI_API_KEY` があれば Gemini、なければ `OPENAI_API_KEY` で OpenAI を使います

#### プロンプト（AIへのお願い文）の工夫

`generateAIComment` では、AIに次のような文章を送っています。

```
あなたは、毎日の習慣づくりをやさしく応援するコーチです。
以下は「ヘルス管理」というグループのタスク記録です（対象日：2026-09-27）。

- 朝ごはんを食べる：この日＝やった／直近7日＝やった5回・半分1回・やっていない0回
- ストレッチ10分：この日＝やっていない／直近7日＝やった1回・半分0回・やっていない4回

この記録をもとに、次の条件で日本語のコメントを書いてください。
・できたことを具体的にほめる
・できなかったタスクがあれば、明日から試せる小さな工夫を1つだけ提案する
...
```

- **役割** を与える（やさしいコーチ）
- **材料** を渡す（その日の状況＋直近7日の回数）
- **条件** をはっきり書く（ほめる・工夫は1つ・150〜200文字）

こうすることで、毎回ちょうどよい長さ・雰囲気のコメントが返ってきやすくなります。

#### AIが使えないときの保険

```js
try {
  text = callAI_(prompt);
} catch (e) { ... }
if (!text) {
  text = ruleComment_(tasks, today);
  source = 'rule';
}
```

APIキーがない・通信エラーなどでAIが使えないときは、`ruleComment_` が
「達成度が80%以上なら〇〇」といった **決まったルールでコメントを作ります**。
そのため、AIがなくてもアプリは止まりません。

### パート5：スプレッドシートを扱う裏方の関数

| 関数 | やること |
|---|---|
| `ss_()` | 使うスプレッドシートを取得 |
| `setup_()` | シートがなければ作り、初回はサンプルを入れる |
| `readRows_(key)` | シートの全行を読み込み、`{ name: 'ヘルス管理', ... }` のような形にする |
| `appendRows_(key, objs)` | 一番下に行を追加 |
| `updateRow_(key, obj)` | 1行を上書き |
| `deleteRowsWhere_(key, 条件)` | 条件に合う行を削除（残す行だけを書き直す） |
| `withLock_(fn)` | 同時に2人が書き込んでもデータが壊れないよう「順番待ち」をする |
| `safeCell_(v)` | `=` で始まる文字が数式として動かないように守る |
| `dateStr_(v)` | 日付を `2026-09-27` の形の文字にそろえる |

#### `withLock_` はなぜ必要？

家族2人が同時に「保存」を押すと、2つの処理が同時にシートを書きかえて、データがおかしくなることがあります。
`LockService` を使うと、**1人ずつ順番に** 処理されるので安全です（トイレの鍵のようなイメージです）。

---

## 4. `index.html`（画面側）の説明

`index.html` は3つの部分でできています。

| 部分 | 書かれている場所 | 役割 |
|---|---|---|
| **HTML** | `<body>` の中 | 画面の「部品」（ボタン・入力欄など）を並べる |
| **CSS** | `<style>` の中 | 色・大きさ・配置など「見た目」を決める |
| **JavaScript** | `<script>` の中 | ボタンを押したときなどの「動き」を決める |

### スマホ向けの工夫（CSS）

- `max-width: 520px` … 画面が広くてもスマホ幅で表示
- 下のメニューは `position: fixed; bottom: 0` で **画面の下に固定**
- `env(safe-area-inset-bottom)` … iPhone の下の「ホームバー」とかぶらないように余白を取る
- ボタンの高さは最低 `44px` … 指でタップしやすい大きさ（Appleの推奨サイズ）
- 入力欄の文字は `16px` … iPhoneで入力時に画面が勝手に拡大されるのを防ぐ
- カレンダーは `display: grid; grid-template-columns: repeat(7, 1fr)` で **7列（日〜土）** に並べる

### JavaScript の流れ

#### ① アプリの状態 `S`

```js
const S = {
  groups: [], tasks: [],   // グループとタスクの一覧
  groupId: null,           // 今見ているグループ
  date: '',                // きろく画面で見ている日付
  status: {},              // 画面上の記録（まだ保存前のものを含む）
  saved: {},               // 保存済みの記録
  ...
};
```

「今どのグループの、どの日を見ているか」などを1か所にまとめています。
`status` と `saved` を比べることで、**保存していない変更があるか**（`isDirty()`）がわかります。

#### ② サーバーを呼ぶしくみ

```js
function api(name, ...args) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)[name](...args);
  });
}
```

- `google.script.run` は、**画面から `Code.gs` の関数を呼ぶための、GAS専用の命令** です
- 例：`run('saveDayRecords', groupId, date, status)` → Code.gs の `saveDayRecords` が動く
- `withSuccessHandler` は「成功したらこれをして」、`withFailureHandler` は「失敗したらこれをして」
- `run()` では、呼んでいる間は画面上部に読み込み中のバーを出し、エラーなら「⚠️」のお知らせを出します

#### ③ 画面を作る関数（render〜）

| 関数 | 作る画面 |
|---|---|
| `renderGroupTabs()` | 上のグループのタブ |
| `renderDay()` | きろく画面（達成度・タスクのボタン・AIコメント） |
| `renderCalendar(sum)` | カレンダーと月のまとめ |
| `renderTable(sum)` | 一覧表（タスク×日付）と今月のリズム |
| `renderSettings()` | せってい画面 |

データ（`S`）をもとに HTML の文字を組み立てて、`innerHTML` で画面に入れています。

```js
`<div class="task-name">${esc(t.name)}</div>`
```

`esc()` は、タスク名に `<` などの記号が入っていても、**画面が壊れたり悪いプログラムが動いたりしないように** 変換する安全対策です。

#### ④ ボタンを押したときの動き（bindEvents）

```js
$('recordBody').addEventListener('click', e => {
  const s = e.target.closest('button[data-task]');
  if (s) return setStatus(s.dataset.task, s.dataset.status);
  ...
});
```

- `addEventListener('click', ...)` で「クリックされたら〇〇する」を登録します
- ✅🔺❌ のボタンには `data-task`（どのタスクか）と `data-status`（どの状況か）を持たせてあり、押されたボタンからそれを読み取って `setStatus` を呼びます

#### ⑤ 保存していない変更の確認

```js
async function confirmLeave() {
  if (S.view !== 'record' || !isDirty()) return true;
  return dialog({ title: '保存していません', ... });
}
```

日付やグループ、画面を切り替えるときに、保存していない変更があれば確認のダイアログを出して、うっかり消えるのを防ぎます。

#### ⑥ 達成度とカレンダーの色

```js
function rateOf(c, taskCount) {
  return taskCount ? (c.done + c.half * 0.5) / taskCount : 0;
}
```

```js
cls = r >= 0.8 ? 'lv3' : r >= 0.5 ? 'lv2' : r > 0 ? 'lv1' : 'lv0';
```

達成度（0〜1）に応じて `lv3`（みどり）〜 `lv0`（あか）の名前を付け、CSSで色を変えています。

#### ⑦ 一覧表と「周期」の計算（analyzeTask）

サーバーの `getMonthSummary` は、一覧表のために `cells`（タスク×日の状況）も返します。

```js
cells: { 't9f8e7d6c': { 1: 'done', 2: 'half', 5: 'none', ... } }
```

画面側の `analyzeTask` が、1つのタスクについて月初めから今日まで1日ずつ見ていき、次のものを計算します。

```js
if (st === 'done' || st === 'half') { didDays.push(d); streak++; best = Math.max(best, streak); }
else streak = 0;
```

- **できた日** のリスト（`didDays`）… やった・半分の日
- **連続日数** … できた日なら `streak` を1増やし、できなかった日は0に戻す。いちばん大きかった値が「最長連続」
- **周期** …（最後にできた日 − 最初にできた日）÷（できた回数 − 1）＝ 平均で何日おきか
  例）1日・3日・5日・7日 → (7 − 1) ÷ 3 ＝ 2 → 「約2日に1回」
- **曜日ごとの達成度** … 曜日ごとに点数（やった1・半分0.5）を合計して、その曜日の日数で割る。
  いちばん良い曜日と悪い曜日の差が30ポイント以上なら「よくできる曜日」として表示

表の横スクロールでタスク名が左に残るのは、CSSの `position: sticky; left: 0;` のおかげです。

---

## 5. 1回の操作の流れ（例：記録を保存する）

```
あなた：「✅ やった」をタップ
  └ setStatus() … 画面上の S.status を変更し、renderDay() で画面を描きなおす
     （この時点ではまだスプレッドシートには保存されていない）

あなた：「💾 保存する」をタップ
  └ saveDay()
      └ run('saveDayRecords', グループID, 日付, 記録)   ← google.script.run でサーバーへ
          └ Code.gs の saveDayRecords()
              ├ withLock_ で順番待ち
              ├ その日の古い記録を削除（deleteRowsWhere_）
              └ 新しい記録を追加（appendRows_） → 「記録」シートに行が増える
      └ 成功したら S.saved を更新し「保存しました」と表示
```

---

## 6. カスタマイズのヒント

| やりたいこと | 変える場所 |
|---|---|
| タスクの上限を変えたい | `Code.gs` の `MAX_TASKS_PER_GROUP` |
| グループの色の候補を変えたい | `Code.gs` の `GROUP_COLORS` |
| 最初のサンプルを変えたい | `Code.gs` の `SAMPLE_GROUPS` |
| AIコメントの口調や長さを変えたい | `Code.gs` の `generateAIComment` の中の `prompt` |
| アプリの色を変えたい | `index.html` の `:root { --primary: ...}` など |
| カレンダーの色の基準を変えたい | `index.html` の `renderCalendar` の `r >= 0.8` など |
| 「半分」の点数を変えたい | `index.html` の `rateOf` と `SCORE` の `0.5` |
| 「よくできる曜日」の基準を変えたい | `index.html` の `analyzeTask` の `0.3` |

> 💡 変更したら、Apps Script で保存 → 「デプロイを管理」から **新しいバージョン** でデプロイしなおすと反映されます。
