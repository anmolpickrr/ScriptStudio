import { useEffect, useState } from "react";
import { api } from "../api";
import { label, Spinner, timeAgo, useToast } from "../components/ui";
import { useSession } from "../session";
import type { LibraryItem } from "../types";

export default function Library() {
  const { user } = useSession();
  const toast = useToast();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const load = () => api.get<LibraryItem[]>("/api/library").then(setItems).catch((e) => toast(e.message, "error"));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items) return <div className="center"><Spinner /></div>;
  return (
    <>
      <div className="page-head"><div className="grow"><h1>House library</h1>
        <div className="muted">Approved scripts. New scripts on the same platform and hook type use the closest ones as quality references.</div></div></div>
      {items.length === 0 ? (
        <div className="card empty"><h2>Nothing approved yet</h2><p>Open a script you're happy with and click <b>Approve</b>. It will guide future scripts.</p></div>
      ) : (
        <div className="concepts">
          {items.map((a) => (
            <div key={a.job_id} className="card concept">
              <b>{a.title}</b>
              <div className="muted small">{a.platform} · {a.duration_sec}s · {label(a.hook_type)}</div>
              <div>{a.logline}</div>
              {a.editor_notes && <div className="hookline">“{a.editor_notes}”</div>}
              <div className="muted small">Approved by {a.approved_by || "—"} · {timeAgo(a.approved_at)}</div>
              {user?.admin && (
                <div><button className="btn ghost small" onClick={async () => {
                  try { await api.del(`/api/library/${a.job_id}`); toast("Removed from library."); load(); } catch (e) { toast((e as Error).message, "error"); }
                }}>Remove from library</button></div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
