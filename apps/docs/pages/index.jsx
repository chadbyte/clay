import Link from "next/link";
import Head from "next/head";
import DocsShell from "../components/DocsShell.jsx";
import siteConfig from "../lib/site-config.cjs";

export async function getStaticProps() {
  var content = await import("../lib/content.cjs");
  return { props: { documents: await content.getDocumentSummaries(), groups: content.getGroups(), site: siteConfig.getSiteConfig() } };
}

function ArrowIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" /></svg>;
}

function IndexPage({ documents, groups, site }) {
  var origin = site.publicOrigin;
  var visibleGroups = groups.filter(function (group) { return group.visible !== false; });
  return <DocsShell documents={documents} groups={groups} currentSlug="">
    <Head><title>Clay Studio — Projects, agents, and Mates</title><meta name="description" content="Bring your teammates and AI together in Clay Studio. Give your conversations, knowledge, and projects a home on your own system, with open-source code you can inspect." /><meta name="robots" content={site.indexable ? "index,follow" : "noindex,nofollow"} />{origin ? <><link rel="canonical" href={origin + "/"} /><meta property="og:title" content="Clay Studio — Projects, agents, and Mates" /><meta property="og:description" content="Bring your teammates and AI together in Clay Studio. Give your conversations, knowledge, and projects a home on your own system, with open-source code you can inspect." /><meta property="og:url" content={origin + "/"} /></> : null}</Head>
    <section className="home-intro" aria-labelledby="home-title">
      <div className="home-intro-top">
        <div className="home-intro-copy">
          <h1 id="home-title" className="home-title home-identity"><img className="identity-symbol" src="/clay-studio-symbol.png" width="48" height="48" alt="" /><img className="identity-wordmark" src="/brand/clay-studio-wordmark-bold.svg" width="230" height="56" alt="Clay Studio" /></h1>
          <p className="home-catchphrase">Where the minds work together</p>
          <p className="home-lede">Bring your teammates and AI together to build, solve problems, and explore new ideas. Keep your conversations and projects connected in a workspace on your own system, even as you change models. Open source, so you can see how it all works.</p>
          <p className="home-ownership-emphasis">Your thinking deserves a home of its own.</p>
          <div className="home-actions">
            <Link className="primary-action" href="/docs/getting-started">Get started <ArrowIcon /></Link>
            <Link className="text-action" href="/docs/clay-vs-mates">Projects and Mates <ArrowIcon /></Link>
          </div>
        </div>
        <div className="home-providers" aria-label="Supported providers">
          <div className="home-providers-heading"><small>Supported providers</small><Link href="/docs/models-and-providers">Models and providers <ArrowIcon /></Link></div>
          <ul>
            <li><img src="/brand/claude-code-avatar.png" width="20" height="20" alt="" />Claude Code</li>
            <li><img src="/brand/codex-avatar.png" width="20" height="20" alt="" />Codex</li>
            <li><img src="/brand/muse-avatar.svg" width="20" height="20" alt="" />Muse Code</li>
            <li><img src="/brand/grok-avatar.svg" width="20" height="20" alt="" />Grok Build</li>
            <li><img src="/brand/kimi-avatar.svg" width="20" height="20" alt="" />Kimi Code</li>
            <li><img src="/brand/copilot-avatar.svg" width="20" height="20" alt="" />GitHub Copilot CLI</li>
            <li><img src="/brand/qwen-avatar.svg" width="20" height="20" alt="" />Qwen Code</li>
            <li><img src="/brand/junie-avatar.svg" width="20" height="20" alt="" />Junie CLI</li>
            <li><img src="/brand/antigravity-avatar.png" width="20" height="20" alt="" />Antigravity CLI</li>
            <li><img src="/brand/opencode-avatar.svg" width="20" height="20" alt="" />OpenCode</li>
            <li><img src="/brand/kiro-avatar.svg" width="20" height="20" alt="" />Kiro CLI</li>
          </ul>
        </div>
      </div>
      <figure className="home-workspace">
        <a href="/images/manual/weekend-notes-workspace-clay.webp" aria-label="View the Clay Studio workspace screenshot at full size"><img src="/images/manual/weekend-notes-workspace-clay.webp" width="1920" height="800" fetchPriority="high" alt="The full Clay Studio workspace with Codex's generated alpine-lake illustration, Claude Code's Weekend Notes implementation, and a floating Clay conversation summarizing both sessions." /></a>
        <figcaption>Weekend Notes in Split View: Codex generates the illustration, Claude Code builds the app, and Clay summarizes the two conversations. <Link href="/docs/navigation">Workspace guide <span aria-hidden="true">→</span></Link></figcaption>
      </figure>
    </section>
    <section className="home-featured" aria-labelledby="featured-title">
      <div className="home-featured-heading"><h2 id="featured-title">Featured</h2><p>Keep the tools, conversations, and context of your work close together.</p></div>
      <div className="home-features">
        <article>
          <a className="feature-image" href="/images/manual/weekend-notes-codex-claude.webp" aria-label="View the multi-provider workspace screenshot at full size"><img src="/images/manual/weekend-notes-codex-claude.webp" width="1280" height="866" loading="lazy" alt="Different coding providers working in separate Clay Studio conversations." /></a>
          <h3>Multi-vendor support</h3>
          <p>Choose an installed provider for each session. Keep different agents and models in one workspace, with their own conversations and controls.</p>
          <Link className="text-action" href="/docs/models-and-providers">Models and providers <ArrowIcon /></Link>
        </article>
        <article>
          <a className="feature-image" href="/images/manual/featured-browser-weekend-notes.webp" aria-label="View the built-in browser screenshot at full size"><img src="/images/manual/featured-browser-weekend-notes.webp" width="1280" height="866" loading="lazy" alt="The working Weekend Notes demo app open in Clay Studio's built-in Browser, with shared control and viewport controls." /></a>
          <h3>Built-in browser</h3>
          <p>Open your app beside the conversation. Browse with your agent, inspect the result, and pause shared control whenever you want to take over.</p>
          <Link className="text-action" href="/docs/browser">Browser guide <ArrowIcon /></Link>
        </article>
        <article>
          <a className="feature-image" href="/images/manual/conversation-palette.webp" aria-label="View recent conversations in the command palette at full size"><img src="/images/manual/conversation-palette.webp" width="564" height="238" loading="lazy" alt="Recent conversations in the Clay Studio command palette." /></a>
          <h3>Continuity across work</h3>
          <p>Saved conversations and project records keep past decisions within reach. Ask Clay to help find where you left off across projects.</p>
          <Link className="text-action" href="/docs/session-history-search">History and search <ArrowIcon /></Link>
        </article>
        <article>
          <figure className="feature-demo"><a className="feature-image" href="/images/manual/illustrative-five-pane-grid.webp" aria-label="View the illustrative five-pane workspace at full size"><img src="/images/manual/illustrative-five-pane-grid.webp" width="1592" height="992" loading="lazy" alt="Illustrative five-pane Clay Studio Grid layout with sample conversations labelled Claude Code, Codex, Muse Code, Kiro CLI, and a second Codex pane." /></a><figcaption>Illustrative five-pane workspace.</figcaption></figure>
          <h3>Multi-pane views</h3>
          <p>Keep conversations, files, terminals, and browser views within reach. Split sessions, dock a tool, and resize the workspace around the task.</p>
          <Link className="text-action" href="/docs/workbench-layout">Arrange your workspace <ArrowIcon /></Link>
        </article>
      </div>
    </section>
    <div className="home-directory-heading" id="guides"><h2>Documentation</h2><p>Setup, workspace tools, and reference guides.</p></div>
    <div className="home-grid">{visibleGroups.map(function (group) { return <section className="home-section" key={group.id}><div className="section-label">{group.title}</div>{group.pages.map(function (page) { var document = documents.find(function (item) { return item.slug === page[0]; }); return <Link className="guide-card" href={"/docs/" + document.slug} key={document.slug}><span><strong>{document.title}</strong><small>{document.description}</small></span><ArrowIcon /></Link>; })}</section>; })}</div>
    <div className="home-note"><span className="signal-dot" aria-hidden="true"></span><span>Cloud providers process the requests you send to them. <a href="/docs/getting-started#understand-where-information-goes">How data flows <span aria-hidden="true">→</span></a></span></div>
  </DocsShell>;
}

export default IndexPage;
