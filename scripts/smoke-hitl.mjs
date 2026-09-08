/**
 * Live HITL smoke (ADR-013). Streams POST /api/chat incrementally so it can
 * resolve the mid-stream `approval_request` via POST /api/chat/approve — exactly
 * as the web client does. Usage: node scripts/smoke-hitl.mjs [apiBaseUrl] [approve|deny]
 */
const API = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
const DECISION = process.argv[3] === 'deny' ? 'deny' : 'approve';
const SESSION = `smoke-hitl-${Date.now()}`;

const line = (s) => process.stdout.write(s + '\n');

async function postJson(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

/** Stream a chat turn; call onEvent for each parsed AgentEvent. Returns all events. */
async function chat(message, onEvent) {
  const events = [];
  const res = await fetch(`${API}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: SESSION, message }),
  });
  if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const d = block.split('\n').find((l) => l.startsWith('data:'));
      if (!d) continue;
      try {
        const evt = JSON.parse(d.slice(5).trim());
        events.push(evt);
        if (onEvent) await onEvent(evt);
      } catch { /* keep-alive */ }
    }
  }
  return events;
}

const names = (evts, type) => evts.filter((e) => e.type === type).map((e) => e.name || e.summary || e.decision);

(async () => {
  line(`API: ${API}`);
  line(`session: ${SESSION}  decision: ${DECISION}\n`);

  // 1) health
  const health = await fetch(`${API}/health`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  line(`1. GET /health -> ${JSON.stringify(health)}`);

  // 2) deterministic proof the new endpoint shipped
  const bogus = await postJson('/api/chat/approve', { sessionId: SESSION, approvalId: 'appr-bogus', decision: 'approve' });
  line(`2. POST /api/chat/approve (bogus id) -> ${bogus.status} ${JSON.stringify(bogus.json)}  ${bogus.status === 404 ? 'PASS (endpoint live)' : 'UNEXPECTED'}`);
  const badDecision = await postJson('/api/chat/approve', { sessionId: SESSION, approvalId: 'x', decision: 'maybe' });
  line(`   POST /api/chat/approve (bad decision) -> ${badDecision.status}  ${badDecision.status === 400 ? 'PASS' : 'UNEXPECTED'}`);

  // 3) search so the session has bookable options
  line('\n3. search turn: "Find flights and hotels to Lisbon from London, outbound 2026-10-14 returning 2026-10-21, 2 travellers."');
  const search = await chat('Find flights and hotels to Lisbon from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.');
  line(`   tool_calls: ${[...new Set(names(search, 'tool_call'))].join(', ') || '(none)'}`);

  // 4) booking turn — resolve the approval mid-stream
  line(`\n4. booking turn: "Book the first flight and the first hotel." (will ${DECISION} on approval_request)`);
  let approvalSeen = null;
  let approveResp = null;
  const book = await chat('Book the first flight and the first hotel.', async (evt) => {
    if (evt.type === 'approval_request') {
      approvalSeen = evt;
      line(`   << approval_request  id=${evt.approvalId} tool=${evt.tool} reason="${evt.reason}"`);
      approveResp = await postJson('/api/chat/approve', { sessionId: SESSION, approvalId: evt.approvalId, decision: DECISION });
      line(`   >> POST /api/chat/approve {${DECISION}} -> ${approveResp.status} ${JSON.stringify(approveResp.json)}`);
    } else if (evt.type === 'approval_resolved') {
      line(`   << approval_resolved  decision=${evt.decision}`);
    }
  });

  const booked = book.find((e) => e.type === 'tool_result' && e.name === 'booking-simulator' && e.ok);
  line('\n=== summary ===');
  line(`  endpoint live (404/400):        ${bogus.status === 404 && badDecision.status === 400 ? 'PASS' : 'FAIL'}`);
  line(`  approval_request emitted:       ${approvalSeen ? 'YES' : 'no (model did not call booking-simulator)'}`);
  line(`  approval resolved via endpoint: ${approveResp ? `${approveResp.status}` : 'n/a'}`);
  line(`  booking-simulator ran:          ${booked ? 'YES' : 'no'}  ${DECISION === 'deny' && approvalSeen && !booked ? '(correctly blocked)' : ''}`);
  line(`  booking tool_calls:             ${[...new Set(names(book, 'tool_call'))].join(', ') || '(none)'}`);
})().catch((e) => { console.error('SMOKE ERROR:', e); process.exit(1); });
