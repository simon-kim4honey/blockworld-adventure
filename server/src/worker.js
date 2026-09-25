/* ═══════════════════════════════════════════════════════════════
   도도블록 작은 서버
   ───────────────────────────────────────────────────────────────
   하는 일 세 가지.
     ① 💬 대화 — 방에 말을 쌓아 두고, 새로 온 것만 돌려준다
     ② 🪶 도도AI 자리 — 한 방에서 도도AI 를 맡은 사람이 누구인지 정해 준다
          (두 사람이 동시에 부르면 똑같은 대답이 두 번 뜨기 때문이다)
     ③ 🔗 게임 보관함 — 수백 자짜리 게임 코드를 맡아 두고 짧은 번호를 준다
          (번호 = 내 번호 6글자 + 칸 번호 1글자, 예: AB12CD3)

   ★ 아이 안전 ★
   대화는 아이가 직접 글자를 친다. 그래서 서버에서 한 번 더 거른다 —
   링크, 전화번호처럼 긴 숫자, 욕설, 카톡 아이디·주소 같은 개인정보 유도.
   게임 쪽은 글자를 안 받고 코드만 받는다.
   방 하나에 최근 120개만 남고 오래된 건 저절로 밀려난다.
   ═══════════════════════════════════════════════════════════════ */

const ROOM_MAX   = 120;      // 방 하나에 남겨 두는 말 개수
const NICK_MAX   = 10;
const TEXT_MAX   = 60;       // 한 번에 보낼 수 있는 글자 수
const COOL_MS    = 1200;     // 같은 사람은 1.2초에 한 번만
const AI_HOLD_MS = 25000;    // 도도AI 자리를 25초 동안 맡는다 (다시 물어보면 계속 연장)
const CODE_MAX   = 60000;    // 게임 코드 길이 한계
const SLOTS      = 9;        // 한 사람이 맡길 수 있는 게임 수
const ROOM_RE    = /^[a-z]+(:[A-Z0-9]{4,10})?$/;
const UID_RE     = /^[A-Z0-9]{4,10}$/;

/* ── 거르개. 게임 쪽 index.html 의 safeNick·safeText 와 같은 규칙이다 ── */
const BAD = ['시발','씨발','ㅅㅂ','좆','병신','ㅂㅅ','새끼','ㄲㅈ','지랄','미친','죽어','바보','멍청',
             'fuck','shit','bitch','sex','섹스'];
const PRIVATE = ['카톡','카카오','인스타','디엠','디스코드','텔레그램','전화번호','휴대폰','핸드폰',
                 '이메일','메일주소','주소가','우리집주소','몇반','몇학년','몇동','몇호','아이디알려'];
const LINK_RE  = /(https?:\/\/|www\.|\.com|\.net|\.kr\b|\.io\b|\.me\b)/i;
const DIGIT_RE = /\d[\d\s.-]{4,}/;          // 숫자가 다섯 자리 넘게 이어지면 전화번호일 수 있다
const SCHOOL_RE = /(무슨|어느|어디).{0,3}학교|학교.{0,3}(어디|이름)/;

function safeNick(raw){
  let n = String(raw == null ? '' : raw).trim().slice(0, NICK_MAX);
  n = n.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  if (/\d{3,}/.test(n)) return '';
  const low = n.toLowerCase().replace(/\s/g, '');
  for (const b of BAD) if (low.includes(b)) return '';
  return n;
}

/* 통과하면 {ok:true, text}, 막히면 {ok:false, why} */
function safeText(raw){
  let t = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  t = t.replace(/\s+/g, ' ');
  if (!t) return { ok: false, why: 'empty' };
  if (t.length > TEXT_MAX) return { ok: false, why: 'long' };
  if (LINK_RE.test(t)) return { ok: false, why: 'link' };
  if (DIGIT_RE.test(t)) return { ok: false, why: 'number' };
  const low = t.toLowerCase().replace(/\s/g, '');
  for (const b of BAD) if (low.includes(b)) return { ok: false, why: 'bad' };
  for (const p of PRIVATE) if (low.includes(p)) return { ok: false, why: 'private' };
  if (SCHOOL_RE.test(t.replace(/\s/g, ''))) return { ok: false, why: 'private' };
  return { ok: true, text: t };
}

const HEAD = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store'
};
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: HEAD });

