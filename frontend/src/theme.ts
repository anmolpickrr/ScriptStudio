/** Day and Night themes, as in the Creative Ops Tracker: Day between sunrise and sunset in India, Night after dark.
 *  Choosing one by hand holds until the light next changes. index.html applies it before the first paint. */
const SUN = [[430, 1060], [418, 1085], [393, 1105], [362, 1123], [338, 1140], [327, 1155], [335, 1155], [352, 1135],
  [368, 1102], [383, 1068], [403, 1040], [423, 1040]]; // approx. sunrise/sunset, minutes after midnight IST, by month
export type Theme = "light" | "dark";

function ist() {
  const p: Record<string, string> = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  return { m: +p.month - 1, mins: +p.hour * 60 + +p.minute };
}
export function autoTheme(): Theme { const t = ist(), s = SUN[t.m]; return t.mins >= s[0] && t.mins < s[1] ? "light" : "dark"; }
function nextChange() { const t = ist(), s = SUN[t.m]; const mins = t.mins < s[0] ? s[0] - t.mins : t.mins < s[1] ? s[1] - t.mins : 1440 - t.mins + s[0]; return Date.now() + mins * 60000; }

export function currentTheme(): Theme {
  try {
    const o = localStorage.getItem("ss:theme") as Theme | null, until = +(localStorage.getItem("ss:themeUntil") || 0);
    if (o && until && Date.now() < until) return o;
  } catch { /* storage unavailable */ }
  return autoTheme();
}
export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("ss:theme", t); localStorage.setItem("ss:themeUntil", String(nextChange())); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event("ss:theme"));
}
