// sidebar-projects.js - Project icon strip, context menus, emoji picker, drag-and-drop, worktree modal
// Extracted from sidebar.js (PR-36)

import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { openProjectSettings } from './project-settings.js';
import { triggerShare } from './qrcode.js';
import { parseEmojis } from './markdown.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { closeSidebar } from './sidebar.js';
import { showIconTooltip, hideIconTooltip, closeUserCtxMenu, getCurrentDmUserId } from './sidebar-mates.js';
import { switchProject, openAddProjectModal, getCachedProjects } from './app-projects.js';
import { showHomeHub } from './app-home-hub.js';
import { getPendingTuiAttention } from './app-notifications.js';
import { isExternalWorktree, externalWorktreeTooltip, appendExternalWorktreeBadge } from './worktree-location.js';
import { groupProjects } from './project-grouping.js';
import { showProjectAccessPopover } from './project-access.js';

// --- Project state ---
var cachedProjectList = [];
var cachedCurrentSlug = null;

// --- Project context menu ---
var projectCtxMenu = null;

// --- Emoji picker ---
var emojiPickerEl = null;

// --- Drag-and-drop state ---
var draggedSlug = null;
var draggedEl = null;

// --- Worktree folder collapse state (session-local) ---
var wtCollapsed = {};

