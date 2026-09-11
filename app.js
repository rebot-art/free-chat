/* =====================================================================
   링크 채팅 — 몸통 (free-chat-bf834)
   2026-09-11
   ---------------------------------------------------------------------
   [어떻게 도는가]
   · 주소에 ?r=방번호 가 없으면 → 방 만들기
   · 있으면 → 입장(닉네임+암호) → 대화
   · 로그인은 **익명**입니다. 가입도 앱 설치도 없고, 브라우저마다
     보이지 않는 번호표(uid)만 하나 받습니다. 보안 규칙이 "너 이 방
     사람이야?" 를 그 번호표로 확인해요.

   [통신량을 아끼는 세 가지 — ★ 중요]
   ① 대화는 **마지막 300개만** 받습니다 (limitToLast). 방이 오래돼도
      들어올 때마다 전부 내려받지 않아요.
   ② 읽음 표시는 사람마다 **「마지막으로 읽은 시각」 하나**만 적습니다.
      메시지마다 누가 읽었는지를 적으면 기록이 사람수 × 메시지수로
      불어나고, 그게 그대로 다운로드가 됩니다.
   ③ 그 시각도 **5초에 한 번**만 올립니다 (글자 칠 때마다 올리지 않음).

   [파일]
   · 그림은 브라우저에서 먼저 줄이고 압축해서 올립니다 (보통 1/10 이하)
   · 한글 파일 같은 건 그대로. 단 10MB 까지 — 보안 규칙도 같은 값으로
     막아 둬서, 코드를 건드려도 서버가 거부합니다
   ===================================================================== */
