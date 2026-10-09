import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { createDebateControls } from './debate-controls.js';
export { homeDebateControlState } from './debate-controls.js';

var controls = createDebateControls({
  slotId: "home-debate-controls-slot",
  composerId: "home-mate-chat-composer",
  modelId: "home-mate-chat-session-model",
  send: function (action, data, requestId) {
    var ws = getWs();
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify({
      type: "home_debate_control", action: action,
      mateId: store.get('homeChatMateId'), sessionId: store.get('homeChatSessionId'),
      requestId: requestId, text: data.text || "", response: data.response || null
    }));
    return true;
  }
});

export function renderHomeDebateControls(messages, requestId, onStartNewDebate) {
  return controls.render(messages, requestId, onStartNewDebate);
}