var EMOJI_CATEGORIES = [
  { id: "frequent", icon: "🕐", label: "Frequent", emojis: [
    "😀","😎","🤓","🧠","💡","🔥","⚡","🚀",
    "🎯","🎮","🎨","🎵","📦","📁","📝","💻",
    "🖥️","⌨️","🔧","🛠️","⚙️","🧪","🔬","🧬",
    "🌍","🌱","🌊","🌸","🍀","🌈","☀️","🌙",
    "🐱","🐶","🐼","🦊","🦋","🐝","🐙","🦄",
    "🍕","🍔","☕","🍩","🍎","🍇","🧁","🍣",
    "❤️","💜","💙","💚","💛","🧡","🤍","🖤",
    "⭐","✨","💎","🏆","👑","🎪","🎭","🃏",
  ]},
  { id: "smileys", icon: "😀", label: "Smileys & People", emojis: [
    "😀","😃","😄","😁","😆","😅","🤣","😂",
    "🙂","😊","😇","🥰","😍","🤩","😘","😗",
    "😚","😙","🥲","😋","😛","😜","🤪","😝",
    "🤑","🤗","🤭","🫢","🤫","🤔","🫡","🤐",
    "🤨","😐","😑","😶","🫥","😏","😒","🙄",
    "😬","🤥","😌","😔","😪","🤤","😴","😷",
    "🤒","🤕","🤢","🤮","🥴","😵","🤯","🥳",
    "🥸","😎","🤓","🧐","😕","🫤","😟","🙁",
    "😮","😯","😲","😳","🥺","🥹","😦","😧",
    "😨","😰","😥","😢","😭","😱","😖","😣",
    "😞","😓","😩","😫","🥱","😤","😡","😠",
    "🤬","😈","👿","💀","☠️","💩","🤡","👹",
    "👺","👻","👽","👾","🤖","😺","😸","😹",
    "😻","😼","😽","🙀","😿","😾","🙈","🙉",
    "🙊","👋","🤚","🖐️","✋","🖖","🫱","🫲",
    "🫳","🫴","👌","🤌","🤏","✌️","🤞","🫰",
    "🤟","🤘","🤙","👈","👉","👆","🖕","👇",
    "☝️","🫵","👍","👎","✊","👊","🤛","🤜",
    "👏","🙌","🫶","👐","🤲","🤝","🙏","💪",
  ]},
  { id: "animals", icon: "🐻", label: "Animals & Nature", emojis: [
    "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼",
    "🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐽","🐸",
    "🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦",
    "🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺",
    "🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌",
    "🐞","🐜","🪰","🪲","🪳","🦟","🦗","🕷️",
    "🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑",
    "🦐","🦞","🦀","🪸","🐡","🐠","🐟","🐬",
    "🐳","🐋","🦈","🐊","🐅","🐆","🦓","🫏",
    "🦍","🦧","🦣","🐘","🦛","🦏","🐪","🐫",
    "🦒","🦘","🦬","🐃","🐂","🐄","🐎","🐖",
    "🐏","🐑","🦙","🐐","🦌","🫎","🐕","🐩",
    "🦮","🐕‍🦺","🐈","🐈‍⬛","🪶","🐓","🦃","🦤",
    "🦚","🦜","🦢","🪿","🦩","🕊️","🐇","🦝",
    "🦨","🦡","🦫","🦦","🦥","🐁","🐀","🐿️",
    "🦔","🌵","🎄","🌲","🌳","🌴","🪵","🌱",
    "🌿","☘️","🍀","🎍","🪴","🎋","🍃","🍂",
    "🍁","🪺","🪹","🍄","🌾","💐","🌷","🌹",
    "🥀","🪻","🌺","🌸","🌼","🌻","🌞","🌝",
    "🌛","🌜","🌚","🌕","🌖","🌗","🌘","🌑",
    "🌒","🌓","🌔","🌙","🌎","🌍","🌏","🪐",
    "💫","⭐","🌟","✨","⚡","☄️","💥","🔥",
    "🌪️","🌈","☀️","🌤️","⛅","🌥️","☁️","🌦️",
    "🌧️","⛈️","🌩️","❄️","☃️","⛄","🌬️","💨",
    "💧","💦","🫧","☔","☂️","🌊","🌫️",
  ]},
  { id: "food", icon: "🍔", label: "Food & Drink", emojis: [
    "🍇","🍈","🍉","🍊","🍋","🍌","🍍","🥭",
    "🍎","🍏","🍐","🍑","🍒","🍓","🫐","🥝",
    "🍅","🫒","🥥","🥑","🍆","🥔","🥕","🌽",
    "🌶️","🫑","🥒","🥬","🥦","🧄","🧅","🥜",
    "🫘","🌰","🫚","🫛","🍞","🥐","🥖","🫓",
    "🥨","🥯","🥞","🧇","🧀","🍖","🍗","🥩",
    "🥓","🍔","🍟","🍕","🌭","🥪","🌮","🌯",
    "🫔","🥙","🧆","🥚","🍳","🥘","🍲","🫕",
    "🥣","🥗","🍿","🧈","🧂","🥫","🍱","🍘",
    "🍙","🍚","🍛","🍜","🍝","🍠","🍢","🍣",
    "🍤","🍥","🥮","🍡","🥟","🥠","🥡","🦀",
    "🦞","🦐","🦑","🦪","🍦","🍧","🍨","🍩",
    "🍪","🎂","🍰","🧁","🥧","🍫","🍬","🍭",
    "🍮","🍯","🍼","🥛","☕","🫖","🍵","🍶",
    "🍾","🍷","🍸","🍹","🍺","🍻","🥂","🥃",
    "🫗","🥤","🧋","🧃","🧉","🧊",
  ]},
  { id: "activity", icon: "⚽", label: "Activity", emojis: [
    "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉",
    "🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍",
    "🏏","🪃","🥅","⛳","🪁","🛝","🏹","🎣",
    "🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸️",
    "🥌","🎿","⛷️","🏂","🪂","🏋️","🤸","🤺",
    "⛹️","🤾","🏌️","🏇","🧘","🏄","🏊","🤽",
    "🚣","🧗","🚵","🚴","🎪","🤹","🎭","🎨",
    "🎬","🎤","🎧","🎼","🎹","🥁","🪘","🎷",
    "🎺","🪗","🎸","🪕","🎻","🪈","🎲","♟️",
    "🎯","🎳","🎮","🕹️","🧩","🪩",
  ]},
  { id: "travel", icon: "🚗", label: "Travel & Places", emojis: [
    "🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑",
    "🚒","🚐","🛻","🚚","🚛","🚜","🛵","🏍️",
    "🛺","🚲","🛴","🛹","🚏","🛣️","🛤️","⛽",
    "🛞","🚨","🚥","🚦","🛑","🚧","⚓","🛟",
    "⛵","🛶","🚤","🛳️","⛴️","🛥️","🚢","✈️",
    "🛩️","🛫","🛬","🪂","💺","🚁","🚟","🚠",
    "🚡","🛰️","🚀","🛸","🏠","🏡","🏘️","🏚️",
    "🏗️","🏭","🏢","🏬","🏣","🏤","🏥","🏦",
    "🏨","🏪","🏫","🏩","💒","🏛️","⛪","🕌",
    "🛕","🕍","⛩️","🕋","⛲","⛺","🌁","🌃",
    "🏙️","🌄","🌅","🌆","🌇","🌉","🗼","🗽",
    "🗻","🏕️","🎠","🎡","🎢","🏖️","🏝️","🏜️",
    "🌋","⛰️","🗺️","🧭","🏔️",
  ]},
  { id: "objects", icon: "💡", label: "Objects", emojis: [
    "⌚","📱","📲","💻","⌨️","🖥️","🖨️","🖱️",
    "🖲️","🕹️","🗜️","💽","💾","💿","📀","📼",
    "📷","📸","📹","🎥","📽️","🎞️","📞","☎️",
    "📟","📠","📺","📻","🎙️","🎚️","🎛️","🧭",
    "⏱️","⏲️","⏰","🕰️","⌛","⏳","📡","🔋",
    "🪫","🔌","💡","🔦","🕯️","🪔","🧯","🛢️",
    "🛍️","💰","💴","💵","💶","💷","🪙","💸",
    "💳","🧾","💹","✉️","📧","📨","📩","📤",
    "📥","📦","📫","📬","📭","📮","🗳️","✏️",
    "✒️","🖋️","🖊️","🖌️","🖍️","📝","💼","📁",
    "📂","🗂️","📅","📆","🗒️","🗓️","📇","📈",
    "📉","📊","📋","📌","📍","📎","🖇️","📏",
    "📐","✂️","🗃️","🗄️","🗑️","🔒","🔓","🔏",
    "🔐","🔑","🗝️","🔨","🪓","⛏️","⚒️","🛠️",
    "🗡️","⚔️","💣","🪃","🏹","🛡️","🪚","🔧",
    "🪛","🔩","⚙️","🗜️","⚖️","🦯","🔗","⛓️",
    "🪝","🧰","🧲","🪜","⚗️","🧪","🧫","🧬",
    "🔬","🔭","📡","💉","🩸","💊","🩹","🩼",
    "🩺","🩻","🚪","🛗","🪞","🪟","🛏️","🛋️",
    "🪑","🚽","🪠","🚿","🛁","🪤","🪒","🧴",
    "🧷","🧹","🧺","🧻","🪣","🧼","🫧","🪥",
    "🧽","🧯","🛒","🚬","⚰️","🪦","⚱️","🧿",
    "🪬","🗿","🪧","🪪",
  ]},
  { id: "symbols", icon: "❤️", label: "Symbols", emojis: [
    "❤️","🧡","💛","💚","💙","💜","🖤","🤍",
    "🤎","💔","❤️‍🔥","❤️‍🩹","❣️","💕","💞","💓",
    "💗","💖","💘","💝","💟","☮️","✝️","☪️",
    "🕉️","☸️","🪯","✡️","🔯","🕎","☯️","☦️",
    "🛐","⛎","♈","♉","♊","♋","♌","♍",
    "♎","♏","♐","♑","♒","♓","🆔","⚛️",
    "🉑","☢️","☣️","📴","📳","🈶","🈚","🈸",
    "🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️",
    "🈴","🈵","🈹","🈲","🅰️","🅱️","🆎","🆑",
    "🅾️","🆘","❌","⭕","🛑","⛔","📛","🚫",
    "💯","💢","♨️","🚷","🚯","🚳","🚱","🔞",
    "📵","🚭","❗","❕","❓","❔","‼️","⁉️",
    "🔅","🔆","〽️","⚠️","🚸","🔱","⚜️","🔰",
    "♻️","✅","🈯","💹","❇️","✳️","❎","🌐",
    "💠","Ⓜ️","🌀","💤","🏧","🚾","♿","🅿️",
    "🛗","🈳","🈂️","🛂","🛃","🛄","🛅","🚹",
    "🚺","🚼","⚧️","🚻","🚮","🎦","📶","🈁",
    "🔣","ℹ️","🔤","🔡","🔠","🆖","🆗","🆙",
    "🆒","🆕","🆓","0️⃣","1️⃣","2️⃣","3️⃣","4️⃣",
    "5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟","🔢","#️⃣",
    "*️⃣","⏏️","▶️","⏸️","⏯️","⏹️","⏺️","⏭️",
    "⏮️","⏩","⏪","⏫","⏬","◀️","🔼","🔽",
    "➡️","⬅️","⬆️","⬇️","↗️","↘️","↙️","↖️",
    "↕️","↔️","↩️","↪️","⤴️","⤵️","🔀","🔁",
    "🔂","🔄","🔃","🎵","🎶","✖️","➕","➖",
    "➗","🟰","♾️","💲","💱","™️","©️","®️",
    "〰️","➰","➿","🔚","🔙","🔛","🔝","🔜",
    "✔️","☑️","🔘","🔴","🟠","🟡","🟢","🔵",
    "🟣","⚫","⚪","🟤","🔺","🔻","🔸","🔹",
    "🔶","🔷","🔳","🔲","▪️","▫️","◾","◽",
    "◼️","◻️","🟥","🟧","🟨","🟩","🟦","🟪",
    "⬛","⬜","🟫","🔈","🔇","🔉","🔊","🔔",
    "🔕","📣","📢","👁️‍🗨️","💬","💭","🗯️","♠️",
    "♣️","♥️","♦️","🃏","🎴","🀄","🕐","🕑",
    "🕒","🕓","🕔","🕕","🕖","🕗","🕘","🕙","🕚","🕛",
  ]},
  { id: "flags", icon: "🏁", label: "Flags", emojis: [
    "🏁","🚩","🎌","🏴","🏳️","🏳️‍🌈","🏳️‍⚧️","🏴‍☠️",
    "🇦🇨","🇦🇩","🇦🇪","🇦🇫","🇦🇬","🇦🇮","🇦🇱","🇦🇲",
    "🇦🇴","🇦🇶","🇦🇷","🇦🇸","🇦🇹","🇦🇺","🇦🇼","🇦🇽",
    "🇦🇿","🇧🇦","🇧🇧","🇧🇩","🇧🇪","🇧🇫","🇧🇬","🇧🇭",
    "🇧🇮","🇧🇯","🇧🇱","🇧🇲","🇧🇳","🇧🇴","🇧🇶","🇧🇷",
    "🇧🇸","🇧🇹","🇧🇻","🇧🇼","🇧🇾","🇧🇿","🇨🇦","🇨🇨",
    "🇨🇩","🇨🇫","🇨🇬","🇨🇭","🇨🇮","🇨🇰","🇨🇱","🇨🇲",
    "🇨🇳","🇨🇴","🇨🇵","🇨🇷","🇨🇺","🇨🇻","🇨🇼","🇨🇽",
    "🇨🇾","🇨🇿","🇩🇪","🇩🇬","🇩🇯","🇩🇰","🇩🇲","🇩🇴",
    "🇩🇿","🇪🇦","🇪🇨","🇪🇪","🇪🇬","🇪🇭","🇪🇷","🇪🇸",
    "🇪🇹","🇪🇺","🇫🇮","🇫🇯","🇫🇰","🇫🇲","🇫🇴","🇫🇷",
    "🇬🇦","🇬🇧","🇬🇩","🇬🇪","🇬🇫","🇬🇬","🇬🇭","🇬🇮",
    "🇬🇱","🇬🇲","🇬🇳","🇬🇵","🇬🇶","🇬🇷","🇬🇸","🇬🇹",
    "🇬🇺","🇬🇼","🇬🇾","🇭🇰","🇭🇲","🇭🇳","🇭🇷","🇭🇹",
    "🇭🇺","🇮🇨","🇮🇩","🇮🇪","🇮🇱","🇮🇲","🇮🇳","🇮🇴",
    "🇮🇶","🇮🇷","🇮🇸","🇮🇹","🇯🇪","🇯🇲","🇯🇴","🇯🇵",
    "🇰🇪","🇰🇬","🇰🇭","🇰🇮","🇰🇲","🇰🇳","🇰🇵","🇰🇷",
    "🇰🇼","🇰🇾","🇰🇿","🇱🇦","🇱🇧","🇱🇨","🇱🇮","🇱🇰",
    "🇱🇷","🇱🇸","🇱🇹","🇱🇺","🇱🇻","🇱🇾","🇲🇦","🇲🇨",
    "🇲🇩","🇲🇪","🇲🇫","🇲🇬","🇲🇭","🇲🇰","🇲🇱","🇲🇲",
    "🇲🇳","🇲🇴","🇲🇵","🇲🇶","🇲🇷","🇲🇸","🇲🇹","🇲🇺",
    "🇲🇻","🇲🇼","🇲🇽","🇲🇾","🇲🇿","🇳🇦","🇳🇨","🇳🇪",
    "🇳🇫","🇳🇬","🇳🇮","🇳🇱","🇳🇴","🇳🇵","🇳🇷","🇳🇺",
    "🇳🇿","🇴🇲","🇵🇦","🇵🇪","🇵🇫","🇵🇬","🇵🇭","🇵🇰",
    "🇵🇱","🇵🇲","🇵🇳","🇵🇷","🇵🇸","🇵🇹","🇵🇼","🇵🇾",
    "🇶🇦","🇷🇪","🇷🇴","🇷🇸","🇷🇺","🇷🇼","🇸🇦","🇸🇧",
    "🇸🇨","🇸🇩","🇸🇪","🇸🇬","🇸🇭","🇸🇮","🇸🇯","🇸🇰",
    "🇸🇱","🇸🇲","🇸🇳","🇸🇴","🇸🇷","🇸🇸","🇸🇹","🇸🇻",
    "🇸🇽","🇸🇾","🇸🇿","🇹🇦","🇹🇨","🇹🇩","🇹🇫","🇹🇬",
    "🇹🇭","🇹🇯","🇹🇰","🇹🇱","🇹🇲","🇹🇳","🇹🇴","🇹🇷",
    "🇹🇹","🇹🇻","🇹🇼","🇹🇿","🇺🇦","🇺🇬","🇺🇲","🇺🇳",
    "🇺🇸","🇺🇾","🇺🇿","🇻🇦","🇻🇨","🇻🇪","🇻🇬","🇻🇮",
    "🇻🇳","🇻🇺","🇼🇫","🇼🇸","🇽🇰","🇾🇪","🇾🇹","🇿🇦",
    "🇿🇲","🇿🇼",
  ]},
];

