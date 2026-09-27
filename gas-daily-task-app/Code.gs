/**
 * ============================================================
 *  まいにちタスク（日常タスク管理Webアプリ）
 *  サーバー側のプログラム（Google Apps Script）
 * ============================================================
 *  役割：
 *   - Webアプリの画面（index.html）を表示する
 *   - スプレッドシートへのデータの読み書き（登録・修正・削除）
 *   - AI（Gemini または OpenAI）にコメントを作ってもらう
 */

// ------------------------------------------------------------
// 1. 設定（ここの数字や文字を変えるとアプリの動きが変わります）
// ------------------------------------------------------------
const MAX_TASKS_PER_GROUP = 10; // 1グループに登録できるタスクの最大数
const MAX_GROUPS = 10;          // 作成できるグループの最大数
const STATUSES = ['done', 'half', 'none'];
const STATUS_LABEL = { done: 'やった', half: '半分できた', none: 'やっていない' };
const GROUP_COLORS = ['#4f46e5', '#0ea5e9', '#16a34a', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444'];

// スプレッドシートのシート構成
//   sheet  : シート名（スプレッドシートの下のタブに表示される名前）
//   fields : プログラムの中で使う列の名前
//   labels : スプレッドシートの1行目（見出し）に表示される名前
const TABLES = {
  groups: {
    sheet: 'グループ',
    fields: ['groupId', 'name', 'color', 'createdAt'],
    labels: ['グループID', 'グループ名', '色', '作成日時'],
  },
  tasks: {
    sheet: 'タスク',
    fields: ['taskId', 'groupId', 'name', 'order', 'createdAt'],
    labels: ['タスクID', 'グループID', 'タスク名', '並び順', '作成日時'],
  },
  records: {
    sheet: '記録',
    fields: ['date', 'groupId', 'taskId', 'status', 'updatedAt'],
    labels: ['日付', 'グループID', 'タスクID', '状況(done/half/none)', '更新日時'],
  },
  comments: {
    sheet: 'AIコメント',
    fields: ['date', 'groupId', 'comment', 'source', 'createdAt'],
    labels: ['日付', 'グループID', 'コメント', '作成者(ai/rule)', '作成日時'],
  },
};

// 初めて使うときに自動で作られるサンプルデータ
const SAMPLE_GROUPS = [
  { name: 'ヘルス管理', tasks: ['朝ごはんを食べる', '水を1.5L飲む', 'ストレッチ10分', '23時までに寝る'] },
  { name: '宿題・塾', tasks: ['学校の宿題', '塾の復習', '音読'] },
  { name: '家事', tasks: ['食器洗い', '洗濯物をたたむ', '部屋の片付け'] },
];

// ------------------------------------------------------------
// 2. Webアプリの入り口
// ------------------------------------------------------------

/** WebアプリのURLを開いたときに最初に動く関数 */
function doGet() {
  setup_();
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('まいにちタスク')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** スプレッドシートを開いたときにメニューを追加する */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📋 タスクアプリ')
    .addItem('初期設定（シートを作成）', 'setup')
    .addToUi();
}

/** 手動で初期設定をしたいときに実行する関数 */
function setup() {
  setup_();
  try {
    ss_().toast('シートの準備ができました', 'まいにちタスク');
  } catch (e) {
    // スプレッドシートを開いていない状態で実行した場合は何もしない
  }
}

// ------------------------------------------------------------
// 3. 画面（index.html）から呼び出される関数
//    ※ 名前の最後に「_」が付いていない関数だけが画面から呼べます
// ------------------------------------------------------------

/** 起動時に必要なデータをまとめて返す */
function getInitialData() {
  setup_();
  return Object.assign(snapshot_(), {
    today: todayStr_(),
    maxTasks: MAX_TASKS_PER_GROUP,
    maxGroups: MAX_GROUPS,
    aiEnabled: !!aiProvider_(),
  });
}

/** グループの追加（idなし）または名前の変更（idあり） */
function saveGroup(input) {
  return withLock_(() => {
    const name = cleanText_(input && input.name, 20, 'グループ名');
    const rows = readRows_('groups');
    if (input.id) {
      const row = rows.find(r => String(r.groupId) === input.id);
      if (!row) throw new Error('グループが見つかりません');
      row.name = name;
      updateRow_('groups', row);
    } else {
      if (rows.length >= MAX_GROUPS) throw new Error('グループは' + MAX_GROUPS + '個までです');
      appendRows_('groups', [{
        groupId: newId_('g'),
        name: name,
        color: GROUP_COLORS[rows.length % GROUP_COLORS.length],
        createdAt: new Date(),
      }]);
    }
    return snapshot_();
  });
}

/** グループを削除（中のタスク・記録・AIコメントもまとめて削除） */
function deleteGroup(groupId) {
  return withLock_(() => {
    const same = r => String(r.groupId) === groupId;
    deleteRowsWhere_('groups', same);
    deleteRowsWhere_('tasks', same);
    deleteRowsWhere_('records', same);
    deleteRowsWhere_('comments', same);
    return snapshot_();
  });
}

/** タスクの追加（idなし）または名前の変更（idあり） */
function saveTask(input) {
  return withLock_(() => {
    const name = cleanText_(input && input.name, 30, 'タスク名');
    const rows = readRows_('tasks');
    if (input.id) {
      const row = rows.find(r => String(r.taskId) === input.id);
      if (!row) throw new Error('タスクが見つかりません');
      row.name = name;
      updateRow_('tasks', row);
    } else {
      const groupExists = readRows_('groups').some(r => String(r.groupId) === input.groupId);
      if (!groupExists) throw new Error('グループが見つかりません');
      const inGroup = rows.filter(r => String(r.groupId) === input.groupId);
      if (inGroup.length >= MAX_TASKS_PER_GROUP) {
        throw new Error('タスクは1グループにつき' + MAX_TASKS_PER_GROUP + '個までです');
      }
      const maxOrder = inGroup.reduce((m, r) => Math.max(m, Number(r.order) || 0), 0);
      appendRows_('tasks', [{
        taskId: newId_('t'),
        groupId: input.groupId,
        name: name,
        order: maxOrder + 1,
        createdAt: new Date(),
      }]);
    }
    return snapshot_();
  });
}

/** タスクを削除（そのタスクの記録も削除） */
function deleteTask(taskId) {
  return withLock_(() => {
    const same = r => String(r.taskId) === taskId;
    deleteRowsWhere_('tasks', same);
    deleteRowsWhere_('records', same);
    return snapshot_();
  });
}

/** ある日の記録とAIコメントを取り出す */
function getDayRecords(groupId, date) {
  validateDate_(date);
  const status = {};
  readRows_('records').forEach(r => {
    if (String(r.groupId) === groupId && dateStr_(r.date) === date) {
      status[String(r.taskId)] = String(r.status);
    }
  });
  const c = readRows_('comments').find(r => String(r.groupId) === groupId && dateStr_(r.date) === date);
  return {
    date: date,
    status: status,
    comment: c ? { text: String(c.comment), source: String(c.source) } : null,
  };
}

/**
 * ある日の記録を保存する（登録・修正）
 * statusMap の例： { "a1b2c3d4": "done", "e5f6g7h8": "half" }
 * その日の古い記録をいったん消して、新しい内容で書き直します。
 */
function saveDayRecords(groupId, date, statusMap) {
  return withLock_(() => {
    validateDate_(date);
    const taskIds = new Set(listTasks_().filter(t => t.groupId === groupId).map(t => t.id));
    if (!taskIds.size) throw new Error('このグループにはタスクがありません');

    const now = new Date();
    const rows = [];
    Object.keys(statusMap || {}).forEach(taskId => {
      const s = statusMap[taskId];
      if (taskIds.has(taskId) && STATUSES.indexOf(s) >= 0) {
        rows.push({ date: date, groupId: groupId, taskId: taskId, status: s, updatedAt: now });
      }
    });

    deleteRowsWhere_('records', r => String(r.groupId) === groupId && dateStr_(r.date) === date);
    appendRows_('records', rows);
    return { saved: rows.length };
  });
}

/** ある日の記録（とAIコメント）を削除する */
function deleteDayRecords(groupId, date) {
  return withLock_(() => {
    validateDate_(date);
    const sameDay = r => String(r.groupId) === groupId && dateStr_(r.date) === date;
    const count = deleteRowsWhere_('records', sameDay);
    deleteRowsWhere_('comments', sameDay);
    return { deleted: count };
  });
}

/** カレンダー用：1か月分の記録を日ごと・タスクごとに集計する */
function getMonthSummary(groupId, year, month) {
  const prefix = year + '-' + pad2_(month) + '-';
  const tasks = listTasks_().filter(t => t.groupId === groupId);
  const days = {};
  const perTask = {};
  tasks.forEach(t => { perTask[t.id] = { done: 0, half: 0, none: 0 }; });

  readRows_('records').forEach(r => {
    const d = dateStr_(r.date);
    const tid = String(r.taskId);
    const s = String(r.status);
    if (String(r.groupId) !== groupId || d.indexOf(prefix) !== 0) return;
    if (!perTask[tid] || STATUSES.indexOf(s) < 0) return;
    days[d] = days[d] || { done: 0, half: 0, none: 0 };
    days[d][s]++;
    perTask[tid][s]++;
  });

  return { year: year, month: month, taskCount: tasks.length, days: days, perTask: perTask };
}

/** AIに記録を見てもらい、コメントを作って保存する */
function generateAIComment(groupId, date) {
  validateDate_(date);
  const group = listGroups_().find(g => g.id === groupId);
  if (!group) throw new Error('グループが見つかりません');
  const tasks = listTasks_().filter(t => t.groupId === groupId);
  if (!tasks.length) throw new Error('このグループにはタスクがありません');

  // その日の状況と、直近7日間の集計を作る
  const from = addDays_(date, -6);
  const today = {};
  const week = {};
  tasks.forEach(t => { week[t.id] = { done: 0, half: 0, none: 0 }; });
  readRows_('records').forEach(r => {
    const d = dateStr_(r.date);
    const tid = String(r.taskId);
    const s = String(r.status);
    if (String(r.groupId) !== groupId || !week[tid] || STATUSES.indexOf(s) < 0) return;
    if (d === date) today[tid] = s;
    if (d >= from && d <= date) week[tid][s]++;
  });

  const lines = tasks.map(t => {
    const w = week[t.id];
    return '- ' + t.name + '：この日＝' + (today[t.id] ? STATUS_LABEL[today[t.id]] : '未記録') +
      '／直近7日＝やった' + w.done + '回・半分' + w.half + '回・やっていない' + w.none + '回';
  });

  const prompt = [
    'あなたは、毎日の習慣づくりをやさしく応援するコーチです。',
    '以下は「' + group.name + '」というグループのタスク記録です（対象日：' + date + '）。',
    '',
    lines.join('\n'),
    '',
    'この記録をもとに、次の条件で日本語のコメントを書いてください。',
    '・できたことを具体的にほめる',
    '・できなかったタスクがあれば、明日から試せる小さな工夫を1つだけ提案する',
    '・直近7日の傾向にもひとことふれる',
    '・子どもから大人まで読める、やさしい言葉づかいにする',
    '・全体で150〜200文字。見出しや箇条書きは使わない',
  ].join('\n');

  let text = null;
  let source = 'ai';
  try {
    text = callAI_(prompt);
  } catch (e) {
    console.warn('AI呼び出しに失敗しました: ' + e);
  }
  if (!text) {
    text = ruleComment_(tasks, today);
    source = 'rule';
  }

  withLock_(() => {
    deleteRowsWhere_('comments', r => String(r.groupId) === groupId && dateStr_(r.date) === date);
    appendRows_('comments', [{ date: date, groupId: groupId, comment: text, source: source, createdAt: new Date() }]);
  });
  return { text: text, source: source };
}

// ------------------------------------------------------------
// 4. AI（生成AI）との通信
// ------------------------------------------------------------

/** どのAIを使うか（スクリプトプロパティに登録されたAPIキーで判断） */
function aiProvider_() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('GEMINI_API_KEY')) return 'gemini';
  if (p.getProperty('OPENAI_API_KEY')) return 'openai';
  return null;
}

