# [4.1.0-beta.5](https://github.com/chadbyte/clay/compare/v4.1.0-beta.4...v4.1.0-beta.5) (2026-09-12)


### Features

* **notes:** add temporary hide with nearest-edge flight ([3492bc3](https://github.com/chadbyte/clay/commit/3492bc3563e3abaf6ecab12c6895189184b394ee))
* **notes:** add temporary hide with nearest-edge flight ([913e34c](https://github.com/chadbyte/clay/commit/913e34c956673a94cf1ade0baf867a9ddd19e8b7))

# [4.1.0-beta.4](https://github.com/chadbyte/clay/compare/v4.1.0-beta.3...v4.1.0-beta.4) (2026-09-12)


### Bug Fixes

* **split:** improve mobile layout and lightweight worker defaults ([6813bdf](https://github.com/chadbyte/clay/commit/6813bdf0f7a7f072d1eb9a12018854ad5681279b))
* **split:** stack mobile portrait panes with driver below worker ([2addebc](https://github.com/chadbyte/clay/commit/2addebc377ac562e28ec53d9e6a44266efbc9d1d))
* **worker:** make lightweight execution the shared default ([df329b0](https://github.com/chadbyte/clay/commit/df329b05621322777e6fceb61a5acc8ccc1d63ca)), closes [hi#low](https://github.com/hi/issues/low)

# [4.1.0-beta.3](https://github.com/chadbyte/clay/compare/v4.1.0-beta.2...v4.1.0-beta.3) (2026-09-10)


### Bug Fixes

* **claude:** prevent duplicate question forms ([a9f3e01](https://github.com/chadbyte/clay/commit/a9f3e01eccce4136d73031e5cf5126ba7097ecd7))

# [4.1.0-beta.2](https://github.com/chadbyte/clay/compare/v4.1.0-beta.1...v4.1.0-beta.2) (2026-09-10)


### Bug Fixes

* **worker:** restore durable identity and accurate usage ([694059c](https://github.com/chadbyte/clay/commit/694059c3989313a6989ec5e3801161d434141c2a))

# [4.1.0-beta.1](https://github.com/chadbyte/clay/compare/v4.0.1-beta.1...v4.1.0-beta.1) (2026-09-10)


### Bug Fixes

* **auth:** enforce project and session access boundaries ([bdb308e](https://github.com/chadbyte/clay/commit/bdb308eb77c16a3b416af7d5bb64beae4a229013))
* **chat:** consolidate thinking into one entry per turn ([207193d](https://github.com/chadbyte/clay/commit/207193da3c9af87c0944f4633d3e03d4f98fecf6))
* **claude:** preserve first messages during worker startup ([1272766](https://github.com/chadbyte/clay/commit/1272766247674c7352fdc58e2cf7dfeb5bfb2119))
* **home:** add inline Ask Clay approvals and stop controls ([4c790f2](https://github.com/chadbyte/clay/commit/4c790f206794ee93e711c675c7f1540db33774b2))
* **home:** restore project bootstrap and default root workspace ([4cffe22](https://github.com/chadbyte/clay/commit/4cffe224efe7006a38d2a69d6e2c397640c8fff8))
* **home:** use canonical Ask Clay module imports ([be2ef88](https://github.com/chadbyte/clay/commit/be2ef888ece0c7bd38e045097311a769ba95e952))
* **home:** wait for session restoration before closing Home ([951abe6](https://github.com/chadbyte/clay/commit/951abe6a8716faec3912926f78500a0cdbb2120c))
* **projects:** filter Home project lists by current access ([3274e66](https://github.com/chadbyte/clay/commit/3274e66c5a6f8af2fb6a5b9bddac784c3cce9dfa))
* **sessions:** allow admins to access private sessions ([0be847b](https://github.com/chadbyte/clay/commit/0be847bbc3f09707e485943fd0dd61037d23b150))
* **sessions:** make sharing explicit and default to private ([52e1983](https://github.com/chadbyte/clay/commit/52e19830f5db8983e7c3b9d3ed238f3137ac00c7))
* **ui:** show visibility badges only for shared sessions ([bd85de3](https://github.com/chadbyte/clay/commit/bd85de3233abf04dfc7044f57701094259be256e))
* **worker:** distinguish pending proposals from accepted execution ([146666d](https://github.com/chadbyte/clay/commit/146666d675be35d05871ce92c6ed23c4d9ec0fc7))
* **worker:** keep runtime inline and clarify task banner ([ece2b04](https://github.com/chadbyte/clay/commit/ece2b046a93991e8d39a6f6e5ea829dc20cd60b5))
* **worker:** prefer lighter runtimes and correct model ordering ([2440a94](https://github.com/chadbyte/clay/commit/2440a94d8030ea536a73eb8f8df2e2b6ae22b734))


### Features

* **chat:** show live thinking summaries with shimmer ([3e64b6d](https://github.com/chadbyte/clay/commit/3e64b6da48da05321b85402a8d8b712978d8c92c))
* **worker:** add recoverable task and proposal controls ([181058a](https://github.com/chadbyte/clay/commit/181058abd9c6322101e5ce9a3dc1e2285926beae))
* **worker:** clarify runtime details and simplify proposal cards ([dc19b92](https://github.com/chadbyte/clay/commit/dc19b92a8e1c2a6d7a3cc003657e6b553cfc5b48))
* **worktrees:** add per-user worktree access grants ([58f1c57](https://github.com/chadbyte/clay/commit/58f1c5748a36417ecb69fcd65cabb5b7d172677e))

## [4.0.1-beta.1](https://github.com/chadbyte/clay/compare/v4.0.0...v4.0.1-beta.1) (2026-09-09)


### Bug Fixes

* **home:** add inline Ask Clay approvals and stop controls ([cbb66ae](https://github.com/chadbyte/clay/commit/cbb66aea3f2ef20c1ddc56086ae8dbf193454982))
* **home:** use canonical Ask Clay module imports ([fb0d6a3](https://github.com/chadbyte/clay/commit/fb0d6a3c6591183caeb50e73d185d0188f7fe9e2))

# [4.0.0](https://github.com/chadbyte/clay/compare/v3.8.1...v4.0.0) (2026-09-09)


* feat(board)!: rebuild home as the work hub with mates beside the board ([6d83a54](https://github.com/chadbyte/clay/commit/6d83a54d06cac5ec25d7bc984e1d5b4cf4979b42))
* feat(capsules)!: add Mate-driven Capsule Home ([e6ef64e](https://github.com/chadbyte/clay/commit/e6ef64ef3e3f2f905accb964b5411d883e23aa15))
* feat(capsules)!: remove scratchpad and translator ([0382fb7](https://github.com/chadbyte/clay/commit/0382fb7718d7437150734cd00257ae0d65786d1b))


### Bug Fixes

* **admin:** replace native destructive confirmations ([e8fbc63](https://github.com/chadbyte/clay/commit/e8fbc632d65ab1387bf90700068627d1fc705f8c))
* **auth:** enforce project and session access boundaries ([#489](https://github.com/chadbyte/clay/issues/489)) ([51a05a9](https://github.com/chadbyte/clay/commit/51a05a92a1bfa94407c03b7946bcbe96621c03d6))
* **auth:** prevent login prompt replay ([7f00048](https://github.com/chadbyte/clay/commit/7f00048eb32f6c870cee07cd62c90466cc0a0be1))
* **auth:** recheck Codex credentials after login ([1c9d1e4](https://github.com/chadbyte/clay/commit/1c9d1e4f700a64b27e2b642119e5b0a8d339a47e))
* **auth:** refresh Codex login across projects ([626e9ab](https://github.com/chadbyte/clay/commit/626e9ab698de832f0f64c46154f94ce7873aa33d))
* **auth:** trust Codex runtime authentication failures ([371ed5d](https://github.com/chadbyte/clay/commit/371ed5df53168ad1fac347a8a8685e8ee3297305))
* **capsules:** allow blob worker runtime ([c237f89](https://github.com/chadbyte/clay/commit/c237f8940e46eb002718f496f355d50e40504363))
* **capsules:** preserve Korean IME composition ([fe43fb3](https://github.com/chadbyte/clay/commit/fe43fb3f3f8103ef730bfafb25745dd701f4e71f))
* **capsules:** stabilize text input and model resolution ([433c4a5](https://github.com/chadbyte/clay/commit/433c4a5ce428e4a86ee549b28a24b0c90b31ad26))
* **capsules:** tolerate missing capsules root when seeding built-ins ([014d919](https://github.com/chadbyte/clay/commit/014d9198ac4fffebeb08dad5400876d4839b0a6c))
* **chat:** consolidate thinking into one entry per turn ([f8a08fb](https://github.com/chadbyte/clay/commit/f8a08fb91946fa14d0a49f7b6e2c8dc0ffabba71))
* **chat:** recover unacknowledged startup messages ([be9d9cf](https://github.com/chadbyte/clay/commit/be9d9cf6e7d531e9e1ddf40c493416790e19823f))
* **claude:** preserve first messages during worker startup ([008199b](https://github.com/chadbyte/clay/commit/008199bfb5ca707539bf3fdea0de591d894408b0))
* **daemon:** preserve live processes on permission errors ([1aba098](https://github.com/chadbyte/clay/commit/1aba098c7142b4d0c9030dc02f91985d18d1a88d))
* **deps:** resolve dependency security advisories ([f799207](https://github.com/chadbyte/clay/commit/f79920747968d9e51a3d43fd71d624eb7767c722))
* **home:** apply draft models and restore composer focus ([5efb84a](https://github.com/chadbyte/clay/commit/5efb84a3194d57c477f70e54f8823b2562fff60d))
* **home:** generate meaningful chat titles ([8ad903f](https://github.com/chadbyte/clay/commit/8ad903feba3e5ade9752d74a36484b82968c5630))
* **home:** keep close control outside workbench ([e8259a5](https://github.com/chadbyte/clay/commit/e8259a5caa6bedad9660507655b51075ecdb120c))
* **home:** restore new user workspace access ([1f35b10](https://github.com/chadbyte/clay/commit/1f35b107c8d8c15d0917a74e3672e7bd16b776df))
* **home:** restore project bootstrap and default root workspace ([e964c3a](https://github.com/chadbyte/clay/commit/e964c3a15032e334a895dc1791a1aa0fa09625c8))
* **home:** restore workspace for new users ([a54f526](https://github.com/chadbyte/clay/commit/a54f526eeae66864876d18ef22f71f9bd5644643))
* **home:** stabilize mate model and response delivery ([c144342](https://github.com/chadbyte/clay/commit/c144342251ebedf124555e07961d9643751f8a4a))
* **home:** wait for session restoration before closing Home ([e798f85](https://github.com/chadbyte/clay/commit/e798f855da430977c69dd649bea873486516a118))
* **knowledge:** make result ordering deterministic ([e154fb6](https://github.com/chadbyte/clay/commit/e154fb69492de8d2e1316fb25aa90c3db3c9575d))
* **login:** stop vendor login loop with server-owned per-vendor flow ([b9b27ad](https://github.com/chadbyte/clay/commit/b9b27ad3b533e7324330a027a54668c682f15a01))
* **logs:** deliver comments to the authoring session ([bc0d6e7](https://github.com/chadbyte/clay/commit/bc0d6e7f5469902aa88d8798f631542c4ac3518c))
* **logs:** preserve sticky notes when opening ledger ([94de68e](https://github.com/chadbyte/clay/commit/94de68ef26a218cd5763be2636c27425e9e81578))
* **logs:** remove edge reveal interaction ([34f9e90](https://github.com/chadbyte/clay/commit/34f9e90e9e4fc2b042fe9b20892671d91f798c6a))
* **logs:** reserve learning for user moments ([8e0b511](https://github.com/chadbyte/clay/commit/8e0b511403b8cbc96f06fe9f35c37b3ff07ca80f))
* **logs:** review comments without blocking the driver ([531956a](https://github.com/chadbyte/clay/commit/531956ab0c31ded9e7199c94e29101113f9f9dba))
* **logs:** skip redundant permission prompts ([fe57a63](https://github.com/chadbyte/clay/commit/fe57a632a73da06118d57cf4af98ca0f2e1c5a7a))
* **notes:** prevent sticky note flicker ([76acd07](https://github.com/chadbyte/clay/commit/76acd07d8562776dc902fa6c65ac7740dadb0bbd))
* **notes:** restore isolated backdrop blur ([335884c](https://github.com/chadbyte/clay/commit/335884cdd67b8e1237cdc44548612f2237cb692a))
* **notes:** skip redundant permission prompts ([60b401c](https://github.com/chadbyte/clay/commit/60b401c9f5c4bb703fa2f3a9fc46daa0dd80d334))
* **pair:** honor driver choice and bound overload retries ([b04bdb2](https://github.com/chadbyte/clay/commit/b04bdb2bcb5f0a0b914e3b476bc363307b01cb44))
* **pairing:** disambiguate visible Split Workers ([59a1e1f](https://github.com/chadbyte/clay/commit/59a1e1f8c7cb7b77c7bf7d1108399d158cf441c5))
* **projects:** preserve navigation after active deletion ([ede51fd](https://github.com/chadbyte/clay/commit/ede51fd3201a3356ecc846d15f3451feb7cf829a))
* **search:** complete Ask Clay workspace conversations ([a9849e1](https://github.com/chadbyte/clay/commit/a9849e1d3a3cac8f73118348ed99673194725077)), closes [#213](https://github.com/chadbyte/clay/issues/213)
* **security:** enforce authoritative workspace access ([010c983](https://github.com/chadbyte/clay/commit/010c983b80548938d4bcf5aa35ad71a94bdaeb41))
* **sessions:** allow admins to access private sessions ([3f13dec](https://github.com/chadbyte/clay/commit/3f13decd36aa77f1c8d95906bf7391329da02be1))
* **sessions:** make sharing explicit and default to private ([cd6d5cc](https://github.com/chadbyte/clay/commit/cd6d5cc90c9e42bd5990e27a3a9cef1e75d0b3fa))
* **sessions:** preserve driver and worker hierarchy actions ([b4c6b5d](https://github.com/chadbyte/clay/commit/b4c6b5d1bba5ceece675710d45f9e0ee67d76caa))
* **sessions:** preserve startup input and enforce private defaults ([#485](https://github.com/chadbyte/clay/issues/485)) ([05f5e99](https://github.com/chadbyte/clay/commit/05f5e99d07a81252014236bbb60387621fa82c82))
* **sessions:** restore Home navigation and allow admin access ([#487](https://github.com/chadbyte/clay/issues/487)) ([a57125a](https://github.com/chadbyte/clay/commit/a57125ac84db53c7e776b1692c543146155737c4))
* **settings:** apply saved environment to agent runtimes ([b8b3d9e](https://github.com/chadbyte/clay/commit/b8b3d9e7d99224e87cb09efea591ff985ad3bf0e))
* **sidebar:** collapse split worker hierarchy ([12125f5](https://github.com/chadbyte/clay/commit/12125f524c7e594d13a90742647145841eb85c8f))
* **tools:** stop restarting the worker on ordinary action errors ([1759660](https://github.com/chadbyte/clay/commit/17596600a5d1fc48abe234b5efd2597a323548ab))
* **ui:** preserve Logs toolbar position ([0c00ddd](https://github.com/chadbyte/clay/commit/0c00dddb83a8f17d6ce79523f771251365213353))
* **ui:** prevent reconnect redraw flicker ([f13da17](https://github.com/chadbyte/clay/commit/f13da17ac5d125e2e8bfe500b6f79f584200edad))
* **ui:** show visibility badges only for shared sessions ([14bfea0](https://github.com/chadbyte/clay/commit/14bfea0734fba20b49c02abfdad9f73fd9898a8b))
* **ui:** show visibility badges only for shared sessions ([#486](https://github.com/chadbyte/clay/issues/486)) ([fdd100e](https://github.com/chadbyte/clay/commit/fdd100ec6e0051eb3f47507b6826c3be6ff399f5))
* **worker:** enforce human stop across pair lifecycle ([9999881](https://github.com/chadbyte/clay/commit/999988150e08af72fbf85780a58acf1ec8b3602a))
* **worker:** keep runtime inline and clarify task banner ([b544002](https://github.com/chadbyte/clay/commit/b5440027fae8b13215c1f3395ccd9c71aad40d9f))
* **worker:** preserve Codex pair tools across resume ([91e38e1](https://github.com/chadbyte/clay/commit/91e38e1b3192d87508228b2b4d6cc828afb4ae35))
* **worker:** resolve live session tool handlers ([9980862](https://github.com/chadbyte/clay/commit/99808620276d2a7c5b79de848022fb747e19c4b2))
* **worker:** restore split worker creation ([e954274](https://github.com/chadbyte/clay/commit/e95427406683712f375bc630d6a207f8c553ec62))
* **worker:** restore split worker creation ([#476](https://github.com/chadbyte/clay/issues/476)) ([ddb7170](https://github.com/chadbyte/clay/commit/ddb7170d25ee3d062b81a37c61c3ff3d64231f94))
* **workers:** gate orchestration guidance by model tier ([30f3977](https://github.com/chadbyte/clay/commit/30f39778395ce52a1f42ca8d296d3b0e3cfcfc87))
* **worktree:** run git operations as the project owner ([5ca1609](https://github.com/chadbyte/clay/commit/5ca16096d83826611d1509a027269a90243e9114))
* **yoke:** auto-approve structured user input ([85fa7dc](https://github.com/chadbyte/clay/commit/85fa7dc16408619a6cf0204b22404f569b394ec4))


### Features

* **board:** add per-user work board storage and websocket layer ([fe9fc07](https://github.com/chadbyte/clay/commit/fe9fc070e6b6a75ae0500d79fcf5256584188b51))
* **board:** calm conversation stage — two-voice chat, mate switcher, no mate colors ([3407ef8](https://github.com/chadbyte/clay/commit/3407ef8cb4347d27ecbd6822433efd2d98448d00))
* **board:** chat with mates inside the home screen ([7292564](https://github.com/chadbyte/clay/commit/7292564eafa1775681150d1fa372dc6e95a322fc))
* **board:** collapsible dock with three states replaces the fixed split ([a135237](https://github.com/chadbyte/clay/commit/a1352371cb9a1acc80c1d1007c4182c41e116371))
* **board:** home shell — root route, quiet home bar, project chrome retired ([619d384](https://github.com/chadbyte/clay/commit/619d384e4e4093e75b593417a671b49a2a6b3365))
* **board:** hover identity cards, defined chat surface, board app frame ([170fffe](https://github.com/chadbyte/clay/commit/170fffe710aa4ac6cd7d57d1eba7b51b80f423e5))
* **board:** render the work board on the home hub ([12fd3e7](https://github.com/chadbyte/clay/commit/12fd3e7c5817e14e8514c51589cc32dbbe16d1b0))
* **board:** turn the right pane into a tool dock and abolish mate DM ([3ffe31b](https://github.com/chadbyte/clay/commit/3ffe31b99b29a154783206fcbe7d1914b7d74aea))
* **capsules:** add ephemeral model completions ([3695ede](https://github.com/chadbyte/clay/commit/3695ede9ef773088b3d375464ad07350f6ed4fc2))
* **capsules:** add experimental user opt-in ([6196fe2](https://github.com/chadbyte/clay/commit/6196fe2a36f69849a50dc975c1b925644feb4053))
* **capsules:** add source ownership controls ([1a54675](https://github.com/chadbyte/clay/commit/1a54675f177bd99fb96188b636015ec73311b0af))
* **capsules:** add tic-tac-toe board capsule ([e07b040](https://github.com/chadbyte/clay/commit/e07b0401d2c4d89d7b402923467e1fb1b8ff43cf))
* **capsules:** enforce display floor and add Pig game ([771017d](https://github.com/chadbyte/clay/commit/771017d5519006cbed65768143a8415a64a3bf71))
* **capsules:** expand declarative UI and source controls ([67aede9](https://github.com/chadbyte/clay/commit/67aede9f2772011b526593203873deac468eeec9))
* **capsules:** expand declarative UI contract ([7f44ab7](https://github.com/chadbyte/clay/commit/7f44ab7b2fb756dac58f8a13afc846b7a3d204dc))
* **capsules:** host opt-in rich display in a sandboxed separate origin ([c434426](https://github.com/chadbyte/clay/commit/c434426ba75bfa60286bce77a92ac821b8502444))
* **capsules:** improve discovery and model controls ([e31fbb3](https://github.com/chadbyte/clay/commit/e31fbb38219a652fe6bb90ad9847b77b13567aa9))
* **capsules:** make Pig playable with Mate turns ([4e6b3d5](https://github.com/chadbyte/clay/commit/4e6b3d5f5508d478f6dd4472bc85b95f5a985779))
* **capsules:** push ordered causal act events to open displays ([5f50da1](https://github.com/chadbyte/clay/commit/5f50da146bd611e4803f4a18ef1b9f5988162e0b))
* **chat:** show live thinking summaries with shimmer ([413290c](https://github.com/chadbyte/clay/commit/413290c452b9d0d8b537102dbce1364210e8ca7c))
* **codex:** add GPT-6 Astra support ([acb367f](https://github.com/chadbyte/clay/commit/acb367f0aa206393dc87fe69c3e8a478047015e0))
* **codex:** request detailed reasoning summaries so thinking renders ([f2bb21d](https://github.com/chadbyte/clay/commit/f2bb21dc87853381a63b52b4eeaa277c8fdbbf3f))
* **codex:** update bundled codex to 0.152.1 with binary override ([43b31a1](https://github.com/chadbyte/clay/commit/43b31a1a5615f54e3d6ab958a48a4f352fd90f6e))
* **debate:** expand live debate controls and participant setup ([606acc2](https://github.com/chadbyte/clay/commit/606acc2008f9680363c0c2b245e678e9b60cfb5e))
* expand home board operations and worker orchestration ([#475](https://github.com/chadbyte/clay/issues/475)) ([fe49f3c](https://github.com/chadbyte/clay/commit/fe49f3c2a4260c44c3c152f91569cd75f945cdc2))
* **git:** add persistent repository status placard ([a5e7e44](https://github.com/chadbyte/clay/commit/a5e7e444c0bfe199e20736f519de5fafc6a5a846))
* **home:** add capsule library navigation ([73b7246](https://github.com/chadbyte/clay/commit/73b724690fb3b7842226ce3bb1ed90d6d5e5fc4b))
* **home:** add debates archive ([a7b205c](https://github.com/chadbyte/clay/commit/a7b205c4bab91134e75ecbc76b63ed492d3ca92b))
* **home:** add mate backstage workbench ([f1b46cc](https://github.com/chadbyte/clay/commit/f1b46cc8cb49413372053738246acd44dae85c7c))
* **home:** add native debate planning ([cc945fc](https://github.com/chadbyte/clay/commit/cc945fc7caa2c182a9d671e742a27dc7666594e0))
* **home:** add relationship history sidebar ([302c259](https://github.com/chadbyte/clay/commit/302c259951aaa7d103012fcb872dae06acdffb88))
* **home:** add session details actions ([ff190f1](https://github.com/chadbyte/clay/commit/ff190f1d01427ecd7c1d5d530633b9320d95aa57))
* **home:** centralize mate settings ([3f4af09](https://github.com/chadbyte/clay/commit/3f4af09348f1ad423ac440fbcbbc0d8a44fa38eb))
* **home:** complete native debate workspace ([96cb1e6](https://github.com/chadbyte/clay/commit/96cb1e6d0d2a4043ea5116de25582d7c73b5c7e8))
* **home:** float capsule workbench above conversation ([084d74d](https://github.com/chadbyte/clay/commit/084d74de5f140971e5977c4f7cbd3ab0e44b3134))
* **home:** make conversation a resumable workspace ([a0f399e](https://github.com/chadbyte/clay/commit/a0f399e25dea8262bf5ae1a52bbae13514fe43c8))
* **home:** move scheduled tasks into home ([1b6c1b8](https://github.com/chadbyte/clay/commit/1b6c1b800fcf3bbd66de79c73751ff0dee31f274))
* **home:** polish board and avatar palette ([731bd47](https://github.com/chadbyte/clay/commit/731bd47bf25f1f19a302b4af166c5a1ebe749c26))
* **home:** refine mate conversations and model controls ([c151ba8](https://github.com/chadbyte/clay/commit/c151ba85fd016c7bded179be2cad47f39588cb49))
* **home:** refine overlay navigation ([5ecf420](https://github.com/chadbyte/clay/commit/5ecf420c64c977f1c8977e1f665689ee076a4d90))
* **home:** restore exact mate conversations ([807ed51](https://github.com/chadbyte/clay/commit/807ed5149e2d487420af86c12922e41636b01a04))
* **knowledge:** add unified knowledge and project logs ([8377d8f](https://github.com/chadbyte/clay/commit/8377d8f1eaff1b97d36bbe665dac2692a51f1c99))
* **logs:** allow project owners to delete entries ([aaacb18](https://github.com/chadbyte/clay/commit/aaacb182c5ccf4e84e3bee668852d9636b564676))
* **logs:** define sticky note attention lifecycle ([ce5ba32](https://github.com/chadbyte/clay/commit/ce5ba32fd0f3f25933824c75423586b163f5bfc8))
* **logs:** evolve project logs into an ambient ledger ([8fda0f0](https://github.com/chadbyte/clay/commit/8fda0f0137af66250614850f7d14458f91cf5ea4))
* **logs:** let Clay search and open cited records ([d3c148f](https://github.com/chadbyte/clay/commit/d3c148f0dbed52b14947ba6fe9986f7154432984))
* **logs:** preserve worktree change context ([46457d1](https://github.com/chadbyte/clay/commit/46457d1f6cf7dcfe6db97016c2e01986b5e39e10))
* **logs:** render log references as chips ([102aac7](https://github.com/chadbyte/clay/commit/102aac7bec2fb09f3fb11efab26d499386c17268))
* **mates:** add Clay-led Mate creation interviews ([7d1f419](https://github.com/chadbyte/clay/commit/7d1f4191b05273373865d7777aa704eace2935a4))
* **notes:** preserve completed sticky notes ([c3a735d](https://github.com/chadbyte/clay/commit/c3a735de9ff94d5f76fa28499fae16ffbefcf89d))
* **notes:** refine sticky note brand palette ([289e4ec](https://github.com/chadbyte/clay/commit/289e4ecf820ecc5986046b370ff3cef11834a364))
* **sdk:** update claude-agent-sdk to 0.3.258 and adopt new capabilities ([a82f16d](https://github.com/chadbyte/clay/commit/a82f16d5ecd4615ab98f7d4a4293f20c39bcf15c))
* **search:** add Ask Clay conversation entry ([f827cd5](https://github.com/chadbyte/clay/commit/f827cd569bde7617bfe35ff835ea8cb136906b0e))
* **split-worker:** add audited runtime and session hierarchy ([09c243f](https://github.com/chadbyte/clay/commit/09c243f671937927e4e1bfd24cda2cb8aca15759))
* **toolbar:** restore scheduled tasks button ([daa8bef](https://github.com/chadbyte/clay/commit/daa8bef50632d35059c80c6cd78112333cbdecbe))
* **tools:** the board is a capsule and a capsule is a folder ([b8ce54e](https://github.com/chadbyte/clay/commit/b8ce54e47ab91b840a07d005dfd737bd7643d3aa))
* **tools:** tool contract skeleton — manifest, declarative UI, sandboxed logic ([5f4e672](https://github.com/chadbyte/clay/commit/5f4e672997d74d9729bee351a61a0ff0dc0ed386))
* **tools:** universal mate control — clay_tool_* MCP surface ([a55103b](https://github.com/chadbyte/clay/commit/a55103bc3774496252d8ba68df6df587263e7387))
* **tools:** vendor-neutral api.llm and conversational capsule authoring ([c846396](https://github.com/chadbyte/clay/commit/c84639607054cea7ccbc573d29308398d59dbdad))
* **ui:** redesign background-tasks bar as a quiet status line ([6ace925](https://github.com/chadbyte/clay/commit/6ace925289ad617a45a164777c722b7c7ca78606))
* **updater:** add admin-only notification snoozing ([d773411](https://github.com/chadbyte/clay/commit/d7734115ded0070babe88d7187f2442456a04de4))
* **worker:** automate driver-managed worker lifecycle ([62e4171](https://github.com/chadbyte/clay/commit/62e4171e1547c12b4fea12e9c28d8d4f66951a43))
* **worker:** clarify runtime details and simplify proposal cards ([5b0d94a](https://github.com/chadbyte/clay/commit/5b0d94a3d0f4d66e2d8504b22ab002db6e9414ac))
* **worker:** route permission decisions through driver ([cb7673c](https://github.com/chadbyte/clay/commit/cb7673c6843b4cfc37e219536e352c7bc9fb5362))
* **workflow:** improve composer and Driver continuity ([6957ed3](https://github.com/chadbyte/clay/commit/6957ed325b5b89c73b2d664dd24c565c5838fa30))
* **workspace:** add cross-project Mate orchestration ([1f1d8d9](https://github.com/chadbyte/clay/commit/1f1d8d91effec385db22c2f9de2fc37776c10461))
* **yoke:** unify structured user input ([d3432e2](https://github.com/chadbyte/clay/commit/d3432e2459250a587091bd3352479362b056b5f2))


### BREAKING CHANGES

* remove the built-in Board Capsule and delete its saved
data during the v7 built-in Capsule migration.
* Scratchpad and Translator Capsule installations and their
stored data are removed when the v6 Capsule migration runs.
* mates are no longer shown in the sidebar icon strip.
Open a mate from the home screen (the C button) instead.

# [4.0.0-beta.25](https://github.com/chadbyte/clay/compare/v4.0.0-beta.24...v4.0.0-beta.25) (2026-09-09)


### Bug Fixes

* **chat:** consolidate thinking into one entry per turn ([f8a08fb](https://github.com/chadbyte/clay/commit/f8a08fb91946fa14d0a49f7b6e2c8dc0ffabba71))
* **worker:** keep runtime inline and clarify task banner ([b544002](https://github.com/chadbyte/clay/commit/b5440027fae8b13215c1f3395ccd9c71aad40d9f))


### Features

* **chat:** show live thinking summaries with shimmer ([413290c](https://github.com/chadbyte/clay/commit/413290c452b9d0d8b537102dbce1364210e8ca7c))
* **worker:** clarify runtime details and simplify proposal cards ([5b0d94a](https://github.com/chadbyte/clay/commit/5b0d94a3d0f4d66e2d8504b22ab002db6e9414ac))

# [4.0.0-beta.24](https://github.com/chadbyte/clay/compare/v4.0.0-beta.23...v4.0.0-beta.24) (2026-09-09)


### Bug Fixes

* **auth:** enforce project and session access boundaries ([#489](https://github.com/chadbyte/clay/issues/489)) ([51a05a9](https://github.com/chadbyte/clay/commit/51a05a92a1bfa94407c03b7946bcbe96621c03d6))

# [4.0.0-beta.23](https://github.com/chadbyte/clay/compare/v4.0.0-beta.22...v4.0.0-beta.23) (2026-09-09)


### Bug Fixes

* **home:** restore project bootstrap and default root workspace ([e964c3a](https://github.com/chadbyte/clay/commit/e964c3a15032e334a895dc1791a1aa0fa09625c8))

# [4.0.0-beta.22](https://github.com/chadbyte/clay/compare/v4.0.0-beta.21...v4.0.0-beta.22) (2026-09-09)


### Bug Fixes

* **home:** wait for session restoration before closing Home ([e798f85](https://github.com/chadbyte/clay/commit/e798f855da430977c69dd649bea873486516a118))
* **sessions:** allow admins to access private sessions ([3f13dec](https://github.com/chadbyte/clay/commit/3f13decd36aa77f1c8d95906bf7391329da02be1))
* **sessions:** restore Home navigation and allow admin access ([#487](https://github.com/chadbyte/clay/issues/487)) ([a57125a](https://github.com/chadbyte/clay/commit/a57125ac84db53c7e776b1692c543146155737c4))

# [4.0.0-beta.21](https://github.com/chadbyte/clay/compare/v4.0.0-beta.20...v4.0.0-beta.21) (2026-09-09)


### Bug Fixes

* **ui:** show visibility badges only for shared sessions ([14bfea0](https://github.com/chadbyte/clay/commit/14bfea0734fba20b49c02abfdad9f73fd9898a8b))
* **ui:** show visibility badges only for shared sessions ([#486](https://github.com/chadbyte/clay/issues/486)) ([fdd100e](https://github.com/chadbyte/clay/commit/fdd100ec6e0051eb3f47507b6826c3be6ff399f5))

# [4.0.0-beta.20](https://github.com/chadbyte/clay/compare/v4.0.0-beta.19...v4.0.0-beta.20) (2026-09-09)


### Bug Fixes

* **claude:** preserve first messages during worker startup ([008199b](https://github.com/chadbyte/clay/commit/008199bfb5ca707539bf3fdea0de591d894408b0))
* **sessions:** make sharing explicit and default to private ([cd6d5cc](https://github.com/chadbyte/clay/commit/cd6d5cc90c9e42bd5990e27a3a9cef1e75d0b3fa))
* **sessions:** preserve startup input and enforce private defaults ([#485](https://github.com/chadbyte/clay/issues/485)) ([05f5e99](https://github.com/chadbyte/clay/commit/05f5e99d07a81252014236bbb60387621fa82c82))

# [4.0.0-beta.19](https://github.com/chadbyte/clay/compare/v4.0.0-beta.18...v4.0.0-beta.19) (2026-09-09)


### Bug Fixes

* **home:** restore new user workspace access ([1f35b10](https://github.com/chadbyte/clay/commit/1f35b107c8d8c15d0917a74e3672e7bd16b776df))
* **sessions:** preserve driver and worker hierarchy actions ([b4c6b5d](https://github.com/chadbyte/clay/commit/b4c6b5d1bba5ceece675710d45f9e0ee67d76caa))
* **worktree:** run git operations as the project owner ([5ca1609](https://github.com/chadbyte/clay/commit/5ca16096d83826611d1509a027269a90243e9114))

# [4.0.0-beta.18](https://github.com/chadbyte/clay/compare/v4.0.0-beta.17...v4.0.0-beta.18) (2026-09-08)


### Bug Fixes

* **admin:** replace native destructive confirmations ([e8fbc63](https://github.com/chadbyte/clay/commit/e8fbc632d65ab1387bf90700068627d1fc705f8c))
* **home:** restore workspace for new users ([a54f526](https://github.com/chadbyte/clay/commit/a54f526eeae66864876d18ef22f71f9bd5644643))
* **notes:** restore isolated backdrop blur ([335884c](https://github.com/chadbyte/clay/commit/335884cdd67b8e1237cdc44548612f2237cb692a))
* **sidebar:** collapse split worker hierarchy ([12125f5](https://github.com/chadbyte/clay/commit/12125f524c7e594d13a90742647145841eb85c8f))
* **worker:** resolve live session tool handlers ([9980862](https://github.com/chadbyte/clay/commit/99808620276d2a7c5b79de848022fb747e19c4b2))


### Features

* **logs:** let Clay search and open cited records ([d3c148f](https://github.com/chadbyte/clay/commit/d3c148f0dbed52b14947ba6fe9986f7154432984))
* **logs:** render log references as chips ([102aac7](https://github.com/chadbyte/clay/commit/102aac7bec2fb09f3fb11efab26d499386c17268))

# [4.0.0-beta.17](https://github.com/chadbyte/clay/compare/v4.0.0-beta.16...v4.0.0-beta.17) (2026-09-07)


### Bug Fixes

* **chat:** recover unacknowledged startup messages ([be9d9cf](https://github.com/chadbyte/clay/commit/be9d9cf6e7d531e9e1ddf40c493416790e19823f))
* **logs:** review comments without blocking the driver ([531956a](https://github.com/chadbyte/clay/commit/531956ab0c31ded9e7199c94e29101113f9f9dba))


### Features

* **logs:** allow project owners to delete entries ([aaacb18](https://github.com/chadbyte/clay/commit/aaacb182c5ccf4e84e3bee668852d9636b564676))
* **logs:** preserve worktree change context ([46457d1](https://github.com/chadbyte/clay/commit/46457d1f6cf7dcfe6db97016c2e01986b5e39e10))

# [4.0.0-beta.16](https://github.com/chadbyte/clay/compare/v4.0.0-beta.15...v4.0.0-beta.16) (2026-09-07)


### Bug Fixes

* **deps:** resolve dependency security advisories ([f799207](https://github.com/chadbyte/clay/commit/f79920747968d9e51a3d43fd71d624eb7767c722))
* **notes:** prevent sticky note flicker ([76acd07](https://github.com/chadbyte/clay/commit/76acd07d8562776dc902fa6c65ac7740dadb0bbd))
* **notes:** skip redundant permission prompts ([60b401c](https://github.com/chadbyte/clay/commit/60b401c9f5c4bb703fa2f3a9fc46daa0dd80d334))
* **projects:** preserve navigation after active deletion ([ede51fd](https://github.com/chadbyte/clay/commit/ede51fd3201a3356ecc846d15f3451feb7cf829a))
* **worker:** preserve Codex pair tools across resume ([91e38e1](https://github.com/chadbyte/clay/commit/91e38e1b3192d87508228b2b4d6cc828afb4ae35))
* **workers:** gate orchestration guidance by model tier ([30f3977](https://github.com/chadbyte/clay/commit/30f39778395ce52a1f42ca8d296d3b0e3cfcfc87))


### Features

* **capsules:** add experimental user opt-in ([6196fe2](https://github.com/chadbyte/clay/commit/6196fe2a36f69849a50dc975c1b925644feb4053))
* **capsules:** make Pig playable with Mate turns ([4e6b3d5](https://github.com/chadbyte/clay/commit/4e6b3d5f5508d478f6dd4472bc85b95f5a985779))
* **codex:** add GPT-6 Astra support ([acb367f](https://github.com/chadbyte/clay/commit/acb367f0aa206393dc87fe69c3e8a478047015e0))
* **workflow:** improve composer and Driver continuity ([6957ed3](https://github.com/chadbyte/clay/commit/6957ed325b5b89c73b2d664dd24c565c5838fa30))

# [4.0.0-beta.15](https://github.com/chadbyte/clay/compare/v4.0.0-beta.14...v4.0.0-beta.15) (2026-09-04)


### Features

* **capsules:** add tic-tac-toe board capsule ([e07b040](https://github.com/chadbyte/clay/commit/e07b0401d2c4d89d7b402923467e1fb1b8ff43cf))
* **capsules:** enforce display floor and add Pig game ([771017d](https://github.com/chadbyte/clay/commit/771017d5519006cbed65768143a8415a64a3bf71))
* **capsules:** host opt-in rich display in a sandboxed separate origin ([c434426](https://github.com/chadbyte/clay/commit/c434426ba75bfa60286bce77a92ac821b8502444))
* **capsules:** push ordered causal act events to open displays ([5f50da1](https://github.com/chadbyte/clay/commit/5f50da146bd611e4803f4a18ef1b9f5988162e0b))
* **split-worker:** add audited runtime and session hierarchy ([09c243f](https://github.com/chadbyte/clay/commit/09c243f671937927e4e1bfd24cda2cb8aca15759))

# [4.0.0-beta.14](https://github.com/chadbyte/clay/compare/v4.0.0-beta.13...v4.0.0-beta.14) (2026-09-03)


### Bug Fixes

* **logs:** deliver comments to the authoring session ([bc0d6e7](https://github.com/chadbyte/clay/commit/bc0d6e7f5469902aa88d8798f631542c4ac3518c))
* **logs:** skip redundant permission prompts ([fe57a63](https://github.com/chadbyte/clay/commit/fe57a632a73da06118d57cf4af98ca0f2e1c5a7a))
* **pair:** honor driver choice and bound overload retries ([b04bdb2](https://github.com/chadbyte/clay/commit/b04bdb2bcb5f0a0b914e3b476bc363307b01cb44))

# [4.0.0-beta.13](https://github.com/chadbyte/clay/compare/v4.0.0-beta.12...v4.0.0-beta.13) (2026-09-03)


### Bug Fixes

* **home:** generate meaningful chat titles ([8ad903f](https://github.com/chadbyte/clay/commit/8ad903feba3e5ade9752d74a36484b82968c5630))
* **logs:** preserve sticky notes when opening ledger ([94de68e](https://github.com/chadbyte/clay/commit/94de68ef26a218cd5763be2636c27425e9e81578))
* **logs:** remove edge reveal interaction ([34f9e90](https://github.com/chadbyte/clay/commit/34f9e90e9e4fc2b042fe9b20892671d91f798c6a))
* **logs:** reserve learning for user moments ([8e0b511](https://github.com/chadbyte/clay/commit/8e0b511403b8cbc96f06fe9f35c37b3ff07ca80f))
* **worker:** enforce human stop across pair lifecycle ([9999881](https://github.com/chadbyte/clay/commit/999988150e08af72fbf85780a58acf1ec8b3602a))

# [4.0.0-beta.12](https://github.com/chadbyte/clay/compare/v4.0.0-beta.11...v4.0.0-beta.12) (2026-09-03)


### Bug Fixes

* **worker:** restore split worker creation ([e954274](https://github.com/chadbyte/clay/commit/e95427406683712f375bc630d6a207f8c553ec62))
* **worker:** restore split worker creation ([#476](https://github.com/chadbyte/clay/issues/476)) ([ddb7170](https://github.com/chadbyte/clay/commit/ddb7170d25ee3d062b81a37c61c3ff3d64231f94))

# [4.0.0-beta.11](https://github.com/chadbyte/clay/compare/v4.0.0-beta.10...v4.0.0-beta.11) (2026-09-03)


### Bug Fixes

* **daemon:** preserve live processes on permission errors ([1aba098](https://github.com/chadbyte/clay/commit/1aba098c7142b4d0c9030dc02f91985d18d1a88d))
* **knowledge:** make result ordering deterministic ([e154fb6](https://github.com/chadbyte/clay/commit/e154fb69492de8d2e1316fb25aa90c3db3c9575d))
* **security:** enforce authoritative workspace access ([010c983](https://github.com/chadbyte/clay/commit/010c983b80548938d4bcf5aa35ad71a94bdaeb41))


### Features

* expand home board operations and worker orchestration ([#475](https://github.com/chadbyte/clay/issues/475)) ([fe49f3c](https://github.com/chadbyte/clay/commit/fe49f3c2a4260c44c3c152f91569cd75f945cdc2))
* **git:** add persistent repository status placard ([a5e7e44](https://github.com/chadbyte/clay/commit/a5e7e444c0bfe199e20736f519de5fafc6a5a846))
* **logs:** define sticky note attention lifecycle ([ce5ba32](https://github.com/chadbyte/clay/commit/ce5ba32fd0f3f25933824c75423586b163f5bfc8))
* **notes:** preserve completed sticky notes ([c3a735d](https://github.com/chadbyte/clay/commit/c3a735de9ff94d5f76fa28499fae16ffbefcf89d))
* **toolbar:** restore scheduled tasks button ([daa8bef](https://github.com/chadbyte/clay/commit/daa8bef50632d35059c80c6cd78112333cbdecbe))
* **updater:** add admin-only notification snoozing ([d773411](https://github.com/chadbyte/clay/commit/d7734115ded0070babe88d7187f2442456a04de4))
* **worker:** automate driver-managed worker lifecycle ([62e4171](https://github.com/chadbyte/clay/commit/62e4171e1547c12b4fea12e9c28d8d4f66951a43))
* **worker:** route permission decisions through driver ([cb7673c](https://github.com/chadbyte/clay/commit/cb7673c6843b4cfc37e219536e352c7bc9fb5362))

# [4.0.0-beta.10](https://github.com/chadbyte/clay/compare/v4.0.0-beta.9...v4.0.0-beta.10) (2026-09-02)


### Bug Fixes

* **ui:** preserve Logs toolbar position ([0c00ddd](https://github.com/chadbyte/clay/commit/0c00dddb83a8f17d6ce79523f771251365213353))
* **ui:** prevent reconnect redraw flicker ([f13da17](https://github.com/chadbyte/clay/commit/f13da17ac5d125e2e8bfe500b6f79f584200edad))


### Features

* **home:** move scheduled tasks into home ([1b6c1b8](https://github.com/chadbyte/clay/commit/1b6c1b800fcf3bbd66de79c73751ff0dee31f274))
* **knowledge:** add unified knowledge and project logs ([8377d8f](https://github.com/chadbyte/clay/commit/8377d8f1eaff1b97d36bbe665dac2692a51f1c99))
* **logs:** evolve project logs into an ambient ledger ([8fda0f0](https://github.com/chadbyte/clay/commit/8fda0f0137af66250614850f7d14458f91cf5ea4))

# [4.0.0-beta.9](https://github.com/chadbyte/clay/compare/v4.0.0-beta.8...v4.0.0-beta.9) (2026-09-02)


### Bug Fixes

* **auth:** trust Codex runtime authentication failures ([371ed5d](https://github.com/chadbyte/clay/commit/371ed5df53168ad1fac347a8a8685e8ee3297305))

# [4.0.0-beta.8](https://github.com/chadbyte/clay/compare/v4.0.0-beta.7...v4.0.0-beta.8) (2026-09-02)


### Bug Fixes

* **auth:** refresh Codex login across projects ([626e9ab](https://github.com/chadbyte/clay/commit/626e9ab698de832f0f64c46154f94ce7873aa33d))

# [4.0.0-beta.7](https://github.com/chadbyte/clay/compare/v4.0.0-beta.6...v4.0.0-beta.7) (2026-09-02)


### Bug Fixes

* **auth:** recheck Codex credentials after login ([1c9d1e4](https://github.com/chadbyte/clay/commit/1c9d1e4f700a64b27e2b642119e5b0a8d339a47e))

# [4.0.0-beta.6](https://github.com/chadbyte/clay/compare/v4.0.0-beta.5...v4.0.0-beta.6) (2026-09-02)


### Bug Fixes

* **auth:** prevent login prompt replay ([7f00048](https://github.com/chadbyte/clay/commit/7f00048eb32f6c870cee07cd62c90466cc0a0be1))

# [4.0.0-beta.5](https://github.com/chadbyte/clay/compare/v4.0.0-beta.4...v4.0.0-beta.5) (2026-09-02)


### Features

* **sdk:** update claude-agent-sdk to 0.3.258 and adopt new capabilities ([a82f16d](https://github.com/chadbyte/clay/commit/a82f16d5ecd4615ab98f7d4a4293f20c39bcf15c))

# [4.0.0-beta.4](https://github.com/chadbyte/clay/compare/v4.0.0-beta.3...v4.0.0-beta.4) (2026-09-02)


### Features

* **codex:** request detailed reasoning summaries so thinking renders ([f2bb21d](https://github.com/chadbyte/clay/commit/f2bb21dc87853381a63b52b4eeaa277c8fdbbf3f))

# [4.0.0-beta.3](https://github.com/chadbyte/clay/compare/v4.0.0-beta.2...v4.0.0-beta.3) (2026-09-02)


### Features

* **ui:** redesign background-tasks bar as a quiet status line ([6ace925](https://github.com/chadbyte/clay/commit/6ace925289ad617a45a164777c722b7c7ca78606))

# [4.0.0-beta.2](https://github.com/chadbyte/clay/compare/v4.0.0-beta.1...v4.0.0-beta.2) (2026-09-02)


### Bug Fixes

* **capsules:** tolerate missing capsules root when seeding built-ins ([014d919](https://github.com/chadbyte/clay/commit/014d9198ac4fffebeb08dad5400876d4839b0a6c))
* **login:** stop vendor login loop with server-owned per-vendor flow ([b9b27ad](https://github.com/chadbyte/clay/commit/b9b27ad3b533e7324330a027a54668c682f15a01))


### Features

* **codex:** update bundled codex to 0.152.1 with binary override ([43b31a1](https://github.com/chadbyte/clay/commit/43b31a1a5615f54e3d6ab958a48a4f352fd90f6e))

# [4.0.0-beta.1](https://github.com/chadbyte/clay/compare/v3.8.1...v4.0.0-beta.1) (2026-09-01)


* feat(board)!: rebuild home as the work hub with mates beside the board ([6d83a54](https://github.com/chadbyte/clay/commit/6d83a54d06cac5ec25d7bc984e1d5b4cf4979b42))
* feat(capsules)!: add Mate-driven Capsule Home ([e6ef64e](https://github.com/chadbyte/clay/commit/e6ef64ef3e3f2f905accb964b5411d883e23aa15))
* feat(capsules)!: remove scratchpad and translator ([0382fb7](https://github.com/chadbyte/clay/commit/0382fb7718d7437150734cd00257ae0d65786d1b))


### Bug Fixes

* **capsules:** allow blob worker runtime ([c237f89](https://github.com/chadbyte/clay/commit/c237f8940e46eb002718f496f355d50e40504363))
* **capsules:** preserve Korean IME composition ([fe43fb3](https://github.com/chadbyte/clay/commit/fe43fb3f3f8103ef730bfafb25745dd701f4e71f))
* **capsules:** stabilize text input and model resolution ([433c4a5](https://github.com/chadbyte/clay/commit/433c4a5ce428e4a86ee549b28a24b0c90b31ad26))
* **home:** apply draft models and restore composer focus ([5efb84a](https://github.com/chadbyte/clay/commit/5efb84a3194d57c477f70e54f8823b2562fff60d))
* **home:** keep close control outside workbench ([e8259a5](https://github.com/chadbyte/clay/commit/e8259a5caa6bedad9660507655b51075ecdb120c))
* **home:** stabilize mate model and response delivery ([c144342](https://github.com/chadbyte/clay/commit/c144342251ebedf124555e07961d9643751f8a4a))
* **pairing:** disambiguate visible Split Workers ([59a1e1f](https://github.com/chadbyte/clay/commit/59a1e1f8c7cb7b77c7bf7d1108399d158cf441c5))
* **search:** complete Ask Clay workspace conversations ([a9849e1](https://github.com/chadbyte/clay/commit/a9849e1d3a3cac8f73118348ed99673194725077)), closes [#213](https://github.com/chadbyte/clay/issues/213)
* **settings:** apply saved environment to agent runtimes ([b8b3d9e](https://github.com/chadbyte/clay/commit/b8b3d9e7d99224e87cb09efea591ff985ad3bf0e))
* **tools:** stop restarting the worker on ordinary action errors ([1759660](https://github.com/chadbyte/clay/commit/17596600a5d1fc48abe234b5efd2597a323548ab))
* **yoke:** auto-approve structured user input ([85fa7dc](https://github.com/chadbyte/clay/commit/85fa7dc16408619a6cf0204b22404f569b394ec4))


### Features

* **board:** add per-user work board storage and websocket layer ([fe9fc07](https://github.com/chadbyte/clay/commit/fe9fc070e6b6a75ae0500d79fcf5256584188b51))
* **board:** calm conversation stage — two-voice chat, mate switcher, no mate colors ([3407ef8](https://github.com/chadbyte/clay/commit/3407ef8cb4347d27ecbd6822433efd2d98448d00))
* **board:** chat with mates inside the home screen ([7292564](https://github.com/chadbyte/clay/commit/7292564eafa1775681150d1fa372dc6e95a322fc))
* **board:** collapsible dock with three states replaces the fixed split ([a135237](https://github.com/chadbyte/clay/commit/a1352371cb9a1acc80c1d1007c4182c41e116371))
* **board:** home shell — root route, quiet home bar, project chrome retired ([619d384](https://github.com/chadbyte/clay/commit/619d384e4e4093e75b593417a671b49a2a6b3365))
* **board:** hover identity cards, defined chat surface, board app frame ([170fffe](https://github.com/chadbyte/clay/commit/170fffe710aa4ac6cd7d57d1eba7b51b80f423e5))
* **board:** render the work board on the home hub ([12fd3e7](https://github.com/chadbyte/clay/commit/12fd3e7c5817e14e8514c51589cc32dbbe16d1b0))
* **board:** turn the right pane into a tool dock and abolish mate DM ([3ffe31b](https://github.com/chadbyte/clay/commit/3ffe31b99b29a154783206fcbe7d1914b7d74aea))
* **capsules:** add ephemeral model completions ([3695ede](https://github.com/chadbyte/clay/commit/3695ede9ef773088b3d375464ad07350f6ed4fc2))
* **capsules:** add source ownership controls ([1a54675](https://github.com/chadbyte/clay/commit/1a54675f177bd99fb96188b636015ec73311b0af))
* **capsules:** expand declarative UI and source controls ([67aede9](https://github.com/chadbyte/clay/commit/67aede9f2772011b526593203873deac468eeec9))
* **capsules:** expand declarative UI contract ([7f44ab7](https://github.com/chadbyte/clay/commit/7f44ab7b2fb756dac58f8a13afc846b7a3d204dc))
* **capsules:** improve discovery and model controls ([e31fbb3](https://github.com/chadbyte/clay/commit/e31fbb38219a652fe6bb90ad9847b77b13567aa9))
* **debate:** expand live debate controls and participant setup ([606acc2](https://github.com/chadbyte/clay/commit/606acc2008f9680363c0c2b245e678e9b60cfb5e))
* **home:** add capsule library navigation ([73b7246](https://github.com/chadbyte/clay/commit/73b724690fb3b7842226ce3bb1ed90d6d5e5fc4b))
* **home:** add debates archive ([a7b205c](https://github.com/chadbyte/clay/commit/a7b205c4bab91134e75ecbc76b63ed492d3ca92b))
* **home:** add mate backstage workbench ([f1b46cc](https://github.com/chadbyte/clay/commit/f1b46cc8cb49413372053738246acd44dae85c7c))
* **home:** add native debate planning ([cc945fc](https://github.com/chadbyte/clay/commit/cc945fc7caa2c182a9d671e742a27dc7666594e0))
* **home:** add relationship history sidebar ([302c259](https://github.com/chadbyte/clay/commit/302c259951aaa7d103012fcb872dae06acdffb88))
* **home:** add session details actions ([ff190f1](https://github.com/chadbyte/clay/commit/ff190f1d01427ecd7c1d5d530633b9320d95aa57))
* **home:** centralize mate settings ([3f4af09](https://github.com/chadbyte/clay/commit/3f4af09348f1ad423ac440fbcbbc0d8a44fa38eb))
* **home:** complete native debate workspace ([96cb1e6](https://github.com/chadbyte/clay/commit/96cb1e6d0d2a4043ea5116de25582d7c73b5c7e8))
* **home:** float capsule workbench above conversation ([084d74d](https://github.com/chadbyte/clay/commit/084d74de5f140971e5977c4f7cbd3ab0e44b3134))
* **home:** make conversation a resumable workspace ([a0f399e](https://github.com/chadbyte/clay/commit/a0f399e25dea8262bf5ae1a52bbae13514fe43c8))
* **home:** polish board and avatar palette ([731bd47](https://github.com/chadbyte/clay/commit/731bd47bf25f1f19a302b4af166c5a1ebe749c26))
* **home:** refine mate conversations and model controls ([c151ba8](https://github.com/chadbyte/clay/commit/c151ba85fd016c7bded179be2cad47f39588cb49))
* **home:** refine overlay navigation ([5ecf420](https://github.com/chadbyte/clay/commit/5ecf420c64c977f1c8977e1f665689ee076a4d90))
* **home:** restore exact mate conversations ([807ed51](https://github.com/chadbyte/clay/commit/807ed5149e2d487420af86c12922e41636b01a04))
* **mates:** add Clay-led Mate creation interviews ([7d1f419](https://github.com/chadbyte/clay/commit/7d1f4191b05273373865d7777aa704eace2935a4))
* **notes:** refine sticky note brand palette ([289e4ec](https://github.com/chadbyte/clay/commit/289e4ecf820ecc5986046b370ff3cef11834a364))
* **search:** add Ask Clay conversation entry ([f827cd5](https://github.com/chadbyte/clay/commit/f827cd569bde7617bfe35ff835ea8cb136906b0e))
* **tools:** the board is a capsule and a capsule is a folder ([b8ce54e](https://github.com/chadbyte/clay/commit/b8ce54e47ab91b840a07d005dfd737bd7643d3aa))
* **tools:** tool contract skeleton — manifest, declarative UI, sandboxed logic ([5f4e672](https://github.com/chadbyte/clay/commit/5f4e672997d74d9729bee351a61a0ff0dc0ed386))
* **tools:** universal mate control — clay_tool_* MCP surface ([a55103b](https://github.com/chadbyte/clay/commit/a55103bc3774496252d8ba68df6df587263e7387))
* **tools:** vendor-neutral api.llm and conversational capsule authoring ([c846396](https://github.com/chadbyte/clay/commit/c84639607054cea7ccbc573d29308398d59dbdad))
* **workspace:** add cross-project Mate orchestration ([1f1d8d9](https://github.com/chadbyte/clay/commit/1f1d8d91effec385db22c2f9de2fc37776c10461))
* **yoke:** unify structured user input ([d3432e2](https://github.com/chadbyte/clay/commit/d3432e2459250a587091bd3352479362b056b5f2))


### BREAKING CHANGES

* remove the built-in Board Capsule and delete its saved
data during the v7 built-in Capsule migration.
* Scratchpad and Translator Capsule installations and their
stored data are removed when the v6 Capsule migration runs.
* mates are no longer shown in the sidebar icon strip.
Open a mate from the home screen (the C button) instead.

## [3.8.1](https://github.com/chadbyte/clay/compare/v3.8.0...v3.8.1) (2026-08-30)


### Bug Fixes

* **worktree:** skip stale worktree directories ([5ae299f](https://github.com/chadbyte/clay/commit/5ae299f17090ab787956ee92120d1ea5e6e99ad6))

# [3.8.0](https://github.com/chadbyte/clay/compare/v3.7.0...v3.8.0) (2026-08-30)


### Bug Fixes

* **terminal:** preserve panel header on desktop resize ([bbbc644](https://github.com/chadbyte/clay/commit/bbbc644602711515d865e39d6c248b821851e082))


### Features

* **imagegen:** save generated images to project ([232eaac](https://github.com/chadbyte/clay/commit/232eaac8bf21acfb24b5c38acda747c055ecedff))
* **imagegen:** save generated images to project ([#459](https://github.com/chadbyte/clay/issues/459)) ([2eed480](https://github.com/chadbyte/clay/commit/2eed480f2733367f5cc9112946289ee550eeb17b))
* **session:** add complete Driver control for visible Workers ([fb2a541](https://github.com/chadbyte/clay/commit/fb2a54160f747c9dfee49b7eb742d9b03b951d7a))
* **ui:** unify avatar identity and session actions ([#460](https://github.com/chadbyte/clay/issues/460)) ([7b04d0c](https://github.com/chadbyte/clay/commit/7b04d0ce66032b6df4d6ec5a40c5f3bcafcfcc98))

# [3.8.0-beta.4](https://github.com/chadbyte/clay/compare/v3.8.0-beta.3...v3.8.0-beta.4) (2026-08-29)


### Bug Fixes

* **terminal:** preserve panel header on desktop resize ([bbbc644](https://github.com/chadbyte/clay/commit/bbbc644602711515d865e39d6c248b821851e082))

# [3.8.0-beta.3](https://github.com/chadbyte/clay/compare/v3.8.0-beta.2...v3.8.0-beta.3) (2026-08-29)


### Features

* **session:** add complete Driver control for visible Workers ([fb2a541](https://github.com/chadbyte/clay/commit/fb2a54160f747c9dfee49b7eb742d9b03b951d7a))

# [3.8.0-beta.2](https://github.com/chadbyte/clay/compare/v3.8.0-beta.1...v3.8.0-beta.2) (2026-08-29)


### Features

* **ui:** unify avatar identity and session actions ([#460](https://github.com/chadbyte/clay/issues/460)) ([7b04d0c](https://github.com/chadbyte/clay/commit/7b04d0ce66032b6df4d6ec5a40c5f3bcafcfcc98))

# [3.8.0-beta.1](https://github.com/chadbyte/clay/compare/v3.7.0...v3.8.0-beta.1) (2026-08-29)


### Features

* **imagegen:** save generated images to project ([232eaac](https://github.com/chadbyte/clay/commit/232eaac8bf21acfb24b5c38acda747c055ecedff))
* **imagegen:** save generated images to project ([#459](https://github.com/chadbyte/clay/issues/459)) ([2eed480](https://github.com/chadbyte/clay/commit/2eed480f2733367f5cc9112946289ee550eeb17b))

# [3.7.0](https://github.com/chadbyte/clay/compare/v3.6.0...v3.7.0) (2026-08-29)


### Bug Fixes

* **terminal:** limit dark theme to terminal canvas ([c98bc1a](https://github.com/chadbyte/clay/commit/c98bc1a015b56643faa32fc215643c1be60bc17b))


### Features

* **codex:** show image generation progress ([8b2a199](https://github.com/chadbyte/clay/commit/8b2a199961f8b4ca305abd1ce879865020723aef))
* **codex:** support inline image generation ([71282a6](https://github.com/chadbyte/clay/commit/71282a62e65087e730bd31c98c2d23a231308f9a))
* **filebrowser:** add file downloads ([518c7fa](https://github.com/chadbyte/clay/commit/518c7fa5fb20f3f4e9e27ccca131b2bf29128127))
* **ui:** enhance file browser and lock terminal theme ([838b20a](https://github.com/chadbyte/clay/commit/838b20a3eb148c5a4b6739146abb13aa0b2214f9))
* **ui:** enhance file browser and terminal theming ([#456](https://github.com/chadbyte/clay/issues/456)) ([86552c6](https://github.com/chadbyte/clay/commit/86552c67826a08903be662ff75f6b2970bab281a))

# [3.7.0-beta.2](https://github.com/chadbyte/clay/compare/v3.7.0-beta.1...v3.7.0-beta.2) (2026-08-29)


### Bug Fixes

* **terminal:** limit dark theme to terminal canvas ([c98bc1a](https://github.com/chadbyte/clay/commit/c98bc1a015b56643faa32fc215643c1be60bc17b))


### Features

* **filebrowser:** add file downloads ([518c7fa](https://github.com/chadbyte/clay/commit/518c7fa5fb20f3f4e9e27ccca131b2bf29128127))
* **ui:** enhance file browser and lock terminal theme ([838b20a](https://github.com/chadbyte/clay/commit/838b20a3eb148c5a4b6739146abb13aa0b2214f9))
* **ui:** enhance file browser and terminal theming ([#456](https://github.com/chadbyte/clay/issues/456)) ([86552c6](https://github.com/chadbyte/clay/commit/86552c67826a08903be662ff75f6b2970bab281a))

# [3.7.0-beta.1](https://github.com/chadbyte/clay/compare/v3.6.0...v3.7.0-beta.1) (2026-08-28)


### Features

* **codex:** show image generation progress ([8b2a199](https://github.com/chadbyte/clay/commit/8b2a199961f8b4ca305abd1ce879865020723aef))
* **codex:** support inline image generation ([71282a6](https://github.com/chadbyte/clay/commit/71282a62e65087e730bd31c98c2d23a231308f9a))

# [3.6.0](https://github.com/chadbyte/clay/compare/v3.5.1...v3.6.0) (2026-08-27)


### Features

* **brand:** establish Clay Studio identity ([73fd417](https://github.com/chadbyte/clay/commit/73fd4177090b5e6429ad0742190c9e5c47b6092d))
* **document-viewer:** add SVG preview mode ([d44335d](https://github.com/chadbyte/clay/commit/d44335d4d2b3f081bf824b1c507ba9ecda51e89c))
* **document-viewer:** add VS Code-style preview tabs ([10d6919](https://github.com/chadbyte/clay/commit/10d6919f900759e6176e94de3a64a97ea34d51bb))
* **os-users:** add compatibility diagnostics ([715d502](https://github.com/chadbyte/clay/commit/715d5025edd7d388fb0ee12928b6390d54b81875))
* **theme:** add Clay Studio default themes ([403080d](https://github.com/chadbyte/clay/commit/403080ddd1b666955b9893a2d1350c93a7e9af48))

# [3.6.0-beta.2](https://github.com/chadbyte/clay/compare/v3.6.0-beta.1...v3.6.0-beta.2) (2026-08-27)


### Features

* **brand:** establish Clay Studio identity ([73fd417](https://github.com/chadbyte/clay/commit/73fd4177090b5e6429ad0742190c9e5c47b6092d))
* **theme:** add Clay Studio default themes ([403080d](https://github.com/chadbyte/clay/commit/403080ddd1b666955b9893a2d1350c93a7e9af48))

# [3.6.0-beta.1](https://github.com/chadbyte/clay/compare/v3.5.1...v3.6.0-beta.1) (2026-08-27)


### Features

* **document-viewer:** add SVG preview mode ([d44335d](https://github.com/chadbyte/clay/commit/d44335d4d2b3f081bf824b1c507ba9ecda51e89c))
* **document-viewer:** add VS Code-style preview tabs ([10d6919](https://github.com/chadbyte/clay/commit/10d6919f900759e6176e94de3a64a97ea34d51bb))
* **os-users:** add compatibility diagnostics ([715d502](https://github.com/chadbyte/clay/commit/715d5025edd7d388fb0ee12928b6390d54b81875))

## [3.5.1](https://github.com/chadbyte/clay/compare/v3.5.0...v3.5.1) (2026-08-27)


### Bug Fixes

* **session:** persist active Worker identity immediately ([15d8996](https://github.com/chadbyte/clay/commit/15d8996b9c4bb665761a28c055d07f958bbe52f9))

## [3.5.1-beta.1](https://github.com/chadbyte/clay/compare/v3.5.0...v3.5.1-beta.1) (2026-08-27)


### Bug Fixes

* **session:** persist active Worker identity immediately ([15d8996](https://github.com/chadbyte/clay/commit/15d8996b9c4bb665761a28c055d07f958bbe52f9))

# [3.5.0](https://github.com/chadbyte/clay/compare/v3.4.0...v3.5.0) (2026-08-27)


### Bug Fixes

* **sessions:** restore split view after daemon restart ([62e024a](https://github.com/chadbyte/clay/commit/62e024a8d46a3a5a042797eb617551f755acd375))
* **ui:** dock document viewer on the right ([f649210](https://github.com/chadbyte/clay/commit/f649210f452336f8f26af802c80c383efee98a31))


### Features

* **session:** add handoff source history tool ([1d09e47](https://github.com/chadbyte/clay/commit/1d09e47367a6071a5471c6c4b1215b45e0c53466))

# [3.5.0-beta.3](https://github.com/chadbyte/clay/compare/v3.5.0-beta.2...v3.5.0-beta.3) (2026-08-26)


### Bug Fixes

* **ui:** dock document viewer on the right ([f649210](https://github.com/chadbyte/clay/commit/f649210f452336f8f26af802c80c383efee98a31))

# [3.5.0-beta.2](https://github.com/chadbyte/clay/compare/v3.5.0-beta.1...v3.5.0-beta.2) (2026-08-26)


### Bug Fixes

* **sessions:** restore split view after daemon restart ([62e024a](https://github.com/chadbyte/clay/commit/62e024a8d46a3a5a042797eb617551f755acd375))

# [3.5.0-beta.1](https://github.com/chadbyte/clay/compare/v3.4.0...v3.5.0-beta.1) (2026-08-26)


### Features

* **session:** add handoff source history tool ([1d09e47](https://github.com/chadbyte/clay/commit/1d09e47367a6071a5471c6c4b1215b45e0c53466))

# [3.4.0](https://github.com/chadbyte/clay/compare/v3.3.1...v3.4.0) (2026-08-26)


### Bug Fixes

* **codex:** handle session writer conflicts ([247483b](https://github.com/chadbyte/clay/commit/247483b4a25e64d24ed8cef40ec02f9be2390682))
* **daemon:** create IPC socket before project registration ([6329f12](https://github.com/chadbyte/clay/commit/6329f12be3edf104d6cb3cd6543a0458b9403731))
* **debate:** prevent proposal failures from stopping daemon ([05ee090](https://github.com/chadbyte/clay/commit/05ee090b70bfd291a80b1081c77daf94f422bda6))
* **files:** make file watching resilient ([cfaa188](https://github.com/chadbyte/clay/commit/cfaa188cf1a1d25f1484758a42996f7d8114155b))
* **kiro:** widen ACP initialize timeout to 90s ([38f6def](https://github.com/chadbyte/clay/commit/38f6def1ef55831a2913b56d28690ef8df4263b0))
* **mobile:** correct PWA chat layout ([#420](https://github.com/chadbyte/clay/issues/420)) ([159ee82](https://github.com/chadbyte/clay/commit/159ee8200c61e53324dc8ad93972043c230cf079))
* **models:** harden model discovery and selection ([bc01d84](https://github.com/chadbyte/clay/commit/bc01d8452645746e4e9822c2ab153fee4b775f09))
* **models:** isolate model state per session and vendor ([db4b062](https://github.com/chadbyte/clay/commit/db4b06221cad1575bf3f77791e0c02a83f0bfadd))
* **sessions:** prefer installed vendors for blank sessions ([a7bbd50](https://github.com/chadbyte/clay/commit/a7bbd50a0552439ff4c4cb4ae690c74967506692))
* **sessions:** publish installed vendors before warmup ([cbda521](https://github.com/chadbyte/clay/commit/cbda521da16a4f312c355119813caf733bf49c24))
* **sessions:** report interrupted worker turns as interrupted ([87dac13](https://github.com/chadbyte/clay/commit/87dac13853529bbbd46c99548befb1663e1fe8ac))
* **sessions:** reset queued-turn state on result-less turn endings ([17bba30](https://github.com/chadbyte/clay/commit/17bba30f53add46c5353ad1443e49b934e2ff931))
* **ui:** clear activity dots when tools take over ([8fb8ffd](https://github.com/chadbyte/clay/commit/8fb8ffdae0ecfbb07df6e3f96e2516a7c7252e52))
* **ui:** match delegation notice border to input focus state ([965f873](https://github.com/chadbyte/clay/commit/965f873c8322b009b37c9194aa5388fcf4c143fa))
* **ui:** open pane web links in new tabs ([77b0bad](https://github.com/chadbyte/clay/commit/77b0bad1b5f9ac52ac7a53e0fcd190df84478436))
* **ui:** show connecting wording and quiet pane connection overlay ([567a8d6](https://github.com/chadbyte/clay/commit/567a8d6a83e26a83f7ef1b1401ae1c545c4e1e33))
* **ui:** show split notification banner once ([bc33ad7](https://github.com/chadbyte/clay/commit/bc33ad7cf6771282879d6228b6ee36a95c31fee7))
* **worker:** delegate follow-up implementation ([d00c2e7](https://github.com/chadbyte/clay/commit/d00c2e73b9428bd4d09e7a879c8ff44be3f2ddbe))
* **yoke:** clarify adapter registration logs ([783d456](https://github.com/chadbyte/clay/commit/783d4568958450f4160663a8b1414259ec294ecb))
* **yoke:** share one 90s initialize timeout across vendors ([2047d30](https://github.com/chadbyte/clay/commit/2047d30cbc6ebce57689064f813552cdb465cda0))


### Features

* add composer shell commands and conflict handling ([#421](https://github.com/chadbyte/clay/issues/421)) ([144e4d8](https://github.com/chadbyte/clay/commit/144e4d80404fb3160460b42c8b502e759890bd17))
* **notes:** add deferred-proposal exception to sticky note guidance ([1cc7a5b](https://github.com/chadbyte/clay/commit/1cc7a5bc5ce63fb01fdb5a23220474016d7645ee))
* **notes:** track deferred defects proactively ([#423](https://github.com/chadbyte/clay/issues/423)) ([8c17a82](https://github.com/chadbyte/clay/commit/8c17a82b94cdc697675d3f004d62072a57ace554))
* **sessions:** add configurable session handoffs ([6c0bb98](https://github.com/chadbyte/clay/commit/6c0bb98f569e3fb02e9f74a3722d71444a34ef4d))
* **sessions:** auto-approve worker proposals when skip permissions is on ([bb151a4](https://github.com/chadbyte/clay/commit/bb151a4f6644bb1c2894c5dcd05e2951cfd00d4f))
* **sessions:** show active background tasks with stop controls ([4e2cca5](https://github.com/chadbyte/clay/commit/4e2cca510a74ae70a3e5346da5d34df015796c00))
* **shell:** add composer command execution ([10806b2](https://github.com/chadbyte/clay/commit/10806b2ae8ab9261e93c95c129ee3a7a0c34fde8))
* **ui:** dock document viewer leftmost with a global tab bar ([20f7659](https://github.com/chadbyte/clay/commit/20f7659d16f5405eafc49b37e90d17f83995876b)), closes [#file-viewer](https://github.com/chadbyte/clay/issues/file-viewer) [#main-panels](https://github.com/chadbyte/clay/issues/main-panels)
* **ui:** reorganize session header controls ([478b31a](https://github.com/chadbyte/clay/commit/478b31aacad2fcd0fab756dac8d036ce7fa9c5a2))
* **vendors:** add experimental agent integrations ([80348c4](https://github.com/chadbyte/clay/commit/80348c4ed2f4962d50bdf696cc3bbfcce4c40845))
* **worktrees:** allow access outside project folder ([2c1a23e](https://github.com/chadbyte/clay/commit/2c1a23e3f6082ff319d47112303df28d25b3f8e4))
* **yoke:** add Gemini and OpenCode ACP adapters ([27261fb](https://github.com/chadbyte/clay/commit/27261fbded8bc59029076eb14589103d28caefb1))
* **yoke:** emit background_tasks_changed from codex background terminals ([7903132](https://github.com/chadbyte/clay/commit/790313229e046134006fef8161ebaeaab8c3cacc))
* **yoke:** replace Gemini CLI with Antigravity ([0f15c35](https://github.com/chadbyte/clay/commit/0f15c35cdbc1d688493950813e83459eabd1e2d8))
* **yoke:** replace Gemini CLI with Antigravity ([#422](https://github.com/chadbyte/clay/issues/422)) ([d80fc92](https://github.com/chadbyte/clay/commit/d80fc92d99e9609f05d4e7a4955215d923651293))

# [3.4.0-beta.26](https://github.com/chadbyte/clay/compare/v3.4.0-beta.25...v3.4.0-beta.26) (2026-08-26)


### Bug Fixes

* **yoke:** share one 90s initialize timeout across vendors ([2047d30](https://github.com/chadbyte/clay/commit/2047d30cbc6ebce57689064f813552cdb465cda0))

# [3.4.0-beta.25](https://github.com/chadbyte/clay/compare/v3.4.0-beta.24...v3.4.0-beta.25) (2026-08-26)


### Bug Fixes

* **kiro:** widen ACP initialize timeout to 90s ([38f6def](https://github.com/chadbyte/clay/commit/38f6def1ef55831a2913b56d28690ef8df4263b0))

# [3.4.0-beta.24](https://github.com/chadbyte/clay/compare/v3.4.0-beta.23...v3.4.0-beta.24) (2026-08-26)


### Bug Fixes

* **ui:** show connecting wording and quiet pane connection overlay ([567a8d6](https://github.com/chadbyte/clay/commit/567a8d6a83e26a83f7ef1b1401ae1c545c4e1e33))

# [3.4.0-beta.23](https://github.com/chadbyte/clay/compare/v3.4.0-beta.22...v3.4.0-beta.23) (2026-08-26)


### Features

* **ui:** dock document viewer leftmost with a global tab bar ([20f7659](https://github.com/chadbyte/clay/commit/20f7659d16f5405eafc49b37e90d17f83995876b)), closes [#file-viewer](https://github.com/chadbyte/clay/issues/file-viewer) [#main-panels](https://github.com/chadbyte/clay/issues/main-panels)

# [3.4.0-beta.22](https://github.com/chadbyte/clay/compare/v3.4.0-beta.21...v3.4.0-beta.22) (2026-08-26)


### Features

* **yoke:** emit background_tasks_changed from codex background terminals ([7903132](https://github.com/chadbyte/clay/commit/790313229e046134006fef8161ebaeaab8c3cacc))

# [3.4.0-beta.21](https://github.com/chadbyte/clay/compare/v3.4.0-beta.20...v3.4.0-beta.21) (2026-08-26)


### Bug Fixes

* **sessions:** report interrupted worker turns as interrupted ([87dac13](https://github.com/chadbyte/clay/commit/87dac13853529bbbd46c99548befb1663e1fe8ac))

# [3.4.0-beta.20](https://github.com/chadbyte/clay/compare/v3.4.0-beta.19...v3.4.0-beta.20) (2026-08-26)


### Bug Fixes

* **ui:** match delegation notice border to input focus state ([965f873](https://github.com/chadbyte/clay/commit/965f873c8322b009b37c9194aa5388fcf4c143fa))

# [3.4.0-beta.19](https://github.com/chadbyte/clay/compare/v3.4.0-beta.18...v3.4.0-beta.19) (2026-08-26)


### Bug Fixes

* **models:** isolate model state per session and vendor ([db4b062](https://github.com/chadbyte/clay/commit/db4b06221cad1575bf3f77791e0c02a83f0bfadd))

# [3.4.0-beta.18](https://github.com/chadbyte/clay/compare/v3.4.0-beta.17...v3.4.0-beta.18) (2026-08-26)


### Features

* **sessions:** auto-approve worker proposals when skip permissions is on ([bb151a4](https://github.com/chadbyte/clay/commit/bb151a4f6644bb1c2894c5dcd05e2951cfd00d4f))

# [3.4.0-beta.17](https://github.com/chadbyte/clay/compare/v3.4.0-beta.16...v3.4.0-beta.17) (2026-08-26)


### Features

* **notes:** add deferred-proposal exception to sticky note guidance ([1cc7a5b](https://github.com/chadbyte/clay/commit/1cc7a5bc5ce63fb01fdb5a23220474016d7645ee))

# [3.4.0-beta.16](https://github.com/chadbyte/clay/compare/v3.4.0-beta.15...v3.4.0-beta.16) (2026-08-26)


### Bug Fixes

* **sessions:** reset queued-turn state on result-less turn endings ([17bba30](https://github.com/chadbyte/clay/commit/17bba30f53add46c5353ad1443e49b934e2ff931))

# [3.4.0-beta.15](https://github.com/chadbyte/clay/compare/v3.4.0-beta.14...v3.4.0-beta.15) (2026-08-26)


### Features

* **sessions:** show active background tasks with stop controls ([4e2cca5](https://github.com/chadbyte/clay/commit/4e2cca510a74ae70a3e5346da5d34df015796c00))

# [3.4.0-beta.14](https://github.com/chadbyte/clay/compare/v3.4.0-beta.13...v3.4.0-beta.14) (2026-08-26)


### Bug Fixes

* **daemon:** create IPC socket before project registration ([6329f12](https://github.com/chadbyte/clay/commit/6329f12be3edf104d6cb3cd6543a0458b9403731))

# [3.4.0-beta.13](https://github.com/chadbyte/clay/compare/v3.4.0-beta.12...v3.4.0-beta.13) (2026-08-26)


### Features

* **sessions:** add configurable session handoffs ([6c0bb98](https://github.com/chadbyte/clay/commit/6c0bb98f569e3fb02e9f74a3722d71444a34ef4d))

# [3.4.0-beta.12](https://github.com/chadbyte/clay/compare/v3.4.0-beta.11...v3.4.0-beta.12) (2026-08-26)


### Bug Fixes

* **models:** harden model discovery and selection ([bc01d84](https://github.com/chadbyte/clay/commit/bc01d8452645746e4e9822c2ab153fee4b775f09))

# [3.4.0-beta.11](https://github.com/chadbyte/clay/compare/v3.4.0-beta.10...v3.4.0-beta.11) (2026-08-26)


### Bug Fixes

* **yoke:** clarify adapter registration logs ([783d456](https://github.com/chadbyte/clay/commit/783d4568958450f4160663a8b1414259ec294ecb))

# [3.4.0-beta.10](https://github.com/chadbyte/clay/compare/v3.4.0-beta.9...v3.4.0-beta.10) (2026-08-26)


### Features

* **vendors:** add experimental agent integrations ([80348c4](https://github.com/chadbyte/clay/commit/80348c4ed2f4962d50bdf696cc3bbfcce4c40845))

# [3.4.0-beta.9](https://github.com/chadbyte/clay/compare/v3.4.0-beta.8...v3.4.0-beta.9) (2026-08-26)


### Features

* **worktrees:** allow access outside project folder ([2c1a23e](https://github.com/chadbyte/clay/commit/2c1a23e3f6082ff319d47112303df28d25b3f8e4))

# [3.4.0-beta.8](https://github.com/chadbyte/clay/compare/v3.4.0-beta.7...v3.4.0-beta.8) (2026-08-26)


### Bug Fixes

* **ui:** open pane web links in new tabs ([77b0bad](https://github.com/chadbyte/clay/commit/77b0bad1b5f9ac52ac7a53e0fcd190df84478436))
* **ui:** show split notification banner once ([bc33ad7](https://github.com/chadbyte/clay/commit/bc33ad7cf6771282879d6228b6ee36a95c31fee7))


### Features

* **ui:** reorganize session header controls ([478b31a](https://github.com/chadbyte/clay/commit/478b31aacad2fcd0fab756dac8d036ce7fa9c5a2))

# [3.4.0-beta.7](https://github.com/chadbyte/clay/compare/v3.4.0-beta.6...v3.4.0-beta.7) (2026-08-25)


### Bug Fixes

* **sessions:** prefer installed vendors for blank sessions ([a7bbd50](https://github.com/chadbyte/clay/commit/a7bbd50a0552439ff4c4cb4ae690c74967506692))

# [3.4.0-beta.6](https://github.com/chadbyte/clay/compare/v3.4.0-beta.5...v3.4.0-beta.6) (2026-08-25)


### Bug Fixes

* **sessions:** publish installed vendors before warmup ([cbda521](https://github.com/chadbyte/clay/commit/cbda521da16a4f312c355119813caf733bf49c24))

# [3.4.0-beta.5](https://github.com/chadbyte/clay/compare/v3.4.0-beta.4...v3.4.0-beta.5) (2026-08-25)


### Bug Fixes

* **mobile:** correct PWA chat layout ([#420](https://github.com/chadbyte/clay/issues/420)) ([159ee82](https://github.com/chadbyte/clay/commit/159ee8200c61e53324dc8ad93972043c230cf079))

# [3.4.0-beta.4](https://github.com/chadbyte/clay/compare/v3.4.0-beta.3...v3.4.0-beta.4) (2026-08-25)


### Features

* **notes:** track deferred defects proactively ([#423](https://github.com/chadbyte/clay/issues/423)) ([8c17a82](https://github.com/chadbyte/clay/commit/8c17a82b94cdc697675d3f004d62072a57ace554))

# [3.4.0-beta.3](https://github.com/chadbyte/clay/compare/v3.4.0-beta.2...v3.4.0-beta.3) (2026-08-24)


### Features

* **yoke:** replace Gemini CLI with Antigravity ([0f15c35](https://github.com/chadbyte/clay/commit/0f15c35cdbc1d688493950813e83459eabd1e2d8))
* **yoke:** replace Gemini CLI with Antigravity ([#422](https://github.com/chadbyte/clay/issues/422)) ([d80fc92](https://github.com/chadbyte/clay/commit/d80fc92d99e9609f05d4e7a4955215d923651293))

# [3.4.0-beta.2](https://github.com/chadbyte/clay/compare/v3.4.0-beta.1...v3.4.0-beta.2) (2026-08-24)


### Bug Fixes

* **codex:** handle session writer conflicts ([247483b](https://github.com/chadbyte/clay/commit/247483b4a25e64d24ed8cef40ec02f9be2390682))


### Features

* add composer shell commands and conflict handling ([#421](https://github.com/chadbyte/clay/issues/421)) ([144e4d8](https://github.com/chadbyte/clay/commit/144e4d80404fb3160460b42c8b502e759890bd17))
* **shell:** add composer command execution ([10806b2](https://github.com/chadbyte/clay/commit/10806b2ae8ab9261e93c95c129ee3a7a0c34fde8))

# [3.4.0-beta.1](https://github.com/chadbyte/clay/compare/v3.3.2-beta.3...v3.4.0-beta.1) (2026-08-24)


### Bug Fixes

* **files:** make file watching resilient ([cfaa188](https://github.com/chadbyte/clay/commit/cfaa188cf1a1d25f1484758a42996f7d8114155b))


### Features

* **yoke:** add Gemini and OpenCode ACP adapters ([27261fb](https://github.com/chadbyte/clay/commit/27261fbded8bc59029076eb14589103d28caefb1))

## [3.3.2-beta.3](https://github.com/chadbyte/clay/compare/v3.3.2-beta.2...v3.3.2-beta.3) (2026-08-24)


### Bug Fixes

* **debate:** prevent proposal failures from stopping daemon ([05ee090](https://github.com/chadbyte/clay/commit/05ee090b70bfd291a80b1081c77daf94f422bda6))

## [3.3.2-beta.2](https://github.com/chadbyte/clay/compare/v3.3.2-beta.1...v3.3.2-beta.2) (2026-08-24)


### Bug Fixes

* **ui:** clear activity dots when tools take over ([8fb8ffd](https://github.com/chadbyte/clay/commit/8fb8ffdae0ecfbb07df6e3f96e2516a7c7252e52))

## [3.3.2-beta.1](https://github.com/chadbyte/clay/compare/v3.3.1...v3.3.2-beta.1) (2026-08-20)


### Bug Fixes

* **worker:** delegate follow-up implementation ([d00c2e7](https://github.com/chadbyte/clay/commit/d00c2e73b9428bd4d09e7a879c8ff44be3f2ddbe))

## [3.3.1](https://github.com/chadbyte/clay/compare/v3.3.0...v3.3.1) (2026-08-20)


### Bug Fixes

* **release:** align alias package provenance ([e03bb3d](https://github.com/chadbyte/clay/commit/e03bb3d185ef7d92b78d0fee4ce7202f10ee9cf1))

## [3.3.1-beta.1](https://github.com/chadbyte/clay/compare/v3.3.0...v3.3.1-beta.1) (2026-08-20)


### Bug Fixes

* **release:** align alias package provenance ([e03bb3d](https://github.com/chadbyte/clay/commit/e03bb3d185ef7d92b78d0fee4ce7202f10ee9cf1))

# [3.3.0](https://github.com/chadbyte/clay/compare/v3.2.1...v3.3.0) (2026-08-20)


### Bug Fixes

* **markdown:** show actions before preview ([650f18c](https://github.com/chadbyte/clay/commit/650f18c20ef80cc5d811c10c6999e8ac4734b21f))
* **sessions:** keep stop active for queued turns ([fa28379](https://github.com/chadbyte/clay/commit/fa28379b38bff34df66e789ea2ba26bbe642e928))
* **sessions:** prevent stalled message delivery ([b40c21f](https://github.com/chadbyte/clay/commit/b40c21fa7a3ab49518339cc7dc918402ead5e1e8))
* **split:** align pair arrow and deduplicate banners ([f5fdfc2](https://github.com/chadbyte/clay/commit/f5fdfc2ddbb0fe0c3ee6dd6725e9be14bf59c711))
* **split:** align pane chrome with native sessions ([d9a800b](https://github.com/chadbyte/clay/commit/d9a800b49c83cec4052cb898778ae283ee0a00fb))
* **yoke:** resolve default vendor by shared preference order ([490b14e](https://github.com/chadbyte/clay/commit/490b14e6b8fb7f36398c0ef52ee22af478e38b81))


### Features

* **git:** add agent-aware project controls ([6d009bd](https://github.com/chadbyte/clay/commit/6d009bd8b9f83d2fce7572e4192c2c6693cb923e))
* **markdown:** add fullscreen slide presentations ([fa11163](https://github.com/chadbyte/clay/commit/fa11163db7fc200e71a04dfe90898b02a4aea563))
* **pair:** add Fable worker delegation flow ([9bcebf3](https://github.com/chadbyte/clay/commit/9bcebf36624ad9a24a726cf9f799852a188fe058))


### Performance Improvements

* **daemon:** share periodic project sync loop ([263ba33](https://github.com/chadbyte/clay/commit/263ba33a6501c195e14befe72beae4964710b95e))

# [3.3.0-beta.2](https://github.com/chadbyte/clay/compare/v3.3.0-beta.1...v3.3.0-beta.2) (2026-08-20)


### Bug Fixes

* **markdown:** show actions before preview ([650f18c](https://github.com/chadbyte/clay/commit/650f18c20ef80cc5d811c10c6999e8ac4734b21f))
* **sessions:** keep stop active for queued turns ([fa28379](https://github.com/chadbyte/clay/commit/fa28379b38bff34df66e789ea2ba26bbe642e928))
* **sessions:** prevent stalled message delivery ([b40c21f](https://github.com/chadbyte/clay/commit/b40c21fa7a3ab49518339cc7dc918402ead5e1e8))
* **yoke:** resolve default vendor by shared preference order ([490b14e](https://github.com/chadbyte/clay/commit/490b14e6b8fb7f36398c0ef52ee22af478e38b81))


### Features

* **git:** add agent-aware project controls ([6d009bd](https://github.com/chadbyte/clay/commit/6d009bd8b9f83d2fce7572e4192c2c6693cb923e))
* **markdown:** add fullscreen slide presentations ([fa11163](https://github.com/chadbyte/clay/commit/fa11163db7fc200e71a04dfe90898b02a4aea563))

# [3.3.0-beta.1](https://github.com/chadbyte/clay/compare/v3.2.2-beta.3...v3.3.0-beta.1) (2026-08-18)


### Features

* **pair:** add Fable worker delegation flow ([9bcebf3](https://github.com/chadbyte/clay/commit/9bcebf36624ad9a24a726cf9f799852a188fe058))

## [3.2.2-beta.3](https://github.com/chadbyte/clay/compare/v3.2.2-beta.2...v3.2.2-beta.3) (2026-08-18)


### Bug Fixes

* **split:** align pane chrome with native sessions ([d9a800b](https://github.com/chadbyte/clay/commit/d9a800b49c83cec4052cb898778ae283ee0a00fb))

## [3.2.2-beta.2](https://github.com/chadbyte/clay/compare/v3.2.2-beta.1...v3.2.2-beta.2) (2026-08-18)


### Performance Improvements

* **daemon:** share periodic project sync loop ([263ba33](https://github.com/chadbyte/clay/commit/263ba33a6501c195e14befe72beae4964710b95e))

## [3.2.2-beta.1](https://github.com/chadbyte/clay/compare/v3.2.1...v3.2.2-beta.1) (2026-08-18)


### Bug Fixes

* **split:** align pair arrow and deduplicate banners ([f5fdfc2](https://github.com/chadbyte/clay/commit/f5fdfc2ddbb0fe0c3ee6dd6725e9be14bf59c711))

## [3.2.1](https://github.com/chadbyte/clay/compare/v3.2.0...v3.2.1) (2026-08-17)


### Bug Fixes

* **sessions:** recover messages rejected by stale queries ([1e72e0d](https://github.com/chadbyte/clay/commit/1e72e0d645cb4878e8c929a69310d31cec6c074b))

## [3.2.1-beta.1](https://github.com/chadbyte/clay/compare/v3.2.0...v3.2.1-beta.1) (2026-08-17)


### Bug Fixes

* **sessions:** recover messages rejected by stale queries ([1e72e0d](https://github.com/chadbyte/clay/commit/1e72e0d645cb4878e8c929a69310d31cec6c074b))

# [3.2.0](https://github.com/chadbyte/clay/compare/v3.1.0...v3.2.0) (2026-08-17)


### Bug Fixes

* **notes:** make proactive writes conservative ([6a75692](https://github.com/chadbyte/clay/commit/6a7569215abb7e2f0b40070a9b573a21af119280))


### Features

* **markdown:** visualize agent document edits ([d3846af](https://github.com/chadbyte/clay/commit/d3846af2920516b53a1cb1339ef74cef5da0cdc6))

# [3.2.0-beta.1](https://github.com/chadbyte/clay/compare/v3.1.0...v3.2.0-beta.1) (2026-08-17)


### Bug Fixes

* **notes:** make proactive writes conservative ([6a75692](https://github.com/chadbyte/clay/commit/6a7569215abb7e2f0b40070a9b573a21af119280))


### Features

* **markdown:** visualize agent document edits ([d3846af](https://github.com/chadbyte/clay/commit/d3846af2920516b53a1cb1339ef74cef5da0cdc6))

# [3.1.0](https://github.com/chadbyte/clay/compare/v3.0.0...v3.1.0) (2026-08-17)


### Bug Fixes

* **input:** surface the pending permission when a sent message stalls ([0ea2d49](https://github.com/chadbyte/clay/commit/0ea2d49ba11d1ccc41dc6bcc0c2aa47faf0055e1))
* **pair:** stop prompting for partner tool permissions ([6db6a4e](https://github.com/chadbyte/clay/commit/6db6a4e3736aff794e4064d810a1b8972ab30455))
* **ui:** restore sidebar worktree navigation ([d6e562a](https://github.com/chadbyte/clay/commit/d6e562a3d7ad8bf6b88131c36a3c7f0661d0ee2f))


### Features

* **notes:** add cross-session task memory ([d96bade](https://github.com/chadbyte/clay/commit/d96badef6036aab7968780fb23ba90f3646c1f1d))
* **notes:** let sessions use sticky notes as shared long-term memory ([9fda09d](https://github.com/chadbyte/clay/commit/9fda09d6d2b52518526fc5803a720d10e46a0795))
* **pair:** render delegated messages as work-order cards ([0ee7ac2](https://github.com/chadbyte/clay/commit/0ee7ac2ea6ba1d6e0415dc007e8a4ab18f87d322))
* **pair:** show a composer notice in the worker pane during delegation ([545afa3](https://github.com/chadbyte/clay/commit/545afa3d300e9a387fbda3a746fd725c49cd51c0))

# [3.1.0-beta.2](https://github.com/chadbyte/clay/compare/v3.1.0-beta.1...v3.1.0-beta.2) (2026-08-17)


### Features

* **notes:** add cross-session task memory ([d96bade](https://github.com/chadbyte/clay/commit/d96badef6036aab7968780fb23ba90f3646c1f1d))

# [3.1.0-beta.1](https://github.com/chadbyte/clay/compare/v3.0.0...v3.1.0-beta.1) (2026-08-17)


### Bug Fixes

* **input:** surface the pending permission when a sent message stalls ([0ea2d49](https://github.com/chadbyte/clay/commit/0ea2d49ba11d1ccc41dc6bcc0c2aa47faf0055e1))
* **pair:** stop prompting for partner tool permissions ([6db6a4e](https://github.com/chadbyte/clay/commit/6db6a4e3736aff794e4064d810a1b8972ab30455))
* **ui:** restore sidebar worktree navigation ([d6e562a](https://github.com/chadbyte/clay/commit/d6e562a3d7ad8bf6b88131c36a3c7f0661d0ee2f))


### Features

* **notes:** let sessions use sticky notes as shared long-term memory ([9fda09d](https://github.com/chadbyte/clay/commit/9fda09d6d2b52518526fc5803a720d10e46a0795))
* **pair:** render delegated messages as work-order cards ([0ee7ac2](https://github.com/chadbyte/clay/commit/0ee7ac2ea6ba1d6e0415dc007e8a4ab18f87d322))
* **pair:** show a composer notice in the worker pane during delegation ([545afa3](https://github.com/chadbyte/clay/commit/545afa3d300e9a387fbda3a746fd725c49cd51c0))

# [3.0.0](https://github.com/chadbyte/clay/compare/v2.46.0...v3.0.0) (2026-08-16)


* feat(split-view)!: add driver and worker agent pairs ([a726fbc](https://github.com/chadbyte/clay/commit/a726fbcad5150b8622897fc0cfd953a672caed35))


### Bug Fixes

* **codex:** report real context window and per-turn usage ([b3da1c5](https://github.com/chadbyte/clay/commit/b3da1c58c0541b9184750124af604f4172e8c7ec))
* **codex:** route app-server events by thread ([28c47d2](https://github.com/chadbyte/clay/commit/28c47d2348f164c0affb930d6495b083c892bdd8))
* CVE-2025-14874 security vulnerability ([610b693](https://github.com/chadbyte/clay/commit/610b693b641ff337687b08a2f27f0e7204b7386d))
* **notifications:** silence banners for adopted external CLI sessions ([38c53a1](https://github.com/chadbyte/clay/commit/38c53a16d774a153458a41af0f4d8f8557e366ec))
* **pair:** support driver tools across vendors ([051f21b](https://github.com/chadbyte/clay/commit/051f21b307d0ca23b136345c2b7ceb4c6c81235f))
* **sessions:** prevent deleted CLI sessions from returning ([bf35d78](https://github.com/chadbyte/clay/commit/bf35d78bc92874051f8d88cb6f642a0fef2fcd0a))
* **sessions:** stop dropping user messages sent into a query gap ([40d537e](https://github.com/chadbyte/clay/commit/40d537e94b85505221a0266bf95dc4afecb9a949))
* **sessions:** use the shared session mapper for the connect-time list ([60642b1](https://github.com/chadbyte/clay/commit/60642b1fa30e4f8cfc45ac6ebac6cd2e388b9db7))
* **split-view:** anchor split groups to cliSessionIds so they survive restarts ([a63c3c4](https://github.com/chadbyte/clay/commit/a63c3c43b8e5f8d4554575a8eb57f813c8ce44db))
* **split-view:** hide the shell context gauge while a split is open ([76b2b30](https://github.com/chadbyte/clay/commit/76b2b30495bb3e62ee4731091ef368fbdcb4e100))
* **split-view:** replace the U+2AFF glyph with a plain separator and icon ([caaeb3e](https://github.com/chadbyte/clay/commit/caaeb3e9001ee6d0e9d0db83b37866a77facab22))
* **split-view:** stabilize shared sticky note dragging ([8a9ef5d](https://github.com/chadbyte/clay/commit/8a9ef5da17545ac9e4cbc17fc3763a7e824ae957))
* **ui:** bind new sessions to selected vendor ([9511f4c](https://github.com/chadbyte/clay/commit/9511f4c0d51906d04e106668b5c08017a3689551))
* **ui:** remove narrow split pane bottom gap ([5e2c57c](https://github.com/chadbyte/clay/commit/5e2c57c4103a9eaee149a96f36cc613f7757d5cd))
* **yoke:** populate Kiro tool_result content from split ACP updates ([fb1d8b2](https://github.com/chadbyte/clay/commit/fb1d8b243da2686098053f30878952c3bb7a8ac0))
* **yoke:** restore visible thinking streams on claude and codex ([5b04241](https://github.com/chadbyte/clay/commit/5b04241e079b4f6b836a39f8fbfbf55b47b9ff39))
* **yoke:** route Kiro ACP events per session ([9bffa51](https://github.com/chadbyte/clay/commit/9bffa5102cf23871c270a772f67b81d386c1e149))


### Features

* **codex:** add GPT-5.6 sol/terra/luna models ([#384](https://github.com/chadbyte/clay/issues/384)) ([cd56498](https://github.com/chadbyte/clay/commit/cd564984a467926e80e773bc400f3311172bc105))
* **permissions:** add per-session YOLO mode ([a408cf9](https://github.com/chadbyte/clay/commit/a408cf9dbbcd7ad790d3bed22dc9b0d1eee4b264))
* **sessions:** inherit parent context in spawned sessions via fork ([cd18b49](https://github.com/chadbyte/clay/commit/cd18b49c37e0c03bfe7a1a138ec131bb45b26d12))
* **sessions:** let an agent spawn sibling work sessions ([#358](https://github.com/chadbyte/clay/issues/358)) ([5fc36eb](https://github.com/chadbyte/clay/commit/5fc36eb2d2f1117428e5abfd1cddf20908f9c5f6))
* **sessions:** make a split a first-class group (Arc-style) ([398f629](https://github.com/chadbyte/clay/commit/398f629d4bae6f742e9cc2f6fe7a7927378d344f))
* **sessions:** persist the per-session model across daemon restarts ([c0552b0](https://github.com/chadbyte/clay/commit/c0552b04f8a0a9a8b3b990a2e34d2468610896be))
* **sessions:** reuse blank sessions and sweep stale ones ([3262d35](https://github.com/chadbyte/clay/commit/3262d35e1c52824bfdad433411e2cdebb272039b))
* **sidebar:** replace vendor buttons with a New session picker ([5a1b34a](https://github.com/chadbyte/clay/commit/5a1b34a4bdc76502bb4fbf820a346f402b71b074))
* **sidebar:** show which vendor each session ran on ([daa8437](https://github.com/chadbyte/clay/commit/daa84373c9f5b084dc324cd0c62d90a3797d9b1a))
* **split-view:** arc-style drop preview and first-class pane headers ([09a195b](https://github.com/chadbyte/clay/commit/09a195ba2a4ed63bf844f89a9d78fd6247c04e09))
* **ui:** present worktrees as branches inside their project ([2bb8915](https://github.com/chadbyte/clay/commit/2bb89153e7600baf464aab7692655a2fa5c3d001))
* **ui:** two-pane split view via chrome-less iframe panes ([4f6d5a4](https://github.com/chadbyte/clay/commit/4f6d5a4dcc57328a20eff0dd711913092c848c1c))
* **yoke:** add Kiro CLI adapter via Agent Client Protocol ([3d00286](https://github.com/chadbyte/clay/commit/3d002866de6ba2dc755232de60296e236df91d9e))
* **yoke:** add static vendor registry and extend capability map ([df18132](https://github.com/chadbyte/clay/commit/df1813253c1172cf7bf6e8b34062d841789b32f8))
* **yoke:** allow mid-session model switching where the vendor supports it ([64bdd36](https://github.com/chadbyte/clay/commit/64bdd36eb8a8c5727533b1daef5149a3ba4d2932))
* **yoke:** complete Kiro v3 adapter support ([bfa082a](https://github.com/chadbyte/clay/commit/bfa082a9e12460646baa942e0abe831da49b86a0))
* **yoke:** share skills across vendors ([4c0275d](https://github.com/chadbyte/clay/commit/4c0275db6edcfbc09640f3adfc5d411aa90b6080))


### BREAKING CHANGES

* establish the split pair workflow and persisted per-session
agent configuration as the new major-version behavior.

# [3.0.0-beta.3](https://github.com/chadbyte/clay/compare/v3.0.0-beta.2...v3.0.0-beta.3) (2026-08-16)


### Bug Fixes

* **pair:** support driver tools across vendors ([051f21b](https://github.com/chadbyte/clay/commit/051f21b307d0ca23b136345c2b7ceb4c6c81235f))

# [3.0.0-beta.2](https://github.com/chadbyte/clay/compare/v3.0.0-beta.1...v3.0.0-beta.2) (2026-08-16)


### Bug Fixes

* CVE-2025-14874 security vulnerability ([610b693](https://github.com/chadbyte/clay/commit/610b693b641ff337687b08a2f27f0e7204b7386d))

# [3.0.0-beta.1](https://github.com/chadbyte/clay/compare/v2.47.0-beta.6...v3.0.0-beta.1) (2026-08-16)


* feat(split-view)!: add driver and worker agent pairs ([a726fbc](https://github.com/chadbyte/clay/commit/a726fbcad5150b8622897fc0cfd953a672caed35))


### Bug Fixes

* **codex:** report real context window and per-turn usage ([b3da1c5](https://github.com/chadbyte/clay/commit/b3da1c58c0541b9184750124af604f4172e8c7ec))
* **codex:** route app-server events by thread ([28c47d2](https://github.com/chadbyte/clay/commit/28c47d2348f164c0affb930d6495b083c892bdd8))
* **notifications:** silence banners for adopted external CLI sessions ([38c53a1](https://github.com/chadbyte/clay/commit/38c53a16d774a153458a41af0f4d8f8557e366ec))
* **sessions:** prevent deleted CLI sessions from returning ([bf35d78](https://github.com/chadbyte/clay/commit/bf35d78bc92874051f8d88cb6f642a0fef2fcd0a))
* **sessions:** stop dropping user messages sent into a query gap ([40d537e](https://github.com/chadbyte/clay/commit/40d537e94b85505221a0266bf95dc4afecb9a949))
* **split-view:** anchor split groups to cliSessionIds so they survive restarts ([a63c3c4](https://github.com/chadbyte/clay/commit/a63c3c43b8e5f8d4554575a8eb57f813c8ce44db))
* **split-view:** hide the shell context gauge while a split is open ([76b2b30](https://github.com/chadbyte/clay/commit/76b2b30495bb3e62ee4731091ef368fbdcb4e100))
* **split-view:** replace the U+2AFF glyph with a plain separator and icon ([caaeb3e](https://github.com/chadbyte/clay/commit/caaeb3e9001ee6d0e9d0db83b37866a77facab22))
* **split-view:** stabilize shared sticky note dragging ([8a9ef5d](https://github.com/chadbyte/clay/commit/8a9ef5da17545ac9e4cbc17fc3763a7e824ae957))
* **ui:** remove narrow split pane bottom gap ([5e2c57c](https://github.com/chadbyte/clay/commit/5e2c57c4103a9eaee149a96f36cc613f7757d5cd))
* **yoke:** restore visible thinking streams on claude and codex ([5b04241](https://github.com/chadbyte/clay/commit/5b04241e079b4f6b836a39f8fbfbf55b47b9ff39))


### Features

* **permissions:** add per-session YOLO mode ([a408cf9](https://github.com/chadbyte/clay/commit/a408cf9dbbcd7ad790d3bed22dc9b0d1eee4b264))
* **sessions:** make a split a first-class group (Arc-style) ([398f629](https://github.com/chadbyte/clay/commit/398f629d4bae6f742e9cc2f6fe7a7927378d344f))
* **sessions:** persist the per-session model across daemon restarts ([c0552b0](https://github.com/chadbyte/clay/commit/c0552b04f8a0a9a8b3b990a2e34d2468610896be))
* **sessions:** reuse blank sessions and sweep stale ones ([3262d35](https://github.com/chadbyte/clay/commit/3262d35e1c52824bfdad433411e2cdebb272039b))
* **split-view:** arc-style drop preview and first-class pane headers ([09a195b](https://github.com/chadbyte/clay/commit/09a195ba2a4ed63bf844f89a9d78fd6247c04e09))
* **ui:** two-pane split view via chrome-less iframe panes ([4f6d5a4](https://github.com/chadbyte/clay/commit/4f6d5a4dcc57328a20eff0dd711913092c848c1c))
* **yoke:** allow mid-session model switching where the vendor supports it ([64bdd36](https://github.com/chadbyte/clay/commit/64bdd36eb8a8c5727533b1daef5149a3ba4d2932))
* **yoke:** share skills across vendors ([4c0275d](https://github.com/chadbyte/clay/commit/4c0275db6edcfbc09640f3adfc5d411aa90b6080))


### BREAKING CHANGES

* establish the split pair workflow and persisted per-session
agent configuration as the new major-version behavior.

# [2.47.0-beta.6](https://github.com/chadbyte/clay/compare/v2.47.0-beta.5...v2.47.0-beta.6) (2026-08-15)


### Features

* **ui:** present worktrees as branches inside their project ([2bb8915](https://github.com/chadbyte/clay/commit/2bb89153e7600baf464aab7692655a2fa5c3d001))

# [2.47.0-beta.5](https://github.com/chadbyte/clay/compare/v2.47.0-beta.4...v2.47.0-beta.5) (2026-08-15)


### Bug Fixes

* **sessions:** use the shared session mapper for the connect-time list ([60642b1](https://github.com/chadbyte/clay/commit/60642b1fa30e4f8cfc45ac6ebac6cd2e388b9db7))


### Features

* **sidebar:** show which vendor each session ran on ([daa8437](https://github.com/chadbyte/clay/commit/daa84373c9f5b084dc324cd0c62d90a3797d9b1a))

# [2.47.0-beta.4](https://github.com/chadbyte/clay/compare/v2.47.0-beta.3...v2.47.0-beta.4) (2026-08-15)


### Features

* **sessions:** inherit parent context in spawned sessions via fork ([cd18b49](https://github.com/chadbyte/clay/commit/cd18b49c37e0c03bfe7a1a138ec131bb45b26d12))
* **sessions:** let an agent spawn sibling work sessions ([#358](https://github.com/chadbyte/clay/issues/358)) ([5fc36eb](https://github.com/chadbyte/clay/commit/5fc36eb2d2f1117428e5abfd1cddf20908f9c5f6))

# [2.47.0-beta.3](https://github.com/chadbyte/clay/compare/v2.47.0-beta.2...v2.47.0-beta.3) (2026-08-15)


### Features

* **yoke:** add static vendor registry and extend capability map ([df18132](https://github.com/chadbyte/clay/commit/df1813253c1172cf7bf6e8b34062d841789b32f8))

# [2.47.0-beta.2](https://github.com/chadbyte/clay/compare/v2.47.0-beta.1...v2.47.0-beta.2) (2026-08-15)


### Bug Fixes

* **ui:** bind new sessions to selected vendor ([9511f4c](https://github.com/chadbyte/clay/commit/9511f4c0d51906d04e106668b5c08017a3689551))
* **yoke:** populate Kiro tool_result content from split ACP updates ([fb1d8b2](https://github.com/chadbyte/clay/commit/fb1d8b243da2686098053f30878952c3bb7a8ac0))
* **yoke:** route Kiro ACP events per session ([9bffa51](https://github.com/chadbyte/clay/commit/9bffa5102cf23871c270a772f67b81d386c1e149))


### Features

* **sidebar:** replace vendor buttons with a New session picker ([5a1b34a](https://github.com/chadbyte/clay/commit/5a1b34a4bdc76502bb4fbf820a346f402b71b074))
* **yoke:** add Kiro CLI adapter via Agent Client Protocol ([3d00286](https://github.com/chadbyte/clay/commit/3d002866de6ba2dc755232de60296e236df91d9e))
* **yoke:** complete Kiro v3 adapter support ([bfa082a](https://github.com/chadbyte/clay/commit/bfa082a9e12460646baa942e0abe831da49b86a0))

# [2.47.0-beta.1](https://github.com/chadbyte/clay/compare/v2.46.0...v2.47.0-beta.1) (2026-07-20)


### Features

* **codex:** add GPT-5.6 sol/terra/luna models ([#384](https://github.com/chadbyte/clay/issues/384)) ([cd56498](https://github.com/chadbyte/clay/commit/cd564984a467926e80e773bc400f3311172bc105))

# [2.46.0](https://github.com/chadbyte/clay/compare/v2.45.0...v2.46.0) (2026-07-03)


### Features

* **deps:** bump claude-agent-sdk to 0.3.198 for Claude Fable 5 support ([#381](https://github.com/chadbyte/clay/issues/381)) ([fc9baab](https://github.com/chadbyte/clay/commit/fc9baab75b8fde8511840921c597ea3de7b6f5ae))

# [2.46.0-beta.1](https://github.com/chadbyte/clay/compare/v2.45.0...v2.46.0-beta.1) (2026-07-02)


### Features

* **deps:** bump claude-agent-sdk to 0.3.198 for Claude Fable 5 support ([#381](https://github.com/chadbyte/clay/issues/381)) ([fc9baab](https://github.com/chadbyte/clay/commit/fc9baab75b8fde8511840921c597ea3de7b6f5ae))

# [2.45.0](https://github.com/chadbyte/clay/compare/v2.44.0...v2.45.0) (2026-07-01)


### Bug Fixes

* **codex:** logged-out detection, login modal, and model listing ([#378](https://github.com/chadbyte/clay/issues/378)) ([a3314b0](https://github.com/chadbyte/clay/commit/a3314b041fada2ccbb6cadede8c37f4997d40922))
* **model-picker:** show model picker for Claude GUI sessions ([#375](https://github.com/chadbyte/clay/issues/375)) ([6b6feb8](https://github.com/chadbyte/clay/commit/6b6feb86ba41cb880ca295055d8b4a2043c37523))
* **os-users:** inherit supplementary groups in spawned sessions ([#371](https://github.com/chadbyte/clay/issues/371)) ([8c5aae0](https://github.com/chadbyte/clay/commit/8c5aae0a0c7eccdedfc862616da3223143cd171a)), closes [#367](https://github.com/chadbyte/clay/issues/367)
* **os-users:** skip per-user Claude CLI install when already available ([#370](https://github.com/chadbyte/clay/issues/370)) ([761f6a5](https://github.com/chadbyte/clay/commit/761f6a5694a2d0ddb7a6eab4c73ba769f3160097)), closes [#368](https://github.com/chadbyte/clay/issues/368)


### Features

* **auth:** auto-open a modal login terminal when not logged in ([#376](https://github.com/chadbyte/clay/issues/376)) ([21136ec](https://github.com/chadbyte/clay/commit/21136ecdab262d16e9dfdfbe02f22ecb62c60ee9))
* **mates:** default Mates off (opt-in) ([#374](https://github.com/chadbyte/clay/issues/374)) ([dc1736f](https://github.com/chadbyte/clay/commit/dc1736f64a3fa9f1a03af3e33895ff75ddbf70ae))
* **whats-new:** add "GUI is back" and stop popping superseded entries ([#379](https://github.com/chadbyte/clay/issues/379)) ([e328b9f](https://github.com/chadbyte/clay/commit/e328b9fbc97f7d94697c1f0d022c0fea39c42126))

# [2.45.0-beta.4](https://github.com/chadbyte/clay/compare/v2.45.0-beta.3...v2.45.0-beta.4) (2026-07-01)


### Bug Fixes

* **codex:** logged-out detection, login modal, and model listing ([#378](https://github.com/chadbyte/clay/issues/378)) ([a3314b0](https://github.com/chadbyte/clay/commit/a3314b041fada2ccbb6cadede8c37f4997d40922))


### Features

* **whats-new:** add "GUI is back" and stop popping superseded entries ([#379](https://github.com/chadbyte/clay/issues/379)) ([e328b9f](https://github.com/chadbyte/clay/commit/e328b9fbc97f7d94697c1f0d022c0fea39c42126))

# [2.45.0-beta.4](https://github.com/chadbyte/clay/compare/v2.45.0-beta.3...v2.45.0-beta.4) (2026-07-01)


### Bug Fixes

* **codex:** logged-out detection, login modal, and model listing ([#378](https://github.com/chadbyte/clay/issues/378)) ([a3314b0](https://github.com/chadbyte/clay/commit/a3314b041fada2ccbb6cadede8c37f4997d40922))


### Features

* **whats-new:** add "GUI is back" and stop popping superseded entries ([#379](https://github.com/chadbyte/clay/issues/379)) ([e328b9f](https://github.com/chadbyte/clay/commit/e328b9fbc97f7d94697c1f0d022c0fea39c42126))

# [2.45.0-beta.4](https://github.com/chadbyte/clay/compare/v2.45.0-beta.3...v2.45.0-beta.4) (2026-07-01)


### Bug Fixes

* **codex:** logged-out detection, login modal, and model listing ([#378](https://github.com/chadbyte/clay/issues/378)) ([a3314b0](https://github.com/chadbyte/clay/commit/a3314b041fada2ccbb6cadede8c37f4997d40922))


### Features

* **whats-new:** add "GUI is back" and stop popping superseded entries ([#379](https://github.com/chadbyte/clay/issues/379)) ([e328b9f](https://github.com/chadbyte/clay/commit/e328b9fbc97f7d94697c1f0d022c0fea39c42126))

# [2.45.0-beta.4](https://github.com/chadbyte/clay/compare/v2.45.0-beta.3...v2.45.0-beta.4) (2026-07-01)


### Bug Fixes

* **codex:** logged-out detection, login modal, and model listing ([#378](https://github.com/chadbyte/clay/issues/378)) ([a3314b0](https://github.com/chadbyte/clay/commit/a3314b041fada2ccbb6cadede8c37f4997d40922))

# [2.45.0-beta.3](https://github.com/chadbyte/clay/compare/v2.45.0-beta.2...v2.45.0-beta.3) (2026-07-01)


### Features

* **auth:** auto-open a modal login terminal when not logged in ([#376](https://github.com/chadbyte/clay/issues/376)) ([21136ec](https://github.com/chadbyte/clay/commit/21136ecdab262d16e9dfdfbe02f22ecb62c60ee9))

# [2.45.0-beta.2](https://github.com/chadbyte/clay/compare/v2.45.0-beta.1...v2.45.0-beta.2) (2026-06-30)


### Bug Fixes

* **model-picker:** show model picker for Claude GUI sessions ([#375](https://github.com/chadbyte/clay/issues/375)) ([6b6feb8](https://github.com/chadbyte/clay/commit/6b6feb86ba41cb880ca295055d8b4a2043c37523))

# [2.45.0-beta.1](https://github.com/chadbyte/clay/compare/v2.44.1-beta.2...v2.45.0-beta.1) (2026-06-30)


### Features

* **mates:** default Mates off (opt-in) ([#374](https://github.com/chadbyte/clay/issues/374)) ([dc1736f](https://github.com/chadbyte/clay/commit/dc1736f64a3fa9f1a03af3e33895ff75ddbf70ae))

## [2.44.1-beta.2](https://github.com/chadbyte/clay/compare/v2.44.1-beta.1...v2.44.1-beta.2) (2026-06-30)


### Bug Fixes

* **os-users:** inherit supplementary groups in spawned sessions ([#371](https://github.com/chadbyte/clay/issues/371)) ([8c5aae0](https://github.com/chadbyte/clay/commit/8c5aae0a0c7eccdedfc862616da3223143cd171a)), closes [#367](https://github.com/chadbyte/clay/issues/367)

## [2.44.1-beta.1](https://github.com/chadbyte/clay/compare/v2.44.0...v2.44.1-beta.1) (2026-06-30)


### Bug Fixes

* **os-users:** skip per-user Claude CLI install when already available ([#370](https://github.com/chadbyte/clay/issues/370)) ([761f6a5](https://github.com/chadbyte/clay/commit/761f6a5694a2d0ddb7a6eab4c73ba769f3160097)), closes [#368](https://github.com/chadbyte/clay/issues/368)

# [2.44.0](https://github.com/chadbyte/clay/compare/v2.43.0...v2.44.0) (2026-06-18)


### Features

* **sessions:** default Claude sessions to GUI and tidy Chat settings ([#366](https://github.com/chadbyte/clay/issues/366)) ([e25e1b9](https://github.com/chadbyte/clay/commit/e25e1b9f97042cfcb134171b326ac8c900db1f92))

# [2.44.0-beta.1](https://github.com/chadbyte/clay/compare/v2.43.0...v2.44.0-beta.1) (2026-06-18)


### Features

* **sessions:** default Claude sessions to GUI and tidy Chat settings ([#366](https://github.com/chadbyte/clay/issues/366)) ([e25e1b9](https://github.com/chadbyte/clay/commit/e25e1b9f97042cfcb134171b326ac8c900db1f92))

# [2.43.0](https://github.com/chadbyte/clay/compare/v2.42.0...v2.43.0) (2026-06-18)


### Features

* **tls:** fetch *.d.clay.studio cert at runtime instead of baking into npm ([#365](https://github.com/chadbyte/clay/issues/365)) ([8e02d5c](https://github.com/chadbyte/clay/commit/8e02d5c46115350c7407252012b62c7657b304d3))

# [2.43.0-beta.1](https://github.com/chadbyte/clay/compare/v2.42.0...v2.43.0-beta.1) (2026-06-18)


### Features

* **tls:** fetch *.d.clay.studio cert at runtime instead of baking into npm ([#365](https://github.com/chadbyte/clay/issues/365)) ([8e02d5c](https://github.com/chadbyte/clay/commit/8e02d5c46115350c7407252012b62c7657b304d3))

# [2.42.0](https://github.com/chadbyte/clay/compare/v2.41.1...v2.42.0) (2026-06-08)


### Features

* **tui:** add bypass-permissions launch option to Claude session button ([#364](https://github.com/chadbyte/clay/issues/364)) ([25da706](https://github.com/chadbyte/clay/commit/25da706a4a3c343641ad9138f08b5805e9824c42))

# [2.42.0-beta.1](https://github.com/chadbyte/clay/compare/v2.41.1...v2.42.0-beta.1) (2026-06-08)


### Features

* **tui:** add bypass-permissions launch option to Claude session button ([#364](https://github.com/chadbyte/clay/issues/364)) ([25da706](https://github.com/chadbyte/clay/commit/25da706a4a3c343641ad9138f08b5805e9824c42))

## [2.41.1](https://github.com/chadbyte/clay/compare/v2.41.0...v2.41.1) (2026-05-28)


### Bug Fixes

* **tui:** read transcript from session owner's home in OS-isolation mode ([3b79723](https://github.com/chadbyte/clay/commit/3b79723b70a80809db41af2d761c4f0b3c6760d5))

## [2.41.1-beta.1](https://github.com/chadbyte/clay/compare/v2.41.0...v2.41.1-beta.1) (2026-05-28)


### Bug Fixes

* **tui:** read transcript from session owner's home in OS-isolation mode ([3b79723](https://github.com/chadbyte/clay/commit/3b79723b70a80809db41af2d761c4f0b3c6760d5))

# [2.41.0](https://github.com/chadbyte/clay/compare/v2.40.0...v2.41.0) (2026-05-28)


### Bug Fixes

* **tui:** keep a session in its live mode for every viewer ([26893de](https://github.com/chadbyte/clay/commit/26893decf81e35b0b64ee288a1068bb0341f3b05))
* **tui:** tighten grab boundaries against false stops and false matches ([0d3ec5a](https://github.com/chadbyte/clay/commit/0d3ec5ac7328f2b6cd2aeab0b85949a2a8acec5e))


### Features

* **server:** let users create their first project from the app shell ([d8cd2b7](https://github.com/chadbyte/clay/commit/d8cd2b792828f036f09f28785d9ede53b7a38f17))
* **tui:** add D2 Coding font option and bump default size to 14pt ([d3947dd](https://github.com/chadbyte/clay/commit/d3947ddb3908faa290518beb5f9d1d8e45b3e325))
* **tui:** hover-to-grab assistant messages from xterm output ([91fffed](https://github.com/chadbyte/clay/commit/91fffed9201b256c0b60fe198f7d583144734a97))
* **tui:** polish grab overlay with entry animation, auto-hide on scroll ([5a02f3d](https://github.com/chadbyte/clay/commit/5a02f3d28a4626c369e8edbe7e15fe31c5f66c04))
* **tui:** shake icon, blink favicon, and ding on tui_attention ([34fe571](https://github.com/chadbyte/clay/commit/34fe571dacd015d0599ca9590102f877e846cd41))

# [2.41.0-beta.1](https://github.com/chadbyte/clay/compare/v2.40.1-beta.1...v2.41.0-beta.1) (2026-05-28)


### Bug Fixes

* **tui:** tighten grab boundaries against false stops and false matches ([0d3ec5a](https://github.com/chadbyte/clay/commit/0d3ec5ac7328f2b6cd2aeab0b85949a2a8acec5e))


### Features

* **server:** let users create their first project from the app shell ([d8cd2b7](https://github.com/chadbyte/clay/commit/d8cd2b792828f036f09f28785d9ede53b7a38f17))
* **tui:** add D2 Coding font option and bump default size to 14pt ([d3947dd](https://github.com/chadbyte/clay/commit/d3947ddb3908faa290518beb5f9d1d8e45b3e325))
* **tui:** hover-to-grab assistant messages from xterm output ([91fffed](https://github.com/chadbyte/clay/commit/91fffed9201b256c0b60fe198f7d583144734a97))
* **tui:** polish grab overlay with entry animation, auto-hide on scroll ([5a02f3d](https://github.com/chadbyte/clay/commit/5a02f3d28a4626c369e8edbe7e15fe31c5f66c04))
* **tui:** shake icon, blink favicon, and ding on tui_attention ([34fe571](https://github.com/chadbyte/clay/commit/34fe571dacd015d0599ca9590102f877e846cd41))

## [2.40.1-beta.1](https://github.com/chadbyte/clay/compare/v2.40.0...v2.40.1-beta.1) (2026-05-27)


### Bug Fixes

* **tui:** keep a session in its live mode for every viewer ([26893de](https://github.com/chadbyte/clay/commit/26893decf81e35b0b64ee288a1068bb0341f3b05))

# [2.40.0](https://github.com/chadbyte/clay/compare/v2.39.0...v2.40.0) (2026-05-27)


### Bug Fixes

* **claude-hook:** migrate Bash allow-list to space-wildcard form ([a5d52c3](https://github.com/chadbyte/clay/commit/a5d52c3e3e61a32ffd46b9fba28038dbc08a4cc8))
* **codex:** restore model picker, lock it after first message ([d9d8176](https://github.com/chadbyte/clay/commit/d9d8176fa3e0d0a59105c1f7a1815a174ac86c49)), closes [#361](https://github.com/chadbyte/clay/issues/361)
* **mobile:** let new-session row pick Codex vs Claude ([2d71f18](https://github.com/chadbyte/clay/commit/2d71f18254e4e85df36b9b2b9a0a2a869559d762)), closes [#361](https://github.com/chadbyte/clay/issues/361)
* **terminal:** rebuild WebGL glyph atlas on font change and resize ([ebfe3e1](https://github.com/chadbyte/clay/commit/ebfe3e19d6246eaf3a8f90e01416a7c7bc569fb7))
* **tui:** clear screen after fit dimensions change ([deaeb49](https://github.com/chadbyte/clay/commit/deaeb496f456c44ea1dbf2d811228bbc4456d5df))
* **tui:** hydrate terminal font prefs on boot ([43b3416](https://github.com/chadbyte/clay/commit/43b3416d25df64b5dbc7f74e8dccff6808cd074c)), closes [user-settings.js#populateAccount](https://github.com/user-settings.js/issues/populateAccount)
* **vendor:** stop duplicating the active-vendor avatar ([0943097](https://github.com/chadbyte/clay/commit/0943097908effe08bb449cf03902b8b0e2c07229)), closes [#vendor-toggle-wrap](https://github.com/chadbyte/clay/issues/vendor-toggle-wrap)


### Features

* **codex:** add gpt-5.5 model selector and make it default ([505b5fe](https://github.com/chadbyte/clay/commit/505b5feb9208592166fc1d2c70c0f652a3d5c558))
* **tui:** lazy-resume sessions instead of respawning claude on switch ([d56b8f1](https://github.com/chadbyte/clay/commit/d56b8f14a4f917cabe3dd0a0d17fb4c0fa082738))
* **tui:** move terminal font picker to title bar during TUI sessions ([293b9b4](https://github.com/chadbyte/clay/commit/293b9b4760d1697552975f37cffa2acc4ac06861))
* **tui:** reclaim idle session PTYs and add explicit Close ([63ac6ba](https://github.com/chadbyte/clay/commit/63ac6bae4b82242c8e001e6e573f009b5d25b639))
* **tui:** usable mobile input for TUI sessions ([fc0764e](https://github.com/chadbyte/clay/commit/fc0764eb5a715497e7b64978d3cf7975d3edd995))

# [2.40.0-beta.4](https://github.com/chadbyte/clay/compare/v2.40.0-beta.3...v2.40.0-beta.4) (2026-05-27)


### Features

* **tui:** lazy-resume sessions instead of respawning claude on switch ([d56b8f1](https://github.com/chadbyte/clay/commit/d56b8f14a4f917cabe3dd0a0d17fb4c0fa082738))
* **tui:** reclaim idle session PTYs and add explicit Close ([63ac6ba](https://github.com/chadbyte/clay/commit/63ac6bae4b82242c8e001e6e573f009b5d25b639))
* **tui:** usable mobile input for TUI sessions ([fc0764e](https://github.com/chadbyte/clay/commit/fc0764eb5a715497e7b64978d3cf7975d3edd995))

# [2.40.0-beta.3](https://github.com/chadbyte/clay/compare/v2.40.0-beta.2...v2.40.0-beta.3) (2026-05-26)


### Bug Fixes

* **terminal:** rebuild WebGL glyph atlas on font change and resize ([ebfe3e1](https://github.com/chadbyte/clay/commit/ebfe3e19d6246eaf3a8f90e01416a7c7bc569fb7))

# [2.40.0-beta.2](https://github.com/chadbyte/clay/compare/v2.40.0-beta.1...v2.40.0-beta.2) (2026-05-26)


### Bug Fixes

* **claude-hook:** migrate Bash allow-list to space-wildcard form ([a5d52c3](https://github.com/chadbyte/clay/commit/a5d52c3e3e61a32ffd46b9fba28038dbc08a4cc8))
* **codex:** restore model picker, lock it after first message ([d9d8176](https://github.com/chadbyte/clay/commit/d9d8176fa3e0d0a59105c1f7a1815a174ac86c49)), closes [#361](https://github.com/chadbyte/clay/issues/361)
* **mobile:** let new-session row pick Codex vs Claude ([2d71f18](https://github.com/chadbyte/clay/commit/2d71f18254e4e85df36b9b2b9a0a2a869559d762)), closes [#361](https://github.com/chadbyte/clay/issues/361)
* **tui:** clear screen after fit dimensions change ([deaeb49](https://github.com/chadbyte/clay/commit/deaeb496f456c44ea1dbf2d811228bbc4456d5df))
* **tui:** hydrate terminal font prefs on boot ([43b3416](https://github.com/chadbyte/clay/commit/43b3416d25df64b5dbc7f74e8dccff6808cd074c)), closes [user-settings.js#populateAccount](https://github.com/user-settings.js/issues/populateAccount)
* **vendor:** stop duplicating the active-vendor avatar ([0943097](https://github.com/chadbyte/clay/commit/0943097908effe08bb449cf03902b8b0e2c07229)), closes [#vendor-toggle-wrap](https://github.com/chadbyte/clay/issues/vendor-toggle-wrap)

# [2.40.0-beta.1](https://github.com/chadbyte/clay/compare/v2.39.0...v2.40.0-beta.1) (2026-05-26)


### Features

* **codex:** add gpt-5.5 model selector and make it default ([505b5fe](https://github.com/chadbyte/clay/commit/505b5feb9208592166fc1d2c70c0f652a3d5c558))
* **tui:** move terminal font picker to title bar during TUI sessions ([293b9b4](https://github.com/chadbyte/clay/commit/293b9b4760d1697552975f37cffa2acc4ac06861))

# [2.39.0](https://github.com/chadbyte/clay/compare/v2.38.0...v2.39.0) (2026-05-25)


### Bug Fixes

* **sdk-bridge:** preserve MCP-mode AskUserQuestion entries across turn boundaries ([b506369](https://github.com/chadbyte/clay/commit/b506369949a6b27ac7944a0e3b736993db4578d7))


### Features

* prepare 2026-06-15 cutover with What's New system ([f02c85b](https://github.com/chadbyte/clay/commit/f02c85b1184be30d901ef34d9e33e99b9d200e1a))
* **sessions:** embed claude TUI as a session mode with cross-mode resume ([6812ef6](https://github.com/chadbyte/clay/commit/6812ef69de25c39f58ab77fa886579c1522241b6)), closes [#messages](https://github.com/chadbyte/clay/issues/messages) [#input-area](https://github.com/chadbyte/clay/issues/input-area) [#new-msg-btn](https://github.com/chadbyte/clay/issues/new-msg-btn)
* **settings:** theme picker, terminal font, IME-safe renderer ([04ca4fe](https://github.com/chadbyte/clay/commit/04ca4fe4c0707cddebc71e0540a851aad0ca886c)), closes [#us-theme-switcher](https://github.com/chadbyte/clay/issues/us-theme-switcher)
* **theme:** move theme picker to user island palette button ([583c43e](https://github.com/chadbyte/clay/commit/583c43e9432afa7fec9bd3fe008a9f4a781e3c54))
* **tui:** notification pipeline, auto-approve allow-list, inline modal, jsonl watcher ([a012413](https://github.com/chadbyte/clay/commit/a0124133f12f39d950e3c6a95fc07b25ea84e7c5))
* **tui:** policy explainer modal, Go-to-session secondary CTA, restart persistence ([584beac](https://github.com/chadbyte/clay/commit/584beac4a99a0ada55005290942c8dc626fc0e50))
* unify CLI sessions with Clay list and clean SDK warmup ([7e4ebdd](https://github.com/chadbyte/clay/commit/7e4ebdd3b966f2e9011ef04265d0885cd132eeb4))

# [2.39.0-beta.5](https://github.com/chadbyte/clay/compare/v2.39.0-beta.4...v2.39.0-beta.5) (2026-05-25)


### Features

* **settings:** theme picker, terminal font, IME-safe renderer ([04ca4fe](https://github.com/chadbyte/clay/commit/04ca4fe4c0707cddebc71e0540a851aad0ca886c)), closes [#us-theme-switcher](https://github.com/chadbyte/clay/issues/us-theme-switcher)
* **theme:** move theme picker to user island palette button ([583c43e](https://github.com/chadbyte/clay/commit/583c43e9432afa7fec9bd3fe008a9f4a781e3c54))

# [2.39.0-beta.4](https://github.com/chadbyte/clay/compare/v2.39.0-beta.3...v2.39.0-beta.4) (2026-05-25)


### Features

* unify CLI sessions with Clay list and clean SDK warmup ([7e4ebdd](https://github.com/chadbyte/clay/commit/7e4ebdd3b966f2e9011ef04265d0885cd132eeb4))

# [2.39.0-beta.3](https://github.com/chadbyte/clay/compare/v2.39.0-beta.2...v2.39.0-beta.3) (2026-05-25)


### Features

* prepare 2026-06-15 cutover with What's New system ([f02c85b](https://github.com/chadbyte/clay/commit/f02c85b1184be30d901ef34d9e33e99b9d200e1a))

# [2.39.0-beta.2](https://github.com/chadbyte/clay/compare/v2.39.0-beta.1...v2.39.0-beta.2) (2026-05-21)


### Features

* **tui:** notification pipeline, auto-approve allow-list, inline modal, jsonl watcher ([a012413](https://github.com/chadbyte/clay/commit/a0124133f12f39d950e3c6a95fc07b25ea84e7c5))
* **tui:** policy explainer modal, Go-to-session secondary CTA, restart persistence ([584beac](https://github.com/chadbyte/clay/commit/584beac4a99a0ada55005290942c8dc626fc0e50))

# [2.39.0-beta.1](https://github.com/chadbyte/clay/compare/v2.38.0...v2.39.0-beta.1) (2026-05-19)


### Bug Fixes

* **sdk-bridge:** preserve MCP-mode AskUserQuestion entries across turn boundaries ([b506369](https://github.com/chadbyte/clay/commit/b506369949a6b27ac7944a0e3b736993db4578d7))


### Features

* **sessions:** embed claude TUI as a session mode with cross-mode resume ([6812ef6](https://github.com/chadbyte/clay/commit/6812ef69de25c39f58ab77fa886579c1522241b6)), closes [#messages](https://github.com/chadbyte/clay/issues/messages) [#input-area](https://github.com/chadbyte/clay/issues/input-area) [#new-msg-btn](https://github.com/chadbyte/clay/issues/new-msg-btn)

# [2.38.0](https://github.com/chadbyte/clay/compare/v2.37.0...v2.38.0) (2026-05-16)


### Bug Fixes

* **ask-user:** keep question text with the answer so the model recognizes it ([e6fd603](https://github.com/chadbyte/clay/commit/e6fd6035440ef2e76849bb8248eaaf787034a671))
* **clay:** forward home_clay_* messages to the server-level handler ([a5f789a](https://github.com/chadbyte/clay/commit/a5f789ac9a569c8777506cdad835e56840b4c9c4))
* **clay:** use Clay app icon for Clay avatar instead of Ally asset ([48a4337](https://github.com/chadbyte/clay/commit/48a4337f60e5bf16d39ed8887e73065fdd1bc68a))


### Features

* **clay:** introduce Clay host agent and split Home into Clay chat + widgets ([d6081ae](https://github.com/chadbyte/clay/commit/d6081ae504a4a6cb60f075d56a9205a79ba95ebb))
* **clay:** smaller FAB-popover and draggable FAB position ([fda4a0f](https://github.com/chadbyte/clay/commit/fda4a0f225b482b10f7b01594143b5a66c98e1e5))
* **clay:** standalone phablet-style home chat panel and hide Clay from sidebar ([b99dd18](https://github.com/chadbyte/clay/commit/b99dd181f96e830f99859c3855a2cb05dedac80e)), closes [#home-hub](https://github.com/chadbyte/clay/issues/home-hub)
* **clay:** turn home chat into a persistent FAB-popover ([a55b246](https://github.com/chadbyte/clay/commit/a55b246e342f2f4b12d304d79d77e73a901c43d4)), closes [#clay-fab](https://github.com/chadbyte/clay/issues/clay-fab) [#clay-popover](https://github.com/chadbyte/clay/issues/clay-popover) [#home-hub](https://github.com/chadbyte/clay/issues/home-hub)

# [2.38.0-beta.7](https://github.com/chadbyte/clay/compare/v2.38.0-beta.6...v2.38.0-beta.7) (2026-05-16)


### Bug Fixes

* **ask-user:** keep question text with the answer so the model recognizes it ([e6fd603](https://github.com/chadbyte/clay/commit/e6fd6035440ef2e76849bb8248eaaf787034a671))

# [2.38.0-beta.6](https://github.com/chadbyte/clay/compare/v2.38.0-beta.5...v2.38.0-beta.6) (2026-05-08)


### Bug Fixes

* **clay:** forward home_clay_* messages to the server-level handler ([a5f789a](https://github.com/chadbyte/clay/commit/a5f789ac9a569c8777506cdad835e56840b4c9c4))

# [2.38.0-beta.5](https://github.com/chadbyte/clay/compare/v2.38.0-beta.4...v2.38.0-beta.5) (2026-05-07)


### Features

* **clay:** smaller FAB-popover and draggable FAB position ([fda4a0f](https://github.com/chadbyte/clay/commit/fda4a0f225b482b10f7b01594143b5a66c98e1e5))

# [2.38.0-beta.4](https://github.com/chadbyte/clay/compare/v2.38.0-beta.3...v2.38.0-beta.4) (2026-05-07)


### Features

* **clay:** turn home chat into a persistent FAB-popover ([a55b246](https://github.com/chadbyte/clay/commit/a55b246e342f2f4b12d304d79d77e73a901c43d4)), closes [#clay-fab](https://github.com/chadbyte/clay/issues/clay-fab) [#clay-popover](https://github.com/chadbyte/clay/issues/clay-popover) [#home-hub](https://github.com/chadbyte/clay/issues/home-hub)

# [2.38.0-beta.3](https://github.com/chadbyte/clay/compare/v2.38.0-beta.2...v2.38.0-beta.3) (2026-05-07)


### Features

* **clay:** standalone phablet-style home chat panel and hide Clay from sidebar ([b99dd18](https://github.com/chadbyte/clay/commit/b99dd181f96e830f99859c3855a2cb05dedac80e)), closes [#home-hub](https://github.com/chadbyte/clay/issues/home-hub)

# [2.38.0-beta.2](https://github.com/chadbyte/clay/compare/v2.38.0-beta.1...v2.38.0-beta.2) (2026-05-07)


### Bug Fixes

* **clay:** use Clay app icon for Clay avatar instead of Ally asset ([48a4337](https://github.com/chadbyte/clay/commit/48a4337f60e5bf16d39ed8887e73065fdd1bc68a))

# [2.38.0-beta.1](https://github.com/chadbyte/clay/compare/v2.37.0...v2.38.0-beta.1) (2026-05-07)


### Features

* **clay:** introduce Clay host agent and split Home into Clay chat + widgets ([d6081ae](https://github.com/chadbyte/clay/commit/d6081ae504a4a6cb60f075d56a9205a79ba95ebb))

# [2.37.0](https://github.com/chadbyte/clay/compare/v2.36.1...v2.37.0) (2026-05-07)


### Bug Fixes

* **context:** show correct model name and 1M window for [1m] beta models ([f145c9f](https://github.com/chadbyte/clay/commit/f145c9f7b2af97f5567232ebc588357b0fe763e2))
* **model:** resolve shorthand model names against vendor model list ([d8d11c6](https://github.com/chadbyte/clay/commit/d8d11c6ff229dad1fa806f1c90ae290cd4c8d721))
* **pin:** allow forced PIN change without re-entering temp PIN, add logout ([fb04677](https://github.com/chadbyte/clay/commit/fb04677024df95349c61cf117dff3abd96f4b516))
* **pin:** mirror login PIN UI on temp PIN setup overlay ([c2af16d](https://github.com/chadbyte/clay/commit/c2af16da37f46144beabae5d44dffbbd662184af))
* **pin:** show focus indicator and reliable digit capture on temp PIN setup ([77e6b88](https://github.com/chadbyte/clay/commit/77e6b88dfd07b85785a2edcd2b74792bac53bfeb))
* **pin:** unify forced-PIN-change UI through main app overlay ([a5f37dc](https://github.com/chadbyte/clay/commit/a5f37dcd326c05c5be045b8260fb19f550925b85))
* **rewind:** expose rewindFiles on worker QueryHandle ([a684fa8](https://github.com/chadbyte/clay/commit/a684fa8bfa32cf02897727741b40ce1be3033ddb))
* **scroll:** respect user scroll-up during streaming response ([c440820](https://github.com/chadbyte/clay/commit/c440820b92bbd7709228b1aac0881f0a63a73a80))
* **ui:** clear pre-thinking dots on more turn events and add 90s safety timeout ([5d91bc2](https://github.com/chadbyte/clay/commit/5d91bc2ec43c823c1844323870c7175049212abc))
* **ui:** show vendor avatar next to inline activity dots ([c8f2de6](https://github.com/chadbyte/clay/commit/c8f2de6ba5383fc47d6ea84bc244c6d000d727c8))


### Features

* **sdk:** bump claude-agent-sdk to 0.2.132 and set Options.title at creation ([f46b06d](https://github.com/chadbyte/clay/commit/f46b06dc73d13f2cfc846bf5788d2ae896582e66)), closes [#45](https://github.com/chadbyte/clay/issues/45)


### Performance Improvements

* **resume:** batch syntax highlight, compact dead-session todos, lower initial page ([182c6ca](https://github.com/chadbyte/clay/commit/182c6cacae1d7fd73fae6734f8e3fd1f09038c2a)), closes [#342](https://github.com/chadbyte/clay/issues/342) [#345](https://github.com/chadbyte/clay/issues/345)

# [2.37.0-beta.2](https://github.com/chadbyte/clay/compare/v2.37.0-beta.1...v2.37.0-beta.2) (2026-05-07)


### Bug Fixes

* **scroll:** respect user scroll-up during streaming response ([c440820](https://github.com/chadbyte/clay/commit/c440820b92bbd7709228b1aac0881f0a63a73a80))

# [2.37.0-beta.1](https://github.com/chadbyte/clay/compare/v2.36.2-beta.9...v2.37.0-beta.1) (2026-05-07)


### Features

* **sdk:** bump claude-agent-sdk to 0.2.132 and set Options.title at creation ([f46b06d](https://github.com/chadbyte/clay/commit/f46b06dc73d13f2cfc846bf5788d2ae896582e66)), closes [#45](https://github.com/chadbyte/clay/issues/45)

## [2.36.2-beta.9](https://github.com/chadbyte/clay/compare/v2.36.2-beta.8...v2.36.2-beta.9) (2026-05-07)


### Bug Fixes

* **ui:** show vendor avatar next to inline activity dots ([c8f2de6](https://github.com/chadbyte/clay/commit/c8f2de6ba5383fc47d6ea84bc244c6d000d727c8))

## [2.36.2-beta.8](https://github.com/chadbyte/clay/compare/v2.36.2-beta.7...v2.36.2-beta.8) (2026-05-07)


### Bug Fixes

* **ui:** clear pre-thinking dots on more turn events and add 90s safety timeout ([5d91bc2](https://github.com/chadbyte/clay/commit/5d91bc2ec43c823c1844323870c7175049212abc))

## [2.36.2-beta.7](https://github.com/chadbyte/clay/compare/v2.36.2-beta.6...v2.36.2-beta.7) (2026-05-05)


### Bug Fixes

* **rewind:** expose rewindFiles on worker QueryHandle ([a684fa8](https://github.com/chadbyte/clay/commit/a684fa8bfa32cf02897727741b40ce1be3033ddb))

## [2.36.2-beta.6](https://github.com/chadbyte/clay/compare/v2.36.2-beta.5...v2.36.2-beta.6) (2026-05-05)


### Bug Fixes

* **pin:** unify forced-PIN-change UI through main app overlay ([a5f37dc](https://github.com/chadbyte/clay/commit/a5f37dcd326c05c5be045b8260fb19f550925b85))

## [2.36.2-beta.5](https://github.com/chadbyte/clay/compare/v2.36.2-beta.4...v2.36.2-beta.5) (2026-05-05)


### Bug Fixes

* **pin:** allow forced PIN change without re-entering temp PIN, add logout ([fb04677](https://github.com/chadbyte/clay/commit/fb04677024df95349c61cf117dff3abd96f4b516))

## [2.36.2-beta.4](https://github.com/chadbyte/clay/compare/v2.36.2-beta.3...v2.36.2-beta.4) (2026-05-05)


### Bug Fixes

* **pin:** mirror login PIN UI on temp PIN setup overlay ([c2af16d](https://github.com/chadbyte/clay/commit/c2af16da37f46144beabae5d44dffbbd662184af))

## [2.36.2-beta.3](https://github.com/chadbyte/clay/compare/v2.36.2-beta.2...v2.36.2-beta.3) (2026-05-05)


### Bug Fixes

* **pin:** show focus indicator and reliable digit capture on temp PIN setup ([77e6b88](https://github.com/chadbyte/clay/commit/77e6b88dfd07b85785a2edcd2b74792bac53bfeb))

## [2.36.2-beta.2](https://github.com/chadbyte/clay/compare/v2.36.2-beta.1...v2.36.2-beta.2) (2026-05-03)


### Bug Fixes

* **context:** show correct model name and 1M window for [1m] beta models ([f145c9f](https://github.com/chadbyte/clay/commit/f145c9f7b2af97f5567232ebc588357b0fe763e2))
* **model:** resolve shorthand model names against vendor model list ([d8d11c6](https://github.com/chadbyte/clay/commit/d8d11c6ff229dad1fa806f1c90ae290cd4c8d721))

## [2.36.2-beta.1](https://github.com/chadbyte/clay/compare/v2.36.1...v2.36.2-beta.1) (2026-05-03)


### Performance Improvements

* **resume:** batch syntax highlight, compact dead-session todos, lower initial page ([182c6ca](https://github.com/chadbyte/clay/commit/182c6cacae1d7fd73fae6734f8e3fd1f09038c2a)), closes [#342](https://github.com/chadbyte/clay/issues/342) [#345](https://github.com/chadbyte/clay/issues/345)

## [2.36.1](https://github.com/chadbyte/clay/compare/v2.36.0...v2.36.1) (2026-05-03)


### Bug Fixes

* **app-messages:** drop stray agent-picker import and case blocks ([edea532](https://github.com/chadbyte/clay/commit/edea532324cd237c47ccc371befc05ba1201e264)), closes [chadbyte/clay#342](https://github.com/chadbyte/clay/issues/342)
* **email:** allow full email entry for all providers ([0adf66a](https://github.com/chadbyte/clay/commit/0adf66a01610f18c147baee99708828b9e58b9c2))
* **input:** gate stop branch on live processing state; never send ghost suggestion on stop click ([6722ef5](https://github.com/chadbyte/clay/commit/6722ef5d0c1c9e2a0218526e36743bcf2c754d34)), closes [#337](https://github.com/chadbyte/clay/issues/337)
* preserve model selection on browser refresh ([5313879](https://github.com/chadbyte/clay/commit/5313879e9e74c4e346a7629d60c400697ed9d8b4))
* **scroll:** pin viewport to bottom on resume so deferred layout can't strand user mid-conversation ([34ffc1a](https://github.com/chadbyte/clay/commit/34ffc1a07f9dc602b387bd23bcd3bc80cda11575)), closes [#messages](https://github.com/chadbyte/clay/issues/messages)
* **sdk:** use session vendor adapter for auto title generation ([d476ef1](https://github.com/chadbyte/clay/commit/d476ef1e0004b27648921c0764b99de9c01a4575)), closes [#344](https://github.com/chadbyte/clay/issues/344)

## [2.36.1-beta.5](https://github.com/chadbyte/clay/compare/v2.36.1-beta.4...v2.36.1-beta.5) (2026-05-03)


### Bug Fixes

* **email:** allow full email entry for all providers ([0adf66a](https://github.com/chadbyte/clay/commit/0adf66a01610f18c147baee99708828b9e58b9c2))

## [2.36.1-beta.4](https://github.com/chadbyte/clay/compare/v2.36.1-beta.3...v2.36.1-beta.4) (2026-05-03)


### Bug Fixes

* **sdk:** use session vendor adapter for auto title generation ([d476ef1](https://github.com/chadbyte/clay/commit/d476ef1e0004b27648921c0764b99de9c01a4575)), closes [#344](https://github.com/chadbyte/clay/issues/344)

## [2.36.1-beta.3](https://github.com/chadbyte/clay/compare/v2.36.1-beta.2...v2.36.1-beta.3) (2026-04-29)


### Bug Fixes

* **input:** gate stop branch on live processing state; never send ghost suggestion on stop click ([6722ef5](https://github.com/chadbyte/clay/commit/6722ef5d0c1c9e2a0218526e36743bcf2c754d34)), closes [#337](https://github.com/chadbyte/clay/issues/337)

## [2.36.1-beta.2](https://github.com/chadbyte/clay/compare/v2.36.1-beta.1...v2.36.1-beta.2) (2026-04-29)


### Bug Fixes

* preserve model selection on browser refresh ([5313879](https://github.com/chadbyte/clay/commit/5313879e9e74c4e346a7629d60c400697ed9d8b4))

## [2.36.1-beta.1](https://github.com/chadbyte/clay/compare/v2.36.0...v2.36.1-beta.1) (2026-04-29)


### Bug Fixes

* **app-messages:** drop stray agent-picker import and case blocks ([edea532](https://github.com/chadbyte/clay/commit/edea532324cd237c47ccc371befc05ba1201e264)), closes [chadbyte/clay#342](https://github.com/chadbyte/clay/issues/342)
* **scroll:** pin viewport to bottom on resume so deferred layout can't strand user mid-conversation ([34ffc1a](https://github.com/chadbyte/clay/commit/34ffc1a07f9dc602b387bd23bcd3bc80cda11575)), closes [#messages](https://github.com/chadbyte/clay/issues/messages)

# [2.36.0](https://github.com/chadbyte/clay/compare/v2.35.1...v2.36.0) (2026-04-27)


### Bug Fixes

* **yoke:** resolve per-user Claude binary in worker for OS-level multi-user mode ([df35864](https://github.com/chadbyte/clay/commit/df35864ad99a5d43babc6978dd08104f51bbccfb))


### Features

* **mention:** add plain Claude/Codex mentions and fix mobile chip flow ([d68c693](https://github.com/chadbyte/clay/commit/d68c693d72cf7098032a1de961a7330d8921b2eb))
* **mention:** support user-to-user [@mentions](https://github.com/mentions) with notifications and push ([618e508](https://github.com/chadbyte/clay/commit/618e508866973b4bb59885abd370c6b74b9d74e2))

# [2.36.0-beta.2](https://github.com/chadbyte/clay/compare/v2.36.0-beta.1...v2.36.0-beta.2) (2026-04-27)


### Bug Fixes

* **yoke:** resolve per-user Claude binary in worker for OS-level multi-user mode ([df35864](https://github.com/chadbyte/clay/commit/df35864ad99a5d43babc6978dd08104f51bbccfb))

# [2.36.0-beta.1](https://github.com/chadbyte/clay/compare/v2.35.1...v2.36.0-beta.1) (2026-04-26)


### Features

* **mention:** add plain Claude/Codex mentions and fix mobile chip flow ([d68c693](https://github.com/chadbyte/clay/commit/d68c693d72cf7098032a1de961a7330d8921b2eb))
* **mention:** support user-to-user [@mentions](https://github.com/mentions) with notifications and push ([618e508](https://github.com/chadbyte/clay/commit/618e508866973b4bb59885abd370c6b74b9d74e2))

## [2.35.1](https://github.com/chadbyte/clay/compare/v2.35.0...v2.35.1) (2026-04-25)


### Bug Fixes

* **mates:** widen mention context to 32KB byte budget instead of per-turn 500-char truncation ([78fb881](https://github.com/chadbyte/clay/commit/78fb8819edcb1cfcee3a9fbbe6f032a3e81f323c))

## [2.35.1-beta.1](https://github.com/chadbyte/clay/compare/v2.35.0...v2.35.1-beta.1) (2026-04-25)


### Bug Fixes

* **mates:** widen mention context to 32KB byte budget instead of per-turn 500-char truncation ([78fb881](https://github.com/chadbyte/clay/commit/78fb8819edcb1cfcee3a9fbbe6f032a3e81f323c))

# [2.35.0](https://github.com/chadbyte/clay/compare/v2.34.0...v2.35.0) (2026-04-25)


### Bug Fixes

* **input:** prevent ghost-text suggestion from swallowing pasted content on Enter ([a657a09](https://github.com/chadbyte/clay/commit/a657a091a0d6557f94651e4a0c4e5797a6ac3ce9))
* **mates:** expose set/getMatesEnabled through users module ([4dc55ed](https://github.com/chadbyte/clay/commit/4dc55ed507c63d7fed94d6d6675ea1304e12f30f))
* **mates:** hide Ask Mate button in chat input when Mates is disabled ([d2ff010](https://github.com/chadbyte/clay/commit/d2ff0102c2ce0a1e2915d22de0d2473971efb88a)), closes [#ask-mate-btn](https://github.com/chadbyte/clay/issues/ask-mate-btn)
* **mates:** persist deletedBuiltinKeys in single-user mode ([3986088](https://github.com/chadbyte/clay/commit/3986088f4bf79181095799e39d59253e09726e86))
* **mates:** preserve other-user UI when Mates is disabled in multi-user ([fd31753](https://github.com/chadbyte/clay/commit/fd31753dc5a73d09dd7a0e8550bbb38c163ede1e)), closes [#icon-strip-mate-section](https://github.com/chadbyte/clay/issues/icon-strip-mate-section)
* **mates:** show CTA icon and reframe promo around long-term memory ([2aaa340](https://github.com/chadbyte/clay/commit/2aaa3407fc6f60e4ba9e4c2ee585928c785435b4))
* **mates:** stop skill-install modal from firing on every reconnect ([183e50e](https://github.com/chadbyte/clay/commit/183e50e8386607ceb380b73e03b7de551414ac7f)), closes [#1](https://github.com/chadbyte/clay/issues/1)
* **mates:** suppress @-mention dropdown when Mates is disabled ([83b4c95](https://github.com/chadbyte/clay/commit/83b4c9564435cbd76d35e6a828566e95fcdc3efd))
* **messages:** stop vendor flapping under high-latency connections ([d15afbe](https://github.com/chadbyte/clay/commit/d15afbea8d37ce51b25b57a54e2459034d9a1c55)), closes [hi#latency](https://github.com/hi/issues/latency)
* normalize model ids across session switching ([dae5344](https://github.com/chadbyte/clay/commit/dae5344ed34fbfbb3d0553a9dfa06f4014006872))
* preserve session vendor on reconnect ([5b061ae](https://github.com/chadbyte/clay/commit/5b061ae16c6b06fca3db5ecd18c047fd38f508b6))
* **settings:** persist single-user preference writes ([7fb2dd5](https://github.com/chadbyte/clay/commit/7fb2dd54d520eb4dcb8bcb7b4d89b2aceeb3e360))
* **sidebar:** render worktree icon when set ([43292ab](https://github.com/chadbyte/clay/commit/43292ab6f63598a0c30ce9479ddc798809dd1517))
* **skills:** make outdated-skill prompt skippable instead of silently ignored ([b612a91](https://github.com/chadbyte/clay/commit/b612a915592f00f356935560e5418d239c45985a))


### Features

* **mates:** add Open User Settings button to disabled-Mates picker ([20585ad](https://github.com/chadbyte/clay/commit/20585ad4c30b42f78d345884ba81d14db4f1553f))
* **mates:** redesign disabled-picker as discovery promo with marquee ([528cbf8](https://github.com/chadbyte/clay/commit/528cbf8ca7bccb3617f3c636f5c9a6f228a48504))
* **settings:** add per-user Mates UI toggle in User Settings ([d766e10](https://github.com/chadbyte/clay/commit/d766e10d4bbe86ea9f272ca0f83facc609cf9fda)), closes [#341](https://github.com/chadbyte/clay/issues/341) [#325](https://github.com/chadbyte/clay/issues/325)

# [2.35.0-beta.2](https://github.com/chadbyte/clay/compare/v2.35.0-beta.1...v2.35.0-beta.2) (2026-04-25)


### Bug Fixes

* **settings:** persist single-user preference writes ([7fb2dd5](https://github.com/chadbyte/clay/commit/7fb2dd54d520eb4dcb8bcb7b4d89b2aceeb3e360))

# [2.35.0-beta.1](https://github.com/chadbyte/clay/compare/v2.34.1-beta.4...v2.35.0-beta.1) (2026-04-25)


### Bug Fixes

* **mates:** expose set/getMatesEnabled through users module ([4dc55ed](https://github.com/chadbyte/clay/commit/4dc55ed507c63d7fed94d6d6675ea1304e12f30f))
* **mates:** hide Ask Mate button in chat input when Mates is disabled ([d2ff010](https://github.com/chadbyte/clay/commit/d2ff0102c2ce0a1e2915d22de0d2473971efb88a)), closes [#ask-mate-btn](https://github.com/chadbyte/clay/issues/ask-mate-btn)
* **mates:** preserve other-user UI when Mates is disabled in multi-user ([fd31753](https://github.com/chadbyte/clay/commit/fd31753dc5a73d09dd7a0e8550bbb38c163ede1e)), closes [#icon-strip-mate-section](https://github.com/chadbyte/clay/issues/icon-strip-mate-section)
* **mates:** show CTA icon and reframe promo around long-term memory ([2aaa340](https://github.com/chadbyte/clay/commit/2aaa3407fc6f60e4ba9e4c2ee585928c785435b4))
* **mates:** suppress @-mention dropdown when Mates is disabled ([83b4c95](https://github.com/chadbyte/clay/commit/83b4c9564435cbd76d35e6a828566e95fcdc3efd))


### Features

* **mates:** add Open User Settings button to disabled-Mates picker ([20585ad](https://github.com/chadbyte/clay/commit/20585ad4c30b42f78d345884ba81d14db4f1553f))
* **mates:** redesign disabled-picker as discovery promo with marquee ([528cbf8](https://github.com/chadbyte/clay/commit/528cbf8ca7bccb3617f3c636f5c9a6f228a48504))
* **settings:** add per-user Mates UI toggle in User Settings ([d766e10](https://github.com/chadbyte/clay/commit/d766e10d4bbe86ea9f272ca0f83facc609cf9fda)), closes [#341](https://github.com/chadbyte/clay/issues/341) [#325](https://github.com/chadbyte/clay/issues/325)

## [2.34.1-beta.4](https://github.com/chadbyte/clay/compare/v2.34.1-beta.3...v2.34.1-beta.4) (2026-04-24)


### Bug Fixes

* **messages:** stop vendor flapping under high-latency connections ([d15afbe](https://github.com/chadbyte/clay/commit/d15afbea8d37ce51b25b57a54e2459034d9a1c55)), closes [hi#latency](https://github.com/hi/issues/latency)
* **skills:** make outdated-skill prompt skippable instead of silently ignored ([b612a91](https://github.com/chadbyte/clay/commit/b612a915592f00f356935560e5418d239c45985a))

## [2.34.1-beta.3](https://github.com/chadbyte/clay/compare/v2.34.1-beta.2...v2.34.1-beta.3) (2026-04-24)


### Bug Fixes

* **mates:** stop skill-install modal from firing on every reconnect ([183e50e](https://github.com/chadbyte/clay/commit/183e50e8386607ceb380b73e03b7de551414ac7f)), closes [#1](https://github.com/chadbyte/clay/issues/1)

## [2.34.1-beta.2](https://github.com/chadbyte/clay/compare/v2.34.1-beta.1...v2.34.1-beta.2) (2026-04-24)


### Bug Fixes

* **input:** prevent ghost-text suggestion from swallowing pasted content on Enter ([a657a09](https://github.com/chadbyte/clay/commit/a657a091a0d6557f94651e4a0c4e5797a6ac3ce9))
* **mates:** persist deletedBuiltinKeys in single-user mode ([3986088](https://github.com/chadbyte/clay/commit/3986088f4bf79181095799e39d59253e09726e86))

## [2.34.1-beta.1](https://github.com/chadbyte/clay/compare/v2.34.0...v2.34.1-beta.1) (2026-04-24)


### Bug Fixes

* normalize model ids across session switching ([dae5344](https://github.com/chadbyte/clay/commit/dae5344ed34fbfbb3d0553a9dfa06f4014006872))
* preserve session vendor on reconnect ([5b061ae](https://github.com/chadbyte/clay/commit/5b061ae16c6b06fca3db5ecd18c047fd38f508b6))
* **sidebar:** render worktree icon when set ([43292ab](https://github.com/chadbyte/clay/commit/43292ab6f63598a0c30ce9479ddc798809dd1517))

# [2.34.0](https://github.com/chadbyte/clay/compare/v2.33.1...v2.34.0) (2026-04-24)


### Bug Fixes

* **adapter:** forward per-loop settings to SDK query options ([#335](https://github.com/chadbyte/clay/issues/335)) ([6fd740f](https://github.com/chadbyte/clay/commit/6fd740f02317b95015da68f07627846ee70e26a4))
* **claude:** correct worker ipv4 preload path ([fbc70b2](https://github.com/chadbyte/clay/commit/fbc70b2f30c56f5fb14bbd478e68d3f0d7330d02))
* **claude:** restore worker queries in os user mode ([ac09780](https://github.com/chadbyte/clay/commit/ac09780acd8648cb9fcc109601782b866ebfc838))
* **claude:** sanitize worker ipc payloads ([6867c79](https://github.com/chadbyte/clay/commit/6867c79eb3a94bdf483a5c65fc692c63d0df89f4))
* **codex:** preserve content array when prepending system prompt ([eae322c](https://github.com/chadbyte/clay/commit/eae322c6b3fe145225bf4c7b4a23fcc6ab1fe77f))
* render codex plans as plan variants ([5e2a4e9](https://github.com/chadbyte/clay/commit/5e2a4e9b2e7c10b830c9d4ad7c3d5aa3424cc485))
* **sdk-bridge:** clear acceptEditsAfterStart in all permission-mode paths ([750055e](https://github.com/chadbyte/clay/commit/750055ea10bad83b16bd9cc8a5ad114b9c6c3e3e))
* **sdk-bridge:** prevent cross-vendor model leak across sessions ([1f62af8](https://github.com/chadbyte/clay/commit/1f62af822c52506fd1d091b33a62d05063663fd1))
* **search:** return all query occurrences per assistant turn ([21b0081](https://github.com/chadbyte/clay/commit/21b008111369abac9b28d2cac9577ee2b66f0ada))
* **security:** harden shell command execution ([a2540c2](https://github.com/chadbyte/clay/commit/a2540c24f0ec634c6eb26ee314478a21fc6a0562)), closes [#334](https://github.com/chadbyte/clay/issues/334)
* **sw:** bump cache version to evict stale connection-lost notification ([c91c6ff](https://github.com/chadbyte/clay/commit/c91c6ff60d5cd2dfe107ece213af9ae7e31f96b9))
* **ui:** hide expand affordance for empty thinking blocks ([35bc428](https://github.com/chadbyte/clay/commit/35bc4282c79a09ad7673300bb0cc4c941deceb9c))
* **ui:** restore notification contrast in light mode ([c51f870](https://github.com/chadbyte/clay/commit/c51f87016ad68dab0135a35d371754bdd2c86b72))
* **yoke:** support third-party provider auth modes ([185b6d1](https://github.com/chadbyte/clay/commit/185b6d15080660dcf88d6e5d563c137f7be3aa90)), closes [#331](https://github.com/chadbyte/clay/issues/331)


### Features

* **mates:** add Mate SQLite datastore and inspector ([24bf2f9](https://github.com/chadbyte/clay/commit/24bf2f978f096b497272011b2c53e2e56ba76921))
* **mates:** replace autonomy step with vendor choice in wizard ([f8b4f34](https://github.com/chadbyte/clay/commit/f8b4f3471ffb265ccff5e2d8b45217825683e39e))
* refine session favorites sidebar ([3bc6bb8](https://github.com/chadbyte/clay/commit/3bc6bb898d3651524a1fdfcadd2dfe8e1a48fd75))
* **sidebar:** two-click arm to delete session and polish presence layout ([af66342](https://github.com/chadbyte/clay/commit/af66342fcdbcff3a38fea4419fc5f9ddcc1a5a63))
* **tools:** render codex patch diffs with filename header and split toggle ([1c6ebe2](https://github.com/chadbyte/clay/commit/1c6ebe2f3240fe3f986562e2a80d3325c0f755bd))


### Performance Improvements

* **os-users:** reduce project switch overhead ([96fd254](https://github.com/chadbyte/clay/commit/96fd2540f4e5217fa52240bdd74cbfddf5ce6865))
* **project:** defer owner acl work until query start ([9887a1f](https://github.com/chadbyte/clay/commit/9887a1f9e1870cebef87d9dfec3abb6beab1fd46))
* **yoke:** cache checkInstalled result at module scope ([1ba9bff](https://github.com/chadbyte/clay/commit/1ba9bff1a8c31e54329b311f472ad4aadd24a7de))
* **yoke:** defer adapter warmup to first websocket connection ([26ede6e](https://github.com/chadbyte/clay/commit/26ede6e7847f123ec848142452b70df24ea9718e))

# [2.34.0-beta.10](https://github.com/chadbyte/clay/compare/v2.34.0-beta.9...v2.34.0-beta.10) (2026-04-24)


### Bug Fixes

* **codex:** preserve content array when prepending system prompt ([eae322c](https://github.com/chadbyte/clay/commit/eae322c6b3fe145225bf4c7b4a23fcc6ab1fe77f))
* **sw:** bump cache version to evict stale connection-lost notification ([c91c6ff](https://github.com/chadbyte/clay/commit/c91c6ff60d5cd2dfe107ece213af9ae7e31f96b9))


### Features

* refine session favorites sidebar ([3bc6bb8](https://github.com/chadbyte/clay/commit/3bc6bb898d3651524a1fdfcadd2dfe8e1a48fd75))
* **sidebar:** two-click arm to delete session and polish presence layout ([af66342](https://github.com/chadbyte/clay/commit/af66342fcdbcff3a38fea4419fc5f9ddcc1a5a63))
* **tools:** render codex patch diffs with filename header and split toggle ([1c6ebe2](https://github.com/chadbyte/clay/commit/1c6ebe2f3240fe3f986562e2a80d3325c0f755bd))

# [2.34.0-beta.9](https://github.com/chadbyte/clay/compare/v2.34.0-beta.8...v2.34.0-beta.9) (2026-04-23)


### Performance Improvements

* **project:** defer owner acl work until query start ([9887a1f](https://github.com/chadbyte/clay/commit/9887a1f9e1870cebef87d9dfec3abb6beab1fd46))

# [2.34.0-beta.8](https://github.com/chadbyte/clay/compare/v2.34.0-beta.7...v2.34.0-beta.8) (2026-04-23)


### Performance Improvements

* **os-users:** reduce project switch overhead ([96fd254](https://github.com/chadbyte/clay/commit/96fd2540f4e5217fa52240bdd74cbfddf5ce6865))

# [2.34.0-beta.7](https://github.com/chadbyte/clay/compare/v2.34.0-beta.6...v2.34.0-beta.7) (2026-04-23)


### Bug Fixes

* **claude:** correct worker ipv4 preload path ([fbc70b2](https://github.com/chadbyte/clay/commit/fbc70b2f30c56f5fb14bbd478e68d3f0d7330d02))

# [2.34.0-beta.6](https://github.com/chadbyte/clay/compare/v2.34.0-beta.5...v2.34.0-beta.6) (2026-04-23)


### Bug Fixes

* **claude:** sanitize worker ipc payloads ([6867c79](https://github.com/chadbyte/clay/commit/6867c79eb3a94bdf483a5c65fc692c63d0df89f4))

# [2.34.0-beta.5](https://github.com/chadbyte/clay/compare/v2.34.0-beta.4...v2.34.0-beta.5) (2026-04-23)


### Bug Fixes

* **claude:** restore worker queries in os user mode ([ac09780](https://github.com/chadbyte/clay/commit/ac09780acd8648cb9fcc109601782b866ebfc838))

# [2.34.0-beta.4](https://github.com/chadbyte/clay/compare/v2.34.0-beta.3...v2.34.0-beta.4) (2026-04-23)


### Bug Fixes

* **sdk-bridge:** prevent cross-vendor model leak across sessions ([1f62af8](https://github.com/chadbyte/clay/commit/1f62af822c52506fd1d091b33a62d05063663fd1))
* **search:** return all query occurrences per assistant turn ([21b0081](https://github.com/chadbyte/clay/commit/21b008111369abac9b28d2cac9577ee2b66f0ada))
* **ui:** hide expand affordance for empty thinking blocks ([35bc428](https://github.com/chadbyte/clay/commit/35bc4282c79a09ad7673300bb0cc4c941deceb9c))


### Features

* **mates:** replace autonomy step with vendor choice in wizard ([f8b4f34](https://github.com/chadbyte/clay/commit/f8b4f3471ffb265ccff5e2d8b45217825683e39e))


### Performance Improvements

* **yoke:** cache checkInstalled result at module scope ([1ba9bff](https://github.com/chadbyte/clay/commit/1ba9bff1a8c31e54329b311f472ad4aadd24a7de))
* **yoke:** defer adapter warmup to first websocket connection ([26ede6e](https://github.com/chadbyte/clay/commit/26ede6e7847f123ec848142452b70df24ea9718e))

# [2.34.0-beta.3](https://github.com/chadbyte/clay/compare/v2.34.0-beta.2...v2.34.0-beta.3) (2026-04-23)


### Bug Fixes

* **sdk-bridge:** clear acceptEditsAfterStart in all permission-mode paths ([750055e](https://github.com/chadbyte/clay/commit/750055ea10bad83b16bd9cc8a5ad114b9c6c3e3e))
* **yoke:** support third-party provider auth modes ([185b6d1](https://github.com/chadbyte/clay/commit/185b6d15080660dcf88d6e5d563c137f7be3aa90)), closes [#331](https://github.com/chadbyte/clay/issues/331)

# [2.34.0-beta.2](https://github.com/chadbyte/clay/compare/v2.34.0-beta.1...v2.34.0-beta.2) (2026-04-23)


### Bug Fixes

* **adapter:** forward per-loop settings to SDK query options ([#335](https://github.com/chadbyte/clay/issues/335)) ([6fd740f](https://github.com/chadbyte/clay/commit/6fd740f02317b95015da68f07627846ee70e26a4))

# [2.34.0-beta.1](https://github.com/chadbyte/clay/compare/v2.33.1...v2.34.0-beta.1) (2026-04-23)


### Bug Fixes

* render codex plans as plan variants ([5e2a4e9](https://github.com/chadbyte/clay/commit/5e2a4e9b2e7c10b830c9d4ad7c3d5aa3424cc485))
* **security:** harden shell command execution ([a2540c2](https://github.com/chadbyte/clay/commit/a2540c24f0ec634c6eb26ee314478a21fc6a0562)), closes [#334](https://github.com/chadbyte/clay/issues/334)
* **ui:** restore notification contrast in light mode ([c51f870](https://github.com/chadbyte/clay/commit/c51f87016ad68dab0135a35d371754bdd2c86b72))


### Features

* **mates:** add Mate SQLite datastore and inspector ([24bf2f9](https://github.com/chadbyte/clay/commit/24bf2f978f096b497272011b2c53e2e56ba76921))

## [2.33.1](https://github.com/chadbyte/clay/compare/v2.33.0...v2.33.1) (2026-04-22)


### Bug Fixes

* **auth:** preserve vendor selection and auth flow ([38d2b9a](https://github.com/chadbyte/clay/commit/38d2b9a7110226412eab2f8839289127003b0400))
* **settings:** refine user settings layout ([9a060e1](https://github.com/chadbyte/clay/commit/9a060e16445d18f8491ad4d34bbef3c37396e617))
* **title:** generate session titles after two turns ([4aaeade](https://github.com/chadbyte/clay/commit/4aaeade50bf457962c3e4fe94be3c20c826c859b))
* **ui:** refine notification banner styling ([ae443b5](https://github.com/chadbyte/clay/commit/ae443b5442b3acffdddab49b0779711b5b7cc7fd))
* **ui:** remove connection lost notifications ([d10d734](https://github.com/chadbyte/clay/commit/d10d7347c0be2b36878d29f99af19773e02d70da))
* **ui:** style user island theme toggle ([fc58f3b](https://github.com/chadbyte/clay/commit/fc58f3be2c28fc3dbc66851dcee6ceabf430b00a))
* **ui:** use clay icon for empty notifications ([743d5ad](https://github.com/chadbyte/clay/commit/743d5ad55b66203c895430541b8005c6d35dddd2))
* **yoke:** resolve codex linux auth path ([cc94558](https://github.com/chadbyte/clay/commit/cc945584cc19caf5027d9db82304c13a8f843113))

## [2.33.1-beta.1](https://github.com/chadbyte/clay/compare/v2.33.0...v2.33.1-beta.1) (2026-04-22)


### Bug Fixes

* **auth:** preserve vendor selection and auth flow ([38d2b9a](https://github.com/chadbyte/clay/commit/38d2b9a7110226412eab2f8839289127003b0400))
* **settings:** refine user settings layout ([9a060e1](https://github.com/chadbyte/clay/commit/9a060e16445d18f8491ad4d34bbef3c37396e617))
* **title:** generate session titles after two turns ([4aaeade](https://github.com/chadbyte/clay/commit/4aaeade50bf457962c3e4fe94be3c20c826c859b))
* **ui:** refine notification banner styling ([ae443b5](https://github.com/chadbyte/clay/commit/ae443b5442b3acffdddab49b0779711b5b7cc7fd))
* **ui:** remove connection lost notifications ([d10d734](https://github.com/chadbyte/clay/commit/d10d7347c0be2b36878d29f99af19773e02d70da))
* **ui:** style user island theme toggle ([fc58f3b](https://github.com/chadbyte/clay/commit/fc58f3be2c28fc3dbc66851dcee6ceabf430b00a))
* **ui:** use clay icon for empty notifications ([743d5ad](https://github.com/chadbyte/clay/commit/743d5ad55b66203c895430541b8005c6d35dddd2))
* **yoke:** resolve codex linux auth path ([cc94558](https://github.com/chadbyte/clay/commit/cc945584cc19caf5027d9db82304c13a8f843113))

# [2.33.0](https://github.com/chadbyte/clay/compare/v2.32.0...v2.33.0) (2026-04-22)


### Bug Fixes

* **codex:** forward direct tool events to UI ([b25abe6](https://github.com/chadbyte/clay/commit/b25abe61a00ec52ed98fc4add36a92d44021d21c))
* **codex:** initialize adapter after runtime login ([6703e95](https://github.com/chadbyte/clay/commit/6703e95ce69229642fbf11a1c95997765e8812bf))
* **codex:** prefer device auth in login prompts ([b0bcd2b](https://github.com/chadbyte/clay/commit/b0bcd2b2308485b8b129669284869f12a9f61f25))
* **codex:** preserve bash commands across approval ([9978465](https://github.com/chadbyte/clay/commit/9978465466cf62aa28e1d5d01b491d67510e0317))
* **codex:** route requestUserInput through elicitation UI ([a261c76](https://github.com/chadbyte/clay/commit/a261c768900f1dc9f4cfed347f10b3487e10026f))
* **codex:** surface file change diffs in UI ([f5585a8](https://github.com/chadbyte/clay/commit/f5585a86ec98a8840a42437e066e10e9473299ea))
* **codex:** use app-server thread sandbox params ([b9569c9](https://github.com/chadbyte/clay/commit/b9569c99dfa4364418454e2dc24fe815c66d5b42))
* **mcp:** gate clay-browser MCP on Chrome extension connection ([dd6ba2d](https://github.com/chadbyte/clay/commit/dd6ba2d8c501e6db551a28131c0bed48fe7e28da))
* **mcp:** gate clay-email MCP on email capability being configured ([0497a92](https://github.com/chadbyte/clay/commit/0497a92034b0234749bb58c8eb7ca84cfb9614c0)), closes [#325](https://github.com/chadbyte/clay/issues/325)
* **models:** send vendor-specific model lists ([f6df875](https://github.com/chadbyte/clay/commit/f6df8753499698617bd5ee9bf36a85799418168e))
* open external links in new tab via marked renderer ([#326](https://github.com/chadbyte/clay/issues/326)) ([2011da9](https://github.com/chadbyte/clay/commit/2011da99dd7ed7d13b426884c234b078b8908648))
* **rate-limit:** clear Claude schedule mode on vendor switch ([fa0df6d](https://github.com/chadbyte/clay/commit/fa0df6dbbaf289d4ed7f0b1cde81cb3807d07319))
* **session,permissions:** trim migration titles + inherit bypassPermissions in scheduled tasks ([#328](https://github.com/chadbyte/clay/issues/328)) ([492d310](https://github.com/chadbyte/clay/commit/492d31031b5b1e12874075928ffb13e908293a62))
* **ui,sdk-bridge:** 'codex --login' -> 'codex login' in loginCommand prompts ([#329](https://github.com/chadbyte/clay/issues/329)) ([2519403](https://github.com/chadbyte/clay/commit/2519403f77e9d75294d7c3db728702c377d6bef6)), closes [#327](https://github.com/chadbyte/clay/issues/327) [#327](https://github.com/chadbyte/clay/issues/327)
* **ui:** clear stale models on vendor switch ([1862b9b](https://github.com/chadbyte/clay/commit/1862b9be543695bc5ab2d33498c6d5d481fe2e61))
* **ui:** detect hunk-only patch diffs ([6ee5970](https://github.com/chadbyte/clay/commit/6ee5970e0a779fd4faffdb646482537fc299b21c))
* **ui:** quiet the mate avatar overlay on the @ button ([e1b6b44](https://github.com/chadbyte/clay/commit/e1b6b446da10961a3421256b7fee6a7d9e117971)), closes [#325](https://github.com/chadbyte/clay/issues/325)
* **ui:** show vendor icon on usage pill ([cff7a60](https://github.com/chadbyte/clay/commit/cff7a60fdda8e7f10f41098de6bbe890f5b91181))
* **yoke:** use findCodexPath() instead of hardcoded darwin-arm64 path ([#330](https://github.com/chadbyte/clay/issues/330)) ([f2de390](https://github.com/chadbyte/clay/commit/f2de3900391596ab97efc3ae433d4e1af57906c7)), closes [#325](https://github.com/chadbyte/clay/issues/325) [#file-tree](https://github.com/chadbyte/clay/issues/file-tree) [#share-pill](https://github.com/chadbyte/clay/issues/share-pill) [#327](https://github.com/chadbyte/clay/issues/327)


### Features

* add session bookmarks ([54018d8](https://github.com/chadbyte/clay/commit/54018d867d8ee61a6b46ca631497083b558f01aa))
* **codex:** surface compaction status in Clay UI ([dead00c](https://github.com/chadbyte/clay/commit/dead00c5266b212eb32594be6019600c393f06e5))
* **codex:** surface plan updates in Clay UI ([b4d4f19](https://github.com/chadbyte/clay/commit/b4d4f196729c2e544e89096f0fd29c3ff0ebb267))
* **codex:** surface prompt suggestions in Clay UI ([1d3d5a4](https://github.com/chadbyte/clay/commit/1d3d5a4dd408522e13b164211fa3c962b2acf186))
* **filebrowser:** arrow-key navigation with auto-focus on open ([3362969](https://github.com/chadbyte/clay/commit/3362969f0d05a3c412ac6186480307b8f425503f))
* improve session bookmark interactions ([8f862dc](https://github.com/chadbyte/clay/commit/8f862dc6a44285214ed7f7262c58a92153a8a064))
* **notifications:** Clear-all pill on the banner stack ([928809c](https://github.com/chadbyte/clay/commit/928809c290a0bad507905f8b1873c11a7ae2c604))
* refine session bookmark icon placement ([33dbf98](https://github.com/chadbyte/clay/commit/33dbf98ec594ebdb7e42b2bcbbe2e9abc03450ad))


### Reverts

* **main:** remove unrelated changes from [#330](https://github.com/chadbyte/clay/issues/330) ([5eadb24](https://github.com/chadbyte/clay/commit/5eadb24208a88cd612dff3e0f948b6a2ed205465))

# [2.33.0-beta.3](https://github.com/chadbyte/clay/compare/v2.33.0-beta.2...v2.33.0-beta.3) (2026-04-22)


### Bug Fixes

* **codex:** forward direct tool events to UI ([b25abe6](https://github.com/chadbyte/clay/commit/b25abe61a00ec52ed98fc4add36a92d44021d21c))
* **codex:** initialize adapter after runtime login ([6703e95](https://github.com/chadbyte/clay/commit/6703e95ce69229642fbf11a1c95997765e8812bf))
* **codex:** preserve bash commands across approval ([9978465](https://github.com/chadbyte/clay/commit/9978465466cf62aa28e1d5d01b491d67510e0317))
* **codex:** route requestUserInput through elicitation UI ([a261c76](https://github.com/chadbyte/clay/commit/a261c768900f1dc9f4cfed347f10b3487e10026f))
* **codex:** surface file change diffs in UI ([f5585a8](https://github.com/chadbyte/clay/commit/f5585a86ec98a8840a42437e066e10e9473299ea))
* **codex:** use app-server thread sandbox params ([b9569c9](https://github.com/chadbyte/clay/commit/b9569c99dfa4364418454e2dc24fe815c66d5b42))
* **models:** send vendor-specific model lists ([f6df875](https://github.com/chadbyte/clay/commit/f6df8753499698617bd5ee9bf36a85799418168e))
* **rate-limit:** clear Claude schedule mode on vendor switch ([fa0df6d](https://github.com/chadbyte/clay/commit/fa0df6dbbaf289d4ed7f0b1cde81cb3807d07319))
* **ui:** clear stale models on vendor switch ([1862b9b](https://github.com/chadbyte/clay/commit/1862b9be543695bc5ab2d33498c6d5d481fe2e61))
* **ui:** detect hunk-only patch diffs ([6ee5970](https://github.com/chadbyte/clay/commit/6ee5970e0a779fd4faffdb646482537fc299b21c))
* **ui:** show vendor icon on usage pill ([cff7a60](https://github.com/chadbyte/clay/commit/cff7a60fdda8e7f10f41098de6bbe890f5b91181))


### Features

* add session bookmarks ([54018d8](https://github.com/chadbyte/clay/commit/54018d867d8ee61a6b46ca631497083b558f01aa))
* **codex:** surface compaction status in Clay UI ([dead00c](https://github.com/chadbyte/clay/commit/dead00c5266b212eb32594be6019600c393f06e5))
* **codex:** surface plan updates in Clay UI ([b4d4f19](https://github.com/chadbyte/clay/commit/b4d4f196729c2e544e89096f0fd29c3ff0ebb267))
* **codex:** surface prompt suggestions in Clay UI ([1d3d5a4](https://github.com/chadbyte/clay/commit/1d3d5a4dd408522e13b164211fa3c962b2acf186))
* improve session bookmark interactions ([8f862dc](https://github.com/chadbyte/clay/commit/8f862dc6a44285214ed7f7262c58a92153a8a064))
* refine session bookmark icon placement ([33dbf98](https://github.com/chadbyte/clay/commit/33dbf98ec594ebdb7e42b2bcbbe2e9abc03450ad))

# [2.33.0-beta.2](https://github.com/chadbyte/clay/compare/v2.33.0-beta.1...v2.33.0-beta.2) (2026-04-22)


### Bug Fixes

* **codex:** prefer device auth in login prompts ([b0bcd2b](https://github.com/chadbyte/clay/commit/b0bcd2b2308485b8b129669284869f12a9f61f25))

# [2.33.0-beta.1](https://github.com/chadbyte/clay/compare/v2.32.1-beta.2...v2.33.0-beta.1) (2026-04-22)


### Bug Fixes

* **mcp:** gate clay-browser MCP on Chrome extension connection ([dd6ba2d](https://github.com/chadbyte/clay/commit/dd6ba2d8c501e6db551a28131c0bed48fe7e28da))
* **mcp:** gate clay-email MCP on email capability being configured ([0497a92](https://github.com/chadbyte/clay/commit/0497a92034b0234749bb58c8eb7ca84cfb9614c0)), closes [#325](https://github.com/chadbyte/clay/issues/325)
* **ui:** quiet the mate avatar overlay on the @ button ([e1b6b44](https://github.com/chadbyte/clay/commit/e1b6b446da10961a3421256b7fee6a7d9e117971)), closes [#325](https://github.com/chadbyte/clay/issues/325)


### Features

* **filebrowser:** arrow-key navigation with auto-focus on open ([3362969](https://github.com/chadbyte/clay/commit/3362969f0d05a3c412ac6186480307b8f425503f))
* **notifications:** Clear-all pill on the banner stack ([928809c](https://github.com/chadbyte/clay/commit/928809c290a0bad507905f8b1873c11a7ae2c604))


### Reverts

* **main:** remove unrelated changes from [#330](https://github.com/chadbyte/clay/issues/330) ([5eadb24](https://github.com/chadbyte/clay/commit/5eadb24208a88cd612dff3e0f948b6a2ed205465))

## [2.32.1-beta.2](https://github.com/chadbyte/clay/compare/v2.32.1-beta.1...v2.32.1-beta.2) (2026-04-22)


### Bug Fixes

* **session,permissions:** trim migration titles + inherit bypassPermissions in scheduled tasks ([#328](https://github.com/chadbyte/clay/issues/328)) ([492d310](https://github.com/chadbyte/clay/commit/492d31031b5b1e12874075928ffb13e908293a62))
* **yoke:** use findCodexPath() instead of hardcoded darwin-arm64 path ([#330](https://github.com/chadbyte/clay/issues/330)) ([f2de390](https://github.com/chadbyte/clay/commit/f2de3900391596ab97efc3ae433d4e1af57906c7)), closes [#325](https://github.com/chadbyte/clay/issues/325) [#file-tree](https://github.com/chadbyte/clay/issues/file-tree) [#share-pill](https://github.com/chadbyte/clay/issues/share-pill) [#327](https://github.com/chadbyte/clay/issues/327)

## [2.32.1-beta.1](https://github.com/chadbyte/clay/compare/v2.32.0...v2.32.1-beta.1) (2026-04-22)


### Bug Fixes

* open external links in new tab via marked renderer ([#326](https://github.com/chadbyte/clay/issues/326)) ([2011da9](https://github.com/chadbyte/clay/commit/2011da99dd7ed7d13b426884c234b078b8908648))
* **ui,sdk-bridge:** use `codex login --device-auth` in loginCommand prompts ([#329](https://github.com/chadbyte/clay/issues/329)) ([2519403](https://github.com/chadbyte/clay/commit/2519403f77e9d75294d7c3db728702c377d6bef6)), closes [#327](https://github.com/chadbyte/clay/issues/327) [#327](https://github.com/chadbyte/clay/issues/327)

# [2.32.0](https://github.com/chadbyte/clay/compare/v2.31.0...v2.32.0) (2026-04-20)


### Bug Fixes

* **codex:** abort ends iterator immediately like Claude pattern ([87af5f0](https://github.com/chadbyte/clay/commit/87af5f0f7047cdcf2646cc5f93950200ae078abd))
* **codex:** allow turn/completed through after abort ([3b1d864](https://github.com/chadbyte/clay/commit/3b1d8643fc8e1cffb96577197a62da7c39314994))
* **codex:** clear typing indicator on abort and prevent duplicate message text ([1411807](https://github.com/chadbyte/clay/commit/1411807f6d73be811ff9506b8e91c8057b01441d))
* **codex:** correct skills/list perCwdExtraUserRoots format ([3480f3c](https://github.com/chadbyte/clay/commit/3480f3c5d7c66834b252e0f3ec064c14598de62d))
* **codex:** filter events by threadId to prevent session crosstalk ([b27b495](https://github.com/chadbyte/clay/commit/b27b495710195fe10ed48d5d1e22e1169964feef))
* **codex:** listen for abortController signal to trigger handle.abort ([e978352](https://github.com/chadbyte/clay/commit/e97835207b8dc045f820f3bbcfa3ca410e746a7b))
* **codex:** proper abort handling with turn/completed flow ([68b3c13](https://github.com/chadbyte/clay/commit/68b3c1394a15df6a1eec550862c2b68822fc131f))
* **codex:** route MCP approval through canUseTool instead of auto-accept ([34d6501](https://github.com/chadbyte/clay/commit/34d650144beb7141e0d9ae5b8f5b35b595e8293a))
* **codex:** send turn/interrupt as request instead of notification ([a9240f3](https://github.com/chadbyte/clay/commit/a9240f348737265fc18ee036b1087534a6667ec2))
* **codex:** show interrupted message and reset UI on abort ([6cade75](https://github.com/chadbyte/clay/commit/6cade75607bc37787c43e81096084d51dd349f1f))
* **codex:** wrap command/file approval response in decision object ([ad6a5f5](https://github.com/chadbyte/clay/commit/ad6a5f5e07131769faceff781343e7e848502ed6))
* **debate:** pass mate vendor to createMentionSession calls ([2558314](https://github.com/chadbyte/clay/commit/255831419ec011dbee9e7535424669c9bfa9b3f9))
* improve codex defaults and mate notification flows ([939dcea](https://github.com/chadbyte/clay/commit/939dcea863236af3e1b72d2d5c6a073ef8d5ce84))
* **input:** keep send button fixed and collapse vendor labels earlier ([1dd7a36](https://github.com/chadbyte/clay/commit/1dd7a367b6f1e07b922bef8ca41245a29ef4c8cd))
* **input:** let context picker escape attach-wrap overflow ([0177849](https://github.com/chadbyte/clay/commit/0177849d726e856cbe5193bcb2e2b804df9f4e62)), closes [#attach-wrap](https://github.com/chadbyte/clay/issues/attach-wrap)
* **markdown:** normalize smart quotes before parsing ([33b272b](https://github.com/chadbyte/clay/commit/33b272b17ec5343ba95099aa34cd2d9483671a17))
* **mates:** delta-based DM digests to prevent content loss past 6k chars ([466b67d](https://github.com/chadbyte/clay/commit/466b67daa3c958376815313fd52f48bc0d6a7d84)), closes [#282](https://github.com/chadbyte/clay/issues/282)
* **mates:** restore mention indicator across view switches and DOM rebuilds ([4ee0eb8](https://github.com/chadbyte/clay/commit/4ee0eb81f1875f9d11c9c9399350d48f3d85eedb)), closes [#308](https://github.com/chadbyte/clay/issues/308)
* **mcp:** cache extension state and resend on WS reconnect ([9035de3](https://github.com/chadbyte/clay/commit/9035de39c44cb03e56a156a954483e6952ba7403))
* **mcp:** global bridge endpoint, tool cache refresh, codex 0.121.0 ([b3d125c](https://github.com/chadbyte/clay/commit/b3d125c76101ab93c2e43e2f2d25cffc6c12e228))
* **mention:** use mate's vendor adapter for mention sessions ([04e657e](https://github.com/chadbyte/clay/commit/04e657e2a81279cabfe9de392d0212ae5cce54af))
* **notifications:** resolve mate DM navigation from notifications ([08ad961](https://github.com/chadbyte/clay/commit/08ad9610e94524c39f50d508b08c59295d5be5c4))
* **scroll:** scroll to bottom when returning to app after backgrounding ([#324](https://github.com/chadbyte/clay/issues/324)) ([70a6751](https://github.com/chadbyte/clay/commit/70a675120189f22f591b097c9238348a472e6101))
* **sdk:** preserve mid-session model change across warmup cycles ([420ad34](https://github.com/chadbyte/clay/commit/420ad340140d129bab11e3c8d1068667610b640d)), closes [#321](https://github.com/chadbyte/clay/issues/321)
* send done before interrupted message and use vendor name ([3639c85](https://github.com/chadbyte/clay/commit/3639c85f7c817206b84d9aa96141f38f46734390))
* send info before done so typing indicator clears properly ([9b07ce8](https://github.com/chadbyte/clay/commit/9b07ce8154a80f3bd568c9c90acbb077e7367a8a))
* send status+thinking_stop before done to clear typing indicator ([c194274](https://github.com/chadbyte/clay/commit/c194274a3dd63e442f8ae2845f2a2aefe2dab140))
* **session:** include vendor in session_switched on reconnect ([5714dc6](https://github.com/chadbyte/clay/commit/5714dc6e069ecaa8f4559f273b14903a91f4016a))
* **session:** reset vendor to claude when switching to non-vendor session ([6491ac0](https://github.com/chadbyte/clay/commit/6491ac031e17d0370b333eedecbbb9f02dfdf3a7))
* **session:** resolve sm reference error in switchSession ([6cf21bf](https://github.com/chadbyte/clay/commit/6cf21bfe2921cf8ab1c42db9672a554113d6d8bf))
* set taskStopRequested on stop message for proper abort handling ([bd77eb5](https://github.com/chadbyte/clay/commit/bd77eb51db2be424787c58bc04679aaa1f814a87))
* **ui:** remove orphan closing brace in sidebar-mates mate context menu ([b4a56eb](https://github.com/chadbyte/clay/commit/b4a56eb6265030acd7517224b37440722fd583f5))
* **ui:** remove undefined dismissOnboarding call in sticky-notes ([7ddac57](https://github.com/chadbyte/clay/commit/7ddac576130d1e9a1a2525041b5db2587b0620b8))
* **ui:** replace bare ws and dmTargetUser refs with proper accessors ([b944731](https://github.com/chadbyte/clay/commit/b944731f7e3813c8e105dac9cc99d8743db74b6d))
* **ui:** show vendor name in permission requests instead of hardcoded Claude Code ([c697f86](https://github.com/chadbyte/clay/commit/c697f8628596eb9dd0ff7f48949b475414acebf3))
* **ui:** skip addRewindButton when vendor capability is false ([7425947](https://github.com/chadbyte/clay/commit/742594746cd04fd63a365314cb9f56ad2fdf8fc1))
* **ui:** suppress update banner re-show within 1 hour of dismiss ([f23488d](https://github.com/chadbyte/clay/commit/f23488df1b69e9527a94f4c21615e165c0eb2787))
* **ui:** use getWsRef for fork button click handler ([632b16a](https://github.com/chadbyte/clay/commit/632b16a8a0966d439d3a37310f44140126cf6ba1))
* **ui:** use vendor-specific avatar in permission requests ([055f986](https://github.com/chadbyte/clay/commit/055f986feb4804a40150ae9d5ba8fb8e46c60143))
* use correct interrupted message text ([61dda55](https://github.com/chadbyte/clay/commit/61dda551dc5d7d266edf0658a8cceb0725fedb33))
* vendor-specific interrupted message (Claude vs Codex) ([fc8e7de](https://github.com/chadbyte/clay/commit/fc8e7de6dcf8319e0f0b7caa6d641b731eb80bc6))
* **yoke:** convert mention session stream loop to yokeType events ([7bb1757](https://github.com/chadbyte/clay/commit/7bb175743bdcae867ba0248f280e154be55552b9))
* **yoke:** remove hardcoded API key from Gemini adapter, add debug logging ([b6e624e](https://github.com/chadbyte/clay/commit/b6e624ebc7e6bb32c56ea55315343d5f1754bed0))
* **yoke:** resolve claude binary via which for non-standard installs ([7985abf](https://github.com/chadbyte/clay/commit/7985abffff5abd7bc2018b73fa1c2669dcc8835f))


### Features

* **codex:** add context usage bar and rate limit display ([1810fa4](https://github.com/chadbyte/clay/commit/1810fa486d3b2ce77036c0be96c7cdc28c89d48f))
* **codex:** add fork and rewind support via app-server API ([fd16e47](https://github.com/chadbyte/clay/commit/fd16e47fe575b1d1837a90126f18d31fd0774f07))
* **codex:** migrate to app-server protocol with MCP approval support ([58350b4](https://github.com/chadbyte/clay/commit/58350b433653b22c266bf467ad49661d925102d6))
* **codex:** recognize Claude skills via \$<skill-name> references ([689a04e](https://github.com/chadbyte/clay/commit/689a04e599aad5dc02ff6b8849fc023b0c535308))
* **codex:** vendor-specific slash commands ([ae62fd2](https://github.com/chadbyte/clay/commit/ae62fd295070a9871da0b8a622d5e96af5b58f65))
* **filebrowser:** add window-style titlebar and file search ([5d25c8a](https://github.com/chadbyte/clay/commit/5d25c8a528efe5e21bb2a94c4fc10903f6302c36))
* **input:** add rotating mate avatar overlay on @ button ([b8a6c40](https://github.com/chadbyte/clay/commit/b8a6c40ff4aec18a79d177b61acacb69e373e341))
* **input:** mobile unified bottom sheet for attach, image, and context sources ([f55bb45](https://github.com/chadbyte/clay/commit/f55bb456f0969225eca5d8adc91d7fadfb89e916))
* **input:** replace prompt suggestion chips with ghost text pattern ([0753833](https://github.com/chadbyte/clay/commit/0753833bd96e433b40dbed4a084d546766e6e327))
* **mates:** add per-mate vendor selection and vendor badge on strip ([108708a](https://github.com/chadbyte/clay/commit/108708a431ac3edf6d07837862125ee4b329d4c3))
* **mates:** persist vendor, vendor badges in mention menu, and UI polish ([10907a6](https://github.com/chadbyte/clay/commit/10907a66cd4e9110ebf5b0f3d03cee402da3ae2b))
* **mcp:** enable MCP tool support in Codex sessions via stdio bridge ([45f3d17](https://github.com/chadbyte/clay/commit/45f3d171e8d52f8d409ec143573c66e1924695be))
* **notifications:** add mention response notifications with mate avatar ([04efe57](https://github.com/chadbyte/clay/commit/04efe57d2959c2cc914ec317302584d9bd6ba95c))
* **session:** auto-generate session title via SDK after 3 turns ([022f07e](https://github.com/chadbyte/clay/commit/022f07e5ccdbc04d7c29a4f3897e3717168de1a8))
* **session:** send vendor capabilities to client, hide rewind for Codex ([dfbf77d](https://github.com/chadbyte/clay/commit/dfbf77da1fc46dc8fed3a7d7dc9cbf9e9dc08664))
* **ui:** restore terminal toggle button in top bar ([1bdd6fd](https://github.com/chadbyte/clay/commit/1bdd6fdb17a91beeb94c0e0cc11ab99432d7f40b))
* **ui:** richer context tooltip and hourly update push ([b7adcdd](https://github.com/chadbyte/clay/commit/b7adcdd462ee19837f17bf3d39a9d9556a2ae543))
* **vendor:** allow vendor selection before auth, login flow on send ([fa29580](https://github.com/chadbyte/clay/commit/fa2958061607cfb0339278f2624ba865f854a9f2))
* **yoke:** add Codex adapter fixes, cross-vendor instruction injection, and vendor UI ([60ec23d](https://github.com/chadbyte/clay/commit/60ec23d54dee9e6cd7491d7fd3513f6240ce7fba))
* **yoke:** add Codex adapter, restore Claude as default ([483dd28](https://github.com/chadbyte/clay/commit/483dd28a0d56b1277f121c9a61598302a629c9dc))
* **yoke:** add Gemini adapter (Phase 4a) ([068bd2a](https://github.com/chadbyte/clay/commit/068bd2a78e43831271aef2d288497038969cebc6))
* **yoke:** add multi-vendor adapter map, vendor toggle UI, and per-session vendor binding ([8b37ce2](https://github.com/chadbyte/clay/commit/8b37ce28e5f38dd10de349edf666716b9356142b))
* **yoke:** add vendor-specific config panel, fix model switching, and polish UI ([72246c4](https://github.com/chadbyte/clay/commit/72246c4fb6188fb732597cf08699f80398be6770))
* **yoke:** Gemini adapter working in Clay ([48164d0](https://github.com/chadbyte/clay/commit/48164d0322b2a67abb3ca88fa2d6b4cc12c1be26))
* **yoke:** merge YOKE adapter abstraction layer ([49ebc2c](https://github.com/chadbyte/clay/commit/49ebc2c7602d4b20ff4375181a96545490d57943))


### Performance Improvements

* **skills:** cache skill update checks with 5-minute TTL ([9370407](https://github.com/chadbyte/clay/commit/93704074f36d459d8e464bf78e9434f0f81a7f2a))
* **yoke:** cache Codex adapter init and reduce warmup log noise ([edddca5](https://github.com/chadbyte/clay/commit/edddca5fc0886ee6a3312c9e25f85003f10a55d8))

# [2.32.0-beta.11](https://github.com/chadbyte/clay/compare/v2.32.0-beta.10...v2.32.0-beta.11) (2026-04-20)


### Bug Fixes

* **scroll:** scroll to bottom when returning to app after backgrounding ([#324](https://github.com/chadbyte/clay/issues/324)) ([70a6751](https://github.com/chadbyte/clay/commit/70a675120189f22f591b097c9238348a472e6101))

# [2.32.0-beta.10](https://github.com/chadbyte/clay/compare/v2.32.0-beta.9...v2.32.0-beta.10) (2026-04-20)


### Bug Fixes

* **input:** let context picker escape attach-wrap overflow ([0177849](https://github.com/chadbyte/clay/commit/0177849d726e856cbe5193bcb2e2b804df9f4e62)), closes [#attach-wrap](https://github.com/chadbyte/clay/issues/attach-wrap)

# [2.32.0-beta.9](https://github.com/chadbyte/clay/compare/v2.32.0-beta.8...v2.32.0-beta.9) (2026-04-20)


### Bug Fixes

* **input:** keep send button fixed and collapse vendor labels earlier ([1dd7a36](https://github.com/chadbyte/clay/commit/1dd7a367b6f1e07b922bef8ca41245a29ef4c8cd))

# [2.32.0-beta.8](https://github.com/chadbyte/clay/compare/v2.32.0-beta.7...v2.32.0-beta.8) (2026-04-20)


### Bug Fixes

* **codex:** correct skills/list perCwdExtraUserRoots format ([3480f3c](https://github.com/chadbyte/clay/commit/3480f3c5d7c66834b252e0f3ec064c14598de62d))
* **codex:** wrap command/file approval response in decision object ([ad6a5f5](https://github.com/chadbyte/clay/commit/ad6a5f5e07131769faceff781343e7e848502ed6))
* improve codex defaults and mate notification flows ([939dcea](https://github.com/chadbyte/clay/commit/939dcea863236af3e1b72d2d5c6a073ef8d5ce84))
* **notifications:** resolve mate DM navigation from notifications ([08ad961](https://github.com/chadbyte/clay/commit/08ad9610e94524c39f50d508b08c59295d5be5c4))


### Features

* **codex:** recognize Claude skills via \$<skill-name> references ([689a04e](https://github.com/chadbyte/clay/commit/689a04e599aad5dc02ff6b8849fc023b0c535308))
* **codex:** vendor-specific slash commands ([ae62fd2](https://github.com/chadbyte/clay/commit/ae62fd295070a9871da0b8a622d5e96af5b58f65))
* **input:** mobile unified bottom sheet for attach, image, and context sources ([f55bb45](https://github.com/chadbyte/clay/commit/f55bb456f0969225eca5d8adc91d7fadfb89e916))
* **notifications:** add mention response notifications with mate avatar ([04efe57](https://github.com/chadbyte/clay/commit/04efe57d2959c2cc914ec317302584d9bd6ba95c))
* **ui:** restore terminal toggle button in top bar ([1bdd6fd](https://github.com/chadbyte/clay/commit/1bdd6fdb17a91beeb94c0e0cc11ab99432d7f40b))
* **ui:** richer context tooltip and hourly update push ([b7adcdd](https://github.com/chadbyte/clay/commit/b7adcdd462ee19837f17bf3d39a9d9556a2ae543))

# [2.32.0-beta.7](https://github.com/chadbyte/clay/compare/v2.32.0-beta.6...v2.32.0-beta.7) (2026-04-19)


### Bug Fixes

* **yoke:** resolve claude binary via which for non-standard installs ([7985abf](https://github.com/chadbyte/clay/commit/7985abffff5abd7bc2018b73fa1c2669dcc8835f))

# [2.32.0-beta.6](https://github.com/chadbyte/clay/compare/v2.32.0-beta.5...v2.32.0-beta.6) (2026-04-18)


### Bug Fixes

* **mates:** delta-based DM digests to prevent content loss past 6k chars ([466b67d](https://github.com/chadbyte/clay/commit/466b67daa3c958376815313fd52f48bc0d6a7d84)), closes [#282](https://github.com/chadbyte/clay/issues/282)
* **mates:** restore mention indicator across view switches and DOM rebuilds ([4ee0eb8](https://github.com/chadbyte/clay/commit/4ee0eb81f1875f9d11c9c9399350d48f3d85eedb)), closes [#308](https://github.com/chadbyte/clay/issues/308)

# [2.32.0-beta.5](https://github.com/chadbyte/clay/compare/v2.32.0-beta.4...v2.32.0-beta.5) (2026-04-18)


### Bug Fixes

* **sdk:** preserve mid-session model change across warmup cycles ([420ad34](https://github.com/chadbyte/clay/commit/420ad340140d129bab11e3c8d1068667610b640d)), closes [#321](https://github.com/chadbyte/clay/issues/321)

# [2.32.0-beta.4](https://github.com/chadbyte/clay/compare/v2.32.0-beta.3...v2.32.0-beta.4) (2026-04-18)


### Bug Fixes

* **debate:** pass mate vendor to createMentionSession calls ([2558314](https://github.com/chadbyte/clay/commit/255831419ec011dbee9e7535424669c9bfa9b3f9))
* **markdown:** normalize smart quotes before parsing ([33b272b](https://github.com/chadbyte/clay/commit/33b272b17ec5343ba95099aa34cd2d9483671a17))
* **mention:** use mate's vendor adapter for mention sessions ([04e657e](https://github.com/chadbyte/clay/commit/04e657e2a81279cabfe9de392d0212ae5cce54af))

# [2.32.0-beta.3](https://github.com/chadbyte/clay/compare/v2.32.0-beta.2...v2.32.0-beta.3) (2026-04-18)


### Bug Fixes

* **ui:** replace bare ws and dmTargetUser refs with proper accessors ([b944731](https://github.com/chadbyte/clay/commit/b944731f7e3813c8e105dac9cc99d8743db74b6d))


### Features

* **session:** auto-generate session title via SDK after 3 turns ([022f07e](https://github.com/chadbyte/clay/commit/022f07e5ccdbc04d7c29a4f3897e3717168de1a8))

# [2.32.0-beta.2](https://github.com/chadbyte/clay/compare/v2.32.0-beta.1...v2.32.0-beta.2) (2026-04-18)


### Bug Fixes

* **ui:** suppress update banner re-show within 1 hour of dismiss ([f23488d](https://github.com/chadbyte/clay/commit/f23488df1b69e9527a94f4c21615e165c0eb2787))

# [2.32.0-beta.1](https://github.com/chadbyte/clay/compare/v2.31.0...v2.32.0-beta.1) (2026-04-18)


### Bug Fixes

* **codex:** abort ends iterator immediately like Claude pattern ([87af5f0](https://github.com/chadbyte/clay/commit/87af5f0f7047cdcf2646cc5f93950200ae078abd))
* **codex:** allow turn/completed through after abort ([3b1d864](https://github.com/chadbyte/clay/commit/3b1d8643fc8e1cffb96577197a62da7c39314994))
* **codex:** clear typing indicator on abort and prevent duplicate message text ([1411807](https://github.com/chadbyte/clay/commit/1411807f6d73be811ff9506b8e91c8057b01441d))
* **codex:** filter events by threadId to prevent session crosstalk ([b27b495](https://github.com/chadbyte/clay/commit/b27b495710195fe10ed48d5d1e22e1169964feef))
* **codex:** listen for abortController signal to trigger handle.abort ([e978352](https://github.com/chadbyte/clay/commit/e97835207b8dc045f820f3bbcfa3ca410e746a7b))
* **codex:** proper abort handling with turn/completed flow ([68b3c13](https://github.com/chadbyte/clay/commit/68b3c1394a15df6a1eec550862c2b68822fc131f))
* **codex:** route MCP approval through canUseTool instead of auto-accept ([34d6501](https://github.com/chadbyte/clay/commit/34d650144beb7141e0d9ae5b8f5b35b595e8293a))
* **codex:** send turn/interrupt as request instead of notification ([a9240f3](https://github.com/chadbyte/clay/commit/a9240f348737265fc18ee036b1087534a6667ec2))
* **codex:** show interrupted message and reset UI on abort ([6cade75](https://github.com/chadbyte/clay/commit/6cade75607bc37787c43e81096084d51dd349f1f))
* **mcp:** cache extension state and resend on WS reconnect ([9035de3](https://github.com/chadbyte/clay/commit/9035de39c44cb03e56a156a954483e6952ba7403))
* **mcp:** global bridge endpoint, tool cache refresh, codex 0.121.0 ([b3d125c](https://github.com/chadbyte/clay/commit/b3d125c76101ab93c2e43e2f2d25cffc6c12e228))
* send done before interrupted message and use vendor name ([3639c85](https://github.com/chadbyte/clay/commit/3639c85f7c817206b84d9aa96141f38f46734390))
* send info before done so typing indicator clears properly ([9b07ce8](https://github.com/chadbyte/clay/commit/9b07ce8154a80f3bd568c9c90acbb077e7367a8a))
* send status+thinking_stop before done to clear typing indicator ([c194274](https://github.com/chadbyte/clay/commit/c194274a3dd63e442f8ae2845f2a2aefe2dab140))
* **session:** include vendor in session_switched on reconnect ([5714dc6](https://github.com/chadbyte/clay/commit/5714dc6e069ecaa8f4559f273b14903a91f4016a))
* **session:** reset vendor to claude when switching to non-vendor session ([6491ac0](https://github.com/chadbyte/clay/commit/6491ac031e17d0370b333eedecbbb9f02dfdf3a7))
* **session:** resolve sm reference error in switchSession ([6cf21bf](https://github.com/chadbyte/clay/commit/6cf21bfe2921cf8ab1c42db9672a554113d6d8bf))
* set taskStopRequested on stop message for proper abort handling ([bd77eb5](https://github.com/chadbyte/clay/commit/bd77eb51db2be424787c58bc04679aaa1f814a87))
* **ui:** remove orphan closing brace in sidebar-mates mate context menu ([b4a56eb](https://github.com/chadbyte/clay/commit/b4a56eb6265030acd7517224b37440722fd583f5))
* **ui:** remove undefined dismissOnboarding call in sticky-notes ([7ddac57](https://github.com/chadbyte/clay/commit/7ddac576130d1e9a1a2525041b5db2587b0620b8))
* **ui:** show vendor name in permission requests instead of hardcoded Claude Code ([c697f86](https://github.com/chadbyte/clay/commit/c697f8628596eb9dd0ff7f48949b475414acebf3))
* **ui:** skip addRewindButton when vendor capability is false ([7425947](https://github.com/chadbyte/clay/commit/742594746cd04fd63a365314cb9f56ad2fdf8fc1))
* **ui:** use getWsRef for fork button click handler ([632b16a](https://github.com/chadbyte/clay/commit/632b16a8a0966d439d3a37310f44140126cf6ba1))
* **ui:** use vendor-specific avatar in permission requests ([055f986](https://github.com/chadbyte/clay/commit/055f986feb4804a40150ae9d5ba8fb8e46c60143))
* use correct interrupted message text ([61dda55](https://github.com/chadbyte/clay/commit/61dda551dc5d7d266edf0658a8cceb0725fedb33))
* vendor-specific interrupted message (Claude vs Codex) ([fc8e7de](https://github.com/chadbyte/clay/commit/fc8e7de6dcf8319e0f0b7caa6d641b731eb80bc6))
* **yoke:** convert mention session stream loop to yokeType events ([7bb1757](https://github.com/chadbyte/clay/commit/7bb175743bdcae867ba0248f280e154be55552b9))
* **yoke:** remove hardcoded API key from Gemini adapter, add debug logging ([b6e624e](https://github.com/chadbyte/clay/commit/b6e624ebc7e6bb32c56ea55315343d5f1754bed0))


### Features

* **codex:** add context usage bar and rate limit display ([1810fa4](https://github.com/chadbyte/clay/commit/1810fa486d3b2ce77036c0be96c7cdc28c89d48f))
* **codex:** add fork and rewind support via app-server API ([fd16e47](https://github.com/chadbyte/clay/commit/fd16e47fe575b1d1837a90126f18d31fd0774f07))
* **codex:** migrate to app-server protocol with MCP approval support ([58350b4](https://github.com/chadbyte/clay/commit/58350b433653b22c266bf467ad49661d925102d6))
* **filebrowser:** add window-style titlebar and file search ([5d25c8a](https://github.com/chadbyte/clay/commit/5d25c8a528efe5e21bb2a94c4fc10903f6302c36))
* **input:** add rotating mate avatar overlay on @ button ([b8a6c40](https://github.com/chadbyte/clay/commit/b8a6c40ff4aec18a79d177b61acacb69e373e341))
* **input:** replace prompt suggestion chips with ghost text pattern ([0753833](https://github.com/chadbyte/clay/commit/0753833bd96e433b40dbed4a084d546766e6e327))
* **mates:** add per-mate vendor selection and vendor badge on strip ([108708a](https://github.com/chadbyte/clay/commit/108708a431ac3edf6d07837862125ee4b329d4c3))
* **mates:** persist vendor, vendor badges in mention menu, and UI polish ([10907a6](https://github.com/chadbyte/clay/commit/10907a66cd4e9110ebf5b0f3d03cee402da3ae2b))
* **mcp:** enable MCP tool support in Codex sessions via stdio bridge ([45f3d17](https://github.com/chadbyte/clay/commit/45f3d171e8d52f8d409ec143573c66e1924695be))
* **session:** send vendor capabilities to client, hide rewind for Codex ([dfbf77d](https://github.com/chadbyte/clay/commit/dfbf77da1fc46dc8fed3a7d7dc9cbf9e9dc08664))
* **vendor:** allow vendor selection before auth, login flow on send ([fa29580](https://github.com/chadbyte/clay/commit/fa2958061607cfb0339278f2624ba865f854a9f2))
* **yoke:** add Codex adapter fixes, cross-vendor instruction injection, and vendor UI ([60ec23d](https://github.com/chadbyte/clay/commit/60ec23d54dee9e6cd7491d7fd3513f6240ce7fba))
* **yoke:** add Codex adapter, restore Claude as default ([483dd28](https://github.com/chadbyte/clay/commit/483dd28a0d56b1277f121c9a61598302a629c9dc))
* **yoke:** add Gemini adapter (Phase 4a) ([068bd2a](https://github.com/chadbyte/clay/commit/068bd2a78e43831271aef2d288497038969cebc6))
* **yoke:** add multi-vendor adapter map, vendor toggle UI, and per-session vendor binding ([8b37ce2](https://github.com/chadbyte/clay/commit/8b37ce28e5f38dd10de349edf666716b9356142b))
* **yoke:** add vendor-specific config panel, fix model switching, and polish UI ([72246c4](https://github.com/chadbyte/clay/commit/72246c4fb6188fb732597cf08699f80398be6770))
* **yoke:** Gemini adapter working in Clay ([48164d0](https://github.com/chadbyte/clay/commit/48164d0322b2a67abb3ca88fa2d6b4cc12c1be26))
* **yoke:** merge YOKE adapter abstraction layer ([49ebc2c](https://github.com/chadbyte/clay/commit/49ebc2c7602d4b20ff4375181a96545490d57943))


### Performance Improvements

* **skills:** cache skill update checks with 5-minute TTL ([9370407](https://github.com/chadbyte/clay/commit/93704074f36d459d8e464bf78e9434f0f81a7f2a))
* **yoke:** cache Codex adapter init and reduce warmup log noise ([edddca5](https://github.com/chadbyte/clay/commit/edddca5fc0886ee6a3312c9e25f85003f10a55d8))

# [2.31.0](https://github.com/chadbyte/clay/compare/v2.30.0...v2.31.0) (2026-04-17)


### Bug Fixes

* **browser:** use extension WebSocket for tab context requests ([19b909e](https://github.com/chadbyte/clay/commit/19b909e9fd4fef0f617e3ef18e421aac0245386b))
* **email:** resolve MCP tool account lookup for per-session context ([9aaa7fd](https://github.com/chadbyte/clay/commit/9aaa7fd515a2f3dbe8bd71ac470ed383c7e5246b))
* **email:** resolve userId dynamically in MCP tool deps ([e2cd5dc](https://github.com/chadbyte/clay/commit/e2cd5dc5d3ecbdf751c4a6908be396c88befa75a))
* **ui:** prevent notification banner title overflow ([04e65e2](https://github.com/chadbyte/clay/commit/04e65e28f28296825ab5b911739bf128530a6764))


### Features

* **email:** add clay_move_email tool for folder/label management ([26e8d84](https://github.com/chadbyte/clay/commit/26e8d84c76a4c175dcc9a5dde4fdfa2e8b352c6a))
* **email:** add email integration with IMAP/SMTP and SDK tools ([e80dde8](https://github.com/chadbyte/clay/commit/e80dde8c98a8e92bdf9deb705c3b9e68e9532f6c))
* **file-browser:** add distinct panel styling, transitions, and drag-to-input ([2147c48](https://github.com/chadbyte/clay/commit/2147c480f12485460abe36c8fccdb9e2e6e36137))
* **sdk:** upgrade to 0.2.112, implement P1 items ([ea72066](https://github.com/chadbyte/clay/commit/ea72066d4a0355f6a602435e2596bdb72b5bc6d8))
* **ui:** add mate sidebar resize handle and sync widths ([ce9f2c8](https://github.com/chadbyte/clay/commit/ce9f2c8457885db005cba0e8c1187f262d56fb35))

# [2.31.0-beta.1](https://github.com/chadbyte/clay/compare/v2.30.0...v2.31.0-beta.1) (2026-04-17)


### Bug Fixes

* **browser:** use extension WebSocket for tab context requests ([19b909e](https://github.com/chadbyte/clay/commit/19b909e9fd4fef0f617e3ef18e421aac0245386b))
* **email:** resolve MCP tool account lookup for per-session context ([9aaa7fd](https://github.com/chadbyte/clay/commit/9aaa7fd515a2f3dbe8bd71ac470ed383c7e5246b))
* **email:** resolve userId dynamically in MCP tool deps ([e2cd5dc](https://github.com/chadbyte/clay/commit/e2cd5dc5d3ecbdf751c4a6908be396c88befa75a))
* **ui:** prevent notification banner title overflow ([04e65e2](https://github.com/chadbyte/clay/commit/04e65e28f28296825ab5b911739bf128530a6764))


### Features

* **email:** add clay_move_email tool for folder/label management ([26e8d84](https://github.com/chadbyte/clay/commit/26e8d84c76a4c175dcc9a5dde4fdfa2e8b352c6a))
* **email:** add email integration with IMAP/SMTP and SDK tools ([e80dde8](https://github.com/chadbyte/clay/commit/e80dde8c98a8e92bdf9deb705c3b9e68e9532f6c))
* **file-browser:** add distinct panel styling, transitions, and drag-to-input ([2147c48](https://github.com/chadbyte/clay/commit/2147c480f12485460abe36c8fccdb9e2e6e36137))
* **sdk:** upgrade to 0.2.112, implement P1 items ([ea72066](https://github.com/chadbyte/clay/commit/ea72066d4a0355f6a602435e2596bdb72b5bc6d8))
* **ui:** add mate sidebar resize handle and sync widths ([ce9f2c8](https://github.com/chadbyte/clay/commit/ce9f2c8457885db005cba0e8c1187f262d56fb35))

# [2.30.0](https://github.com/chadbyte/clay/compare/v2.29.5...v2.30.0) (2026-04-16)


### Bug Fixes

* **dm:** allow DM and mate chat in single-user mode ([75c34e6](https://github.com/chadbyte/clay/commit/75c34e655b9bd79d020fc19b9741910e210f39c8))
* **projects:** pass IGNORED_DIRS and onCreateWorktree to attachSessions ([3aaa062](https://github.com/chadbyte/clay/commit/3aaa0625d34d9c0e1dfa406005a3e07903034000))


### Features

* **ui:** allow icon change for worktree projects in icon strip ([46a8f00](https://github.com/chadbyte/clay/commit/46a8f00ee5c351cb44354ac21db42258ac48d48b))

# [2.30.0-beta.2](https://github.com/chadbyte/clay/compare/v2.30.0-beta.1...v2.30.0-beta.2) (2026-04-16)


### Bug Fixes

* **projects:** pass IGNORED_DIRS and onCreateWorktree to attachSessions ([3aaa062](https://github.com/chadbyte/clay/commit/3aaa0625d34d9c0e1dfa406005a3e07903034000))

# [2.30.0-beta.1](https://github.com/chadbyte/clay/compare/v2.29.6-beta.1...v2.30.0-beta.1) (2026-04-16)


### Features

* **ui:** allow icon change for worktree projects in icon strip ([46a8f00](https://github.com/chadbyte/clay/commit/46a8f00ee5c351cb44354ac21db42258ac48d48b))

## [2.29.6-beta.1](https://github.com/chadbyte/clay/compare/v2.29.5...v2.29.6-beta.1) (2026-04-16)


### Bug Fixes

* **dm:** allow DM and mate chat in single-user mode ([75c34e6](https://github.com/chadbyte/clay/commit/75c34e655b9bd79d020fc19b9741910e210f39c8))

## [2.29.5](https://github.com/chadbyte/clay/compare/v2.29.4...v2.29.5) (2026-04-16)


### Bug Fixes

* **mcp:** queue extension messages until WS is ready and clean up on disconnect ([f150f78](https://github.com/chadbyte/clay/commit/f150f7840624adfaba30af0960d07088130c4e44)), closes [hi#latency](https://github.com/hi/issues/latency)
* **ui:** show all mates in strip for single-user mode ([71c5978](https://github.com/chadbyte/clay/commit/71c5978589c982cd2952c788d3787bcf6449a55b))


### Performance Improvements

* **ui:** add fingerprint guard to renderUserStrip ([808bf65](https://github.com/chadbyte/clay/commit/808bf656b53d72ec6cd0b1a1a5a8cab0bcf7bbee))

## [2.29.5-beta.3](https://github.com/chadbyte/clay/compare/v2.29.5-beta.2...v2.29.5-beta.3) (2026-04-16)


### Bug Fixes

* **ui:** show all mates in strip for single-user mode ([71c5978](https://github.com/chadbyte/clay/commit/71c5978589c982cd2952c788d3787bcf6449a55b))

## [2.29.5-beta.2](https://github.com/chadbyte/clay/compare/v2.29.5-beta.1...v2.29.5-beta.2) (2026-04-16)


### Performance Improvements

* **ui:** add fingerprint guard to renderUserStrip ([808bf65](https://github.com/chadbyte/clay/commit/808bf656b53d72ec6cd0b1a1a5a8cab0bcf7bbee))

## [2.29.5-beta.1](https://github.com/chadbyte/clay/compare/v2.29.4...v2.29.5-beta.1) (2026-04-16)


### Bug Fixes

* **mcp:** queue extension messages until WS is ready and clean up on disconnect ([f150f78](https://github.com/chadbyte/clay/commit/f150f7840624adfaba30af0960d07088130c4e44)), closes [hi#latency](https://github.com/hi/issues/latency)

## [2.29.4](https://github.com/chadbyte/clay/compare/v2.29.3...v2.29.4) (2026-04-16)


### Bug Fixes

* **terminal:** dispose WebGL addon before xterm to prevent _isDisposed error ([811a95c](https://github.com/chadbyte/clay/commit/811a95cef10ed1b740066f0e401e9eb1c473e9f9))
* **ui:** clear stale connected/processing dots from inactive project icons ([32e8215](https://github.com/chadbyte/clay/commit/32e8215cf2c8f815a7ee7382437f57ef06368134))


### Performance Improvements

* **ui:** skip redundant re-renders in updateProjectList ([435f1f9](https://github.com/chadbyte/clay/commit/435f1f971e5131b011bb8a9088f16eb78d6f552c))


### Reverts

* **ui:** remove icon strip DOM rebuild optimization and stale dot clearing ([c60a5a9](https://github.com/chadbyte/clay/commit/c60a5a987590020643fcc974c0cbc38fa98ad323))

## [2.29.4-beta.3](https://github.com/chadbyte/clay/compare/v2.29.4-beta.2...v2.29.4-beta.3) (2026-04-16)


### Performance Improvements

* **ui:** skip redundant re-renders in updateProjectList ([435f1f9](https://github.com/chadbyte/clay/commit/435f1f971e5131b011bb8a9088f16eb78d6f552c))


### Reverts

* **ui:** remove icon strip DOM rebuild optimization and stale dot clearing ([c60a5a9](https://github.com/chadbyte/clay/commit/c60a5a987590020643fcc974c0cbc38fa98ad323))

## [2.29.4-beta.2](https://github.com/chadbyte/clay/compare/v2.29.4-beta.1...v2.29.4-beta.2) (2026-04-16)


### Bug Fixes

* **ui:** clear stale connected/processing dots from inactive project icons ([32e8215](https://github.com/chadbyte/clay/commit/32e8215cf2c8f815a7ee7382437f57ef06368134))

## [2.29.4-beta.1](https://github.com/chadbyte/clay/compare/v2.29.3...v2.29.4-beta.1) (2026-04-16)


### Bug Fixes

* **terminal:** dispose WebGL addon before xterm to prevent _isDisposed error ([811a95c](https://github.com/chadbyte/clay/commit/811a95cef10ed1b740066f0e401e9eb1c473e9f9))

## [2.29.3](https://github.com/chadbyte/clay/compare/v2.29.2...v2.29.3) (2026-04-16)


### Performance Improvements

* **ui:** avoid full icon strip DOM rebuild on project switch and DM messages ([7b9fd37](https://github.com/chadbyte/clay/commit/7b9fd3719a8460cc28f1a7ad4ecef54d929b4741))

## [2.29.3-beta.1](https://github.com/chadbyte/clay/compare/v2.29.2...v2.29.3-beta.1) (2026-04-15)


### Performance Improvements

* **ui:** avoid full icon strip DOM rebuild on project switch and DM messages ([7b9fd37](https://github.com/chadbyte/clay/commit/7b9fd3719a8460cc28f1a7ad4ecef54d929b4741))

## [2.29.2](https://github.com/chadbyte/clay/compare/v2.29.1...v2.29.2) (2026-04-15)


### Bug Fixes

* **clone:** set user HOME env and pre-create target directory for multi-user clone ([d3a9cdd](https://github.com/chadbyte/clay/commit/d3a9cddfe96d4c25ebab402cea751a0b00841095))

## [2.29.2-beta.1](https://github.com/chadbyte/clay/compare/v2.29.1...v2.29.2-beta.1) (2026-04-15)


### Bug Fixes

* **clone:** set user HOME env and pre-create target directory for multi-user clone ([d3a9cdd](https://github.com/chadbyte/clay/commit/d3a9cddfe96d4c25ebab402cea751a0b00841095))

## [2.29.1](https://github.com/chadbyte/clay/compare/v2.29.0...v2.29.1) (2026-04-15)


### Bug Fixes

* **sdk:** resolve circular reference error when sending MCP servers to worker via IPC ([067a85e](https://github.com/chadbyte/clay/commit/067a85e4b7167ad897bdeb2111fef61df578b934))

## [2.29.1-beta.1](https://github.com/chadbyte/clay/compare/v2.29.0...v2.29.1-beta.1) (2026-04-15)


### Bug Fixes

* **sdk:** resolve circular reference error when sending MCP servers to worker via IPC ([067a85e](https://github.com/chadbyte/clay/commit/067a85e4b7167ad897bdeb2111fef61df578b934))

# [2.29.0](https://github.com/chadbyte/clay/compare/v2.28.0...v2.29.0) (2026-04-15)


### Bug Fixes

* **clone:** pre-create target directory with user ownership before git clone in multi-user mode ([89d51a0](https://github.com/chadbyte/clay/commit/89d51a0ead71146044a6af4f28c3e5ccbee7963a))


### Features

* **multi-user:** add path restrictions and ownership lock for home directory projects ([34e2607](https://github.com/chadbyte/clay/commit/34e260726208eb221d9e735ddacd09a702016fc7))

# [2.29.0-beta.1](https://github.com/chadbyte/clay/compare/v2.28.0...v2.29.0-beta.1) (2026-04-15)


### Bug Fixes

* **clone:** pre-create target directory with user ownership before git clone in multi-user mode ([89d51a0](https://github.com/chadbyte/clay/commit/89d51a0ead71146044a6af4f28c3e5ccbee7963a))


### Features

* **multi-user:** add path restrictions and ownership lock for home directory projects ([34e2607](https://github.com/chadbyte/clay/commit/34e260726208eb221d9e735ddacd09a702016fc7))

# [2.28.0](https://github.com/chadbyte/clay/compare/v2.27.1...v2.28.0) (2026-04-15)


### Bug Fixes

* **browser:** use shared mutable browserState object ([9520f7b](https://github.com/chadbyte/clay/commit/9520f7b983e09ac3cc926ff81ff6bf14b2edc2b9))
* **mates:** support single-user mode by synthesizing default userId ([66d3759](https://github.com/chadbyte/clay/commit/66d37596fede13f914ce616bca6e88e2c78a75be)), closes [#315](https://github.com/chadbyte/clay/issues/315)
* **mcp-ui:** minor wording tweak in setup wizard step 2 ([240e285](https://github.com/chadbyte/clay/commit/240e285c19b9f9b8136bc7f45701aa0efaaa712a))
* **mcp-ui:** optimistic toggle with cooldown to prevent revert ([5a3729e](https://github.com/chadbyte/clay/commit/5a3729ed4eeac39a22f967901fb11d6ab329b9f5))
* **mcp-ui:** update step 3 guide to point to extension popup ([a97d1e2](https://github.com/chadbyte/clay/commit/a97d1e23ccb16b9f0216bb5dee7ec36db84ade44))
* **mcp:** add display:none rule for hidden MCP modal ([e5b1066](https://github.com/chadbyte/clay/commit/e5b10663b57e7a8b49ba7f6684201c2cb2d5bafa))
* **mcp:** add fixed positioning and z-index to MCP modal container ([afe8f8f](https://github.com/chadbyte/clay/commit/afe8f8f6251d7f70c465f03e3e9a88a6c9bff346)), closes [#mcp-modal](https://github.com/chadbyte/clay/issues/mcp-modal)
* **mcp:** match extension message type and relay hostConnected ([937b87c](https://github.com/chadbyte/clay/commit/937b87c6d254232ca20769a67435c13df0c98edc))
* **mcp:** match tool result type from extension relay ([6f8c2a3](https://github.com/chadbyte/clay/commit/6f8c2a367980be2b2bee97050e505ff2924ef804))
* **mcp:** wire onGetProjectMcpServers and onSetProjectMcpServers ([f2678da](https://github.com/chadbyte/clay/commit/f2678da663bb89591dc441f23b0a254878b85181))
* **native-host:** inject full PATH when spawning MCP processes ([eb6ca46](https://github.com/chadbyte/clay/commit/eb6ca466193a5c62d402e6c67693136dbe41a1d3))
* **native-host:** spawn server process after adding to config ([e22f088](https://github.com/chadbyte/clay/commit/e22f088b12254c6958536680c9d58a5758241407))
* **scheduler:** queue deferred triggers instead of dropping them ([a383926](https://github.com/chadbyte/clay/commit/a38392673b871d63d2649858badaed8db6f64029)), closes [#254](https://github.com/chadbyte/clay/issues/254)
* **sdk:** disable hooks during warmup queries ([d2f6c7e](https://github.com/chadbyte/clay/commit/d2f6c7ecf0eac585346ebd5c9276606407181a9a)), closes [#316](https://github.com/chadbyte/clay/issues/316)


### Features

* **loop:** add Model tab to preview modal for pre-launch settings ([81089d8](https://github.com/chadbyte/clay/commit/81089d8229a0592e32597d190c120dfaae02cd66))
* **loop:** support per-loop SDK settings overrides via LOOP.json ([159196a](https://github.com/chadbyte/clay/commit/159196a4cd6aa4356a46db51a9026a2687161a0a)), closes [#248](https://github.com/chadbyte/clay/issues/248)
* **loop:** unlock coder session for interaction after loop finishes ([184a7a3](https://github.com/chadbyte/clay/commit/184a7a3fe8e8f3febffcad24a4ed33f0838d584c)), closes [#314](https://github.com/chadbyte/clay/issues/314)
* **mcp-ui:** show extension install CTA when not connected ([c961c56](https://github.com/chadbyte/clay/commit/c961c561129e9d83be30d19c97379c4fa851d97e))
* **mcp:** add local MCP process management for localhost clients ([43a0f1a](https://github.com/chadbyte/clay/commit/43a0f1a7583fb884bc19321406ab21382454929e))
* **mcp:** add setup wizard and install-mcp endpoint ([60a1449](https://github.com/chadbyte/clay/commit/60a1449d9282d22e2bb6f950bf7597c6da78d779))
* **mcp:** implement MCP bridge for remote MCP servers via Chrome Extension ([e6349f2](https://github.com/chadbyte/clay/commit/e6349f217608e7868ef7a6cf2e255947faf9fbe0))
* **native-host:** add config CRUD and external config import ([e8a1537](https://github.com/chadbyte/clay/commit/e8a1537dc570b4935968c54de7b7844b0be0cbf2))
* **native-host:** auto-start servers on startup ([5518c4e](https://github.com/chadbyte/clay/commit/5518c4e46a2b1ca6f5ebbd56695ee947b5284b2d))
* **scheduler:** add inline editing for PROMPT.md and JUDGE.md ([261a955](https://github.com/chadbyte/clay/commit/261a955cb165cedb4cf8d864efa98f1f6ea47a4e)), closes [#313](https://github.com/chadbyte/clay/issues/313)

# [2.28.0-beta.3](https://github.com/chadbyte/clay/compare/v2.28.0-beta.2...v2.28.0-beta.3) (2026-04-15)


### Bug Fixes

* **sdk:** disable hooks during warmup queries ([d2f6c7e](https://github.com/chadbyte/clay/commit/d2f6c7ecf0eac585346ebd5c9276606407181a9a)), closes [#316](https://github.com/chadbyte/clay/issues/316)

# [2.28.0-beta.2](https://github.com/chadbyte/clay/compare/v2.28.0-beta.1...v2.28.0-beta.2) (2026-04-15)


### Bug Fixes

* **browser:** use shared mutable browserState object ([9520f7b](https://github.com/chadbyte/clay/commit/9520f7b983e09ac3cc926ff81ff6bf14b2edc2b9))
* **mcp-ui:** minor wording tweak in setup wizard step 2 ([240e285](https://github.com/chadbyte/clay/commit/240e285c19b9f9b8136bc7f45701aa0efaaa712a))
* **mcp-ui:** optimistic toggle with cooldown to prevent revert ([5a3729e](https://github.com/chadbyte/clay/commit/5a3729ed4eeac39a22f967901fb11d6ab329b9f5))
* **mcp-ui:** update step 3 guide to point to extension popup ([a97d1e2](https://github.com/chadbyte/clay/commit/a97d1e23ccb16b9f0216bb5dee7ec36db84ade44))
* **mcp:** add display:none rule for hidden MCP modal ([e5b1066](https://github.com/chadbyte/clay/commit/e5b10663b57e7a8b49ba7f6684201c2cb2d5bafa))
* **mcp:** add fixed positioning and z-index to MCP modal container ([afe8f8f](https://github.com/chadbyte/clay/commit/afe8f8f6251d7f70c465f03e3e9a88a6c9bff346)), closes [#mcp-modal](https://github.com/chadbyte/clay/issues/mcp-modal)
* **mcp:** match extension message type and relay hostConnected ([937b87c](https://github.com/chadbyte/clay/commit/937b87c6d254232ca20769a67435c13df0c98edc))
* **mcp:** match tool result type from extension relay ([6f8c2a3](https://github.com/chadbyte/clay/commit/6f8c2a367980be2b2bee97050e505ff2924ef804))
* **mcp:** wire onGetProjectMcpServers and onSetProjectMcpServers ([f2678da](https://github.com/chadbyte/clay/commit/f2678da663bb89591dc441f23b0a254878b85181))
* **native-host:** inject full PATH when spawning MCP processes ([eb6ca46](https://github.com/chadbyte/clay/commit/eb6ca466193a5c62d402e6c67693136dbe41a1d3))
* **native-host:** spawn server process after adding to config ([e22f088](https://github.com/chadbyte/clay/commit/e22f088b12254c6958536680c9d58a5758241407))


### Features

* **mcp-ui:** show extension install CTA when not connected ([c961c56](https://github.com/chadbyte/clay/commit/c961c561129e9d83be30d19c97379c4fa851d97e))
* **mcp:** add local MCP process management for localhost clients ([43a0f1a](https://github.com/chadbyte/clay/commit/43a0f1a7583fb884bc19321406ab21382454929e))
* **mcp:** add setup wizard and install-mcp endpoint ([60a1449](https://github.com/chadbyte/clay/commit/60a1449d9282d22e2bb6f950bf7597c6da78d779))
* **mcp:** implement MCP bridge for remote MCP servers via Chrome Extension ([e6349f2](https://github.com/chadbyte/clay/commit/e6349f217608e7868ef7a6cf2e255947faf9fbe0))
* **native-host:** add config CRUD and external config import ([e8a1537](https://github.com/chadbyte/clay/commit/e8a1537dc570b4935968c54de7b7844b0be0cbf2))
* **native-host:** auto-start servers on startup ([5518c4e](https://github.com/chadbyte/clay/commit/5518c4e46a2b1ca6f5ebbd56695ee947b5284b2d))

# [2.28.0-beta.1](https://github.com/chadbyte/clay/compare/v2.27.1...v2.28.0-beta.1) (2026-04-15)


### Bug Fixes

* **mates:** support single-user mode by synthesizing default userId ([66d3759](https://github.com/chadbyte/clay/commit/66d37596fede13f914ce616bca6e88e2c78a75be)), closes [#315](https://github.com/chadbyte/clay/issues/315)
* **scheduler:** queue deferred triggers instead of dropping them ([a383926](https://github.com/chadbyte/clay/commit/a38392673b871d63d2649858badaed8db6f64029)), closes [#254](https://github.com/chadbyte/clay/issues/254)


### Features

* **loop:** add Model tab to preview modal for pre-launch settings ([81089d8](https://github.com/chadbyte/clay/commit/81089d8229a0592e32597d190c120dfaae02cd66))
* **loop:** support per-loop SDK settings overrides via LOOP.json ([159196a](https://github.com/chadbyte/clay/commit/159196a4cd6aa4356a46db51a9026a2687161a0a)), closes [#248](https://github.com/chadbyte/clay/issues/248)
* **loop:** unlock coder session for interaction after loop finishes ([184a7a3](https://github.com/chadbyte/clay/commit/184a7a3fe8e8f3febffcad24a4ed33f0838d584c)), closes [#314](https://github.com/chadbyte/clay/issues/314)
* **scheduler:** add inline editing for PROMPT.md and JUDGE.md ([261a955](https://github.com/chadbyte/clay/commit/261a955cb165cedb4cf8d864efa98f1f6ea47a4e)), closes [#313](https://github.com/chadbyte/clay/issues/313)

## [2.27.1](https://github.com/chadbyte/clay/compare/v2.27.0...v2.27.1) (2026-04-14)


### Bug Fixes

* **auth:** prevent PIN input clearing on re-entrant input events ([0392518](https://github.com/chadbyte/clay/commit/0392518a9bdf75696ba03d3b250a896717e11e40))

## [2.27.1-beta.1](https://github.com/chadbyte/clay/compare/v2.27.0...v2.27.1-beta.1) (2026-04-14)


### Bug Fixes

* **auth:** prevent PIN input clearing on re-entrant input events ([0392518](https://github.com/chadbyte/clay/commit/0392518a9bdf75696ba03d3b250a896717e11e40))

# [2.27.0](https://github.com/chadbyte/clay/compare/v2.26.0...v2.27.0) (2026-04-14)


### Bug Fixes

* **api:** restrict health endpoint details to authenticated requests ([08aa2b3](https://github.com/chadbyte/clay/commit/08aa2b39c7590d1d01212ea69a8761f36cdceab8))
* **app:** add missing DM delegation stubs ([2f0a041](https://github.com/chadbyte/clay/commit/2f0a0412e05ed6b417fc4d97053f6fbeed8139cd))
* **app:** add missing headerInfoBtn to initHeader context ([8d0a092](https://github.com/chadbyte/clay/commit/8d0a0926233ebf411266e5cc74ff7514302ec91f))
* **app:** correct DM delegation stub signatures ([4fdf4e4](https://github.com/chadbyte/clay/commit/4fdf4e4fc9d2eab478dbd04d70008bfe629219c1))
* **app:** inline requireClayRalph for scheduler context ([fd2c804](https://github.com/chadbyte/clay/commit/fd2c804622673a5ef61ca3bf47609b51e7e71059))
* **chat:** add missing _ts to user messages and show dates in command palette ([0350110](https://github.com/chadbyte/clay/commit/0350110fb2ff0bad2f8b1a3043e2fd5235583273))
* **client:** guard notification permission and fix loadingMore accessor ([6ce2f06](https://github.com/chadbyte/clay/commit/6ce2f06ae3350df1dbf22a6b91c793a07447b780))
* **debate:** add mate avatars to brief review card ([3170394](https://github.com/chadbyte/clay/commit/3170394cfbf30ef4e6a5deebabcc0157fdad673a))
* **debate:** persist debate_turn and debate_stream to session history ([2e323e8](https://github.com/chadbyte/clay/commit/2e323e84a6c1860f62b44ba299f72d4fb6d9bba2))
* **debate:** prevent floor and conclude messages from routing to normal chat ([a49747d](https://github.com/chadbyte/clay/commit/a49747dbd1ef936bb49009e792bda4eb0bab60de))
* **debate:** send brief_ready to setup session in quickStart flow ([9b93e5a](https://github.com/chadbyte/clay/commit/9b93e5ae4f747e83dc717ce8ce64783c60dfdeb4))
* **debate:** share debate state with setup session in quickStart ([e142a77](https://github.com/chadbyte/clay/commit/e142a778fb6576344b9bcd332b3e1316f99382ec))
* **debate:** show visual feedback when stop button is clicked ([75d91a1](https://github.com/chadbyte/clay/commit/75d91a1ef6354bbe7f1e727f37ac6f94c66cf43a))
* **debate:** suppress interactive debate UI during history replay ([cd60178](https://github.com/chadbyte/clay/commit/cd601789d44243358d8d60b55102c66b2e289440))
* **dm:** route same-mate mention as regular message in mate DM ([776468f](https://github.com/chadbyte/clay/commit/776468f6902bb1fd4ce0fbefce704d3595a03625))
* **header:** use property setter for historyFrom instead of missing function ([a68575e](https://github.com/chadbyte/clay/commit/a68575e1075ea3893b806b7b3ab1c76ec2d544a6))
* honor bypassPermissions mode in Clay canUseTool handlers ([c933ee7](https://github.com/chadbyte/clay/commit/c933ee7de67e87dd78dd1659356d31a9aa89e8d3))
* **mobile:** add import session button to mobile chat sheet ([406f40d](https://github.com/chadbyte/clay/commit/406f40dfd87c2398c1bcdaf9480c1bff6f2dd081)), closes [#312](https://github.com/chadbyte/clay/issues/312)
* pass getOsUserInfoForWs to project-user-message ctx ([ea2fc66](https://github.com/chadbyte/clay/commit/ea2fc66fed07d215212b79b233763764be13e876))
* pass mcpServers to createMentionSession query options ([6c6ad09](https://github.com/chadbyte/clay/commit/6c6ad096cfd80d49662267d9d3374324c2326855))
* pass ownerId on project create/add, filter mate project list by access ([397525d](https://github.com/chadbyte/clay/commit/397525d8b33a9ce95601f37c86cb41cc5405e8ca))
* pass requestTabContext to project-user-message ctx ([c845ed8](https://github.com/chadbyte/clay/commit/c845ed896d410b84bf32325fb8eaedb2aa224c00))
* reap idle in-process sessions to prevent Claude child process accumulation ([8090251](https://github.com/chadbyte/clay/commit/8090251fe0d2c12b39f0a20b9278ed7f32b7b097))
* **sdk-bridge:** handle api_retry system events instead of showing red "unknown" text ([ade5385](https://github.com/chadbyte/clay/commit/ade5385ff0484796b5965ff7ed41ffbe14b0bcd5)), closes [#311](https://github.com/chadbyte/clay/issues/311)
* use shared checkToolWhitelist in mention session canUseTool ([594c277](https://github.com/chadbyte/clay/commit/594c277d4479ba3dcd9e252c0009ded65b0bfe9b))


### Features

* **api:** add GET /api/health endpoint for monitoring ([103513d](https://github.com/chadbyte/clay/commit/103513d4ce9f127ce834ba374e59d99441cf7d96))
* **loop:** redesign wizard with explicit mode selection and authorship toggles ([ccd9084](https://github.com/chadbyte/clay/commit/ccd9084b673a9015068bdd55657bbd14a0b1075b))
* **notifications:** add notification center with banner system ([09b40cb](https://github.com/chadbyte/clay/commit/09b40cb2aa5b930f0c23f309ceafae0867ff2d6d))
* **projects:** allow admin to add existing directory in multi-user mode ([7b31633](https://github.com/chadbyte/clay/commit/7b3163325b87e3a68233a6990d50cb427eaa35f4))
* **ui:** show dates on chat messages and search results ([70bbeb2](https://github.com/chadbyte/clay/commit/70bbeb2c61fc9320b5560d6a648193a3fb9d71ae))


### Performance Improvements

* **ui:** skip redundant re-renders of mate icon strip and presence bars ([dd0cd2f](https://github.com/chadbyte/clay/commit/dd0cd2f2cab5517098f9b5cb70835dadbda410e7))

# [2.27.0-beta.18](https://github.com/chadbyte/clay/compare/v2.27.0-beta.17...v2.27.0-beta.18) (2026-04-14)


### Performance Improvements

* **ui:** skip redundant re-renders of mate icon strip and presence bars ([dd0cd2f](https://github.com/chadbyte/clay/commit/dd0cd2f2cab5517098f9b5cb70835dadbda410e7))

# [2.27.0-beta.17](https://github.com/chadbyte/clay/compare/v2.27.0-beta.16...v2.27.0-beta.17) (2026-04-14)


### Bug Fixes

* **chat:** add missing _ts to user messages and show dates in command palette ([0350110](https://github.com/chadbyte/clay/commit/0350110fb2ff0bad2f8b1a3043e2fd5235583273))


### Features

* **loop:** redesign wizard with explicit mode selection and authorship toggles ([ccd9084](https://github.com/chadbyte/clay/commit/ccd9084b673a9015068bdd55657bbd14a0b1075b))
* **notifications:** add notification center with banner system ([09b40cb](https://github.com/chadbyte/clay/commit/09b40cb2aa5b930f0c23f309ceafae0867ff2d6d))
* **ui:** show dates on chat messages and search results ([70bbeb2](https://github.com/chadbyte/clay/commit/70bbeb2c61fc9320b5560d6a648193a3fb9d71ae))

# [2.27.0-beta.16](https://github.com/chadbyte/clay/compare/v2.27.0-beta.15...v2.27.0-beta.16) (2026-04-13)


### Bug Fixes

* **mobile:** add import session button to mobile chat sheet ([406f40d](https://github.com/chadbyte/clay/commit/406f40dfd87c2398c1bcdaf9480c1bff6f2dd081)), closes [#312](https://github.com/chadbyte/clay/issues/312)

# [2.27.0-beta.15](https://github.com/chadbyte/clay/compare/v2.27.0-beta.14...v2.27.0-beta.15) (2026-04-12)


### Bug Fixes

* honor bypassPermissions mode in Clay canUseTool handlers ([c933ee7](https://github.com/chadbyte/clay/commit/c933ee7de67e87dd78dd1659356d31a9aa89e8d3))

# [2.27.0-beta.14](https://github.com/chadbyte/clay/compare/v2.27.0-beta.13...v2.27.0-beta.14) (2026-04-12)


### Bug Fixes

* **client:** guard notification permission and fix loadingMore accessor ([6ce2f06](https://github.com/chadbyte/clay/commit/6ce2f06ae3350df1dbf22a6b91c793a07447b780))
* **dm:** route same-mate mention as regular message in mate DM ([776468f](https://github.com/chadbyte/clay/commit/776468f6902bb1fd4ce0fbefce704d3595a03625))
* **header:** use property setter for historyFrom instead of missing function ([a68575e](https://github.com/chadbyte/clay/commit/a68575e1075ea3893b806b7b3ab1c76ec2d544a6))
* **sdk-bridge:** handle api_retry system events instead of showing red "unknown" text ([ade5385](https://github.com/chadbyte/clay/commit/ade5385ff0484796b5965ff7ed41ffbe14b0bcd5)), closes [#311](https://github.com/chadbyte/clay/issues/311)


### Features

* **projects:** allow admin to add existing directory in multi-user mode ([7b31633](https://github.com/chadbyte/clay/commit/7b3163325b87e3a68233a6990d50cb427eaa35f4))

# [2.27.0-beta.13](https://github.com/chadbyte/clay/compare/v2.27.0-beta.12...v2.27.0-beta.13) (2026-04-11)


### Bug Fixes

* reap idle in-process sessions to prevent Claude child process accumulation ([8090251](https://github.com/chadbyte/clay/commit/8090251fe0d2c12b39f0a20b9278ed7f32b7b097))

# [2.27.0-beta.12](https://github.com/chadbyte/clay/compare/v2.27.0-beta.11...v2.27.0-beta.12) (2026-04-10)


### Bug Fixes

* **app:** add missing DM delegation stubs ([2f0a041](https://github.com/chadbyte/clay/commit/2f0a0412e05ed6b417fc4d97053f6fbeed8139cd))
* **app:** add missing headerInfoBtn to initHeader context ([8d0a092](https://github.com/chadbyte/clay/commit/8d0a0926233ebf411266e5cc74ff7514302ec91f))
* **app:** correct DM delegation stub signatures ([4fdf4e4](https://github.com/chadbyte/clay/commit/4fdf4e4fc9d2eab478dbd04d70008bfe629219c1))
* **app:** inline requireClayRalph for scheduler context ([fd2c804](https://github.com/chadbyte/clay/commit/fd2c804622673a5ef61ca3bf47609b51e7e71059))

# [2.27.0-beta.11](https://github.com/chadbyte/clay/compare/v2.27.0-beta.10...v2.27.0-beta.11) (2026-04-10)


### Bug Fixes

* pass ownerId on project create/add, filter mate project list by access ([397525d](https://github.com/chadbyte/clay/commit/397525d8b33a9ce95601f37c86cb41cc5405e8ca))

# [2.27.0-beta.10](https://github.com/chadbyte/clay/compare/v2.27.0-beta.9...v2.27.0-beta.10) (2026-04-10)


### Bug Fixes

* **debate:** show visual feedback when stop button is clicked ([75d91a1](https://github.com/chadbyte/clay/commit/75d91a1ef6354bbe7f1e727f37ac6f94c66cf43a))

# [2.27.0-beta.9](https://github.com/chadbyte/clay/compare/v2.27.0-beta.8...v2.27.0-beta.9) (2026-04-10)


### Bug Fixes

* **debate:** persist debate_turn and debate_stream to session history ([2e323e8](https://github.com/chadbyte/clay/commit/2e323e84a6c1860f62b44ba299f72d4fb6d9bba2))

# [2.27.0-beta.8](https://github.com/chadbyte/clay/compare/v2.27.0-beta.7...v2.27.0-beta.8) (2026-04-10)


### Bug Fixes

* **debate:** add mate avatars to brief review card ([3170394](https://github.com/chadbyte/clay/commit/3170394cfbf30ef4e6a5deebabcc0157fdad673a))
* **debate:** share debate state with setup session in quickStart ([e142a77](https://github.com/chadbyte/clay/commit/e142a778fb6576344b9bcd332b3e1316f99382ec))

# [2.27.0-beta.7](https://github.com/chadbyte/clay/compare/v2.27.0-beta.6...v2.27.0-beta.7) (2026-04-10)


### Bug Fixes

* **debate:** send brief_ready to setup session in quickStart flow ([9b93e5a](https://github.com/chadbyte/clay/commit/9b93e5ae4f747e83dc717ce8ce64783c60dfdeb4))

# [2.27.0-beta.6](https://github.com/chadbyte/clay/compare/v2.27.0-beta.5...v2.27.0-beta.6) (2026-04-10)


### Bug Fixes

* use shared checkToolWhitelist in mention session canUseTool ([594c277](https://github.com/chadbyte/clay/commit/594c277d4479ba3dcd9e252c0009ded65b0bfe9b))

# [2.27.0-beta.5](https://github.com/chadbyte/clay/compare/v2.27.0-beta.4...v2.27.0-beta.5) (2026-04-10)


### Bug Fixes

* **api:** restrict health endpoint details to authenticated requests ([08aa2b3](https://github.com/chadbyte/clay/commit/08aa2b39c7590d1d01212ea69a8761f36cdceab8))

# [2.27.0-beta.4](https://github.com/chadbyte/clay/compare/v2.27.0-beta.3...v2.27.0-beta.4) (2026-04-10)


### Bug Fixes

* pass mcpServers to createMentionSession query options ([6c6ad09](https://github.com/chadbyte/clay/commit/6c6ad096cfd80d49662267d9d3374324c2326855))

# [2.27.0-beta.3](https://github.com/chadbyte/clay/compare/v2.27.0-beta.2...v2.27.0-beta.3) (2026-04-10)


### Bug Fixes

* pass requestTabContext to project-user-message ctx ([c845ed8](https://github.com/chadbyte/clay/commit/c845ed896d410b84bf32325fb8eaedb2aa224c00))

# [2.27.0-beta.2](https://github.com/chadbyte/clay/compare/v2.27.0-beta.1...v2.27.0-beta.2) (2026-04-10)


### Bug Fixes

* pass getOsUserInfoForWs to project-user-message ctx ([ea2fc66](https://github.com/chadbyte/clay/commit/ea2fc66fed07d215212b79b233763764be13e876))

# [2.27.0-beta.1](https://github.com/chadbyte/clay/compare/v2.26.1-beta.1...v2.27.0-beta.1) (2026-04-10)


### Features

* **api:** add GET /api/health endpoint for monitoring ([103513d](https://github.com/chadbyte/clay/commit/103513d4ce9f127ce834ba374e59d99441cf7d96))

## [2.26.1-beta.1](https://github.com/chadbyte/clay/compare/v2.26.0...v2.26.1-beta.1) (2026-04-09)


### Bug Fixes

* **debate:** prevent floor and conclude messages from routing to normal chat ([a49747d](https://github.com/chadbyte/clay/commit/a49747dbd1ef936bb49009e792bda4eb0bab60de))
* **debate:** suppress interactive debate UI during history replay ([cd60178](https://github.com/chadbyte/clay/commit/cd601789d44243358d8d60b55102c66b2e289440))

# [2.26.0](https://github.com/chadbyte/clay/compare/v2.25.0...v2.26.0) (2026-04-09)


### Bug Fixes

* **auth:** default to private visibility in OS user mode ([7c271a2](https://github.com/chadbyte/clay/commit/7c271a20ec34300b4d86d60204712356e6dc2473))
* **browser:** prevent redundant MCP calls for context source tabs ([bc88feb](https://github.com/chadbyte/clay/commit/bc88febafbbfbd3d76efe3a8a2c47b07897375b4))
* **cli:** preserve ownerId and all config fields across daemon restarts ([a067478](https://github.com/chadbyte/clay/commit/a0674786d0b3a1a59d360b2ad26346c300f28f27))
* **debate:** broadcast correct mate processing indicator during debate turns ([6d875f4](https://github.com/chadbyte/clay/commit/6d875f4be8a68c91a3e493c3533ce1f9ccf51f14))
* **debate:** clear stale debate state on restart instead of restoring dead UI ([868a7e5](https://github.com/chadbyte/clay/commit/868a7e5365a533bda9d50e3f93f7ee4fbf486d9e))
* **debate:** fix MCP proposal card rendering and debate start ([b99bcfd](https://github.com/chadbyte/clay/commit/b99bcfd89466b7ddc90b92fae7369f0c9134184c))
* **debate:** hide export PDF button when debate is not active ([ffa28ca](https://github.com/chadbyte/clay/commit/ffa28caf4011e2d1bb7efd1b033b4c6404cb171f)), closes [#debate-pdf-btn](https://github.com/chadbyte/clay/issues/debate-pdf-btn)
* **debate:** hide internal setup prompt from chat display ([c40e8d7](https://github.com/chadbyte/clay/commit/c40e8d706bd4778fc49527af9b1dfc5a7c821db5))
* **debate:** prevent debate ended banner from persisting across sessions ([75802d6](https://github.com/chadbyte/clay/commit/75802d652da7462b08c49d94b4482d844cde8a6d))
* **debate:** propagate ownerId to debate sessions and restore with correct userId ([fb85137](https://github.com/chadbyte/clay/commit/fb85137a8178759aa13d266714f928cecc11aae3))
* **debate:** restore self-contained conclude bar to prevent normal chat routing ([ce24dbc](https://github.com/chadbyte/clay/commit/ce24dbc7d17650256e4733e5a2ecada2a80f2397))
* **debate:** show bottom bar on mobile during live debate ([2623855](https://github.com/chadbyte/clay/commit/262385522f0d782ee0363aaa45ff4af094390b19))
* **debate:** show review card for quickStart flow, share tool whitelist with mentions ([1cf1ccd](https://github.com/chadbyte/clay/commit/1cf1ccd2cba716135ae11a4533bf71553dea0dd1))
* **mate:** sync avatar and profile in chat on mate_updated ([3335e72](https://github.com/chadbyte/clay/commit/3335e7210308e7006e65d10499b3da952ae67173))
* **mention:** maintain chronological order when permission requests interrupt mention stream ([b48d9de](https://github.com/chadbyte/clay/commit/b48d9debcab26d1392ca51e9b051ec0a6d2d5229))
* **mobile:** refresh mobile chat sheet when mate session list updates ([5530f0b](https://github.com/chadbyte/clay/commit/5530f0bba99e048a0cc4dbf24e050e038cc2748d))
* **os-users:** enable systemd linger for clay users to create XDG_RUNTIME_DIR ([e4a824d](https://github.com/chadbyte/clay/commit/e4a824dd3afb564e87bc181b24dff14da75eb0ba))
* **pdf:** strip all external SVG references to prevent tainted canvas ([6540405](https://github.com/chadbyte/clay/commit/6540405e963b469af92ca332c267b64e44d72f9d))
* reduce auto-continue buffer from 3min to 1min after rate limit reset ([b48053b](https://github.com/chadbyte/clay/commit/b48053b8115cf21f19a1a4933ec45e0b191425b4))
* **rewind:** harden rewind against race conditions ([502e904](https://github.com/chadbyte/clay/commit/502e904ae709babfce9a582c73bd4b5c74253df8))
* **sdk-bridge:** add auto-continue to worker query_done handler ([b0ea29f](https://github.com/chadbyte/clay/commit/b0ea29ff5e33440606f627cb2f361b5a00e8b3ac))
* **sdk-bridge:** harden auto-continue against rate limit event timing ([651019b](https://github.com/chadbyte/clay/commit/651019b34b90860996944e2d34a02ec66e59b942))
* **sdk-bridge:** preserve rateLimitResetsAt for auto-continue scheduling ([7fe1b6a](https://github.com/chadbyte/clay/commit/7fe1b6a9fcf03c8787236af9b32c8eacfe4d0a41))
* **sdk-bridge:** schedule auto-continue immediately on rate limit rejection ([a55055c](https://github.com/chadbyte/clay/commit/a55055c7492408863977f9a07faec154d717858f))
* **session:** persist all sessions and show debates in conversation list ([cf0a935](https://github.com/chadbyte/clay/commit/cf0a9351427f1ede853e5881f337a3a5fc6570df))
* **session:** revert auto-generated cliSessionId that broke new session queries ([4cb949e](https://github.com/chadbyte/clay/commit/4cb949eba1ecd3aa4045adc86853386fe68f4eed))
* **sessions:** use atomic writes for session files ([30ea57c](https://github.com/chadbyte/clay/commit/30ea57c394c015bfd50b5ffa05e494f796238090))
* show actual send time in scheduled message bubble instead of reset time ([0b13ce0](https://github.com/chadbyte/clay/commit/0b13ce0ce2e6ba6bacd02b201118fa6e063d9b85))
* **sidebar:** render mates in user strip when no other human users exist ([#277](https://github.com/chadbyte/clay/issues/277)) ([b7a8980](https://github.com/chadbyte/clay/commit/b7a8980d4f67ac8e7478bb148bf75e57cdc71f90))
* **terminal:** add WebGL renderer and fix overflow clipping ([2f2db6d](https://github.com/chadbyte/clay/commit/2f2db6d0054af5bf0bf4f7a8905b946264b4cec9))
* **terminal:** load WebGL addon after xterm.open() ([56ce8b4](https://github.com/chadbyte/clay/commit/56ce8b4b92188c7afed2518d5537a041e418f5fc))
* **terminal:** prevent observers from resizing PTY and causing escape flood ([f5b79fd](https://github.com/chadbyte/clay/commit/f5b79fd71da32c63ccb4edb73309eeae00610ca5))
* **ui:** move suggestion chips inside input row ([#287](https://github.com/chadbyte/clay/issues/287)) ([9b01144](https://github.com/chadbyte/clay/commit/9b01144d22484d84613761d6386b2b8d47288606))
* **ui:** resolve identity reference error in AskUserQuestion rendering ([ef8b915](https://github.com/chadbyte/clay/commit/ef8b915bd249c5bea383ab113686427d7cc22265))
* **upload:** preserve Unicode/CJK characters in uploaded filenames ([#286](https://github.com/chadbyte/clay/issues/286)) ([b316b48](https://github.com/chadbyte/clay/commit/b316b48453725ab92756cca0fb9e5757f1d333cf))
* **usage:** handle SDK restart causing negative cost delta ([15e5553](https://github.com/chadbyte/clay/commit/15e5553692998ff118d27b2d122abd9f5301ca15))
* **usage:** stop overcounting session cost by 15x ([1b733f5](https://github.com/chadbyte/clay/commit/1b733f546ba172ca1ab1cec27b8429969cc87718))
* **usage:** stop resetting cumulative cost tracker between turns ([2c5ea11](https://github.com/chadbyte/clay/commit/2c5ea117e7cbdd685da3ded3b599eeb16e322261))


### Features

* **browser:** add Browser MCP server and extension HTTP bridge ([cbf32f3](https://github.com/chadbyte/clay/commit/cbf32f315ba1ae67c375ccf4a16742f0faec8bf2))
* **browser:** add tab context injection and context preview cards ([4009368](https://github.com/chadbyte/clay/commit/40093681696578976c95ab179a88c714888d8816))
* **browser:** auto-approve watch/unwatch tab MCP tools ([155244e](https://github.com/chadbyte/clay/commit/155244e7c6a2a88863f2aeac148a074d63a541e8))
* **browser:** switch to in-process MCP server and add watch/unwatch tools ([5322707](https://github.com/chadbyte/clay/commit/5322707fdee172680fd8f2d458ee37eac6136fa7))
* Context Sources UI + Chat Project plan ([#284](https://github.com/chadbyte/clay/issues/284)) ([a4da2cf](https://github.com/chadbyte/clay/commit/a4da2cfbfd77ca614732b2a5f2c81f29e7e9bcf2))
* **context-sources:** show extension setup prompt in browser tabs section ([2dee8c5](https://github.com/chadbyte/clay/commit/2dee8c51fae7fff2d83f1824baace7bf0ddee5df))
* **context:** add rich context usage popover on header bar hover ([a59194c](https://github.com/chadbyte/clay/commit/a59194c662a8f660e6b2608517c29b8bfd875cf5))
* **debate:** add propose_debate MCP tool for inline debate proposals ([0298972](https://github.com/chadbyte/clay/commit/0298972b68d74cd648175ef4cb73b19c23e1f8ec))
* **debate:** convert debate modal to wizard with quick start flow ([e4dfa8b](https://github.com/chadbyte/clay/commit/e4dfa8b127b3722e35e6f57566ae0ba3c81bd924))
* **debate:** rework hand raise, conclude, and floor modes ([4d10bf3](https://github.com/chadbyte/clay/commit/4d10bf38795263ba08beae77057461eb377e2f2d))
* **extension:** add Chrome extension download and install UI in top bar ([c3a9869](https://github.com/chadbyte/clay/commit/c3a986918ba421fd82ee1a3abd4025dd9d968246))
* **mates:** broadcast mention processing indicator and redesign mate avatars ([2f41e49](https://github.com/chadbyte/clay/commit/2f41e49fd06c7a55a6b0ccb82c6b4c8ed5b2be92)), closes [#283](https://github.com/chadbyte/clay/issues/283)
* **mobile:** add all mate tools to mobile tools sheet ([bab0295](https://github.com/chadbyte/clay/commit/bab0295f909e312aeefa435da3a95ad3f5f50b48))
* **sdk-bridge:** immediate continue on overage, scheduled on normal limit ([12fef73](https://github.com/chadbyte/clay/commit/12fef73d8b3d3b0b8830686708537057d83f12c1))
* **ui:** group consecutive messages by minute and preserve timestamps ([2cf9a69](https://github.com/chadbyte/clay/commit/2cf9a694d5b8bff3432f0fb6a1038bf7e5f91f47))
* **ui:** improve channel mode scheduled messages, input styling, and permission UX ([3dd7ab7](https://github.com/chadbyte/clay/commit/3dd7ab7eae09e7b40ad1a62d5e60f1342a691c79))
* **ui:** move debate to conversations and fix mobile chat sheet ([189562f](https://github.com/chadbyte/clay/commit/189562f03ea2efe60bde9f1d9daf4f720fc223ad))
* **ui:** replace thinking verb text with animated three dots ([235b3db](https://github.com/chadbyte/clay/commit/235b3dbad15725f94fc6fee1aa6a7d83fa2feb04))
* **usage:** show per-turn cost delta alongside cumulative total ([e638891](https://github.com/chadbyte/clay/commit/e6388912096cf446322c143e601c0cdafa7fb4ba))

# [2.26.0-beta.19](https://github.com/chadbyte/clay/compare/v2.26.0-beta.18...v2.26.0-beta.19) (2026-04-09)


### Bug Fixes

* **browser:** prevent redundant MCP calls for context source tabs ([bc88feb](https://github.com/chadbyte/clay/commit/bc88febafbbfbd3d76efe3a8a2c47b07897375b4))
* **debate:** prevent debate ended banner from persisting across sessions ([75802d6](https://github.com/chadbyte/clay/commit/75802d652da7462b08c49d94b4482d844cde8a6d))
* **terminal:** add WebGL renderer and fix overflow clipping ([2f2db6d](https://github.com/chadbyte/clay/commit/2f2db6d0054af5bf0bf4f7a8905b946264b4cec9))
* **terminal:** load WebGL addon after xterm.open() ([56ce8b4](https://github.com/chadbyte/clay/commit/56ce8b4b92188c7afed2518d5537a041e418f5fc))

# [2.26.0-beta.18](https://github.com/chadbyte/clay/compare/v2.26.0-beta.17...v2.26.0-beta.18) (2026-04-09)


### Bug Fixes

* **debate:** clear stale debate state on restart instead of restoring dead UI ([868a7e5](https://github.com/chadbyte/clay/commit/868a7e5365a533bda9d50e3f93f7ee4fbf486d9e))
* **debate:** fix MCP proposal card rendering and debate start ([b99bcfd](https://github.com/chadbyte/clay/commit/b99bcfd89466b7ddc90b92fae7369f0c9134184c))
* **debate:** show review card for quickStart flow, share tool whitelist with mentions ([1cf1ccd](https://github.com/chadbyte/clay/commit/1cf1ccd2cba716135ae11a4533bf71553dea0dd1))


### Features

* **debate:** add propose_debate MCP tool for inline debate proposals ([0298972](https://github.com/chadbyte/clay/commit/0298972b68d74cd648175ef4cb73b19c23e1f8ec))

# [2.26.0-beta.17](https://github.com/chadbyte/clay/compare/v2.26.0-beta.16...v2.26.0-beta.17) (2026-04-09)


### Bug Fixes

* show actual send time in scheduled message bubble instead of reset time ([0b13ce0](https://github.com/chadbyte/clay/commit/0b13ce0ce2e6ba6bacd02b201118fa6e063d9b85))

# [2.26.0-beta.16](https://github.com/chadbyte/clay/compare/v2.26.0-beta.15...v2.26.0-beta.16) (2026-04-09)


### Bug Fixes

* reduce auto-continue buffer from 3min to 1min after rate limit reset ([b48053b](https://github.com/chadbyte/clay/commit/b48053b8115cf21f19a1a4933ec45e0b191425b4))
* **sdk-bridge:** schedule auto-continue immediately on rate limit rejection ([a55055c](https://github.com/chadbyte/clay/commit/a55055c7492408863977f9a07faec154d717858f))


### Features

* **sdk-bridge:** immediate continue on overage, scheduled on normal limit ([12fef73](https://github.com/chadbyte/clay/commit/12fef73d8b3d3b0b8830686708537057d83f12c1))

# [2.26.0-beta.15](https://github.com/chadbyte/clay/compare/v2.26.0-beta.14...v2.26.0-beta.15) (2026-04-09)


### Bug Fixes

* **sdk-bridge:** add auto-continue to worker query_done handler ([b0ea29f](https://github.com/chadbyte/clay/commit/b0ea29ff5e33440606f627cb2f361b5a00e8b3ac))

# [2.26.0-beta.14](https://github.com/chadbyte/clay/compare/v2.26.0-beta.13...v2.26.0-beta.14) (2026-04-09)


### Bug Fixes

* **sdk-bridge:** preserve rateLimitResetsAt for auto-continue scheduling ([7fe1b6a](https://github.com/chadbyte/clay/commit/7fe1b6a9fcf03c8787236af9b32c8eacfe4d0a41))

# [2.26.0-beta.13](https://github.com/chadbyte/clay/compare/v2.26.0-beta.12...v2.26.0-beta.13) (2026-04-09)


### Bug Fixes

* **debate:** restore self-contained conclude bar to prevent normal chat routing ([ce24dbc](https://github.com/chadbyte/clay/commit/ce24dbc7d17650256e4733e5a2ecada2a80f2397))
* **session:** revert auto-generated cliSessionId that broke new session queries ([4cb949e](https://github.com/chadbyte/clay/commit/4cb949eba1ecd3aa4045adc86853386fe68f4eed))

# [2.26.0-beta.12](https://github.com/chadbyte/clay/compare/v2.26.0-beta.11...v2.26.0-beta.12) (2026-04-09)


### Bug Fixes

* **debate:** show bottom bar on mobile during live debate ([2623855](https://github.com/chadbyte/clay/commit/262385522f0d782ee0363aaa45ff4af094390b19))

# [2.26.0-beta.11](https://github.com/chadbyte/clay/compare/v2.26.0-beta.10...v2.26.0-beta.11) (2026-04-09)


### Bug Fixes

* **debate:** broadcast correct mate processing indicator during debate turns ([6d875f4](https://github.com/chadbyte/clay/commit/6d875f4be8a68c91a3e493c3533ce1f9ccf51f14))
* **debate:** propagate ownerId to debate sessions and restore with correct userId ([fb85137](https://github.com/chadbyte/clay/commit/fb85137a8178759aa13d266714f928cecc11aae3))


### Features

* **context-sources:** show extension setup prompt in browser tabs section ([2dee8c5](https://github.com/chadbyte/clay/commit/2dee8c51fae7fff2d83f1824baace7bf0ddee5df))

# [2.26.0-beta.10](https://github.com/chadbyte/clay/compare/v2.26.0-beta.9...v2.26.0-beta.10) (2026-04-09)


### Bug Fixes

* **debate:** hide export PDF button when debate is not active ([ffa28ca](https://github.com/chadbyte/clay/commit/ffa28caf4011e2d1bb7efd1b033b4c6404cb171f)), closes [#debate-pdf-btn](https://github.com/chadbyte/clay/issues/debate-pdf-btn)
* **debate:** hide internal setup prompt from chat display ([c40e8d7](https://github.com/chadbyte/clay/commit/c40e8d706bd4778fc49527af9b1dfc5a7c821db5))
* **mobile:** refresh mobile chat sheet when mate session list updates ([5530f0b](https://github.com/chadbyte/clay/commit/5530f0bba99e048a0cc4dbf24e050e038cc2748d))
* **sdk-bridge:** harden auto-continue against rate limit event timing ([651019b](https://github.com/chadbyte/clay/commit/651019b34b90860996944e2d34a02ec66e59b942))
* **session:** persist all sessions and show debates in conversation list ([cf0a935](https://github.com/chadbyte/clay/commit/cf0a9351427f1ede853e5881f337a3a5fc6570df))
* **ui:** resolve identity reference error in AskUserQuestion rendering ([ef8b915](https://github.com/chadbyte/clay/commit/ef8b915bd249c5bea383ab113686427d7cc22265))


### Features

* **debate:** convert debate modal to wizard with quick start flow ([e4dfa8b](https://github.com/chadbyte/clay/commit/e4dfa8b127b3722e35e6f57566ae0ba3c81bd924))
* **debate:** rework hand raise, conclude, and floor modes ([4d10bf3](https://github.com/chadbyte/clay/commit/4d10bf38795263ba08beae77057461eb377e2f2d))
* **mates:** broadcast mention processing indicator and redesign mate avatars ([2f41e49](https://github.com/chadbyte/clay/commit/2f41e49fd06c7a55a6b0ccb82c6b4c8ed5b2be92)), closes [#283](https://github.com/chadbyte/clay/issues/283)
* **ui:** group consecutive messages by minute and preserve timestamps ([2cf9a69](https://github.com/chadbyte/clay/commit/2cf9a694d5b8bff3432f0fb6a1038bf7e5f91f47))
* **ui:** move debate to conversations and fix mobile chat sheet ([189562f](https://github.com/chadbyte/clay/commit/189562f03ea2efe60bde9f1d9daf4f720fc223ad))

# [2.26.0-beta.9](https://github.com/chadbyte/clay/compare/v2.26.0-beta.8...v2.26.0-beta.9) (2026-04-08)


### Bug Fixes

* **auth:** default to private visibility in OS user mode ([7c271a2](https://github.com/chadbyte/clay/commit/7c271a20ec34300b4d86d60204712356e6dc2473))
* **mention:** maintain chronological order when permission requests interrupt mention stream ([b48d9de](https://github.com/chadbyte/clay/commit/b48d9debcab26d1392ca51e9b051ec0a6d2d5229))


### Features

* **browser:** auto-approve watch/unwatch tab MCP tools ([155244e](https://github.com/chadbyte/clay/commit/155244e7c6a2a88863f2aeac148a074d63a541e8))
* **ui:** improve channel mode scheduled messages, input styling, and permission UX ([3dd7ab7](https://github.com/chadbyte/clay/commit/3dd7ab7eae09e7b40ad1a62d5e60f1342a691c79))
* **ui:** replace thinking verb text with animated three dots ([235b3db](https://github.com/chadbyte/clay/commit/235b3dbad15725f94fc6fee1aa6a7d83fa2feb04))

# [2.26.0-beta.8](https://github.com/chadbyte/clay/compare/v2.26.0-beta.7...v2.26.0-beta.8) (2026-04-08)


### Bug Fixes

* **sidebar:** render mates in user strip when no other human users exist ([#277](https://github.com/chadbyte/clay/issues/277)) ([b7a8980](https://github.com/chadbyte/clay/commit/b7a8980d4f67ac8e7478bb148bf75e57cdc71f90))
* **upload:** preserve Unicode/CJK characters in uploaded filenames ([#286](https://github.com/chadbyte/clay/issues/286)) ([b316b48](https://github.com/chadbyte/clay/commit/b316b48453725ab92756cca0fb9e5757f1d333cf))

# [2.26.0-beta.7](https://github.com/chadbyte/clay/compare/v2.26.0-beta.6...v2.26.0-beta.7) (2026-04-08)


### Bug Fixes

* **ui:** move suggestion chips inside input row ([#287](https://github.com/chadbyte/clay/issues/287)) ([9b01144](https://github.com/chadbyte/clay/commit/9b01144d22484d84613761d6386b2b8d47288606))

# [2.26.0-beta.6](https://github.com/chadbyte/clay/compare/v2.26.0-beta.5...v2.26.0-beta.6) (2026-04-08)


### Features

* **browser:** add Browser MCP server and extension HTTP bridge ([cbf32f3](https://github.com/chadbyte/clay/commit/cbf32f315ba1ae67c375ccf4a16742f0faec8bf2))
* **browser:** add tab context injection and context preview cards ([4009368](https://github.com/chadbyte/clay/commit/40093681696578976c95ab179a88c714888d8816))
* **browser:** switch to in-process MCP server and add watch/unwatch tools ([5322707](https://github.com/chadbyte/clay/commit/5322707fdee172680fd8f2d458ee37eac6136fa7))
* **extension:** add Chrome extension download and install UI in top bar ([c3a9869](https://github.com/chadbyte/clay/commit/c3a986918ba421fd82ee1a3abd4025dd9d968246))

# [2.26.0-beta.5](https://github.com/chadbyte/clay/compare/v2.26.0-beta.4...v2.26.0-beta.5) (2026-04-08)


### Features

* **context:** add rich context usage popover on header bar hover ([a59194c](https://github.com/chadbyte/clay/commit/a59194c662a8f660e6b2608517c29b8bfd875cf5))

# [2.26.0-beta.4](https://github.com/chadbyte/clay/compare/v2.26.0-beta.3...v2.26.0-beta.4) (2026-04-08)


### Features

* Context Sources UI + Chat Project plan ([#284](https://github.com/chadbyte/clay/issues/284)) ([a4da2cf](https://github.com/chadbyte/clay/commit/a4da2cfbfd77ca614732b2a5f2c81f29e7e9bcf2))

# [2.26.0-beta.3](https://github.com/chadbyte/clay/compare/v2.26.0-beta.2...v2.26.0-beta.3) (2026-04-08)


### Bug Fixes

* **mate:** sync avatar and profile in chat on mate_updated ([3335e72](https://github.com/chadbyte/clay/commit/3335e7210308e7006e65d10499b3da952ae67173))
* **rewind:** harden rewind against race conditions ([502e904](https://github.com/chadbyte/clay/commit/502e904ae709babfce9a582c73bd4b5c74253df8))
* **sessions:** use atomic writes for session files ([30ea57c](https://github.com/chadbyte/clay/commit/30ea57c394c015bfd50b5ffa05e494f796238090))
* **usage:** handle SDK restart causing negative cost delta ([15e5553](https://github.com/chadbyte/clay/commit/15e5553692998ff118d27b2d122abd9f5301ca15))
* **usage:** stop overcounting session cost by 15x ([1b733f5](https://github.com/chadbyte/clay/commit/1b733f546ba172ca1ab1cec27b8429969cc87718))
* **usage:** stop resetting cumulative cost tracker between turns ([2c5ea11](https://github.com/chadbyte/clay/commit/2c5ea117e7cbdd685da3ded3b599eeb16e322261))


### Features

* **usage:** show per-turn cost delta alongside cumulative total ([e638891](https://github.com/chadbyte/clay/commit/e6388912096cf446322c143e601c0cdafa7fb4ba))

# [2.26.0-beta.2](https://github.com/chadbyte/clay/compare/v2.26.0-beta.1...v2.26.0-beta.2) (2026-04-07)


### Bug Fixes

* **cli:** preserve ownerId and all config fields across daemon restarts ([a067478](https://github.com/chadbyte/clay/commit/a0674786d0b3a1a59d360b2ad26346c300f28f27))
* **os-users:** enable systemd linger for clay users to create XDG_RUNTIME_DIR ([e4a824d](https://github.com/chadbyte/clay/commit/e4a824dd3afb564e87bc181b24dff14da75eb0ba))
* **terminal:** prevent observers from resizing PTY and causing escape flood ([f5b79fd](https://github.com/chadbyte/clay/commit/f5b79fd71da32c63ccb4edb73309eeae00610ca5))

# [2.26.0-beta.1](https://github.com/chadbyte/clay/compare/v2.25.1-beta.1...v2.26.0-beta.1) (2026-04-07)


### Features

* **mobile:** add all mate tools to mobile tools sheet ([bab0295](https://github.com/chadbyte/clay/commit/bab0295f909e312aeefa435da3a95ad3f5f50b48))

## [2.25.1-beta.1](https://github.com/chadbyte/clay/compare/v2.25.0...v2.25.1-beta.1) (2026-04-07)


### Bug Fixes

* **pdf:** strip all external SVG references to prevent tainted canvas ([6540405](https://github.com/chadbyte/clay/commit/6540405e963b469af92ca332c267b64e44d72f9d))

# [2.25.0](https://github.com/chadbyte/clay/compare/v2.24.4...v2.25.0) (2026-04-07)


### Bug Fixes

* **files:** allow cross-project file access in OS user mode via ACL ([4104410](https://github.com/chadbyte/clay/commit/410441000b8133f318ec0998e01b75f675e22492))
* **mates:** use --bg instead of undefined --bg-primary for dark mode ([de61303](https://github.com/chadbyte/clay/commit/de61303f2ebbee3ab8defd5c042c1ef1153341b7)), closes [#fff](https://github.com/chadbyte/clay/issues/fff)
* **pdf:** add font loading timeout and tainted canvas fallback ([fd5c4bb](https://github.com/chadbyte/clay/commit/fd5c4bb51102a53825694809f2bc738650c642ba))
* **pwa:** use absolute path for manifest and update deprecated meta tag ([1c76d2d](https://github.com/chadbyte/clay/commit/1c76d2dec745bc00e56687233f08ab050eec3081))
* **worker:** force-kill worker after abort timeout during subagent ([1a57ab7](https://github.com/chadbyte/clay/commit/1a57ab711092174650489c0c6c9177148f5747f3))


### Features

* **chat:** add sender attribution to user messages in multi-user sessions ([46a63fa](https://github.com/chadbyte/clay/commit/46a63fa1463e491bd1621599d8fa496fc60801c8))
* **dm:** add push notifications for incoming DM messages ([69bcb5f](https://github.com/chadbyte/clay/commit/69bcb5f23f4f04abe94298ee10d7d87fe3259e6a))

# [2.25.0-beta.2](https://github.com/chadbyte/clay/compare/v2.25.0-beta.1...v2.25.0-beta.2) (2026-04-07)


### Bug Fixes

* **pdf:** add font loading timeout and tainted canvas fallback ([fd5c4bb](https://github.com/chadbyte/clay/commit/fd5c4bb51102a53825694809f2bc738650c642ba))
* **pwa:** use absolute path for manifest and update deprecated meta tag ([1c76d2d](https://github.com/chadbyte/clay/commit/1c76d2dec745bc00e56687233f08ab050eec3081))

# [2.25.0-beta.1](https://github.com/chadbyte/clay/compare/v2.24.4...v2.25.0-beta.1) (2026-04-07)


### Bug Fixes

* **files:** allow cross-project file access in OS user mode via ACL ([4104410](https://github.com/chadbyte/clay/commit/410441000b8133f318ec0998e01b75f675e22492))
* **mates:** use --bg instead of undefined --bg-primary for dark mode ([de61303](https://github.com/chadbyte/clay/commit/de61303f2ebbee3ab8defd5c042c1ef1153341b7)), closes [#fff](https://github.com/chadbyte/clay/issues/fff)
* **worker:** force-kill worker after abort timeout during subagent ([1a57ab7](https://github.com/chadbyte/clay/commit/1a57ab711092174650489c0c6c9177148f5747f3))


### Features

* **chat:** add sender attribution to user messages in multi-user sessions ([46a63fa](https://github.com/chadbyte/clay/commit/46a63fa1463e491bd1621599d8fa496fc60801c8))
* **dm:** add push notifications for incoming DM messages ([69bcb5f](https://github.com/chadbyte/clay/commit/69bcb5f23f4f04abe94298ee10d7d87fe3259e6a))

## [2.24.4](https://github.com/chadbyte/clay/compare/v2.24.3...v2.24.4) (2026-04-07)


### Bug Fixes

* **home-hub:** exclude mate projects from projects list ([b47b256](https://github.com/chadbyte/clay/commit/b47b25667e2bb1c5f24360c664b09e8512d29ce2))

## [2.24.4-beta.1](https://github.com/chadbyte/clay/compare/v2.24.3...v2.24.4-beta.1) (2026-04-07)


### Bug Fixes

* **home-hub:** exclude mate projects from projects list ([b47b256](https://github.com/chadbyte/clay/commit/b47b25667e2bb1c5f24360c664b09e8512d29ce2))

## [2.24.3](https://github.com/chadbyte/clay/compare/v2.24.2...v2.24.3) (2026-04-07)


### Bug Fixes

* add chat layout toggle to mobile settings sheet ([8c8cc8c](https://github.com/chadbyte/clay/commit/8c8cc8c9bd4f7d699a2b6dc2229d2293cb5b840f))
* apply defaultMode to currentPermissionMode on connect, not after first query ([af2c226](https://github.com/chadbyte/clay/commit/af2c226a92e766e54325e4a0cfc6918b6b706cfe))
* apply defaultModel to currentModel on connect, not after first query ([cdb668b](https://github.com/chadbyte/clay/commit/cdb668b4925e4731b86d342eeb66e6f1fe1197e6)), closes [#271](https://github.com/chadbyte/clay/issues/271)
* **config:** initialize currentModel from savedDefaultModel on connect ([25dce40](https://github.com/chadbyte/clay/commit/25dce4098757685ade3ad7278a7dcae1c58bd027)), closes [#271](https://github.com/chadbyte/clay/issues/271)
* **hooks:** surface hook failure errors in UI instead of silent blank ([c5ea03c](https://github.com/chadbyte/clay/commit/c5ea03cd8b37796a8700ea865757d994446b3b52)), closes [#270](https://github.com/chadbyte/clay/issues/270)
* remove skeleton placeholders from icon-strip-users at startup ([1773bd5](https://github.com/chadbyte/clay/commit/1773bd591e99114992de44038c3a9d5072c4d02a)), closes [#272](https://github.com/chadbyte/clay/issues/272)
* **ui:** clear icon strip skeleton loaders in single-user mode ([59ec81d](https://github.com/chadbyte/clay/commit/59ec81d7fd3ba74005465e737a797bccf474c4e7)), closes [#272](https://github.com/chadbyte/clay/issues/272)
* **ui:** move unread badge to rightmost position in session list ([0e96888](https://github.com/chadbyte/clay/commit/0e9688891b5b312dfd00f257f0a412a3b94f3ab2))
* use /bin/sh as POSIX fallback shell instead of /bin/zsh ([95a25a0](https://github.com/chadbyte/clay/commit/95a25a04c13f097070cf98f81e7e46fd0c6772d5))

## [2.24.3-beta.5](https://github.com/chadbyte/clay/compare/v2.24.3-beta.4...v2.24.3-beta.5) (2026-04-07)


### Bug Fixes

* use /bin/sh as POSIX fallback shell instead of /bin/zsh ([95a25a0](https://github.com/chadbyte/clay/commit/95a25a04c13f097070cf98f81e7e46fd0c6772d5))

## [2.24.3-beta.4](https://github.com/chadbyte/clay/compare/v2.24.3-beta.3...v2.24.3-beta.4) (2026-04-07)


### Bug Fixes

* add chat layout toggle to mobile settings sheet ([8c8cc8c](https://github.com/chadbyte/clay/commit/8c8cc8c9bd4f7d699a2b6dc2229d2293cb5b840f))
* apply defaultMode to currentPermissionMode on connect, not after first query ([af2c226](https://github.com/chadbyte/clay/commit/af2c226a92e766e54325e4a0cfc6918b6b706cfe))
* apply defaultModel to currentModel on connect, not after first query ([cdb668b](https://github.com/chadbyte/clay/commit/cdb668b4925e4731b86d342eeb66e6f1fe1197e6)), closes [#271](https://github.com/chadbyte/clay/issues/271)

## [2.24.3-beta.3](https://github.com/chadbyte/clay/compare/v2.24.3-beta.2...v2.24.3-beta.3) (2026-04-07)


### Bug Fixes

* remove skeleton placeholders from icon-strip-users at startup ([1773bd5](https://github.com/chadbyte/clay/commit/1773bd591e99114992de44038c3a9d5072c4d02a)), closes [#272](https://github.com/chadbyte/clay/issues/272)

## [2.24.3-beta.2](https://github.com/chadbyte/clay/compare/v2.24.3-beta.1...v2.24.3-beta.2) (2026-04-07)


### Bug Fixes

* **config:** initialize currentModel from savedDefaultModel on connect ([25dce40](https://github.com/chadbyte/clay/commit/25dce4098757685ade3ad7278a7dcae1c58bd027)), closes [#271](https://github.com/chadbyte/clay/issues/271)
* **ui:** clear icon strip skeleton loaders in single-user mode ([59ec81d](https://github.com/chadbyte/clay/commit/59ec81d7fd3ba74005465e737a797bccf474c4e7)), closes [#272](https://github.com/chadbyte/clay/issues/272)
* **ui:** move unread badge to rightmost position in session list ([0e96888](https://github.com/chadbyte/clay/commit/0e9688891b5b312dfd00f257f0a412a3b94f3ab2))

## [2.24.3-beta.1](https://github.com/chadbyte/clay/compare/v2.24.2...v2.24.3-beta.1) (2026-04-07)


### Bug Fixes

* **hooks:** surface hook failure errors in UI instead of silent blank ([c5ea03c](https://github.com/chadbyte/clay/commit/c5ea03cd8b37796a8700ea865757d994446b3b52)), closes [#270](https://github.com/chadbyte/clay/issues/270)

## [2.24.2](https://github.com/chadbyte/clay/compare/v2.24.1...v2.24.2) (2026-04-06)


### Bug Fixes

* close SDK query instance to reap orphaned claude child processes ([#269](https://github.com/chadbyte/clay/issues/269)) ([56abc1b](https://github.com/chadbyte/clay/commit/56abc1bfa6afb58c80edf30424b8fae976c96ee1))

## [2.24.2-beta.1](https://github.com/chadbyte/clay/compare/v2.24.1...v2.24.2-beta.1) (2026-04-06)


### Bug Fixes

* close SDK query instance to reap orphaned claude child processes ([#269](https://github.com/chadbyte/clay/issues/269)) ([56abc1b](https://github.com/chadbyte/clay/commit/56abc1bfa6afb58c80edf30424b8fae976c96ee1))

## [2.24.1](https://github.com/chadbyte/clay/compare/v2.24.0...v2.24.1) (2026-04-05)


### Bug Fixes

* **ui:** correct bubble mode user alignment and show hover icons in channel mode ([8cbde9c](https://github.com/chadbyte/clay/commit/8cbde9ce0e1427383c5fcddffad972463a675323))

## [2.24.1-beta.1](https://github.com/chadbyte/clay/compare/v2.24.0...v2.24.1-beta.1) (2026-04-05)


### Bug Fixes

* **ui:** correct bubble mode user alignment and show hover icons in channel mode ([8cbde9c](https://github.com/chadbyte/clay/commit/8cbde9ce0e1427383c5fcddffad972463a675323))

# [2.24.0](https://github.com/chadbyte/clay/compare/v2.23.1...v2.24.0) (2026-04-05)


### Bug Fixes

* **mate:** load team memory summaries for globalSearch mates regardless of digest count ([535023a](https://github.com/chadbyte/clay/commit/535023a912c224d26aae5799972bd436ffaa695c))
* **os-user:** force IPv4 on CLI subprocess by patching tls.connect ([c10c965](https://github.com/chadbyte/clay/commit/c10c965947e72c0bb988d2c8bb493d0ff0e30111))
* **os-user:** resolve cold start latency caused by IPv6 timeout in SDK CLI subprocess ([6eb5e9e](https://github.com/chadbyte/clay/commit/6eb5e9eb9eb968d9e17828600c03ae15be619ebc))
* **permissions:** set 644 on uploaded files and chown to session owner ([3b9ebe8](https://github.com/chadbyte/clay/commit/3b9ebe81cb0593c8061077a9a59a2522f996678f))
* **search:** support Cmd+F search in debate sessions ([3990138](https://github.com/chadbyte/clay/commit/399013884778758f5b230dbfaa48590b51aa2c5f))
* **ui:** force bubble layout on mobile regardless of user setting ([0493a54](https://github.com/chadbyte/clay/commit/0493a54f8943745498399625f257d325e36fcf2e))


### Features

* **debate:** add PDF export with avatar support ([d224d51](https://github.com/chadbyte/clay/commit/d224d51ed0542beabbfc3278b79afd07e7119d2c))
* **mate:** add cross-project search, user observations, and profile synthesis ([39777a9](https://github.com/chadbyte/clay/commit/39777a9fdc338d9ad08b59d8a9b430b79b36b531))
* **mention:** keep mention chip sticky after sending message ([5ba688a](https://github.com/chadbyte/clay/commit/5ba688a97ab1824860ed39df010864ad5b631564))
* **ui:** add Ask Mate button with rainbow gradient and improve mention menu ([c5f2ecc](https://github.com/chadbyte/clay/commit/c5f2eccdeb3980f00aef31291867596311dd4d69))
* **ui:** add Bubble/Channel layout switcher in Appearance settings ([169f889](https://github.com/chadbyte/clay/commit/169f8899012737d87cf4003f94a5861908cf4a09))
* **ui:** add Claude Code mascot avatar for Channel layout ([e05264d](https://github.com/chadbyte/clay/commit/e05264d40c46427a9f866f75f6444d038bae8bf4))
* **ui:** add copy button to paste modal and refresh button to file viewer ([113cc82](https://github.com/chadbyte/clay/commit/113cc827823473f0f22518960d47b13e7a724081))
* **ui:** add one-time mate onboarding modal with server persistence ([e990f14](https://github.com/chadbyte/clay/commit/e990f1450458250e772512f36f7b51bb4cff3f27))
* **ui:** add skeleton placeholders during initial server loading ([b7523f7](https://github.com/chadbyte/clay/commit/b7523f70a9a6f1289f6431817dc9fa8decd82db1))
* **ui:** reorganize project menus, add Ask Mate button, polish Appearance settings ([a8dfc66](https://github.com/chadbyte/clay/commit/a8dfc662642312eccf4cb30bda4da6b7e1d5b515))

# [2.24.0-beta.1](https://github.com/chadbyte/clay/compare/v2.23.2-beta.1...v2.24.0-beta.1) (2026-04-05)


### Bug Fixes

* **mate:** load team memory summaries for globalSearch mates regardless of digest count ([535023a](https://github.com/chadbyte/clay/commit/535023a912c224d26aae5799972bd436ffaa695c))
* **os-user:** force IPv4 on CLI subprocess by patching tls.connect ([c10c965](https://github.com/chadbyte/clay/commit/c10c965947e72c0bb988d2c8bb493d0ff0e30111))
* **permissions:** set 644 on uploaded files and chown to session owner ([3b9ebe8](https://github.com/chadbyte/clay/commit/3b9ebe81cb0593c8061077a9a59a2522f996678f))
* **search:** support Cmd+F search in debate sessions ([3990138](https://github.com/chadbyte/clay/commit/399013884778758f5b230dbfaa48590b51aa2c5f))
* **ui:** force bubble layout on mobile regardless of user setting ([0493a54](https://github.com/chadbyte/clay/commit/0493a54f8943745498399625f257d325e36fcf2e))


### Features

* **debate:** add PDF export with avatar support ([d224d51](https://github.com/chadbyte/clay/commit/d224d51ed0542beabbfc3278b79afd07e7119d2c))
* **mate:** add cross-project search, user observations, and profile synthesis ([39777a9](https://github.com/chadbyte/clay/commit/39777a9fdc338d9ad08b59d8a9b430b79b36b531))
* **mention:** keep mention chip sticky after sending message ([5ba688a](https://github.com/chadbyte/clay/commit/5ba688a97ab1824860ed39df010864ad5b631564))
* **ui:** add Ask Mate button with rainbow gradient and improve mention menu ([c5f2ecc](https://github.com/chadbyte/clay/commit/c5f2eccdeb3980f00aef31291867596311dd4d69))
* **ui:** add Bubble/Channel layout switcher in Appearance settings ([169f889](https://github.com/chadbyte/clay/commit/169f8899012737d87cf4003f94a5861908cf4a09))
* **ui:** add Claude Code mascot avatar for Channel layout ([e05264d](https://github.com/chadbyte/clay/commit/e05264d40c46427a9f866f75f6444d038bae8bf4))
* **ui:** add copy button to paste modal and refresh button to file viewer ([113cc82](https://github.com/chadbyte/clay/commit/113cc827823473f0f22518960d47b13e7a724081))
* **ui:** add one-time mate onboarding modal with server persistence ([e990f14](https://github.com/chadbyte/clay/commit/e990f1450458250e772512f36f7b51bb4cff3f27))
* **ui:** add skeleton placeholders during initial server loading ([b7523f7](https://github.com/chadbyte/clay/commit/b7523f70a9a6f1289f6431817dc9fa8decd82db1))
* **ui:** reorganize project menus, add Ask Mate button, polish Appearance settings ([a8dfc66](https://github.com/chadbyte/clay/commit/a8dfc662642312eccf4cb30bda4da6b7e1d5b515))

## [2.23.2-beta.1](https://github.com/chadbyte/clay/compare/v2.23.1...v2.23.2-beta.1) (2026-04-05)


### Bug Fixes

* **os-user:** resolve cold start latency caused by IPv6 timeout in SDK CLI subprocess ([6eb5e9e](https://github.com/chadbyte/clay/commit/6eb5e9eb9eb968d9e17828600c03ae15be619ebc))

## [2.23.1](https://github.com/chadbyte/clay/compare/v2.23.0...v2.23.1) (2026-04-04)


### Bug Fixes

* **debate:** only show preparing indicator for quick debate, not standard setup ([41cc0fd](https://github.com/chadbyte/clay/commit/41cc0fdfec41b6eeeb1964f03f39460070554cb7))
* **os-user:** fix session loss on stop by fixing dir ownership and reusing workers ([19057ff](https://github.com/chadbyte/clay/commit/19057ff6051ff826a44b716fe6b372c4d3491fbd))
* prevent session history loss after stop in OS multi-user mode ([53a52af](https://github.com/chadbyte/clay/commit/53a52af570a0e3a2bc0aeab5d141afef96328ded))
* set HOME and npm_config_cache env for skill-install child process ([a596076](https://github.com/chadbyte/clay/commit/a596076812099039684f1e284bd67217e20658ea))
* **ui:** show loading indicator during debate preparing phase ([7e7e6e7](https://github.com/chadbyte/clay/commit/7e7e6e7782aed861985f46fd4ac22f93080cb04e))

## [2.23.1-beta.2](https://github.com/chadbyte/clay/compare/v2.23.1-beta.1...v2.23.1-beta.2) (2026-04-04)


### Bug Fixes

* **debate:** only show preparing indicator for quick debate, not standard setup ([41cc0fd](https://github.com/chadbyte/clay/commit/41cc0fdfec41b6eeeb1964f03f39460070554cb7))
* **os-user:** fix session loss on stop by fixing dir ownership and reusing workers ([19057ff](https://github.com/chadbyte/clay/commit/19057ff6051ff826a44b716fe6b372c4d3491fbd))

## [2.23.1-beta.1](https://github.com/chadbyte/clay/compare/v2.23.0...v2.23.1-beta.1) (2026-04-04)


### Bug Fixes

* prevent session history loss after stop in OS multi-user mode ([53a52af](https://github.com/chadbyte/clay/commit/53a52af570a0e3a2bc0aeab5d141afef96328ded))
* set HOME and npm_config_cache env for skill-install child process ([a596076](https://github.com/chadbyte/clay/commit/a596076812099039684f1e284bd67217e20658ea))
* **ui:** show loading indicator during debate preparing phase ([7e7e6e7](https://github.com/chadbyte/clay/commit/7e7e6e7782aed861985f46fd4ac22f93080cb04e))

# [2.23.0](https://github.com/chadbyte/clay/compare/v2.22.2...v2.23.0) (2026-04-04)


### Bug Fixes

* **config:** preserve all daemon.json settings on restart ([ec32a7b](https://github.com/chadbyte/clay/commit/ec32a7bc63d104b223fbdb7742b6cc11070698fe)), closes [#259](https://github.com/chadbyte/clay/issues/259)
* isolate user process env from root daemon's process.env ([deda551](https://github.com/chadbyte/clay/commit/deda551143bc21ed79143fc27daab5999024af37))
* **mates:** close file viewer and terminal when switching to mate DM ([e9b928a](https://github.com/chadbyte/clay/commit/e9b928aa8d2c03bd5ecd55a598c91f849bfbe79f))
* **mates:** disable context menu for primary mates ([b94c528](https://github.com/chadbyte/clay/commit/b94c52828ae33c4333fee29cb9fd0c0f90a54313))
* **mates:** fix command whitelist splitting on quoted pipe characters ([2fe0c38](https://github.com/chadbyte/clay/commit/2fe0c384153bdd3d6579df861fc8496f2a629df6))
* **mates:** hide mate projects from admin Project Access list ([b35429a](https://github.com/chadbyte/clay/commit/b35429a7d21204228bac87d427cde510585ee585))
* **mates:** hide memory panel when switching between mates ([c432ab9](https://github.com/chadbyte/clay/commit/c432ab9322e235eec9152d6732b7c86d66b42f9d))
* **mates:** limit auto-favorite to core 3 built-in mates ([e4cfa90](https://github.com/chadbyte/clay/commit/e4cfa90784545d490831fb4c420e9f7ad45d102d))
* **mates:** prevent circular mate DM restore loops ([bf227bc](https://github.com/chadbyte/clay/commit/bf227bcc010ed5014c40cd0ebfed1eff00409ec2))
* **mates:** prevent identity wipe with atomic enforce and backup system ([e173087](https://github.com/chadbyte/clay/commit/e17308785c5e4fdf34fd8f70f75adbe7b81f2103))
* **mates:** prevent infinite warning loop for identity-less mates ([9083425](https://github.com/chadbyte/clay/commit/90834250aa27e06f920b4004b644e60ccc019c28))
* **mates:** restore dynamic project registry injection ([a1a5e8d](https://github.com/chadbyte/clay/commit/a1a5e8d2b4229c3e30d6805e8cb0b8a99a6aee4d))
* **mates:** stabilize mate DM UI during project switching ([dffead0](https://github.com/chadbyte/clay/commit/dffead01b210d737aa5382d7848526653a0d65c2))
* **os-users:** fix fsAsUser crash on Node.js v22 due to TypeScript eval parsing ([28715bd](https://github.com/chadbyte/clay/commit/28715bd276189befda3fa658cda938a32802e049))
* **permissions:** default fileBrowser permission to true ([565a78a](https://github.com/chadbyte/clay/commit/565a78a3da8d2cdc77e330ddb403bd81de0eee85))
* **profile:** show saved name instead of placeholder in user island ([4ee9197](https://github.com/chadbyte/clay/commit/4ee919789aa0dc39e01b35e0c076001c62e60c5e)), closes [#260](https://github.com/chadbyte/clay/issues/260)
* **terminal:** use user's default shell instead of hardcoded bash ([722129c](https://github.com/chadbyte/clay/commit/722129c212f0a5489407823a4499a82e145c1835))
* **ui:** auto-switch to schedule mode on rate limit rejection ([3a5546d](https://github.com/chadbyte/clay/commit/3a5546dd9d8b522ffc0d4f1e6123a78b0ad4be1f))
* **ui:** clear debate UI on session switch ([95b2cd4](https://github.com/chadbyte/clay/commit/95b2cd4cb2185a87b56fdcf644d44ca50c442b07))
* **ui:** clear debate-info-float panel bar on session switch ([18a7656](https://github.com/chadbyte/clay/commit/18a76567196224ddbcb5831040b3a9e2d517c490)), closes [#debate-info-float](https://github.com/chadbyte/clay/issues/debate-info-float)
* **ui:** increase rate limit schedule buffer from 3s to 3min ([f945852](https://github.com/chadbyte/clay/commit/f9458528f245074fd33c82c5a91744bb02a96a82))
* **ui:** remove debate bottom bar when debate ends or session replays ([828804b](https://github.com/chadbyte/clay/commit/828804b630ec8b04096d1d76efd2c57711977b9c))
* **ui:** reset debate state on session switch ([c098d02](https://github.com/chadbyte/clay/commit/c098d02045dbc90ea14052610550fad16069ef05))


### Features

* **debate:** support natural debate proposals from DM conversations ([59879d8](https://github.com/chadbyte/clay/commit/59879d81ce32ba7d492664486773e1ced09e10da))
* **mates:** add dust particle effect on mate removal ([88cd210](https://github.com/chadbyte/clay/commit/88cd210c9b7b822d9827c3473ef2e064eee93dd5))
* **mates:** add global search for Ally across all mates' sessions ([962f435](https://github.com/chadbyte/clay/commit/962f4350f50626c684fe21bb82916c1189d5fdbf))
* **mates:** add session delete via right-click context menu ([27e3a58](https://github.com/chadbyte/clay/commit/27e3a5830fb9ac323e96016faaba7bad5df87d29))
* **mates:** auto-sync primary mates with latest definition on startup ([97eb52b](https://github.com/chadbyte/clay/commit/97eb52b4fe367d707833521865e958599dcab8a3))
* **mates:** dynamic capabilities injection and primary mate UI ([abed902](https://github.com/chadbyte/clay/commit/abed902515d2c5d9b5df624f5ef9ac39615548e4))
* **mates:** establish Ally as code-managed primary mate ([e3144e9](https://github.com/chadbyte/clay/commit/e3144e94c8f8237006298d633374828cc37eae45))
* **mates:** inject project registry into mate CLAUDE.md ([646c411](https://github.com/chadbyte/clay/commit/646c4117d7b9aca4d7aa0ccd1736aa9882585df4))
* **mates:** inject team memory summaries into Ally's context ([b255aad](https://github.com/chadbyte/clay/commit/b255aad135631cc629bd25046b995ea6dc670e84))
* **mates:** replace static team section with dynamic roster ([8c10685](https://github.com/chadbyte/clay/commit/8c1068547c5af2a2ac214bf3627e3e3a53e359ae))
* **permissions:** auto-approve read-only tools and safe bash for all sessions ([3401390](https://github.com/chadbyte/clay/commit/340139009adb2fcda52a95554e865e966826674d))
* **search:** add multi-language tokenization support ([8a1e8c0](https://github.com/chadbyte/clay/commit/8a1e8c0db9f2bb073a4532f8781aba14534bf961))
* **search:** add unified BM25 search for session history and Cmd+K ([44ee0a8](https://github.com/chadbyte/clay/commit/44ee0a811b2c4d7bbcdfcb2c04685d062d517600))
* **ui:** add right-click context menu to project session items ([9efb61b](https://github.com/chadbyte/clay/commit/9efb61be9b11fe63f64fead50da54578ee0cc156))

# [2.23.0-beta.8](https://github.com/chadbyte/clay/compare/v2.23.0-beta.7...v2.23.0-beta.8) (2026-04-04)


### Bug Fixes

* **os-users:** fix fsAsUser crash on Node.js v22 due to TypeScript eval parsing ([28715bd](https://github.com/chadbyte/clay/commit/28715bd276189befda3fa658cda938a32802e049))
* **ui:** clear debate-info-float panel bar on session switch ([18a7656](https://github.com/chadbyte/clay/commit/18a76567196224ddbcb5831040b3a9e2d517c490)), closes [#debate-info-float](https://github.com/chadbyte/clay/issues/debate-info-float)
* **ui:** reset debate state on session switch ([c098d02](https://github.com/chadbyte/clay/commit/c098d02045dbc90ea14052610550fad16069ef05))

# [2.23.0-beta.7](https://github.com/chadbyte/clay/compare/v2.23.0-beta.6...v2.23.0-beta.7) (2026-04-04)


### Bug Fixes

* **mates:** disable context menu for primary mates ([b94c528](https://github.com/chadbyte/clay/commit/b94c52828ae33c4333fee29cb9fd0c0f90a54313))
* **mates:** fix command whitelist splitting on quoted pipe characters ([2fe0c38](https://github.com/chadbyte/clay/commit/2fe0c384153bdd3d6579df861fc8496f2a629df6))
* **mates:** hide memory panel when switching between mates ([c432ab9](https://github.com/chadbyte/clay/commit/c432ab9322e235eec9152d6732b7c86d66b42f9d))
* **mates:** prevent infinite warning loop for identity-less mates ([9083425](https://github.com/chadbyte/clay/commit/90834250aa27e06f920b4004b644e60ccc019c28))
* **mates:** restore dynamic project registry injection ([a1a5e8d](https://github.com/chadbyte/clay/commit/a1a5e8d2b4229c3e30d6805e8cb0b8a99a6aee4d))
* **permissions:** default fileBrowser permission to true ([565a78a](https://github.com/chadbyte/clay/commit/565a78a3da8d2cdc77e330ddb403bd81de0eee85))
* **terminal:** use user's default shell instead of hardcoded bash ([722129c](https://github.com/chadbyte/clay/commit/722129c212f0a5489407823a4499a82e145c1835))
* **ui:** auto-switch to schedule mode on rate limit rejection ([3a5546d](https://github.com/chadbyte/clay/commit/3a5546dd9d8b522ffc0d4f1e6123a78b0ad4be1f))
* **ui:** clear debate UI on session switch ([95b2cd4](https://github.com/chadbyte/clay/commit/95b2cd4cb2185a87b56fdcf644d44ca50c442b07))
* **ui:** increase rate limit schedule buffer from 3s to 3min ([f945852](https://github.com/chadbyte/clay/commit/f9458528f245074fd33c82c5a91744bb02a96a82))
* **ui:** remove debate bottom bar when debate ends or session replays ([828804b](https://github.com/chadbyte/clay/commit/828804b630ec8b04096d1d76efd2c57711977b9c))


### Features

* **mates:** add session delete via right-click context menu ([27e3a58](https://github.com/chadbyte/clay/commit/27e3a5830fb9ac323e96016faaba7bad5df87d29))
* **mates:** auto-sync primary mates with latest definition on startup ([97eb52b](https://github.com/chadbyte/clay/commit/97eb52b4fe367d707833521865e958599dcab8a3))
* **mates:** dynamic capabilities injection and primary mate UI ([abed902](https://github.com/chadbyte/clay/commit/abed902515d2c5d9b5df624f5ef9ac39615548e4))
* **mates:** establish Ally as code-managed primary mate ([e3144e9](https://github.com/chadbyte/clay/commit/e3144e94c8f8237006298d633374828cc37eae45))
* **mates:** inject team memory summaries into Ally's context ([b255aad](https://github.com/chadbyte/clay/commit/b255aad135631cc629bd25046b995ea6dc670e84))
* **permissions:** auto-approve read-only tools and safe bash for all sessions ([3401390](https://github.com/chadbyte/clay/commit/340139009adb2fcda52a95554e865e966826674d))
* **ui:** add right-click context menu to project session items ([9efb61b](https://github.com/chadbyte/clay/commit/9efb61be9b11fe63f64fead50da54578ee0cc156))

# [2.23.0-beta.6](https://github.com/chadbyte/clay/compare/v2.23.0-beta.5...v2.23.0-beta.6) (2026-04-04)


### Bug Fixes

* **mates:** prevent identity wipe with atomic enforce and backup system ([e173087](https://github.com/chadbyte/clay/commit/e17308785c5e4fdf34fd8f70f75adbe7b81f2103))


### Features

* **mates:** add global search for Ally across all mates' sessions ([962f435](https://github.com/chadbyte/clay/commit/962f4350f50626c684fe21bb82916c1189d5fdbf))
* **mates:** replace static team section with dynamic roster ([8c10685](https://github.com/chadbyte/clay/commit/8c1068547c5af2a2ac214bf3627e3e3a53e359ae))
* **search:** add multi-language tokenization support ([8a1e8c0](https://github.com/chadbyte/clay/commit/8a1e8c0db9f2bb073a4532f8781aba14534bf961))
* **search:** add unified BM25 search for session history and Cmd+K ([44ee0a8](https://github.com/chadbyte/clay/commit/44ee0a811b2c4d7bbcdfcb2c04685d062d517600))

# [2.23.0-beta.5](https://github.com/chadbyte/clay/compare/v2.23.0-beta.4...v2.23.0-beta.5) (2026-04-03)


### Bug Fixes

* **mates:** stabilize mate DM UI during project switching ([dffead0](https://github.com/chadbyte/clay/commit/dffead01b210d737aa5382d7848526653a0d65c2))

# [2.23.0-beta.4](https://github.com/chadbyte/clay/compare/v2.23.0-beta.3...v2.23.0-beta.4) (2026-04-03)


### Bug Fixes

* **config:** preserve all daemon.json settings on restart ([ec32a7b](https://github.com/chadbyte/clay/commit/ec32a7bc63d104b223fbdb7742b6cc11070698fe)), closes [#259](https://github.com/chadbyte/clay/issues/259)
* **profile:** show saved name instead of placeholder in user island ([4ee9197](https://github.com/chadbyte/clay/commit/4ee919789aa0dc39e01b35e0c076001c62e60c5e)), closes [#260](https://github.com/chadbyte/clay/issues/260)

# [2.23.0-beta.3](https://github.com/chadbyte/clay/compare/v2.23.0-beta.2...v2.23.0-beta.3) (2026-04-03)


### Bug Fixes

* **mates:** prevent circular mate DM restore loops ([bf227bc](https://github.com/chadbyte/clay/commit/bf227bcc010ed5014c40cd0ebfed1eff00409ec2))

# [2.23.0-beta.2](https://github.com/chadbyte/clay/compare/v2.23.0-beta.1...v2.23.0-beta.2) (2026-04-03)


### Bug Fixes

* **mates:** hide mate projects from admin Project Access list ([b35429a](https://github.com/chadbyte/clay/commit/b35429a7d21204228bac87d427cde510585ee585))

# [2.23.0-beta.1](https://github.com/chadbyte/clay/compare/v2.22.3-beta.1...v2.23.0-beta.1) (2026-04-03)


### Bug Fixes

* **mates:** close file viewer and terminal when switching to mate DM ([e9b928a](https://github.com/chadbyte/clay/commit/e9b928aa8d2c03bd5ecd55a598c91f849bfbe79f))
* **mates:** limit auto-favorite to core 3 built-in mates ([e4cfa90](https://github.com/chadbyte/clay/commit/e4cfa90784545d490831fb4c420e9f7ad45d102d))


### Features

* **debate:** support natural debate proposals from DM conversations ([59879d8](https://github.com/chadbyte/clay/commit/59879d81ce32ba7d492664486773e1ced09e10da))
* **mates:** add dust particle effect on mate removal ([88cd210](https://github.com/chadbyte/clay/commit/88cd210c9b7b822d9827c3473ef2e064eee93dd5))
* **mates:** inject project registry into mate CLAUDE.md ([646c411](https://github.com/chadbyte/clay/commit/646c4117d7b9aca4d7aa0ccd1736aa9882585df4))

## [2.22.3-beta.1](https://github.com/chadbyte/clay/compare/v2.22.2...v2.22.3-beta.1) (2026-04-03)


### Bug Fixes

* isolate user process env from root daemon's process.env ([deda551](https://github.com/chadbyte/clay/commit/deda551143bc21ed79143fc27daab5999024af37))

## [2.22.2](https://github.com/chadbyte/clay/compare/v2.22.1...v2.22.2) (2026-04-03)


### Bug Fixes

* close server port before spawning new daemon on restart ([c058c86](https://github.com/chadbyte/clay/commit/c058c86ce51fe37ef4a466def9a5b8267024ebff))

## [2.22.2-beta.1](https://github.com/chadbyte/clay/compare/v2.22.1...v2.22.2-beta.1) (2026-04-03)


### Bug Fixes

* close server port before spawning new daemon on restart ([c058c86](https://github.com/chadbyte/clay/commit/c058c86ce51fe37ef4a466def9a5b8267024ebff))

## [2.22.1](https://github.com/chadbyte/clay/compare/v2.22.0...v2.22.1) (2026-04-03)


### Bug Fixes

* **os-users:** narrow session-not-found detection to prevent false positives ([88926d8](https://github.com/chadbyte/clay/commit/88926d8f22dd6bdf8ff8d353c3e8aa52f06002bf))

## [2.22.1-beta.1](https://github.com/chadbyte/clay/compare/v2.22.0...v2.22.1-beta.1) (2026-04-03)


### Bug Fixes

* **os-users:** narrow session-not-found detection to prevent false positives ([88926d8](https://github.com/chadbyte/clay/commit/88926d8f22dd6bdf8ff8d353c3e8aa52f06002bf))

# [2.22.0](https://github.com/chadbyte/clay/compare/v2.21.0...v2.22.0) (2026-04-03)


### Bug Fixes

* block auto-update in headless mode and restrict update UI to admins ([1b276f6](https://github.com/chadbyte/clay/commit/1b276f6e4dc03a23124b2533668f9b025e9ced7c)), closes [#258](https://github.com/chadbyte/clay/issues/258)
* **input:** enable send button when attachments are added during processing ([8b0e09f](https://github.com/chadbyte/clay/commit/8b0e09f2e8429a53e97292711bc5b8169bde35dc))
* remove mkcert -CAROOT exec from daemon startup ([e627873](https://github.com/chadbyte/clay/commit/e627873d81f68e693bbb95841795e9c73e91f8cd)), closes [#258](https://github.com/chadbyte/clay/issues/258)
* **ui:** hide update banner on reconnect after successful update ([1d8eb03](https://github.com/chadbyte/clay/commit/1d8eb03d1f11944f150bdda7426d074c43f360cb))


### Features

* **mates:** improve memory digestion with richer context and lower gate threshold ([c4dad96](https://github.com/chadbyte/clay/commit/c4dad96a4c7b3c0be807286a1ef9889877d9c060))
* **mates:** replace Scout and Sage with 5 perspective mates ([5e4cf70](https://github.com/chadbyte/clay/commit/5e4cf70a65eba2f5eefe1a7fab62abf33e665ff1))
* **projects:** allow project owners to manage access and visibility ([12dbb38](https://github.com/chadbyte/clay/commit/12dbb384dcb7c63f17f115e1fcc26ce5b424bd57))

# [2.22.0-beta.4](https://github.com/chadbyte/clay/compare/v2.22.0-beta.3...v2.22.0-beta.4) (2026-04-03)


### Bug Fixes

* block auto-update in headless mode and restrict update UI to admins ([1b276f6](https://github.com/chadbyte/clay/commit/1b276f6e4dc03a23124b2533668f9b025e9ced7c)), closes [#258](https://github.com/chadbyte/clay/issues/258)
* remove mkcert -CAROOT exec from daemon startup ([e627873](https://github.com/chadbyte/clay/commit/e627873d81f68e693bbb95841795e9c73e91f8cd)), closes [#258](https://github.com/chadbyte/clay/issues/258)

# [2.22.0-beta.3](https://github.com/chadbyte/clay/compare/v2.22.0-beta.2...v2.22.0-beta.3) (2026-04-03)


### Bug Fixes

* **ui:** hide update banner on reconnect after successful update ([1d8eb03](https://github.com/chadbyte/clay/commit/1d8eb03d1f11944f150bdda7426d074c43f360cb))


### Features

* **projects:** allow project owners to manage access and visibility ([12dbb38](https://github.com/chadbyte/clay/commit/12dbb384dcb7c63f17f115e1fcc26ce5b424bd57))

# [2.22.0-beta.2](https://github.com/chadbyte/clay/compare/v2.22.0-beta.1...v2.22.0-beta.2) (2026-04-03)


### Features

* **mates:** improve memory digestion with richer context and lower gate threshold ([c4dad96](https://github.com/chadbyte/clay/commit/c4dad96a4c7b3c0be807286a1ef9889877d9c060))

# [2.22.0-beta.1](https://github.com/chadbyte/clay/compare/v2.21.1-beta.1...v2.22.0-beta.1) (2026-04-03)


### Features

* **mates:** replace Scout and Sage with 5 perspective mates ([5e4cf70](https://github.com/chadbyte/clay/commit/5e4cf70a65eba2f5eefe1a7fab62abf33e665ff1))

## [2.21.1-beta.1](https://github.com/chadbyte/clay/compare/v2.21.0...v2.21.1-beta.1) (2026-04-03)


### Bug Fixes

* **input:** enable send button when attachments are added during processing ([8b0e09f](https://github.com/chadbyte/clay/commit/8b0e09f2e8429a53e97292711bc5b8169bde35dc))

# [2.21.0](https://github.com/chadbyte/clay/compare/v2.20.0...v2.21.0) (2026-04-02)


### Bug Fixes

* add missing path require in os-users and handle EIO in shutdown ([40aa14e](https://github.com/chadbyte/clay/commit/40aa14e47ba6ce69494cb509d5505106052ea4d4))
* **cli:** add error handling for OS users toggle IPC ([92ba05d](https://github.com/chadbyte/clay/commit/92ba05ddf1a7a63347e5c5f9c11ecc5866b3cb2b))
* **cli:** auto-regenerate setup code and add daemon startup diagnostics ([b0e8987](https://github.com/chadbyte/clay/commit/b0e89873f707ff0a2f7d65fd07fe08e051a33d04))
* **cli:** resolve multi-user OS isolation setup workflow bugs ([52e52da](https://github.com/chadbyte/clay/commit/52e52da33fe75841c0a5884f60261e47b7767d49))
* **cli:** run OS user provisioning from CLI with live progress ([6773da9](https://github.com/chadbyte/clay/commit/6773da99d3d6f8a9d1f0428fb05dac568d34f555))
* **cli:** show config path in main menu and always expose setup code ([f1e6f99](https://github.com/chadbyte/clay/commit/f1e6f99fa3e0d3cbf10798ae0f91e83a99f5d4c5))
* **config:** add fallbacks for getRealHome under sudo on GCE ([483e35b](https://github.com/chadbyte/clay/commit/483e35b863e8be80d95c39457e6cf82506981ad7))
* **config:** derive CLAY_HOME from CLAY_CONFIG in daemon mode ([40906b5](https://github.com/chadbyte/clay/commit/40906b5b46995aa04482ba726f51dc1ef1945ff4))
* **daemon:** add version and IPC debug logging at startup ([e3d2e79](https://github.com/chadbyte/clay/commit/e3d2e79d74837397341382e0c25c98bd57740c50))
* **daemon:** defer startup ACL provisioning to unblock IPC ([39743bd](https://github.com/chadbyte/clay/commit/39743bdda435785de515886b3f7b55f156d4dee0))
* **mates:** check all segments of compound bash commands for safe whitelist ([3a278b4](https://github.com/chadbyte/clay/commit/3a278b4c7043b1fd88a68addee80fd9b339d1a66))
* **os-users:** add early boot diagnostics to SDK worker ([a2b0724](https://github.com/chadbyte/clay/commit/a2b07245b0af9e9d64bf16509ca319cc1605983a))
* **os-users:** add exit reason diagnostics to SDK worker ([a631f3a](https://github.com/chadbyte/clay/commit/a631f3a02da9c12fbec30ad92eba11cd632ee60e))
* **os-users:** add keepalive interval to prevent premature worker exit ([e38d492](https://github.com/chadbyte/clay/commit/e38d492c6915cef65029466e96461f60869e4613))
* **os-users:** add spawn diagnostics and handle premature worker exit ([8c402f6](https://github.com/chadbyte/clay/commit/8c402f6e552133cbfc950e153402b44d0e3c1240))
* **os-users:** chmod entire node_modules for hoisted SDK deps ([9ce3c7e](https://github.com/chadbyte/clay/commit/9ce3c7e15622649ed5b9825ef2ce1047ca20e88b))
* **os-users:** grant traverse permission on ancestor dirs for SDK worker ([c02de47](https://github.com/chadbyte/clay/commit/c02de470d190ea481fbc7d314f0c3c9a7cce8fe2))
* **os-users:** inherit full env for SDK worker spawn ([2f079b9](https://github.com/chadbyte/clay/commit/2f079b974dccc69cd6a5757753bfd1e622166fa0))
* **os-users:** pre-copy CLI sessions before worker spawn and fix race conditions ([d6cd8c2](https://github.com/chadbyte/clay/commit/d6cd8c2e7080a9d51887b353b4cf0c2566bab49e))
* **os-users:** skip recursive ACL on home directories ([e95ec4c](https://github.com/chadbyte/clay/commit/e95ec4c9b9d8f717d3ca7ac6d66e1bf554e34bff))
* **sessions:** suppress noisy migration failed logs on startup ([ecc05d0](https://github.com/chadbyte/clay/commit/ecc05d0319c2e1233d180f487323064e771481cb))


### Features

* **os-users:** auto-migrate CLI sessions and fix devMode OS users support ([cbbca7c](https://github.com/chadbyte/clay/commit/cbbca7ccf3169682c1be9dbf2552d5155e14c95e))


### Performance Improvements

* **os-users:** skip full ACL re-application on every startup ([e0a0f6a](https://github.com/chadbyte/clay/commit/e0a0f6a16c5ff8989284e0de4e5ba0e6d76b6a72))

# [2.21.0-beta.4](https://github.com/chadbyte/clay/compare/v2.21.0-beta.3...v2.21.0-beta.4) (2026-04-02)


### Bug Fixes

* **mates:** check all segments of compound bash commands for safe whitelist ([3a278b4](https://github.com/chadbyte/clay/commit/3a278b4c7043b1fd88a68addee80fd9b339d1a66))

# [2.21.0-beta.3](https://github.com/chadbyte/clay/compare/v2.21.0-beta.2...v2.21.0-beta.3) (2026-04-02)


### Bug Fixes

* **os-users:** pre-copy CLI sessions before worker spawn and fix race conditions ([d6cd8c2](https://github.com/chadbyte/clay/commit/d6cd8c2e7080a9d51887b353b4cf0c2566bab49e))
* **sessions:** suppress noisy migration failed logs on startup ([ecc05d0](https://github.com/chadbyte/clay/commit/ecc05d0319c2e1233d180f487323064e771481cb))


### Performance Improvements

* **os-users:** skip full ACL re-application on every startup ([e0a0f6a](https://github.com/chadbyte/clay/commit/e0a0f6a16c5ff8989284e0de4e5ba0e6d76b6a72))

# [2.21.0-beta.2](https://github.com/chadbyte/clay/compare/v2.21.0-beta.1...v2.21.0-beta.2) (2026-04-02)


### Bug Fixes

* add missing path require in os-users and handle EIO in shutdown ([40aa14e](https://github.com/chadbyte/clay/commit/40aa14e47ba6ce69494cb509d5505106052ea4d4))

# [2.21.0-beta.1](https://github.com/chadbyte/clay/compare/v2.20.1-beta.17...v2.21.0-beta.1) (2026-04-02)


### Features

* **os-users:** auto-migrate CLI sessions and fix devMode OS users support ([cbbca7c](https://github.com/chadbyte/clay/commit/cbbca7ccf3169682c1be9dbf2552d5155e14c95e))

## [2.20.1-beta.17](https://github.com/chadbyte/clay/compare/v2.20.1-beta.16...v2.20.1-beta.17) (2026-04-02)


### Bug Fixes

* **os-users:** add keepalive interval to prevent premature worker exit ([e38d492](https://github.com/chadbyte/clay/commit/e38d492c6915cef65029466e96461f60869e4613))

## [2.20.1-beta.16](https://github.com/chadbyte/clay/compare/v2.20.1-beta.15...v2.20.1-beta.16) (2026-04-02)


### Bug Fixes

* **os-users:** add exit reason diagnostics to SDK worker ([a631f3a](https://github.com/chadbyte/clay/commit/a631f3a02da9c12fbec30ad92eba11cd632ee60e))

## [2.20.1-beta.15](https://github.com/chadbyte/clay/compare/v2.20.1-beta.14...v2.20.1-beta.15) (2026-04-02)


### Bug Fixes

* **os-users:** add early boot diagnostics to SDK worker ([a2b0724](https://github.com/chadbyte/clay/commit/a2b07245b0af9e9d64bf16509ca319cc1605983a))

## [2.20.1-beta.14](https://github.com/chadbyte/clay/compare/v2.20.1-beta.13...v2.20.1-beta.14) (2026-04-02)


### Bug Fixes

* **os-users:** inherit full env for SDK worker spawn ([2f079b9](https://github.com/chadbyte/clay/commit/2f079b974dccc69cd6a5757753bfd1e622166fa0))

## [2.20.1-beta.13](https://github.com/chadbyte/clay/compare/v2.20.1-beta.12...v2.20.1-beta.13) (2026-04-02)


### Bug Fixes

* **os-users:** add spawn diagnostics and handle premature worker exit ([8c402f6](https://github.com/chadbyte/clay/commit/8c402f6e552133cbfc950e153402b44d0e3c1240))

## [2.20.1-beta.12](https://github.com/chadbyte/clay/compare/v2.20.1-beta.11...v2.20.1-beta.12) (2026-04-02)


### Bug Fixes

* **os-users:** chmod entire node_modules for hoisted SDK deps ([9ce3c7e](https://github.com/chadbyte/clay/commit/9ce3c7e15622649ed5b9825ef2ce1047ca20e88b))

## [2.20.1-beta.11](https://github.com/chadbyte/clay/compare/v2.20.1-beta.10...v2.20.1-beta.11) (2026-04-02)


### Bug Fixes

* **os-users:** grant traverse permission on ancestor dirs for SDK worker ([c02de47](https://github.com/chadbyte/clay/commit/c02de470d190ea481fbc7d314f0c3c9a7cce8fe2))

## [2.20.1-beta.10](https://github.com/chadbyte/clay/compare/v2.20.1-beta.9...v2.20.1-beta.10) (2026-04-02)


### Bug Fixes

* **os-users:** skip recursive ACL on home directories ([e95ec4c](https://github.com/chadbyte/clay/commit/e95ec4c9b9d8f717d3ca7ac6d66e1bf554e34bff))

## [2.20.1-beta.9](https://github.com/chadbyte/clay/compare/v2.20.1-beta.8...v2.20.1-beta.9) (2026-04-02)


### Bug Fixes

* **daemon:** defer startup ACL provisioning to unblock IPC ([39743bd](https://github.com/chadbyte/clay/commit/39743bdda435785de515886b3f7b55f156d4dee0))

## [2.20.1-beta.8](https://github.com/chadbyte/clay/compare/v2.20.1-beta.7...v2.20.1-beta.8) (2026-04-02)


### Bug Fixes

* **config:** derive CLAY_HOME from CLAY_CONFIG in daemon mode ([40906b5](https://github.com/chadbyte/clay/commit/40906b5b46995aa04482ba726f51dc1ef1945ff4))

## [2.20.1-beta.7](https://github.com/chadbyte/clay/compare/v2.20.1-beta.6...v2.20.1-beta.7) (2026-04-02)


### Bug Fixes

* **config:** add fallbacks for getRealHome under sudo on GCE ([483e35b](https://github.com/chadbyte/clay/commit/483e35b863e8be80d95c39457e6cf82506981ad7))

## [2.20.1-beta.6](https://github.com/chadbyte/clay/compare/v2.20.1-beta.5...v2.20.1-beta.6) (2026-04-02)


### Bug Fixes

* **daemon:** add version and IPC debug logging at startup ([e3d2e79](https://github.com/chadbyte/clay/commit/e3d2e79d74837397341382e0c25c98bd57740c50))

## [2.20.1-beta.5](https://github.com/chadbyte/clay/compare/v2.20.1-beta.4...v2.20.1-beta.5) (2026-04-02)


### Bug Fixes

* **cli:** run OS user provisioning from CLI with live progress ([6773da9](https://github.com/chadbyte/clay/commit/6773da99d3d6f8a9d1f0428fb05dac568d34f555))

## [2.20.1-beta.4](https://github.com/chadbyte/clay/compare/v2.20.1-beta.3...v2.20.1-beta.4) (2026-04-02)


### Bug Fixes

* **cli:** add error handling for OS users toggle IPC ([92ba05d](https://github.com/chadbyte/clay/commit/92ba05ddf1a7a63347e5c5f9c11ecc5866b3cb2b))

## [2.20.1-beta.3](https://github.com/chadbyte/clay/compare/v2.20.1-beta.2...v2.20.1-beta.3) (2026-04-02)


### Bug Fixes

* **cli:** show config path in main menu and always expose setup code ([f1e6f99](https://github.com/chadbyte/clay/commit/f1e6f99fa3e0d3cbf10798ae0f91e83a99f5d4c5))

## [2.20.1-beta.2](https://github.com/chadbyte/clay/compare/v2.20.1-beta.1...v2.20.1-beta.2) (2026-04-02)


### Bug Fixes

* **cli:** auto-regenerate setup code and add daemon startup diagnostics ([b0e8987](https://github.com/chadbyte/clay/commit/b0e89873f707ff0a2f7d65fd07fe08e051a33d04))

## [2.20.1-beta.1](https://github.com/chadbyte/clay/compare/v2.20.0...v2.20.1-beta.1) (2026-04-02)


### Bug Fixes

* **cli:** resolve multi-user OS isolation setup workflow bugs ([52e52da](https://github.com/chadbyte/clay/commit/52e52da33fe75841c0a5884f60261e47b7767d49))

# [2.20.0](https://github.com/chadbyte/clay/compare/v2.19.0...v2.20.0) (2026-04-01)


### Bug Fixes

* **auth:** fix PIN digit input not displaying on force-change overlay ([5f432c0](https://github.com/chadbyte/clay/commit/5f432c07b856fa1125c7571685365273dfbae9de))
* **cli:** show setup code on main menu instead of pre-clear output ([4119465](https://github.com/chadbyte/clay/commit/41194651dd43953ec3c6def03b94dc11a24f01cf))
* **debate:** robust mention detection against markdown and all scripts ([3752027](https://github.com/chadbyte/clay/commit/3752027b12ec63f52aa7fe8b1fad5518768ccf69))
* **debate:** skip memory gate for digests and persist conclude state ([d38cbaf](https://github.com/chadbyte/clay/commit/d38cbafc9eb0a4794adf3953b8cd3454710ca90a))
* **input:** allow paste in debate modal and user settings ([b922771](https://github.com/chadbyte/clay/commit/b922771682945d9ddf848505e107ac8b93c71759)), closes [#debate-modal](https://github.com/chadbyte/clay/issues/debate-modal)
* **mate:** align sparkle activity inside thinking bubble consistently ([d5f3115](https://github.com/chadbyte/clay/commit/d5f311589434354b5f9a0d2da108ab2a07d00e2d))
* **mate:** mark debate memories as role-played positions ([2658de4](https://github.com/chadbyte/clay/commit/2658de4423d74e7b39a063d83c3611b957fb316c))
* **mate:** remove script runners from safe Bash whitelist ([0e7b85f](https://github.com/chadbyte/clay/commit/0e7b85f1b1051df8ec4c16721db49ded1f8b5de5))
* **mate:** replace three dots with sparkle activity inside thinking bubble ([654d2c4](https://github.com/chadbyte/clay/commit/654d2c49e391690363b0a0b09314539e6b29144a))
* **mates:** add first session detection to builtin mate prompts ([285dc4d](https://github.com/chadbyte/clay/commit/285dc4d8f29c7a2c6b3d2f079ef318fb2e506e02))
* **mates:** serve nested static files and include avatarCustom in mate DM ([c2741dd](https://github.com/chadbyte/clay/commit/c2741dd251d6c1588a1ba9976a8b0e2422e4e330))
* **memory:** use responsePreview for DM digest instead of delta fragments ([eb8ff60](https://github.com/chadbyte/clay/commit/eb8ff601992fed45f190d96cdf5b755d2c113d65))
* **mobile:** add scheduled task session grouping to mobile bottom sheet ([d8440ec](https://github.com/chadbyte/clay/commit/d8440ec2b4e1c0d31068f08a95179810af9f10ce)), closes [#252](https://github.com/chadbyte/clay/issues/252)
* **os-users:** check for ACL package before enabling OS user isolation ([8fdf2ba](https://github.com/chadbyte/clay/commit/8fdf2ba29356d44446b8242ccff5fa9c8f153f63))
* **palette:** render mate sessions with avatar and open DM on click ([1b32741](https://github.com/chadbyte/clay/commit/1b32741ce7e188932947fb7d7fab861e25dbba1c))
* **search:** include mention and debate entries in Cmd+K search ([fd28e8a](https://github.com/chadbyte/clay/commit/fd28e8a7d3529689ce7c873905c2ba7356c62e83))
* **status:** show server version and add update check feedback ([8c3743a](https://github.com/chadbyte/clay/commit/8c3743ae8ac63de408e4b33c9d13f30cd9d45cc5)), closes [#footer-version](https://github.com/chadbyte/clay/issues/footer-version) [#257](https://github.com/chadbyte/clay/issues/257)
* **ui:** close memory panel when switching projects or exiting DM mode ([9fc4333](https://github.com/chadbyte/clay/commit/9fc433396e137d7199fbea03853d05b0d2543260))
* **ui:** close terminal when file viewer opens ([248a8a7](https://github.com/chadbyte/clay/commit/248a8a71e59f0202ff6fa887b6400f358a5e84d8))
* **ui:** persist AskUserQuestion responses in session history ([fcbc999](https://github.com/chadbyte/clay/commit/fcbc999795847e86668f0ea9b772527798f58f8f))
* **ui:** use theme-aware background for PIN input boxes ([234ed6e](https://github.com/chadbyte/clay/commit/234ed6e4056523e8f3d0bee0045bd3486839b92c))
* **user-settings:** PIN validation on keyup and fix save field name ([4679320](https://github.com/chadbyte/clay/commit/46793200c9cc9a5075e81b86e0c92012d309d8e8))
* **user-settings:** swap sidebar and content background colors ([cc9f282](https://github.com/chadbyte/clay/commit/cc9f28248e7ee9a4ff1f6c1ec6d5b47472d85c31))


### Features

* **dm:** add memory extraction for mate DM conversations ([2304bad](https://github.com/chadbyte/clay/commit/2304bade15acfd1726db0c5c47eaeb526c96c787))
* **mate:** add Memory panel with read and delete for session digests ([560796a](https://github.com/chadbyte/clay/commit/560796acba8651687c28b6944406908498bd3d2c))
* **mate:** auto-approve safe Bash commands in mate sessions ([6c3e193](https://github.com/chadbyte/clay/commit/6c3e19300d6ae8f61bcabbbc858fd8eefe9a66eb))
* **mates:** add built-in mates Ally, Scout, Sage ([8d08c94](https://github.com/chadbyte/clay/commit/8d08c947bf54282189610c1fd03cd7879b1e5143))
* **mates:** add favorites system and builtin mate re-add flow ([c01e42a](https://github.com/chadbyte/clay/commit/c01e42a8c0abf3dc0931d96c83c0286655d0e638))
* **memory:** add memory summary system with Haiku gate and tab UI ([e418507](https://github.com/chadbyte/clay/commit/e4185074f36e8707920f9620c7839fc03e34e3f2))
* **mention:** add stop button to abort active mentions ([f524cf8](https://github.com/chadbyte/clay/commit/f524cf86bb7d7e4ad11153edbf246fd2100b2e7d))
* **mention:** support images, files, and pastes in [@mentions](https://github.com/mentions) ([cfd1caa](https://github.com/chadbyte/clay/commit/cfd1caa8240f9bebdd10931e1236d3063822d9d1))
* **notes:** add mate-specific sticky notes with read-only access for Claude ([5c23aee](https://github.com/chadbyte/clay/commit/5c23aeeb6c1910589c54869a57541ed313cab782))
* **permissions:** allow mode switching when --dangerously-skip-permissions is active ([f11ebd4](https://github.com/chadbyte/clay/commit/f11ebd4e96b0be3bef9804f576ea589c30288c8b)), closes [#256](https://github.com/chadbyte/clay/issues/256)
* **schedule:** add message scheduling with timer picker ([195d29d](https://github.com/chadbyte/clay/commit/195d29dcabba0c470aab10776f89edfb82257ae9))
* **upload:** include saved image file paths in SDK message context ([32dc3c3](https://github.com/chadbyte/clay/commit/32dc3c3b420400f71718607823100161b53d9cde))
* **usage:** add rate limit reset display and auto-continue setting ([8823ec3](https://github.com/chadbyte/clay/commit/8823ec38c29798ec776a848ff3551a24714029cf))
* **usage:** live countdown for rate limit reset in top bar ([6ca02c0](https://github.com/chadbyte/clay/commit/6ca02c028c52d58f9db940956dce219587737fd4))
* **usage:** show rate limit reset time and usage check link in top bar ([6609275](https://github.com/chadbyte/clay/commit/660927524bdee808603d3480090072553af85e6c)), closes [anthropics/claude-code#41185](https://github.com/anthropics/claude-code/issues/41185)

# [2.20.0-beta.4](https://github.com/chadbyte/clay/compare/v2.20.0-beta.3...v2.20.0-beta.4) (2026-04-01)


### Bug Fixes

* **ui:** use theme-aware background for PIN input boxes ([234ed6e](https://github.com/chadbyte/clay/commit/234ed6e4056523e8f3d0bee0045bd3486839b92c))

# [2.20.0-beta.3](https://github.com/chadbyte/clay/compare/v2.20.0-beta.2...v2.20.0-beta.3) (2026-04-01)


### Bug Fixes

* **auth:** fix PIN digit input not displaying on force-change overlay ([5f432c0](https://github.com/chadbyte/clay/commit/5f432c07b856fa1125c7571685365273dfbae9de))

# [2.20.0-beta.2](https://github.com/chadbyte/clay/compare/v2.20.0-beta.1...v2.20.0-beta.2) (2026-04-01)


### Bug Fixes

* **mates:** add first session detection to builtin mate prompts ([285dc4d](https://github.com/chadbyte/clay/commit/285dc4d8f29c7a2c6b3d2f079ef318fb2e506e02))
* **mates:** serve nested static files and include avatarCustom in mate DM ([c2741dd](https://github.com/chadbyte/clay/commit/c2741dd251d6c1588a1ba9976a8b0e2422e4e330))


### Features

* **mates:** add built-in mates Ally, Scout, Sage ([8d08c94](https://github.com/chadbyte/clay/commit/8d08c947bf54282189610c1fd03cd7879b1e5143))
* **mates:** add favorites system and builtin mate re-add flow ([c01e42a](https://github.com/chadbyte/clay/commit/c01e42a8c0abf3dc0931d96c83c0286655d0e638))
* **schedule:** add message scheduling with timer picker ([195d29d](https://github.com/chadbyte/clay/commit/195d29dcabba0c470aab10776f89edfb82257ae9))

# [2.20.0-beta.1](https://github.com/chadbyte/clay/compare/v2.19.0...v2.20.0-beta.1) (2026-03-31)


### Bug Fixes

* **cli:** show setup code on main menu instead of pre-clear output ([4119465](https://github.com/chadbyte/clay/commit/41194651dd43953ec3c6def03b94dc11a24f01cf))
* **debate:** robust mention detection against markdown and all scripts ([3752027](https://github.com/chadbyte/clay/commit/3752027b12ec63f52aa7fe8b1fad5518768ccf69))
* **debate:** skip memory gate for digests and persist conclude state ([d38cbaf](https://github.com/chadbyte/clay/commit/d38cbafc9eb0a4794adf3953b8cd3454710ca90a))
* **input:** allow paste in debate modal and user settings ([b922771](https://github.com/chadbyte/clay/commit/b922771682945d9ddf848505e107ac8b93c71759)), closes [#debate-modal](https://github.com/chadbyte/clay/issues/debate-modal)
* **mate:** align sparkle activity inside thinking bubble consistently ([d5f3115](https://github.com/chadbyte/clay/commit/d5f311589434354b5f9a0d2da108ab2a07d00e2d))
* **mate:** mark debate memories as role-played positions ([2658de4](https://github.com/chadbyte/clay/commit/2658de4423d74e7b39a063d83c3611b957fb316c))
* **mate:** remove script runners from safe Bash whitelist ([0e7b85f](https://github.com/chadbyte/clay/commit/0e7b85f1b1051df8ec4c16721db49ded1f8b5de5))
* **mate:** replace three dots with sparkle activity inside thinking bubble ([654d2c4](https://github.com/chadbyte/clay/commit/654d2c49e391690363b0a0b09314539e6b29144a))
* **memory:** use responsePreview for DM digest instead of delta fragments ([eb8ff60](https://github.com/chadbyte/clay/commit/eb8ff601992fed45f190d96cdf5b755d2c113d65))
* **mobile:** add scheduled task session grouping to mobile bottom sheet ([d8440ec](https://github.com/chadbyte/clay/commit/d8440ec2b4e1c0d31068f08a95179810af9f10ce)), closes [#252](https://github.com/chadbyte/clay/issues/252)
* **os-users:** check for ACL package before enabling OS user isolation ([8fdf2ba](https://github.com/chadbyte/clay/commit/8fdf2ba29356d44446b8242ccff5fa9c8f153f63))
* **palette:** render mate sessions with avatar and open DM on click ([1b32741](https://github.com/chadbyte/clay/commit/1b32741ce7e188932947fb7d7fab861e25dbba1c))
* **search:** include mention and debate entries in Cmd+K search ([fd28e8a](https://github.com/chadbyte/clay/commit/fd28e8a7d3529689ce7c873905c2ba7356c62e83))
* **status:** show server version and add update check feedback ([8c3743a](https://github.com/chadbyte/clay/commit/8c3743ae8ac63de408e4b33c9d13f30cd9d45cc5)), closes [#footer-version](https://github.com/chadbyte/clay/issues/footer-version) [#257](https://github.com/chadbyte/clay/issues/257)
* **ui:** close memory panel when switching projects or exiting DM mode ([9fc4333](https://github.com/chadbyte/clay/commit/9fc433396e137d7199fbea03853d05b0d2543260))
* **ui:** close terminal when file viewer opens ([248a8a7](https://github.com/chadbyte/clay/commit/248a8a71e59f0202ff6fa887b6400f358a5e84d8))
* **ui:** persist AskUserQuestion responses in session history ([fcbc999](https://github.com/chadbyte/clay/commit/fcbc999795847e86668f0ea9b772527798f58f8f))
* **user-settings:** PIN validation on keyup and fix save field name ([4679320](https://github.com/chadbyte/clay/commit/46793200c9cc9a5075e81b86e0c92012d309d8e8))
* **user-settings:** swap sidebar and content background colors ([cc9f282](https://github.com/chadbyte/clay/commit/cc9f28248e7ee9a4ff1f6c1ec6d5b47472d85c31))


### Features

* **dm:** add memory extraction for mate DM conversations ([2304bad](https://github.com/chadbyte/clay/commit/2304bade15acfd1726db0c5c47eaeb526c96c787))
* **mate:** add Memory panel with read and delete for session digests ([560796a](https://github.com/chadbyte/clay/commit/560796acba8651687c28b6944406908498bd3d2c))
* **mate:** auto-approve safe Bash commands in mate sessions ([6c3e193](https://github.com/chadbyte/clay/commit/6c3e19300d6ae8f61bcabbbc858fd8eefe9a66eb))
* **memory:** add memory summary system with Haiku gate and tab UI ([e418507](https://github.com/chadbyte/clay/commit/e4185074f36e8707920f9620c7839fc03e34e3f2))
* **mention:** add stop button to abort active mentions ([f524cf8](https://github.com/chadbyte/clay/commit/f524cf86bb7d7e4ad11153edbf246fd2100b2e7d))
* **mention:** support images, files, and pastes in [@mentions](https://github.com/mentions) ([cfd1caa](https://github.com/chadbyte/clay/commit/cfd1caa8240f9bebdd10931e1236d3063822d9d1))
* **notes:** add mate-specific sticky notes with read-only access for Claude ([5c23aee](https://github.com/chadbyte/clay/commit/5c23aeeb6c1910589c54869a57541ed313cab782))
* **permissions:** allow mode switching when --dangerously-skip-permissions is active ([f11ebd4](https://github.com/chadbyte/clay/commit/f11ebd4e96b0be3bef9804f576ea589c30288c8b)), closes [#256](https://github.com/chadbyte/clay/issues/256)
* **upload:** include saved image file paths in SDK message context ([32dc3c3](https://github.com/chadbyte/clay/commit/32dc3c3b420400f71718607823100161b53d9cde))
* **usage:** add rate limit reset display and auto-continue setting ([8823ec3](https://github.com/chadbyte/clay/commit/8823ec38c29798ec776a848ff3551a24714029cf))
* **usage:** live countdown for rate limit reset in top bar ([6ca02c0](https://github.com/chadbyte/clay/commit/6ca02c028c52d58f9db940956dce219587737fd4))
* **usage:** show rate limit reset time and usage check link in top bar ([6609275](https://github.com/chadbyte/clay/commit/660927524bdee808603d3480090072553af85e6c)), closes [anthropics/claude-code#41185](https://github.com/anthropics/claude-code/issues/41185)

# [2.19.0](https://github.com/chadbyte/clay/compare/v2.18.0...v2.19.0) (2026-03-29)


### Bug Fixes

* **auth:** separate auth token files and cookies for dev and prod servers ([f722f90](https://github.com/chadbyte/clay/commit/f722f90256ae601edd93d5cababfc31717a47d41))
* **scheduler:** fix ReferenceError in scheduled loop trigger ([8017366](https://github.com/chadbyte/clay/commit/80173663547fba82b0b270b7be1ec790c5e05edf))
* **scheduler:** reset loopFilesId in clearLoopState and loop_rerun ([bccac5b](https://github.com/chadbyte/clay/commit/bccac5bd77ae666fe06f3d5597fad42d6432157f))
* **scheduler:** use linked task dir for loop files in scheduled triggers ([ad194ef](https://github.com/chadbyte/clay/commit/ad194ef3490028aea7cf48036e8eba67f39f214e))
* **session:** skip title migration for already-migrated sessions ([1b69a1c](https://github.com/chadbyte/clay/commit/1b69a1c42d20b7d7e60f164c6b8727925fcea917))


### Features

* **session:** auto-continue after rate limit reset ([#244](https://github.com/chadbyte/clay/issues/244)) ([b6ae7d9](https://github.com/chadbyte/clay/commit/b6ae7d96c3bb9e1326e63153156a3059ec7b5204))
* **ui:** add user settings modal with account management and logout ([fa6e1f5](https://github.com/chadbyte/clay/commit/fa6e1f5347e4848b25d3aadc2a9a071e576ea427))

# [2.19.0-beta.2](https://github.com/chadbyte/clay/compare/v2.19.0-beta.1...v2.19.0-beta.2) (2026-03-29)


### Bug Fixes

* **auth:** separate auth token files and cookies for dev and prod servers ([f722f90](https://github.com/chadbyte/clay/commit/f722f90256ae601edd93d5cababfc31717a47d41))

# [2.19.0-beta.1](https://github.com/chadbyte/clay/compare/v2.18.1-beta.1...v2.19.0-beta.1) (2026-03-29)


### Bug Fixes

* **session:** skip title migration for already-migrated sessions ([1b69a1c](https://github.com/chadbyte/clay/commit/1b69a1c42d20b7d7e60f164c6b8727925fcea917))


### Features

* **session:** auto-continue after rate limit reset ([#244](https://github.com/chadbyte/clay/issues/244)) ([b6ae7d9](https://github.com/chadbyte/clay/commit/b6ae7d96c3bb9e1326e63153156a3059ec7b5204))
* **ui:** add user settings modal with account management and logout ([fa6e1f5](https://github.com/chadbyte/clay/commit/fa6e1f5347e4848b25d3aadc2a9a071e576ea427))

## [2.18.1-beta.1](https://github.com/chadbyte/clay/compare/v2.18.0...v2.18.1-beta.1) (2026-03-29)


### Bug Fixes

* **scheduler:** fix ReferenceError in scheduled loop trigger ([8017366](https://github.com/chadbyte/clay/commit/80173663547fba82b0b270b7be1ec790c5e05edf))
* **scheduler:** reset loopFilesId in clearLoopState and loop_rerun ([bccac5b](https://github.com/chadbyte/clay/commit/bccac5bd77ae666fe06f3d5597fad42d6432157f))
* **scheduler:** use linked task dir for loop files in scheduled triggers ([ad194ef](https://github.com/chadbyte/clay/commit/ad194ef3490028aea7cf48036e8eba67f39f214e))

# [2.18.0](https://github.com/chadbyte/clay/compare/v2.17.0...v2.18.0) (2026-03-28)


### Bug Fixes

* **debate:** add missing debate CSS and JS module files ([af6e0c2](https://github.com/chadbyte/clay/commit/af6e0c271750fad33c1dd5d3ce989c657a671a66))
* **debate:** persist round number and conclude state across reloads ([93930a7](https://github.com/chadbyte/clay/commit/93930a7b73409a0d7e1cfa605a3c47194b02a9e6))
* **debate:** remove round limit and fix conclude state persistence ([55fdb94](https://github.com/chadbyte/clay/commit/55fdb94ce0447c2c082cecdce59d22cfef9ebe21))
* **deps:** regenerate package-lock.json with missing entries ([77ea3fc](https://github.com/chadbyte/clay/commit/77ea3fc3bab2edbbfcbd2b32df48363c2eeddfca))
* **dm:** block main WS messages during mate WS connect transition ([3c51e3b](https://github.com/chadbyte/clay/commit/3c51e3bf918560c52b9f40935d763206fc70ddad))
* **dm:** insert pre-thinking avatar before sparkle activity indicator ([2075247](https://github.com/chadbyte/clay/commit/2075247b9b63d022db8314c0b120bea8182d8e69))
* **dm:** show sparkle activity indicator in mate DM mode ([78a4ad9](https://github.com/chadbyte/clay/commit/78a4ad9c1a0e16a7236f2ac97054f376a873c8f8))
* **dm:** suppress regular project history during mate DM restore ([39ae3d2](https://github.com/chadbyte/clay/commit/39ae3d2456558f21de9b1e49213233b44e694493))
* **input:** allow send when pending pastes, images, or files exist without text ([b95eb80](https://github.com/chadbyte/clay/commit/b95eb809838ad48b9910729280da543eff668cac))
* **loop:** add loopSource.name fallback to judge session title ([d28e2d1](https://github.com/chadbyte/clay/commit/d28e2d1dd2345d85aa1a98addbb2a871abdeadca))
* **mate:** auto-approve read tools in mate DM sessions ([d14c9e2](https://github.com/chadbyte/clay/commit/d14c9e255dafc8dcf98cd928ba632208672412b6))
* **mate:** auto-approve WebFetch for mates and fix DM restore on server restart ([59a78c5](https://github.com/chadbyte/clay/commit/59a78c5f302f9acaf57043d0fe89bf6b97591414))
* **mate:** pass mateDisplayName on daemon startup mate restoration ([c2e0cf7](https://github.com/chadbyte/clay/commit/c2e0cf7f358b6d6ccb03f6dea106c0b5d824d895))
* **mention:** add missing action bar to mention user messages ([fccb766](https://github.com/chadbyte/clay/commit/fccb76637173f7e0505d89efcc836732fe1a2be0))
* **mention:** improve mention UX in mate DM and project chat ([6927a4c](https://github.com/chadbyte/clay/commit/6927a4cc8eaef7e9e56f2780ec34fc5305a60b52))
* **mention:** include pasted content when sending mentions ([4c277c6](https://github.com/chadbyte/clay/commit/4c277c6b7d2a4fdbbc933b02a64f3e481d7864c3))
* **mention:** pass addToMessages to mention module context ([07391db](https://github.com/chadbyte/clay/commit/07391db192dad14bef9d09526408464230640808))
* **mention:** prevent digest callbacks from being nulled after onDone ([5580733](https://github.com/chadbyte/clay/commit/558073313593bd47738aec3955412d81cffeb79b))
* **mention:** render mention messages in correct DOM position during history replay ([9754135](https://github.com/chadbyte/clay/commit/9754135b0f441f66c1523b11dbe0b0ca2fe4b7a7))
* **mention:** use addToMessages for correct history replay ordering ([1c116ea](https://github.com/chadbyte/clay/commit/1c116eaa664d6ffb30d81e36acf87159cefc0d2c))
* **mobile:** eliminate gap between input bar and iOS keyboard ([5cd807d](https://github.com/chadbyte/clay/commit/5cd807dab576d530744cb97540a0da5417a997d1)), closes [#layout](https://github.com/chadbyte/clay/issues/layout)
* **scheduler:** allow "Run now" for loops without JUDGE.md ([aefe59e](https://github.com/chadbyte/clay/commit/aefe59eb189f09becf916322a8a59b7a22126d7b))
* **scheduler:** respect start time in cron intervals and fix session title leaks ([9f9c489](https://github.com/chadbyte/clay/commit/9f9c48987146ec7eda3e5eb0186fe38bd9ff50fd))
* **scheduler:** show next run in detail panel and recognize offset cron lists ([3264825](https://github.com/chadbyte/clay/commit/3264825f6baf44b8bae9f75b0da3002d2d90c830))
* **scheduler:** single run respects maxIterations, use schedule name in banner ([baa254b](https://github.com/chadbyte/clay/commit/baa254bbd96dda0ce04bb329cfac68ed5d0a3d9a))
* **scheduler:** use schedule id instead of linked task id for session grouping ([abd4cbd](https://github.com/chadbyte/clay/commit/abd4cbdbbbc4893ff1a6103a3b1e8f2b79052fbf))
* **session:** persist active session per project in localStorage ([8074574](https://github.com/chadbyte/clay/commit/807457497d871391489422037df6b3ff4b33ab62))
* **sessions:** guard ownerId assignment with isMultiUser() on session creation ([186a69e](https://github.com/chadbyte/clay/commit/186a69e717144e4832028de8282ebb32de1adf11))
* **sessions:** prevent ownerId backfill from scrambling session dates in single-user mode ([82df2bf](https://github.com/chadbyte/clay/commit/82df2bfe96401430fe082dd6a82120f9af29a644))
* **ui:** collapse user island in mate DM mode when sidebar is folded ([18530b5](https://github.com/chadbyte/clay/commit/18530b5970093b88e8f4ba33df7c2e157664891b))


### Features

* **debate:** add structured debate engine with moderator and panelist sessions ([8bf08f5](https://github.com/chadbyte/clay/commit/8bf08f54da2a4f0c08c886858194adbb02dc174b))
* **mention:** add [@mention](https://github.com/mention) system for invoking Mates in project chat ([4daee97](https://github.com/chadbyte/clay/commit/4daee97921e3c638003c95dd404eeabd92b3c9b1))
* **mention:** add session digest and memory section for mates ([3c58f17](https://github.com/chadbyte/clay/commit/3c58f17eb3e21bad178868655da3d03489919a13))
* **mention:** inject recent session digests into mention context ([ed3718b](https://github.com/chadbyte/clay/commit/ed3718beeb9d60ff9212087a1765d07b34538866))
* **mention:** route non-read tools through permission system ([09749cc](https://github.com/chadbyte/clay/commit/09749ccff04fb84dd339ee0dee3f387e090f84d9))
* **scheduler:** add past date blocking, smart defaults, and interval end conditions ([6cae0b6](https://github.com/chadbyte/clay/commit/6cae0b6aada96a8646d7fc909e355fa4dc8d9afa))
* **sidebar:** group scheduled task sessions by date to reduce clutter ([b7e2ae9](https://github.com/chadbyte/clay/commit/b7e2ae936eb69167ea710406ce39db2d4f4b303a))

# [2.18.0-beta.11](https://github.com/chadbyte/clay/compare/v2.18.0-beta.10...v2.18.0-beta.11) (2026-03-28)


### Bug Fixes

* **debate:** add missing debate CSS and JS module files ([af6e0c2](https://github.com/chadbyte/clay/commit/af6e0c271750fad33c1dd5d3ce989c657a671a66))
* **debate:** persist round number and conclude state across reloads ([93930a7](https://github.com/chadbyte/clay/commit/93930a7b73409a0d7e1cfa605a3c47194b02a9e6))
* **debate:** remove round limit and fix conclude state persistence ([55fdb94](https://github.com/chadbyte/clay/commit/55fdb94ce0447c2c082cecdce59d22cfef9ebe21))
* **deps:** regenerate package-lock.json with missing entries ([77ea3fc](https://github.com/chadbyte/clay/commit/77ea3fc3bab2edbbfcbd2b32df48363c2eeddfca))
* **dm:** block main WS messages during mate WS connect transition ([3c51e3b](https://github.com/chadbyte/clay/commit/3c51e3bf918560c52b9f40935d763206fc70ddad))
* **dm:** insert pre-thinking avatar before sparkle activity indicator ([2075247](https://github.com/chadbyte/clay/commit/2075247b9b63d022db8314c0b120bea8182d8e69))
* **input:** allow send when pending pastes, images, or files exist without text ([b95eb80](https://github.com/chadbyte/clay/commit/b95eb809838ad48b9910729280da543eff668cac))
* **loop:** add loopSource.name fallback to judge session title ([d28e2d1](https://github.com/chadbyte/clay/commit/d28e2d1dd2345d85aa1a98addbb2a871abdeadca))
* **mention:** pass addToMessages to mention module context ([07391db](https://github.com/chadbyte/clay/commit/07391db192dad14bef9d09526408464230640808))
* **mention:** render mention messages in correct DOM position during history replay ([9754135](https://github.com/chadbyte/clay/commit/9754135b0f441f66c1523b11dbe0b0ca2fe4b7a7))
* **mention:** use addToMessages for correct history replay ordering ([1c116ea](https://github.com/chadbyte/clay/commit/1c116eaa664d6ffb30d81e36acf87159cefc0d2c))
* **scheduler:** allow "Run now" for loops without JUDGE.md ([aefe59e](https://github.com/chadbyte/clay/commit/aefe59eb189f09becf916322a8a59b7a22126d7b))
* **scheduler:** single run respects maxIterations, use schedule name in banner ([baa254b](https://github.com/chadbyte/clay/commit/baa254bbd96dda0ce04bb329cfac68ed5d0a3d9a))
* **scheduler:** use schedule id instead of linked task id for session grouping ([abd4cbd](https://github.com/chadbyte/clay/commit/abd4cbdbbbc4893ff1a6103a3b1e8f2b79052fbf))
* **sessions:** guard ownerId assignment with isMultiUser() on session creation ([186a69e](https://github.com/chadbyte/clay/commit/186a69e717144e4832028de8282ebb32de1adf11))
* **sessions:** prevent ownerId backfill from scrambling session dates in single-user mode ([82df2bf](https://github.com/chadbyte/clay/commit/82df2bfe96401430fe082dd6a82120f9af29a644))
* **ui:** collapse user island in mate DM mode when sidebar is folded ([18530b5](https://github.com/chadbyte/clay/commit/18530b5970093b88e8f4ba33df7c2e157664891b))


### Features

* **debate:** add structured debate engine with moderator and panelist sessions ([8bf08f5](https://github.com/chadbyte/clay/commit/8bf08f54da2a4f0c08c886858194adbb02dc174b))
* **scheduler:** add past date blocking, smart defaults, and interval end conditions ([6cae0b6](https://github.com/chadbyte/clay/commit/6cae0b6aada96a8646d7fc909e355fa4dc8d9afa))
* **sidebar:** group scheduled task sessions by date to reduce clutter ([b7e2ae9](https://github.com/chadbyte/clay/commit/b7e2ae936eb69167ea710406ce39db2d4f4b303a))

# [2.18.0-beta.10](https://github.com/chadbyte/clay/compare/v2.18.0-beta.9...v2.18.0-beta.10) (2026-03-27)


### Bug Fixes

* **scheduler:** respect start time in cron intervals and fix session title leaks ([9f9c489](https://github.com/chadbyte/clay/commit/9f9c48987146ec7eda3e5eb0186fe38bd9ff50fd))
* **scheduler:** show next run in detail panel and recognize offset cron lists ([3264825](https://github.com/chadbyte/clay/commit/3264825f6baf44b8bae9f75b0da3002d2d90c830))

# [2.18.0-beta.9](https://github.com/chadbyte/clay/compare/v2.18.0-beta.8...v2.18.0-beta.9) (2026-03-26)


### Bug Fixes

* **session:** persist active session per project in localStorage ([8074574](https://github.com/chadbyte/clay/commit/807457497d871391489422037df6b3ff4b33ab62))

# [2.18.0-beta.8](https://github.com/chadbyte/clay/compare/v2.18.0-beta.7...v2.18.0-beta.8) (2026-03-26)


### Bug Fixes

* **mate:** auto-approve WebFetch for mates and fix DM restore on server restart ([59a78c5](https://github.com/chadbyte/clay/commit/59a78c5f302f9acaf57043d0fe89bf6b97591414))

# [2.18.0-beta.7](https://github.com/chadbyte/clay/compare/v2.18.0-beta.6...v2.18.0-beta.7) (2026-03-26)


### Bug Fixes

* **dm:** suppress regular project history during mate DM restore ([39ae3d2](https://github.com/chadbyte/clay/commit/39ae3d2456558f21de9b1e49213233b44e694493))

# [2.18.0-beta.6](https://github.com/chadbyte/clay/compare/v2.18.0-beta.5...v2.18.0-beta.6) (2026-03-26)


### Bug Fixes

* **mate:** pass mateDisplayName on daemon startup mate restoration ([c2e0cf7](https://github.com/chadbyte/clay/commit/c2e0cf7f358b6d6ccb03f6dea106c0b5d824d895))

# [2.18.0-beta.5](https://github.com/chadbyte/clay/compare/v2.18.0-beta.4...v2.18.0-beta.5) (2026-03-26)


### Bug Fixes

* **mate:** auto-approve read tools in mate DM sessions ([d14c9e2](https://github.com/chadbyte/clay/commit/d14c9e255dafc8dcf98cd928ba632208672412b6))

# [2.18.0-beta.4](https://github.com/chadbyte/clay/compare/v2.18.0-beta.3...v2.18.0-beta.4) (2026-03-24)


### Bug Fixes

* **dm:** show sparkle activity indicator in mate DM mode ([78a4ad9](https://github.com/chadbyte/clay/commit/78a4ad9c1a0e16a7236f2ac97054f376a873c8f8))


### Features

* **mention:** inject recent session digests into mention context ([ed3718b](https://github.com/chadbyte/clay/commit/ed3718beeb9d60ff9212087a1765d07b34538866))

# [2.18.0-beta.3](https://github.com/chadbyte/clay/compare/v2.18.0-beta.2...v2.18.0-beta.3) (2026-03-24)


### Bug Fixes

* **mention:** include pasted content when sending mentions ([4c277c6](https://github.com/chadbyte/clay/commit/4c277c6b7d2a4fdbbc933b02a64f3e481d7864c3))
* **mention:** prevent digest callbacks from being nulled after onDone ([5580733](https://github.com/chadbyte/clay/commit/558073313593bd47738aec3955412d81cffeb79b))


### Features

* **mention:** route non-read tools through permission system ([09749cc](https://github.com/chadbyte/clay/commit/09749ccff04fb84dd339ee0dee3f387e090f84d9))

# [2.18.0-beta.2](https://github.com/chadbyte/clay/compare/v2.18.0-beta.1...v2.18.0-beta.2) (2026-03-24)


### Bug Fixes

* **mention:** add missing action bar to mention user messages ([fccb766](https://github.com/chadbyte/clay/commit/fccb76637173f7e0505d89efcc836732fe1a2be0))

# [2.18.0-beta.1](https://github.com/chadbyte/clay/compare/v2.17.0...v2.18.0-beta.1) (2026-03-24)


### Bug Fixes

* **mention:** improve mention UX in mate DM and project chat ([6927a4c](https://github.com/chadbyte/clay/commit/6927a4cc8eaef7e9e56f2780ec34fc5305a60b52))
* **mobile:** eliminate gap between input bar and iOS keyboard ([5cd807d](https://github.com/chadbyte/clay/commit/5cd807dab576d530744cb97540a0da5417a997d1)), closes [#layout](https://github.com/chadbyte/clay/issues/layout)


### Features

* **mention:** add [@mention](https://github.com/mention) system for invoking Mates in project chat ([4daee97](https://github.com/chadbyte/clay/commit/4daee97921e3c638003c95dd404eeabd92b3c9b1))
* **mention:** add session digest and memory section for mates ([3c58f17](https://github.com/chadbyte/clay/commit/3c58f17eb3e21bad178868655da3d03489919a13))

# [2.17.0](https://github.com/chadbyte/clay/compare/v2.16.0...v2.17.0) (2026-03-24)


### Bug Fixes

* **cli:** move mkcert deprecation warning to main menu after render ([a702390](https://github.com/chadbyte/clay/commit/a70239065497bd35adf79fe414f8cf30e20210ce))
* **images:** hydrate image refs during session switch replay ([a71c771](https://github.com/chadbyte/clay/commit/a71c771c7f29c0654d21fef51a1a5b1de7f91e7a))
* **profile:** show custom avatar in popover header on open ([a7902e4](https://github.com/chadbyte/clay/commit/a7902e4b0c0b1322bcd9004da96782e31c5b68a2))
* **sw:** skip cross-origin requests in service worker fetch handler ([14615ed](https://github.com/chadbyte/clay/commit/14615edf56d1c1b4424aa3a760eaed9e61beb0e7))
* **tls:** skip stale mkcert cert when mkcert is uninstalled ([0b4f6bf](https://github.com/chadbyte/clay/commit/0b4f6bf33c89af54f4ff77f0245ffcaeb39ab01e))
* **ui:** prevent command palette from hiding behind iPad keyboard ([3008138](https://github.com/chadbyte/clay/commit/3008138a133fa2989a669843f4108e6c01ac38f4))


### Features

* **avatar:** add custom avatar upload with position picker ([a6a3497](https://github.com/chadbyte/clay/commit/a6a34970f9692c954545121b77872f939992e05c))
* **tls:** use builtin *.d.clay.studio wildcard certificate by default ([4c30000](https://github.com/chadbyte/clay/commit/4c30000ff4004286469de0d0016a6d6c920b7020))
* **ui:** add /pwa route and fix top bar pill layout ([efda994](https://github.com/chadbyte/clay/commit/efda994805d6d321afc07f36d7716bfd3eea4e79))
* **ui:** add Share button with QR code on desktop top bar ([851ee31](https://github.com/chadbyte/clay/commit/851ee31d84e62b4e7b51df035871cef8a36c6c9c))

# [2.17.0-beta.10](https://github.com/chadbyte/clay/compare/v2.17.0-beta.9...v2.17.0-beta.10) (2026-03-24)


### Bug Fixes

* **profile:** show custom avatar in popover header on open ([a7902e4](https://github.com/chadbyte/clay/commit/a7902e4b0c0b1322bcd9004da96782e31c5b68a2))

# [2.17.0-beta.9](https://github.com/chadbyte/clay/compare/v2.17.0-beta.8...v2.17.0-beta.9) (2026-03-24)


### Features

* **ui:** add Share button with QR code on desktop top bar ([851ee31](https://github.com/chadbyte/clay/commit/851ee31d84e62b4e7b51df035871cef8a36c6c9c))

# [2.17.0-beta.8](https://github.com/chadbyte/clay/compare/v2.17.0-beta.7...v2.17.0-beta.8) (2026-03-23)


### Features

* **avatar:** add custom avatar upload with position picker ([a6a3497](https://github.com/chadbyte/clay/commit/a6a34970f9692c954545121b77872f939992e05c))

# [2.17.0-beta.7](https://github.com/chadbyte/clay/compare/v2.17.0-beta.6...v2.17.0-beta.7) (2026-03-23)


### Bug Fixes

* **ui:** prevent command palette from hiding behind iPad keyboard ([3008138](https://github.com/chadbyte/clay/commit/3008138a133fa2989a669843f4108e6c01ac38f4))

# [2.17.0-beta.6](https://github.com/chadbyte/clay/compare/v2.17.0-beta.5...v2.17.0-beta.6) (2026-03-23)


### Bug Fixes

* **images:** hydrate image refs during session switch replay ([a71c771](https://github.com/chadbyte/clay/commit/a71c771c7f29c0654d21fef51a1a5b1de7f91e7a))

# [2.17.0-beta.5](https://github.com/chadbyte/clay/compare/v2.17.0-beta.4...v2.17.0-beta.5) (2026-03-23)


### Features

* **ui:** add /pwa route and fix top bar pill layout ([efda994](https://github.com/chadbyte/clay/commit/efda994805d6d321afc07f36d7716bfd3eea4e79))

# [2.17.0-beta.4](https://github.com/chadbyte/clay/compare/v2.17.0-beta.3...v2.17.0-beta.4) (2026-03-23)


### Bug Fixes

* **tls:** skip stale mkcert cert when mkcert is uninstalled ([0b4f6bf](https://github.com/chadbyte/clay/commit/0b4f6bf33c89af54f4ff77f0245ffcaeb39ab01e))

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
