/* AHLTV Ryota Tournaments. The Firebase configuration is a public web-client
   configuration; access to data must be enforced by Firestore security rules. */
(() => {
  "use strict";

  const ADMIN_EMAIL = "musik5456@gmail.com";
  const FIREBASE = {apiKey:"AIzaSyDjBDGogjRoiGPeMi4oSyOX8BbS0Y5Bfy0",authDomain:"ahltv-ryota-tournaments.firebaseapp.com",projectId:"ahltv-ryota-tournaments",storageBucket:"ahltv-ryota-tournaments.firebasestorage.app",messagingSenderId:"552716895009",appId:"1:552716895009:web:0fc731969008108b61b460"};
  const CAPACITY = 16;
  const PAGES = ["home", "tour", "format", "bracket", "rules", "apply", "account", "top", "admin", "contact"];
  const STATUS = {new: "На проверке", ok: "Принята", no: "Отклонена"};
  const $ = id => document.getElementById(id);
  const state = {
    db: null, me: null, admins: [], profile: {}, start: null, authReady: false,
    adminsLoading: false, pendingAdmin: false, route: "home", mode: "solo", bracketMode: "solo",
    accountMode: "in", adminMode: "solo", adminRows: [], mailPool: [],
    slots: {solo: [], duo: []}, scores: {}, bracketVersion: 0
  };
  let drag = null;

  const normalizeEmail = value => String(value || "").trim().toLowerCase();
  const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[ch]);
  const modeName = mode => mode === "duo" ? "2×2" : "1×1";
  const statusName = status => STATUS[status] || STATUS.new;
  const validStatus = status => Object.prototype.hasOwnProperty.call(STATUS, status) ? status : "new";
  const modeOf = item => item.mode === "duo" ? "duo" : "solo";
  const value = id => $(id).value.trim();
  const currentUid = () => state.me && state.me.uid;
  const isOwner = () => !!state.me && (ADMIN_EMAIL ? normalizeEmail(state.me.email) === normalizeEmail(ADMIN_EMAIL) : !!(state.db && state.db.local && state.me.uid === "u1"));
  const isAdmin = () => isOwner() || !!(state.me && state.admins.includes(normalizeEmail(state.me.email)));
  const validSteam = input => {
    try {
      const url = new URL(input);
      return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.toLowerCase() === "steamcommunity.com" && /^\/(id|profiles)\/[^/]+\/?$/i.test(url.pathname) && !url.username && !url.password;
    } catch (_) { return false; }
  };
  const safeSteamLink = input => validSteam(input) ? `<a href="${escapeHtml(input)}" target="_blank" rel="noopener noreferrer">Профиль ↗</a>` : escapeHtml(input || "—");
  const scoreKeysBelow = (round, index) => {
    const keys = [];
    for (let r = round + 1; r < 4; r++) keys.push(`${r}-${Math.floor(index / 2 ** (r - round))}`);
    return keys;
  };
  const publicSlot = a => ({uid: a.uid, mode: a.mode, nick: a.nick, partner: a.partner || "", status: a.status || "new", t: a.t});
  const readLocal = (key, fallback) => {
    try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
    catch (_) { return fallback; }
  };
  const writeLocal = (key, data) => { localStorage.setItem(key, JSON.stringify(data)); };
  const localHash = async text => {
    // Kept compatible with accounts created by the previous local demo.
    if (!window.crypto || !crypto.subtle) return String(text.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join("");
  };

  function errorText(error) {
    const messages = {
      "auth/email-already-in-use": "Эта почта уже зарегистрирована. Войди в существующий аккаунт.",
      "auth/invalid-credential": "Неверная почта или пароль.",
      "auth/wrong-password": "Неверная почта или пароль.",
      "auth/user-not-found": "Неверная почта или пароль.",
      "auth/weak-password": "Пароль слишком короткий: минимум 6 символов.",
      "auth/invalid-email": "Проверь адрес электронной почты.",
      "auth/operation-not-allowed": "В Firebase не включён вход по почте и паролю.",
      "auth/unauthorized-domain": "Домен сайта не добавлен в Authorized domains в Firebase.",
      "auth/network-request-failed": "Нет связи с Firebase. Проверь интернет и попробуй ещё раз.",
      "auth/too-many-requests": "Слишком много попыток. Попробуй позже.",
      "permission-denied": "Firebase отклонил доступ. Организатору нужно проверить правила Firestore.",
      "unavailable": "Нет связи с базой. Проверь интернет и попробуй ещё раз."
    };
    if (typeof error === "string") return error;
    return messages[error && error.code] || "Не удалось выполнить действие. Проверь подключение и попробуй ещё раз.";
  }

  function setMessage(id, message, bad = false) {
    const node = $(id);
    node.textContent = message || "";
    node.classList.toggle("message-error", !!bad);
  }
  function setError(id, message) {
    const node = $(id);
    node.textContent = message || "";
    node.hidden = !message;
  }
  async function busy(button, label, task) {
    if (button.disabled) return;
    const old = button.innerHTML;
    button.disabled = true;
    button.textContent = label;
    try { return await task(); }
    finally { button.disabled = false; button.innerHTML = old; }
  }
  function selectButtons(container, attribute, selected) {
    container.querySelectorAll(`button[${attribute}]`).forEach(button => {
      const on = button.getAttribute(attribute) === String(selected);
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    });
  }

  function navigate(id, options = {}) {
    id = PAGES.includes(id) ? id : "home";
    if (id === "admin" && !isAdmin()) {
      state.pendingAdmin = !state.authReady || (!!state.me && state.adminsLoading);
      id = "account";
    } else if (id !== "admin") state.pendingAdmin = false;
    state.route = id;
    document.querySelectorAll("main > section").forEach(section => section.classList.toggle("on", section.id === id));
    document.querySelectorAll("nav button[data-go]").forEach(button => {
      const active = button.dataset.go === id && !button.classList.contains("cta") && !button.classList.contains("ghost");
      button.classList.toggle("on", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    if (options.history !== false && location.hash !== `#${id}`) history.pushState(null, "", `#${id}`);
    closeNav();
    if (id === "bracket") loadBracket();
    if (id === "top") loadTop();
    if (id === "admin") loadAdmin();
    if (options.scroll !== false) window.scrollTo({top: 0, behavior: "auto"});
    if (options.focus) {
      const heading = $(`${id}-title`);
      if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({preventScroll: true}); }
    }
  }
  function finishPendingAdmin() {
    if (!state.pendingAdmin || !state.authReady || state.adminsLoading) return;
    state.pendingAdmin = false;
    if (isAdmin()) navigate("admin", {history: false});
    else if (location.hash === "#admin") history.replaceState(null, "", "#account");
  }
  document.querySelector(".skip-link").addEventListener("click", event => { event.preventDefault(); $("content").focus(); });
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-go]");
    if (!button) return;
    if (button.dataset.goMode) setFormatMode(button.dataset.goMode);
    navigate(button.dataset.go, {focus: true});
  });
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1), {history: false}));

  const header = document.querySelector(".site-header");
  const navToggle = $("nav-toggle");
  const nav = $("main-nav");
  const mobileNav = window.matchMedia("(max-width: 1100px)");
  function closeNav() {
    header.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Открыть меню");
    nav.inert = mobileNav.matches;
  }
  function syncNav() { if (!mobileNav.matches) { closeNav(); nav.inert = false; } else if (!header.classList.contains("open")) nav.inert = true; }
  navToggle.addEventListener("click", () => {
    const open = !header.classList.contains("open");
    header.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
    nav.inert = !open;
  });
  document.addEventListener("click", event => { if (header.classList.contains("open") && !header.contains(event.target)) closeNav(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && header.classList.contains("open")) { closeNav(); navToggle.focus(); } });
  if (mobileNav.addEventListener) mobileNav.addEventListener("change", syncNav); else mobileNav.addListener(syncNav);
  syncNav();

  function setFormatMode(mode) {
    mode = mode === "duo" ? "duo" : "solo";
    selectButtons($("format-mode"), "data-mode", mode);
    $("m-solo").hidden = mode !== "solo";
    $("m-duo").hidden = mode !== "duo";
  }
  document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => setFormatMode(button.dataset.mode)));
  document.querySelectorAll(".seg.sz button").forEach(button => button.addEventListener("click", () => {
    const mode = button.closest(".mode");
    drawBracket(Number(button.dataset.n), mode.querySelector(".br"));
    selectButtons(button.parentElement, "data-n", button.dataset.n);
  }));
  document.querySelectorAll("#f-mode button").forEach(button => button.addEventListener("click", () => {
    state.mode = button.dataset.m;
    selectButtons($("f-mode"), "data-m", state.mode);
    $("pf").hidden = state.mode !== "duo";
    setError("f-err", "");
  }));
  document.querySelectorAll("#a-mode button").forEach(button => button.addEventListener("click", () => {
    state.accountMode = button.dataset.a;
    selectButtons($("a-mode"), "data-a", state.accountMode);
    $("a-go").textContent = state.accountMode === "up" ? "Создать аккаунт ↗" : "Войти ↗";
    $("a-pass").autocomplete = state.accountMode === "up" ? "new-password" : "current-password";
    $("a-reset").hidden = state.accountMode === "up";
    setError("a-err", ""); setMessage("a-note", "");
  }));
  document.querySelectorAll("#ap-mode button").forEach(button => button.addEventListener("click", () => {
    state.adminMode = button.dataset.pm;
    selectButtons($("ap-mode"), "data-pm", state.adminMode);
    $("ap-pf").hidden = state.adminMode !== "duo";
    setMessage("ap-msg", "");
  }));
  document.querySelectorAll("#br-tabs button").forEach(button => button.addEventListener("click", () => {
    state.bracketMode = button.dataset.brMode;
    selectButtons($("br-tabs"), "data-br-mode", state.bracketMode);
    $("live-solo").hidden = state.bracketMode !== "solo";
    $("live-duo").hidden = state.bracketMode !== "duo";
    updateBracketControls();
  }));

  function showConnection(kind) {
    const banner = $("connection-banner"), link = $("demo-link");
    banner.hidden = false; link.hidden = false;
    const url = new URL(location.href);
    if (kind === "demo") {
      $("connection-title").textContent = "Демо-режим.";
      $("connection-text").textContent = "Данные хранятся только в этом браузере и не попадут на настоящий турнир. Не используй реальный пароль.";
      url.searchParams.delete("demo"); link.textContent = "Выйти из демо ↗";
    } else {
      $("connection-title").textContent = "Нет подключения к Firebase.";
      $("connection-text").textContent = "Настоящие заявки и аккаунты временно недоступны. Проверь интернет или попробуй позже.";
      url.searchParams.set("demo", "1"); link.textContent = "Посмотреть демо ↗";
    }
    link.href = url.toString();
  }

  function localDB() {
    function clearScore(mode) { const results = readLocal("ah_results", {}); results[mode] = {}; writeLocal("ah_results", results); }
    return {
      local: true,
      currentUser: () => readLocal("ah_me", null),
      async signup(email, password) {
        const users = readLocal("ah_users", {});
        if (users[email]) throw "Эта почта уже зарегистрирована.";
        const h = await localHash(email + password);
        const id = `u${Object.keys(users).length + 1}`;
        users[email] = {id, h}; writeLocal("ah_users", users);
        const user = {uid: id, email}; writeLocal("ah_me", user); setMe(user);
      },
      async login(email, password) {
        const users = readLocal("ah_users", {}), h = await localHash(email + password);
        if (!users[email] || users[email].h !== h) throw "Неверная почта или пароль.";
        const user = {uid: users[email].id, email}; writeLocal("ah_me", user); setMe(user);
      },
      async logout() { writeLocal("ah_me", null); setMe(null); },
      async reset() { throw "В демо-режиме восстановление пароля недоступно."; },
      async verified() { return null; },
      async add(a, reset) {
        const list = readLocal("ah_apps", []);
        if (list.some(x => x.id === a.id || (a.uid !== "admin" && x.uid === a.uid && modeOf(x) === a.mode))) throw "Вы уже зарегистрированы в этом режиме.";
        list.push(a); writeLocal("ah_apps", list); if (reset) clearScore(a.mode);
      },
      async slots() { return readLocal("ah_apps", []); },
      async list(all) { const list = readLocal("ah_apps", []); return all ? list : list.filter(a => a.uid === currentUid()); },
      async results() { return readLocal("ah_results", {}); },
      async setScore(mode, key, score, positions = []) {
        if (positions.length) {
          const list = readLocal("ah_apps", []);
          positions.forEach(({id, pos}) => { const item = list.find(x => x.id === id); if (item) item.pos = pos; });
          writeLocal("ah_apps", list);
        }
        const results = readLocal("ah_results", {}); results[mode] = results[mode] || {};
        if (score) results[mode][key] = score; else delete results[mode][key];
        const [round, index] = key.split("-").map(Number);
        scoreKeysBelow(round, index).forEach(k => delete results[mode][k]);
        writeLocal("ah_results", results);
      },
      async setStatus(a, status, reset) {
        const list = readLocal("ah_apps", []), item = list.find(x => x.id === a.id);
        if (!item) throw "Заявка больше не существует.";
        item.status = status; writeLocal("ah_apps", list); if (reset) clearScore(modeOf(a));
      },
      async del(a, reset) { writeLocal("ah_apps", readLocal("ah_apps", []).filter(x => x.id !== a.id)); if (reset) clearScore(modeOf(a)); },
      async move(a, mode, partner, reset) {
        const list = readLocal("ah_apps", []), item = list.find(x => x.id === a.id);
        if (!item) throw "Заявка больше не существует.";
        item.mode = mode; item.partner = partner; delete item.pos; writeLocal("ah_apps", list);
        if (reset) { clearScore(modeOf(a)); clearScore(mode); }
      },
      async placeMany(mode, entries, reset = true) {
        const list = readLocal("ah_apps", []);
        entries.forEach(({id, pos}) => { const item = list.find(x => x.id === id); if (item) item.pos = pos; });
        writeLocal("ah_apps", list); if (reset) clearScore(mode);
      },
      async getProfile(uid) { return readLocal(`ah_prof_${uid}`, null); },
      async setProfile(uid, profile) {
        writeLocal(`ah_prof_${uid}`, profile);
        const list = readLocal("ah_apps", []); list.forEach(a => { if (a.uid === uid) a.nick = profile.nick; }); writeLocal("ah_apps", list);
        return true;
      },
      async getStats(uid) { return readLocal("ah_stats", {})[uid] || null; },
      async topStats() { const stats = readLocal("ah_stats", {}); return Object.keys(stats).map(id => ({...stats[id], id})); },
      async addStat(uid, kills, deaths, nick) {
        const stats = readLocal("ah_stats", {}), item = stats[uid] || {matches: 0, kills: 0, deaths: 0};
        item.nick = nick || item.nick || ""; item.matches++; item.kills += kills; item.deaths += deaths;
        stats[uid] = item; writeLocal("ah_stats", stats);
      },
      async resetStat(uid) { const stats = readLocal("ah_stats", {}); stats[uid] = {nick: (stats[uid] || {}).nick || "", matches: 0, kills: 0, deaths: 0}; writeLocal("ah_stats", stats); },
      async getStart() { return readLocal("ah_start", null); },
      async setStart(start) { writeLocal("ah_start", start); },
      async getAdmins() { const list = readLocal("ah_admins", []); return Array.isArray(list) ? list : []; },
      async setAdmins(list) { writeLocal("ah_admins", list); }
    };
  }

  async function firebaseDB(isActive) {
    const base = "https://www.gstatic.com/firebasejs/10.14.1/";
    const A = await import(base + "firebase-app.js");
    const U = await import(base + "firebase-auth.js");
    const F = await import(base + "firebase-firestore.js");
    const app = A.initializeApp(FIREBASE), auth = U.getAuth(app), fs = F.getFirestore(app);
    const apps = F.collection(fs, "apps"), config = F.doc(fs, "cfg", "main"), adminDoc = F.doc(fs, "cfg", "admins");
    let adminSource = "unknown";
    auth.languageCode = "ru";
    const userData = u => u ? {uid: u.uid, email: normalizeEmail(u.email)} : null;
    U.onAuthStateChanged(auth, user => { if (isActive()) setMe(userData(user)); }, () => { if (isActive()) setMe(null); });
    const clearResults = (batch, mode) => batch.set(F.doc(fs, "results", mode), {s: {}}, {merge: true});
    const application = id => F.doc(fs, "apps", id);
    const slot = id => F.doc(fs, "slots", id);
    return {
      local: false,
      async signup(email, password) {
        const credential = await U.createUserWithEmailAndPassword(auth, email, password);
        setMe(userData(credential.user));
        try { await U.sendEmailVerification(credential.user); } catch (_) { /* The account still exists; resend is available. */ }
      },
      async login(email, password) { const credential = await U.signInWithEmailAndPassword(auth, email, password); setMe(userData(credential.user)); },
      async logout() { await U.signOut(auth); setMe(null); },
      reset: email => U.sendPasswordResetEmail(auth, email),
      async verified() { if (!auth.currentUser) return null; await auth.currentUser.reload(); return auth.currentUser.emailVerified; },
      resend: () => U.sendEmailVerification(auth.currentUser),
      async add(a, reset) {
        const batch = F.writeBatch(fs);
        const {id, ...data} = a;
        batch.set(application(id), data); batch.set(slot(id), publicSlot(a));
        if (reset) clearResults(batch, a.mode);
        await batch.commit();
      },
      async slots() { const snap = await F.getDocs(F.collection(fs, "slots")); return snap.docs.map(doc => ({...doc.data(), id: doc.id})); },
      async list(all) {
        const query = all ? apps : F.query(apps, F.where("uid", "==", currentUid()));
        const snap = await F.getDocs(query); return snap.docs.map(doc => ({...doc.data(), id: doc.id}));
      },
      async results() { const snap = await F.getDocs(F.collection(fs, "results")), result = {}; snap.docs.forEach(doc => { result[doc.id] = doc.data().s || {}; }); return result; },
      async setScore(mode, key, score, positions = []) {
        const patch = {[key]: score || F.deleteField()}, [round, index] = key.split("-").map(Number);
        scoreKeysBelow(round, index).forEach(k => { patch[k] = F.deleteField(); });
        const batch = F.writeBatch(fs);
        batch.set(F.doc(fs, "results", mode), {s: patch}, {merge: true});
        positions.forEach(({id, pos}) => batch.update(slot(id), {pos}));
        await batch.commit();
      },
      async setStatus(a, status, reset) {
        const batch = F.writeBatch(fs);
        batch.update(application(a.id), {status});
        batch.set(slot(a.id), {...publicSlot(a), status}, {merge: true});
        if (reset) clearResults(batch, modeOf(a));
        await batch.commit();
      },
      async del(a, reset) {
        const batch = F.writeBatch(fs); batch.delete(application(a.id)); batch.delete(slot(a.id));
        if (reset) clearResults(batch, modeOf(a));
        await batch.commit();
      },
      async move(a, mode, partner, reset) {
        const batch = F.writeBatch(fs);
        batch.update(application(a.id), {mode, partner});
        batch.set(slot(a.id), {...publicSlot(a), mode, partner, pos: F.deleteField()}, {merge: true});
        if (reset) { clearResults(batch, modeOf(a)); clearResults(batch, mode); }
        await batch.commit();
      },
      async placeMany(mode, entries, reset = true) {
        const batch = F.writeBatch(fs);
        entries.forEach(({id, pos}) => batch.update(slot(id), {pos}));
        if (reset) clearResults(batch, mode);
        await batch.commit();
      },
      async getProfile(uid) { const doc = await F.getDoc(F.doc(fs, "profiles", uid)); return doc.exists() ? doc.data() : null; },
      async setProfile(uid, profile) {
        await F.setDoc(F.doc(fs, "profiles", uid), profile);
        // Older applications can have nonstandard IDs after a mode change.
        try {
          const snap = await F.getDocs(F.query(apps, F.where("uid", "==", uid)));
          if (!snap.empty) {
            const batch = F.writeBatch(fs);
            snap.docs.forEach(doc => { batch.update(doc.ref, {nick: profile.nick}); batch.update(slot(doc.id), {nick: profile.nick}); });
            await batch.commit();
          }
          return true;
        } catch (_) { return false; }
      },
      async getStats(uid) { const doc = await F.getDoc(F.doc(fs, "stats", uid)); return doc.exists() ? doc.data() : null; },
      async topStats() { const snap = await F.getDocs(F.collection(fs, "stats")); return snap.docs.map(doc => ({...doc.data(), id: doc.id})); },
      addStat: (uid, kills, deaths, nick) => F.setDoc(F.doc(fs, "stats", uid), {nick: nick || "", matches: F.increment(1), kills: F.increment(kills), deaths: F.increment(deaths)}, {merge: true}),
      resetStat: uid => F.setDoc(F.doc(fs, "stats", uid), {matches: 0, kills: 0, deaths: 0}, {merge: true}),
      async getStart() { const doc = await F.getDoc(config); return doc.exists() ? doc.data().start : null; },
      setStart: start => F.setDoc(config, {start: start || null}, {merge: true}),
      async getAdmins() {
        const [legacy, main] = await Promise.allSettled([F.getDoc(adminDoc), F.getDoc(config)]);
        const mainValue = main.status === "fulfilled" && main.value.exists() ? main.value.data().admins : undefined;
        const legacyValue = legacy.status === "fulfilled" && legacy.value.exists() ? legacy.value.data().emails : undefined;
        // An intentionally empty list in cfg/main must not resurrect stale legacy admins.
        if (Array.isArray(mainValue)) { adminSource = "main"; return mainValue; }
        if (Array.isArray(legacyValue)) { adminSource = "legacy"; return legacyValue; }
        if (legacy.status === "rejected" && main.status === "rejected") throw main.reason;
        adminSource = "none"; return [];
      },
      async setAdmins(list) {
        const saveMain = () => F.setDoc(config, {admins: list}, {merge: true});
        const saveLegacy = () => F.setDoc(adminDoc, {emails: list});
        if (adminSource === "main") {
          // Never report success by updating an ignored fallback when main is authoritative.
          await saveMain();
          try { await saveLegacy(); } catch (_) { /* cfg/main is authoritative */ }
        } else {
          try {
            await saveLegacy(); adminSource = "legacy";
            try { await saveMain(); adminSource = "main"; } catch (_) { /* legacy remains authoritative */ }
          } catch (error) {
            if (error && error.code === "permission-denied") { await saveMain(); adminSource = "main"; }
            else throw error;
          }
        }
      }
    };
  }

  function setMe(user) {
    const old = state.me, oldUid = old && old.uid, newUid = user && user.uid;
    const changed = oldUid !== newUid || (old && user && old.email !== user.email);
    state.authReady = true;
    if (!changed && old === null && user === null) { finishPendingAdmin(); refresh(); return; }
    if (!changed && state.me && state.db) { refresh(); return; }
    state.me = user;
    state.admins = [];
    state.profile = {};
    state.adminsLoading = !!user;
    if (oldUid && oldUid !== newUid) {
      ["f-nick", "f-partner", "f-mail", "f-faceit", "f-pw", "p-nick", "p-steam"].forEach(id => { $(id).value = ""; });
      $("res").hidden = true;
      $("a-pass").value = "";
      $("p-big").textContent = ""; $("p-rank").textContent = ""; $("p-stats").innerHTML = "";
    }
    refresh();
    if (user && state.db) { loadAdmins(); loadProfile(); }
    else if (!user) { state.adminsLoading = false; finishPendingAdmin(); }
  }

  function refresh() {
    const signedIn = !!state.me, admin = isAdmin(), adminChanged = state.lastAdmin !== admin;
    state.lastAdmin = admin;
    $("a-out").hidden = signedIn; $("a-in").hidden = !signedIn;
    $("nav-admin").hidden = !admin; $("a-adm").hidden = !admin; $("a-reg").hidden = false;
    $("f-pwf").hidden = signedIn; $("f-mail").readOnly = signedIn;
    $("nav-acc").hidden = signedIn;
    $("nav-cta").innerHTML = signedIn ? 'Аккаунт <span aria-hidden="true">↗</span>' : 'Участвовать <span aria-hidden="true">↗</span>';
    $("nav-cta").dataset.go = signedIn ? "account" : "apply";
    $("br-tools").hidden = !admin;
    if (signedIn && state.db) {
      const uid = currentUid();
      $("a-me").textContent = state.me.email;
      $("f-mail").value = state.me.email;
      state.db.list(false).then(list => {
        if (currentUid() !== uid) return;
        $("a-apps").innerHTML = list.length ? list.map(item => `<div class="field application-item"><span><b>${modeName(modeOf(item))}</b> · ${escapeHtml(item.nick)}</span><small>${escapeHtml(statusName(item.status))}</small></div>`).join("") : '<p class="note">Заявок пока нет. Самое время это исправить.</p>';
      }).catch(() => { if (currentUid() === uid) $("a-apps").innerHTML = '<p class="note">Не удалось загрузить заявки.</p>'; });
    }
    if (state.route === "admin" && !admin && !state.adminsLoading) navigate("account");
    if (state.route === "bracket" && state.db && adminChanged) loadBracket();
  }
  async function loadAdmins() {
    if (!state.db || !state.me) return;
    const uid = currentUid(); state.adminsLoading = true;
    try {
      const list = await state.db.getAdmins();
      if (uid !== currentUid()) return;
      state.admins = (Array.isArray(list) ? list : []).map(normalizeEmail).filter((mail, i, arr) => validEmail(mail) && arr.indexOf(mail) === i);
    } catch (_) {
      if (uid !== currentUid()) return;
      if (isOwner()) setMessage("ad-msg", "Не удалось загрузить список админов. Проверь правила и подключение.", true);
    } finally {
      if (uid === currentUid()) {
        state.adminsLoading = false; refresh(); renderAdmins(); finishPendingAdmin();
        if (state.route === "admin" && isAdmin()) loadAdmin();
      }
    }
  }

  function rankStats(list) {
    return list.map(item => {
      const matches = Number(item.matches), kills = Number(item.kills), deaths = Number(item.deaths);
      return {...item, matches, kills, deaths, kd: deaths > 0 ? kills / deaths : kills};
    }).filter(item => Number.isFinite(item.matches) && item.matches > 0 && Number.isFinite(item.kills) && item.kills >= 0 && Number.isFinite(item.deaths) && item.deaths >= 0)
      .sort((a, b) => b.kd - a.kd || b.kills - a.kills || String(a.nick || "").localeCompare(String(b.nick || "")));
  }
  const rounded = number => Math.round(number * 100) / 100;
  function renderProfileLink() {
    const steam = state.profile.steam || "";
    $("p-link").innerHTML = validSteam(steam) ? safeSteamLink(steam) : "Steam не указан.";
  }
  async function loadProfile() {
    if (!state.db || !state.me) return;
    const uid = currentUid();
    state.db.verified().then(verified => {
      if (uid !== currentUid()) return;
      $("v-note").hidden = verified === null; $("v-send").hidden = verified !== false;
      if (verified !== null) $("v-note").textContent = verified ? "Почта подтверждена ✓" : "Почта не подтверждена. Проверь письмо и папку «Спам».";
    }).catch(() => { if (uid === currentUid()) { $("v-note").hidden = false; $("v-note").textContent = "Не удалось проверить подтверждение почты."; $("v-send").hidden = false; } });
    state.db.getProfile(uid).then(profile => {
      if (uid !== currentUid()) return;
      state.profile = profile || {};
      $("p-nick").value = state.profile.nick || ""; $("p-steam").value = state.profile.steam || "";
      if (!$("f-nick").value && state.profile.nick) $("f-nick").value = state.profile.nick;
      if (!$("f-faceit").value && state.profile.steam) $("f-faceit").value = state.profile.steam;
      $("p-big").textContent = state.profile.nick || state.me.email.split("@")[0];
      renderProfileLink();
    }).catch(() => { if (uid === currentUid()) $("p-big").textContent = state.me.email.split("@")[0]; });
    state.db.getStats(uid).then(stats => {
      if (uid !== currentUid()) return;
      stats = stats || {};
      const matches = Math.max(0, Number(stats.matches) || 0), kills = Math.max(0, Number(stats.kills) || 0), deaths = Math.max(0, Number(stats.deaths) || 0);
      const data = [["Матчи", matches], ["Ср. убийства", matches ? rounded(kills / matches) : "—"], ["Ср. смерти", matches ? rounded(deaths / matches) : "—"], ["K/D", matches ? rounded(deaths ? kills / deaths : kills) : "—"]];
      $("p-stats").innerHTML = data.map(([label, number]) => `<div class="pstat"><b>${escapeHtml(number)}</b><span>${label}</span></div>`).join("");
    }).catch(() => { if (uid === currentUid()) $("p-stats").innerHTML = '<p class="note">Не удалось загрузить статистику.</p>'; });
    state.db.topStats().then(list => {
      if (uid !== currentUid()) return;
      const rank = rankStats(list).findIndex(item => item.id === uid);
      $("p-rank").textContent = rank < 0 ? "Пока без места в рейтинге" : `Место в рейтинге: ${rank + 1}`;
    }).catch(() => { if (uid === currentUid()) $("p-rank").textContent = "Рейтинг временно недоступен"; });
  }

  $("apply-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!state.db) { setError("f-err", "Нет подключения к базе. Попробуй позже."); return; }
    const mode = state.mode, nick = value("f-nick"), partner = value("f-partner"), email = normalizeEmail(state.me ? state.me.email : value("f-mail")), steam = value("f-faceit"), password = $("f-pw").value;
    if (!nick || nick.length > 24 || !validEmail(email) || !steam || (mode === "duo" && (!partner || partner.length > 24))) { setError("f-err", "Заполни все поля и проверь почту."); return; }
    if (mode === "duo" && nick.toLowerCase() === partner.toLowerCase()) { setError("f-err", "Укажи другого игрока в качестве напарника."); return; }
    if (!validSteam(steam)) { setError("f-err", "Укажи ссылку на профиль Steam: https://steamcommunity.com/id/... или /profiles/..."); return; }
    if (!state.me && password.length < 6) { setError("f-err", "Пароль должен содержать не менее 6 символов."); return; }
    setError("f-err", ""); $("res").hidden = true;
    await busy($("send"), "Отправляем…", async () => {
      try {
        if (!state.me) {
          try { await state.db.signup(email, password); }
          catch (error) {
            if ((error && error.code === "auth/email-already-in-use") || error === "Эта почта уже зарегистрирована.") await state.db.login(email, password);
            else throw error;
          }
        }
        const uid = currentUid();
        if (!uid) throw "Не удалось войти в аккаунт. Попробуй ещё раз.";
        const existing = await state.db.list(false);
        if (uid !== currentUid()) throw "Аккаунт изменился. Проверь данные и отправь заявку ещё раз.";
        if (existing.some(item => modeOf(item) === mode)) throw "Вы уже зарегистрированы в этом режиме.";
        // Legacy mode changes may have left the canonical ID occupied by the other mode.
        let id = `${uid}_${mode}`;
        if (existing.some(item => item.id === id)) id += `_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const application = {id, uid, email, mode, nick, partner: mode === "duo" ? partner : "", faceit: steam, status: "new", t: Date.now()};
        await state.db.add(application, false);
        const text = `Заявка на турнир ART AHLTV\nРежим: ${modeName(mode)}\nНик: ${nick}${mode === "duo" ? `\nНапарник: ${partner}` : ""}\nПочта: ${email}\nSteam: ${steam}`;
        $("txt").textContent = text; $("f-pw").value = ""; $("res").hidden = false;
        $("res").focus({preventScroll: true}); $("res").scrollIntoView({behavior: "smooth", block: "nearest"});
        refresh();
        if (!state.profile.nick) state.db.setProfile(uid, {nick, steam}).then(() => { if (uid === currentUid()) loadProfile(); }).catch(() => {});
      } catch (error) { setError("f-err", errorText(error)); }
    });
  });
  $("tg").addEventListener("click", async () => {
    // Open synchronously so mobile popup blockers do not prevent navigation.
    const opened = window.open("https://t.me/iryots", "_blank", "noopener,noreferrer");
    let copied = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText($("txt").textContent); copied = true; } }
    catch (_) { /* The visible text can still be copied manually. */ }
    setMessage("tg-msg", copied ? "Текст заявки скопирован." : "Не удалось скопировать автоматически — выдели текст заявки и скопируй вручную.", !copied);
    if (!opened && !copied) $("tg-msg").textContent += " Если Telegram не открылся, перейди к @iryots вручную.";
  });
  $("a-out").addEventListener("submit", async event => {
    event.preventDefault();
    if (!state.db) { setError("a-err", "Нет подключения к базе. Попробуй позже."); return; }
    const email = normalizeEmail(value("a-mail")), password = $("a-pass").value, mode = state.accountMode;
    if (!validEmail(email) || password.length < 6) { setError("a-err", "Введи почту и пароль не короче 6 символов."); return; }
    setError("a-err", "");
    await busy($("a-go"), mode === "up" ? "Создаём аккаунт…" : "Входим…", async () => {
      try { if (mode === "up") await state.db.signup(email, password); else await state.db.login(email, password); $("a-pass").value = ""; }
      catch (error) { setError("a-err", errorText(error)); }
    });
  });
  $("a-reset").addEventListener("click", async () => {
    const email = normalizeEmail(value("a-mail"));
    if (!state.db) { setError("a-err", "Нет подключения к базе."); return; }
    if (!validEmail(email)) { setError("a-err", "Введи почту, на которую придёт письмо."); return; }
    setError("a-err", "");
    await busy($("a-reset"), "Отправляем…", async () => {
      try { await state.db.reset(email); setMessage("a-note", "Если такая почта зарегистрирована, письмо для смены пароля уже в пути. Проверь также папку «Спам»."); }
      catch (error) { setError("a-err", errorText(error)); }
    });
  });
  $("a-exit").addEventListener("click", async () => {
    if (!state.db) return;
    await busy($("a-exit"), "Выходим…", async () => { try { await state.db.logout(); } catch (error) { setMessage("p-link", errorText(error), true); } });
  });
  $("v-send").addEventListener("click", async () => {
    if (!state.db || !state.db.resend) return;
    await busy($("v-send"), "Отправляем…", async () => {
      try { await state.db.resend(); $("v-note").textContent = "Письмо отправлено. Проверь почту и папку «Спам»."; }
      catch (error) { $("v-note").textContent = errorText(error); }
    });
  });
  $("p-save").addEventListener("click", async () => {
    if (!state.db || !state.me) return;
    const nick = value("p-nick"), steam = value("p-steam"), uid = currentUid();
    if (!nick || nick.length > 24 || (steam && !validSteam(steam))) { setMessage("p-link", "Укажи ник и корректную ссылку на профиль Steam.", true); return; }
    await busy($("p-save"), "Сохраняем…", async () => {
      try {
        const synced = await state.db.setProfile(uid, {nick, steam});
        if (uid !== currentUid()) return;
        state.profile = {nick, steam}; $("p-big").textContent = nick; renderProfileLink();
        $("p-link").append(document.createTextNode(synced ? " · Профиль сохранён" : " · Профиль сохранён, но ники в заявках обновить не удалось."));
        refresh();
      } catch (error) { setMessage("p-link", errorText(error), true); }
    });
  });

  const pad = number => String(number).padStart(2, "0");
  function localDateTime(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function tick() {
    const date = state.start ? new Date(state.start) : null, valid = date && Number.isFinite(date.getTime());
    if (!valid) {
      $("home-date").textContent = "СКОРО"; $("home-date-note").textContent = "Дата будет объявлена";
      $("next-date").textContent = "Дата уточняется"; $("tour-date").textContent = "Уточняется"; $("cd").hidden = true; return;
    }
    const short = new Intl.DateTimeFormat("ru-RU", {day: "numeric", month: "short"}).format(date);
    const long = new Intl.DateTimeFormat("ru-RU", {day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"}).format(date);
    $("home-date").textContent = short.toUpperCase(); $("home-date-note").textContent = "По твоему времени";
    $("next-date").textContent = long; $("tour-date").textContent = short;
    const difference = Math.floor((date.getTime() - Date.now()) / 1000);
    $("cd").hidden = difference <= 0;
    if (difference <= 0) { $("home-date-note").textContent = "Дата старта прошла"; return; }
    $("cd-d").textContent = pad(Math.floor(difference / 86400));
    $("cd-h").textContent = pad(Math.floor(difference % 86400 / 3600));
    $("cd-m").textContent = pad(Math.floor(difference % 3600 / 60));
    $("cd-s").textContent = pad(difference % 60);
  }
  async function loadTop() {
    if (!state.db) { $("top-t").innerHTML = '<tbody><tr><td class="table-empty">Не удалось подключиться к рейтингу.</td></tr></tbody>'; return; }
    $("top-t").innerHTML = '<tbody><tr><td class="table-empty">Загружаем рейтинг…</td></tr></tbody>';
    try {
      const list = rankStats(await state.db.topStats()).slice(0, 20);
      $("top-t").innerHTML = `<thead><tr><th scope="col">#</th><th scope="col">Игрок</th><th scope="col">Матчи</th><th scope="col">Убийства</th><th scope="col">Смерти</th><th scope="col">K/D</th></tr></thead><tbody>${list.length ? list.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.nick || "—")}</td><td>${escapeHtml(item.matches)}</td><td>${escapeHtml(item.kills)}</td><td>${escapeHtml(item.deaths)}</td><td>${escapeHtml(rounded(item.kd))}</td></tr>`).join("") : '<tr><td class="table-empty" colspan="6">Статистики пока нет. Первые результаты появятся здесь.</td></tr>'}</tbody>`;
    } catch (_) { $("top-t").innerHTML = '<tbody><tr><td class="table-empty">Не удалось загрузить рейтинг. Попробуй позже.</td></tr></tbody>'; }
  }

  function adminRow(item) {
    const status = validStatus(item.status), mode = modeOf(item), id = escapeHtml(item.id);
    return `<tr><td>${escapeHtml(item.nick || "—")}</td>${mode === "duo" ? `<td>${escapeHtml(item.partner || "—")}</td>` : ""}<td>${escapeHtml(item.email || "—")}</td><td>${safeSteamLink(item.faceit)}</td><td class="s-${status}">${escapeHtml(statusName(status))}</td><td><button class="sm" type="button" data-id="${id}" data-action="ok" ${status === "ok" ? "disabled" : ""}>Принять</button><button class="sm" type="button" data-id="${id}" data-action="no" ${status === "no" ? "disabled" : ""}>Отклонить</button><button class="sm" type="button" data-id="${id}" data-action="move">В ${mode === "duo" ? "1×1" : "2×2"}</button><button class="sm" type="button" data-id="${id}" data-action="delete">Удалить</button></td></tr>`;
  }
  function setMailPool(list) {
    let emails = list.map(item => normalizeEmail(item.email));
    if (state.db && state.db.local) emails = emails.concat(Object.keys(readLocal("ah_users", {})).map(normalizeEmail));
    state.mailPool = emails.filter((email, index, all) => validEmail(email) && all.indexOf(email) === index);
    renderPicks();
  }
  function renderPicks() {
    if (!isOwner()) { $("ad-picks-wrap").hidden = true; $("ad-picks").innerHTML = ""; return; }
    const emails = state.mailPool.filter(email => email !== normalizeEmail(ADMIN_EMAIL) && !state.admins.includes(email));
    $("ad-picks-wrap").hidden = !emails.length;
    $("ad-picks").innerHTML = emails.map(email => `<button class="pick" type="button" data-mail="${escapeHtml(email)}">${escapeHtml(email)}</button>`).join("");
    $("ad-mails").innerHTML = state.mailPool.map(email => `<option value="${escapeHtml(email)}"></option>`).join("");
  }
  function renderAdmins() {
    if (!isOwner()) { $("ad-list").innerHTML = ""; return; }
    const owner = normalizeEmail(ADMIN_EMAIL);
    const list = state.admins.filter(email => email !== owner);
    $("ad-list").innerHTML = (owner ? `<div class="field ad-row"><span>${escapeHtml(owner)}</span><span class="ad-own-tag">Владелец</span></div>` : "") + (list.length ? list.map(email => `<div class="field ad-row"><span>${escapeHtml(email)}</span><button class="sm" type="button" data-mail="${escapeHtml(email)}">Убрать</button></div>`).join("") : '<p class="note">Других админов нет.</p>');
    renderPicks();
  }
  async function loadAdmin() {
    if (!state.db || !isAdmin()) return;
    const uid = currentUid();
    $("ad-tab-adm").hidden = !isOwner();
    renderAdmins();
    state.db.getStart().then(start => {
      if (uid !== currentUid()) return;
      const date = start ? new Date(start) : null;
      $("ad-start").value = date && Number.isFinite(date.getTime()) ? localDateTime(date) : "";
    }).catch(() => { if (uid === currentUid()) setMessage("ad-date-msg", "Не удалось загрузить дату старта.", true); });
    $("ad-t").innerHTML = '<p class="note">Загружаем заявки…</p>';
    try {
      const list = await state.db.list(true);
      if (uid !== currentUid() || !isAdmin()) return;
      state.adminRows = list;
      const seen = new Set(), players = list.filter(item => item.uid && item.uid !== "admin" && !seen.has(item.uid) && seen.add(item.uid));
      const previous = $("st-p").value;
      $("st-p").innerHTML = players.length ? players.map(item => `<option value="${escapeHtml(item.uid)}" data-n="${escapeHtml(item.nick || "")}">${escapeHtml(item.nick || "Без ника")} (${escapeHtml(item.email || "—")})</option>`).join("") : '<option value="">Нет игроков</option>';
      if (players.some(item => item.uid === previous)) $("st-p").value = previous;
      setMailPool(list);
      const order = {new: 0, ok: 1, no: 2};
      $("ad-t").innerHTML = ["solo", "duo"].map(mode => {
        const items = list.filter(item => modeOf(item) === mode).sort((a, b) => order[validStatus(a.status)] - order[validStatus(b.status)] || (Number(a.t) || 0) - (Number(b.t) || 0));
        const accepted = items.filter(item => item.status === "ok").length;
        return `<div class="admin-section-title"><h2>ЗАЯВКИ ${modeName(mode)}</h2><span>ПРИНЯТО ${accepted} / ${CAPACITY}</span></div><div class="tw"><table class="tbl"><thead><tr><th scope="col">Ник</th>${mode === "duo" ? '<th scope="col">Напарник</th>' : ""}<th scope="col">Почта</th><th scope="col">Steam</th><th scope="col">Статус</th><th scope="col">Действия</th></tr></thead><tbody>${items.length ? items.map(adminRow).join("") : `<tr><td class="table-empty" colspan="${mode === "duo" ? 6 : 5}">Заявок пока нет.</td></tr>`}</tbody></table></div>`;
      }).join("");
    } catch (_) { if (uid === currentUid()) $("ad-t").innerHTML = '<p class="note">Не удалось загрузить заявки. Проверь подключение и права доступа.</p>'; }
  }
  function adminTab(tab) {
    if (tab === "adm" && !isOwner()) tab = "tours";
    selectButtons($("ad-tabs"), "data-t", tab);
    $("ad-tours").hidden = tab !== "tours"; $("ad-set").hidden = tab !== "set"; $("ad-own").hidden = tab !== "adm";
    if (tab === "adm") renderAdmins();
  }
  document.querySelectorAll("#ad-tabs button").forEach(button => button.addEventListener("click", () => adminTab(button.dataset.t)));
  $("ad-save").addEventListener("click", async () => {
    if (!state.db || !isAdmin()) return;
    const raw = $("ad-start").value, date = raw ? new Date(raw) : null;
    if (date && !Number.isFinite(date.getTime())) { setMessage("ad-date-msg", "Проверь дату и время.", true); return; }
    await busy($("ad-save"), "Сохраняем…", async () => {
      try { const start = date ? date.toISOString() : null; await state.db.setStart(start); state.start = start; tick(); setMessage("ad-date-msg", "Дата сохранена."); }
      catch (error) { setMessage("ad-date-msg", errorText(error), true); }
    });
  });
  async function addAdmin() {
    if (!state.db || !isOwner()) { setMessage("ad-msg", "Добавлять админов может только владелец.", true); return; }
    const email = normalizeEmail(value("ad-new"));
    if (!validEmail(email)) { setMessage("ad-msg", "Введи корректную почту, например admin@mail.com.", true); $("ad-new").focus(); return; }
    if (email === normalizeEmail(ADMIN_EMAIL)) { setMessage("ad-msg", "Это почта владельца — он уже админ.", true); return; }
    if (state.admins.includes(email)) { setMessage("ad-msg", "Этот админ уже добавлен.", true); return; }
    await busy($("ad-add"), "Сохраняем…", async () => {
      try {
        const next = [...state.admins, email]; await state.db.setAdmins(next); state.admins = next; $("ad-new").value = "";
        renderAdmins(); setMessage("ad-msg", `${email} добавлен в админы.`);
      } catch (error) { setMessage("ad-msg", errorText(error), true); }
    });
  }
  $("ad-add").addEventListener("click", addAdmin);
  $("ad-new").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); addAdmin(); } });
  $("ad-new").addEventListener("input", () => $("ad-picks").querySelectorAll(".pick").forEach(button => button.classList.toggle("on", button.dataset.mail === normalizeEmail(value("ad-new")))));
  $("ad-picks").addEventListener("click", event => {
    const button = event.target.closest("button[data-mail]"); if (!button) return;
    $("ad-new").value = button.dataset.mail;
    $("ad-picks").querySelectorAll(".pick").forEach(pick => pick.classList.toggle("on", pick === button));
    setMessage("ad-msg", `Почта выбрана: ${button.dataset.mail}. Нажми «Добавить админа».`); $("ad-add").focus();
  });
  $("ad-list").addEventListener("click", async event => {
    const button = event.target.closest("button[data-mail]");
    if (!button || !isOwner() || !state.db || $("ad-add").disabled) return;
    const email = button.dataset.mail;
    if (!confirm(`Убрать админа ${email}?`)) return;
    await busy($("ad-add"), "Сохраняем…", async () => {
      try { const next = state.admins.filter(item => item !== email); await state.db.setAdmins(next); state.admins = next; renderAdmins(); setMessage("ad-msg", `Админ убран: ${email}`); }
      catch (error) { setMessage("ad-msg", errorText(error), true); }
    });
  });
  async function confirmScoresReset(modes) {
    const results = await state.db.results();
    const saved = modes.some(mode => results[mode] && Object.keys(results[mode]).length);
    return !saved || confirm("Изменение участников или их мест сбросит сохранённые результаты затронутой сетки. Продолжить?");
  }
  $("ad-t").addEventListener("click", async event => {
    const button = event.target.closest("button[data-id]");
    if (!button || !state.db || !isAdmin()) return;
    const item = state.adminRows.find(row => row.id === button.dataset.id), action = button.dataset.action;
    if (!item) { setMessage("ad-action-msg", "Заявка больше не найдена. Обнови страницу.", true); return; }
    await busy(button, "…", async () => {
      try {
        const mode = modeOf(item), wasAccepted = item.status === "ok", wasInBracket = item.status !== "no";
        if (action === "delete") {
          if (!confirm(`Удалить заявку ${item.nick || "игрока"}?`)) return;
          if (wasInBracket && !await confirmScoresReset([mode])) return;
          await state.db.del(item, wasInBracket);
          setMessage("ad-action-msg", "Заявка удалена.");
        } else if (action === "move") {
          const target = mode === "solo" ? "duo" : "solo";
          if (item.uid !== "admin" && state.adminRows.some(row => row.id !== item.id && row.uid === item.uid && modeOf(row) === target)) throw "У этого игрока уже есть заявка в другом режиме.";
          if (wasAccepted && state.adminRows.filter(row => modeOf(row) === target && row.status === "ok").length >= CAPACITY) throw "В другом режиме уже заняты все 16 мест.";
          let partner = "";
          if (target === "duo") {
            const answer = prompt("Укажи ник напарника для режима 2×2:", item.partner || "");
            if (answer === null) return;
            partner = answer.trim();
            if (!partner || partner.length > 24 || partner.toLowerCase() === String(item.nick || "").toLowerCase()) throw "Укажи корректный ник другого игрока.";
          } else if (!confirm(`Переместить ${item.nick || "игрока"} в режим 1×1?`)) return;
          if (wasInBracket && !await confirmScoresReset([mode, target])) return;
          await state.db.move(item, target, partner, wasInBracket);
          setMessage("ad-action-msg", `Заявка перемещена в ${modeName(target)}.`);
        } else {
          if (action === "ok" && !wasAccepted && state.adminRows.filter(row => modeOf(row) === mode && row.status === "ok").length >= CAPACITY) throw "В этом режиме уже заняты все 16 мест.";
          // Pending entries also occupy slots; removing or confirming one can
          // change the meaning of a previously recorded positional result.
          const reset = validStatus(item.status) !== action;
          if (reset && !await confirmScoresReset([mode])) return;
          await state.db.setStatus(item, action, reset);
          setMessage("ad-action-msg", action === "ok" ? "Заявка принята." : "Заявка отклонена.");
        }
        await loadAdmin();
      } catch (error) { setMessage("ad-action-msg", errorText(error), true); }
    });
  });
  $("ap-add").addEventListener("click", async () => {
    if (!state.db || !isAdmin()) return;
    const mode = state.adminMode, nick = value("ap-nick"), partner = value("ap-partner"), steam = value("ap-steam");
    if (!nick || nick.length > 24 || (mode === "duo" && (!partner || partner.length > 24 || partner.toLowerCase() === nick.toLowerCase())) || (steam && !validSteam(steam))) { setMessage("ap-msg", "Проверь ник, напарника и ссылку на профиль Steam.", true); return; }
    await busy($("ap-add"), "Добавляем…", async () => {
      try {
        const list = await state.db.list(true);
        if (list.filter(item => modeOf(item) === mode && item.status === "ok").length >= CAPACITY) throw "В этом режиме уже заняты все 16 мест.";
        if (!await confirmScoresReset([mode])) return;
        const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        await state.db.add({id, uid: "admin", email: "добавлено админом", mode, nick, partner: mode === "duo" ? partner : "", faceit: steam, status: "ok", t: Date.now()}, true);
        $("ap-nick").value = ""; $("ap-partner").value = ""; $("ap-steam").value = ""; setMessage("ap-msg", "Игрок добавлен в сетку."); await loadAdmin();
      } catch (error) { setMessage("ap-msg", errorText(error), true); }
    });
  });
  $("st-add").addEventListener("click", async () => {
    if (!state.db || !isAdmin()) return;
    const uid = $("st-p").value, rawKills = $("st-k").value, rawDeaths = $("st-d").value, kills = Number(rawKills), deaths = Number(rawDeaths);
    if (!uid || rawKills === "" || rawDeaths === "" || !Number.isSafeInteger(kills) || !Number.isSafeInteger(deaths) || kills < 0 || deaths < 0 || kills > 9999 || deaths > 9999) { setMessage("st-msg", "Выбери игрока и введи целые числа от 0 до 9999.", true); return; }
    await busy($("st-add"), "Сохраняем…", async () => {
      try { await state.db.addStat(uid, kills, deaths, $("st-p").selectedOptions[0].dataset.n); $("st-k").value = ""; $("st-d").value = ""; setMessage("st-msg", "Матч добавлен."); }
      catch (error) { setMessage("st-msg", errorText(error), true); }
    });
  });
  $("st-reset").addEventListener("click", async () => {
    if (!state.db || !isAdmin() || !$("st-p").value || !confirm("Обнулить статистику игрока?")) return;
    await busy($("st-reset"), "Сохраняем…", async () => {
      try { await state.db.resetStat($("st-p").value); setMessage("st-msg", "Статистика обнулена."); }
      catch (error) { setMessage("st-msg", errorText(error), true); }
    });
  });

  function drawBracket(size, box) {
    const names = size === 8 ? ["1/4 финала", "Полуфинал", "Финал"] : ["1/8 финала", "1/4 финала", "Полуфинал", "Финал"];
    const duo = box.id === "br-duo" || !!box.closest("#m-duo");
    let matches = size / 2, html = "";
    names.forEach(name => {
      const cell = duo ? '<span class="pr"><i>—</i><i>—</i></span>' : '<span>—</span>';
      html += `<div class="rd"><h3>${name}</h3><div class="ms">${Array.from({length: matches}, () => `<div class="m">${cell}${cell}</div>`).join("")}</div></div>`;
      matches /= 2;
    });
    box.innerHTML = html;
    const example = box.closest(".mode");
    if (example) { const slots = example.querySelector(".slots"); slots.textContent = `${size} ${slots.dataset.unit}`; }
  }
  function fillCell(cell, item, mode) {
    const pending = !!item && item.status !== "ok";
    cell.classList.toggle("pend", pending);
    if (pending) cell.setAttribute("aria-label", `${item.nick || "Участник"} — заявка на проверке`);
    else cell.removeAttribute("aria-label");
    if (mode === "duo") {
      const names = cell.querySelectorAll("i"); names[0].textContent = item ? item.nick : "—"; names[1].textContent = item ? (item.partner || "—") : "—";
    } else cell.textContent = item ? item.nick : "—";
  }
  function placeSlots(list, mode) {
    // Keep pending entries in their old slots so legacy positional scores never
    // get assigned to different players after an upgrade.
    const entries = list.filter(item => modeOf(item) === mode && item.status !== "no")
      .sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0));
    const arranged = new Array(CAPACITY).fill(null), remaining = [];
    entries.forEach(item => {
      const pos = item.pos;
      if (Number.isInteger(pos) && pos >= 0 && pos < CAPACITY && !arranged[pos]) arranged[pos] = item;
      else remaining.push(item);
    });
    remaining.forEach(item => { const free = arranged.indexOf(null); if (free >= 0) arranged[free] = item; });
    return arranged;
  }
  function unlockedPositions(mode) {
    return state.slots[mode].map((item, pos) => item && item.pos !== pos ? {id: item.id, pos} : null).filter(Boolean);
  }
  async function editScore(mode, key, oldScore, final) {
    if (!isAdmin() || !state.db) return;
    const hint = final ? "Счёт по картам в финале (3:0, 3:1 или 3:2). Пустое поле очистит счёт." : "Счёт по картам (2:0 или 2:1). Пустое поле очистит счёт.";
    let score = prompt(hint, oldScore || "");
    if (score === null) return;
    score = score.trim().replace(/\s/g, "");
    if (score === (oldScore || "")) return;
    if (score) {
      if (!/^\d{1,3}:\d{1,3}$/.test(score)) { alert("Укажи счёт в формате 2:1."); return; }
      const [a, b] = score.split(":").map(Number), target = final ? 3 : 2;
      if (Math.max(a, b) !== target || Math.min(a, b) >= target) { alert(final ? "Финал играется до трёх побед: 3:0, 3:1 или 3:2." : "Матч играется до двух побед: 2:0 или 2:1."); return; }
    }
    const [round, index] = key.split("-").map(Number), existing = state.scores[mode] || {};
    if (scoreKeysBelow(round, index).some(k => existing[k]) && !confirm("Изменение счёта сбросит результаты следующих матчей по этой ветке. Продолжить?")) return;
    try { await state.db.setScore(mode, key, score, unlockedPositions(mode)); await loadBracket(); }
    catch (error) { alert(errorText(error)); }
  }
  async function toggleBye(mode, key, hasBye, side, nick) {
    if (!isAdmin() || !state.db) return;
    const message = hasBye ? `Отменить проход игрока ${nick} без игры?` : `Засчитать игроку ${nick} проход без игры?`;
    if (!confirm(message)) return;
    const [round, index] = key.split("-").map(Number), existing = state.scores[mode] || {};
    if (scoreKeysBelow(round, index).some(k => existing[k]) && !confirm("Изменение сбросит результаты следующих матчей по этой ветке. Продолжить?")) return;
    try { await state.db.setScore(mode, key, hasBye ? "" : `bye:${side}`, unlockedPositions(mode)); await loadBracket(); }
    catch (error) { alert(errorText(error)); }
  }
  function applyResults(box, mode, slots, scores) {
    const rounds = box.querySelectorAll(".rd");
    let current = slots.slice(), potential = slots.map(Boolean);
    rounds.forEach((round, roundIndex) => {
      const next = [], nextPotential = [];
      round.querySelectorAll(".m").forEach((match, matchIndex) => {
        const cells = match.querySelectorAll(":scope > span"), a = current[matchIndex * 2] || null, b = current[matchIndex * 2 + 1] || null;
        const key = `${roundIndex}-${matchIndex}`, raw = scores[key], score = typeof raw === "string" && /^\d{1,3}:\d{1,3}$/.test(raw) ? raw : "";
        // Do not award a bye while an unfinished earlier match can still supply an opponent.
        const loneSide = a && a.status === "ok" && !b && !potential[matchIndex * 2 + 1] ? 0 : !a && b && b.status === "ok" && !potential[matchIndex * 2] ? 1 : -1;
        const playable = !!(a && b && a.status === "ok" && b.status === "ok");
        const hasBye = loneSide !== -1 && raw === `bye:${loneSide}`;
        let winner = null;
        fillCell(cells[0], a, mode); fillCell(cells[1], b, mode);
        if (hasBye) { winner = loneSide === 0 ? a : b; cells[loneSide].classList.add("win"); }
        if (score && playable) {
          const [first, second] = score.split(":").map(Number);
          if (first !== second) { winner = first > second ? a : b; cells[first > second ? 0 : 1].classList.add("win"); }
        }
        if ((playable && (score || isAdmin())) || (loneSide !== -1 && (hasBye || isAdmin()))) {
          const element = document.createElement(isAdmin() ? "button" : "div");
          if (isAdmin()) {
            element.type = "button";
            if (loneSide !== -1) element.addEventListener("click", () => toggleBye(mode, key, hasBye, loneSide, (a || b).nick));
            else element.addEventListener("click", () => editScore(mode, key, score, roundIndex === rounds.length - 1));
          }
          element.className = `sc${score || hasBye ? "" : " add"}`;
          element.textContent = loneSide !== -1 ? (hasBye ? "ПРОХОД БЕЗ ИГРЫ" : "+ ПРОХОД БЕЗ ИГРЫ") : (score ? score.replace(":", " : ") : "+ ВНЕСТИ СЧЁТ");
          match.appendChild(element);
        }
        next[matchIndex] = winner;
        nextPotential[matchIndex] = !!(potential[matchIndex * 2] || potential[matchIndex * 2 + 1]);
      });
      current = next; potential = nextPotential;
    });
    if (current[0]) {
      const champion = document.createElement("div"); champion.className = "champ";
      champion.textContent = `🏆 ${current[0].nick}${mode === "duo" && current[0].partner ? ` + ${current[0].partner}` : ""}`;
      rounds[rounds.length - 1].appendChild(champion);
    }
  }
  function bindDrag(box, mode) {
    if (!isAdmin()) return;
    box.querySelector(".rd").querySelectorAll(".m > span").forEach((cell, index) => {
      if (state.slots[mode][index]) {
        cell.draggable = true;
        cell.addEventListener("dragstart", event => { drag = {mode, index}; cell.classList.add("drag"); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", "participant"); });
        cell.addEventListener("dragend", () => { drag = null; cell.classList.remove("drag"); });
      }
      cell.addEventListener("dragover", event => { if (drag && drag.mode === mode) { event.preventDefault(); cell.classList.add("over"); } });
      cell.addEventListener("dragleave", () => cell.classList.remove("over"));
      cell.addEventListener("drop", event => {
        event.preventDefault(); cell.classList.remove("over");
        if (drag && drag.mode === mode) { const from = drag.index; drag = null; moveSlot(mode, from, index); }
      });
    });
  }
  function updateBracketControls() {
    const mode = state.bracketMode, slots = state.slots[mode], count = slots.filter(item => item && item.status === "ok").length;
    const total = state.slotTotals ? state.slotTotals[mode] : count;
    const pending = slots.filter(item => item && item.status !== "ok").length;
    if (state.bracketLoaded) $("br-status").textContent = total > count ? `Подтверждено ${total}, но не все попали в первые ${CAPACITY} мест. Организатору нужно проверить заявки.` : total ? `Подтверждено: ${total} / ${CAPACITY}.${pending ? " Остальные заявки — на проверке." : ""}` : pending ? "Заявки ожидают проверки организатором." : "Участников пока нет. Заявки появятся после регистрации.";
    $("br-tools").hidden = !isAdmin();
    const selected = $("br-player").value;
    $("br-player").innerHTML = slots.some(Boolean) ? slots.map((item, index) => item ? `<option value="${escapeHtml(item.id)}">${index + 1}. ${escapeHtml(item.nick)}${mode === "duo" && item.partner ? ` + ${escapeHtml(item.partner)}` : ""}${item.status !== "ok" ? " · на проверке" : ""}</option>` : "").join("") : '<option value="">Нет участников</option>';
    if (slots.some(item => item && item.id === selected)) $("br-player").value = selected;
    $("br-position").innerHTML = slots.map((item, index) => `<option value="${index}">${index + 1} — ${item ? escapeHtml(item.nick) : "свободно"}</option>`).join("");
  }
  async function moveSlot(mode, from, to) {
    if (!isAdmin() || !state.db || from < 0 || to < 0 || from === to || !state.slots[mode][from]) return;
    const button = $("br-move");
    if (button.disabled) return;
    await busy(button, "Перемещаем…", async () => {
      try {
        if (!await confirmScoresReset([mode])) return;
        const copy = state.slots[mode].slice(); [copy[from], copy[to]] = [copy[to], copy[from]];
        const entries = copy.map((item, pos) => item ? {id: item.id, pos} : null).filter(Boolean);
        await state.db.placeMany(mode, entries);
        setMessage("br-tool-msg", "Участник перемещён."); await loadBracket();
      } catch (error) { setMessage("br-tool-msg", errorText(error), true); }
    });
  }
  $("br-lock").addEventListener("click", async () => {
    if (!state.db || !isAdmin()) return;
    const mode = state.bracketMode, positions = unlockedPositions(mode);
    if (!positions.length) { setMessage("br-tool-msg", "Текущие места уже закреплены или участников пока нет."); return; }
    if (!confirm("Закрепить текущую раскладку? Сохранённые результаты не изменятся.")) return;
    await busy($("br-lock"), "Сохраняем…", async () => {
      try { await state.db.placeMany(mode, positions, false); setMessage("br-tool-msg", "Места закреплены, результаты сохранены."); await loadBracket(); }
      catch (error) { setMessage("br-tool-msg", errorText(error), true); }
    });
  });
  $("br-move").addEventListener("click", () => {
    const mode = state.bracketMode, id = $("br-player").value, from = state.slots[mode].findIndex(item => item && item.id === id), to = Number($("br-position").value);
    if (from < 0) { setMessage("br-tool-msg", "Выбери участника.", true); return; }
    if (from === to) { setMessage("br-tool-msg", "Участник уже находится на этом месте."); return; }
    moveSlot(mode, from, to);
  });
  async function loadBracket() {
    const version = ++state.bracketVersion;
    state.bracketLoaded = false;
    if (!state.db) {
      $("br-status").textContent = state.backendFailed ? "Не удалось подключиться к сетке. Попробуй позже." : "Загружаем сетку…";
      ["solo", "duo"].forEach(mode => drawBracket(16, $(`br-${mode}`))); return;
    }
    $("br-status").textContent = "Загружаем сетку…";
    try {
      const [list, scores] = await Promise.all([state.db.slots(), state.db.results()]);
      if (version !== state.bracketVersion) return;
      state.scores = scores || {};
      state.slotTotals = {solo: 0, duo: 0};
      list.forEach(item => { if (item.status === "ok") state.slotTotals[modeOf(item)]++; });
      ["solo", "duo"].forEach(mode => {
        const box = $(`br-${mode}`); drawBracket(16, box);
        state.slots[mode] = placeSlots(list, mode);
        applyResults(box, mode, state.slots[mode], state.scores[mode] || {});
        bindDrag(box, mode);
      });
      state.bracketLoaded = true; updateBracketControls();
    } catch (_) {
      if (version !== state.bracketVersion) return;
      $("br-status").textContent = "Не удалось загрузить сетку. Проверь подключение и попробуй позже.";
    }
  }

  function timeout(promise, milliseconds) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), milliseconds);
      Promise.resolve(promise).then(result => { clearTimeout(timer); resolve(result); }, error => { clearTimeout(timer); reject(error); });
    });
  }
  async function init() {
    drawBracket(16, $("m-solo").querySelector(".br"));
    drawBracket(16, $("m-duo").querySelector(".br"));
    drawBracket(16, $("br-solo")); drawBracket(16, $("br-duo"));
    tick(); setInterval(tick, 1000);
    navigate(location.hash.slice(1) || "home", {history: false, scroll: false});
    const demo = new URLSearchParams(location.search).get("demo") === "1" || !FIREBASE;
    let activeFirebase = true;
    try {
      state.db = demo ? localDB() : await timeout(firebaseDB(() => activeFirebase), 12000);
      if (demo) { showConnection("demo"); setMe(state.db.currentUser()); $("a-note").textContent = "Демо: данные хранятся только в этом браузере."; }
      else if (state.me) { loadAdmins(); loadProfile(); }
      $("send").disabled = false; $("a-go").disabled = false;
      state.db.getStart().then(start => { state.start = start || null; tick(); }).catch(() => {});
      refresh();
      if (state.route === "bracket") loadBracket();
      if (state.route === "top") loadTop();
      if (state.route === "admin" && isAdmin()) loadAdmin();
    } catch (_) {
      activeFirebase = false; state.backendFailed = true; state.authReady = true; state.adminsLoading = false;
      showConnection("offline"); refresh(); finishPendingAdmin();
      if (state.route === "bracket") loadBracket();
      if (state.route === "top") loadTop();
    }
  }
  init();
})();
