import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./session";
import { Spinner } from "./components/ui";
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
        if (error && !session) return <div className="center"><div className="card">Couldn't start the app: {error}</div></div>;
        if (!session) return <div className="center"><Spinner /></div>;
        if (!session.user) return <SignIn />;
        return <Shell />;
      }}
    </SessionProvider>
  );
}

function Shell() {
  const { user, config, signOut } = useSession();
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><img src="/favicon.svg" alt="" />Scriptwright</div>
        <nav className="nav">
          <NavLink to="/new">＋ New script</NavLink>
          <NavLink to="/scripts">Scripts</NavLink>
          <NavLink to="/library">House library</NavLink>
          <NavLink to="/format">House format</NavLink>
        </nav>
        <div className="spacer" />
        <div className="me">
          {user!.picture ? <img src={user!.picture} alt="" referrerPolicy="no-referrer" />
            : <span className="avatar">{(user!.name || user!.email)[0].toUpperCase()}</span>}
          <div className="who"><div><b>{user!.name || user!.email}</b></div><div className="muted">{user!.admin ? "Admin" : user!.email}</div></div>
          {config.auth_mode === "google" && <button className="btn ghost" onClick={signOut} title="Sign out">⏻</button>}
        </div>
      </aside>
      <main className="content">
        {config.demo_mode && <div className="banner"><b>Demo mode.</b> No AI model is connected, so scripts are structural placeholders. Set <code>LLM_PROVIDER=openai</code> and an API key for real output.</div>}
        <Routes>
          <Route path="/" element={<Navigate to="/new" replace />} />
          <Route path="/new" element={<NewScript />} />
          <Route path="/scripts" element={<Scripts />} />
          <Route path="/scripts/:id" element={<ScriptView />} />
          <Route path="/library" element={<Library />} />
          <Route path="/format" element={<FormatEditor />} />
          <Route path="*" element={<div className="empty"><h2>Page not found</h2></div>} />
        </Routes>
      </main>
    </div>
  );
}