(function () {
  "use strict";

  const MAX_FILE   = 10 * 1024 * 1024;   // 10MB — 보안 규칙과 같은 값
  const LAST_N     = 300;                // 들어올 때 받아올 대화 수
  const READ_EVERY = 5000;               // 읽음 시각 올리는 간격
  const IMG_MAX_PX = 1600;               // 그림 긴 변 최대
  const IMG_TARGET = 400 * 1024;         // 그림 목표 크기

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const kb = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n/1024).toFixed(0) + " KB" : (n/1048576).toFixed(1) + " MB";

  /* 닉네임마다 늘 같은 색 — 여러 명이 떠들어도 누가 누군지 갈립니다 */
  const COLORS = ["#3B6EA8","#2E7D57","#B3372B","#7A5BB5","#C2762B","#1F8A8A","#B2477F","#5A6B7C"];
  const colorOf = (s) => {
    let h = 0; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return COLORS[h % COLORS.length];
  };

  /* 방번호 20자 — 이게 사실상 열쇠입니다. 짧게 만들면 찍어서 맞힐 수
     있으니 줄이지 마세요 (보안 규칙은 방 목록 자체를 안 보여 줍니다) */
  function newId(n) {
    const A = "abcdefghijklmnopqrstuvwxyz0123456789";
    const a = new Uint32Array(n || 20);
    crypto.getRandomValues(a);
    return [...a].map(x => A[x % A.length]).join("");
  }

  const q = new URLSearchParams(location.search);
  const RID = (q.get("r") || "").replace(/[^a-z0-9]/g, "").slice(0, 40);

  let db, st, me = null, myNick = "", myColor = "", roomRef = null;
  let meta = null, members = {}, lastMsgAt = 0, lastReadSent = 0, readTimer = null;
  let expTimer = null;

  function show(which) {
    ["v-make","v-join","v-room"].forEach(id => { const e = $(id); if (e) e.hidden = (id !== which); });
    const b = $("boot"); if (b) b.hidden = true;
  }
  function say(id, text, kind) {
    const e = $(id); if (!e) return;
    e.textContent = text || "";
    e.className = "note" + (kind ? " " + kind : "");
  }

  /* =====================================================================
     시작 — 익명 로그인부터
     ===================================================================== */
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  st = firebase.storage();

  firebase.auth().signInAnonymously().catch(e => {
    $("boot").textContent = "연결에 실패했어요 (" + e.code + "). 새로고침해 보세요.";
  });

  firebase.auth().onAuthStateChanged(u => {
    if (!u) return;
    me = u.uid;
    if (RID) openJoin(); else show("v-make");
  });

  /* =====================================================================
     ① 방 만들기
     ===================================================================== */
  $("m-go").addEventListener("click", async () => {
    const title = $("m-title").value.trim() || "이름 없는 대화";
    const nick  = $("m-nick").value.trim();
    const pw    = $("m-pw").value.trim();
    const hours = Number($("m-exp").value) || 24;

    if (!nick)            return say("m-msg", "닉네임을 적어 주세요.", "bad");
    if (!/^\d{4}$/.test(pw)) return say("m-msg", "암호는 숫자 네 자리예요.", "bad");

    $("m-go").disabled = true;
    say("m-msg", "만드는 중…");
    const rid = newId(20);
    const now = Date.now();
    try {
      /* ★ 두 번에 나눠 씁니다.
         보안 규칙에서 members 를 쓸 때 gate(암호)와 대조하는데, 규칙이
         보는 root 는 **쓰기 전** 상태예요. 한 번에 몰아 쓰면 gate 가
         아직 없어서 스스로 거부당합니다. */
      await db.ref("rooms/" + rid).update({
        meta: { title, createdAt: now, expireAt: now + hours * 3600000, owner: me },
        gate: pw
      });
      await db.ref("rooms/" + rid + "/members/" + me).set({
        nick, color: colorOf(nick), joinedAt: now, lastRead: now, g: pw
      });

      const url = location.origin + location.pathname + "?r=" + rid;
      $("m-url").textContent = url;
      $("m-link").hidden = false;
      say("m-msg", "만들었어요! 링크와 암호 " + pw + " 을 함께 보내세요.", "good");
      $("m-copy").onclick = () => copy(url, "m-msg");
      $("m-enter").onclick = () => { location.href = url; };
    } catch (e) {
      say("m-msg", "만들지 못했어요 (" + (e.code || e.message) + ")", "bad");
    }
    $("m-go").disabled = false;
  });

  function copy(text, msgId) {
    navigator.clipboard?.writeText(text)
      .then(() => say(msgId, "복사했어요!", "good"))
      .catch(() => say(msgId, "복사가 안 됐어요. 주소를 길게 눌러 복사해 주세요.", "bad"));
  }

  /* =====================================================================
     ② 입장
     ===================================================================== */
  async function openJoin() {
    show("v-join");
    /* 방 이름만 미리 보여 줍니다 (규칙에서 meta 는 로그인만 하면 읽혀요).
       대화는 못 읽습니다 — 그건 멤버가 되어야 열립니다. */
    try {
      const s = await db.ref("rooms/" + RID + "/meta").get();
      if (!s.exists()) { $("j-title").textContent = "없는 방이에요"; say("j-msg", "링크가 잘못됐거나 방이 지워졌어요.", "bad"); return; }
      meta = s.val();
      $("j-title").textContent = meta.title || "대화방";
      if (Date.now() >= meta.expireAt) say("j-msg", "이 방은 기간이 지났어요.", "bad");
      /* 이미 들어와 있던 사람이면 바로 통과 */
      const mine = await db.ref("rooms/" + RID + "/members/" + me).get();
      if (mine.exists()) { myNick = mine.val().nick; myColor = mine.val().color || colorOf(myNick); enterRoom(); }
    } catch (e) {
      say("j-msg", "방을 여는 데 실패했어요 (" + (e.code || e.message) + ")", "bad");
    }
  }

  $("j-go").addEventListener("click", async () => {
    const nick = $("j-nick").value.trim();
    const pw   = $("j-pw").value.trim();
    if (!nick)               return say("j-msg", "닉네임을 적어 주세요.", "bad");
    if (!/^\d{4}$/.test(pw)) return say("j-msg", "암호는 숫자 네 자리예요.", "bad");

    $("j-go").disabled = true;
    say("j-msg", "들어가는 중…");
    try {
      myNick = nick; myColor = colorOf(nick);
      await db.ref("rooms/" + RID + "/members/" + me).set({
        nick, color: myColor, joinedAt: Date.now(), lastRead: Date.now(), g: pw
      });
      enterRoom();
    } catch (e) {
      /* 규칙이 막은 것 = 십중팔구 암호가 틀린 겁니다 */
      say("j-msg", "들어가지 못했어요. 암호를 다시 확인해 주세요.", "bad");
      $("j-go").disabled = false;
    }
  });

  /* =====================================================================
     ③ 대화
     ===================================================================== */
  function enterRoom() {
    show("v-room");
    roomRef = db.ref("rooms/" + RID);
    $("r-title").textContent = (meta && meta.title) || "대화방";

    /* 참여자 — 이름줄과 읽음 세기에 씁니다 */
    roomRef.child("members").on("value", s => {
      members = s.val() || {};
      const names = Object.values(members).map(m => m.nick);
      $("r-who").textContent = names.join(" · ") + " — " + names.length + "명";
      paintRead();
    });

    /* 대화 — 마지막 300개만 */
    /* 없을 수도 있으니 ?. 로 — 두 번 들어오면 이미 지워져 있습니다 */
    $("r-loading")?.remove();
    roomRef.child("msgs").orderByChild("at").limitToLast(LAST_N)
      .on("child_added", s => { addMsg(s.key, s.val()); });

    /* 남은 기간 */
    tickExp(); expTimer = setInterval(tickExp, 30000);

    /* 나갈 때 읽음 시각을 한 번 더 올립니다 */
    addEventListener("pagehide", () => sendRead(true));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) sendRead(true); });

    $("r-invite").onclick = () => copyInvite();
    $("r-say").focus();
  }

  function copyInvite() {
    const url = location.origin + location.pathname + "?r=" + RID;
    navigator.clipboard?.writeText(url).then(() => flash("링크를 복사했어요")).catch(() => {});
  }
  function flash(text) {
    const d = document.createElement("div");
    d.className = "sys"; d.textContent = text;
    $("r-body").appendChild(d); scrollEnd();
    setTimeout(() => d.remove(), 2500);
  }

  function tickExp() {
    if (!meta) return;
    const left = meta.expireAt - Date.now();
    const e = $("r-exp");
    if (left <= 0) { e.textContent = "기간 지남"; return; }
    if (meta.expireAt - meta.createdAt > 3600000 * 24 * 365) { e.textContent = ""; return; }
    const h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000);
    e.textContent = "🔒 " + (h >= 24 ? Math.floor(h / 24) + "일 남음" : h + "시간 " + m + "분 남음");
  }

  const scrollEnd = () => { const b = $("r-body"); b.scrollTop = b.scrollHeight; };

  function addMsg(key, m) {
    if (!m) return;
    const body = $("r-body");
    const mine = m.u === me;
    const w = document.createElement("div");
    w.className = "msg" + (mine ? " me" : "");
    w.dataset.at = m.at || 0;
    w.dataset.mine = mine ? "1" : "";

    const c = m.c || colorOf(m.n || "");
    const initial = (m.n || "?").trim().slice(0, 1);
    const t = new Date(m.at || Date.now());
    const hh = t.getHours(), time = (hh < 12 ? "오전 " : "오후 ") + ((hh % 12) || 12) + ":" + String(t.getMinutes()).padStart(2, "0");

    let inner;
    if (m.f && m.f.kind === "img") {
      inner = `<a class="shot" href="${esc(m.f.url)}" target="_blank" rel="noopener">
        <img src="${esc(m.f.url)}" alt="보낸 그림" loading="lazy">
        <div class="cap">${esc(m.f.name || "화면 캡처")} · ${kb(m.f.size || 0)}</div></a>`;
      inner = `<div class="bub plain">${inner}</div>`;
    } else if (m.f) {
      const ex = (m.f.name || "").split(".").pop().toUpperCase().slice(0, 4) || "파일";
      inner = `<div class="bub plain"><a class="file" href="${esc(m.f.url)}" target="_blank" rel="noopener" download>
        <div class="ex">${esc(ex)}</div>
        <div><div class="nm">${esc(m.f.name || "파일")}</div><div class="sz">${kb(m.f.size || 0)}</div></div>
        <div class="dl">⤓</div></a></div>`;
    } else {
      inner = `<div class="bub">${esc(m.t || "")}</div>`;
    }

    w.innerHTML =
      `<div class="ava" style="background:${esc(c)}">${esc(initial)}</div>
       <div class="col"><div class="who">${esc(m.n || "")}</div>${inner}
         <div class="meta"><span>${time}</span><span class="read"></span></div></div>`;
    body.appendChild(w);
    if (m.at > lastMsgAt) lastMsgAt = m.at;
    scrollEnd();
    paintRead();
    queueRead();
  }

  /* ── 읽음 표시 ───────────────────────────────────────────────
     사람마다 lastRead(마지막으로 읽은 시각) 하나만 봅니다.
     내 말 밑에 "읽음 2" 처럼, 그 시각이 이 메시지보다 뒤인 사람 수를
     셉니다. 기록이 사람 수만큼만 쌓여서 아주 가볍습니다. */
  function paintRead() {
    const others = Object.entries(members).filter(([uid]) => uid !== me).map(([, m]) => m.lastRead || 0);
    if (!others.length) return;
    document.querySelectorAll('.msg[data-mine="1"]').forEach(el => {
      const at = Number(el.dataset.at || 0);
      const n = others.filter(r => r >= at).length;
      const tag = el.querySelector(".read");
      if (tag) tag.textContent = n ? (others.length > 1 ? "읽음 " + n : "읽음") : "";
    });
  }

  function queueRead() {
    if (readTimer) return;
    readTimer = setTimeout(() => { readTimer = null; sendRead(); }, READ_EVERY);
  }
  function sendRead(force) {
    if (!roomRef || !lastMsgAt) return;
    if (!force && lastMsgAt <= lastReadSent) return;
    lastReadSent = lastMsgAt;
    roomRef.child("members/" + me + "/lastRead").set(lastMsgAt).catch(() => {});
  }

  /* ── 보내기 ─────────────────────────────────────────────── */
  function push(extra) {
    const m = Object.assign({ u: me, n: myNick, c: myColor, at: Date.now() }, extra);
    return roomRef.child("msgs").push(m);
  }
  function sendText() {
    const el = $("r-say"); const t = el.value.trim();
    if (!t) return;
    el.value = "";
    push({ t: t.slice(0, 4000) }).catch(e => flash("못 보냈어요 (" + (e.code || "") + ")"));
  }
  $("r-send").addEventListener("click", sendText);
  $("r-say").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) sendText(); });

  /* ── 파일·그림 ──────────────────────────────────────────── */
  function prog(show, pct, label) {
    const p = $("r-prog");
    p.hidden = !show;
    if (show) { p.style.setProperty("--p", (pct || 0) + "%"); p.querySelector("span").textContent = label || ""; }
  }

  /* 그림은 올리기 전에 줄이고 압축합니다 — 화면에서 보기엔 똑같은데
     크기는 1/10 아래로 떨어집니다. 통신량이 그만큼 안 듭니다. */
  async function shrink(file) {
    const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
    const k = Math.min(1, IMG_MAX_PX / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(img.width * k));
    cv.height = Math.max(1, Math.round(img.height * k));
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    for (const qy of [0.82, 0.7, 0.6, 0.5, 0.4]) {
      const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", qy));
      if (blob && (blob.size <= IMG_TARGET || qy === 0.4)) return blob;
    }
    return file;
  }

  async function sendFile(file) {
    if (!file) return;
    const isImg = file.type.startsWith("image/");
    let blob = file, name = file.name || "capture.jpg";
    try {
      if (isImg) { blob = await shrink(file); name = file.name || ("capture_" + Date.now() + ".jpg"); }
    } catch (e) { blob = file; }

    if (blob.size > MAX_FILE) { flash("10MB 까지만 보낼 수 있어요 (" + kb(blob.size) + ")"); return; }

    const path = "rooms/" + RID + "/" + newId(16) + "_" + name.replace(/[^\w.\-가-힣]/g, "_").slice(0, 60);
    const ref = st.ref(path);
    const task = ref.put(blob, { contentType: blob.type || "application/octet-stream" });
    prog(true, 0, name + " 보내는 중…");
    task.on("state_changed",
      s => prog(true, Math.round(s.bytesTransferred / s.totalBytes * 100), name + " 보내는 중…"),
      e => { prog(false); flash("파일을 못 보냈어요 (" + (e.code || "") + ")"); },
      async () => {
        prog(false);
        const url = await ref.getDownloadURL();
        push({ f: { name, size: blob.size, url, path, kind: isImg ? "img" : "file" } })
          .catch(() => flash("파일은 올라갔는데 대화에 못 실었어요"));
      });
  }

  $("r-clip").addEventListener("click", () => $("r-file").click());
  $("r-file").addEventListener("change", e => { [...e.target.files].forEach(sendFile); e.target.value = ""; });

  document.addEventListener("paste", e => {
    if ($("v-room").hidden) return;
    const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
    if (it) { e.preventDefault(); sendFile(it.getAsFile()); }
  });

  const room = $("v-room");
  let dragN = 0;
  ["dragenter","dragover"].forEach(t => room.addEventListener(t, e => {
    e.preventDefault(); if (t === "dragenter") dragN++; $("r-drop").hidden = false;
  }));
  room.addEventListener("dragleave", e => { e.preventDefault(); if (--dragN <= 0) $("r-drop").hidden = true; });
  room.addEventListener("drop", e => {
    e.preventDefault(); dragN = 0; $("r-drop").hidden = true;
    [...(e.dataTransfer?.files || [])].forEach(sendFile);
  });
})();