export function initSidebarProjects() {

  // Close project ctx menu and emoji picker on document click
  document.addEventListener("click", function () {
    closeProjectCtxMenu();
    closeEmojiPicker();
  });

  // Initialize icon strip buttons
  var addBtn = document.getElementById("icon-strip-add");
  if (addBtn) {
    addBtn.addEventListener("click", function () {
      if (openAddProjectModal) {
        openAddProjectModal();
      } else {
        var modal = document.getElementById("add-project-modal");
        if (modal) modal.classList.remove("hidden");
      }
    });
    addBtn.addEventListener("mouseenter", function () { showIconTooltip(addBtn, "Add project"); });
    addBtn.addEventListener("mouseleave", hideIconTooltip);
  }

  var exploreBtn = document.getElementById("icon-strip-explore");
  if (exploreBtn) {
    exploreBtn.addEventListener("click", function () {
      var fileBrowserBtn = document.getElementById("file-browser-btn");
      if (fileBrowserBtn) fileBrowserBtn.click();
    });
    exploreBtn.addEventListener("mouseenter", function () { showIconTooltip(exploreBtn, "File browser"); });
    exploreBtn.addEventListener("mouseleave", hideIconTooltip);
  }

  // Tooltip + click for home icon
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) {
    homeIcon.addEventListener("mouseenter", function () { showIconTooltip(homeIcon, "Clay Studio"); });
    homeIcon.addEventListener("mouseleave", hideIconTooltip);
    homeIcon.addEventListener("click", function (e) {
      e.preventDefault();
      if (showHomeHub) showHomeHub();
    });
    homeIcon.style.cursor = "pointer";
  }

  // Chevron dropdown on project name
  var dropdownBtn = document.getElementById("title-bar-project-dropdown");
  if (dropdownBtn) {
    dropdownBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var current = null;
      for (var i = 0; i < cachedProjectList.length; i++) {
        if (cachedProjectList[i].slug === cachedCurrentSlug) {
          current = cachedProjectList[i];
          break;
        }
      }
      if (!current) return;

      if (projectCtxMenu) {
        closeProjectCtxMenu();
        dropdownBtn.classList.remove("open");
        return;
      }
      dropdownBtn.classList.add("open");
      showProjectCtxMenu(dropdownBtn, current.slug, current.name, current.icon, "below");
      var observer = new MutationObserver(function () {
        if (!projectCtxMenu) {
          dropdownBtn.classList.remove("open");
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true });
    });
  }

  return {
    renderIconStrip: renderIconStrip,
    renderProjectList: renderProjectList,
    updateBadge: updateProjectBadge,
    getEmojiCategories: getEmojiCategories
  };
}

