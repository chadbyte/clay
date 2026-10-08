var fs = require('node:fs');
var path = require('node:path');
function salt(body) { return '@startsalt\n' + body + '\n@endsalt'; }
var cases = [];
function add(id, body, scope) { cases.push({ id: id, scope: scope || 'supported', source: salt(body) }); }
add('widgets', '{\nPlain label\n[Continue]\n() Unselected\n(X) Selected\n[] Disabled\n[X] Enabled\n"Email address    "\n^Choose team^\n}');
add('control-sizing', '{+\nLong label to widen the column\n[OK]\n"Input"\n^Choice^\n}');
['', '+', '#', '!', '-'].forEach(function (style) {
  add('grid-' + ({ '': 'none', '+': 'outer', '#': 'all', '!': 'vertical', '-': 'horizontal' }[style]), '{' + style + '\nName | Status\nAlpha | Ready\nBeta | Waiting\n}');
});
add('group', '{^"Account"\nName | "Alex    "\n[X] Active | [Save]\n}');
add('untitled-group', '{^\nHeading\nBody\n[Action]\n}');
add('tabs-horizontal', '{+\n{/ <b>Overview | Settings | History }\nBody\n[Close]\n}');
add('tabs-vertical', '{+\n{/ <b>Overview\nSettings\nHistory } | { Body\n[Close] }\n}');
add('menu', '{+\n{* File | Edit | Help }\nBody\n}');
add('separators', '{\nDotted\n..\nDouble\n==\nWave\n~~\nSolid\n--\n[End]\n}');
add('nested-columns', '{+\n{ Header | [Settings] }\n{ { Navigation\n[Projects]\n[Team] } | { Content\n{ Name | "Search     " }\n[Create] } }\n}');
add('ragged-grid', '{#\nA | B | C\nLong single row\nD | E\n}');
add('empty-cells', '{#\n. | Header\nRow | .\n.\n[End]\n}');
add('quoted-delimiters', '{\n"a | b { c }    "\n[Done]\n}', 'extension');
add('formatting', '{\n**Bold heading**\n<b>Bold HTML\n<i>Italic label\nNormal **bold** tail\nNormal <i>italic</i> tail\n}');
add('unicode', '{+\nCafe & Tea\nCafé naïve résumé\n日本語 中文\n[Save & close]\n}');
add('literal-angle-text', '{ "Email < > &    " }');
add('comments-spacers', '{\nFirst\n\' hidden comment\n.\nLast\n}');
cases.push({ id: 'uml-wrapper', scope: 'extension', source: '@startuml\nsalt\n{ [OK] }\n@enduml' });
cases.push({ id: 'whole-page', scope: 'supported', source: fs.readFileSync(path.join(__dirname, '../../docs/examples/clay-workbench.puml'), 'utf8') });
var skill = fs.readFileSync(path.join(__dirname, '../../lib/bundled-skills/clay-sketch/SKILL.md'), 'utf8');
cases.push({ id: 'skill-page', scope: 'supported', source: /```clay-sketch\n([\s\S]*?)\n```/.exec(skill)[1] });
add('expanded-tree', '{ {T\n+ Root\n++ Child\n} }');
add('expanded-span', '{#\nA | B\nWide | *\n}');
add('expanded-open-dropdown', '{ ^Choose^^One^^Two^ }');
add('expanded-scrollbar', '{SI\nContent\nMore\n}');
add('heldout-login', '{+\n**Sign in**\n{ Email | "user@example.com    "\nPassword | "********    " }\n{ [X] Remember me | [Sign in] }\n}');
add('heldout-empty-inputs', '{+\n"" | "     "\n[ A ] | [Cancel]\n^   ^\n}');
add('heldout-mixed-controls', '{#\n[Save **changes**] | "<i>Search</i>    "\n^Choose **team**^ | (X) <b>Selected</b> option\n}');
add('heldout-nested-titles', '{^"Settings"\n{^"Account"\nName | "User     "\n{^"Notifications"\n[] Email\n[X] In-app\n}\n}\n[Done]\n}');
add('heldout-emphasis', '{\n<b>Bold <i>both</i> bold</b> normal\nA **bold** word and **another**.\n**MMMM iii WWW**\n<i>Résumé café</i>\n}');
add('heldout-wide-table', '{#\n**Name** | **Role** | **Enabled**\nA | Administrator | [X]\nMuch longer label | Member | []\nShort\n}');
add('heldout-tabbed-form', '{+\n{* File | Settings | Help }\n{/ <b>Profile | Privacy }\n{ User | "Alex     "\nTeam | ^Engineering^ }\n..\n{ [Cancel] | [Save] }\n}');
add('heldout-cjk-form', '{+\n名前 | "田中    "\n都市 | ^東京^\n[保存] | [取消]\n}');
add('heldout-long-title', '{^"A very long group title beyond the short content"\nHi\n}');
add('heldout-tabs-newline', '{+\n{/ Overview | Settings\n}\nBody\n}');
// Additional combinations exercise behavior beyond the initial parity corpus.
['+', '#', '!', '-'].forEach(function (style) {
  add('expanded-ragged-' + ({ '+': 'outer', '#': 'all', '!': 'vertical', '-': 'horizontal' }[style]), '{' + style + '\nA | [Go] | .\nLonger row\n[] Check | ^Choice^\n}');
});
add('expanded-empty-layout', '{ }');
add('extension-root-tab', '{/ Home }', 'extension');
add('expanded-single-tab', '{ {/ Home } }');
add('extension-root-vertical-tab', '{/ Home\n}', 'extension');
add('expanded-single-vertical-tab', '{\n{/ Home\n}\n}');
add('expanded-tall-neighbor', '{#\n{ A\nB\nC\nD } | [OK] | "Field" | ^Pick^\n}');
add('expanded-separator-neighbor', '{#\n{ A\nB\nC } | -- | .. | == | ~~\n}');
add('expanded-format-title', '{^"<b>Account</b> settings"\nName | "User    "\n}');
add('expanded-adjacent-emphasis', '{\n<b>A</b><i>B</i>C\n<i>One <b>two</b> three</i> four\n<b>A</b> <b>B</b>\n}');
add('expanded-control-labels', '{\n[]\n[X]\n()\n(X)\n[x] lower\n(x) lower\n[ ] unchecked\n( ) unchecked\n}');
add('expanded-punctuation', '{\nA & B < C > D\n© 2026 — €42 ± 5%\n[Save & exit]\n}');
add('expanded-script-labels', '{\nΕλληνικά\nРусский\n한국어\n}');
add('expanded-nested-menus', '{+\n{* <b>File | Edit | Help }\n{ {^"Sidebar"\nOverview\nProjects\n} | {^"Details"\n{/ Summary | Activity }\nText\n[Open]\n} }\n}');
add('expanded-whitespace', '{\n"   padded   "\n[   Go   ]\n^  Choice  ^\n}');
add('expanded-single-glyphs', '{#\ni | W | é | 日\n<b>i</b> | <i>W</i> | . | [Y]\n}');
add('expanded-empty-group', '{^"Empty group"\n}');
add('expanded-many-rows', '{#\n' + Array.from({ length: 24 }, function (_, i) { return 'Row ' + i + ' | [Action] | [X] Ready'; }).join('\n') + '\n}');
add('expanded-many-columns', '{#\n' + Array.from({ length: 16 }, function (_, i) { return 'C' + i; }).join(' | ') + '\n' + Array(16).fill('[Go]').join(' | ') + '\n}');
require('./salt-official/manifest.json').cases.forEach(function (item) {
  cases.push({ id: item.id, scope: item.scope, source: fs.readFileSync(path.join(__dirname, 'salt-official', item.sourceFile), 'utf8') });
});
module.exports = cases;
