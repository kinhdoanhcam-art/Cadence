import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calldataBytes, CALLDATA_LIMIT } from "./lib/calldata";
import { CONTRACT_ADDRESS, EXPLORER_BASE, SOURCE_SHA256 } from "./lib/config";
import { errorMessage } from "./lib/errors";
import { connectedWallet, getLedger, getLedgerRequests, getLimits, getRequest, requestWallet, sendWrite, waitForVerdict } from "./lib/genlayer";
import { fmtAmount, idsFromInput, ledgerIdOf, requestIdOf, short } from "./lib/ids";
import type { Limits } from "./lib/parse";
import { pyLen, pyStrip } from "./lib/pytext";
import {
  addApproverBlock, approveBlock, cancelBlock, isApprover, markPaidBlock, MAX_LEDGER_NAME_LENGTH, MAX_PURPOSE_LENGTH, nextPayable,
  openBlock, parseWhole, REVERTS, requestBlock, stateLine, UI, walletOrEmpty,
} from "./lib/rules";
import type { Ledger, Req, TxStatus } from "./lib/types";
import { addApproverVerified, approveVerified, cancelVerified, markPaidVerified, openVerified, requestVerified } from "./lib/verify";

type Verify = () => Promise<string | null>;
type View = "overview" | "ledger" | "request" | "verify";

const IDLE: TxStatus = { phase: "idle", message: "" };
const NAV: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "ledger", label: "Ledger" },
  { id: "request", label: "New request" },
  { id: "verify", label: "Verification" },
];
const STORE_KEY = "cadence.ledgers";

function readLedgers(): string[] {
  try {
    return idsFromInput(window.localStorage.getItem(STORE_KEY) ?? "");
  } catch {
    return [];
  }
}

function saveLedgers(ids: string[]) {
  try {
    window.localStorage.setItem(STORE_KEY, ids.join(","));
  } catch {
    /* storage unavailable: the URL still carries the open ledger */
  }
}

function ledgerFromUrl(): string {
  return idsFromInput(new URLSearchParams(window.location.search).get("l") ?? "")[0] ?? "";
}

function setLedgerInUrl(id: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("l", id);
  else url.searchParams.delete("l");
  window.history.replaceState(null, "", url.toString());
}