// --- Getters for cached state (used by mobile sheet in sidebar.js) ---
export function getCachedProjectList() { return cachedProjectList; }
export function getCachedCurrentSlug() { return cachedCurrentSlug; }

function getProjectAbbrev(name) {
  if (!name) return "?";
  var words = name.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

export { getProjectAbbrev };

// --- Project context menu ---

export function closeProjectCtxMenu() {
  if (projectCtxMenu) {
    projectCtxMenu.remove();
    projectCtxMenu = null;
  }
}

function showIconCtxMenu(anchorEl, slug, name, options) {
  closeProjectCtxMenu();
  if (closeUserCtxMenu) closeUserCtxMenu();
  closeEmojiPicker();

  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  var isWorktree = slug.indexOf("--") !== -1;

  var iconItem = document.createElement("button");
  iconItem.className = "project-ctx-item";
  iconItem.innerHTML = iconHtml("smile") + " <span>Set Icon</span>";
  iconItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeProjectCtxMenu();
    showEmojiPicker(slug, anchorEl);
  });
  menu.appendChild(iconItem);

  if (isWorktree) {
    if (!options || options.canRemoveWorktree !== false) {
      var removeWtItem = document.createElement("button");
      removeWtItem.className = "project-ctx-item project-ctx-delete";
      removeWtItem.innerHTML = iconHtml("trash-2") + " <span>Remove Worktree</span>";
      removeWtItem.addEventListener("click", function (e) {
        e.stopPropagation();
        closeProjectCtxMenu();
        if (getWs() && store.get('connected')) {
          getWs().send(JSON.stringify({ type: "remove_project_check", slug: slug, name: name || slug }));
        }
      });
      menu.appendChild(removeWtItem);
    }
  } else {
    var wtItem = document.createElement("button");
    wtItem.className = "project-ctx-item";
    wtItem.innerHTML = iconHtml("git-branch") + " <span>Add Worktree</span>";
    wtItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeProjectCtxMenu();
      showWorktreeModal(slug, name || slug);
    });
    menu.appendChild(wtItem);
  }

  document.body.appendChild(menu);
  projectCtxMenu = menu;
  refreshIcons();

  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = (rect.right + 6) + "px";
    menu.style.top = rect.top + "px";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
      menu.style.left = (rect.left - menuRect.width - 6) + "px";
    }
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (window.innerHeight - menuRect.height - 8) + "px";
    }
  });
}

