(() => {
  const COLORS = [["#d9b45a","#2a2414"],["#f29a2e","#2b1d0e"],["#e5484d","#2b1213"],["#8e8cf0","#1b1a2e"],["#3dd68c","#0f2a1d"]];
  const TYPES = {
    cinecheque: { label:"CinéChèque", color:"var(--gold)",
      confirm: `Liste des cinémas affiliés : <a href="https://www.reseauxdecines.com/loc/ecinecheque.html" target="_blank" rel="noopener">reseauxdecines.com/loc/ecinecheque.html</a>`,
      cond: `Ce e-billet CinéChèque est valable uniquement dans un réseau de cinémas spécifique, différent de celui du CinéChèque papier classique.<br>Liste des cinémas affiliés : <a href="https://www.reseauxdecines.com/loc/ecinecheque.html" target="_blank" rel="noopener">reseauxdecines.com/loc/ecinecheque.html</a><span class="city">📍 À Rennes : TNB et Arvor</span>` },
    pathe: { label:"Pathé", color:"var(--amber)",
      confirm: `Valable pour une séance standard. Tout supplément (3D, IMAX, 4DX…) est à régler en plus sur place.`,
      cond: `Valable pour une séance standard, hors séances spéciales. Tout supplément (3D, IMAX, IMAX 3D, fauteuil premium, D-Box et prestations complémentaires) est à régler en plus sur place.` }
  };
  // Programmes des cinémas de Rennes (affichés sous les boutons de réservation)
  const CINE_LINKS = {
    cinecheque: [
      { name: "TNB",   url: "https://www.t-n-b.fr/programmation?subsections=cinema" },
      { name: "Arvor", url: "https://www.cinema-arvor.fr/seances/" },
    ],
    pathe: [
      { name: "Pathé Rennes", url: "https://www.pathe.fr/cinemas/cinema-pathe-rennes" },
    ],
  };
  function setCond(el, type){ const T = TYPES[type]; el.innerHTML = T ? T.cond : ""; el.style.display = T ? "" : "none"; el.classList.toggle("pathe", type === "pathe"); }

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  document.querySelectorAll(".cinfo").forEach(b => b.onclick = () => {
    const T = TYPES[b.dataset.t]; $("iType").textContent = T.label; $("iType").style.color = T.color;
    setCond($("iCond"), b.dataset.t); $("infoOv").classList.add("on");
  });
  $("iClose").onclick = () => $("infoOv").classList.remove("on");
  $("infoOv").onclick = e => { if (e.target === $("infoOv")) $("infoOv").classList.remove("on"); };

  let profilesList = [], profile = null, state = null, busy = false, isAdmin = false, admCodes = [], pollT = null;

  async function api(action, body){
    const r = await fetch("api.php?a=" + action, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    let data = {};
    try { data = await r.json(); } catch(e){ data = { error: "Réponse invalide du serveur" }; }
    if (r.status === 401 && data.error === "auth") { goLock(); throw data; }
    if (!r.ok) throw data;
    return data;
  }

  function show(id){ document.querySelectorAll(".screen").forEach(s => s.classList.toggle("on", s.id === id)); }
  let toastT;
  function toast(msg){ const t=$("toast"); t.textContent=msg; t.classList.add("on"); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("on"),2600); }
  const initials = n => (n.trim().split(/\s+/).map(w=>w[0]).join("").slice(0,2) || "?").toUpperCase();
  const avatarHtml = (i, n) => { const [fg,bg]=COLORS[i%COLORS.length]; return `<div class="avatar" style="color:${fg};background:${bg}">${esc(initials(n))}</div>`; };
  const FACE_PH = {
    1: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ffe1c6"/><path d="M14 40 C16 14 84 14 86 40 C78 26 22 26 14 40Z" fill="#6b4a32"/><circle cx="35" cy="50" r="5" fill="#2b2b2b"/><circle cx="65" cy="50" r="5" fill="#2b2b2b"/><path d="M36 70 Q50 78 64 70" stroke="#2b2b2b" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="24" cy="64" r="6" fill="#ffb3a7" opacity=".7"/><circle cx="76" cy="64" r="6" fill="#ffb3a7" opacity=".7"/></svg>'),
    2: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ffe1c6"/><path d="M14 40 C16 14 84 14 86 40 C78 26 22 26 14 40Z" fill="#6b4a32"/><path d="M29 50 Q35 44 41 50" stroke="#2b2b2b" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="65" cy="49" r="5" fill="#2b2b2b"/><path d="M30 64 Q50 90 70 64 Z" fill="#7a2b2b"/><path d="M36 66 L64 66 L62 70 L38 70Z" fill="#fff"/><circle cx="22" cy="62" r="7" fill="#ffb3a7" opacity=".8"/><circle cx="78" cy="62" r="7" fill="#ffb3a7" opacity=".8"/></svg>'),
  };
  let faceVer = Date.now();
  const faceUrl = n => window.CC_FACE_URL ? window.CC_FACE_URL(n) : "api.php?a=face&n=" + n + "&t=" + faceVer;
  function setFace(img, n){
    const u = faceUrl(n);
    img.onerror = () => { img.onerror = null; img.src = FACE_PH[n]; };
    img.src = u || FACE_PH[n];
  }

  /* ---------- L'ange : place offerte ---------- */
  function playAngel(){
    return new Promise(resolve => {
      const el = $("angel");
      setFace($("angFace1"), 1); setFace($("angFace2"), 2);
      el.classList.remove("arrived", "leave", "on"); void el.offsetWidth;
      el.classList.add("on");
      let done = false, ready = false;
      const finish = () => {
        if (done || !ready) return; done = true;
        el.classList.add("leave");
        setTimeout(() => { el.classList.remove("on", "arrived", "leave"); resolve(); }, 450);
      };
      setTimeout(() => { el.classList.add("arrived"); setTimeout(() => { ready = true; }, 600); setTimeout(() => { ready = true; finish(); }, 4200); }, 2300);
      el.onclick = finish;
    });
  }

  const pdfUrl = (id, dl) => window.CC_PDF_URL ? window.CC_PDF_URL(id, dl) : "api.php?a=pdf&id=" + encodeURIComponent(id) + (dl ? "&dl=1" : "");
  const dfr = d => d ? new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day:"numeric", month:"short", year:"numeric" }) : "";
  const daysLeft = (d, today) => Math.round((new Date(d + "T12:00:00") - new Date((today || new Date().toISOString().slice(0,10)) + "T12:00:00")) / 86400000);
  const eur = v => (Math.round((v||0)*100)/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
  const fmt = ts => ts ? new Date(ts).toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}) + " " + new Date(ts).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}) : "";

  /* ---------- Écrans ---------- */
  function goLock(){ stopPoll(); profile = null; isAdmin = false; $("codeOv").classList.remove("on"); $("admOv").classList.remove("on"); show("lock"); setTimeout(()=>$("pw").focus(), 50); }

  async function goProfiles(){
    stopPoll();
    const r = await api("profiles");
    profilesList = r.profiles;
    $("plist").innerHTML = profilesList.map((n,i) =>
      `<button class="pcard" data-i="${i}">${avatarHtml(i,n)}<div class="pname">${esc(n)}</div></button>`).join("");
    $("plist").querySelectorAll(".pcard").forEach(b => b.onclick = async () => {
      try { await api("select", { profile: profilesList[+b.dataset.i] }); goApp(); }
      catch(e){ toast(e.error || "Erreur"); goProfiles(); }
    });
    show("profiles");
  }

  async function goApp(){
    await refresh();
    if (!state || !state.profile) return goProfiles();
    show("app");
    startPoll();
    loadFilms();
  }

  /* ---------- Films à l'affiche ---------- */
  let films = null, curFilm = null, curKind = "now";
  const lists = { now: null, soon: null };
  const HUES = [32, 0, 210, 265, 150, 45, 190, 330];
  const fdate = d => d ? new Date(d).toLocaleDateString("fr-FR",{day:"numeric",month:"long"}) : "";
  function posterHtml(f, i, rank, badge){
    // Dégradé + titre toujours présents en fond ; l'affiche (img) se pose dessus si elle se charge.
    const bg = `background:linear-gradient(160deg,hsl(${HUES[i%HUES.length]} 45% 26%),#0c0c0e 85%)`;
    const img = f.poster ? `<img class="pimg" src="${esc(f.poster)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : "";
    return `<div class="poster" style="${bg}"><div class="ph">${esc(f.title)}</div>${img}${rank ? `<div class="rank">${rank}</div>` : ""}${badge ? `<div class="dbadge">${esc(badge)}</div>` : ""}</div>`;
  }
  const shortDate = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day:"numeric", month:"short" });
  const inDays = d => { const n = daysLeft(d); return n <= 0 ? "" : n === 1 ? "demain" : n < 7 ? `dans ${n} jours` : n < 14 ? "dans 1 semaine" : `dans ${Math.round(n/7)} semaines`; };
  async function fetchList(kind){
    if (lists[kind]) return lists[kind];
    try { lists[kind] = (await api("films", { kind })).films || []; } catch(e){ lists[kind] = []; }
    return lists[kind];
  }
  function renderStrip(){
    films = lists[curKind] || [];
    const soon = curKind === "soon";
    $("strip").innerHTML = films.length ? films.map((f,i) =>
      `<button class="film" data-i="${i}">${soon ? posterHtml(f,i,null,f.date ? shortDate(f.date) : "") : posterHtml(f,i,i+1)}<div class="ftitle">${esc(f.title)}</div><div class="fdate">${soon ? (f.date ? "Sortie " + inDays(f.date) : "") : (f.date ? "Sorti le " + fdate(f.date) : "")}</div></button>`).join("")
      : `<div class="fstrip-empty">${soon ? "Pas de sorties annoncées pour l'instant." : "Pas de films pour l'instant."}</div>`;
    $("strip").querySelectorAll(".film").forEach(b => b.onclick = () => openFilm(+b.dataset.i));
    $("strip").scrollLeft = 0;
  }
  async function loadFilms(){
    const now = await fetchList("now");
    if (!now.length) return;
    renderStrip();
    $("films").style.display = "";
  }
  document.querySelectorAll(".ftab").forEach(t => t.onclick = async () => {
    if (t.dataset.k === curKind) return;
    curKind = t.dataset.k;
    document.querySelectorAll(".ftab").forEach(x => { x.classList.toggle("on", x === t); x.setAttribute("aria-selected", x === t); });
    if (!lists[curKind]) $("strip").innerHTML = `<div class="fstrip-empty">Chargement…</div>`;
    await fetchList(curKind);
    renderStrip();
  });
  function openFilm(i){
    const f = films[i]; curFilm = f;
    const p = $("fPoster");
    p.outerHTML = posterHtml(f, i).replace('class="poster"', 'class="poster" id="fPoster"');
    $("fTitle").textContent = f.title;
    $("fMeta").textContent = [f.date ? "Sortie : " + fdate(f.date) : "", f.note ? "★ " + f.note.toFixed(1) + "/10" : ""].filter(Boolean).join("  ·  ");
    const soon = curKind === "soon";
    $("fBtns").style.display = soon ? "none" : "";
    $("fSoon").style.display = soon ? "block" : "none";
    if (soon) $("fSoon").textContent = f.date ? `🗓️ Sortie au cinéma le ${fdate(f.date)} (${inDays(f.date) || "bientôt"})` : "🗓️ Bientôt au cinéma";
    $("fSyn").textContent = f.overview || "Pas de résumé disponible.";
    const n = state ? state.counts : {cinecheque:0,pathe:0};
    $("fCC").disabled = !n.cinecheque; $("fPA").disabled = !n.pathe;
    $("fCC").style.opacity = n.cinecheque ? 1 : .35; $("fPA").style.opacity = n.pathe ? 1 : .35;
    $("filmOv").classList.add("on");
  }
  $("filmOv").onclick = e => { if (e.target === $("filmOv")) $("filmOv").classList.remove("on"); };
  $("fCC").onclick = () => { $("filmOv").classList.remove("on"); askClaim("cinecheque", curFilm && curFilm.title); };
  $("fPA").onclick = () => { $("filmOv").classList.remove("on"); askClaim("pathe", curFilm && curFilm.title); };

  /* ---------- Mot de passe ---------- */
  $("lockForm").addEventListener("submit", async e => {
    e.preventDefault();
    const val = $("pw").value;
    if (!val) return;
    $("pwBtn").disabled = true;
    try {
      await api("login", { password: val });
      $("pw").value = ""; $("pwErr").textContent = "";
      await goProfiles();
    } catch(err) {
      $("pwErr").textContent = err.error || "Erreur";
      const f = $("lockForm"); f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake");
    }
    $("pwBtn").disabled = false;
  });

  $("whoBtn").onclick = () => goProfiles().catch(()=>{});
  $("logoutBtn").onclick = async () => { try { await api("logout"); } catch(e){} goLock(); };

  /* ---------- Codes ---------- */
  async function refresh(){
    try { state = await api("state"); isAdmin = state.admin; render(); }
    catch(e){ if (e && e.error !== "auth") $("status").textContent = "Connexion au serveur impossible…"; }
  }
  function startPoll(){ stopPoll(); pollT = setInterval(() => { if (!document.hidden) refresh(); }, 5000); }
  function stopPoll(){ clearInterval(pollT); pollT = null; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && pollT) refresh(); });

  function render(){
    if (!state) return;
    $("status").textContent = "";
    profile = state.profile;
    if (profile) {
      const i = Math.max(0, profilesList.indexOf(profile));
      $("whoBtn").innerHTML = avatarHtml(i, profile) + `<span style="font-size:14px;font-weight:500">${esc(profile)}</span>`;
      $("helloT").textContent = "Bonjour " + profile;
    }
    const nCC = state.counts.cinecheque, nPA = state.counts.pathe;
    $("ccN").textContent = nCC; $("paN").textContent = nPA;
    $("ccBtn").disabled = busy || nCC === 0;
    $("paBtn").disabled = busy || nPA === 0;
    $("ccBtn").textContent = nCC === 0 ? "Plus de place" : "Prendre une place";
    $("paBtn").textContent = nPA === 0 ? "Plus de place" : "Prendre une place";

    const pay = state.pay;
    if (pay) {
      [["ccPrice","cinecheque"],["paPrice","pathe"]].forEach(([id,t]) => {
        $(id).innerHTML = `<b>${eur(pay.price[t])}</b>${pay.full[t] > pay.price[t] ? `<span>au lieu de ${eur(pay.full[t])} (prix standard)</span>` : ""}`;
      });
    }

    const mine = state.mine;
    const due = mine.filter(c => !c.paid);
    $("owed").textContent = eur(state.owed);
    $("owed").classList.toggle("zero", !state.owed);
    $("owedSub").innerHTML = state.owed
      ? `Pour ${due.length} place${due.length>1?"s":""}, quand tu peux 🙂`
      : (mine.length ? "Tout est remboursé, merci ! 🙌" : "Rien à rembourser");
    const phone = pay && pay.phone;
    $("weroBox").style.display = phone ? "" : "none";
    if (phone) $("weroNum").textContent = phone;

    $("hist").innerHTML = mine.length ? mine.map((c,k) => {
      const T = TYPES[c.type] || {label:c.type,color:"var(--muted)"};
      return `<div class="hrow" data-k="${k}" role="button" tabindex="0"><span class="dot" style="background:${T.color}"></span><span class="k">${c.file ? "📄 " : ""}${esc(c.code)}</span><span class="t">${esc(T.label)} · ${eur(c.price)} · ${fmt(c.takenAt)}${c.expires ? ` · <span class="exp ${daysLeft(c.expires) < 0 ? "gone" : daysLeft(c.expires) <= 14 ? "soon" : ""}">valable jusqu'au ${dfr(c.expires)}</span>` : ""}</span>${c.offered
        ? `<span class="badge gift">Offerte 🎁</span>`
        : c.paid
        ? `<button class="badge ok" data-undo="${esc(c.id)}" title="Annuler">Remboursé ✓</button>`
        : `<button class="paybtn" data-pay="${esc(c.id)}">J'ai remboursé</button>`}</div>`;
    }).join("") : `<div class="empty">Aucune place réservée pour l'instant.</div>`;
    $("hist").querySelectorAll(".hrow").forEach(b => {
      b.onclick = e => { if (!e.target.closest("button")) openCode(mine[+b.dataset.k]); };
      b.onkeydown = e => { if (e.key === "Enter" && e.target === b) openCode(mine[+b.dataset.k]); };
    });
    $("hist").querySelectorAll("[data-pay]").forEach(b => b.onclick = () => myPaid({ id: b.dataset.pay, paid: true }, b));
    $("hist").querySelectorAll("[data-undo]").forEach(b => b.onclick = () => {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Annuler ?"; setTimeout(() => { if (b.isConnected) { b.dataset.sure = ""; b.textContent = "Remboursé ✓"; } }, 3000); return; }
      myPaid({ id: b.dataset.undo, paid: false }, b);
    });
    $("payAll").style.display = due.length > 1 ? "" : "none";

    const ICON = `<span class="ldot" aria-hidden="true"></span>`;
    [["ccLinks","cinecheque"],["paLinks","pathe"]].forEach(([id,t]) => {
      $(id).innerHTML = CINE_LINKS[t].map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${ICON}${esc(l.name)}</a>`).join("");
    });
  }

  async function claim(type){
    if (busy) return;
    busy = true; render(); $("status").textContent = "Récupération du code…";
    try {
      const r = await api("claim", { type });
      $("status").textContent = "";
      if (r.code.offered) await playAngel();
      openCode(r.code);
    } catch(e){ toast(e.error || "Erreur, réessayez."); }
    busy = false;
    await refresh();
  }
  $("ccBtn").onclick = () => askClaim("cinecheque");
  $("paBtn").onclick = () => askClaim("pathe");

  /* ---------- Confirmation ---------- */
  let pending = null;
  function askClaim(type, film){
    if (busy) return;
    pending = type;
    const T = TYPES[type];
    $("cTitle").textContent = "Réservation d'une place " + T.label;
    const pay = state && state.pay;
    $("cPrice").innerHTML = pay ? `Prix : <b>${eur(pay.price[type])}</b>` + (pay.full[type] > pay.price[type] ? ` <span style="color:var(--muted)">au lieu de ${eur(pay.full[type])} (prix standard)</span>` : "") : "";
    $("cCond").classList.toggle("pathe", type === "pathe");
    $("cCond").innerHTML = `En cliquant sur « Oui, je réserve », la place sera attribuée à <b>${esc(profile)}</b>${film ? ` pour voir <b>${esc(film)}</b>` : ""}.`
      + `<span style="display:block;margin-top:8px">${T.confirm}</span>`;
    $("cIcon").style.background = type === "pathe" ? "var(--amber-soft)" : "var(--gold-soft)";
    $("cOk").style.background = T.color;
    $("confirmOv").classList.add("on");
    setTimeout(() => $("cOk").focus(), 50);
  }
  const closeConfirm = () => { $("confirmOv").classList.remove("on"); pending = null; };
  $("cCancel").onclick = closeConfirm;
  $("confirmOv").onclick = e => { if (e.target === $("confirmOv")) closeConfirm(); };
  $("cOk").onclick = () => { const t = pending; closeConfirm(); if (t) claim(t); };

  $("weroCopy").onclick = async () => {
    const n = $("weroNum").textContent.replace(/\s/g, "");
    try { await navigator.clipboard.writeText(n); $("weroCopy").textContent = "Copié ✓"; }
    catch(e){ const r=document.createRange(); r.selectNodeContents($("weroNum")); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r); $("weroCopy").textContent = "Sélectionné"; }
    setTimeout(() => $("weroCopy").textContent = "Copier le numéro", 2000);
  };

  async function myPaid(body, btn){
    if (btn) btn.disabled = true;
    try { await api("my_paid", body); await refresh(); if (body.paid !== false) toast("Merci ! 🙌"); }
    catch(e){ toast(e.error || "Erreur, réessaie."); if (btn) btn.disabled = false; }
  }
  $("payAll").onclick = () => {
    const b = $("payAll");
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Sûr ? Clique pour confirmer"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "J'ai tout remboursé"; }, 3000); return; }
    b.dataset.sure = ""; b.textContent = "J'ai tout remboursé";
    myPaid({ all: true, paid: true }, b).then(() => { b.disabled = false; });
  };

  /* ---------- Pop-up ---------- */
  let curCode = null;
  function openCode(c){
    curCode = c;
    const saved = (state && state.myEmail) || "";
    $("mailTo").value = saved; $("mailTo").classList.remove("bad");
    $("mailRemember").checked = !!saved;
    $("mailOk").textContent = ""; $("mailOk").style.color = "";
    $("mailBtn").disabled = false; $("mailBtn").textContent = "Envoyer";
    const T = TYPES[c.type] || {label:c.type,color:"var(--text)"};
    $("mType").textContent = T.label; $("mType").style.color = T.color;
    const isPdf = !!c.file;
    $("mCode").style.display = isPdf ? "none" : "";
    $("mPdf").style.display = isPdf ? "" : "none";
    $("mCopy").style.display = isPdf ? "none" : "";
    $("mCode").textContent = isPdf ? "" : c.code;
    if (isPdf) {
      $("mPdfName").textContent = c.code + ".pdf";
      $("mOpen").href = pdfUrl(c.id, false);
      $("mDl").href = pdfUrl(c.id, true);
    }
    $("mMeta").innerHTML = esc("Récupéré par " + (c.takenBy || profile) + (c.takenAt ? " · " + fmt(c.takenAt) : "")) + (c.offered ? ` · <b style="color:#5b3fc4">Offerte 🎁</b>` : "")
      + (c.expires ? `<br><span class="exp ${daysLeft(c.expires) <= 14 ? "soon" : ""}" style="font-size:12px">Valable jusqu'au ${dfr(c.expires)}</span>` : "");
    $("mCopy").textContent = "Copier";
    $("codeOv").classList.add("on");
  }
  $("mailTo").addEventListener("input", () => { $("mailTo").classList.remove("bad"); $("mailOk").textContent = ""; });
  $("mailForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!curCode) return;
    const email = $("mailTo").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      $("mailTo").classList.add("bad"); $("mailOk").style.color = "var(--red)"; $("mailOk").textContent = "Entre une adresse e-mail valide."; return;
    }
    $("mailBtn").disabled = true; $("mailBtn").textContent = "Envoi…"; $("mailOk").textContent = "";
    try {
      await api("send_place", { id: curCode.id, email, remember: $("mailRemember").checked });
      $("mailOk").style.color = ""; $("mailOk").textContent = "Envoyé à " + email + " ✓ (regarde aussi dans les spams)";
      $("mailBtn").textContent = "Renvoyer";
      if (state) state.myEmail = $("mailRemember").checked ? email : "";
    } catch(err){
      $("mailOk").style.color = "var(--red)"; $("mailOk").textContent = err.error || "L'envoi a échoué, réessaie.";
      $("mailBtn").textContent = "Envoyer";
    }
    $("mailBtn").disabled = false;
  });
  $("mClose").onclick = () => $("codeOv").classList.remove("on");
  $("codeOv").onclick = e => { if (e.target === $("codeOv")) $("codeOv").classList.remove("on"); };
  $("mCopy").onclick = async () => {
    try { await navigator.clipboard.writeText($("mCode").textContent); $("mCopy").textContent = "Copié ✓"; }
    catch(e){ const r=document.createRange(); r.selectNodeContents($("mCode")); const s=getSelection(); s.removeAllRanges(); s.addRange(r); $("mCopy").textContent = "Sélectionné"; }
  };

  /* ---------- Gestion ---------- */
  let addType = "cinecheque", stockType = "cinecheque";
  function seg(id, cb){ $(id).querySelectorAll("button").forEach(b => b.onclick = () => { $(id).querySelectorAll("button").forEach(x=>x.classList.toggle("on", x===b)); cb(b.dataset.t); }); }
  seg("addType", t => { addType = t; $("drop").dataset.t = t; $("dropType").textContent = TYPES[t].label; });
  seg("stockType", t => { stockType = t; renderStock(); });

  function admView(){
    $("admLogin").style.display = isAdmin ? "none" : "";
    $("admBody").style.display = isAdmin ? "" : "none";
  }
  async function loadAdmin(){
    const r = await api("admin_state");
    admCodes = r.codes; profilesList = r.profiles; admPay = r.pay; admToday = r.today;
    const site = r.site || { email:"", links:[] };
    if (document.activeElement !== $("alertEmail")) $("alertEmail").value = site.email || "";
    renderAlerts();
    renderDash();
    if (document.activeElement !== $("giftRate")) $("giftRate").value = site.giftRate ?? 10;
    faceVer = Date.now(); setFace($("adFace1"), 1); setFace($("adFace2"), 2);
    if (document.activeElement === null || !document.activeElement.closest || !document.activeElement.closest(".pgrid")) {
      $("pCC").value = String(admPay.price.cinecheque).replace(".", ","); $("pPA").value = String(admPay.price.pathe).replace(".", ",");
      $("fCCp").value = String(admPay.full.cinecheque).replace(".", ","); $("fPAp").value = String(admPay.full.pathe).replace(".", ",");
      if (document.activeElement !== $("pPhone")) $("pPhone").value = admPay.phone || "";
    }
    renderBal();
    $("profEdit").innerHTML = profilesList.map((n,i)=>`<input class="tin" data-i="${i}" value="${esc(n)}" maxlength="24">`).join("");
    renderStock();
    renderLog();
  }

  let admPay = null, admToday = null;

  /* ---------- Page admin : onglets ---------- */
  function showTab(p){
    document.querySelectorAll(".atab").forEach(t => t.classList.toggle("on", t.dataset.p === p));
    document.querySelectorAll(".apane").forEach(s => s.classList.toggle("on", s.dataset.p === p));
    try { localStorage.setItem("cc_atab", p); } catch(e){}
    const pnl = document.querySelector(".panel.apanel"); if (pnl) pnl.scrollTop = 0;
    $("admOv").scrollTop = 0;
  }
  document.querySelectorAll(".atab").forEach(t => t.onclick = () => showTab(t.dataset.p));
  document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.st) { const sb = document.querySelector(`#stockType button[data-t="${b.dataset.st}"]`); if (sb) sb.click(); }
    showTab(b.dataset.go);
  }));
  try { const t = localStorage.getItem("cc_atab"); if (t && document.querySelector(`.atab[data-p="${t}"]`)) showTab(t); } catch(e){}

  /* ---------- Tableau de bord ---------- */
  function renderDash(){
    const isAvail = c => !c.taken && !(c.expires && daysLeft(c.expires, admToday) < 0);
    const nCC = admCodes.filter(c => c.type === "cinecheque" && isAvail(c)).length;
    const nPA = admCodes.filter(c => c.type === "pathe" && isAvail(c)).length;
    const due = admCodes.filter(c => c.taken && !c.paid);
    const total = due.reduce((s, c) => s + (c.price || 0), 0);
    const people = new Set(due.map(c => c.takenBy)).size;
    const soon = admCodes.filter(c => isAvail(c) && c.expires && daysLeft(c.expires, admToday) <= 14).length;
    $("kCC").textContent = nCC; $("kPA").textContent = nPA;
    $("kDue").textContent = eur(total);
    $("kDueS").textContent = total ? `${people} personne${people > 1 ? "s" : ""}` : "tout est réglé";
    $("kExp").textContent = soon;
    document.querySelector('.kpi[data-st="cinecheque"]').classList.toggle("low", nCC <= 1);
    document.querySelector('.kpi[data-st="pathe"]').classList.toggle("low", nPA <= 1);
    $("kExp").closest(".kpi").classList.toggle("warn", soon > 0);
    const recent = admCodes.filter(c => c.taken).sort((a, b) => (b.takenAt || 0) - (a.takenAt || 0)).slice(0, 6);
    $("recent").innerHTML = recent.length ? recent.map(c => { const T = TYPES[c.type] || { label: c.type, color: "var(--muted)" };
      const st = c.offered ? `<span class="badge gift" style="grid-column:3;grid-row:2;justify-self:end">Offerte 🎁</span>` : `<span class="badge ${c.paid ? "ok" : "due"}" style="grid-column:3;grid-row:2;justify-self:end">${c.paid ? "Réglé" : "À régler"}</span>`;
      return `<div class="lrow"><span class="who2">${esc(c.takenBy || "?")}</span><span class="ty" style="color:${T.color}">${esc(T.label)} · ${eur(c.price)}</span><span class="d">${fmt(c.takenAt)}</span><span class="k">${c.file ? "📄 " : ""}${esc(c.code)}</span>${st}</div>`; }).join("")
      : `<div class="empty">Aucune réservation pour l'instant.</div>`;
  }
  function renderAlerts(){
    const out = [];
    ["cinecheque","pathe"].forEach(t => {
      const av = admCodes.filter(c => c.type === t && !c.taken && !(c.expires && daysLeft(c.expires, admToday) < 0));
      if (av.length <= 1) out.push([av.length ? "" : "red", av.length ? `Plus qu'une place ${TYPES[t].label} en stock.` : `Plus aucune place ${TYPES[t].label} en stock.`]);
      const soon = av.filter(c => c.expires && daysLeft(c.expires, admToday) <= 14);
      if (soon.length) out.push(["", `${soon.length} place${soon.length>1?"s":""} ${TYPES[t].label} expire${soon.length>1?"nt":""} dans moins de 15 jours.`]);
      const gone = admCodes.filter(c => c.type === t && !c.taken && c.expires && daysLeft(c.expires, admToday) < 0);
      if (gone.length) out.push(["red", `${gone.length} place${gone.length>1?"s":""} ${TYPES[t].label} expirée${gone.length>1?"s":""} (plus proposée${gone.length>1?"s":""}).`]);
    });
    $("admAlerts").innerHTML = out.map(([cls, txt]) => `<div class="${cls}">⚠︎ ${esc(txt)}</div>`).join("");
  }
  $("siteSave").onclick = async () => {
    try {
      await api("admin_site_settings", { email: $("alertEmail").value.trim(), links: [] });
      $("siteOk").style.color = ""; $("siteOk").textContent = "Enregistré ✓";
      await loadAdmin();
    } catch(e){ $("siteOk").style.color = "var(--red)"; $("siteOk").textContent = e.error || "Erreur"; }
  };
  $("giftSave").onclick = async () => {
    const v = parseInt($("giftRate").value, 10);
    if (isNaN(v) || v < 0 || v > 100) { $("giftOk").style.color = "var(--red)"; $("giftOk").textContent = "Entre un nombre entre 0 et 100."; return; }
    try { await api("admin_site_settings", { giftRate: v }); $("giftOk").style.color = ""; $("giftOk").textContent = v ? `Enregistré ✓ : 1 réservation sur ${v} est offerte` : "Enregistré ✓ : l'ange est désactivé"; $("giftRate").blur(); }
    catch(e){ $("giftOk").style.color = "var(--red)"; $("giftOk").textContent = e.error || "Erreur"; }
  };
  [1, 2].forEach(n => $("faceIn" + n).addEventListener("change", async () => {
    const f = $("faceIn" + n).files[0]; if (!f) return;
    $("giftOk").style.color = ""; $("giftOk").textContent = "Envoi de la photo…";
    const fd = new FormData(); fd.append("n", n); fd.append("file", f);
    try {
      const r = await fetch("api.php?a=admin_upload_face", { method: "POST", body: fd, credentials: "same-origin" });
      let d = {}; try { d = await r.json(); } catch(e){ d = { error: "Réponse invalide (image trop lourde ?)" }; }
      if (!r.ok) throw d;
      faceVer = Date.now(); setFace($("adFace" + n), n);
      $("giftOk").textContent = "Photo enregistrée ✓";
    } catch(e){ $("giftOk").style.color = "var(--red)"; $("giftOk").textContent = e.error || "Erreur"; }
    $("faceIn" + n).value = "";
  }));
  $("angelTest").onclick = async () => { $("admOv").classList.remove("on"); await playAngel(); $("admOv").classList.add("on"); };

  $("filmsRefresh").onclick = async () => {
    $("filmsOk").style.color = ""; $("filmsOk").textContent = "Mise à jour…";
    try {
      await api("admin_refresh_films");
      lists.now = null; lists.soon = null; films = null; $("strip").innerHTML = ""; $("films").style.display = "none";
      await loadFilms();
      await fetchList("soon");
      const nNow = (lists.now || []).length, nSoon = (lists.soon || []).length;
      let msg = nNow ? `${nNow} films à l'affiche, ${nSoon} prochainement ✓` : "Aucun film reçu (clé TMDB ?)";
      try {
        const d = await api("admin_films_check");
        if (d.withPoster === 0) msg += " · TMDB n'a fourni aucune affiche.";
        else if (!d.curl) msg += " · Problème : cURL indisponible sur le serveur.";
        else if (d.http === 200 && d.bytes > 100) msg += d.writable === false ? " · Affiches OK chez TMDB, mais dossier data/posters non modifiable (permissions 755)." : ` · Affiches OK (serveur → TMDB : ${Math.round(d.bytes/1024)} Ko reçus, ${d.cached} en cache).`;
        else msg += ` · Affiches : le serveur n'arrive pas à joindre TMDB (code ${d.http || "aucun"}${d.error ? ", " + d.error : ""}).`;
      } catch(e){}
      $("filmsOk").textContent = msg;
    } catch(e){ $("filmsOk").style.color = "var(--red)"; $("filmsOk").textContent = e.error || "Erreur"; }
  };
  $("testMail").onclick = async () => {
    $("siteOk").style.color = ""; $("siteOk").textContent = "Envoi du test…";
    try {
      await api("admin_site_settings", { email: $("alertEmail").value.trim(), links: [] });
      await api("admin_test_mail");
      $("siteOk").textContent = "E-mail de test envoyé ✓ (pensez à regarder dans les spams)";
    } catch(e){ $("siteOk").style.color = "var(--red)"; $("siteOk").textContent = e.error || "Erreur"; }
  };
  function renderBal(){
    const per = {};
    admCodes.filter(c => c.taken && !c.paid).forEach(c => { per[c.takenBy] = (per[c.takenBy] || 0) + (c.price || 0); });
    const names = [...new Set([...profilesList, ...Object.keys(per)])];
    const total = Object.values(per).reduce((a,b) => a+b, 0);
    $("bal").innerHTML = names.map(n => { const v = Math.round((per[n]||0)*100)/100; const i = profilesList.indexOf(n);
      return `<div class="brow"><span class="dot" style="background:${COLORS[(i<0?0:i)%COLORS.length][0]}"></span><span class="n">${esc(n)}</span><span class="v ${v?"":"zero"}">${eur(v)}</span>${v ? `<button class="btn small" data-paid="${esc(n)}">Marquer réglé</button>` : `<span class="badge ok">À jour</span>`}</div>`; }).join("")
      + `<div class="brow" style="background:none;padding-top:4px"><span class="n" style="color:var(--muted);font-weight:500">Total à recevoir</span><span class="v">${eur(total)}</span></div>`;
    $("bal").querySelectorAll("[data-paid]").forEach(b => b.onclick = async () => {
      const n = b.dataset.paid;
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Confirmer ?"; setTimeout(() => { if (b.isConnected) { b.dataset.sure = ""; b.textContent = "Marquer réglé"; } }, 3000); return; }
      try { await api("admin_paid", { profile: n }); await loadAdmin(); await refresh(); toast(n + " est à jour ✓"); } catch(e){ toast(e.error || "Erreur"); }
    });
  }
  $("paySave").onclick = async () => {
    try {
      await api("admin_pay_settings", { price: { cinecheque: $("pCC").value, pathe: $("pPA").value }, full: { cinecheque: $("fCCp").value, pathe: $("fPAp").value }, phone: $("pPhone").value });
      $("payOk").textContent = "Enregistré ✓"; $("payOk").style.color = "";
      $("pCC").blur(); await loadAdmin(); await refresh();
    } catch(e){ $("payOk").textContent = e.error || "Erreur"; }
  };

  let logFilter = null;
  function renderLog(){
    const taken = admCodes.filter(c => c.taken).sort((a,b) => (b.takenAt||0) - (a.takenAt||0));
    const per = {};
    taken.forEach(c => { const p = c.takenBy || "?"; per[p] = per[p] || {cinecheque:0, pathe:0}; per[p][c.type]++; });
    const names = [...new Set([...profilesList, ...Object.keys(per)])];
    $("sum").innerHTML = `<button class="chip ${logFilter===null?"on":""}" data-p="">Tous <b>${taken.length}</b></button>` +
      names.map(n => { const v = per[n] || {cinecheque:0,pathe:0}; const i = profilesList.indexOf(n);
        const col = COLORS[(i<0?0:i)%COLORS.length][0];
        return `<button class="chip ${logFilter===n?"on":""}" data-p="${esc(n)}"><span class="dot" style="background:${col}"></span>${esc(n)} <b>${v.cinecheque + v.pathe}</b><span style="color:var(--dim)">(${v.cinecheque} CC · ${v.pathe} P)</span></button>`; }).join("");
    $("sum").querySelectorAll(".chip").forEach(b => b.onclick = () => { logFilter = b.dataset.p || null; renderLog(); });
    const rows = taken.filter(c => logFilter === null || c.takenBy === logFilter);
    $("hlog").innerHTML = rows.length ? rows.map(c => { const T = TYPES[c.type] || {label:c.type,color:"var(--muted)"};
      return `<div class="lrow"><span class="who2">${esc(c.takenBy || "?")}</span><span class="ty" style="color:${T.color}">${esc(T.label)} · ${eur(c.price)}</span><span class="d">${fmt(c.takenAt)}</span><span class="k">${c.file?"📄 ":""}${esc(c.code)}</span>${c.offered ? `<span class="badge gift" style="grid-column:3;grid-row:2;justify-self:end">Offerte 🎁</span>` : `<button class="badge ${c.paid?"ok":"due"}" data-tp="${esc(c.id)}" title="Cliquer pour changer" style="grid-column:3;grid-row:2;justify-self:end">${c.paid?"Réglé":"À régler"}</button>`}<div class="lact"><button data-lr="${esc(c.id)}">↺ Remettre en stock</button><button data-ld="${esc(c.id)}" class="del">✕ Supprimer</button></div></div>`; }).join("")
      : `<div class="empty">Aucune place prise pour l'instant.</div>`;
    const confirmBtn = (b, label, run) => {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; const old = b.textContent; b.textContent = label; b.classList.add("sure");
        setTimeout(() => { if (b.isConnected) { b.dataset.sure = ""; b.textContent = old; b.classList.remove("sure"); } }, 3000); return; }
      run();
    };
    $("hlog").querySelectorAll("[data-lr]").forEach(b => b.onclick = () => confirmBtn(b, "Confirmer ↺", async () => {
      try { await api("admin_restore", { id: b.dataset.lr }); toast("Place remise en stock"); await loadAdmin(); await refresh(); } catch(e){ toast(e.error || "Erreur"); }
    }));
    $("hlog").querySelectorAll("[data-ld]").forEach(b => b.onclick = () => confirmBtn(b, "Confirmer la suppression", async () => {
      try { await api("admin_delete", { id: b.dataset.ld }); toast("Supprimé de l'historique"); await loadAdmin(); await refresh(); } catch(e){ toast(e.error || "Erreur"); }
    }));
    $("hlog").querySelectorAll("[data-tp]").forEach(b => b.onclick = async () => {
      try { await api("admin_toggle_paid", { id: b.dataset.tp }); await loadAdmin(); await refresh(); } catch(e){ toast(e.error || "Erreur"); }
    });
  }
  $("adminBtn").onclick = async () => {
    ["addOk","profOk","admErr"].forEach(k=>$(k).textContent="");
    admView();
    $("admOv").classList.add("on");
    if (isAdmin) { try { await loadAdmin(); } catch(e){ isAdmin = false; admView(); } }
    else setTimeout(()=>$("admPw").focus(), 50);
  };
  $("admClose").onclick = () => $("admOv").classList.remove("on");
  $("admOv").onclick = e => { if (e.target === $("admOv")) $("admOv").classList.remove("on"); };

  $("admForm").addEventListener("submit", async e => {
    e.preventDefault();
    try { await api("admin_login", { password: $("admPw").value }); $("admPw").value = ""; isAdmin = true; admView(); await loadAdmin(); }
    catch(err){ $("admErr").textContent = err.error || "Erreur"; }
  });

  async function uploadPdfs(files){
    files = [...files].filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!files.length) { $("addOk").style.color = "var(--red)"; $("addOk").textContent = "Ce ne sont pas des fichiers PDF."; return; }
    let ok = 0, dup = 0, err = [];
    for (let i = 0; i < files.length; i++) {
      $("addOk").style.color = ""; $("addOk").textContent = `Envoi ${i+1}/${files.length}… ${files[i].name}`;
      const fd = new FormData(); fd.append("type", addType); fd.append("expires", $("addExp").value || ""); fd.append("file", files[i]);
      try {
        const r = await fetch("api.php?a=admin_upload", { method: "POST", body: fd, credentials: "same-origin" });
        let d = {}; try { d = await r.json(); } catch(e){ d = { error: "réponse invalide (fichier trop gros ?)" }; }
        if (!r.ok) err.push(files[i].name + " : " + (d.error || "erreur")); else if (d.dup) dup++; else ok++;
      } catch(e){ err.push(files[i].name + " : connexion"); }
    }
    $("addOk").textContent = `${ok} place(s) ajoutée(s) ✓` + (dup ? ` · ${dup} déjà présente(s)` : "") + (err.length ? ` · Erreurs : ${err.join(" ; ")}` : "");
    if (err.length) $("addOk").style.color = "var(--red)";
    $("pdfIn").value = "";
    await loadAdmin(); await refresh();
  }
  $("pdfIn").addEventListener("change", () => {
    const fl = $("pdfIn").files;
    $("addOk").style.color = ""; $("addOk").textContent = fl && fl.length ? `${fl.length} fichier(s) choisi(s)…` : "Aucun fichier choisi.";
    if (fl && fl.length) uploadPdfs(fl).catch(e => { $("addOk").style.color = "var(--red)"; $("addOk").textContent = "Erreur : " + (e && e.message || e); });
  });
  ["dragenter","dragover"].forEach(ev => $("drop").addEventListener(ev, e => { e.preventDefault(); $("drop").classList.add("over"); }));
  ["dragleave","drop"].forEach(ev => $("drop").addEventListener(ev, e => { e.preventDefault(); $("drop").classList.remove("over"); }));
  $("drop").addEventListener("drop", e => uploadPdfs(e.dataTransfer.files));

  $("addBtn").onclick = async () => {
    const lines = $("addCodes").value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if (!lines.length) { $("addOk").textContent = "Collez au moins un code."; return; }
    $("addBtn").disabled = true;
    try {
      const r = await api("admin_add", { type: addType, codes: lines, expires: $("addExp").value || "" });
      $("addCodes").value = "";
      $("addOk").textContent = r.added ? `${r.added} code(s) ajouté(s) ✓` : "Ces codes existent déjà.";
      await loadAdmin(); await refresh();
    } catch(e){ $("addOk").textContent = e.error || "Erreur"; }
    $("addBtn").disabled = false;
  };

  $("profSave").onclick = async () => {
    const names = [...$("profEdit").querySelectorAll("input")].map(x=>x.value.trim());
    try {
      await api("admin_profiles", { profiles: names });
      $("profOk").textContent = "Profils enregistrés ✓";
      await loadAdmin(); await refresh();
      if (!state.profile) { $("admOv").classList.remove("on"); goProfiles(); }
    } catch(e){ $("profOk").textContent = e.error || "Erreur"; }
  };

  function renderStock(){
    const st = c => c.taken ? 2 : (c.expires && daysLeft(c.expires, admToday) < 0 ? 1 : 0);
    const list = admCodes.filter(c=>c.type===stockType).sort((a,b)=> st(a)-st(b) || ((a.expires||"9999")<(b.expires||"9999")?-1:(a.expires||"9999")>(b.expires||"9999")?1:0) || (a.addedAt||0)-(b.addedAt||0));
    $("stock").innerHTML = list.length ? list.map(c=>{
      const s2 = st(c);
      const dot = s2===2 ? "var(--dim)" : s2===1 ? "var(--red)" : "#3dd68c";
      const right = s2===2 ? `<span class="s">${esc(c.takenBy||"pris")}</span><button class="x" data-r="${esc(c.id)}" title="Remettre en stock">↺</button>`
        : `<input type="date" data-exp="${esc(c.id)}" value="${esc(c.expires||"")}" title="Valable jusqu'au (facultatif)">`;
      return `<div class="srow"><span class="dot" style="background:${dot}"></span><span class="k" style="${s2===2?"color:var(--dim);text-decoration:line-through":s2===1?"color:var(--red)":""}">${c.file?"📄 ":""}${esc(c.code)}</span>${s2===1?`<span class="exp gone">expirée</span>`:""}${c.file?`<a class="x" href="${pdfUrl(c.id,false)}" target="_blank" rel="noopener" title="Voir le PDF">👁</a>`:""}${right}<button class="x" data-d="${esc(c.id)}" title="Supprimer">✕</button></div>`;
    }).join("") : `<div class="empty">Aucune place.</div>`;
    $("stock").querySelectorAll("[data-d]").forEach(b => b.onclick = async () => { try{ await api("admin_delete",{id:b.dataset.d}); await loadAdmin(); await refresh(); }catch(e){ toast(e.error||"Erreur"); } });
    $("stock").querySelectorAll("[data-r]").forEach(b => b.onclick = async () => { try{ await api("admin_restore",{id:b.dataset.r}); await loadAdmin(); await refresh(); }catch(e){ toast(e.error||"Erreur"); } });
    $("stock").querySelectorAll("[data-exp]").forEach(inp => inp.onchange = async () => { try{ await api("admin_set_expiry",{id:inp.dataset.exp, expires:inp.value}); toast(inp.value ? "Date enregistrée ✓" : "Date retirée"); await loadAdmin(); await refresh(); }catch(e){ toast(e.error||"Erreur"); } });
  }

  // Met les nuages en pause pendant qu'une pop-up est ouverte (économise la batterie et fluidifie)
  const syncModal = () => document.body.classList.toggle("modal-open", !!document.querySelector(".overlay.on"));
  const mo = new MutationObserver(syncModal);
  document.querySelectorAll(".overlay").forEach(o => mo.observe(o, { attributes: true, attributeFilter: ["class"] }));

  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeConfirm(); $("infoOv").classList.remove("on"); $("filmOv").classList.remove("on"); $("codeOv").classList.remove("on"); $("admOv").classList.remove("on"); } });

  /* ---------- Démarrage : reprendre la session si elle existe ---------- */
  (async () => {
    try {
      const s = await api("session");
      if (!s.ok) return goLock();
      isAdmin = s.admin;
      const p = await api("profiles"); profilesList = p.profiles;
      if (s.profile) goApp(); else goProfiles();
    } catch(e){ goLock(); }
  })();
})();