const same = (a: string, b: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export default function App() {
  const urlLedger = ledgerFromUrl();
  const [view, setView] = useState<View>(urlLedger ? "ledger" : "overview");
  const [me, setMe] = useState("");
  const [ledgerId, setLedgerId] = useState(urlLedger);
  const [known, setKnown] = useState<string[]>(() => {
    const list = readLedgers();
    return urlLedger && !list.includes(urlLedger) ? [urlLedger, ...list] : list;
  });
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [requests, setRequests] = useState<Req[]>([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "missing" | "error">("idle");
  const [limits, setLimits] = useState<Limits | null>(null);

  const [openInput, setOpenInput] = useState("");
  const [newName, setNewName] = useState("");
  const [nameTaken, setNameTaken] = useState(false);
  const [approverInput, setApproverInput] = useState("");

  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [periods, setPeriods] = useState("12");
  const [purpose, setPurpose] = useState("");
  const [reqTaken, setReqTaken] = useState(false);

  const [status, setStatus] = useState<TxStatus>(IDLE);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const recheck = useRef<Verify | null>(null);

  // ---------- reads ----------
  const loadLedger = useCallback(async (id: string) => {
    if (!id) {
      setLedger(null);
      setRequests([]);
      setLoadState("idle");
      return;
    }
    setLoadState("loading");
    try {
      const [l, ids] = await Promise.all([getLedger(id), getLedgerRequests(id)]);
      if (!l) {
        setLedger(null);
        setRequests([]);
        setLoadState("missing");
        return;
      }
      const rs = await Promise.all((ids ?? []).map((r) => getRequest(r).catch(() => null)));
      setLedger(l);
      setNames((n) => ({ ...n, [id]: l.name }));
      setRequests(rs.filter((r): r is Req => !!r).reverse());
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    connectedWallet().then(setMe).catch(() => setMe(""));
    window.ethereum?.on?.("accountsChanged", (accounts: string[]) => {
      setMe((accounts?.[0] ?? "").toLowerCase());
      recheck.current = null;
      setStatus(IDLE);
      setFresh(null);
    });
    getLimits().then(setLimits).catch(() => setLimits(null));
  }, []);

  useEffect(() => {
    setLedgerInUrl(ledgerId);
    void loadLedger(ledgerId);
  }, [ledgerId, loadLedger]);

  useEffect(() => saveLedgers(known), [known]);

  useEffect(() => {
    known.filter((id) => !names[id]).forEach((id) => {
      getLedger(id).then((l) => l && setNames((n) => ({ ...n, [id]: l.name }))).catch(() => undefined);
    });
  }, [known, names]);

  useEffect(() => {
    if (me && !payee) setPayee(me);
  }, [me, payee]);

  // ---------- derived ----------
  const newLedgerId = me && pyLen(pyStrip(newName)) > 0 ? ledgerIdOf(me, newName) : "";
  useEffect(() => {
    let live = true;
    setNameTaken(false);
    if (!newLedgerId) return;
    const t = setTimeout(() => { getLedger(newLedgerId).then((l) => live && setNameTaken(!!l)).catch(() => undefined); }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [newLedgerId]);
  const openReason = openBlock(me, newName, nameTaken);

  const newRequestId = me && ledger && pyLen(pyStrip(purpose)) > 0 ? requestIdOf(ledger.ledger_id, me, purpose) : "";
  useEffect(() => {
    let live = true;
    setReqTaken(false);
    if (!newRequestId) return;
    const t = setTimeout(() => { getRequest(newRequestId).then((r) => live && setReqTaken(!!r)).catch(() => undefined); }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [newRequestId]);
  const amountWhole = parseWhole(amount);
  const periodsWhole = parseWhole(periods);
  const reqArgs = useMemo(
    () => [ledger?.ledger_id ?? "0".repeat(64), payee, amountWhole ?? 0n, Number(periodsWhole ?? 0n), purpose],
    [ledger, payee, amountWhole, periodsWhole, purpose],
  );
  const reqBytes = useMemo(() => calldataBytes("request", reqArgs), [reqArgs]);
  const reqReason = requestBlock({ me, ledger, payee, amount, periods, purpose, exists: reqTaken, bytes: reqBytes });
  const addReason = ledger ? addApproverBlock(ledger, me, approverInput) : UI.noLedger;
  const owner = !!ledger && same(ledger.owner, me);

  // ---------- writes ----------
  async function connect() {
    try {
      setMe(await requestWallet());
    } catch (e) {
      setStatus({ phase: "error", message: errorMessage(e) });
    }
  }

  async function runWrite(action: string, method: string, args: unknown[], verify: Verify) {
    setBusy(true);
    recheck.current = null;
    try {
      setStatus({ phase: "signing", message: "Confirm the transaction in your wallet…", action });
      const hash = await sendWrite(me, method, args, 0n);
      setStatus({ phase: "submitted", message: "Submitted. Waiting for validators to accept it…", hash, action });
      const verdict = await waitForVerdict(hash);
      if (verdict.kind === "error") {
        setStatus({ phase: "error", message: verdict.reason, hash, action });
        return;
      }
      if (verdict.kind === "pending") {
        recheck.current = verify;
        setStatus({ phase: "delayed", message: "Submitted — confirmation delayed. Check again re-reads the accepted state; do not send it twice.", hash, action });
        return;
      }
      setStatus({ phase: "checking", message: "Executed. Reading the accepted state…", hash, action });
      const done = await verify();
      if (done) {
        setStatus({ phase: "success", message: done, hash, action });
      } else {
        recheck.current = verify;
        setStatus({ phase: "delayed", message: "Executed, but the accepted state does not show the change yet. Check again in a moment.", hash, action });
      }
    } catch (e) {
      setStatus({ phase: "error", message: errorMessage(e), action });
    } finally {
      setBusy(false);
    }
  }

  async function checkAgain() {
    const verify = recheck.current;
    if (!verify) return;
    setBusy(true);
    try {
      const done = await verify();
      if (done) {
        recheck.current = null;
        setStatus((s) => ({ ...s, phase: "success", message: done }));
      } else {
        setStatus((s) => ({ ...s, message: "The accepted state does not show the change yet. Try again shortly." }));
      }
    } catch (e) {
      setStatus((s) => ({ ...s, message: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  }

  function remember(id: string) {
    setKnown((k) => [id, ...k.filter((x) => x !== id)]);
  }

  function openLedger(id: string) {
    remember(id);
    setLedgerId(id);
    setView("ledger");
  }

  function onOpenInput() {
    const id = idsFromInput(openInput)[0];
    if (!id) {
      setStatus({ phase: "error", message: "Paste a 64-character ledger id or a Cadence ledger link.", action: "Ledger" });
      return;
    }
    setOpenInput("");
    openLedger(id);
  }

  async function onNewLedger() {
    if (openReason) return;
    const s = { id: ledgerIdOf(me, newName), me, name: newName };
    if (await getLedger(s.id)) {
      setNameTaken(true);
      return;
    }
    await runWrite("Open ledger", "open_ledger", [pyStrip(newName)], async () => {
      const l = await getLedger(s.id);
      if (!openVerified(l, s)) return null;
      setNewName("");
      openLedger(s.id);
      await loadLedger(s.id);
      return `Ledger "${l!.name}" is open, with you as owner and first approver. Add approvers, then share the ledger link.`;
    });
  }

  async function onAddApprover() {
    if (!ledger || addReason) return;
    const before = await getLedger(ledger.ledger_id);
    if (!before || addApproverBlock(before, me, approverInput)) return;
    const wallet = walletOrEmpty(approverInput);
    await runWrite("Add approver", "add_approver", [before.ledger_id, wallet], async () => {
      const after = await getLedger(before.ledger_id);
      if (!addApproverVerified(before, after, wallet)) return null;
      setApproverInput("");
      await loadLedger(before.ledger_id);
      return `${short(wallet)} is now an approver (${after!.approver_count} of ${after!.max_approvers}).`;
    });
  }

  async function onRequest() {
    if (!ledger || reqReason || amountWhole === null || periodsWhole === null) return;
    const s = { id: requestIdOf(ledger.ledger_id, me, purpose), me, payee: walletOrEmpty(payee), amount: amountWhole.toString(), periods: Number(periodsWhole), purpose };
    if (await getRequest(s.id)) {
      setReqTaken(true);
      return;
    }
    const lid = ledger.ledger_id;
    await runWrite("Request", "request", [lid, s.payee, amountWhole, s.periods, pyStrip(purpose)], async () => {
      const r = await getRequest(s.id);
      const check = requestVerified(r, s);
      if (!check.ok) return null;
      setPurpose("");
      setAmount("");
      setFresh(s.id);
      await loadLedger(lid);
      setView("ledger");
      const q = check.request;
      if (q.outcome === "RECURRING") {
        return `Validators read the purpose as RECURRING — an ongoing cost. It needs ${q.needed} approvers (not you) and becomes ${q.periods_on_approval} periods, ${q.period_days} days apart.`;
      }
      return `Validators read the purpose as ONE_OFF — a one-time cost. It needs ${q.needed} approver (not you) and is a single period${q.periods_asked > 1 ? `, although ${q.periods_asked} were declared` : ""}.`;
    });
  }

  async function onApprove(r0: Req) {
    const [r, l] = await Promise.all([getRequest(r0.request_id), getLedger(r0.ledger_id)]);
    if (!r || approveBlock(r, l, me)) return;
    await runWrite("Approve", "approve", [r.request_id], async () => {
      const after = await getRequest(r.request_id);
      if (!approveVerified(r, after, me)) return null;
      setFresh(r.request_id);
      await loadLedger(r.ledger_id);
      if (after!.state === "APPROVED") {
        const next = after!.schedule[1];
        return `Approved (${after!.approvals} of ${after!.needed}). ${after!.periods} period${after!.periods === 1 ? "" : "s"}: the first is due today (${after!.schedule[0].due_date})${next ? `, the next on ${next.due_date}` : ""}.`;
      }
      return `Approval recorded: ${after!.approvals} of ${after!.needed}. ${after!.approvals_left} more approver needed.`;
    });
  }

  async function onMarkPaid(r0: Req, k: number) {
    const [r, l] = await Promise.all([getRequest(r0.request_id), getLedger(r0.ledger_id)]);
    if (!r || markPaidBlock(r, l, me, k)) return;
    await runWrite("Mark paid", "mark_paid", [r.request_id, k], async () => {
      const after = await getRequest(r.request_id);
      if (!markPaidVerified(r, after, k)) return null;
      setFresh(r.request_id);
      await loadLedger(r.ledger_id);
      return after!.state === "COMPLETED"
        ? `Period ${k} marked paid. Every period is paid: the request is COMPLETED.`
        : `Period ${k} marked paid (${after!.paid_count} of ${after!.periods}).`;
    });
  }

  async function onCancel(r0: Req) {
    const [r, l] = await Promise.all([getRequest(r0.request_id), getLedger(r0.ledger_id)]);
    if (!r || cancelBlock(r, l, me)) return;
    await runWrite("Cancel", "cancel", [r.request_id], async () => {
      const after = await getRequest(r.request_id);
      if (!cancelVerified(after)) return null;
      await loadLedger(r.ledger_id);
      return "Request cancelled. Its unpaid periods no longer count as committed.";
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setStatus({ phase: "success", message: "Ledger link copied. Approvers and requesters can open it with their own wallet.", action: "Share" });
    } catch {
      setStatus({ phase: "error", message: "Could not copy; copy the address bar instead.", action: "Share" });
    }
  }

  // ---------- one request (a render function, not a component) ----------
  function renderRequest(r: Req) {
    const tone = r.state.toLowerCase();
    const aReason = approveBlock(r, ledger, me);
    const cReason = cancelBlock(r, ledger, me);
    const payK = nextPayable(r);
    const pReason = markPaidBlock(r, ledger, me, payK >= 0 ? payK : r.schedule.findIndex((p) => !p.paid));
    const canSeeApprove = r.state === "PENDING" && !!ledger && isApprover(ledger, me);
    return (
      <article key={r.request_id} className={`flash req st-${tone} ${fresh === r.request_id ? "fresh" : ""}`}>
        <header className="flash-top">
          <span className={`due-pill ${r.state === "PENDING" ? "now" : ""}`}>{r.state}</span>
          <span className={`verdict ${r.outcome === "RECURRING" ? "v-rec" : "v-one"}`}>{r.outcome}</span>
        </header>
        <h3 className="purpose">{r.purpose}</h3>
        <dl className="stats">
          <div><dt>Amount per period</dt><dd>{fmtAmount(r.amount)}</dd></div>
          <div><dt>Periods</dt><dd>{r.state === "PENDING" ? `${r.periods_on_approval}${r.periods_asked !== r.periods_on_approval ? ` (asked ${r.periods_asked})` : ""}` : r.periods}</dd></div>
          <div><dt>Committed unpaid</dt><dd>{fmtAmount(r.committed_unpaid)}</dd></div>
        </dl>
        <p className="fine">Payee {short(r.payee)}{same(r.payee, me) ? " · YOU" : ""} · requested by {short(r.requester)}{same(r.requester, me) ? " · YOU" : ""}</p>
        <div className="approvals">
          {Array.from({ length: r.needed }, (_, i) => (
            <span key={i} className={`sig ${i < r.approvals ? "on" : ""}`}>{i < r.approvals ? `✓ ${short(r.approved_by[i] ?? "")}` : "signature"}</span>
          ))}
          <span className="fine">{stateLine(r)}</span>
        </div>
        {r.schedule.length > 0 && (
          <ol className="schedule">
            {r.schedule.map((p) => (
              <li key={p.k} className={p.paid ? "paid" : p.due ? "due" : ""}>
                <span className="mono">#{p.k}</span>
                <span>{p.due_date}</span>
                <span className="mono">{p.paid ? "PAID" : p.due ? "DUE" : "UPCOMING"}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="practise">
          {canSeeApprove && (
            <span className="action">
              <button className="btn btn-primary" onClick={() => onApprove(r)} disabled={busy || !!aReason}>Approve</button>
              {aReason && <span className="reason">{aReason}</span>}
            </span>
          )}
          {r.state === "PENDING" && !canSeeApprove && me && <span className="reason">{aReason}</span>}
          {r.state === "APPROVED" && owner && (
            <span className="action">
              <button className="btn btn-primary" onClick={() => onMarkPaid(r, payK)} disabled={busy || payK < 0 || !!pReason}>
                {payK >= 0 ? `Mark period ${payK} paid` : "Mark paid"}
              </button>
              {payK < 0 && <span className="reason">{REVERTS.notDue}</span>}
            </span>
          )}
          {(r.state === "PENDING" || r.state === "APPROVED") && !cReason && (
            <button className="btn btn-ghost" onClick={() => onCancel(r)} disabled={busy}>Cancel</button>
          )}
        </div>
        <footer className="flash-foot mono">{short(r.request_id, 8, 6)}</footer>
      </article>
    );
  }

  // ---------- view ----------
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="badge"><img src="/logo-192.png" alt="" width={34} height={34} /></span>
          <div>
            <div className="brand-name">Cadence</div>
            <div className="brand-sub">PURPOSE-READ CLUB LEDGER</div>
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          {NAV.map((n) => (
            <button key={n.id} className={`tab ${view === n.id ? "active" : ""}`} onClick={() => setView(n.id)}>{n.label}</button>
          ))}
        </nav>
        {me ? <div className="wallet mono" title={me}>◆ {short(me)}</div> : <button className="btn btn-ghost" onClick={connect}>◆ Connect wallet</button>}
      </header>

      <div className={`runtime runtime-${status.phase}`} aria-live="polite">
        <span className="dot" aria-hidden="true" />
        <span className="runtime-tag">{status.phase === "idle" ? "STUDIONET" : (status.action ?? "STATUS").toUpperCase()}</span>
        <span className="runtime-msg">
          {status.phase === "idle" ? <>Contract <a className="mono" href={`${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">{short(CONTRACT_ADDRESS, 6, 4)}</a> on GenLayer StudioNet · chain 61999</> : status.message}
        </span>
        {status.hash && <a className="mono runtime-link" href={`${EXPLORER_BASE}/tx/${status.hash}`} target="_blank" rel="noreferrer">tx {short(status.hash, 10, 8)}</a>}
        {status.phase === "delayed" && recheck.current && <button className="btn btn-ghost small" onClick={checkAgain} disabled={busy}>Check again</button>}
      </div>

      <main className="main">
        {view === "overview" && (
          <>
            <section className="hero">
              <div className="hero-left">
                <p className="eyebrow">CLUB LEDGER · AI-READ · GENLAYER</p>
                <h1>An ongoing cost needs two signatures.</h1>
                <p className="lede">
                  Anyone may ask a club's ledger for a payment. GenLayer validators read what it is for, once: an ongoing
                  cost needs two approvers and becomes a schedule of periods 30 days apart; a one-time cost needs one and is
                  a single line — whatever count was asked for.
                </p>
                <div className="cta">
                  <button className="btn btn-primary big" onClick={() => setView("ledger")}>Open a ledger →</button>
                  <button className="btn btn-ghost big" onClick={() => setView("request")}>New request</button>
                </div>
              </div>
              <div className="hero-right">
                {[
                  ["01", "State the purpose", "“Pays the designer to keep the logo current.” or “Pays the designer for the logo.” — amount and periods are yours to set."],
                  ["02", "Read once", "RECURRING needs two approvers and keeps its periods; ONE_OFF needs one and is always a single period."],
                  ["03", "Pay on schedule", "Period k falls due 30 × k days after approval. Only the owner marks periods paid, and only once due."],
                ].map(([n, t, d], i) => (
                  <div className={`step ${i === 0 ? "lit" : ""}`} key={n}>
                    <span className="step-n mono">{n}</span>
                    <div><p className="step-t">{t}</p><p className="step-d">{d}</p></div>
                  </div>
                ))}
              </div>
            </section>
            <section className="features">
              <div className="feature">
                <span className="f-icon" aria-hidden="true">◇</span>
                <h2>Same designer, same logo</h2>
                <p>“…to keep the logo current” is a standing commitment; “…for the logo” is paid once. The words of the purpose decide how much sign-off it needs.</p>
              </div>
              <div className="feature">
                <span className="f-icon" aria-hidden="true">✦</span>
                <h2>Never your own signature</h2>
                <p>The requester never counts as an approver, even when they are one. Unclear readings count as ONE_OFF, so nothing becomes a schedule on a guess.</p>
              </div>
              <div className="feature">
                <span className="f-icon" aria-hidden="true">↗</span>
                <h2>A ledger, not a wallet</h2>
                <p>Amounts are whole numbers recorded in the ledger; no GEN moves. The ledger shows what is committed and still unpaid, and what has been paid.</p>
              </div>
            </section>
          </>
        )}

        {view === "ledger" && (
          <>
            <section className="panel head">
              <div>
                <p className="eyebrow">LEDGER</p>
                <h1>{ledger ? ledger.name : "Open a ledger"}</h1>
                <p className="muted">{ledger ? `Owner ${short(ledger.owner)}${owner ? " · YOU" : ""} · today ${ledger.today_date} (UTC)` : "Paste a ledger id or link, pick one you used here, or start a new one."}</p>
              </div>
              <div className="row">
                <input className="mono" aria-label="Ledger id" placeholder="Ledger id or link" value={openInput} onChange={(e) => setOpenInput(e.target.value)} spellCheck={false} />
                <button className="btn btn-ghost" onClick={onOpenInput}>Open</button>
                <button className="btn btn-ghost" onClick={copyLink} disabled={!ledger}>Copy ledger link</button>
              </div>
            </section>

            {known.length > 0 && (
              <div className="chips-row">
                {known.map((id) => (
                  <button key={id} className={`chip-btn ${id === ledgerId ? "on" : ""}`} onClick={() => openLedger(id)}>
                    {names[id] ?? short(id, 8, 6)}
                  </button>
                ))}
              </div>
            )}

            {loadState === "loading" && <section className="panel empty"><p className="muted mono">Reading the ledger…</p></section>}
            {loadState === "missing" && <section className="panel empty"><p className="reason">{REVERTS.unknownLedger}</p></section>}
            {loadState === "error" && <section className="panel empty"><p className="reason">Could not read this ledger. Try again.</p></section>}

            {ledger && (
              <section className="ledger-grid">
                <div className="panel totals">
                  <div className="total"><span>Committed, unpaid</span><b>{fmtAmount(ledger.committed_unpaid)}</b></div>
                  <div className="total"><span>Paid</span><b>{fmtAmount(ledger.paid_total)}</b></div>
                  <div className="total"><span>Pending requests</span><b>{ledger.pending_count}</b></div>
                  <div className="total"><span>Requests</span><b>{ledger.request_count}</b></div>
                </div>
                <div className="panel approvers">
                  <p className="sense-label">Approvers · {ledger.approver_count} of {ledger.max_approvers}</p>
                  <ul>
                    {ledger.approvers.map((a) => (
                      <li key={a} className="mono">{short(a, 8, 6)}{same(a, ledger.owner) ? " · owner" : ""}{same(a, me) ? " · you" : ""}</li>
                    ))}
                  </ul>
                  {owner && (
                    <div className="row">
                      <input className="mono" aria-label="Approver wallet" placeholder="0x… wallet" value={approverInput} onChange={(e) => setApproverInput(e.target.value)} spellCheck={false} />
                      <button className="btn btn-ghost" onClick={onAddApprover} disabled={busy || !!addReason}>Add approver</button>
                      {approverInput && addReason && <span className="reason">{addReason}</span>}
                    </div>
                  )}
                </div>
              </section>
            )}

            {ledger && (
              <div className="row between">
                <h2 className="section-title">Requests</h2>
                <button className="btn btn-primary" onClick={() => setView("request")}>New request →</button>
              </div>
            )}
            {ledger && requests.length === 0 && <section className="panel empty"><p className="muted">No request yet.</p></section>}
            <div className="grid">{requests.map((r) => renderRequest(r))}</div>

            <section className="panel form">
              <p className="eyebrow">NEW LEDGER</p>
              <h1>Start a ledger for your club</h1>
              <label htmlFor="lname">Ledger name</label>
              <input id="lname" placeholder="Riverside makers club" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <div className="form-foot">
                <span className="fine">{pyLen(pyStrip(newName))} / {MAX_LEDGER_NAME_LENGTH} characters</span>
                <span className="action">
                  {newName && openReason && <span className="reason">{openReason}</span>}
                  <button className="btn btn-primary" onClick={onNewLedger} disabled={busy || !!openReason}>Open ledger</button>
                </span>
              </div>
              {newLedgerId && <p className="fine mono">Ledger id: {newLedgerId}</p>}
            </section>
          </>
        )}

        {view === "request" && (
          <section className="panel form">
            <p className="eyebrow">NEW REQUEST</p>
            <h1>{ledger ? `Ask "${ledger.name}" for a payment` : "Open a ledger first"}</h1>
            <p className="muted">Say what the money is for. Validators read only the purpose — never the amount, the periods or any wallet.</p>
            <label htmlFor="payee">Payee wallet</label>
            <input id="payee" className="mono" placeholder="0x…" value={payee} onChange={(e) => setPayee(e.target.value)} spellCheck={false} />
            <div className="two">
              <div>
                <label htmlFor="amount">Amount per period</label>
                <input id="amount" className="mono" inputMode="numeric" placeholder="25000" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <span className="fine">Whole number, 1 – 1,000,000,000,000 (the ledger's smallest unit)</span>
              </div>
              <div>
                <label htmlFor="periods">Periods (if ongoing)</label>
                <input id="periods" className="mono" inputMode="numeric" value={periods} onChange={(e) => setPeriods(e.target.value)} />
                <span className="fine">1 – 12, every {limits?.period_days ?? 30} days</span>
              </div>
            </div>
            <label htmlFor="purpose">Purpose</label>
            <textarea id="purpose" rows={2} placeholder="Pays the designer to keep the logo current." value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            <span className="fine">{pyLen(pyStrip(purpose))} / {MAX_PURPOSE_LENGTH} characters</span>
            {amountWhole !== null && periodsWhole !== null && amountWhole > 0n && (
              <div className="preview">
                <div><span className="verdict v-rec">RECURRING</span> 2 approvers · {Number(periodsWhole)} × {fmtAmount(amountWhole.toString())} = {fmtAmount((amountWhole * periodsWhole).toString())}</div>
                <div><span className="verdict v-one">ONE_OFF</span> 1 approver · 1 × {fmtAmount(amountWhole.toString())}</div>
              </div>
            )}
            <div className="form-foot">
              <span className={`meter mono ${reqBytes > CALLDATA_LIMIT ? "over" : ""}`}>{reqBytes} / {CALLDATA_LIMIT} bytes</span>
              <span className="action">
                {(purpose || amount) && reqReason && reqReason !== REVERTS.purposeEmpty && <span className="reason">{reqReason}</span>}
                <button className="btn btn-primary" onClick={onRequest} disabled={busy || !!reqReason}>Send request</button>
              </span>
            </div>
            {newRequestId && <p className="fine mono">Request id: {newRequestId}</p>}
            {!ledger && <button className="btn btn-ghost" onClick={() => setView("ledger")}>Go to Ledger</button>}
          </section>
        )}

        {view === "verify" && (
          <section className="panel form">
            <p className="eyebrow">VERIFICATION</p>
            <h1>What you are talking to</h1>
            <dl className="facts">
              <div><dt>Contract</dt><dd className="mono"><a href={`${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">{CONTRACT_ADDRESS}</a></dd></div>
              <div><dt>Source SHA-256</dt><dd className="mono">{SOURCE_SHA256}</dd></div>
              <div><dt>Contract name · version</dt><dd className="mono">{limits ? `${limits.contract_name ?? "?"} · ${limits.version ?? "?"}` : "reading…"}</dd></div>
              <div><dt>Rubric hash (from get_limits)</dt><dd className="mono">{limits?.rubric_hash ?? "reading…"}</dd></div>
              <div><dt>Approvals needed · period length</dt><dd className="mono">{limits?.approvals_needed ? `RECURRING ${limits.approvals_needed.RECURRING} · ONE_OFF ${limits.approvals_needed.ONE_OFF} · ${limits.period_days} days` : "reading…"}</dd></div>
            </dl>
            <p className="muted">
              Every revert the app can predict disables the button and shows the contract's own sentence. Whether a purpose is
              ongoing or one-time is decided only by validators inside request(); the app reads the outcome back from the
              contract. No money is held: amounts are numbers in the ledger.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