function showProjectCtxMenu(anchorEl, slug, name, icon, position) {
  closeProjectCtxMenu();
  if (closeUserCtxMenu) closeUserCtxMenu();
  closeEmojiPicker();

  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  // --- Set Icon ---
  var iconItem = document.createElement("button");
  iconItem.className = "project-ctx-item";
  iconItem.innerHTML = iconHtml("smile") + " <span>Set Icon</span>";
  iconItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeProjectCtxMenu();
    showEmojiPicker(slug, anchorEl);
  });
  menu.appendChild(iconItem);

  // --- Project Settings ---
  if (!store.get('permissions') || store.get('permissions').projectSettings !== false) {
    var settingsItem = document.createElement("button");
    settingsItem.className = "project-ctx-item";
    settingsItem.innerHTML = iconHtml("settings") + " <span>Project Settings</span>";
    settingsItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeProjectCtxMenu();
      openProjectSettings(slug, { slug: slug, name: name, icon: icon, projectOwnerId: store.get('currentProjectOwnerId'), ownerLocked: store.get('ownerLocked') });
    });
    menu.appendChild(settingsItem);
  }

  var sep1 = document.createElement("div");
  sep1.className = "project-ctx-separator";
  menu.appendChild(sep1);

  // --- Share ---
  var shareItem = document.createElement("button");
  shareItem.className = "project-ctx-item";
  shareItem.innerHTML = iconHtml("share") + " <span>Share</span>";
  shareItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeProjectCtxMenu();
    triggerShare();
  });
  menu.appendChild(shareItem);

  // --- Manage Access ---
  if (store.get('isMultiUserMode')) {
    var isProjectOwner = store.get('myUserId') && store.get('currentProjectOwnerId') && store.get('myUserId') === store.get('currentProjectOwnerId');
    var isAdmin = store.get('permissions') && store.get('permissions').projectSettings !== false;
    if (isProjectOwner || isAdmin) {
      var accessItem = document.createElement("button");
      accessItem.className = "project-ctx-item";
      accessItem.innerHTML = iconHtml("users") + " <span>Manage Access</span>";
      accessItem.addEventListener("click", function (e) {
        e.stopPropagation();
        closeProjectCtxMenu();
        showProjectAccessPopover(anchorEl, slug);
      });
      menu.appendChild(accessItem);
    }
  }

  var sep2 = document.createElement("div");
  sep2.className = "project-ctx-separator";
  menu.appendChild(sep2);

  // --- Add Worktree ---
  if (slug.indexOf("--") === -1) {
    var wtItem = document.createElement("button");
    wtItem.className = "project-ctx-item";
    wtItem.innerHTML = iconHtml("git-branch") + " <span>Add Worktree</span>";
    wtItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeProjectCtxMenu();
      showWorktreeModal(slug, name || slug);
    });
    menu.appendChild(wtItem);
  }

  if (!store.get('permissions') || store.get('permissions').deleteProject !== false) {
    var sep3 = document.createElement("div");
    sep3.className = "project-ctx-separator";
    menu.appendChild(sep3);

    var deleteItem = document.createElement("button");
    deleteItem.className = "project-ctx-item project-ctx-delete";
    deleteItem.innerHTML = iconHtml("trash-2") + " <span>Remove Project</span>";
    deleteItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeProjectCtxMenu();
      if (getWs() && store.get('connected')) {
        getWs().send(JSON.stringify({ type: "remove_project_check", slug: slug, name: name }));
      }
    });
    menu.appendChild(deleteItem);
  }

  document.body.appendChild(menu);
  projectCtxMenu = menu;
  refreshIcons();

  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    if (position === "below") {
      menu.style.left = rect.left + "px";
      menu.style.top = (rect.bottom + 4) + "px";
    } else {
      menu.style.left = (rect.right + 6) + "px";
      menu.style.top = rect.top + "px";
    }
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
      menu.style.left = (rect.left - menuRect.width - 6) + "px";
    }
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (window.innerHeight - menuRect.height - 8) + "px";
    }
  });
}

// --- Emoji picker ---

function closeEmojiPicker() {
  if (emojiPickerEl) {
    emojiPickerEl.remove();
    emojiPickerEl = null;
  }
}

function showEmojiPicker(slug, anchorEl) {
  closeEmojiPicker();

  var picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.addEventListener("click", function (e) { e.stopPropagation(); });

  var header = document.createElement("div");
  header.className = "emoji-picker-header";
  header.textContent = "Choose Icon";

  var removeBtn = document.createElement("button");
  removeBtn.className = "emoji-picker-remove";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    closeEmojiPicker();
    if (getWs() && store.get('connected')) {
      getWs().send(JSON.stringify({ type: "set_project_icon", slug: slug, icon: null }));
    }
  });
  header.appendChild(removeBtn);
  picker.appendChild(header);

  var tabBar = document.createElement("div");
  tabBar.className = "emoji-picker-tabs";
  var tabBtns = [];

  for (var t = 0; t < EMOJI_CATEGORIES.length; t++) {
    (function (cat, idx) {
      var tab = document.createElement("button");
      tab.className = "emoji-picker-tab" + (idx === 0 ? " active" : "");
      tab.textContent = cat.icon;
      tab.title = cat.label;
      tab.addEventListener("click", function (e) {
        e.stopPropagation();
        switchCategory(idx);
      });
      tabBar.appendChild(tab);
      tabBtns.push(tab);
    })(EMOJI_CATEGORIES[t], t);
  }
  parseEmojis(tabBar);
  picker.appendChild(tabBar);

  var scrollArea = document.createElement("div");
  scrollArea.className = "emoji-picker-scroll";

  var grid = document.createElement("div");
  grid.className = "emoji-picker-grid";
  scrollArea.appendChild(grid);
  picker.appendChild(scrollArea);

  function buildGrid(emojis) {
    grid.innerHTML = "";
    for (var i = 0; i < emojis.length; i++) {
      (function (emoji) {
        var btn = document.createElement("button");
        btn.className = "emoji-picker-item";
        btn.textContent = emoji;
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          closeEmojiPicker();
          if (getWs() && store.get('connected')) {
            getWs().send(JSON.stringify({ type: "set_project_icon", slug: slug, icon: emoji }));
          }
        });
        grid.appendChild(btn);
      })(emojis[i]);
    }
    parseEmojis(grid);
    scrollArea.scrollTop = 0;
  }

  function switchCategory(idx) {
    for (var j = 0; j < tabBtns.length; j++) {
      tabBtns[j].classList.toggle("active", j === idx);
    }
    buildGrid(EMOJI_CATEGORIES[idx].emojis);
  }

  buildGrid(EMOJI_CATEGORIES[0].emojis);

  document.body.appendChild(picker);
  emojiPickerEl = picker;

  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    picker.style.left = (rect.right + 6) + "px";
    picker.style.top = rect.top + "px";
    var pRect = picker.getBoundingClientRect();
    if (pRect.right > window.innerWidth - 8) {
      picker.style.left = (rect.left - pRect.width - 6) + "px";
    }
    if (pRect.bottom > window.innerHeight - 8) {
      picker.style.top = (window.innerHeight - pRect.height - 8) + "px";
    }
  });
}

// --- Rename prompt ---
function showProjectRename(slug, currentName) {
  var nameEl = document.getElementById("title-bar-project-name");
  if (!nameEl) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "project-rename-input";
  input.value = currentName || "";

  var originalText = nameEl.textContent;
  nameEl.textContent = "";
  nameEl.appendChild(input);
  input.focus();
  input.select();

  var committed = false;

  function commitRename() {
    if (committed) return;
    committed = true;
    var newName = input.value.trim();
    if (newName && newName !== currentName && getWs() && store.get('connected')) {
      getWs().send(JSON.stringify({ type: "set_project_title", slug: slug, title: newName }));
      nameEl.textContent = newName;
    } else {
      nameEl.textContent = originalText;
    }
  }

  input.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); committed = true; nameEl.textContent = originalText; }
  });
  input.addEventListener("blur", commitRename);
  input.addEventListener("click", function (e) { e.stopPropagation(); });
}

// --- Drag-and-drop ---

