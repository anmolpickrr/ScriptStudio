import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useJobActions } from "../components/Cards";
import { Icon, label, Poster, Skeleton, timeAgo, useToast } from "../components/ui";
import { useSession } from "../session";
import type { LibraryItem } from "../types";

export default function Library() {
  const { user } = useSession();
  const toast = useToast();
  const acts = useJobActions();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const load = useCallback(() => api.get<LibraryItem[]>("/api/library").then(setItems).catch((e) => toast(e.message, "error")), [toast]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="page-head"><div className="grow">
        <div className="eyebrow"><Icon.star /> Best work</div>
        <h1 className="display-sm">House library</h1>
        <p>Approved scripts. New scripts on the same platform and hook type learn from the closest ones.</p></div></div>
      {items === null ? <div className="concepts">{[0, 1, 2].map((i) => <div key={i} className="card stack-sm"><Skeleton w="70%" /><Skeleton h={12} w="40%" /><Skeleton h={48} /></div>)}</div>
        : items.length === 0 ? (
          <div className="card empty"><div className="art gl lg"><Icon.star /></div><h2>Nothing approved yet</h2>
            <p>Open a script you're happy with and click <b>Approve</b>. It becomes a reference for future scripts.</p>
            <Link className="btn secondary" to="/scripts">Go to my scripts</Link></div>
        ) : (
          <div className="concepts">
            {items.map((a) => (
              <div key={a.job_id} className="concept lib-card">
                <div className="lib-top">
                  <Poster brand={a.title} platform={a.platform} seconds={a.duration_sec} height={72} />
                  <div className="grow">
                    <span className="lib-ribbon"><Icon.check /> Approved {timeAgo(a.approved_at)}</span>
                    <Link to={`/scripts/${a.job_id}`} className="lib-title"><b>{a.title}</b></Link>
                    <div className="muted small">{a.platform} · {a.duration_sec}s</div>
                  </div>
                </div>
                {a.hook_type && <span className="chip-meta lib-hook">Hook · {label(a.hook_type)}</span>}
                <div className="small">{a.logline}</div>
                {a.editor_notes && <div className="hookline">“{a.editor_notes}”</div>}
                <div className="foot lib-foot">
                  <Link className="btn sm secondary" to={`/scripts/${a.job_id}`}>Open script</Link>
                  <button className="btn sm ghost" onClick={() => acts.editAsNew(a.job_id)} title="Starts a new script with this one's inputs">Write similar</button>
                  {user?.admin && (
                    <button className="btn sm ghost danger-text" onClick={async () => {
                      if (!window.confirm("Remove this script from the house library? The script itself stays in Scripts.")) return;
                      try { await api.del(`/api/library/${a.job_id}`); toast("Removed from the library."); load(); } catch (e) { toast((e as Error).message, "error"); }
                    }}>Remove</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
    </>
  );
}
