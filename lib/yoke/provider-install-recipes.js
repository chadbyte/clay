// Registry-owned installation contracts. Sources verified 2026-10-23.
// No caller-supplied executable, package, URL, flags or shell input is accepted.
var recipes = {
  claude: Object.freeze({ revision: 'claude-native-1', source: 'https://code.claude.com/docs/en/setup',
    command: 'curl -fsSL https://claude.ai/install.sh | bash',
    effects: 'Downloads and runs the official native installer in your runtime account. Writes ~/.local/bin/claude and ~/.local/share/claude. Native installations auto-update.' }),
  codex: Object.freeze({ revision: 'codex-npm-user-1', source: 'https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex',
    command: 'npm install --global --prefix "$HOME/.local" --cache "$HOME/.cache/clay-provider-npm" --userconfig /dev/null --globalconfig /dev/null --registry https://registry.npmjs.org @openai/codex@latest',
    effects: 'Downloads the official npm package and runs its installation scripts as your runtime account. Requires Node.js and npm on the runtime PATH. Writes ~/.local and ~/.cache/clay-provider-npm; does not edit shell profiles. ~/.local/bin must be on the runtime PATH.',
    configurationSource: 'https://docs.npmjs.com/cli/v11/using-npm/config/' })
};
function eligible(recipe, identity) {
  var os = require('os');
  if (!recipe || Object.keys(recipes).every(function (id) { return recipes[id] !== recipe; })) return 'No reviewed installation recipe is registered for this provider.';
  if (['linux','darwin'].indexOf(process.platform) < 0 || ['x64','arm64'].indexOf(process.arch) < 0) return 'Reviewed installation supports only macOS or Linux on x64 or ARM64.';
  if (process.platform === 'darwin' && Number(os.release().split('.')[0]) < 22) return 'Reviewed installation requires macOS 13 or later.';
  if (!identity || !Number.isInteger(identity.uid) || identity.uid <= 0 || !Number.isInteger(identity.gid) || !identity.user || typeof identity.home !== 'string' || identity.home[0] !== '/' || identity.home === '/' || /[\r\n\0]/.test(identity.home)) return 'A non-root runtime OS account with an absolute HOME is required. Ask the server operator to complete setup.';
  return '';
}
module.exports = { claude: recipes.claude, codex: recipes.codex, eligible: eligible };