function showTrashZone() {
  var addBtn = document.getElementById("icon-strip-add");
  if (!addBtn) return;
  addBtn.style.display = "none";

  var existing = document.getElementById("icon-strip-trash");
  if (existing) existing.remove();

  var trash = document.createElement("div");
  trash.id = "icon-strip-trash";
  trash.className = "icon-strip-trash";
  trash.innerHTML = iconHtml("trash-2");
  addBtn.parentNode.insertBefore(trash, addBtn.nextSibling);
  refreshIcons();

  trash.addEventListener("mouseenter", function () { showIconTooltip(trash, "Remove project"); });
  trash.addEventListener("mouseleave", hideIconTooltip);

  trash.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    trash.classList.add("drag-hover");
  });
  trash.addEventListener("dragleave", function () {
    trash.classList.remove("drag-hover");
  });
  trash.addEventListener("drop", function (e) {
    e.preventDefault();
    trash.classList.remove("drag-hover");
    var slug = e.dataTransfer.getData("text/plain");
    if (slug && getWs() && store.get('connected')) {
      getWs().send(JSON.stringify({ type: "remove_project_check", slug: slug }));
    }
  });
}

function hideTrashZone() {
  var trash = document.getElementById("icon-strip-trash");
  if (trash) trash.remove();
  var addBtn = document.getElementById("icon-strip-add");
  if (addBtn) addBtn.style.display = "";
}

function clearDragIndicators() {
  var items = document.querySelectorAll(".icon-strip-item.drag-over-above, .icon-strip-item.drag-over-below");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.remove("drag-over-above", "drag-over-below");
  }
}

function setupDragHandlers(el, slug) {
  el.setAttribute("draggable", "true");

  el.addEventListener("dragstart", function (e) {
    draggedSlug = slug;
    draggedEl = el;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", slug);

    var ghost = document.createElement("div");
    ghost.textContent = el.textContent.trim().split("\n")[0];
    ghost.style.cssText = "position:fixed;left:-200px;top:-200px;width:38px;height:38px;border-radius:12px;" +
      "background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;" +
      "font-size:15px;font-weight:600;pointer-events:none;z-index:-1;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 19, 19);
    setTimeout(function () { ghost.remove(); }, 0);

    setTimeout(function () { el.classList.add("dragging"); }, 0);
    hideIconTooltip();
    showTrashZone();
  });

  el.addEventListener("dragover", function (e) {
    e.preventDefault();
    if (!draggedSlug || draggedSlug === slug) return;
    e.dataTransfer.dropEffect = "move";

    clearDragIndicators();
    var rect = el.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      el.classList.add("drag-over-above");
    } else {
      el.classList.add("drag-over-below");
    }
  });

  el.addEventListener("dragleave", function () {
    el.classList.remove("drag-over-above", "drag-over-below");
  });

  el.addEventListener("drop", function (e) {
    e.preventDefault();
    clearDragIndicators();
    if (!draggedSlug || draggedSlug === slug) return;

    var rect = el.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    var insertBefore = e.clientY < midY;

    var container = document.getElementById("icon-strip-projects");
    var items = container.querySelectorAll(".icon-strip-item");
    var slugs = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset.slug !== draggedSlug) {
        slugs.push(items[i].dataset.slug);
      }
    }
    var targetIdx = slugs.indexOf(slug);
    if (!insertBefore) targetIdx++;
    slugs.splice(targetIdx, 0, draggedSlug);

    if (getWs() && store.get('connected')) {
      getWs().send(JSON.stringify({ type: "reorder_projects", slugs: slugs }));
    }
  });

  el.addEventListener("dragend", function () {
    el.classList.remove("dragging");
    clearDragIndicators();
    draggedSlug = null;
    draggedEl = null;
    hideTrashZone();
  });
}

// --- Worktree folder collapse ---

function setWtCollapsed(slug, collapsed) {
  wtCollapsed[slug] = collapsed;
}

// --- Icon item creation ---

function createIconItem(p, currentSlug) {
  var currentDmUserId = getCurrentDmUserId ? getCurrentDmUserId() : null;
  var el = document.createElement("a");
  var isActive = p.slug === currentSlug && !currentDmUserId;
  el.className = "icon-strip-item" + (isActive ? " active" : "");
  el.href = "/p/" + p.slug + "/";
  el.dataset.slug = p.slug;

  if (p.icon) {
    var emojiSpan = document.createElement("span");
    emojiSpan.className = "project-emoji";
    emojiSpan.textContent = p.icon;
    parseEmojis(emojiSpan);
    el.appendChild(emojiSpan);
  } else {
    el.appendChild(document.createTextNode(getProjectAbbrev(p.name)));
  }

  var pill = document.createElement("span");
  pill.className = "icon-strip-pill";
  el.appendChild(pill);

  var statusDot = document.createElement("span");
  statusDot.className = "icon-strip-status";
  if (p.isProcessing) statusDot.classList.add("processing");
  el.appendChild(statusDot);

  var projectBadge = document.createElement("span");
  projectBadge.className = "icon-strip-project-badge";
  if (p.unread > 0 && !isActive) {
    projectBadge.textContent = p.unread > 99 ? "99+" : String(p.unread);
    projectBadge.classList.add("has-unread");
  }
  el.appendChild(projectBadge);

  // TUI sessions don't go through pendingPermissions on the project status
  // broadcast — they surface via tui_attention notifications. We shake the
  // same icon for either, so the user notices regardless of which engine
  // is asking.
  if (!isActive && (p.pendingPermissions > 0 || getPendingTuiAttention(p.slug) > 0)) {
    el.classList.add("has-pending-perm");
  }

  (function (name, elem) {
    elem.addEventListener("mouseenter", function () { showIconTooltip(elem, name); });
    elem.addEventListener("mouseleave", hideIconTooltip);
  })(p.name, el);

  (function (slug) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      if (switchProject) switchProject(slug);
    });
  })(p.slug);

  return el;
}

// --- Worktree creation modal ---

