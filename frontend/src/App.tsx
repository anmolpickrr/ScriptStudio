import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { SessionProvider, useSession } from "./session";
import { BrandMark, ErrorBoundary, Icon, PageSkeleton } from "./components/ui";
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

function Shell() {
  const { user, config, options, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => { document.title = "ScriptStudio"; }, []);

  return (
    <div className="shell canvas">
      <header className="topbar">
        <button className="btn ghost icon" aria-label="Open menu" onClick={() => setOpen(true)}><Icon.menu /></button>
        <div className="grow"><BrandMark small /></div>
        <NavLink to="/new" className="btn primary sm">+ New</NavLink>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`side ${open ? "open" : ""}`} aria-label="Main navigation">
        <BrandMark />
        <nav className="nav">
          <NavLink to="/new" className="new"><Icon.plus />New script</NavLink>
          <NavLink to="/" end><Icon.home />Home</NavLink>
          <NavLink to="/scripts"><Icon.doc />My scripts</NavLink>
          <NavLink to="/library"><Icon.star />House library</NavLink>
          <NavLink to="/format"><Icon.layout />House format</NavLink>
        </nav>
        <div className="spacer" />
        <div className="tip"><b>Free to use</b>Write with ScriptStudio AI, or with your own ChatGPT or Claude plan.</div>
        <div className="me">
          {user!.picture ? <img src={user!.picture} alt="" referrerPolicy="no-referrer" />
            : <span className="avatar">{user!.guest ? "G" : (user!.name || user!.email)[0].toUpperCase()}</span>}
          <div className="who">
            <div><b>{user!.guest ? "Guest workspace" : user!.name || user!.email}</b></div>
            <div className="muted">{user!.admin ? "Admin" : user!.guest ? "Saved in this browser" : user!.email}</div>
          </div>
          {config.auth_mode === "google" && <button className="btn ghost icon" onClick={signOut} title="Sign out" aria-label="Sign out">⏻</button>}
        </div>
      </aside>
      <main className="content">
        {config.demo_mode && <div className="banner"><span>⚠️</span><span><b>Demo mode.</b> ScriptStudio AI isn't connected, so automatic scripts are placeholders. Add a free <code>GEMINI_API_KEY</code> to switch it on — the ChatGPT and Claude options work either way.</span></div>}
        <ErrorBoundary>
          {!options ? <PageSkeleton /> : (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/new" element={<NewScript />} />
              <Route path="/scripts" element={<Scripts />} />
              <Route path="/scripts/:id" element={<ScriptView />} />
              <Route path="/library" element={<Library />} />
              <Route path="/format" element={<FormatEditor />} />
              <Route path="*" element={<div className="empty"><h2>Page not found</h2><NavLink to="/">Go to the home page</NavLink></div>} />
            </Routes>
          )}
        </ErrorBoundary>
      </main>
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
