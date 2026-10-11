// Theme-specific surfaces keep user color choices separate from text and actions.
export var MATE_WORKSPACE_COLORS = [
  { id: 'mint', label: 'Mint', pigment: '#07e5a3' },
  { id: 'rose', label: 'Rose', pigment: '#ec82ac' },
  { id: 'plum', label: 'Plum', pigment: '#b780b3' },
  { id: 'coral', label: 'Coral', pigment: '#ff7479' },
  { id: 'peach', label: 'Peach', pigment: '#ed986b' },
  { id: 'gold', label: 'Gold', pigment: '#e0b45b' },
  { id: 'sky', label: 'Sky', pigment: '#69b6d4' },
  { id: 'indigo', label: 'Indigo', pigment: '#8582df' },
  { id: 'stone', label: 'Stone', pigment: '#a5a59e' }
];
function mix(pigment, base, amount) {
  var channels = [1, 3, 5].map(function (offset) {
    var a = parseInt(pigment.slice(offset, offset + 2), 16);
    var b = parseInt(base.slice(offset, offset + 2), 16);
    return Math.round(a * amount + b * (1 - amount)).toString(16).padStart(2, '0');
  });
  return '#' + channels.join('');
}
export function workspaceColor(mate) {
  var id = mate && mate.builtinKey !== 'clay' && !mate.primary ? mate.workspaceColor : 'mint';
  var color = MATE_WORKSPACE_COLORS.find(function (item) { return item.id === id; }) || MATE_WORKSPACE_COLORS[0];
  return Object.assign({}, color, {
    light: mix(color.pigment, '#f2f2ef', color.id === 'mint' ? 0.03 : 0.08),
    dark: mix(color.pigment, '#232322', color.id === 'mint' ? 0.02 : 0.10)
  });
}
export function applyWorkspaceColor(mate) {
  var color = workspaceColor(mate);
  document.body.style.setProperty('--mate-surround-light', color.light);
  document.body.style.setProperty('--mate-surround-dark', color.dark);
}