/* ── 방 하나 = Durable Object 하나. 말이 섞이지도, 순서가 꼬이지도 않는다 ── */
export class DodoRoom {
  constructor(state) {
    this.state = state;
    this.last = new Map();            // 누가 마지막으로 언제 말했나
    this.ai = null;                   // {u, at} — 지금 도도AI 를 맡은 사람
  }

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    /* ---------- 🔗 게임 보관함 ---------- */
    if (path.startsWith('/box')) {
      if (req.method === 'POST') {
        const code = (await req.text()).trim();
        if (!code || code.length > CODE_MAX) return json({ ok: false, why: 'size' }, 400);
        let slot = ((await this.state.storage.get('next')) || 0) % SLOTS;
        await this.state.storage.put('s' + slot, code);
        await this.state.storage.put('next', slot + 1);
        return json({ ok: true, slot: slot + 1 });       // 사람에게 보이는 칸은 1부터
      }
      if (req.method === 'GET') {
        const slot = parseInt(url.searchParams.get('slot') || '0', 10) - 1;
        if (!(slot >= 0 && slot < SLOTS)) return json({ ok: false, why: 'slot' }, 400);
        const code = await this.state.storage.get('s' + slot);
        if (!code) return json({ ok: false, why: 'none' }, 404);
        return json({ ok: true, code });
      }
      return json({ ok: false, why: 'method' }, 405);
    }

    /* ---------- 💬 대화 ---------- */
    if (req.method === 'GET') {
      const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
      const now = Date.now();

      // 🪶 도도AI 자리 맡기 — 빈자리거나, 앞사람이 오래 조용하거나, 나였으면 내 것
      const want = String(url.searchParams.get('ai') || '').toUpperCase();
      if (want && UID_RE.test(want)) {
        if (!this.ai || this.ai.u === want || now - this.ai.at > AI_HOLD_MS) this.ai = { u: want, at: now };
      }
      if (this.ai && now - this.ai.at > AI_HOLD_MS) this.ai = null;

      const msgs = (await this.state.storage.get('msgs')) || [];
      const tenMin = now - 10 * 60 * 1000;
      const who = new Set();
      for (const m of msgs) if (m.t > tenMin && m.u !== 'DODOAI') who.add(m.u);
      return json({
        ok: true,
        msgs: msgs.filter(m => m.i > since),
        last: msgs.length ? msgs[msgs.length - 1].i : 0,
        people: who.size,
        aiOwner: this.ai ? this.ai.u : ''
      });
    }

    if (req.method === 'POST') {
      let body;
      try { body = JSON.parse(await req.text()); } catch (e) { return json({ ok: false, why: 'bad' }, 400); }

      const uid = String(body.u || '').toUpperCase();
      if (!UID_RE.test(uid)) return json({ ok: false, why: 'uid' }, 400);

      const said = safeText(body.x);
      if (!said.ok) return json({ ok: false, why: said.why }, 400);

      const now = Date.now();
      const prev = this.last.get(uid) || 0;
      if (now - prev < COOL_MS) return json({ ok: false, why: 'slow', wait: COOL_MS - (now - prev) }, 429);
      this.last.set(uid, now);
      if (this.last.size > 400) this.last.clear();

      const nick = uid === 'DODOAI' ? '도도 장로' : (safeNick(body.n) || ('도도' + uid.slice(0, 2)));
      const msgs = (await this.state.storage.get('msgs')) || [];
      const id = (msgs.length ? msgs[msgs.length - 1].i : 0) + 1;
      msgs.push({ i: id, u: uid, n: nick, x: said.text, t: now });
      while (msgs.length > ROOM_MAX) msgs.shift();
      await this.state.storage.put('msgs', msgs);

      return json({ ok: true, i: id, n: nick });
    }

    return json({ ok: false, why: 'method' }, 405);
  }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEAD });
    const url = new URL(req.url);

    if (url.pathname === '/' || url.pathname === '/health')
      return json({ ok: true, what: '도도블록 서버' });

    /* 💬 /r/<방이름> */
    const r = url.pathname.match(/^\/r\/(.+)$/);
    if (r) {
      const room = decodeURIComponent(r[1]);
      if (!ROOM_RE.test(room) || room.length > 24) return json({ ok: false, why: 'room' }, 400);
      return env.DODO_ROOM.get(env.DODO_ROOM.idFromName('room:' + room)).fetch(req);
    }

    /* 🔗 맡기기: POST /g/<내번호>   ·   찾기: GET /g/<번호7글자> */
    const g = url.pathname.match(/^\/g\/([A-Z0-9]+)$/i);
    if (g) {
      const raw = g[1].toUpperCase();
      if (req.method === 'POST') {
        if (!UID_RE.test(raw)) return json({ ok: false, why: 'uid' }, 400);
        const res = await env.DODO_ROOM.get(env.DODO_ROOM.idFromName('box:' + raw))
          .fetch(new Request('https://x/box', { method: 'POST', body: await req.text() }));
        const out = await res.json();
        if (!out.ok) return json(out, res.status);
        return json({ ok: true, key: raw + out.slot });
      }
      if (req.method === 'GET') {
        const uid = raw.slice(0, -1), slot = raw.slice(-1);
        if (!UID_RE.test(uid) || !/^[1-9]$/.test(slot)) return json({ ok: false, why: 'key' }, 400);
        const res = await env.DODO_ROOM.get(env.DODO_ROOM.idFromName('box:' + uid))
          .fetch(new Request('https://x/box?slot=' + slot));
        return json(await res.json(), res.status);
      }
    }

    return json({ ok: false, why: 'path' }, 404);
  }
};
