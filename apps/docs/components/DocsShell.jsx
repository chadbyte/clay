import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import GitHubStars from "./GitHubStars.jsx";
import { rankDocuments } from "./document-search.js";

function SearchIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>; }
function MenuIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>; }

function DocsShell({ documents, groups, currentSlug, children }) {
  var [searchOpen, setSearchOpen] = useState(false);
  var [mobileOpen, setMobileOpen] = useState(false);
  var [mobileViewport, setMobileViewport] = useState(false);
  var [query, setQuery] = useState("");
  var searchRef = useRef(null);
  var searchTriggerRef = useRef(null);
  var dialogRef = useRef(null);
  var visibleGroups = groups.filter(function (group) { return group.visible !== false; });
  var visibleDocuments = documents.filter(function (document) { return !document.legacy; });
  var results = rankDocuments(visibleDocuments, query);

  useEffect(function () {
    function updateViewport() { setMobileViewport(window.matchMedia("(max-width: 799px)").matches); }
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return function () { window.removeEventListener("resize", updateViewport); };
  }, []);

  useEffect(function () {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openSearch(); }
      if (event.key === "Escape") { if (searchOpen) closeSearch(true); else setMobileOpen(false); }
    }
    window.addEventListener("keydown", onKeyDown);
    return function () { window.removeEventListener("keydown", onKeyDown); };
  }, [searchOpen]);

  useEffect(function () {
    if (searchOpen && searchRef.current) searchRef.current.focus();
    if (searchOpen && dialogRef.current) dialogRef.current.scrollTop = 0;
  }, [searchOpen]);

  function openSearch() { setSearchOpen(true); setMobileOpen(false); }
  function closeSearch(returnFocus) { setSearchOpen(false); setQuery(""); if (returnFocus && searchTriggerRef.current) searchTriggerRef.current.focus(); }
  function containDialogFocus(event) {
    if (event.key !== "Tab" || !dialogRef.current) return;
    var focusable = dialogRef.current.querySelectorAll("button, input, a[href]");
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div className="site-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="topbar"><div className="brand-lockup"><Link className="brand" href="/"><img className="brand-symbol" src="/clay-studio-symbol.png" width="28" height="28" alt="" /><img className="brand-wordmark" src="/brand/clay-studio-wordmark-bold.svg" width="115" height="28" alt="Clay Studio" /></Link><GitHubStars /></div><div className="topbar-actions"><button ref={searchTriggerRef} className="search-trigger" type="button" onClick={openSearch} aria-label="Search documentation"><SearchIcon /><span>Search docs</span><kbd>⌘ K</kbd></button><button className="menu-button" type="button" onClick={function () { setMobileOpen(!mobileOpen); }} aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen}>{mobileOpen ? <CloseIcon /> : <MenuIcon />}</button></div></header>
    <div className="docs-frame">
      <aside className={"sidebar" + (mobileOpen ? " sidebar-open" : "")} aria-hidden={mobileViewport && !mobileOpen ? "true" : undefined} inert={mobileViewport && !mobileOpen ? true : undefined}><nav className="sidebar-inner" aria-label="Documentation"><div className="sidebar-eyebrow">Documentation</div><Link className={currentSlug === "" ? "sidebar-link active" : "sidebar-link"} href="/" aria-current={currentSlug === "" ? "page" : undefined} onClick={function () { setMobileOpen(false); }}>Overview</Link>{visibleGroups.map(function (group) { var current = group.pages.some(function (page) { return page[0] === currentSlug; }); return <details className="sidebar-group" key={group.id} open={current || currentSlug === "" && group.id === "start"}><summary className="sidebar-group-title">{group.title}</summary>{group.pages.map(function (page) { var document = documents.find(function (item) { return item.slug === page[0]; }); return <Link className={currentSlug === document.slug ? "sidebar-link active" : "sidebar-link"} href={"/docs/" + document.slug} aria-current={currentSlug === document.slug ? "page" : undefined} key={document.slug} onClick={function () { setMobileOpen(false); }}>{document.title}</Link>; })}</details>; })}<div className="sidebar-footer"><span className="signal-dot" aria-hidden="true"></span>Built for local work</div></nav></aside>
      <main id="main-content" className="main-content" tabIndex="-1">{children}</main>
    </div>
    {searchOpen ? <div className="search-backdrop" role="presentation" onMouseDown={function () { closeSearch(true); }}><div ref={dialogRef} className="search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-dialog-title" onKeyDown={containDialogFocus} onMouseDown={function (event) { event.stopPropagation(); }}><div className="search-dialog-header"><span id="search-dialog-title">Search documentation</span><button type="button" className="dialog-close" onClick={function () { closeSearch(true); }}>Close <kbd>Esc</kbd></button></div><div className="search-input-wrap"><SearchIcon /><input ref={searchRef} value={query} onChange={function (event) { setQuery(event.target.value); }} placeholder="Search documentation" aria-label="Search documentation" /></div><div className="search-results">{results.length ? results.map(function (document) { return <Link href={"/docs/" + document.slug} key={document.slug} onClick={function () { closeSearch(false); }}><span className="result-group">{document.group}</span><strong>{document.title}</strong><small>{document.description}</small></Link>; }) : <div className="search-empty"><strong>No guides found</strong><span>Try a different word or press Escape to close.</span></div>}</div><div className="search-hint"><kbd>Esc</kbd> to close <span>⌘ K anytime</span></div></div></div> : null}
  </div>;
}

export default DocsShell;
