import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { label, Skeleton, timeAgo, useToast } from "../components/ui";
import { useSession } from "../session";
import type { LibraryItem } from "../types";

export default function Library() {
  const { user } = useSession();
  const toast = useToast();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const load = useCallback(() => api.get<LibraryItem[]>("/api/library").then(setItems).catch((e) => toast(e.message, "error")), [toast]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="page-head"><div className="grow"><h1>House library</h1>
        <p>Approved scripts. New scripts on the same platform and hook type use the closest ones as quality references.</p></div></div>
      {items === null ? <div className="concepts">{[0, 1, 2].map((i) => <div key={i} className="card stack-sm"><Skeleton w="70%" /><Skeleton h={12} w="40%" /><Skeleton h={48} /></div>)}</div>
        : items.length === 0 ? (
          <div className="card empty"><div className="art">⭐</div><h2>Nothing approved yet</h2>
            <p>Open a script you're happy with and click <b>Approve</b>. It becomes a reference for future scripts.</p>
            <Link className="btn secondary" to="/scripts">Go to my scripts</Link></div>
        ) : (
          <div className="concepts">
            {items.map((a) => (
              <div key={a.job_id} className="concept">
                <b>{a.title}</b>
                <div className="muted small" style={{ textTransform: "capitalize" }}>{a.platform} · {a.duration_sec}s · {label(a.hook_type)}</div>
                <div>{a.logline}</div>
                {a.editor_notes && <div className="hookline">“{a.editor_notes}”</div>}
                <div className="muted small">Approved {timeAgo(a.approved_at)}</div>
                {user?.admin && (
                  <div className="foot"><button className="btn ghost" onClick={async () => {
                    try { await api.del(`/api/library/${a.job_id}`); toast("Removed from the library."); load(); } catch (e) { toast((e as Error).message, "error"); }
                  }}>Remove from library</button></div>
                )}
              </div>
            ))}
          </div>
        )}
    </>
  );
}