/** AIに文章（プロンプト）を送り、返事の文章を受け取る */
function callAI_(prompt) {
  const p = PropertiesService.getScriptProperties();
  const provider = aiProvider_();
  if (!provider) return null;

  let res;
  if (provider === 'gemini') {
    const model = p.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
    res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': p.getProperty('GEMINI_API_KEY') },
      payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true,
    });
  } else {
    const model = p.getProperty('OPENAI_MODEL') || 'gpt-4o-mini';
    res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + p.getProperty('OPENAI_API_KEY') },
      payload: JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }] }),
      muteHttpExceptions: true,
    });
  }

  if (res.getResponseCode() !== 200) {
    throw new Error(provider + ' API エラー ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }
  const json = JSON.parse(res.getContentText());
  const text = provider === 'gemini'
    ? (((json.candidates || [])[0] || {}).content || { parts: [] }).parts.map(x => x.text || '').join('')
    : (((json.choices || [])[0] || {}).message || {}).content || '';
  return text.trim() || null;
}

/** AIが使えないときの「ルールで作るコメント」 */
function ruleComment_(tasks, today) {
  if (!Object.keys(today).length) {
    return 'まだこの日の記録がありません。できたこと・できなかったことを登録してみましょう。記録するだけでも、習慣づくりの大きな一歩です。';
  }
  const done = tasks.filter(t => today[t.id] === 'done');
  const half = tasks.filter(t => today[t.id] === 'half');
  const notYet = tasks.filter(t => today[t.id] !== 'done' && today[t.id] !== 'half');
  const rate = (done.length + half.length * 0.5) / tasks.length;
  let msg;
  if (rate >= 0.8) msg = 'すばらしい一日でした！この調子で続けていきましょう。';
  else if (rate >= 0.5) msg = 'よくがんばりました。半分以上できていますね。';
  else if (rate > 0) msg = '少しずつでも前に進んでいます。できたことを大切にしましょう。';
  else msg = '今日はお休みの日だったかもしれませんね。明日また一つからはじめましょう。';
  if (done.length) msg += '「' + done.slice(0, 2).map(t => t.name).join('」「') + '」ができたのはとても良いですね。';
  if (notYet.length) msg += '明日は「' + notYet[0].name + '」を、時間を決めて少しだけやってみるのがおすすめです。';
  msg += '（※AIキー未設定のため、自動メッセージです）';
  return msg;
}

// ------------------------------------------------------------
// 5. スプレッドシートを扱うための便利な関数（裏方）
// ------------------------------------------------------------

let ss__ = null; // 一度取得したスプレッドシートを覚えておく（高速化のため）
let tz__ = null;  // スプレッドシートのタイムゾーン（例：Asia/Tokyo）

/** 使うスプレッドシートを取得する */
function ss_() {
  if (ss__) return ss__;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  ss__ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss__) throw new Error('スプレッドシートが見つかりません。スクリプトプロパティ SPREADSHEET_ID を設定してください');
  return ss__;
}

