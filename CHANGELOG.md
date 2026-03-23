# [2.17.0-beta.3](https://github.com/chadbyte/clay/compare/v2.17.0-beta.2...v2.17.0-beta.3) (2026-03-23)


### Bug Fixes

* **cli:** move mkcert deprecation warning to main menu after render ([a702390](https://github.com/chadbyte/clay/commit/a70239065497bd35adf79fe414f8cf30e20210ce))

# [2.17.0-beta.2](https://github.com/chadbyte/clay/compare/v2.17.0-beta.1...v2.17.0-beta.2) (2026-03-23)


### Bug Fixes

* **sw:** skip cross-origin requests in service worker fetch handler ([14615ed](https://github.com/chadbyte/clay/commit/14615edf56d1c1b4424aa3a760eaed9e61beb0e7))

# [2.17.0-beta.1](https://github.com/chadbyte/clay/compare/v2.16.0...v2.17.0-beta.1) (2026-03-23)


### Features

* **tls:** use builtin *.d.clay.studio wildcard certificate by default ([4c30000](https://github.com/chadbyte/clay/commit/4c30000ff4004286469de0d0016a6d6c920b7020))

# [2.16.0](https://github.com/chadbyte/clay/compare/v2.15.2...v2.16.0) (2026-03-23)


### Bug Fixes

* **mates:** keep mate WS alive in background on DM exit ([305375b](https://github.com/chadbyte/clay/commit/305375bf29ab95a4ca6828d4d0cb054c67495ba1))
* **pwa:** handle standard port when behind reverse proxy ([012ab31](https://github.com/chadbyte/clay/commit/012ab310210763ae644338ab66cb4930d6ce89e4)), closes [#241](https://github.com/chadbyte/clay/issues/241)
* **ralph:** ignore untracked files in git dirty check ([5370248](https://github.com/chadbyte/clay/commit/5370248e73d1f848e4adbb2e1e64c63407a4dc55))
* **ui:** prevent suggestion chips from covering last message ([297f669](https://github.com/chadbyte/clay/commit/297f66917105854e2fa7c7317551008acb6a304a))


### Features

* **images:** persist chat images to disk with configurable retention ([af2aa6b](https://github.com/chadbyte/clay/commit/af2aa6bc872e1bc4af46288f9690c24f50013bad))
* **mates:** add IO blink, unread badge, and permission shake to mate icons ([568fe33](https://github.com/chadbyte/clay/commit/568fe3371bfe14302f3e085cc4a2412cf824c1f2))
* **mobile:** implement comprehensive mobile redesign ([b409b7c](https://github.com/chadbyte/clay/commit/b409b7ce0d95fe8cce70296d5877bb436bc17aa6))
* **mobile:** improve mobile UI and mate IO blink ([8e18466](https://github.com/chadbyte/clay/commit/8e18466280e86a906ca90114cc8d60ad67756d47))
* **ralph:** allow judge to use tools and provide commit history ([b25c29b](https://github.com/chadbyte/clay/commit/b25c29b88f4761d7bf2ee9bb31506b49cbf595b1))
* **ralph:** craft judge when only prompt provided in own mode ([054add2](https://github.com/chadbyte/clay/commit/054add26a2804e251d993274960d11df2c93a7c1))
* **ui:** add long-press context menu support for touch devices ([8c33b82](https://github.com/chadbyte/clay/commit/8c33b82f6814f0cdaf719d154a9016c6b55550e7))

# [2.16.0-beta.2](https://github.com/chadbyte/clay/compare/v2.16.0-beta.1...v2.16.0-beta.2) (2026-03-23)


### Bug Fixes

* **pwa:** handle standard port when behind reverse proxy ([012ab31](https://github.com/chadbyte/clay/commit/012ab310210763ae644338ab66cb4930d6ce89e4)), closes [#241](https://github.com/chadbyte/clay/issues/241)

# [2.16.0-beta.1](https://github.com/chadbyte/clay/compare/v2.15.2...v2.16.0-beta.1) (2026-03-23)


### Bug Fixes

* **mates:** keep mate WS alive in background on DM exit ([305375b](https://github.com/chadbyte/clay/commit/305375bf29ab95a4ca6828d4d0cb054c67495ba1))
* **ralph:** ignore untracked files in git dirty check ([5370248](https://github.com/chadbyte/clay/commit/5370248e73d1f848e4adbb2e1e64c63407a4dc55))
* **ui:** prevent suggestion chips from covering last message ([297f669](https://github.com/chadbyte/clay/commit/297f66917105854e2fa7c7317551008acb6a304a))


### Features

* **images:** persist chat images to disk with configurable retention ([af2aa6b](https://github.com/chadbyte/clay/commit/af2aa6bc872e1bc4af46288f9690c24f50013bad))
* **mates:** add IO blink, unread badge, and permission shake to mate icons ([568fe33](https://github.com/chadbyte/clay/commit/568fe3371bfe14302f3e085cc4a2412cf824c1f2))
* **mobile:** implement comprehensive mobile redesign ([b409b7c](https://github.com/chadbyte/clay/commit/b409b7ce0d95fe8cce70296d5877bb436bc17aa6))
* **mobile:** improve mobile UI and mate IO blink ([8e18466](https://github.com/chadbyte/clay/commit/8e18466280e86a906ca90114cc8d60ad67756d47))
* **ralph:** allow judge to use tools and provide commit history ([b25c29b](https://github.com/chadbyte/clay/commit/b25c29b88f4761d7bf2ee9bb31506b49cbf595b1))
* **ralph:** craft judge when only prompt provided in own mode ([054add2](https://github.com/chadbyte/clay/commit/054add26a2804e251d993274960d11df2c93a7c1))
* **ui:** add long-press context menu support for touch devices ([8c33b82](https://github.com/chadbyte/clay/commit/8c33b82f6814f0cdaf719d154a9016c6b55550e7))

## [2.15.2](https://github.com/chadbyte/clay/compare/v2.15.1...v2.15.2) (2026-03-22)


### Bug Fixes

* **ci:** auto-resolve CHANGELOG and package.json merge conflicts in release workflow ([b7a32e0](https://github.com/chadbyte/clay/commit/b7a32e0d8fa42348245544077fb85ca3ff0f13bb))

## [2.15.2-beta.1](https://github.com/chadbyte/clay/compare/v2.15.1...v2.15.2-beta.1) (2026-03-22)


### Bug Fixes

* **ci:** auto-resolve CHANGELOG and package.json merge conflicts in release workflow ([b7a32e0](https://github.com/chadbyte/clay/commit/b7a32e0d8fa42348245544077fb85ca3ff0f13bb))

## [2.15.1-beta.1](https://github.com/chadbyte/clay/compare/v2.15.0...v2.15.1-beta.1) (2026-03-22)


### Bug Fixes

* **scheduler:** pass maxIterations from registry to startLoop on trigger ([55591a8](https://github.com/chadbyte/clay/commit/55591a8d41fcd0721a77633235bfbcc29041963d))

# [2.15.0](https://github.com/chadbyte/clay/compare/v2.14.0...v2.15.0) (2026-03-22)


### Bug Fixes

* **mates:** close sticky notes when switching sessions in mate sidebar ([3cb9fe7](https://github.com/chadbyte/clay/commit/3cb9fe779be6666aefa2b415e95b8a889ed0eb7f))
* **mates:** preserve search state when clicking session in mate sidebar ([a33865f](https://github.com/chadbyte/clay/commit/a33865f3f7ac9909f9e50f1587557e157ad45acb))
* **mates:** use projectOwnerId instead of non-existent opts.ownerId ([3324547](https://github.com/chadbyte/clay/commit/332454738fcbafb093ae9b121407a847a692e0f1))
* **scheduler:** update existing event instead of creating duplicate on edit ([ac4cd63](https://github.com/chadbyte/clay/commit/ac4cd63efce68caef9ffbe9b2187f98407173899))
* **sessions:** guard against undefined history entries in findTurnBoundary ([a586151](https://github.com/chadbyte/clay/commit/a586151e1d501f8630f65105675efedbb120dbc2))
* **ui:** prevent suggestion chips from hiding last chat message ([978c844](https://github.com/chadbyte/clay/commit/978c84468707534448cd51641725a76b515590d8))


### Features

* **mates:** add common knowledge system and redesign knowledge UI ([3c18368](https://github.com/chadbyte/clay/commit/3c183683cde384ca89207630bfe3844852527dbc))
* **mates:** add team awareness so mates know about each other ([cb8da28](https://github.com/chadbyte/clay/commit/cb8da2821457a3f61cb5447a153b4f36df5e8389))
* **mates:** check mate interview skill updates when opening mate DM ([0ddf43d](https://github.com/chadbyte/clay/commit/0ddf43d2729ec76ed2dc9909f4c483a889d2cab0))
* **palette:** inline cross-project session search in command palette ([a9bea18](https://github.com/chadbyte/clay/commit/a9bea18610c441875e69212701090292011090a0))
* **scheduler:** add minute/hour interval scheduling with skip-if-running ([cfda2ee](https://github.com/chadbyte/clay/commit/cfda2ee9f69a8eed82b2f13f63c28802e002423a)), closes [#235](https://github.com/chadbyte/clay/issues/235)

# [2.15.0-beta.5](https://github.com/chadbyte/clay/compare/v2.15.0-beta.4...v2.15.0-beta.5) (2026-03-22)


### Bug Fixes

* **mates:** use projectOwnerId instead of non-existent opts.ownerId ([3324547](https://github.com/chadbyte/clay/commit/332454738fcbafb093ae9b121407a847a692e0f1))

# [2.15.0-beta.4](https://github.com/chadbyte/clay/compare/v2.15.0-beta.3...v2.15.0-beta.4) (2026-03-22)


### Features

* **mates:** check mate interview skill updates when opening mate DM ([0ddf43d](https://github.com/chadbyte/clay/commit/0ddf43d2729ec76ed2dc9909f4c483a889d2cab0))

# [2.15.0-beta.3](https://github.com/chadbyte/clay/compare/v2.15.0-beta.2...v2.15.0-beta.3) (2026-03-22)


### Features

* **scheduler:** add minute/hour interval scheduling with skip-if-running ([cfda2ee](https://github.com/chadbyte/clay/commit/cfda2ee9f69a8eed82b2f13f63c28802e002423a)), closes [#235](https://github.com/chadbyte/clay/issues/235)

# [2.15.0-beta.2](https://github.com/chadbyte/clay/compare/v2.15.0-beta.1...v2.15.0-beta.2) (2026-03-22)


### Bug Fixes

* **scheduler:** update existing event instead of creating duplicate on edit ([ac4cd63](https://github.com/chadbyte/clay/commit/ac4cd63efce68caef9ffbe9b2187f98407173899))

# [2.15.0-beta.1](https://github.com/chadbyte/clay/compare/v2.14.0...v2.15.0-beta.1) (2026-03-22)


### Bug Fixes

* **mates:** close sticky notes when switching sessions in mate sidebar ([3cb9fe7](https://github.com/chadbyte/clay/commit/3cb9fe779be6666aefa2b415e95b8a889ed0eb7f))
* **mates:** preserve search state when clicking session in mate sidebar ([a33865f](https://github.com/chadbyte/clay/commit/a33865f3f7ac9909f9e50f1587557e157ad45acb))
* **sessions:** guard against undefined history entries in findTurnBoundary ([a586151](https://github.com/chadbyte/clay/commit/a586151e1d501f8630f65105675efedbb120dbc2))
* **ui:** prevent suggestion chips from hiding last chat message ([978c844](https://github.com/chadbyte/clay/commit/978c84468707534448cd51641725a76b515590d8))


### Features

* **mates:** add common knowledge system and redesign knowledge UI ([3c18368](https://github.com/chadbyte/clay/commit/3c183683cde384ca89207630bfe3844852527dbc))
* **mates:** add team awareness so mates know about each other ([cb8da28](https://github.com/chadbyte/clay/commit/cb8da2821457a3f61cb5447a153b4f36df5e8389))
* **palette:** inline cross-project session search in command palette ([a9bea18](https://github.com/chadbyte/clay/commit/a9bea18610c441875e69212701090292011090a0))

# [2.14.0](https://github.com/chadbyte/clay/compare/v2.13.0...v2.14.0) (2026-03-21)


### Bug Fixes

* **daemon:** prevent single-session AbortError from crashing all sessions ([984c68f](https://github.com/chadbyte/clay/commit/984c68ff545b6e80fc3363795067ea68ce256717)), closes [#236](https://github.com/chadbyte/clay/issues/236)
* **mates:** align AskUserQuestion avatar layout with msg-assistant ([52d9522](https://github.com/chadbyte/clay/commit/52d9522783833bb20d0709324c5655b0d0befa2f))
* **mates:** left-align thinking and tool badges in mate DM ([cca618d](https://github.com/chadbyte/clay/commit/cca618d41aa6ded8976c4e766e6028dcc324bdd8))
* **mates:** pass mate context to tools module, fixing broken permission dialog ([e0d30dd](https://github.com/chadbyte/clay/commit/e0d30dd03af1aac004fb87b4cf1ea70bf2364289))
* **mates:** restore thinking dots when thinking group is reused ([add1867](https://github.com/chadbyte/clay/commit/add186732fe5ce9ce857582fb823e3f953e138b4))
* **mates:** restore user identity on refresh and update knowledge badge on connect ([9771d60](https://github.com/chadbyte/clay/commit/9771d60ed4127386c06c7dd1b528044df60c3d5c))
* **mates:** show disconnect screen when server shuts down during mate DM ([f477a80](https://github.com/chadbyte/clay/commit/f477a80551c99d71e1c89b8e1e116a8d417e8542))
* **mates:** show mate display name in title bar instead of session title ([df9428e](https://github.com/chadbyte/clay/commit/df9428e66cb501014e680a74f339d25ccadcfeeb))
* **sdk:** remove invalid setEffort call on query instance ([19168b9](https://github.com/chadbyte/clay/commit/19168b927f0c3868ed89a032f7def8eef7e2491a))


### Features

* **knowledge:** redesign as Obsidian-style split editor with sidebar integration ([20ab9b6](https://github.com/chadbyte/clay/commit/20ab9b673a53107a951449f17003f1dc23547cca))
* **mates:** add JSONL knowledge file support with read-only table view ([621a227](https://github.com/chadbyte/clay/commit/621a2271feccffbe6d36225900e49296a7ab1424))
* **mates:** add session search to mate sidebar with in-session search linking ([7623817](https://github.com/chadbyte/clay/commit/7623817fabacbb9bacee886194a11e7d1d9c63f8))
* **mates:** collapse thinking and tools by default in mate DM ([c8ccdfb](https://github.com/chadbyte/clay/commit/c8ccdfb5772ed35664a85615efaeed043634b729))
* **mates:** delay pre-thinking dots by 1s to feel more natural ([b485ba6](https://github.com/chadbyte/clay/commit/b485ba635310449499adc1bc46ba2e5647bf0f1a))
* **mates:** enforce crisis safety section on mate CLAUDE.md files ([da16e5d](https://github.com/chadbyte/clay/commit/da16e5d46107c35f8b1eb0080c50c8502bc6cb79))
* **mates:** humanize thinking, tools, and permission UI in mate DM ([9f122c9](https://github.com/chadbyte/clay/commit/9f122c956f52b7253ab53b07512354fbef22d896))
* **mates:** inject mate avatar and name into AskUserQuestion cards ([91666f2](https://github.com/chadbyte/clay/commit/91666f24d528cdc368aa5967614bacd90c153ee0))
* **mates:** redesign permission dialog as conversational chat bubble ([3778e43](https://github.com/chadbyte/clay/commit/3778e43f91fd3bbd031c6414a29219318c978f0b))
* **mates:** show instant thinking dots after user sends message ([13bb5bd](https://github.com/chadbyte/clay/commit/13bb5bd9c2a003f0e80416c3b01e8ba18c5900c1))
* **mates:** unify DM element layouts with consistent avatar column ([2156a63](https://github.com/chadbyte/clay/commit/2156a633102716d95eb059e4ac8959a9151b8d8a))
* **ui:** full-width DM input, reduce border-radius, restore mate DM on refresh ([a69132b](https://github.com/chadbyte/clay/commit/a69132b4452c7af157358650b3b88150e9615116))

# [2.14.0-beta.11](https://github.com/chadbyte/clay/compare/v2.14.0-beta.10...v2.14.0-beta.11) (2026-03-21)


### Bug Fixes

* **mates:** restore user identity on refresh and update knowledge badge on connect ([9771d60](https://github.com/chadbyte/clay/commit/9771d60ed4127386c06c7dd1b528044df60c3d5c))
* **sdk:** remove invalid setEffort call on query instance ([19168b9](https://github.com/chadbyte/clay/commit/19168b927f0c3868ed89a032f7def8eef7e2491a))


### Features

* **knowledge:** redesign as Obsidian-style split editor with sidebar integration ([20ab9b6](https://github.com/chadbyte/clay/commit/20ab9b673a53107a951449f17003f1dc23547cca))
* **mates:** add JSONL knowledge file support with read-only table view ([621a227](https://github.com/chadbyte/clay/commit/621a2271feccffbe6d36225900e49296a7ab1424))
* **mates:** add session search to mate sidebar with in-session search linking ([7623817](https://github.com/chadbyte/clay/commit/7623817fabacbb9bacee886194a11e7d1d9c63f8))
* **mates:** delay pre-thinking dots by 1s to feel more natural ([b485ba6](https://github.com/chadbyte/clay/commit/b485ba635310449499adc1bc46ba2e5647bf0f1a))
* **mates:** enforce crisis safety section on mate CLAUDE.md files ([da16e5d](https://github.com/chadbyte/clay/commit/da16e5d46107c35f8b1eb0080c50c8502bc6cb79))
* **mates:** unify DM element layouts with consistent avatar column ([2156a63](https://github.com/chadbyte/clay/commit/2156a633102716d95eb059e4ac8959a9151b8d8a))
* **ui:** full-width DM input, reduce border-radius, restore mate DM on refresh ([a69132b](https://github.com/chadbyte/clay/commit/a69132b4452c7af157358650b3b88150e9615116))

# [2.14.0-beta.10](https://github.com/chadbyte/clay/compare/v2.14.0-beta.9...v2.14.0-beta.10) (2026-03-21)


### Bug Fixes

* **mates:** align AskUserQuestion avatar layout with msg-assistant ([52d9522](https://github.com/chadbyte/clay/commit/52d9522783833bb20d0709324c5655b0d0befa2f))

# [2.14.0-beta.9](https://github.com/chadbyte/clay/compare/v2.14.0-beta.8...v2.14.0-beta.9) (2026-03-21)


### Features

* **mates:** redesign permission dialog as conversational chat bubble ([3778e43](https://github.com/chadbyte/clay/commit/3778e43f91fd3bbd031c6414a29219318c978f0b))

# [2.14.0-beta.8](https://github.com/chadbyte/clay/compare/v2.14.0-beta.7...v2.14.0-beta.8) (2026-03-21)


### Features

* **mates:** inject mate avatar and name into AskUserQuestion cards ([91666f2](https://github.com/chadbyte/clay/commit/91666f24d528cdc368aa5967614bacd90c153ee0))

# [2.14.0-beta.7](https://github.com/chadbyte/clay/compare/v2.14.0-beta.6...v2.14.0-beta.7) (2026-03-21)


### Bug Fixes

* **mates:** show disconnect screen when server shuts down during mate DM ([f477a80](https://github.com/chadbyte/clay/commit/f477a80551c99d71e1c89b8e1e116a8d417e8542))

# [2.14.0-beta.6](https://github.com/chadbyte/clay/compare/v2.14.0-beta.5...v2.14.0-beta.6) (2026-03-21)


### Bug Fixes

* **mates:** pass mate context to tools module, fixing broken permission dialog ([e0d30dd](https://github.com/chadbyte/clay/commit/e0d30dd03af1aac004fb87b4cf1ea70bf2364289))

# [2.14.0-beta.5](https://github.com/chadbyte/clay/compare/v2.14.0-beta.4...v2.14.0-beta.5) (2026-03-21)


### Bug Fixes

* **mates:** restore thinking dots when thinking group is reused ([add1867](https://github.com/chadbyte/clay/commit/add186732fe5ce9ce857582fb823e3f953e138b4))

# [2.14.0-beta.4](https://github.com/chadbyte/clay/compare/v2.14.0-beta.3...v2.14.0-beta.4) (2026-03-21)


### Bug Fixes

* **mates:** show mate display name in title bar instead of session title ([df9428e](https://github.com/chadbyte/clay/commit/df9428e66cb501014e680a74f339d25ccadcfeeb))

# [2.14.0-beta.3](https://github.com/chadbyte/clay/compare/v2.14.0-beta.2...v2.14.0-beta.3) (2026-03-21)


### Features

* **mates:** show instant thinking dots after user sends message ([13bb5bd](https://github.com/chadbyte/clay/commit/13bb5bd9c2a003f0e80416c3b01e8ba18c5900c1))

# [2.14.0-beta.2](https://github.com/chadbyte/clay/compare/v2.14.0-beta.1...v2.14.0-beta.2) (2026-03-21)


### Features

* **mates:** collapse thinking and tools by default in mate DM ([c8ccdfb](https://github.com/chadbyte/clay/commit/c8ccdfb5772ed35664a85615efaeed043634b729))

# [2.14.0-beta.1](https://github.com/chadbyte/clay/compare/v2.13.1-beta.1...v2.14.0-beta.1) (2026-03-21)


### Bug Fixes

* **daemon:** prevent single-session AbortError from crashing all sessions ([984c68f](https://github.com/chadbyte/clay/commit/984c68ff545b6e80fc3363795067ea68ce256717)), closes [#236](https://github.com/chadbyte/clay/issues/236)


### Features

* **mates:** humanize thinking, tools, and permission UI in mate DM ([9f122c9](https://github.com/chadbyte/clay/commit/9f122c956f52b7253ab53b07512354fbef22d896))

## [2.13.1-beta.1](https://github.com/chadbyte/clay/compare/v2.13.0...v2.13.1-beta.1) (2026-03-20)


### Bug Fixes

* **mates:** left-align thinking and tool badges in mate DM ([cca618d](https://github.com/chadbyte/clay/commit/cca618d41aa6ded8976c4e766e6028dcc324bdd8))

# [2.13.0](https://github.com/chadbyte/clay/compare/v2.12.0...v2.13.0) (2026-03-20)


### Bug Fixes

* **admin:** exclude worktree projects from visibility and owner settings ([cb27ddc](https://github.com/chadbyte/clay/commit/cb27ddcc52b8a23804d62092618417b5f40774d5))
* **deps:** regenerate package-lock.json to match package.json ([b85935a](https://github.com/chadbyte/clay/commit/b85935a78bba20a44d4e4bc779d691f2398fb70d))
* **input:** always show stop button during processing ([6f30f50](https://github.com/chadbyte/clay/commit/6f30f50ca72f6697088990b972e02dbcf7553650))
* **input:** ensure stop button shows when input is empty during processing ([83bc28a](https://github.com/chadbyte/clay/commit/83bc28a14015a2bca305d93f8fb845042c195b7b))
* **input:** prevent paste event from being intercepted in modals ([b03f6b6](https://github.com/chadbyte/clay/commit/b03f6b61c4069f951fdfd6d11b2060b3c77987e5))
* **loop:** ensure coder-to-judge transition and restore stop controls ([60a5c2e](https://github.com/chadbyte/clay/commit/60a5c2e239b8001ae85c93aeeb6f8136cb73ffdd))
* **loop:** force single iteration when JUDGE.md is absent ([980ad7e](https://github.com/chadbyte/clay/commit/980ad7edc05834298b529425109c862650a7d35d))
* **loop:** include startedAt in crafting session loop metadata ([1adfa30](https://github.com/chadbyte/clay/commit/1adfa30370832b58089f5999af9e9680adc3e961))
* **mates:** clean DM state transitions, mate-colored title bar, and hover seed tooltip ([dedbab8](https://github.com/chadbyte/clay/commit/dedbab8468830b320a4a9495072742c3000bf19b))
* **notifications:** suppress disconnect notifications on mobile and respect alert toggle ([5f09afb](https://github.com/chadbyte/clay/commit/5f09afb6eba41e7513f6dda641e50b51b486100b)), closes [#228](https://github.com/chadbyte/clay/issues/228)
* **rewind:** set lastRewindUuid to last kept message instead of removed one ([f5aa8b6](https://github.com/chadbyte/clay/commit/f5aa8b6c3f8409308c7eaaf5e4ea20b60dbf3017)), closes [#231](https://github.com/chadbyte/clay/issues/231)
* **scheduler:** restore previous session when closing crafting mode ([567270e](https://github.com/chadbyte/clay/commit/567270e8b8c4393e47aa84f2f3b942a902e1affd))
* **session:** restore active session when exiting mate DM ([b5e9c25](https://github.com/chadbyte/clay/commit/b5e9c2536c8695cf0b0c6e8257966a738231118f))
* **session:** update all clients on server-initiated session switch ([6aef325](https://github.com/chadbyte/clay/commit/6aef325a9f8ee847e949766ad0c5a57f459a9da2))
* **sidebar:** close overlay panels when switching sessions ([0b585ec](https://github.com/chadbyte/clay/commit/0b585ec4db54f061e63022356f47777e726cdd94))
* skip cert regeneration for externally-provided TLS certificates ([#232](https://github.com/chadbyte/clay/issues/232)) ([c7d9e09](https://github.com/chadbyte/clay/commit/c7d9e09c5219ba7381e475678aea568842613b98)), closes [#230](https://github.com/chadbyte/clay/issues/230)
* **ui:** add border-bottom to mate panel headers to match sidebar height ([51d642a](https://github.com/chadbyte/clay/commit/51d642a06dac713e362841ae2d52e8ed1f086807))
* **ui:** always show submit button in AskUserQuestion ([02b4f4a](https://github.com/chadbyte/clay/commit/02b4f4abee70adfdfeadff6bf8fe7292df8a12fa))
* **worktree:** preserve original branch name for git operations ([84a7114](https://github.com/chadbyte/clay/commit/84a711422a140bb1e5154313950d827a2eb2c74e)), closes [#233](https://github.com/chadbyte/clay/issues/233)
* **ws:** isolate main WS events while in mate DM mode ([c77efab](https://github.com/chadbyte/clay/commit/c77efab0cf3cfadf4e24a756656ade7351995d9b))


### Features

* **auth:** add admin password recovery via CLI settings menu ([6443f20](https://github.com/chadbyte/clay/commit/6443f205d13b79ed85f31fc254ea7398b9d16d7e))
* **auth:** add per-user RBAC permissions for multi-user mode ([7c4ad7f](https://github.com/chadbyte/clay/commit/7c4ad7fae91223ebe27b36028cfbf2fe78f60557))
* **loop:** allow users to provide their own PROMPT.md and JUDGE.md ([209be5d](https://github.com/chadbyte/clay/commit/209be5d9b1d393d54fad2f8cbafa64aefffb0f8b))
* **mates:** add Clay Mates system with creation wizard, DM interface, and SDK integration ([36f8735](https://github.com/chadbyte/clay/commit/36f873527adb90adf454557f42dc5f3c40e30df5))
* **mates:** add experimental badge to mate creation intro ([6d6550e](https://github.com/chadbyte/clay/commit/6d6550e84d213f2492a5053fef77b9a0695b5cf5))
* **mates:** add intro landing page to Mate creation wizard ([883c231](https://github.com/chadbyte/clay/commit/883c2313066eac73484366d9e14134ef78e11407))
* **mates:** add scheduled tasks to mate sidebar and close panels on session switch ([169f473](https://github.com/chadbyte/clay/commit/169f4735ba84868b781fd11d50514c494e0dfddf))
* **mates:** add Slack-style DM layout to mate chat messages ([e0fbb11](https://github.com/chadbyte/clay/commit/e0fbb11cc0ea3a99f152ceb02680bf5cb566ceb2))
* **notes:** add opacity slider to sticky note header ([4d7a62d](https://github.com/chadbyte/clay/commit/4d7a62d90fef3df018701b5b533db3d903633534))
* **palette:** add cross-project session search with Cmd+K ([fe756e1](https://github.com/chadbyte/clay/commit/fe756e10c434357179af835b20583ca563d5c4b9))
* **scheduler:** add mode and prompt fields to loop registry ([feb2062](https://github.com/chadbyte/clay/commit/feb2062300525fc1828fb0eb25e594db86a69ca1))
* **scheduler:** add single/multi-round toggle for schedule iterations ([60ca568](https://github.com/chadbyte/clay/commit/60ca5682516155cc0ac9f62cc8c73ed61ab9f820))
* **server:** remember last visited project on root redirect ([505705e](https://github.com/chadbyte/clay/commit/505705e8a36fc64eeae82a40eb45fa86bff4a50b)), closes [#229](https://github.com/chadbyte/clay/issues/229)
* **sidebar:** add collapse button, tooltip, and align avatar to icon-strip center ([0ab9ab7](https://github.com/chadbyte/clay/commit/0ab9ab75a6a65f6a0ee4ac998472b54011751985))
* **skills:** add version checking and auto-update for installed skills ([3132240](https://github.com/chadbyte/clay/commit/31322409ce311adb061e00d5b596b60d92e8ba33))
* **stt:** auto-scroll to bottom during voice input ([e9e3bc6](https://github.com/chadbyte/clay/commit/e9e3bc6a1d20f491f2732173c93f9419ba5b306d))
* **ui:** shake project icon when permission request is pending ([1aa1835](https://github.com/chadbyte/clay/commit/1aa1835a7f7db72e4c015f87eee202c23fbc4060))

# [2.13.0-beta.9](https://github.com/chadbyte/clay/compare/v2.13.0-beta.8...v2.13.0-beta.9) (2026-03-20)


### Features

* **mates:** add experimental badge to mate creation intro ([6d6550e](https://github.com/chadbyte/clay/commit/6d6550e84d213f2492a5053fef77b9a0695b5cf5))

# [2.13.0-beta.8](https://github.com/chadbyte/clay/compare/v2.13.0-beta.7...v2.13.0-beta.8) (2026-03-20)


### Features

* **mates:** add Slack-style DM layout to mate chat messages ([e0fbb11](https://github.com/chadbyte/clay/commit/e0fbb11cc0ea3a99f152ceb02680bf5cb566ceb2))

# [2.13.0-beta.7](https://github.com/chadbyte/clay/compare/v2.13.0-beta.6...v2.13.0-beta.7) (2026-03-20)


### Bug Fixes

* **session:** restore active session when exiting mate DM ([b5e9c25](https://github.com/chadbyte/clay/commit/b5e9c2536c8695cf0b0c6e8257966a738231118f))
* **ui:** add border-bottom to mate panel headers to match sidebar height ([51d642a](https://github.com/chadbyte/clay/commit/51d642a06dac713e362841ae2d52e8ed1f086807))


### Features

* **mates:** add scheduled tasks to mate sidebar and close panels on session switch ([169f473](https://github.com/chadbyte/clay/commit/169f4735ba84868b781fd11d50514c494e0dfddf))
* **stt:** auto-scroll to bottom during voice input ([e9e3bc6](https://github.com/chadbyte/clay/commit/e9e3bc6a1d20f491f2732173c93f9419ba5b306d))

# [2.13.0-beta.6](https://github.com/chadbyte/clay/compare/v2.13.0-beta.5...v2.13.0-beta.6) (2026-03-20)


### Bug Fixes

* **deps:** regenerate package-lock.json to match package.json ([b85935a](https://github.com/chadbyte/clay/commit/b85935a78bba20a44d4e4bc779d691f2398fb70d))

# [2.13.0-beta.5](https://github.com/chadbyte/clay/compare/v2.13.0-beta.4...v2.13.0-beta.5) (2026-03-20)


### Bug Fixes

* **loop:** force single iteration when JUDGE.md is absent ([980ad7e](https://github.com/chadbyte/clay/commit/980ad7edc05834298b529425109c862650a7d35d))
* **ui:** always show submit button in AskUserQuestion ([02b4f4a](https://github.com/chadbyte/clay/commit/02b4f4abee70adfdfeadff6bf8fe7292df8a12fa))
* **ws:** isolate main WS events while in mate DM mode ([c77efab](https://github.com/chadbyte/clay/commit/c77efab0cf3cfadf4e24a756656ade7351995d9b))

# [2.13.0-beta.4](https://github.com/chadbyte/clay/compare/v2.13.0-beta.3...v2.13.0-beta.4) (2026-03-20)


### Bug Fixes

* **admin:** exclude worktree projects from visibility and owner settings ([cb27ddc](https://github.com/chadbyte/clay/commit/cb27ddcc52b8a23804d62092618417b5f40774d5))
* **input:** always show stop button during processing ([6f30f50](https://github.com/chadbyte/clay/commit/6f30f50ca72f6697088990b972e02dbcf7553650))
* **input:** ensure stop button shows when input is empty during processing ([83bc28a](https://github.com/chadbyte/clay/commit/83bc28a14015a2bca305d93f8fb845042c195b7b))
* **input:** prevent paste event from being intercepted in modals ([b03f6b6](https://github.com/chadbyte/clay/commit/b03f6b61c4069f951fdfd6d11b2060b3c77987e5))
* **loop:** ensure coder-to-judge transition and restore stop controls ([60a5c2e](https://github.com/chadbyte/clay/commit/60a5c2e239b8001ae85c93aeeb6f8136cb73ffdd))
* **loop:** include startedAt in crafting session loop metadata ([1adfa30](https://github.com/chadbyte/clay/commit/1adfa30370832b58089f5999af9e9680adc3e961))
* **notifications:** suppress disconnect notifications on mobile and respect alert toggle ([5f09afb](https://github.com/chadbyte/clay/commit/5f09afb6eba41e7513f6dda641e50b51b486100b)), closes [#228](https://github.com/chadbyte/clay/issues/228)
* **rewind:** set lastRewindUuid to last kept message instead of removed one ([f5aa8b6](https://github.com/chadbyte/clay/commit/f5aa8b6c3f8409308c7eaaf5e4ea20b60dbf3017)), closes [#231](https://github.com/chadbyte/clay/issues/231)
* **scheduler:** restore previous session when closing crafting mode ([567270e](https://github.com/chadbyte/clay/commit/567270e8b8c4393e47aa84f2f3b942a902e1affd))
* **session:** update all clients on server-initiated session switch ([6aef325](https://github.com/chadbyte/clay/commit/6aef325a9f8ee847e949766ad0c5a57f459a9da2))
* **sidebar:** close overlay panels when switching sessions ([0b585ec](https://github.com/chadbyte/clay/commit/0b585ec4db54f061e63022356f47777e726cdd94))
* **worktree:** preserve original branch name for git operations ([84a7114](https://github.com/chadbyte/clay/commit/84a711422a140bb1e5154313950d827a2eb2c74e)), closes [#233](https://github.com/chadbyte/clay/issues/233)


### Features

* **auth:** add admin password recovery via CLI settings menu ([6443f20](https://github.com/chadbyte/clay/commit/6443f205d13b79ed85f31fc254ea7398b9d16d7e))
* **auth:** add per-user RBAC permissions for multi-user mode ([7c4ad7f](https://github.com/chadbyte/clay/commit/7c4ad7fae91223ebe27b36028cfbf2fe78f60557))
* **loop:** allow users to provide their own PROMPT.md and JUDGE.md ([209be5d](https://github.com/chadbyte/clay/commit/209be5d9b1d393d54fad2f8cbafa64aefffb0f8b))
* **mates:** add intro landing page to Mate creation wizard ([883c231](https://github.com/chadbyte/clay/commit/883c2313066eac73484366d9e14134ef78e11407))
* **notes:** add opacity slider to sticky note header ([4d7a62d](https://github.com/chadbyte/clay/commit/4d7a62d90fef3df018701b5b533db3d903633534))
* **palette:** add cross-project session search with Cmd+K ([fe756e1](https://github.com/chadbyte/clay/commit/fe756e10c434357179af835b20583ca563d5c4b9))
* **scheduler:** add mode and prompt fields to loop registry ([feb2062](https://github.com/chadbyte/clay/commit/feb2062300525fc1828fb0eb25e594db86a69ca1))
* **scheduler:** add single/multi-round toggle for schedule iterations ([60ca568](https://github.com/chadbyte/clay/commit/60ca5682516155cc0ac9f62cc8c73ed61ab9f820))
* **server:** remember last visited project on root redirect ([505705e](https://github.com/chadbyte/clay/commit/505705e8a36fc64eeae82a40eb45fa86bff4a50b)), closes [#229](https://github.com/chadbyte/clay/issues/229)
* **sidebar:** add collapse button, tooltip, and align avatar to icon-strip center ([0ab9ab7](https://github.com/chadbyte/clay/commit/0ab9ab75a6a65f6a0ee4ac998472b54011751985))
* **skills:** add version checking and auto-update for installed skills ([3132240](https://github.com/chadbyte/clay/commit/31322409ce311adb061e00d5b596b60d92e8ba33))
* **ui:** shake project icon when permission request is pending ([1aa1835](https://github.com/chadbyte/clay/commit/1aa1835a7f7db72e4c015f87eee202c23fbc4060))

# [2.13.0-beta.3](https://github.com/chadbyte/clay/compare/v2.13.0-beta.2...v2.13.0-beta.3) (2026-03-20)


### Bug Fixes

* skip cert regeneration for externally-provided TLS certificates ([#232](https://github.com/chadbyte/clay/issues/232)) ([c7d9e09](https://github.com/chadbyte/clay/commit/c7d9e09c5219ba7381e475678aea568842613b98)), closes [#230](https://github.com/chadbyte/clay/issues/230)

# [2.13.0-beta.2](https://github.com/chadbyte/clay/compare/v2.13.0-beta.1...v2.13.0-beta.2) (2026-03-19)


### Bug Fixes

* **mates:** clean DM state transitions, mate-colored title bar, and hover seed tooltip ([dedbab8](https://github.com/chadbyte/clay/commit/dedbab8468830b320a4a9495072742c3000bf19b))

# [2.13.0-beta.1](https://github.com/chadbyte/clay/compare/v2.12.0...v2.13.0-beta.1) (2026-03-19)


### Features

* **mates:** add Clay Mates system with creation wizard, DM interface, and SDK integration ([36f8735](https://github.com/chadbyte/clay/commit/36f873527adb90adf454557f42dc5f3c40e30df5))

# [2.12.0](https://github.com/chadbyte/clay/compare/v2.11.0...v2.12.0) (2026-03-19)


### Bug Fixes

* **auth:** persist multi-user tokens to disk and revoke on user deletion ([f245939](https://github.com/chadbyte/clay/commit/f245939bb715cf3c0572822abcd7101aacb64cd0))
* **cli:** sync multi-user mode with startup config and hide esc hint on disclaimer ([cbbd665](https://github.com/chadbyte/clay/commit/cbbd6652e56775b2fba897e400f2fc0d3f077cb8))
* **presence:** only show cursor sharing toggle in multi-user mode ([a51bd6c](https://github.com/chadbyte/clay/commit/a51bd6ce0558843ee68474b256ececa1982009a4))
* **search:** search timeline now shows matches from full session history ([a053d37](https://github.com/chadbyte/clay/commit/a053d37c1e5de391a782340e8d7516750fb47f94))


### Features

* **presence:** add offscreen indicator, cursor toggle, and avatar ([ab83bab](https://github.com/chadbyte/clay/commit/ab83bab319985b36292b7b869438d0435dde3239))
* **presence:** add real-time cursor sharing between users ([12759b8](https://github.com/chadbyte/clay/commit/12759b85793ddc51706671f38043d399371796e3))
* **presence:** add real-time text selection sharing between users ([6b0b0b2](https://github.com/chadbyte/clay/commit/6b0b0b2e8e1a12b219b24ed0e9e42f3ad1dd97f1))
* **ui:** add in-session search and unify tooltip system ([56a6e4c](https://github.com/chadbyte/clay/commit/56a6e4c6d95c8310a02db1432ed800f4da94be93))
* **worktree:** add git worktree support with sidebar UI and lifecycle management ([f3733c5](https://github.com/chadbyte/clay/commit/f3733c55df99bc3eb5b9d0c0b553984054fd4794)), closes [#218](https://github.com/chadbyte/clay/issues/218)

# [2.12.0-beta.1](https://github.com/chadbyte/clay/compare/v2.11.0...v2.12.0-beta.1) (2026-03-19)


### Bug Fixes

* **auth:** persist multi-user tokens to disk and revoke on user deletion ([f245939](https://github.com/chadbyte/clay/commit/f245939bb715cf3c0572822abcd7101aacb64cd0))
* **cli:** sync multi-user mode with startup config and hide esc hint on disclaimer ([cbbd665](https://github.com/chadbyte/clay/commit/cbbd6652e56775b2fba897e400f2fc0d3f077cb8))
* **presence:** only show cursor sharing toggle in multi-user mode ([a51bd6c](https://github.com/chadbyte/clay/commit/a51bd6ce0558843ee68474b256ececa1982009a4))
* **search:** search timeline now shows matches from full session history ([a053d37](https://github.com/chadbyte/clay/commit/a053d37c1e5de391a782340e8d7516750fb47f94))


### Features

* **presence:** add offscreen indicator, cursor toggle, and avatar ([ab83bab](https://github.com/chadbyte/clay/commit/ab83bab319985b36292b7b869438d0435dde3239))
* **presence:** add real-time cursor sharing between users ([12759b8](https://github.com/chadbyte/clay/commit/12759b85793ddc51706671f38043d399371796e3))
* **presence:** add real-time text selection sharing between users ([6b0b0b2](https://github.com/chadbyte/clay/commit/6b0b0b2e8e1a12b219b24ed0e9e42f3ad1dd97f1))
* **ui:** add in-session search and unify tooltip system ([56a6e4c](https://github.com/chadbyte/clay/commit/56a6e4c6d95c8310a02db1432ed800f4da94be93))
* **worktree:** add git worktree support with sidebar UI and lifecycle management ([f3733c5](https://github.com/chadbyte/clay/commit/f3733c55df99bc3eb5b9d0c0b553984054fd4794)), closes [#218](https://github.com/chadbyte/clay/issues/218)

# [2.11.0](https://github.com/chadbyte/clay/compare/v2.10.0...v2.11.0) (2026-03-18)


### Bug Fixes

* **admin:** fix broken admin section UI ([9af9e93](https://github.com/chadbyte/clay/commit/9af9e9351de0d6b0c7b7136b69ce2c33215af9db))
* **auth:** disable input on auth-required sessions and skip terminal on replay ([5b70fb1](https://github.com/chadbyte/clay/commit/5b70fb152b79b3ab70b9428a90a2d6e91a04d417))
* **auth:** grant project owner access to their own private projects ([edbbaa9](https://github.com/chadbyte/clay/commit/edbbaa98d7ebc4df3b2dd5381536caa0bb5e2e63))
* **auth:** hide input area when Claude Code is not logged in ([d1814ea](https://github.com/chadbyte/clay/commit/d1814ea91d9baf2ba94c85335984646d34029bf2))
* **cli:** allow --os-users flag when --multi-user is already enabled ([d31a895](https://github.com/chadbyte/clay/commit/d31a895af5b1cf8f51a55a2e622df32c643d715b))
* **cli:** correct sudo command in OS users mode guidance ([761cc0c](https://github.com/chadbyte/clay/commit/761cc0ce353649b00d21c57b91bb62f1e824eba6))
* **cli:** suppress console.clear in --debug mode and add foreground to initial setup ([2d4fd18](https://github.com/chadbyte/clay/commit/2d4fd1893369c2e11423fc2fdeee0e402a355322))
* **daemon:** chown project dir before git init as OS user ([0b2e6f5](https://github.com/chadbyte/clay/commit/0b2e6f5bc5ed841cfd59868ead0f7b81e144a520))
* **daemon:** pass PATH env when running git init as OS user ([e9fe51f](https://github.com/chadbyte/clay/commit/e9fe51f4d93465574f58b2ca11a47cf5e1abb825))
* **dm:** hide sticky notes on DM entry and restore session on return ([4e4e6a2](https://github.com/chadbyte/clay/commit/4e4e6a2d6ebe81d0102f3226ff4999ba37e97f61))
* **dm:** persist removed users server-side and add dust particles ([76943a5](https://github.com/chadbyte/clay/commit/76943a5cf8cf9b2c6e05ce45cf0ea0b03e411db5))
* **dm:** remove user from conversations list when unfavorited ([6be6f80](https://github.com/chadbyte/clay/commit/6be6f8062863808404ec8b05c35e138daebe662d))
* **dm:** route favorite messages to server and add particle effect ([cd69d19](https://github.com/chadbyte/clay/commit/cd69d1988c5822739f134b0405b1d867d019698a))
* **dm:** show online status dot in DM favorites user strip ([a066565](https://github.com/chadbyte/clay/commit/a0665656784921d61e02803fe17824e3dfed3bae))
* **os-users:** check for required system packages on startup ([903ee4d](https://github.com/chadbyte/clay/commit/903ee4db410f4859b0365a0c6c6d4e28b5d123e0))
* **os-users:** chmod package dir instead of copying worker to tmp ([af9fe0f](https://github.com/chadbyte/clay/commit/af9fe0ffcf4c87c0e8955aa6b01639b3fd066f3c))
* **os-users:** copy sdk-worker to temp path for user access ([6034ba0](https://github.com/chadbyte/clay/commit/6034ba03ba365957ee0765a17fd12aecfb1472e8))
* **os-users:** harden project isolation and fix CLI provisioning ([ee6965f](https://github.com/chadbyte/clay/commit/ee6965f227fdde4fe7b08cd85910158894dbefe0))
* **os-users:** include ownerId in project access response ([7ec7473](https://github.com/chadbyte/clay/commit/7ec7473ccaa17d6203449acf6b0b553f5d92649d))
* **os-users:** set NODE_PATH so copied worker can find SDK ([2354f77](https://github.com/chadbyte/clay/commit/2354f77c8e0e3abc96d92111b0edd765cc233b45))
* **plan:** switch focus to new session on clear context ([472501b](https://github.com/chadbyte/clay/commit/472501b2a8ceed493f6fd3e911672774fc8f42b6))
* **projects:** improve remove and re-add UX ([707449b](https://github.com/chadbyte/clay/commit/707449bcefe6a0c7973c102f318ab4986e4ba269))
* **sdk-bridge:** propagate worker exit errors to client sessions ([bc439df](https://github.com/chadbyte/clay/commit/bc439df7e9d060f12240c36b2ae69b49ed357359))
* **server:** use correct variable name in WS upgrade handler ([518fd71](https://github.com/chadbyte/clay/commit/518fd71ec2e7439fd280ea20b38ab3a68e0b511b))
* **server:** wire onRestart callback through to project context ([52d1e79](https://github.com/chadbyte/clay/commit/52d1e79fce86f3de5bc2eeee45fc4b049c589267)), closes [#219](https://github.com/chadbyte/clay/issues/219)
* **session:** auto-create session on connect and backfill legacy ownerId ([b1137fc](https://github.com/chadbyte/clay/commit/b1137fc1a2e4989e8d2c1a3055a8caf29d34f9fa))
* **sticky-notes:** cap minimized width and show Untitled for empty notes ([adc85a3](https://github.com/chadbyte/clay/commit/adc85a3e96259b79b33b10116de2e8f446f2d4b6))
* **sticky-notes:** show format toolbar when selection extends outside note ([7ac0d94](https://github.com/chadbyte/clay/commit/7ac0d94c3294f9dd321773290afc6f3c2ff49edc))
* **terminal:** prevent duplicate prompt on initial terminal open ([4279e53](https://github.com/chadbyte/clay/commit/4279e5360a96bb6a0e19c830b62c5b12bbc840ff))
* **terminal:** prevent terminal overflow below viewport ([61178fb](https://github.com/chadbyte/clay/commit/61178fb4ff0a37dd862ec0bdf86b8c4b42ca7837))
* **ui:** make diff view toggle bar sticky in file viewer ([d1caa60](https://github.com/chadbyte/clay/commit/d1caa609c23e12b0825f13fe6c73bd72b93ff813))
* **ui:** replace browser confirm with custom dialog for fork ([8c04ca3](https://github.com/chadbyte/clay/commit/8c04ca302546f87012812b57df594b707e2f1ac2))
* **ui:** route icon strip add button through openAddProjectModal ([a16f8cd](https://github.com/chadbyte/clay/commit/a16f8cd9fdbe69fa3ec6e9bb6c38f003d4028d49))
* **ui:** update DM add button tooltip to "Add DM favorite" ([7c889b3](https://github.com/chadbyte/clay/commit/7c889b377418f7b0bde68a336ddc56ddd1ba4541))
* **ui:** use theme-aware color for icon strip pill indicator ([2aadb18](https://github.com/chadbyte/clay/commit/2aadb18ff40323a87f123e56af1b94e0b10f6628)), closes [#fff](https://github.com/chadbyte/clay/issues/fff)
* **update:** restrict update notifications to admins and re-fetch on channel change ([9a9b83b](https://github.com/chadbyte/clay/commit/9a9b83b38e176ce61ab10504e5f091c2d458ed83))


### Features

* **admin:** add direct user creation with temporary PIN ([c9126e2](https://github.com/chadbyte/clay/commit/c9126e2336edc209ae1b80e53a6178189daac5d6))
* **auth:** show contextual welcome message and add favicon to PIN page ([2a9ea23](https://github.com/chadbyte/clay/commit/2a9ea23dca1fd4ff643d899957f8465d958223e9))
* **cli,admin:** redesign setup flow and add admin PIN reset ([e57e383](https://github.com/chadbyte/clay/commit/e57e3830335c0edce3b09364ee6d8744756f74bc))
* **cli:** require explicit "agree" for disclaimer and add OS users warning to setup wizard ([0b3a60c](https://github.com/chadbyte/clay/commit/0b3a60c73fe7a4695a2875394254b71e9a736443))
* **cli:** run daemon in foreground with --debug flag ([8ec6904](https://github.com/chadbyte/clay/commit/8ec690420cc2a8f9556764137074ab5be7eab886))
* **dm:** add favorites model to user strip with picker UI ([57c9d24](https://github.com/chadbyte/clay/commit/57c9d244bf0f0213c2ff36db39dc01093368da2b))
* **dm:** add P2P direct messaging between users ([4071eef](https://github.com/chadbyte/clay/commit/4071eefe0597f112fe8d2966b24fe2cc8cadafe8))
* **dm:** add right-click to remove user from DM favorites ([e56f329](https://github.com/chadbyte/clay/commit/e56f329ddeee71b4d5ed3d1830f804d77a102612))
* **dm:** show context menu on right-click for DM user icons ([f568713](https://github.com/chadbyte/clay/commit/f568713ad0da74a839127f7bc39aa9f734d36bfa))
* **os-users:** add OS-level user isolation with ACL management ([9641380](https://github.com/chadbyte/clay/commit/9641380bf641511ee552d13ce2072e7fd694b4b7))
* **os-users:** auto-install Claude CLI for newly provisioned users ([a05e9a6](https://github.com/chadbyte/clay/commit/a05e9a6d2c03eb2680bcba23deaf1a8d94529f33))
* **project:** add empty project creation and GitHub clone modes ([9c7bf96](https://github.com/chadbyte/clay/commit/9c7bf96919ee06170d1bd7643988fb6597150fac))
* **projects:** allow re-adding previously removed projects ([886369f](https://github.com/chadbyte/clay/commit/886369f725833bb9ee88e2cc2ec98828f5b14a3c))
* **projects:** auto-set ownership and visibility for non-admin users ([d459c26](https://github.com/chadbyte/clay/commit/d459c261c0a12b4b44dbef613a771e4d36b57803))
* **sdk:** add thinking config control to settings popover ([a0ef97a](https://github.com/chadbyte/clay/commit/a0ef97a5b76c7578d236037cb30945886b6306c4))
* **sdk:** enable agent progress summaries for subagent UI ([0ac4644](https://github.com/chadbyte/clay/commit/0ac46447da5ed5ae3ed0ca4421c35c8a83d2e4bc))
* **sdk:** upgrade agent SDK to 0.2.76 with elicitation and mid-query effort ([c21a201](https://github.com/chadbyte/clay/commit/c21a201080131e7099103cec16fcedabbcdc175e))
* **session:** add fork session from message hover action ([c68ccd8](https://github.com/chadbyte/clay/commit/c68ccd87b522d63cfefe6f624296bcb1b6a9eb41))
* **session:** unify session titles with SDK renameSession ([91278dd](https://github.com/chadbyte/clay/commit/91278dd2df9caf878e3f6e3b8af3dc95d8c02e3d))
* **terminal:** add clickable URLs, fix copy/paste, improve context menu ([c68ce14](https://github.com/chadbyte/clay/commit/c68ce1493d9b8a919a45e66aa0b48664ff951cd4))
* **terminal:** add multi-line URL detection for wrapped links ([7914475](https://github.com/chadbyte/clay/commit/79144753146dfdb085ec0e7d4c2172111a6495ac))
* **ui:** add remove project option to icon strip context menu ([c437675](https://github.com/chadbyte/clay/commit/c43767500a6fe6c5ee292178837cb51ea1428721))
* **ui:** add unread message badges to session list and project icons ([d09974b](https://github.com/chadbyte/clay/commit/d09974bc11624260bac1cebaba6a8035fa37cfa7))
* **update:** add beta update channel support ([afe552b](https://github.com/chadbyte/clay/commit/afe552b4682c8f12116dceb38efe7ba74d5fe3ed))

# [2.11.0-beta.28](https://github.com/chadbyte/clay/compare/v2.11.0-beta.27...v2.11.0-beta.28) (2026-03-18)


### Bug Fixes

* **auth:** hide input area when Claude Code is not logged in ([d1814ea](https://github.com/chadbyte/clay/commit/d1814ea91d9baf2ba94c85335984646d34029bf2))

# [2.11.0-beta.27](https://github.com/chadbyte/clay/compare/v2.11.0-beta.26...v2.11.0-beta.27) (2026-03-18)


### Bug Fixes

* **os-users:** include ownerId in project access response ([7ec7473](https://github.com/chadbyte/clay/commit/7ec7473ccaa17d6203449acf6b0b553f5d92649d))

# [2.11.0-beta.26](https://github.com/chadbyte/clay/compare/v2.11.0-beta.25...v2.11.0-beta.26) (2026-03-18)


### Bug Fixes

* **os-users:** check for required system packages on startup ([903ee4d](https://github.com/chadbyte/clay/commit/903ee4db410f4859b0365a0c6c6d4e28b5d123e0))

# [2.11.0-beta.25](https://github.com/chadbyte/clay/compare/v2.11.0-beta.24...v2.11.0-beta.25) (2026-03-18)


### Bug Fixes

* **cli:** suppress console.clear in --debug mode and add foreground to initial setup ([2d4fd18](https://github.com/chadbyte/clay/commit/2d4fd1893369c2e11423fc2fdeee0e402a355322))

# [2.11.0-beta.24](https://github.com/chadbyte/clay/compare/v2.11.0-beta.23...v2.11.0-beta.24) (2026-03-18)


### Features

* **cli:** run daemon in foreground with --debug flag ([8ec6904](https://github.com/chadbyte/clay/commit/8ec690420cc2a8f9556764137074ab5be7eab886))

# [2.11.0-beta.23](https://github.com/chadbyte/clay/compare/v2.11.0-beta.22...v2.11.0-beta.23) (2026-03-18)


### Bug Fixes

* **auth:** grant project owner access to their own private projects ([edbbaa9](https://github.com/chadbyte/clay/commit/edbbaa98d7ebc4df3b2dd5381536caa0bb5e2e63))
* **dm:** show online status dot in DM favorites user strip ([a066565](https://github.com/chadbyte/clay/commit/a0665656784921d61e02803fe17824e3dfed3bae))
* **sticky-notes:** show format toolbar when selection extends outside note ([7ac0d94](https://github.com/chadbyte/clay/commit/7ac0d94c3294f9dd321773290afc6f3c2ff49edc))

# [2.11.0-beta.22](https://github.com/chadbyte/clay/compare/v2.11.0-beta.21...v2.11.0-beta.22) (2026-03-18)


### Bug Fixes

* **sticky-notes:** cap minimized width and show Untitled for empty notes ([adc85a3](https://github.com/chadbyte/clay/commit/adc85a3e96259b79b33b10116de2e8f446f2d4b6))
* **terminal:** prevent duplicate prompt on initial terminal open ([4279e53](https://github.com/chadbyte/clay/commit/4279e5360a96bb6a0e19c830b62c5b12bbc840ff))
* **ui:** update DM add button tooltip to "Add DM favorite" ([7c889b3](https://github.com/chadbyte/clay/commit/7c889b377418f7b0bde68a336ddc56ddd1ba4541))

# [2.11.0-beta.21](https://github.com/chadbyte/clay/compare/v2.11.0-beta.20...v2.11.0-beta.21) (2026-03-18)


### Bug Fixes

* **auth:** disable input on auth-required sessions and skip terminal on replay ([5b70fb1](https://github.com/chadbyte/clay/commit/5b70fb152b79b3ab70b9428a90a2d6e91a04d417))

# [2.11.0-beta.20](https://github.com/chadbyte/clay/compare/v2.11.0-beta.19...v2.11.0-beta.20) (2026-03-18)


### Bug Fixes

* **os-users:** chmod package dir instead of copying worker to tmp ([af9fe0f](https://github.com/chadbyte/clay/commit/af9fe0ffcf4c87c0e8955aa6b01639b3fd066f3c))


### Features

* **projects:** auto-set ownership and visibility for non-admin users ([d459c26](https://github.com/chadbyte/clay/commit/d459c261c0a12b4b44dbef613a771e4d36b57803))

# [2.11.0-beta.19](https://github.com/chadbyte/clay/compare/v2.11.0-beta.18...v2.11.0-beta.19) (2026-03-18)


### Bug Fixes

* **os-users:** set NODE_PATH so copied worker can find SDK ([2354f77](https://github.com/chadbyte/clay/commit/2354f77c8e0e3abc96d92111b0edd765cc233b45))

# [2.11.0-beta.18](https://github.com/chadbyte/clay/compare/v2.11.0-beta.17...v2.11.0-beta.18) (2026-03-18)


### Bug Fixes

* **cli:** correct sudo command in OS users mode guidance ([761cc0c](https://github.com/chadbyte/clay/commit/761cc0ce353649b00d21c57b91bb62f1e824eba6))
* **os-users:** copy sdk-worker to temp path for user access ([6034ba0](https://github.com/chadbyte/clay/commit/6034ba03ba365957ee0765a17fd12aecfb1472e8))

# [2.11.0-beta.17](https://github.com/chadbyte/clay/compare/v2.11.0-beta.16...v2.11.0-beta.17) (2026-03-18)


### Bug Fixes

* **dm:** hide sticky notes on DM entry and restore session on return ([4e4e6a2](https://github.com/chadbyte/clay/commit/4e4e6a2d6ebe81d0102f3226ff4999ba37e97f61))
* **dm:** persist removed users server-side and add dust particles ([76943a5](https://github.com/chadbyte/clay/commit/76943a5cf8cf9b2c6e05ce45cf0ea0b03e411db5))
* **dm:** remove user from conversations list when unfavorited ([6be6f80](https://github.com/chadbyte/clay/commit/6be6f8062863808404ec8b05c35e138daebe662d))
* **dm:** route favorite messages to server and add particle effect ([cd69d19](https://github.com/chadbyte/clay/commit/cd69d1988c5822739f134b0405b1d867d019698a))
* **plan:** switch focus to new session on clear context ([472501b](https://github.com/chadbyte/clay/commit/472501b2a8ceed493f6fd3e911672774fc8f42b6))
* **projects:** improve remove and re-add UX ([707449b](https://github.com/chadbyte/clay/commit/707449bcefe6a0c7973c102f318ab4986e4ba269))
* **server:** use correct variable name in WS upgrade handler ([518fd71](https://github.com/chadbyte/clay/commit/518fd71ec2e7439fd280ea20b38ab3a68e0b511b))
* **server:** wire onRestart callback through to project context ([52d1e79](https://github.com/chadbyte/clay/commit/52d1e79fce86f3de5bc2eeee45fc4b049c589267)), closes [#219](https://github.com/chadbyte/clay/issues/219)
* **terminal:** prevent terminal overflow below viewport ([61178fb](https://github.com/chadbyte/clay/commit/61178fb4ff0a37dd862ec0bdf86b8c4b42ca7837))
* **ui:** make diff view toggle bar sticky in file viewer ([d1caa60](https://github.com/chadbyte/clay/commit/d1caa609c23e12b0825f13fe6c73bd72b93ff813))
* **ui:** use theme-aware color for icon strip pill indicator ([2aadb18](https://github.com/chadbyte/clay/commit/2aadb18ff40323a87f123e56af1b94e0b10f6628)), closes [#fff](https://github.com/chadbyte/clay/issues/fff)
* **update:** restrict update notifications to admins and re-fetch on channel change ([9a9b83b](https://github.com/chadbyte/clay/commit/9a9b83b38e176ce61ab10504e5f091c2d458ed83))


### Features

* **cli:** require explicit "agree" for disclaimer and add OS users warning to setup wizard ([0b3a60c](https://github.com/chadbyte/clay/commit/0b3a60c73fe7a4695a2875394254b71e9a736443))
* **dm:** add favorites model to user strip with picker UI ([57c9d24](https://github.com/chadbyte/clay/commit/57c9d244bf0f0213c2ff36db39dc01093368da2b))
* **dm:** add right-click to remove user from DM favorites ([e56f329](https://github.com/chadbyte/clay/commit/e56f329ddeee71b4d5ed3d1830f804d77a102612))
* **dm:** show context menu on right-click for DM user icons ([f568713](https://github.com/chadbyte/clay/commit/f568713ad0da74a839127f7bc39aa9f734d36bfa))
* **projects:** allow re-adding previously removed projects ([886369f](https://github.com/chadbyte/clay/commit/886369f725833bb9ee88e2cc2ec98828f5b14a3c))
* **ui:** add remove project option to icon strip context menu ([c437675](https://github.com/chadbyte/clay/commit/c43767500a6fe6c5ee292178837cb51ea1428721))
* **ui:** add unread message badges to session list and project icons ([d09974b](https://github.com/chadbyte/clay/commit/d09974bc11624260bac1cebaba6a8035fa37cfa7))

# [2.11.0-beta.16](https://github.com/chadbyte/clay/compare/v2.11.0-beta.15...v2.11.0-beta.16) (2026-03-17)


### Bug Fixes

* **sdk-bridge:** propagate worker exit errors to client sessions ([bc439df](https://github.com/chadbyte/clay/commit/bc439df7e9d060f12240c36b2ae69b49ed357359))

# [2.11.0-beta.15](https://github.com/chadbyte/clay/compare/v2.11.0-beta.14...v2.11.0-beta.15) (2026-03-17)


### Bug Fixes

* **os-users:** harden project isolation and fix CLI provisioning ([ee6965f](https://github.com/chadbyte/clay/commit/ee6965f227fdde4fe7b08cd85910158894dbefe0))

# [2.11.0-beta.14](https://github.com/chadbyte/clay/compare/v2.11.0-beta.13...v2.11.0-beta.14) (2026-03-17)


### Bug Fixes

* **daemon:** chown project dir before git init as OS user ([0b2e6f5](https://github.com/chadbyte/clay/commit/0b2e6f5bc5ed841cfd59868ead0f7b81e144a520))


### Features

* **auth:** show contextual welcome message and add favicon to PIN page ([2a9ea23](https://github.com/chadbyte/clay/commit/2a9ea23dca1fd4ff643d899957f8465d958223e9))

# [2.11.0-beta.13](https://github.com/chadbyte/clay/compare/v2.11.0-beta.12...v2.11.0-beta.13) (2026-03-17)


### Bug Fixes

* **daemon:** pass PATH env when running git init as OS user ([e9fe51f](https://github.com/chadbyte/clay/commit/e9fe51f4d93465574f58b2ca11a47cf5e1abb825))

# [2.11.0-beta.12](https://github.com/chadbyte/clay/compare/v2.11.0-beta.11...v2.11.0-beta.12) (2026-03-17)


### Features

* **cli,admin:** redesign setup flow and add admin PIN reset ([e57e383](https://github.com/chadbyte/clay/commit/e57e3830335c0edce3b09364ee6d8744756f74bc))
* **os-users:** auto-install Claude CLI for newly provisioned users ([a05e9a6](https://github.com/chadbyte/clay/commit/a05e9a6d2c03eb2680bcba23deaf1a8d94529f33))

# [2.11.0-beta.11](https://github.com/chadbyte/clay/compare/v2.11.0-beta.10...v2.11.0-beta.11) (2026-03-17)


### Features

* **terminal:** add multi-line URL detection for wrapped links ([7914475](https://github.com/chadbyte/clay/commit/79144753146dfdb085ec0e7d4c2172111a6495ac))

# [2.11.0-beta.10](https://github.com/chadbyte/clay/compare/v2.11.0-beta.9...v2.11.0-beta.10) (2026-03-17)


### Features

* **terminal:** add clickable URLs, fix copy/paste, improve context menu ([c68ce14](https://github.com/chadbyte/clay/commit/c68ce1493d9b8a919a45e66aa0b48664ff951cd4))

# [2.11.0-beta.9](https://github.com/chadbyte/clay/compare/v2.11.0-beta.8...v2.11.0-beta.9) (2026-03-17)


### Bug Fixes

* **session:** auto-create session on connect and backfill legacy ownerId ([b1137fc](https://github.com/chadbyte/clay/commit/b1137fc1a2e4989e8d2c1a3055a8caf29d34f9fa))

# [2.11.0-beta.8](https://github.com/chadbyte/clay/compare/v2.11.0-beta.7...v2.11.0-beta.8) (2026-03-17)


### Features

* **admin:** add direct user creation with temporary PIN ([c9126e2](https://github.com/chadbyte/clay/commit/c9126e2336edc209ae1b80e53a6178189daac5d6))

# [2.11.0-beta.7](https://github.com/chadbyte/clay/compare/v2.11.0-beta.6...v2.11.0-beta.7) (2026-03-17)


### Bug Fixes

* **ui:** route icon strip add button through openAddProjectModal ([a16f8cd](https://github.com/chadbyte/clay/commit/a16f8cd9fdbe69fa3ec6e9bb6c38f003d4028d49))

# [2.11.0-beta.6](https://github.com/chadbyte/clay/compare/v2.11.0-beta.5...v2.11.0-beta.6) (2026-03-17)


### Bug Fixes

* **cli:** allow --os-users flag when --multi-user is already enabled ([d31a895](https://github.com/chadbyte/clay/commit/d31a895af5b1cf8f51a55a2e622df32c643d715b))

# [2.11.0-beta.5](https://github.com/chadbyte/clay/compare/v2.11.0-beta.4...v2.11.0-beta.5) (2026-03-17)


### Features

* **os-users:** add OS-level user isolation with ACL management ([9641380](https://github.com/chadbyte/clay/commit/9641380bf641511ee552d13ce2072e7fd694b4b7))
* **project:** add empty project creation and GitHub clone modes ([9c7bf96](https://github.com/chadbyte/clay/commit/9c7bf96919ee06170d1bd7643988fb6597150fac))

# [2.11.0-beta.4](https://github.com/chadbyte/clay/compare/v2.11.0-beta.3...v2.11.0-beta.4) (2026-03-17)


### Bug Fixes

* **admin:** fix broken admin section UI ([9af9e93](https://github.com/chadbyte/clay/commit/9af9e9351de0d6b0c7b7136b69ce2c33215af9db))


### Features

* **update:** add beta update channel support ([afe552b](https://github.com/chadbyte/clay/commit/afe552b4682c8f12116dceb38efe7ba74d5fe3ed))

# [2.11.0-beta.3](https://github.com/chadbyte/clay/compare/v2.11.0-beta.2...v2.11.0-beta.3) (2026-03-16)


### Bug Fixes

* **ui:** replace browser confirm with custom dialog for fork ([8c04ca3](https://github.com/chadbyte/clay/commit/8c04ca302546f87012812b57df594b707e2f1ac2))

# [2.11.0-beta.2](https://github.com/chadbyte/clay/compare/v2.11.0-beta.1...v2.11.0-beta.2) (2026-03-16)


### Features

* **sdk:** add thinking config control to settings popover ([a0ef97a](https://github.com/chadbyte/clay/commit/a0ef97a5b76c7578d236037cb30945886b6306c4))
* **sdk:** enable agent progress summaries for subagent UI ([0ac4644](https://github.com/chadbyte/clay/commit/0ac46447da5ed5ae3ed0ca4421c35c8a83d2e4bc))
* **sdk:** upgrade agent SDK to 0.2.76 with elicitation and mid-query effort ([c21a201](https://github.com/chadbyte/clay/commit/c21a201080131e7099103cec16fcedabbcdc175e))
* **session:** add fork session from message hover action ([c68ccd8](https://github.com/chadbyte/clay/commit/c68ccd87b522d63cfefe6f624296bcb1b6a9eb41))
* **session:** unify session titles with SDK renameSession ([91278dd](https://github.com/chadbyte/clay/commit/91278dd2df9caf878e3f6e3b8af3dc95d8c02e3d))

# [2.11.0-beta.1](https://github.com/chadbyte/clay/compare/v2.10.0...v2.11.0-beta.1) (2026-03-15)


### Features

* **dm:** add P2P direct messaging between users ([4071eef](https://github.com/chadbyte/clay/commit/4071eefe0597f112fe8d2966b24fe2cc8cadafe8))

# [2.10.0](https://github.com/chadbyte/clay/compare/v2.9.3...v2.10.0) (2026-03-15)


### Bug Fixes

* **auth:** redirect to login on reconnect when auth token is expired ([d6476e4](https://github.com/chadbyte/clay/commit/d6476e4fa00245e1bd2670efce801636c31d9f79))
* **session:** set active session on ws before broadcasting session list ([ca72260](https://github.com/chadbyte/clay/commit/ca7226046cf66a06033eaf63c194f73bcb0eaf01))


### Features

* **ui:** show images inline when Claude reads image files ([#217](https://github.com/chadbyte/clay/issues/217)) ([d9c1cd5](https://github.com/chadbyte/clay/commit/d9c1cd54a2dba09c0477b02373e26dad10935c97)), closes [#216](https://github.com/chadbyte/clay/issues/216)

# [2.10.0-beta.1](https://github.com/chadbyte/clay/compare/v2.9.4-beta.1...v2.10.0-beta.1) (2026-03-15)


### Features

* **ui:** show images inline when Claude reads image files ([#217](https://github.com/chadbyte/clay/issues/217)) ([d9c1cd5](https://github.com/chadbyte/clay/commit/d9c1cd54a2dba09c0477b02373e26dad10935c97)), closes [#216](https://github.com/chadbyte/clay/issues/216)

## [2.9.4-beta.1](https://github.com/chadbyte/clay/compare/v2.9.3...v2.9.4-beta.1) (2026-03-14)


### Bug Fixes

* **auth:** redirect to login on reconnect when auth token is expired ([d6476e4](https://github.com/chadbyte/clay/commit/d6476e4fa00245e1bd2670efce801636c31d9f79))
* **session:** set active session on ws before broadcasting session list ([ca72260](https://github.com/chadbyte/clay/commit/ca7226046cf66a06033eaf63c194f73bcb0eaf01))

## [2.9.3](https://github.com/chadbyte/clay/compare/v2.9.2...v2.9.3) (2026-03-14)


### Bug Fixes

* **ci:** also override GITHUB_REF_NAME for stable release ([9d63dc5](https://github.com/chadbyte/clay/commit/9d63dc5675768e8b1cbf738db4c2ae711d8f09e3))
* **ci:** override GITHUB_REF for stable release job ([9c7dae1](https://github.com/chadbyte/clay/commit/9c7dae1cf38f897f249e5892616019bc515c809d))
* **ci:** restructure stable release to dispatch on release branch ([bedd7a8](https://github.com/chadbyte/clay/commit/bedd7a885a37f63a04d8f43032778fb787a48dbc))
* **release:** add --tag flag for prerelease alias publishing ([2575627](https://github.com/chadbyte/clay/commit/2575627b148f713b39d466347332cf06edfe8aec))
* **release:** write .npmrc in alias temp dir for CI auth ([fab3b8e](https://github.com/chadbyte/clay/commit/fab3b8eb640c5c114a98e5cf8c637fceaa35f7a1))
* **sdk-bridge:** handle agent task stop without process errors ([95c5b1b](https://github.com/chadbyte/clay/commit/95c5b1b6b2447acf286810a1e7f5ec9b46cca89a)), closes [#209](https://github.com/chadbyte/clay/issues/209)
* **sdk-bridge:** resolve agent task stop and info message rendering ([ddb1184](https://github.com/chadbyte/clay/commit/ddb1184029e9bd521061d3b77a75844eb7f686c6)), closes [#209](https://github.com/chadbyte/clay/issues/209)
* **security:** allow all image sources in CSP policy ([93a8f24](https://github.com/chadbyte/clay/commit/93a8f24f83b12460edc8913d8a3fece7c39b4c95)), closes [#211](https://github.com/chadbyte/clay/issues/211)

## [2.9.3-beta.7](https://github.com/chadbyte/clay/compare/v2.9.3-beta.6...v2.9.3-beta.7) (2026-03-14)


### Bug Fixes

* **ci:** restructure stable release to dispatch on release branch ([bedd7a8](https://github.com/chadbyte/clay/commit/bedd7a885a37f63a04d8f43032778fb787a48dbc))

## [2.9.3-beta.6](https://github.com/chadbyte/clay/compare/v2.9.3-beta.5...v2.9.3-beta.6) (2026-03-14)


### Bug Fixes

* **ci:** also override GITHUB_REF_NAME for stable release ([9d63dc5](https://github.com/chadbyte/clay/commit/9d63dc5675768e8b1cbf738db4c2ae711d8f09e3))

## [2.9.3-beta.5](https://github.com/chadbyte/clay/compare/v2.9.3-beta.4...v2.9.3-beta.5) (2026-03-14)


### Bug Fixes

* **ci:** override GITHUB_REF for stable release job ([9c7dae1](https://github.com/chadbyte/clay/commit/9c7dae1cf38f897f249e5892616019bc515c809d))

## [2.9.3-beta.4](https://github.com/chadbyte/clay/compare/v2.9.3-beta.3...v2.9.3-beta.4) (2026-03-14)


### Bug Fixes

* **sdk-bridge:** handle agent task stop without process errors ([95c5b1b](https://github.com/chadbyte/clay/commit/95c5b1b6b2447acf286810a1e7f5ec9b46cca89a)), closes [#209](https://github.com/chadbyte/clay/issues/209)
* **sdk-bridge:** resolve agent task stop and info message rendering ([ddb1184](https://github.com/chadbyte/clay/commit/ddb1184029e9bd521061d3b77a75844eb7f686c6)), closes [#209](https://github.com/chadbyte/clay/issues/209)

## [2.9.3-beta.3](https://github.com/chadbyte/clay/compare/v2.9.3-beta.2...v2.9.3-beta.3) (2026-03-14)


### Bug Fixes

* **security:** allow all image sources in CSP policy ([93a8f24](https://github.com/chadbyte/clay/commit/93a8f24f83b12460edc8913d8a3fece7c39b4c95)), closes [#211](https://github.com/chadbyte/clay/issues/211)

## [2.9.3-beta.2](https://github.com/chadbyte/clay/compare/v2.9.3-beta.1...v2.9.3-beta.2) (2026-03-14)


### Bug Fixes

* **release:** write .npmrc in alias temp dir for CI auth ([fab3b8e](https://github.com/chadbyte/clay/commit/fab3b8eb640c5c114a98e5cf8c637fceaa35f7a1))

## [2.9.3-beta.1](https://github.com/chadbyte/clay/compare/v2.9.2...v2.9.3-beta.1) (2026-03-14)


### Bug Fixes

* **release:** add --tag flag for prerelease alias publishing ([2575627](https://github.com/chadbyte/clay/commit/2575627b148f713b39d466347332cf06edfe8aec))

# 1.0.0-beta.1 (2026-03-14)


### Bug Fixes

* --headless exits immediately when daemon is already running ([01cbcb0](https://github.com/chadbyte/clay/commit/01cbcb0ae2cc3dcd758f23fd816730a477d4778d))
* /clear resets context mini bar to 0% instead of hiding it ([dd13896](https://github.com/chadbyte/clay/commit/dd13896934ac74fc26fd82620848e2ccb7938523))
* answered AskUserQuestion reverts to pending on page refresh ([#79](https://github.com/chadbyte/clay/issues/79)) ([0e94c33](https://github.com/chadbyte/clay/commit/0e94c33690e5a2c840ea50ae8a8eb03b46649c86))
* auto-cleanup sessions on disconnect and graceful shutdown ([#86](https://github.com/chadbyte/clay/issues/86)) ([87143a9](https://github.com/chadbyte/clay/commit/87143a92db87a0e1b7641212dd3cda8851e956d4))
* auto-restart daemon with TLS when mkcert is available ([#90](https://github.com/chadbyte/clay/issues/90)) ([6f57753](https://github.com/chadbyte/clay/commit/6f57753e48af5ee9bc59d07ccfd076012690fd60))
* constrain terminal height to visible area above keyboard on mobile ([#57](https://github.com/chadbyte/clay/issues/57)) ([dc29353](https://github.com/chadbyte/clay/commit/dc293538b9ff84dad16452594533d6f6dd3583ce))
* context panel token calculation and /clear cleanup ([bc2faa0](https://github.com/chadbyte/clay/commit/bc2faa08bf716ae7214b6fbc3850be1f9eeb10d8))
* deduplicate approval prompts on tab visibility change ([#112](https://github.com/chadbyte/clay/issues/112)) ([684029d](https://github.com/chadbyte/clay/commit/684029d7a55d30c3ab2ed4ccafc7fac09d2a16d6))
* duplicate push notifications from separate SW scopes ([c261d4d](https://github.com/chadbyte/clay/commit/c261d4d8d89b302f6abcbb2a2409651e5f02a834))
* fallback CLI rendering for macOS Terminal.app ([3fd3017](https://github.com/chadbyte/clay/commit/3fd3017bdfd412a4001c25bbabc965b273e5eac3))
* **file-viewer:** set tab-size on file viewer pre elements ([5070184](https://github.com/chadbyte/clay/commit/5070184b7cd1e9a6de1f2ffc09bb99fcd9e11015))
* finalize incomplete turns on history replay and skip redundant delta renders ([#129](https://github.com/chadbyte/clay/issues/129)) ([9b73b2c](https://github.com/chadbyte/clay/commit/9b73b2c34241e246bf8bf7ae5350d22f83877ab1))
* gate /info endpoint behind auth, remove cwd exposure ([b6ef4bf](https://github.com/chadbyte/clay/commit/b6ef4bf8b597fcfb18edaa2503eb2fa4e1fd13a8)), closes [#47](https://github.com/chadbyte/clay/issues/47)
* hide keep-awake option on non-macOS platforms ([21a93ed](https://github.com/chadbyte/clay/commit/21a93ed4198126ca5087c17184716859ce13ceb8))
* improve LAN setup flow and cert generation ([#90](https://github.com/chadbyte/clay/issues/90)) ([f434839](https://github.com/chadbyte/clay/commit/f43483961a076326bc6e2a7c41e6c9d2c7ea20cc))
* improve LAN setup flow and cert generation ([#90](https://github.com/chadbyte/clay/issues/90)) ([2a25eeb](https://github.com/chadbyte/clay/commit/2a25eeb8b9f49df26fac0c32494bdbbcdcb3dcbc))
* increase send/stop button to 44px tap target ([#50](https://github.com/chadbyte/clay/issues/50)) ([e342ddc](https://github.com/chadbyte/clay/commit/e342ddc1b00ede7f17be38939acc7ac8d6de5b99))
* iOS onboarding page misreports certificate as untrusted ([8d30a95](https://github.com/chadbyte/clay/commit/8d30a9571232f2d8e6c5a222c0c69b1613a27c7f))
* iOS push notifications and notification click navigation ([#94](https://github.com/chadbyte/clay/issues/94)) ([606ef9b](https://github.com/chadbyte/clay/commit/606ef9b34c376785b92c5efbeca62a8f3f174135))
* keep original session files for backward compatibility ([3396ae3](https://github.com/chadbyte/clay/commit/3396ae39ce5e970b8b964622c87cd470cadbfe01))
* load CLAUDE.md and settings files in SDK sessions ([e2b7673](https://github.com/chadbyte/clay/commit/e2b767393e53cc2d7234a22e268641aa70a404be))
* merge global and project skills for slash menu ([#160](https://github.com/chadbyte/clay/issues/160)) ([5d5d437](https://github.com/chadbyte/clay/commit/5d5d4379cc1c2b6adf50b3d0fbd74325f0d1470f))
* never abort queries on client disconnect ([#113](https://github.com/chadbyte/clay/issues/113)) ([54ef613](https://github.com/chadbyte/clay/commit/54ef61360dc55680bbc49bdfca0fa160b5726c49))
* persist lastRewindUuid across daemon restarts ([831b45d](https://github.com/chadbyte/clay/commit/831b45df08a0df71eff14fb51d2bfa1a5afae31b))
* polyfill Symbol.dispose for Node 18 compatibility ([#116](https://github.com/chadbyte/clay/issues/116)) ([9056bf0](https://github.com/chadbyte/clay/commit/9056bf0aaae55e8c0c29079db9e10ab453891198))
* prevent iOS Safari from URL-encoding copied text ([#123](https://github.com/chadbyte/clay/issues/123)) ([64a0f47](https://github.com/chadbyte/clay/commit/64a0f47e12363a6eaff519eb562295128bc09387))
* purge stale push subscriptions on startup ([#51](https://github.com/chadbyte/clay/issues/51)) ([fdf5b8f](https://github.com/chadbyte/clay/commit/fdf5b8f3f40bf82546c4dbf2c9ff7ac19d9b4126))
* push notification reliability, share URL, setup flow, and session restore ([319c374](https://github.com/chadbyte/clay/commit/319c374371aa8e53addc9de5922b3d4ab4520c19))
* redirect to dashboard with toast when accessing a removed project ([a2c582a](https://github.com/chadbyte/clay/commit/a2c582a63631f50a8ec7a8ec2e0aca8c2b1dfcb4))
* remove /https-info from onboarding server to prevent auto-redirect ([55cf24f](https://github.com/chadbyte/clay/commit/55cf24f6b70e40e2ff46dcd0d40d1bbafb8aebcd))
* remove duplicate plan content from plan approval UI ([135006c](https://github.com/chadbyte/clay/commit/135006cbe9b6305faaf526286b2e4f276c4fe8fc))
* remove inherited CLAUDECODE env var to prevent nested session error ([47bfae3](https://github.com/chadbyte/clay/commit/47bfae34ee235dd66e1c3f81c84e20d8bc888758)), closes [#161](https://github.com/chadbyte/clay/issues/161)
* restore move-and-cleanup session migration ([e4ca7f0](https://github.com/chadbyte/clay/commit/e4ca7f008794fcbe9dc10965a394b702721fa6b0))
* retry daemon alive check on startup instead of single 800ms wait ([fc3918a](https://github.com/chadbyte/clay/commit/fc3918a18596315febfc5459d0f814330fc12857))
* run first-time setup in dev mode and reuse config on subsequent runs ([a4d5f37](https://github.com/chadbyte/clay/commit/a4d5f37e5fe3283769c70a32cd078964f94b04e8))
* session reordering on click, project switcher state loss ([7e4251c](https://github.com/chadbyte/clay/commit/7e4251cbca472216f9107a73923283ac02f095e1))
* setup flow broken after daemon refactor — PWA and push registration ([1da14cc](https://github.com/chadbyte/clay/commit/1da14cc7974ea6722cc63857759d2e473a5f4a48))
* show active task in collapsed sticky todo, pass toggleUsagePanel to notifications ctx ([aac1052](https://github.com/chadbyte/clay/commit/aac1052cd7fa2198e8be6c3208e4a3e3968c1379))
* show blocked hint when push notification permission is denied ([8278255](https://github.com/chadbyte/clay/commit/827825517ab88272456e47dab4722ea2c7a464c6))
* show CLI menu in dev mode and fix duplicate SIGINT handling ([c8fb5e8](https://github.com/chadbyte/clay/commit/c8fb5e84434cce1cdc38c84f2eaf73705e735071))
* show Edit tool diff with line numbers, file header, and split view ([#73](https://github.com/chadbyte/clay/issues/73)) ([cc94763](https://github.com/chadbyte/clay/commit/cc9476371be64838486e3fd289ad6144c24a1269))
* show iOS Safari PWA guidance instead of broken notification toggle ([#121](https://github.com/chadbyte/clay/issues/121)) ([efbf4df](https://github.com/chadbyte/clay/commit/efbf4df545c0e4ee73354093ae98237a83fdcf9f))
* show platform-appropriate mkcert install command ([d37cb29](https://github.com/chadbyte/clay/commit/d37cb2998618f0e0847e7c18e77e5776d8e4d005))
* stop auto-registering cwd as project on startup ([2af2067](https://github.com/chadbyte/clay/commit/2af2067a59f5fbcdfeb32c1290d59ecd245913d6)), closes [#138](https://github.com/chadbyte/clay/issues/138)
* suppress all push notifications when PWA is in foreground ([#53](https://github.com/chadbyte/clay/issues/53)) ([aa2b765](https://github.com/chadbyte/clay/commit/aa2b7659fdd97e672a3d49078e5568b0e85bf94e))
* surface SDK import failures to user ([#56](https://github.com/chadbyte/clay/issues/56)) ([f3f0ae6](https://github.com/chadbyte/clay/commit/f3f0ae6baca14664f5919df2146fbfc589021f70))
* UI polish — terminal icons, project dropdown, add-project modal ([7c271a3](https://github.com/chadbyte/clay/commit/7c271a354cb178dc88527ac0bc40196f0b5af68b))
* use named pipe for IPC on Windows ([74ac4a4](https://github.com/chadbyte/clay/commit/74ac4a4e9a4adbc93fd2e1def07c6aabedc67db8))
* Windows compatibility across the codebase ([b1223bf](https://github.com/chadbyte/clay/commit/b1223bf056f07d61e7c3bc7d22a7cd859d5165e5))


### Features

* /clear now starts a new session instead of just hiding messages ([d65729f](https://github.com/chadbyte/clay/commit/d65729fe1c5d391443e5eb69667b514da5895604))
* /context command with context window usage panel ([#84](https://github.com/chadbyte/clay/issues/84)) ([cfcd526](https://github.com/chadbyte/clay/commit/cfcd5268f342a7c25ddd2304e016c47e19245d67))
* add --add, --remove, --list CLI flags for project management ([#75](https://github.com/chadbyte/clay/issues/75)) ([7e601b5](https://github.com/chadbyte/clay/commit/7e601b56ddedf359638bc7fb4e7a03213afca059))
* add --headless flag for non-interactive daemon startup ([e83ec3d](https://github.com/chadbyte/clay/commit/e83ec3d6906a788cd3b60f8fcc36b5c4e3dbdc20))
* add --shutdown flag to stop daemon from CLI ([3a68bfc](https://github.com/chadbyte/clay/commit/3a68bfc495de58d6c4aaa850183e272045606ad2))
* add auto-update support and bump to v1.2.0 ([bffb1d2](https://github.com/chadbyte/clay/commit/bffb1d2f258d485205916c2db50d6059fe1a336c))
* add base16 theme system with 22 bundled themes ([0a1b29a](https://github.com/chadbyte/clay/commit/0a1b29a5edeca3919073776ca23ea59e7c4f1d64))
* add code viewer with line number gutter and syntax highlighting for Read tool results ([ff7e0a7](https://github.com/chadbyte/clay/commit/ff7e0a707cba36e56d1ffece8b4e95e246bf4f83))
* add conversation rewind with file restore and diff preview ([41fc502](https://github.com/chadbyte/clay/commit/41fc502fa24616832a6e2f197584af5e84f94b53))
* add copy button to implementation plan card ([b862af7](https://github.com/chadbyte/clay/commit/b862af786f3aebb093ef51638606459640eac72c))
* add Ctrl+J newline shortcut and QR code overlay ([a3eceb9](https://github.com/chadbyte/clay/commit/a3eceb9791ed67bded731b98ecdeb58496183b77))
* add HTTP onboarding port for new device certificate setup ([3f69301](https://github.com/chadbyte/clay/commit/3f69301713ac01660392c6d4712276511b26511b))
* add image attach button with camera and photo picker ([#48](https://github.com/chadbyte/clay/issues/48)) ([0ff8a38](https://github.com/chadbyte/clay/commit/0ff8a38652177614321c4a38bf57f562329f2ffb))
* add model switching UI in header ([#67](https://github.com/chadbyte/clay/issues/67)) ([0924da5](https://github.com/chadbyte/clay/commit/0924da53455157815f72709df78821ee5141b727))
* add process status panel with /status command ([#85](https://github.com/chadbyte/clay/issues/85)) ([010a41b](https://github.com/chadbyte/clay/commit/010a41bc0483d67cb529ca93c0185eb0f8d2a162))
* add read-only file browser with sidebar tab and code viewer ([42cc4d1](https://github.com/chadbyte/clay/commit/42cc4d1c6dfcd45a3d5a6a72b4ff4cc15db6656e))
* add resume CLI session, reuse AudioContext ([38994e6](https://github.com/chadbyte/clay/commit/38994e6ce8951e7eb45695f527273099df64377f))
* add right-click context menu to terminal with copy and clear actions ([7811ede](https://github.com/chadbyte/clay/commit/7811edefd7d6ce95176d7c2a9b3a43c67f925859))
* add RTL (bidi) text support for prompt field and responses ([#114](https://github.com/chadbyte/clay/issues/114)) ([410b37f](https://github.com/chadbyte/clay/commit/410b37f3cd4c12283dd353d2b5e05832dee2d31a))
* add special key toolbar for terminal on mobile ([#58](https://github.com/chadbyte/clay/issues/58)) ([2705cc3](https://github.com/chadbyte/clay/commit/2705cc3f374b56b0943a7586b4c90dff735fa51c))
* add usage panel with /usage slash command ([#66](https://github.com/chadbyte/clay/issues/66)) ([2db4565](https://github.com/chadbyte/clay/commit/2db4565a4608315269fdd3e64ff0887ac73fb324))
* add web push notifications via VAPID for permission approvals and done events ([618da3a](https://github.com/chadbyte/clay/commit/618da3aa0f55d1af4fd7d84802e2235bca5fbbd0))
* add web terminal with PTY via @lydell/node-pty and xterm.js ([f0d87ae](https://github.com/chadbyte/clay/commit/f0d87aed8e276ad76961b92726a83abd744e9fe4))
* add WebSocket Origin header validation ([8fd5ad1](https://github.com/chadbyte/clay/commit/8fd5ad147094a6994d34c5281b5ba1008b0745bd)), closes [#46](https://github.com/chadbyte/clay/issues/46)
* add/remove projects from web UI ([7afd992](https://github.com/chadbyte/clay/commit/7afd992fc5a231ae160caa0f861c86b81160d9f6)), closes [#131](https://github.com/chadbyte/clay/issues/131)
* allow claude-relay-dev to run independently from production daemon ([d9fcc35](https://github.com/chadbyte/clay/commit/d9fcc35c463f4c2d915725993d45042977de15da))
* allow sending messages while processing ([#52](https://github.com/chadbyte/clay/issues/52)) ([1d5de77](https://github.com/chadbyte/clay/commit/1d5de77209f9cac92f57c9104a739ec4f8f431b0))
* auto-focus input on session switch ([#98](https://github.com/chadbyte/clay/issues/98)) ([6e2f8d5](https://github.com/chadbyte/clay/commit/6e2f8d5d25289da90c6fe14c79e924fa78802e57))
* auto-hop port when in use ([0dcdd99](https://github.com/chadbyte/clay/commit/0dcdd99f6b495f2a329ef361e3622f5baa7649a9))
* auto-restart daemon on crash with project recovery and client notification ([#101](https://github.com/chadbyte/clay/issues/101)) ([cf33bab](https://github.com/chadbyte/clay/commit/cf33bab4532a7d429f329e163f8437fda2d41288))
* CLI branding, pixel character, dynamic favicon, and response fallback ([2e6f190](https://github.com/chadbyte/clay/commit/2e6f190d7885c1612b74ee3acb1afa1b7ac364ee))
* CLI session picker for resuming conversations from the web UI ([96dc290](https://github.com/chadbyte/clay/commit/96dc29066a36dd6051ec8a450ecce6d804a98f01))
* **cli:** add QR code for web UI URL in terminal ([16602fc](https://github.com/chadbyte/clay/commit/16602fc22b2ac7b6826c2dd1e6cf261476b96e4a))
* dev mode with foreground daemon and auto-restart on file changes ([65263ad](https://github.com/chadbyte/clay/commit/65263adfe4cc923f53a458690acca62f88f24e5c)), closes [#135](https://github.com/chadbyte/clay/issues/135)
* file browser refresh button and auto-refresh on directory changes ([#89](https://github.com/chadbyte/clay/issues/89)) ([653d6f2](https://github.com/chadbyte/clay/commit/653d6f24f74fcc782f6a56f1a34204df76d16bf8))
* file history diff viewer, compare, and navigation improvements ([d1ef6e4](https://github.com/chadbyte/clay/commit/d1ef6e479169cb9e40ce32709a676c5c37deee12))
* full-text session search with hit timeline ([d4ab79f](https://github.com/chadbyte/clay/commit/d4ab79f66415abdd08682d5edf2466570ba22c8b))
* green/yellow/red color coding for context bar ([eeb0b3f](https://github.com/chadbyte/clay/commit/eeb0b3f2b65d935f5eb83d437ba1a4f9f8334042))
* group consecutive tool calls with collapsed summary header ([763b088](https://github.com/chadbyte/clay/commit/763b088cc56c3e9c8ae737204c021ffc4054fa56))
* hold scroll position when user is reading earlier messages ([#49](https://github.com/chadbyte/clay/issues/49)) ([60bad97](https://github.com/chadbyte/clay/commit/60bad9780df83eefcbe14350722514f6bf615dc6))
* HTTPS support, interactive setup, permission UI, and multi-device sync ([ab4416a](https://github.com/chadbyte/clay/commit/ab4416af774a86230799200ca729df84d92e6024))
* image lightbox modal with click-to-preview ([#82](https://github.com/chadbyte/clay/issues/82)) ([7443fa8](https://github.com/chadbyte/clay/commit/7443fa8f062246e2b37d678b9e5c9b4dc390a914))
* live-reload file viewer on external changes ([#80](https://github.com/chadbyte/clay/issues/80)) ([3112b3b](https://github.com/chadbyte/clay/commit/3112b3b0388010d6870dfafc2d750bca0f2701a2))
* mermaid diagram rendering, shared TLS certs, and clipboard fallback ([dddc77f](https://github.com/chadbyte/clay/commit/dddc77fe43527079bea47c0079ebcb179687a06a))
* minimizable context panel with inline mini bar ([#96](https://github.com/chadbyte/clay/issues/96)) ([5279a5a](https://github.com/chadbyte/clay/commit/5279a5a946e636e2d7850bf76c8259b0ad6cd3ad))
* paste file paths from Finder into chat input ([#81](https://github.com/chadbyte/clay/issues/81)) ([3148bf8](https://github.com/chadbyte/clay/commit/3148bf820363839486f4999f013ca3a87367061d))
* persist context panel view state across sessions and restarts ([4501a28](https://github.com/chadbyte/clay/commit/4501a28c2fbefa39c418d6c32d6767de14d1516c))
* persist context panel view state across sessions and restarts ([02b68fc](https://github.com/chadbyte/clay/commit/02b68fc20fd23fe4eeda02cb970eba7b57962a5b))
* persistent multi-tab terminal sessions ([#76](https://github.com/chadbyte/clay/issues/76)) ([eaf6717](https://github.com/chadbyte/clay/commit/eaf67171b69b11625ae257235ba9f157a563e589))
* preserve unsent input drafts per session ([#60](https://github.com/chadbyte/clay/issues/60)) ([14c70e0](https://github.com/chadbyte/clay/commit/14c70e0421d8ec93823371863573f93d93f45f5c))
* progressive history loading with paginated replay ([b110aac](https://github.com/chadbyte/clay/commit/b110aac935d674316e11189f38f8b571259cf45a))
* project persistence via ~/.clayrc, CLI improvements, project switcher fix ([bdff296](https://github.com/chadbyte/clay/commit/bdff2967fc2f08603d4b7c1b9ae6e64ba3b63047))
* rate limit PIN attempts (5 tries, 15min lockout) ([39552ee](https://github.com/chadbyte/clay/commit/39552ee51447361822acb7f559c7e23d09b6670d)), closes [#45](https://github.com/chadbyte/clay/issues/45)
* render ExitPlanMode as plan confirmation UI ([#74](https://github.com/chadbyte/clay/issues/74)) ([e34067f](https://github.com/chadbyte/clay/commit/e34067f7e0d338de9d4935911e293b7046db54de))
* rewind mode selection for chat-only, files-only, or both ([#43](https://github.com/chadbyte/clay/issues/43)) ([e99a3b5](https://github.com/chadbyte/clay/commit/e99a3b5eafdaf1710474642f04bd850522a72645))
* show compacting indicator when session context is compacted ([#44](https://github.com/chadbyte/clay/issues/44)) ([a4215fa](https://github.com/chadbyte/clay/commit/a4215fab3d486727be79d6aa3c546d6415b0224e))
* show rate limit bars in usage panel ([#66](https://github.com/chadbyte/clay/issues/66)) ([be05d31](https://github.com/chadbyte/clay/commit/be05d31bf6b91d62391ca0bd8721dbc76c26f628))
* show sub-agent (Task tool) activity in real-time ([#77](https://github.com/chadbyte/clay/issues/77)) ([dcf6257](https://github.com/chadbyte/clay/commit/dcf625756825b5e54634ac51f959ebfc595af284))
* sidebar redesign — project switcher, date-grouped sessions, unified actions ([fe8a376](https://github.com/chadbyte/clay/commit/fe8a3768bbf315c1be4b2a67b84fcb764ae67971))
* sidebar tabs, split file viewer, markdown toggle, file-icons-js ([6faaf7b](https://github.com/chadbyte/clay/commit/6faaf7b49c2a4aca10bda65c86994435734c6665))
* smart sticky todo visibility and collapsed progress bar ([9dfa6e0](https://github.com/chadbyte/clay/commit/9dfa6e0e8575c8ff3f099d9bdeda2a83a9d5e5c2))
* sticky overlay for TodoWrite tasks during scroll ([#78](https://github.com/chadbyte/clay/issues/78)) ([40e570c](https://github.com/chadbyte/clay/commit/40e570c80fe11fdb75fc9bff28e7c8a21051fae1))
* support --dangerously-skip-permissions mode ([#100](https://github.com/chadbyte/clay/issues/100)) ([a685361](https://github.com/chadbyte/clay/commit/a6853614162252ea87f43b27f259545c767510cf))
* support newline input on mobile keyboard ([#68](https://github.com/chadbyte/clay/issues/68)) ([a503242](https://github.com/chadbyte/clay/commit/a503242ff95db95d0b3dff5aab215a3c82333645))
* UI polish batch (terminal badge, tab rename, share, scrollbar, tooltip, usage menu) ([9e9919d](https://github.com/chadbyte/clay/commit/9e9919df8f83e1a9047797db7b0095237ab03892))
* **ui:** add browser notifications when Claude finishes ([26207ca](https://github.com/chadbyte/clay/commit/26207ca9442a01bd9d2bf650371fedce498a52ce))
* **ui:** add click-to-copy for assistant messages and bump to v1.2.6 ([93e0bec](https://github.com/chadbyte/clay/commit/93e0bec543024df53a9b253726004a31379c97c5))
* **ui:** add collapsible sidebar toggle and bump to v1.2.3 ([95b3274](https://github.com/chadbyte/clay/commit/95b3274f7415bab7a37b635dc68ccd43e1c87113))
* **ui:** add copy button to code blocks ([659d056](https://github.com/chadbyte/clay/commit/659d056d89da7141509e23d8e790ae2b48d188a1))
* **ui:** add notification settings menu with toggles ([ee3d8b5](https://github.com/chadbyte/clay/commit/ee3d8b533f7ed707c743a87e81fedc55cadb0b90))
* **ui:** add session deletion ([d00355e](https://github.com/chadbyte/clay/commit/d00355e91f814f7aed35cb7d248e1d71fa7559d3))
* **ui:** add skip button and input lock for AskUserQuestion, bump to v1.2.5 ([341d0e2](https://github.com/chadbyte/clay/commit/341d0e26ca58e3d93c365ca6492856cf21e2b7cf))
* **ui:** add stop button to interrupt Claude processing ([8f87977](https://github.com/chadbyte/clay/commit/8f8797767b7a099cd7c808260baaaf0a53cfe167))
* **ui:** add update banner, session delete confirm, and bump to v1.2.4 ([52de4f3](https://github.com/chadbyte/clay/commit/52de4f3921622c6d6abd924729445b04857ad638))
* **ui:** collapse tool result blocks by default with expand chevron ([cc338ed](https://github.com/chadbyte/clay/commit/cc338edf8065292ba1f54d3fbe650c1785fc5c69))
* **ui:** dynamic page title with project name and session title ([5826a41](https://github.com/chadbyte/clay/commit/5826a41a0cccbde5d0057add79efdff0ddc6b242))
* **ui:** unified notification panel, session context menu, and favicon blink ([75b3c96](https://github.com/chadbyte/clay/commit/75b3c96fa87cda489a247d23d74a25e3c7c47fab))
* urgent favicon blink for permission requests and questions ([123f13a](https://github.com/chadbyte/clay/commit/123f13a6e8f313c631862a056ee490fefffb2925))
* v1.3.0 push notifications, setup wizard, debug panel ([aeb4346](https://github.com/chadbyte/clay/commit/aeb434668f515f7888dd4a7c32c8d8363076e1f2))
* v1.4.0 pasted content chips, input previews, rewind hints, and UI polish ([dea39cb](https://github.com/chadbyte/clay/commit/dea39cb923e2dc5684a6c22b438e33b9aa5b49ff))
* v1.5.0 modularize codebase, better push notifications, image resize ([e5804ba](https://github.com/chadbyte/clay/commit/e5804baef70fc47bffae664f6cefdbee632796ac))
* v2.0.0 — multi-project daemon architecture ([6d9e439](https://github.com/chadbyte/clay/commit/6d9e439d3e6bd135fd647ab42e717611feb217f4))

# Changelog

## WIP

## v2.9.2

- Fix session message routing: use per-connection session tracking instead of global activeSessionId to prevent cross-session message leaking (#206)
- Fix `send()` broadcasts leaking status, error, and user messages to unrelated sessions
- Fix SDK bridge broadcasting session-specific errors to all clients
- Add "Disable multi-user mode" option to settings menu with confirmation prompt
- Filter sessions with ownerId on initial connection in single-user mode
- Fallback to most recent accessible session when active session is inaccessible
- Style client count as accent pill badge with users icon in topbar
- Fix dev mode skipping setup flow (consent, port, PIN) after shutdown

## v2.9.1

- Replace mobile settings nav with dropdown select for better UX
- Add bottom padding to home hub on mobile for tab bar clearance
- Update PWA theme and background color to match Dracula palette

## v2.9.0

- **Multi-user mode**: role-based authentication system with admin and user roles
  - PIN-based login with per-user session isolation and project access control
  - Admin panel integrated into server settings for user and invite management
  - Invite system with link generation and revocation
  - Restrict Make Private to session owner only
- **SMTP email system**: OTP-based email login with separate username/email fields
  - Explicit email login policy toggle separate from SMTP configuration
- **Real-time presence**: see who is online across the server and per project
  - Topbar avatars show all connected server users
  - Sidebar header avatars show users in the current project
  - Broadcast avatar and profile changes in real-time to all clients
  - Per-user filtered project lists to prevent unauthorized project visibility
- **Auth page redesign**: replace logos with clear CTA headings and descriptions per step
- Add name personalization CTA to user island when display name matches username
- Fix project settings lost on restart and add Enter key for PIN submit
- Fix project access API silently succeeding when callbacks are null

## v2.8.2

- Replace twemoji JS parsing with Twemoji COLR font — eliminates emoji blinking during streaming, removes MutationObserver overhead
- Remove twemoji.min.js script and all parseEmojis calls across codebase

## v2.8.1

- Disable twemoji in chat area, use native emoji rendering
- Allow `--dangerously-skip-permissions` without PIN; shows warning and confirmation prompt, loops back to PIN input on decline
- Improve disconnect screen ASCII logo: bold Roboto Mono font, larger size, glyph cache for performance, render underscores for 3D depth, smoother easing
- Update disconnect overlay message to "Reconnecting to server…"

## v2.8.0

- **Scheduled Tasks**: cron-based task scheduler with calendar view, sidebar list, and detail panel
  - Project scope toggle (This Project / All Projects) in scheduler top bar
  - Move tasks between projects via popover action
  - Pre-removal check warns when a project has scheduled tasks, offers to migrate them
  - Drag-and-drop tasks onto calendar dates
  - Reset scheduler state on project switch
- **User Profile**: Discord-style popover with DiceBear avatar, display name, language, and color
  - 8 avatar styles with seed-based shuffle (preview-only until confirmed)
  - 18 color swatches for banner/avatar accent
  - Profile persisted server-side in `~/.clay/profile.json`
  - Hover highlight on user island for click affordance
- **Speech-to-Text**: switch from whisper WASM to Web Speech API (Chrome, Edge, Safari)
  - Recording pill UI with stop button
  - Language synced with user profile preference
- **Home Hub**: Quick Start playbooks with guided onboarding steps
  - Certificate trust playbook with OS-specific commands and Claude Code prompt
- Move Clay version label from user island to top bar
- Fix Ctrl+V paste in terminal on Firefox (#194)
- Remove whisper WASM dead code

## v2.7.2

- Fix encodeCwd to match Claude Code's path encoding (#182)
- Allow message queueing on mobile during processing
- Remove scheduled tasks feature shipped prematurely in v2.7.1

## v2.7.1

- Fix mobile send button pushed off-screen by long config chip label (#184)
  - Show icon-only config chip on mobile instead of full text label
- Redesign mobile tab bar + button: inline with other tabs, muted circle style
- Fix theme toggle icon order to match current active mode
- Fix context panel showing inflated usage on turns with tool use (#181)
- Fix encodeCwd to match Claude Code's path encoding (#182)

## v2.7.0

- **Ralph Loop**: full autonomous loop cycle with wizard, crafting, approval, and preview
  - Auto-approve mode, sticky banner, resume on restart, and sidebar UX
  - Per-loop directories and clay-ralph skill integration
  - Loop name field and hidden input for loop sessions
  - Fix iteration cycle, stop, and UI improvements
- **`--host` option**: control server listen address (#156)
- **`--restart` option**: restart server from CLI and web UI (#174)
- **Node version check**: validate Node version on CLI entry point
- **AskUserQuestion improvements**: render option markdown previews, fix mobile submit button and header display
- **Skills modal**: add Installed tab
- Move Share button from top bar to project dropdown menu
- Replace theme toggle button with pill-shaped switch
- Close file browser and sticky notes on project switch
- Warn about uncommitted changes before starting Ralph Loop
- Show onboarding step only when clay-ralph skill is not installed
- Fix stale socket causing Clay to brick after killing daemon (#175)
- Fix context panel showing inflated window size and token usage (#177)
- Fix sticky note X button not archiving due to missing CSS hidden rule

## v2.6.0

- **Skills browser**: discover and install skills powered by skills.sh
- **File upload**: upload files with tmp directory storage
- **Project settings UI**: shared env, defaults, and global CLAUDE.md editing in a Discord-style panel
- **Project icons**: sidebar icon with drag-and-drop reorder, context menu, and emoji picker
- **IO indicator**: per-session blink indicator across all projects
- **Model/mode defaults**: persist model, mode, and effort defaults to daemon.json with priority hierarchy
- **Suggestion chip UX**: click to send immediately, pencil icon to edit
- Simplify server settings: remove Appearance, reorganize nav, merge Advanced into Status
- Add deprecated claude-relay bin entry for backward compatibility
- Add copyable command hint to Skip Permissions setting
- Fix diff view background clipping on horizontal scroll
- Fix thinking spinner vertical alignment
- Fix encodeCwd to handle dots in usernames (#173)
- Fix UI mode changes overriding dangerouslySkipPermissions bypass
- Fix project icon/title not persisting across dev mode restarts
- Fix clear-context plan execution crash: await old stream before starting new query
- Fix SDK "Operation aborted" crash by deferring abort to setImmediate
- Broadcast projects_updated to WebSocket clients on CLI project changes
- Unify dev and prod session storage under ~/.clay

## v2.5.0

- **Rename to Clay**: rebrand from claude-relay to clay-server
  - New 3D Clay logo for CLI and favicon
  - Favicon uses background-only fill swap instead of color overlay (dark mode support)
  - New Apple touch icons and PWA icons for light/dark mode
  - Redesign CLI colors from Claude orange to Clay tri-accent palette
  - Rename theme files and IDs from claude to clay
- **Sticky notes**: drag, resize, color, markdown, and minimize support with server-side persistence
  - Hide title in header when expanded, show only when minimized
  - Re-clamp note positions on window resize so notes stay visible
- **Mobile bottom tab bar**: fullscreen sheet overlays for chat, files, and terminal
- **Hover action bar**: action buttons below user message bubbles with timestamp on hover
- **Stream smoothing**: client-side character-by-character text delivery with requestAnimationFrame
- **Server settings page**: full settings UI accessible from the web
  - All CLI settings available in-browser (PIN, port, keep awake, permissions, etc.)
  - Categorized navigation (General, Notifications, Security, Advanced)
  - Server shutdown with confirmation dialog
- **Redesign theme system**: relocate UI elements and add session info popover
  - Title bar redesigned with context bar, config chip, and status indicators
  - Clay icon in top bar title
  - Header info button always visible as filled icon next to chat title
  - Session info popover on info button click (model, usage, cost, session ID)
  - Hover tooltips on context usage bar
  - Revise Clay Dark/Light themes with vibrant palette and UI refinements
  - Secondary accent color system and revised Clay Light palette
- **Typography**: replace default fonts with Pretendard and Roboto Mono
- **Unified config chip**: replace model selector dropdown with compact chip showing model/mode/effort
  - Add 1M context beta toggle to config chip popover
- **Context overflow detection**: guided recovery CTA when context window is full
  - Accurate context window sizes with fallback mapping (Opus 4.6 = 1M tokens)
  - Context data restored on session switch without full history replay
- **Header context bar**: live token usage bar in title bar with color-coded fill (green/yellow/red)
- **Rate limit handling**: replace inline rate limit cards with header popover
  - HDD-style socket LED indicator for connection status
  - Rate limit events and fast mode state tracking
  - Add usage settings link to rate limit indicator pill
- **Task progress tracking**: show sub-agent progress with stop button
- **Prompt suggestion chips**: contextual suggestions appear after turn completion
- **Plan approval enhancements**: clear context, auto-accept, and feedback input options
  - Persist Implementation Plan card UI across new sessions
- **Conflict detection**: warn when concurrent Claude processes target the same project; require Node 20+
- **Rewind UX**: replace "click to rewind" on user messages with hover-visible rewind icon (positioned to the right)
- **Panel fullscreen toggle**: maximize file browser or terminal to fill the main column (hides chat and title bar)
  - Toggle button in each panel header (maximize-2 / minimize-2 icon)
  - Hidden on mobile where panels are already full overlays
- Consolidate consecutive thinking blocks and persist duration across sessions
- Move todo sticky widget from floating overlay to title bar inline
- Move "Resume CLI" button from Tools section to Sessions header
- Remove project dashboard page; root URL now redirects to first project
- Remove status/activity icon from title bar
- Fix file browser and viewer not resetting on project switch (bfcache)
- Fix permissionMode race condition on query start
- Fix selected model not being passed to SDK query
- Fix model switch not applying when no active query
- Fix stale favicon blink and session processing state after clear context
- Fix sidebar project name missing on load by caching in localStorage
- Fix orphaned caffeinate process surviving after daemon exits (#164)
- Fix plan card showing stale content after Edit-based revisions
- Fix mobile sidebar taking space even when hidden (`!important` on collapsed width)
- Fix mobile sidebar z-index and layout overflow issues
- Fix mobile sidebar not appearing on hamburger tap
- Fix context tracking on history prepend
- UI polish: session buttons, tooltips, resize handle overlay, and minor fixes

## v2.4.3

- Fix SDK failing to spawn Claude Code when daemon is started from within a Claude Code session (#161)
  - Remove inherited `CLAUDECODE` env var to prevent "nested session" error

## v2.4.2

- Fix skill discovery: merge global (`~/.claude/skills/`) and project (`.claude/skills/`) skills for slash menu (#160)
  - SDK's `settingSources` overrides skills instead of merging — now scans filesystem and unions with SDK-reported skills
  - Deduplicated slash command list (SDK slash_commands + merged skills)

## v2.4.1

- One-click update from web UI ("Update now" button in update banner)
  - Production: fetches latest package via npx, spawns updated daemon, graceful handoff
  - Dev mode: daemon restarts via dev watcher (exit code 120)
  - Port retry on startup (EADDRINUSE) for seamless daemon handoff
  - Full-screen overlay blocks UI during update
- Centralize session storage in `~/.claude-relay/sessions/` to prevent chat history from ending up in git repos (auto-migrates existing sessions)
- Material Icon Theme file browser icons (colored SVG icons for files and folders, replaces broken file-icons-js)
- Smooth session list hover: fixed height, opacity transitions, no layout shift
- Fix light theme sidebar hover visibility (darken-based contrast)
- Add `Cache-Control: no-cache` to static file responses
- Dev mode: `--watch` / `-w` flag for hot reload (off by default)
- Fix false "Failed to start daemon" error on slow startup by retrying alive check (500ms × 10 attempts instead of single 800ms wait)
- Fix `--headless` hanging when daemon is already running (now reports status and exits immediately)

## v2.4.0

- Add `--headless` flag for non-interactive daemon startup (#154)
  - Implies `--yes` (skips all interactive prompts)
  - Restores projects from `~/.clayrc`, forks daemon, exits CLI immediately
  - Ideal for LaunchAgent / systemd auto-start on login
- Add base16 theme system with 22 bundled themes and custom theme support
  - Dark and light theme variants with theme picker UI
  - Custom themes via `~/.claude-relay/themes/` JSON files
  - Instant theme restore on page load via localStorage CSS cache (no flicker)
- Show sub-agent (Task tool) activity in real-time (#77, #152)
  - Nested sub-agent messages rendered inline under parent tool block
  - Live streaming of sub-agent tool calls and results
- Group consecutive tool calls with collapsed summary header (#153)
  - Multiple sequential tool calls collapse into a single summary row
  - Click to expand individual tool results
- Redesign sidebar with inline project list and pinned sections (#155)
  - Replace project dropdown with inline project list (GitHub-style)
  - `[+]` icon buttons for new session and new project
  - Pin TOOLS and SESSIONS/FILE BROWSER headers above scroll area
  - FILE BROWSER header with refresh/close replaces back button
  - Session search X button for quick clear
  - Show session name in header with inline rename (pencil icon)
  - "Star on GitHub" label in footer menu
- Add CLI session picker: browse and resume CLI sessions from the web UI (#107)
  - "Resume CLI" button in sidebar lists sessions from `~/.claude/projects/` JSONL files
  - Each session shows first prompt, relative time, model, and git branch
  - Sessions already open in relay are filtered out; duplicate resume switches to existing session
- Add/remove projects from web UI with path autocomplete (#131)
  - VS Code Remote-style path input with server-side directory browsing
  - Remove button (trash icon) on project items with confirmation
  - Current project can now also be removed (redirects to dashboard)
- Add `npm run dev` with foreground daemon and auto-restart on `lib/` file changes (#135)
  - `--dev` flag or `npx claude-relay-dev` for development mode
  - `fs.watch` on `lib/` (excluding `lib/public/`) with 300ms debounce
  - Separate config dir `~/.claude-relay-dev/` and port 2635
  - First-time setup runs automatically; config reused on subsequent runs
- Add mermaid diagram rendering in file browser markdown view
- Stop auto-registering cwd as project on startup (#138)
  - Only register cwd when no restorable projects exist from `~/.clayrc`
  - `--yes` mode no longer adds unnecessary directories
- Fix theme flickering on project switch (localStorage CSS variable cache in `<head>`)
- Fix terminal border color mismatch and chevron direction
- Fix iOS Safari PWA: show guidance instead of broken notification toggle (#121)
- Fix iOS Safari URL-encoding copied text (#123)
- Fix incomplete turns on history replay and skip redundant delta renders (#129)
- UI polish: terminal tab kill → trash icon, panel close → chevron-down, new tab button next to tabs
- UI polish: add-project modal autocomplete only on focus, dismiss on click outside

## v2.3.1

- Support `claude-relay-dev` running independently from production daemon (separate port 2635, config dir `~/.claude-relay-dev/`)
- Add right-click context menu on terminal with Copy Terminal and Clear Terminal actions
- Add RTL (bidi) text support for prompt field and responses (#114)
- Fix duplicate approval prompts appearing when browser tab returns from background (#112)
- Never abort queries on client disconnect — remove auto-abort logic that killed active queries on brief connection drops (#113)
- Debounce "Server Connection Lost" notification by 5 seconds to suppress alerts on brief disconnections (#113)
- Suppress "Server connection restored" notification when disconnection was too brief to notify
- Redirect to dashboard with toast when accessing a removed project instead of showing bare "Not found" page
- Change notification menu icon from sliders to bell
- Fix Node 18 "Object not disposable" error after Claude Code auto-update by polyfilling `Symbol.dispose` (#116)

## v2.3.0

- Add `--dangerously-skip-permissions` CLI flag to bypass all permission prompts via SDK native `permissionMode` (#100)
  - Requires `--pin` for safety; shows red warning banner in web UI when active
- Fix iOS push notifications not delivered in background (#94)
- Fix notification click opening blank session instead of correct project (#94)
- Fix silent validation pushes showing empty notifications in service worker (#94)
- Fix duplicate done notifications when both browser and push notifications active (#94)
- Fix stale push subscriptions accumulating on PWA reinstall (client sends `replaceEndpoint`)
- Fix share button copying localhost URL instead of LAN/Tailscale address
- Fix setup onboarding showing Tailscale page after selecting LAN-only mode
- Fix dashboard appearing before setup completion for PWA users
- Fix foreground notification suppression on iOS PWA (restore pre-v2.2.0 type-based exceptions)
- Add welcome push notification on push subscribe with confetti
- Auto-hide onboarding banner when push notifications are active
- Restore most recently used session on daemon restart
- Add `/context` command with context window usage panel (#84)
  - Minimizable context panel with inline mini bar (#96)
  - Green/yellow/red color coding for context bar
  - Persist context panel view state across sessions and restarts
  - `/clear` now starts a new session instead of just hiding messages
- Add image lightbox modal with click-to-preview (#82)
- Add auto-focus input on session switch (#98)
- Auto-restart daemon on crash with project recovery and client notification (#101)
- Auto-restart daemon with HTTPS when mkcert is installed but TLS was not active (#90)
- Reload config from disk after setup guide completes (pick up TLS state changes)
- File browser refresh button and auto-refresh on directory changes (#89)
- File history diff viewer with split/unified views, compare bar, and go-to-chat navigation
- Process status panel with `/status` command (#85)
- Auto-cleanup sessions on disconnect and graceful shutdown (#86)
- Rewind mode selection for chat-only, files-only, or both (#43)
- Paste copied file from Finder into chat to insert its path (#81)
- Fix WebSocket 403 when behind reverse proxy with different port (#106)
- Fix lastRewindUuid not persisting across daemon restarts
- Fix context panel token calculation and `/clear` cleanup

## v2.2.4

- Fix Windows IPC failure: use named pipe (`\\.\pipe\claude-relay-daemon`) instead of Unix domain socket
- Fix terminal shell fallback to `cmd.exe`/`COMSPEC` on Windows instead of `/bin/bash`
- Fix browser open using `cmd /c start` on Windows instead of `open`/`xdg-open`
- Fix daemon spawn flashing console window on Windows (`windowsHide`)
- Fix daemon graceful shutdown on Windows via `SIGHUP` listener
- Fix mkcert invocation breaking on paths with spaces (use `execFileSync` with array args)
- Fix file path splitting for Windows backslash paths in push notification titles
- Fix `path.relative` sending backslash paths to browser client
- Show platform-appropriate mkcert install command (choco/apt/brew)
- Hide keep-awake toggle on non-macOS platforms (caffeinate is macOS only)

## v2.2.3

- Fix setup page showing Tailscale onboarding for LAN-only users (#90)
- Add `?mode=lan` query parameter to skip Tailscale step when remote access is not needed
- Always ask "Access from outside?" even when Tailscale is installed
- Generate mkcert certs with all routable IPs (Tailscale + LAN) using whitelist
- Auto-regenerate cert when any routable IP is missing from SAN
- Reorder Android setup: push notifications first, PWA optional with skip
- Add iOS notice that PWA install is required for push notifications

## v2.2.2

- Remove OAuth usage API to comply with Anthropic Consumer ToS (OAuth tokens are now restricted to Claude Code and claude.ai only)
- Replace rate limit bar UI with link to claude.ai/settings/usage
- Remove usage FAB button and header button; usage panel now accessible only via `/usage` slash command

## v2.2.1

- Add `--add`, `--remove`, `--list` CLI flags for non-interactive project management (#75)
- Show active task with spinner in collapsed sticky todo overlay
- Fix sidebar footer Usage button not opening usage panel (pass `toggleUsagePanel` to notifications context)

## v2.2.0

- Add full-text session search with hit timeline (search all message content, highlighted matches in sidebar, rewind-style timeline markers with click-to-navigate and blink)
- Add live-reload file viewer: files update automatically when changed externally via `fs.watch()` (#80)
- Add persistent multi-tab terminal sessions with rename, reorder, and independent scrollback (#76)
- Add usage panel with `/usage` slash command and rate limit progress bars (#66)
- Add model switching UI in header (#67)
- Add plan approval UI: render `ExitPlanMode` as confirmation card with approve/reject (#74)
- Add image attach button with camera and photo library picker for mobile (#48)
- Add send messages while processing (queue input without waiting for completion) (#52)
- Add draft persistence: unsent input saved per session, restored on switch (#60)
- Add compacting indicator when session context is being compacted (#44)
- Add sticky todo overlay: `TodoWrite` tasks float during scroll with collapsed progress bar
- Add copy button to implementation plan cards
- Add special key toolbar for terminal on mobile (Tab, Ctrl+C, arrows) (#58)
- Add newline input support on mobile keyboard (#68)
- Add hold scroll position when user is reading earlier messages (#49)
- UI polish batch: terminal tab badge, tab rename, share button, scrollbar styling, tooltip, usage menu
- Fix Edit tool diff rendering with line numbers, file header, and split view (#73)
- Fix fallback CLI rendering for macOS Terminal.app
- Fix answered AskUserQuestion reverting to pending on page refresh (#79)
- Fix SDK import failures not surfaced to user (#56)
- Fix push notifications firing when PWA is in foreground (#53)
- Fix send/stop button tap target increased to 44px (#50)
- Fix terminal height constrained to visible area above keyboard on mobile (#57)
- Fix stale push subscriptions purged on startup (#51)
- Fix duplicate plan content in plan approval UI
- Fix CLAUDE.md and settings files not loaded in SDK sessions

## v2.1.3

- Fix certificate trust detection on iOS: onboarding page always showed "Certificate not trusted yet" even after installing and trusting the mkcert CA
  - HTTPS `/info` 401 response lacked CORS headers → browser treated as network error → misreported as untrusted cert
  - Switch certificate check fetch to `no-cors` mode so any TLS handshake success = cert trusted

## v2.1.2

- Fix session list reordering on every click (only update order on actual messages, not view switches)
- Fix project switcher losing name/count after incomplete `info` message (defensive caching)
- Remove unselected projects from `~/.clayrc` during restore prompt

## v2.1.0

- **Project persistence via `~/.clayrc`**: project list saved automatically; on daemon restart, CLI prompts to restore previous projects with multi-select
  - Interactive multi-select prompt (space to toggle, `a` for all, esc to skip)
  - Auto-restore all projects when using `--yes` flag
  - Syncs on project add/remove/title change and daemon startup
  - Keeps up to 20 recent projects sorted by last used
- CLI main menu hint redesign: repo link with `s` to star, project tip
- CLI backspace-to-go-back in all select menus
- CLI hotkey system extended to support multiple keys per menu
- Fix current project indicator lost in sidebar dropdown after server restart (slug now sent via WebSocket `info` message)
- Fix `setTitle` info broadcast missing `projectCount` and `projects` fields

## v2.0.5

- Rate limit PIN attempts: 5 failures per IP triggers 15-minute lockout
- PIN page shows remaining attempts and lockout timer
- Add WebSocket Origin header validation (CSRF prevention)
- Gate /info endpoint behind PIN auth, remove path exposure
- Add `--shutdown` CLI flag to stop daemon without interactive menu
- Sidebar redesign: logo + collapse header, project switcher dropdown, session actions (New session, Resume with ID, File browser, Terminal)
- Project switcher: "Projects" as top-level concept, project name below, count badge with accent color
- Project dropdown: indicator dots, session counts, "+ Add project" with onboarding hint
- Remove Sessions/Files tab toggle — File browser now opens as full panel with back button
- Group sessions by date (Today / Yesterday / This Week / Older) based on last interaction
- Session timestamps derived from .jsonl file mtime for accurate ordering

## v2.0.4

- Fix setup flow broken after daemon refactor
  - CORS preflight for HTTP→HTTPS cross-origin setup requests
  - Timing fix: cert/pwa/push init moved into buildSteps() (was running before steps populated)
  - iOS variable shadowing fix (steps array overwritten by DOM element)
- Unify Service Worker scope to root (fix duplicate push notifications per project)
- PWA manifest scope changed to / (one install covers all projects)
- Generate PNG icons for iOS apple-touch-icon support
- Add root-level push API endpoints for setup page
- CLI QR code now always shows HTTP onboarding URL

## v2.0.0

- **Multi-project support**: manage multiple projects on a single server and port
  - Daemon runs in background, survives CLI exit
  - URL routing via `/p/{slug}/` for each project
  - Dashboard page at root (`/`) to browse all projects
  - "All projects" link in sidebar footer menu
- **CLI management overhaul**
  - Restructured menu: Setup notifications, Projects, Settings, Shut down server, Keep server alive & exit
  - Projects sub-menu with add current directory, add by path, project detail, and remove
  - Settings sub-menu with setup notifications, PIN, keep awake toggle, view logs
  - Shut down server moved to main menu for quick access
  - Other CLI instances auto-detect server shutdown and exit gracefully
  - Press `o` hotkey to open browser from main menu
  - Port selection during first-time setup with conflict detection
  - Shutdown confirmation prompt
  - ESC to go back from text prompts with visible hint
  - 2-second feedback messages after adding projects (success/duplicate/error)
- **Project titles**: set custom display names per project (CLI, browser tab, dashboard)
  - `document.title` now shows `ProjectName - Claude Relay` (was `Claude Relay - ProjectName`)
- **Setup notifications fast-path**: skip toggle flow when all prerequisites are already met
- **Keep awake runtime toggle**: enable/disable caffeinate from Settings without restart
- **Urgent attention signals**: favicon blinks and tab title flashes `⚠ Input needed` on permission requests and questions
- **Push notification blocked hint**: show "Blocked by browser" message when push toggle fails
- **File browser**: fix relative image paths in rendered markdown files
- Gradient hint text in main menu
- Add Ctrl+J shortcut to insert newline in input (matches Claude CLI behavior)
- Add QR code button in header to share current URL with click-to-copy

## v1.5.0

- Refactor monolithic codebase into modules
  - app.js 3,258 → 1,090 lines (8 client modules)
  - server.js 2,035 → 704 lines (3 server modules)
  - style.css 3,005 → 7 lines (7 CSS files)
- Push notification titles now show context ("Claude wants to edit auth.ts" instead of just "Edit")
- Auto-resize images >5 MB to JPEG before sending (iPhone screenshots)
- Add mermaid.js diagram rendering with expandable modal viewer and PNG export
- Move TLS certs from per-project to `~/.claude-relay/certs` with auto-migration
- Re-generate certs when current IP is not in SAN
- Add toast notification system and clipboard fallback for HTTP contexts
- Use grayscale mascot for PWA app icon

## v1.4.0

- Pasted content feature: long text (≥500 chars) shows as compact "PASTED" chip with modal viewer on click
- Image previews now render inside the input box (Claude-style)
- Rewindable user messages show "Click to rewind" hint on hover
- Copy resume command moved to session context menu (⋯ button)
- Notification menu: added icons to toggle labels, removed resume button
- Security: shell injection fix (execFileSync), secure cookie flag, session I/O try/catch
- Fix session rename persistence
- Fix sending paste/image-only messages without text

## v1.3.0

- Consolidate notification bell and terminal button into unified settings panel
  - Push notifications toggle (HTTPS only, user-driven subscribe/unsubscribe)
  - Browser alerts and sound toggles
  - Copy resume command integrated into the panel
  - Replace bell icon with sliders icon
- Add web push notifications for response completion, permission requests, questions, errors, and connection changes
  - Rich previews with response text and tool details
  - Subscription persistence with VAPID key rotation handling
  - Auto-resubscribe on VAPID key change
  - Suppress notifications when app is in foreground
- Add multi-step setup wizard with platform detection, PWA install, and push enable
- Add favicon I/O blink during processing
- Replace session delete button with three-dots context menu
  - Rename sessions inline
  - Delete with confirmation
- Replace sidebar footer GitHub link with app menu button
  - Shows current version, GitHub link, and check for updates
  - Manual update check with badge when new version available
- Add rewind feature to restore files and conversation to a previous turn
  - Click any user message to preview rewind with file diffs
  - `/rewind` slash command toggles timeline scrollbar for quick navigation
  - Rewind modal shows changed files with expandable git diffs and line stats
  - File checkpointing and `resumeSessionAt` integration with Claude SDK
  - Works on both active and idle sessions via temporary query
- Add copy button to code blocks
- Add `--debug` flag with debug panel for connection diagnostics
- Fix push notifications failing silently on iOS
- Fix push notification body stuck on previous response content
- Fix AskUserQuestion input staying disabled after switching sessions
- Fix duplicate submit buttons for multi-question prompts

## v1.2.9

- Add automatic port hopping when default port is in use (increments by 2)

## v1.2.8

- Add resume CLI session button to continue terminal conversations in the web UI
- Add notification settings menu with browser alert and sound toggles
- Add skip button and input lock for AskUserQuestion prompts
- Add click-to-copy for assistant messages
- Move sidebar close button to the right side of the header
- Fix AudioContext being recreated on every notification sound

## v1.2.4

- Add collapsible sidebar toggle for desktop (ChatGPT-style)
- Add new version update banner with copy-to-clipboard command
- Add confirmation modal for session deletion
- Add code viewer with line number gutter and syntax highlighting for Read tool results
- Improve tool result blocks to collapse by default with expand chevron

## v1.2.0

- Add auto-update check on startup with `--no-update` flag to opt out
- Add session deletion from the web UI
- Add browser notifications when Claude finishes a response
- Add dynamic page title showing project name and session title
- Add CLI branding with pixel character and dynamic favicon
- Add response fallback for better error handling
- Improve publish script with interactive version bump selection

## v1.1.1

- Add HTTPS support via mkcert with automatic certificate generation
- Add interactive setup flow (accept prompt, PIN protection, keep awake toggle)
- Add permission request UI for tool calls
- Add multi-device session sync
- Add stop button to interrupt Claude processing
- Add QR code display for web UI URL in terminal
- Update README

## v1.0.1

- Initial public release
- WebSocket relay between Claude Code CLI and browser
- Web UI with markdown rendering and streaming responses
- Session management with create, list, resume
- Tailscale IP auto-detection
