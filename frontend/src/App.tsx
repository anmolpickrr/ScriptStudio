import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { SessionProvider, useSession } from "./session";
import { BrandMark, ErrorBoundary, Icon, isMac, Kbd, Menu, PageSkeleton } from "./components/ui";
import CommandPalette from "./components/CommandPalette";
import ConnectSetup from "./components/ConnectSetup";
import SignIn from "./pages/SignIn";
import Home from "./pages/Home";
import NewScript from "./pages/NewScript";
import Scripts from "./pages/Scripts";
import ScriptView from "./pages/ScriptView";
import Library from "./pages/Library";
import FormatEditor from "./pages/FormatEditor";

export default function App() {
  return (
    <SessionProvider>
      {(session, error, waking) => {
        if (error && !session) return (
          <div className="center"><div className="card empty" style={{ maxWidth: 440 }}>
            <h2>Can't reach ScriptStudio</h2><p>{error}</p>
            <button className="btn primary" onClick={() => window.location.reload()}>Try again</button></div></div>
        );
        if (!session) return <Waking slow={waking} />;
        if (!session.user) return <SignIn />;
        return <Shell />;
      }}
    </SessionProvider>
  );
}

const NAV = [
  { to: "/", label: "Studio", icon: <Icon.home />, end: true },
  { to: "/scripts", label: "Scripts", icon: <Icon.doc /> },
  { to: "/library", label: "Library", icon: <Icon.star /> },
  { to: "/format", label: "Format", icon: <Icon.layout /> },
];

function Shell() {
  const { user, config, options, signOut } = useSession();
  const [palette, setPalette] = useState(false);
  const [connect, setConnect] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => { document.title = "ScriptStudio"; }, []);

  // ⌘K / Ctrl+K opens the palette; "n" starts a new script (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName) || (e.target as HTMLElement).isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((o) => !o); }
      else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "n") { e.preventDefault(); nav("/new"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  const who = user!.guest ? "Guest workspace" : user!.name || user!.email;
  return (
    <div className="app canvas">
      <header className="dock">
        <BrandMark small />
        <nav className="dock-nav" aria-label="Main navigation">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end}>{n.icon}<span>{n.label}</span></NavLink>)}
        </nav>
        <div className="dock-right">
          <button className="dock-search" onClick={() => setPalette(true)} aria-label="Search and jump (Ctrl+K)">
            <Icon.search /><span>Search</span><Kbd>{isMac ? "⌘" : "Ctrl"} K</Kbd>
          </button>
          <NavLink to="/new" className="btn primary dock-new"><Icon.plus /> <span>New script</span></NavLink>
          <Menu trigger={(toggle) => (
            <button className="dock-me" onClick={toggle} aria-label="Account" title={who}>
              {user!.picture ? <img src={user!.picture} alt="" referrerPolicy="no-referrer" /> : <Icon.user />}
            </button>
          )}>
            {(close) => (<>
              <div className="menu-head"><b>{who}</b><small>{user!.admin ? "Admin" : user!.guest ? "Saved in this browser" : user!.email}</small></div>
              <button onClick={() => { close(); setPalette(true); }}>Search & jump<small>{isMac ? "⌘" : "Ctrl"} K anywhere</small></button>
              <button onClick={() => { close(); nav("/new"); }}>New script<small>Press N anywhere</small></button>
              <button onClick={() => { close(); setConnect(true); }}>Connect Claude / ChatGPT<small>Write with your own plan, no copy-paste</small></button>
              {config.auth_mode === "google" && <button onClick={() => { close(); signOut(); }}>Sign out</button>}
            </>)}
          </Menu>
        </div>
      </header>

      {config.demo_mode && <div className="demo-strip"><span className="pulse-dot" /><span><b>Demo mode</b> — automatic scripts are placeholders until a free <code>GEMINI_API_KEY</code> is added. ChatGPT and Claude work either way.</span></div>}

      <main className="content">
        <ErrorBoundary>
          <div className="page" key={loc.pathname}>
            {!options ? <PageSkeleton /> : (
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/new" element={<NewScript />} />
                <Route path="/scripts" element={<Scripts />} />
                <Route path="/scripts/:id" element={<ScriptView />} />
                <Route path="/library" element={<Library />} />
                <Route path="/format" element={<FormatEditor />} />
                <Route path="*" element={<div className="card empty"><div className="art">🎬</div><h2>This scene doesn't exist</h2><p>The page you're looking for isn't here.</p><NavLink className="btn primary" to="/">Back to the studio</NavLink></div>} />
              </Routes>
            )}
          </div>
        </ErrorBoundary>
      </main>

      <nav className="tabbar" aria-label="Main navigation">
        {NAV.slice(0, 2).map((n) => <NavLink key={n.to} to={n.to} end={n.end}>{n.icon}<span>{n.label}</span></NavLink>)}
        <NavLink to="/new" className="tab-new" aria-label="New script"><Icon.plus /></NavLink>
        {NAV.slice(2).map((n) => <NavLink key={n.to} to={n.to}>{n.icon}<span>{n.label}</span></NavLink>)}
      </nav>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      {connect && <ConnectSetup onClose={() => setConnect(false)} />}
    </div>
  );
}

/** First load: the same branded loading screen as Capstudio. The free server sleeps when idle, so after a few
 *  seconds it also explains the wait. index.html draws the same screen before the app starts. */
function Waking({ slow }: { slow: boolean }) {
  return (
    <div className="loading-screen">
      <div className="loading-box">
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="ScriptStudio by fastrr" />
        <div className="loading-bar" aria-hidden="true"><i /></div>
        <p className="loading-msg" role="status" aria-label="Loading">
          {slow && <>Waking up the studio…<small>Free hosting naps when nobody is using it. The first load can take up to a minute.</small></>}
        </p>
      </div>
    </div>
  );
}
