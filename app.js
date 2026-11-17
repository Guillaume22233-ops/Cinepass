(() => {
  const COLORS = [["#d9b45a","#2a2414"],["#f29a2e","#2b1d0e"],["#e5484d","#2b1213"],["#8e8cf0","#1b1a2e"],["#3dd68c","#0f2a1d"]];
  const TYPES = { cinecheque:{label:"CinéChèque", color:"var(--gold)"}, pathe:{label:"Pathé", color:"var(--amber)"} };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

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
  let films = null, curFilm = null;
  const HUES = [32, 0, 210, 265, 150, 45, 190, 330];
  const fdate = d => d ? new Date(d).toLocaleDateString("fr-FR",{day:"numeric",month:"long"}) : "";
  function posterHtml(f, i, rank){
    const style = f.poster ? `background-image:url('${esc(f.poster)}')` :
      `background:linear-gradient(160deg,hsl(${HUES[i%HUES.length]} 45% 26%),#0c0c0e 85%)`;
    return `<div class="poster" style="${style}">${f.poster ? "" : `<div class="ph">${esc(f.title)}</div>`}${rank ? `<div class="rank">${rank}</div>` : ""}</div>`;
  }
  async function loadFilms(){
    if (films) return;
    try { films = (await api("films")).films || []; } catch(e){ films = []; }
    if (!films.length) return;
    $("strip").innerHTML = films.map((f,i) =>
      `<button class="film" data-i="${i}">${posterHtml(f,i,i+1)}<div class="ftitle">${esc(f.title)}</div><div class="fdate">${f.date ? "Sorti le " + fdate(f.date) : ""}</div></button>`).join("");
    $("strip").querySelectorAll(".film").forEach(b => b.onclick = () => openFilm(+b.dataset.i));
    $("films").style.display = "";
  }
  function openFilm(i){
    const f = films[i]; curFilm = f;
    const p = $("fPoster");
    p.outerHTML = posterHtml(f, i).replace('class="poster"', 'class="poster" id="fPoster"');
    $("fTitle").textContent = f.title;
    $("fMeta").textContent = [f.date ? "Sortie : " + fdate(f.date) : "", f.note ? "★ " + f.note.toFixed(1) + "/10" : ""].filter(Boolean).join("  ·  ");
    $("fSyn").textContent = f.overview || "Pas de résumé disponible.";
    const n = state ? state.counts : {cinecheque:0,pathe:0};
    $("fCC").disabled = !n.cinecheque; $("fPA").disabled = !n.pathe;
    $("fCC").style.opacity = n.cinecheque ? 1 : .35; $("fPA").style.opacity = n.pathe ? 1 : .35;
    $("filmOv").classList.add("on");
  }
  $("filmOv").onclick = e => { if (e.target === $("filmOv")) $("filmOv").classList.remove("on"); };
  $("fCC").onclick = () => { $("filmOv").classList.remove("on"); claim("cinecheque"); };
  $("fPA").onclick = () => { $("filmOv").classList.remove("on"); claim("pathe"); };

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
    $("ccBtn").textContent = nCC === 0 ? "Plus de code" : "Prendre un code";
    $("paBtn").textContent = nPA === 0 ? "Plus de code" : "Prendre un code";

    const mine = state.mine;
    $("hist").innerHTML = mine.length ? mine.map((c,k) => {
      const T = TYPES[c.type] || {label:c.type,color:"var(--muted)"};
      return `<button class="hrow" data-k="${k}"><span class="dot" style="background:${T.color}"></span><span class="k">${esc(c.code)}</span><span class="t">${esc(T.label)} · ${fmt(c.takenAt)}</span></button>`;
    }).join("") : `<div class="empty">Aucun code récupéré pour l'instant.</div>`;
    $("hist").querySelectorAll(".hrow").forEach(b => b.onclick = () => openCode(mine[+b.dataset.k]));
  }

  async function claim(type){
    if (busy) return;
    busy = true; render(); $("status").textContent = "Récupération du code…";
    try {
      const r = await api("claim", { type });
      openCode(r.code);
    } catch(e){ toast(e.error || "Erreur, réessayez."); }
    busy = false;
    await refresh();
  }
  $("ccBtn").onclick = () => claim("cinecheque");
  $("paBtn").onclick = () => claim("pathe");

  /* ---------- Pop-up ---------- */
  function openCode(c){
    const T = TYPES[c.type] || {label:c.type,color:"var(--text)"};
    $("mType").textContent = T.label; $("mType").style.color = T.color;
    $("mCode").textContent = c.code;
    $("mMeta").textContent = "Récupéré par " + (c.takenBy || profile) + (c.takenAt ? " · " + fmt(c.takenAt) : "");
    $("mCopy").textContent = "Copier";
    $("codeOv").classList.add("on");
  }
  $("mClose").onclick = () => $("codeOv").classList.remove("on");
  $("codeOv").onclick = e => { if (e.target === $("codeOv")) $("codeOv").classList.remove("on"); };
  $("mCopy").onclick = async () => {
    try { await navigator.clipboard.writeText($("mCode").textContent); $("mCopy").textContent = "Copié ✓"; }
    catch(e){ const r=document.createRange(); r.selectNodeContents($("mCode")); const s=getSelection(); s.removeAllRanges(); s.addRange(r); $("mCopy").textContent = "Sélectionné"; }
  };

  /* ---------- Gestion ---------- */
  let addType = "cinecheque", stockType = "cinecheque";
  function seg(id, cb){ $(id).querySelectorAll("button").forEach(b => b.onclick = () => { $(id).querySelectorAll("button").forEach(x=>x.classList.toggle("on", x===b)); cb(b.dataset.t); }); }
  seg("addType", t => addType = t);
  seg("stockType", t => { stockType = t; renderStock(); });

  function admView(){
    $("admLogin").style.display = isAdmin ? "none" : "";
    $("admBody").style.display = isAdmin ? "" : "none";
  }
  async function loadAdmin(){
    const r = await api("admin_state");
    admCodes = r.codes; profilesList = r.profiles;
    $("profEdit").innerHTML = profilesList.map((n,i)=>`<input class="tin" data-i="${i}" value="${esc(n)}" maxlength="24">`).join("");
    renderStock();
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

  $("addBtn").onclick = async () => {
    const lines = $("addCodes").value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if (!lines.length) { $("addOk").textContent = "Collez au moins un code."; return; }
    $("addBtn").disabled = true;
    try {
      const r = await api("admin_add", { type: addType, codes: lines });
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
    const list = admCodes.filter(c=>c.type===stockType).sort((a,b)=> (a.taken===b.taken) ? (a.addedAt||0)-(b.addedAt||0) : (a.taken?1:-1));
    $("stock").innerHTML = list.length ? list.map(c=>`<div class="srow"><span class="dot" style="background:${c.taken?"var(--dim)":"#3dd68c"}"></span><span class="k" style="${c.taken?"color:var(--dim);text-decoration:line-through":""}">${esc(c.code)}</span><span class="s">${c.taken?esc(c.takenBy||"pris"):"dispo"}</span>${c.taken?`<button class="x" data-r="${esc(c.id)}" title="Remettre en stock">↺</button>`:""}<button class="x" data-d="${esc(c.id)}" title="Supprimer">✕</button></div>`).join("")
      : `<div class="empty">Aucun code.</div>`;
    $("stock").querySelectorAll("[data-d]").forEach(b => b.onclick = async () => { try{ await api("admin_delete",{id:b.dataset.d}); await loadAdmin(); await refresh(); }catch(e){ toast(e.error||"Erreur"); } });
    $("stock").querySelectorAll("[data-r]").forEach(b => b.onclick = async () => { try{ await api("admin_restore",{id:b.dataset.r}); await loadAdmin(); await refresh(); }catch(e){ toast(e.error||"Erreur"); } });
  }

  document.addEventListener("keydown", e => { if (e.key === "Escape") { $("filmOv").classList.remove("on"); $("codeOv").classList.remove("on"); $("admOv").classList.remove("on"); } });

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