function tz_() {
  return tz__ || (tz__ = ss_().getSpreadsheetTimeZone());
}

/** 必要なシートがなければ作る。初回はサンプルデータも入れる */
function setup_() {
  const groupsCreated = ensureSheet_('groups').created;
  ensureSheet_('tasks');
  ensureSheet_('records');
  ensureSheet_('comments');
  if (groupsCreated && readRows_('groups').length === 0) {
    SAMPLE_GROUPS.forEach((g, i) => {
      const groupId = newId_('g');
      appendRows_('groups', [{ groupId: groupId, name: g.name, color: GROUP_COLORS[i], createdAt: new Date() }]);
      appendRows_('tasks', g.tasks.map((name, j) => ({
        taskId: newId_('t'), groupId: groupId, name: name, order: j + 1, createdAt: new Date(),
      })));
    });
  }
}

/** シートを取得（なければ見出し付きで新しく作る） */
function ensureSheet_(key) {
  const t = TABLES[key];
  const ss = ss_();
  let sh = ss.getSheetByName(t.sheet);
  let created = false;
  if (!sh) {
    sh = ss.insertSheet(t.sheet);
    sh.getRange(1, 1, 1, t.labels.length).setValues([t.labels]).setFontWeight('bold').setBackground('#eef2ff');
    sh.setFrozenRows(1);
    // 1列目（ID や 日付）を「文字列」として保存し、勝手に日付や数値に変換されないようにする
    sh.getRange('A:A').setNumberFormat('@');
    created = true;
  }
  return { sh: sh, created: created };
}

