/* ═══════════════════════════════════════════════════════════════
   도도블록 "골라 쓰는 말" 대화 서버
   ───────────────────────────────────────────────────────────────
   아주 작은 서버 하나다. 하는 일은 딱 두 가지.
     ① 아이가 고른 "문장 번호"를 받아서 방에 쌓아 둔다
     ② 방에 쌓인 말을 달라고 하면 새로 온 것만 돌려준다

   ★ 왜 문장 번호만 받나 — 아이 안전 때문이다.
     아이가 글자를 직접 치지 않고 정해진 문장 중에 고르기만 하니까,
     욕설·전화번호·주소 같은 게 오갈 방법 자체가 없다.
     서버는 "3번 문장" 같은 숫자만 알고 그 문장이 무슨 말인지도 모른다.

   ★ 글자가 오가는 곳은 별명 하나뿐이라, 별명은 서버에서도 한 번 더 거른다.
     (숫자 줄줄이 = 전화번호, 금지어, 너무 긴 이름)
   ═══════════════════════════════════════════════════════════════ */

const ROOM_MAX   = 120;      // 방 하나에 남겨 두는 말 개수 (오래된 건 밀려난다)
const NICK_MAX   = 10;       // 별명 길이
const PHRASE_MAX = 399;      // 문장 번호는 0 ~ 399 까지만
const COOL_MS    = 1500;     // 같은 사람은 1.5초에 한 번만
const ROOM_RE    = /^[a-z]+(:[A-Z0-9]{4,10})?$/;   // plaza · island:AB12CD 같은 모양만

/* 별명에서 위험한 것을 걷어낸다 */
const BAD = ['시발','씨발','ㅅㅂ','좆','병신','ㅂㅅ','새끼','ㄲㅈ','지랄','미친','죽어','바보','멍청',
             'fuck','shit','bitch','sex','섹스','카톡','카카오','전화','번호','주소','학교','아파트'];
function safeNick(raw){
  let n = String(raw == null ? '' : raw).trim().slice(0, NICK_MAX);
  n = n.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9 ]/g, '');   // 한글·영문·숫자·띄어쓰기만
  n = n.replace(/\s+/g, ' ').trim();
  if (/\d{3,}/.test(n)) return '';                      // 숫자 세 개 넘게 붙으면 전화번호일 수 있다
  const low = n.toLowerCase().replace(/\s/g, '');
  for (const b of BAD) if (low.includes(b)) return '';
  return n;
}

const HEAD = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store'
};
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: HEAD });

/* ── 방 하나 = Durable Object 하나 ──
   방마다 따로 있어서 말이 섞이지 않고, 순서도 꼬이지 않는다. */
export class DodoRoom {
  constructor(state) {
    this.state = state;
    this.last = new Map();         // 누가 마지막으로 언제 말했나 (너무 빨리 못 보내게)
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
      const msgs = (await this.state.storage.get('msgs')) || [];
      const fresh = msgs.filter(m => m.i > since);
      const tenMin = Date.now() - 10 * 60 * 1000;
      const who = new Set();
      for (const m of msgs) if (m.t > tenMin) who.add(m.u);
      return json({
        ok: true,
        msgs: fresh,
        last: msgs.length ? msgs[msgs.length - 1].i : 0,
        people: who.size          // 최근 10분 안에 말한 사람 수
      });
    }

    if (req.method === 'POST') {
      let body;
      try { body = JSON.parse(await req.text()); } catch (e) { return json({ ok: false, why: 'bad' }, 400); }

      const uid = String(body.u || '').toUpperCase();
      if (!/^[A-Z0-9]{4,10}$/.test(uid)) return json({ ok: false, why: 'uid' }, 400);

      const p = parseInt(body.p, 10);
      if (!(p >= 0 && p <= PHRASE_MAX)) return json({ ok: false, why: 'phrase' }, 400);

      const now = Date.now();
      const prev = this.last.get(uid) || 0;
      if (now - prev < COOL_MS) return json({ ok: false, why: 'slow', wait: COOL_MS - (now - prev) }, 429);
      this.last.set(uid, now);
      if (this.last.size > 400) this.last.clear();

      const nick = safeNick(body.n) || ('도도' + uid.slice(0, 2));
      const msgs = (await this.state.storage.get('msgs')) || [];
      const id = (msgs.length ? msgs[msgs.length - 1].i : 0) + 1;
      msgs.push({ i: id, u: uid, n: nick, p: p, t: now });
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
      return json({ ok: true, what: '도도블록 대화 서버' });

    const m = url.pathname.match(/^\/r\/(.+)$/);
    if (!m) return json({ ok: false, why: 'path' }, 404);

    const room = decodeURIComponent(m[1]);
    if (!ROOM_RE.test(room) || room.length > 24) return json({ ok: false, why: 'room' }, 400);

    const id = env.DODO_ROOM.idFromName(room);
    return env.DODO_ROOM.get(id).fetch(req);
  }
};