function showWorktreeModal(parentSlug, parentName) {
  var existing = document.getElementById("wt-modal-container");
  if (existing) existing.remove();

  var container = document.createElement("div");
  container.id = "wt-modal-container";

  var overlay = document.createElement("div");
  overlay.className = "wt-modal-overlay";
  container.appendChild(overlay);

  var modal = document.createElement("div");
  modal.className = "wt-modal";

  var title = document.createElement("div");
  title.className = "wt-modal-title";
  title.textContent = "Add Worktree \u2014 " + parentName;
  modal.appendChild(title);

  var branchLabel = document.createElement("label");
  branchLabel.className = "wt-modal-label";
  branchLabel.textContent = "Branch name";
  modal.appendChild(branchLabel);

  var branchInput = document.createElement("input");
  branchInput.type = "text";
  branchInput.className = "wt-modal-input";
  branchInput.placeholder = "feat/my-feature";
  branchInput.autocomplete = "off";
  branchInput.spellcheck = false;
  modal.appendChild(branchInput);

  var baseLabel = document.createElement("label");
  baseLabel.className = "wt-modal-label";
  baseLabel.textContent = "Base branch";
  modal.appendChild(baseLabel);

  var baseSelect = document.createElement("select");
  baseSelect.className = "wt-modal-input";
  var defaultOpt = document.createElement("option");
  defaultOpt.value = "main";
  defaultOpt.textContent = "main";
  baseSelect.appendChild(defaultOpt);
  modal.appendChild(baseSelect);

  fetch("/p/" + parentSlug + "/api/branches")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      baseSelect.innerHTML = "";
      var branches = data.branches || ["main"];
      var defBranch = data.defaultBranch || "main";
      for (var i = 0; i < branches.length; i++) {
        var opt = document.createElement("option");
        opt.value = branches[i];
        opt.textContent = branches[i];
        if (branches[i] === defBranch) opt.selected = true;
        baseSelect.appendChild(opt);
      }
    })
    .catch(function () {});

  var errorDiv = document.createElement("div");
  errorDiv.className = "wt-modal-error";
  modal.appendChild(errorDiv);

  var actions = document.createElement("div");
  actions.className = "wt-modal-actions";

  var cancelBtn = document.createElement("button");
  cancelBtn.className = "wt-modal-btn";
  cancelBtn.textContent = "Cancel";
  actions.appendChild(cancelBtn);

  var createBtn = document.createElement("button");
  createBtn.className = "wt-modal-btn primary";
  createBtn.textContent = "Create";
  actions.appendChild(createBtn);

  modal.appendChild(actions);
  container.appendChild(modal);
  document.body.appendChild(container);
  branchInput.focus();

  function closeModal() { container.remove(); }

  function doCreate() {
    var branch = branchInput.value.trim();
    var base = baseSelect.value.trim() || null;
    if (!branch) {
      errorDiv.textContent = "Branch name is required";
      errorDiv.classList.add("visible");
      return;
    }
    var dirName = branch.replace(/\//g, "-");
    createBtn.disabled = true;
    createBtn.textContent = "Creating...";
    errorDiv.classList.remove("visible");

    if (getWs() && store.get('connected')) {
      getWs().send(JSON.stringify({
        type: "create_worktree",
        branch: branch,
        dirName: dirName,
        baseBranch: base
      }));
    }

    var handler = function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === "create_worktree_result") {
        getWs().removeEventListener("message", handler);
        if (msg.ok) {
          closeModal();
          if (msg.slug && switchProject) switchProject(msg.slug);
        } else {
          createBtn.disabled = false;
          createBtn.textContent = "Create";
          errorDiv.textContent = msg.error || "Failed to create worktree";
          errorDiv.classList.add("visible");
        }
      }
    };
    getWs().addEventListener("message", handler);
  }

  overlay.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  createBtn.addEventListener("click", doCreate);
  branchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") doCreate();
    if (e.key === "Escape") closeModal();
  });
  baseSelect.addEventListener("keydown", function (e) {
    if (e.key === "Enter") doCreate();
    if (e.key === "Escape") closeModal();
  });
}

// --- Render icon strip ---