/** シートの全データを { 列名: 値 } の形で読み込む */
function readRows_(key) {
  const t = TABLES[key];
  const sh = ensureSheet_(key).sh;
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, t.fields.length).getValues().map((r, i) => {
    const o = { _row: i + 2 }; // _row = スプレッドシート上の行番号
    t.fields.forEach((f, j) => { o[f] = r[j]; });
    return o;
  });
}

/** シートの一番下に行を追加する */
function appendRows_(key, objs) {
  if (!objs.length) return;
  const t = TABLES[key];
  const sh = ensureSheet_(key).sh;
  const start = sh.getLastRow() + 1;
  const need = start + objs.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  sh.getRange(start, 1, objs.length, t.fields.length)
    .setValues(objs.map(o => t.fields.map(f => safeCell_(o[f]))));
}

/** 1行を上書きする */
function updateRow_(key, obj) {
  const t = TABLES[key];
  ensureSheet_(key).sh.getRange(obj._row, 1, 1, t.fields.length).setValues([t.fields.map(f => safeCell_(obj[f]))]);
}

/** 条件に合う行を削除する（残す行だけを書き直す方式） */
function deleteRowsWhere_(key, predicate) {
  const t = TABLES[key];
  const sh = ensureSheet_(key).sh;
  const rows = readRows_(key);
  const keep = rows.filter(r => !predicate(r));
  if (keep.length === rows.length) return 0;
  sh.getRange(2, 1, rows.length, t.fields.length).clearContent();
  if (keep.length) {
    sh.getRange(2, 1, keep.length, t.fields.length).setValues(keep.map(o => t.fields.map(f => safeCell_(o[f]))));
  }
  return rows.length - keep.length;
}

