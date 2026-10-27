import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SessionProvider, useSession } from "./session";
import { ErrorBoundary, Icon, PageSkeleton, Spinner } from "./components/ui";
import SignIn from "./pages/SignIn";
import NewScript from "./pages/NewScript";
import Scripts from "./pages/Scripts";
import ScriptView from "./pages/ScriptView";
import Library from "./pages/Library";
import FormatEditor from "./pages/FormatEditor";

export default function App() {
  return (
    <SessionProvider>
      {(session, error) => {
        if (error && !session) return (
          <div className="center"><div className="card empty" style={{ maxWidth: 440 }}>
            <h2>Can't reach ScriptStudio</h2><p>{error}</p>
            <button className="btn" onClick={() => window.location.reload()}>Try again</button></div></div>
        );
        if (!session) return <div className="center"><Spinner /></div>;
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
    <div className="shell">
      <header className="topbar">
        <button className="btn ghost icon" aria-label="Open menu" onClick={() => setOpen(true)}><Icon.menu /></button>
        <div className="brand grow"><img src="/favicon.svg" alt="" />ScriptStudio</div>
        <NavLink to="/new" className="btn" style={{ minHeight: 34, padding: "6px 12px" }}>New</NavLink>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`side ${open ? "open" : ""}`} aria-label="Main navigation">
        <div className="brand"><img src="/favicon.svg" alt="" />ScriptStudio</div>
        <nav className="nav">
          <NavLink to="/new" className="new"><Icon.plus />New script</NavLink>
          <NavLink to="/scripts"><Icon.doc />My scripts</NavLink>
          <NavLink to="/library"><Icon.star />House library</NavLink>
          <NavLink to="/format"><Icon.layout />House format</NavLink>
        </nav>
        <div className="spacer" />
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
        {config.demo_mode && <div className="banner"><span>⚠️</span><span><b>Demo mode.</b> No AI model is connected, so scripts are structural placeholders. Set <code>LLM_PROVIDER=openai</code> with an API key for real output.</span></div>}
        <ErrorBoundary>
          {!options ? <PageSkeleton /> : (
            <Routes>
              <Route path="/" element={<Navigate to="/new" replace />} />
              <Route path="/new" element={<NewScript />} />
              <Route path="/scripts" element={<Scripts />} />
              <Route path="/scripts/:id" element={<ScriptView />} />
              <Route path="/library" element={<Library />} />
              <Route path="/format" element={<FormatEditor />} />
              <Route path="*" element={<div className="empty"><h2>Page not found</h2><NavLink to="/new">Start a new script</NavLink></div>} />
            </Routes>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