export function renderIconStrip(projects, currentSlug) {
  cachedProjectList = projects;
  cachedCurrentSlug = currentSlug;

  var container = document.getElementById("icon-strip-projects");
  if (!container) return;
  container.innerHTML = "";

  var currentDmUserId = getCurrentDmUserId ? getCurrentDmUserId() : null;
  var grouped = groupProjects(projects);

  for (var i = 0; i < grouped.parents.length; i++) {
    var p = grouped.parents[i];
    var worktrees = grouped.wtByParent[p.slug] || [];
    var hasWorktrees = worktrees.length > 0;

    if (!hasWorktrees) {
      var el = createIconItem(p, currentSlug);
      (function (slug, name, elem) {
        elem.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          e.stopPropagation();
          showIconCtxMenu(elem, slug, name);
        });
      })(p.slug, p.name || p.slug, el);
      setupDragHandlers(el, p.slug);
      container.appendChild(el);
      continue;
    }

    // Folder group for parent + worktrees
    var folder = document.createElement("div");
    folder.className = "icon-strip-group";
    folder.dataset.parentSlug = p.slug;
    if (wtCollapsed[p.slug]) folder.classList.add("collapsed");

    if (!p.isProcessing) {
      for (var wpi = 0; wpi < worktrees.length; wpi++) {
        if (worktrees[wpi].isProcessing) { p.isProcessing = true; break; }
      }
    }

    var header = createIconItem(p, currentSlug);
    header.classList.add("folder-header");
    (function (slug, name, elem) {
      elem.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showIconCtxMenu(elem, slug, name);
      });
    })(p.slug, p.name || p.slug, header);
    setupDragHandlers(header, p.slug);

    var chevron = document.createElement("span");
    chevron.className = "icon-strip-group-chevron";
    chevron.innerHTML = '<i data-lucide="git-branch"></i>';
    (function (parentSlug, folderEl) {
      chevron.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var nowCollapsed = folderEl.classList.toggle("collapsed");
        setWtCollapsed(parentSlug, nowCollapsed);
      });
      chevron.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
    })(p.slug, folder);
    chevron.setAttribute("data-tip", "Toggle worktrees");
    header.appendChild(chevron);
    folder.appendChild(header);

    var itemsContainer = document.createElement("div");
    itemsContainer.className = "icon-strip-group-items";

    for (var wi = 0; wi < worktrees.length; wi++) {
      (function (wt) {
        var wtEl = document.createElement("a");
        var isWtActive = wt.slug === currentSlug && !currentDmUserId;
        var isExternal = isExternalWorktree(wt);
        wtEl.className = "icon-strip-wt-item" + (isWtActive ? " active" : "") + (isExternal ? " wt-external" : "");
        wtEl.href = "/p/" + wt.slug + "/";
        wtEl.dataset.slug = wt.slug;

        if (wt.icon) {
          var wtEmoji = document.createElement("span");
          wtEmoji.className = "wt-branch-abbrev project-emoji";
          wtEmoji.textContent = wt.icon;
          parseEmojis(wtEmoji);
          wtEl.appendChild(wtEmoji);
        } else {
          var abbrev = document.createElement("span");
          abbrev.className = "wt-branch-abbrev";
          abbrev.textContent = getProjectAbbrev(wt.name);
          wtEl.appendChild(abbrev);
        }

        var wtStatus = document.createElement("span");
        wtStatus.className = "icon-strip-status";
        if (wt.isProcessing) wtStatus.classList.add("processing");
        wtEl.appendChild(wtStatus);

        if (isExternal) appendExternalWorktreeBadge(wtEl, "worktree-external-badge");

        var tooltipText = isExternal ? externalWorktreeTooltip(wt.name) : wt.name;
        (function (text, elem) {
          elem.addEventListener("mouseenter", function () { showIconTooltip(elem, text); });
          elem.addEventListener("mouseleave", hideIconTooltip);
        })(tooltipText, wtEl);

        (function (slug) {
          wtEl.addEventListener("click", function (e) {
            e.preventDefault();
            if (switchProject) switchProject(slug);
          });
        })(wt.slug);

        (function (slug, name, elem, external) {
          elem.addEventListener("contextmenu", function (e) {
            e.preventDefault();
            e.stopPropagation();
            showIconCtxMenu(elem, slug, name, { canRemoveWorktree: !external });
          });
        })(wt.slug, wt.name, wtEl, isExternal);

        if (!isWtActive && (wt.pendingPermissions > 0 || getPendingTuiAttention(wt.slug) > 0)) {
          wtEl.classList.add("has-pending-perm");
        }

        itemsContainer.appendChild(wtEl);
      })(worktrees[wi]);
    }

    var hasWtPendingPerm = false;
    for (var wpi2 = 0; wpi2 < worktrees.length; wpi2++) {
      if (worktrees[wpi2].pendingPermissions > 0 || getPendingTuiAttention(worktrees[wpi2].slug) > 0) {
        hasWtPendingPerm = true;
        break;
      }
    }
    if (hasWtPendingPerm) folder.classList.remove("collapsed");

    var addBtn = document.createElement("button");
    addBtn.className = "icon-strip-group-add";
    addBtn.textContent = "+";
    (function (parentSlug, parentName, btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showWorktreeModal(parentSlug, parentName);
      });
      btn.addEventListener("mouseenter", function () { showIconTooltip(btn, "New worktree"); });
      btn.addEventListener("mouseleave", hideIconTooltip);
    })(p.slug, p.name, addBtn);
    itemsContainer.appendChild(addBtn);

    folder.appendChild(itemsContainer);
    container.appendChild(folder);
  }

  // Update home icon active state
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) {
    if ((!currentSlug || projects.length === 0) && !currentDmUserId) {
      homeIcon.classList.add("active");
    } else {
      homeIcon.classList.remove("active");
    }
  }

  renderProjectList(projects, currentSlug);

  var iconNodes = [container];
  var mobileProjectList = document.getElementById("project-list");
  if (mobileProjectList) iconNodes.push(mobileProjectList);
  try { lucide.createIcons({ nodes: iconNodes }); } catch (e) {}
}

function renderProjectList(projects, currentSlug) {
  var list = document.getElementById("project-list");
  if (!list) return;
  list.innerHTML = "";

  var grouped = groupProjects(projects);

  for (var i = 0; i < grouped.parents.length; i++) {
    var p = grouped.parents[i];
    var worktrees = grouped.wtByParent[p.slug] || [];

    if (worktrees.length === 0) {
      list.appendChild(createMobileProjectItem(p, currentSlug, false));
      continue;
    }

    var folderDiv = document.createElement("div");
    folderDiv.className = "mobile-project-folder";
    if (wtCollapsed[p.slug]) folderDiv.classList.add("collapsed");

    var headerEl = createMobileProjectItem(p, currentSlug, false);
    var chevron = document.createElement("span");
    chevron.className = "mobile-folder-chevron";
    chevron.innerHTML = "&#9660;";
    (function (parentSlug, fDiv) {
      chevron.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var nowCollapsed = fDiv.classList.toggle("collapsed");
        setWtCollapsed(parentSlug, nowCollapsed);
      });
    })(p.slug, folderDiv);
    headerEl.appendChild(chevron);
    folderDiv.appendChild(headerEl);

    var wtList = document.createElement("div");
    wtList.className = "mobile-folder-items";
    for (var wi = 0; wi < worktrees.length; wi++) {
      var wtItem = createMobileProjectItem(worktrees[wi], currentSlug, true);
      if (isExternalWorktree(worktrees[wi])) {
        wtItem.classList.add("wt-external");
        appendExternalWorktreeBadge(wtItem, "mobile-worktree-external-badge");
      }
      wtList.appendChild(wtItem);
    }
    folderDiv.appendChild(wtList);
    list.appendChild(folderDiv);
  }
}

function createMobileProjectItem(p, currentSlug, isWorktree) {
  var el = document.createElement("button");
  el.className = "mobile-project-item" + (p.slug === currentSlug ? " active" : "") + (isWorktree ? " wt-item" : "");

  var abbrev = document.createElement("span");
  abbrev.className = "mobile-project-abbrev";
  if (p.icon) {
    abbrev.textContent = p.icon;
    parseEmojis(abbrev);
  } else {
    abbrev.textContent = getProjectAbbrev(p.name);
  }
  el.appendChild(abbrev);

  var name = document.createElement("span");
  name.className = "mobile-project-name";
  name.textContent = p.name;
  el.appendChild(name);

  if (p.isProcessing) {
    var dot = document.createElement("span");
    dot.className = "mobile-project-processing";
    el.appendChild(dot);
  }

  el.addEventListener("click", function () {
    if (switchProject) switchProject(p.slug);
    if (closeSidebar) closeSidebar();
  });

  return el;
}

export function getEmojiCategories() { return EMOJI_CATEGORIES; }

export function updateProjectBadge(slug, count) {
  var icon = document.querySelector('.icon-strip-item[data-slug="' + slug + '"]');
  if (!icon) return;
  var badge = icon.querySelector(".icon-strip-project-badge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.add("has-unread");
  } else {
    badge.textContent = "";
    badge.classList.remove("has-unread");
  }
}