/**
 * セルに書き込む値を安全な形にする
 * 「=」「+」「-」「@」で始まる文字は数式として扱われてしまうため、
 * 先頭に ' を付けて「ただの文字」として保存する（' はセルには表示されません）
 */
function safeCell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

/** グループ一覧（画面に送る形） */
function listGroups_() {
  return readRows_('groups').map(r => ({
    id: String(r.groupId), name: String(r.name), color: String(r.color || GROUP_COLORS[0]),
  }));
}

/** タスク一覧（並び順で並べ替え） */
function listTasks_() {
  return readRows_('tasks')
    .map(r => ({ id: String(r.taskId), groupId: String(r.groupId), name: String(r.name), order: Number(r.order) || 0 }))
    .sort((a, b) => a.order - b.order);
}

/** グループとタスクをまとめて返す */
function snapshot_() {
  return { groups: listGroups_(), tasks: listTasks_() };
}

/** 同時に書き込んでデータが壊れないように、順番待ちをする */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** 入力された文字のチェックと整形 */
function cleanText_(value, maxLen, label) {
  let s = String(value || '').replace(/\s+/g, ' ').trim();
  if (!s) throw new Error(label + 'を入力してください');
  if (s.length > maxLen) throw new Error(label + 'は' + maxLen + '文字以内にしてください');
  return s;
}

/** 日付の形（2026-09-27 のような形）かチェック */
function validateDate_(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('日付の形式が正しくありません');
}

/** セルの値を「yyyy-MM-dd」の文字に変換する */
function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return String(v);
}

/** 今日の日付を「yyyy-MM-dd」で返す */
function todayStr_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

/** 「yyyy-MM-dd」の日付に n 日足す */
function addDays_(date, n) {
  const p = date.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

function pad2_(n) {
  return ('0' + n).slice(-2);
}

/** 重複しにくい短いIDを作る（例：g1a2b3c4d）。先頭に文字を付けて数値に変換されないようにする */
function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}
