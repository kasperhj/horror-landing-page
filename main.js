(() => {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const root = document.documentElement;
  const body = document.body;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;

  const FOUND_KEY = "hearth-found-you";
  if (new URLSearchParams(location.search).has("fresh")) localStorage.removeItem(FOUND_KEY);

  const state = {
    p: 0,
    maxPhase: 0,
    lastY: scrollY,
    peakY: scrollY,
    upCounted: false,
    ups: 0,
    start: Date.now(),
    mouse: { x: innerWidth / 2, y: innerHeight / 2, lastMove: Date.now() },
    endingStarted: false,
  };

  const ORIGINAL_TITLE = document.title;
  let currentTitle = ORIGINAL_TITLE;

  const FAVICON_EVIL =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23050404'/%3E%3Cpath d='M3 16 Q16 4 29 16 Q16 28 3 16Z' fill='%23d8cfbf'/%3E%3Ccircle cx='16' cy='16' r='5.5' fill='%23a3120f'/%3E%3Ccircle cx='16' cy='16' r='2.6' fill='%23000'/%3E%3C/svg%3E";

  $(".year").textContent = new Date().getFullYear();

  (function makeGrain() {
    const size = 180;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() * 70;
    }
    ctx.putImageData(img, 0, 0);
    $(".grain").style.backgroundImage = `url(${c.toDataURL()})`;
  })();

  const Sound = (() => {
    let ctx, master, padGain, droneGain, lp, noiseGain, noiseBuf;
    const pad = [];
    const drone = [];
    let enabled = false;
    let silenced = false;

    function makeNoise(seconds) {
      const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    function init() {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      noiseBuf = makeNoise(2);

      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      padGain = ctx.createGain();
      padGain.gain.value = 0;
      const padFilter = ctx.createBiquadFilter();
      padFilter.type = "lowpass";
      padFilter.frequency.value = 1100;
      padFilter.connect(padGain).connect(master);
      [
        [261.63, -0.045],
        [329.63, 0.03],
        [392.0, -0.06],
        [523.25, 0.052],
      ].forEach(([f, drift]) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = 0.1;
        o.connect(g).connect(padFilter);
        o.start();
        pad.push({ o, f, drift });
      });

      lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 140;
      lp.Q.value = 4;
      droneGain = ctx.createGain();
      droneGain.gain.value = 0;
      lp.connect(droneGain).connect(master);
      [
        [43.65, "sawtooth"],
        [44.1, "sawtooth"],
        [87.6, "triangle"],
      ].forEach(([f, type]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = 0.22;
        o.connect(g).connect(lp);
        o.start();
        drone.push({ o, f });
      });
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.08;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 60;
      lfo.connect(lfoDepth).connect(lp.frequency);
      lfo.start();

      const n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 480;
      bp.Q.value = 0.6;
      noiseGain = ctx.createGain();
      noiseGain.gain.value = 0;
      n.connect(bp).connect(noiseGain).connect(master);
      n.start();

      heartbeat();
    }

    function update(p) {
      if (!ctx || !enabled || silenced) return;
      const t = ctx.currentTime;
      const sour = clamp(p * 2.4, 0, 1);
      padGain.gain.setTargetAtTime(clamp(1 - p * 1.9, 0, 1) * 0.28, t, 0.6);
      pad.forEach(({ o, f, drift }) => o.frequency.setTargetAtTime(f * (1 + drift * sour), t, 0.8));
      droneGain.gain.setTargetAtTime(clamp((p - 0.18) * 1.6, 0, 1) * 0.55, t, 0.6);
      lp.frequency.setTargetAtTime(100 + p * 420, t, 0.6);
      drone[1].o.frequency.setTargetAtTime(drone[1].f + p * 2.6, t, 0.6);
      noiseGain.gain.setTargetAtTime(clamp((p - 0.45) * 1.2, 0, 1) * 0.1, t, 0.6);
    }

    function thump(t, v) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(72, t);
      o.frequency.exponentialRampToValueAtTime(36, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.3);
    }

    function heartbeat() {
      const p = state.p;
      if (enabled && !silenced && p > 0.72) {
        const t = ctx.currentTime + 0.02;
        const v = 0.35 + (p - 0.72) * 1.8;
        thump(t, v);
        thump(t + 0.19, v * 0.7);
      }
      const gap = p > 0.72 ? clamp(1050 - (p - 0.72) * 1900, 430, 1050) : 600;
      setTimeout(heartbeat, gap);
    }

    function toggle() {
      if (!ctx) init();
      enabled = !enabled;
      if (enabled) {
        ctx.resume();
        master.gain.setTargetAtTime(silenced ? 0 : 0.5, ctx.currentTime, 0.3);
        update(state.p);
      } else {
        master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      }
      return enabled;
    }

    function silence() {
      silenced = true;
      if (ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    }

    function unsilence() {
      silenced = false;
      if (ctx && enabled) {
        master.gain.setTargetAtTime(0.5, ctx.currentTime, 2);
        update(state.p);
      }
    }

    function scream() {
      if (!ctx || !enabled) return;
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.42, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + 1.7);
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / curve.length) * 2 - 1;
        curve[i] = ((3 + 300) * x * 20 * (Math.PI / 180)) / (Math.PI + 300 * Math.abs(x));
      }
      shaper.curve = curve;
      shaper.connect(out).connect(ctx.destination);

      const n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.setValueAtTime(3000, t);
      hp.frequency.exponentialRampToValueAtTime(200, t + 1.2);
      const ng = ctx.createGain();
      ng.gain.value = 0.6;
      n.connect(hp).connect(ng).connect(shaper);
      n.start(t);
      n.stop(t + 1.7);

      [311, 880, 933, 1245, 1661].forEach((f) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 1.5);
        const g = ctx.createGain();
        g.gain.value = 0.1;
        o.connect(g).connect(shaper);
        o.start(t);
        o.stop(t + 1.7);
      });

      const sub = ctx.createOscillator();
      sub.frequency.setValueAtTime(60, t);
      sub.frequency.exponentialRampToValueAtTime(25, t + 1);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.8, t);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
      sub.connect(sg).connect(ctx.destination);
      sub.start(t);
      sub.stop(t + 1.3);
    }

    return { toggle, update, silence, unsilence, scream };
  })();

  const soundBtn = $(".sound-btn");
  soundBtn.addEventListener("click", () => {
    const on = Sound.toggle();
    soundBtn.setAttribute("aria-pressed", String(on));
    $(".sound-label").textContent = on ? "Sound on" : "Sound off";
  });

  function setPhase(n) {
    body.dataset.phase = n;
    body.classList.toggle("dark-nav", n >= 3);
    if (n <= state.maxPhase) return;
    state.maxPhase = n;

    $$("[data-swap]").forEach((el) => {
      if (+el.dataset.swapPhase <= n) el.textContent = el.dataset.swap;
    });
    if (n >= 3) {
      $("#favicon").href = FAVICON_EVIL;
      body.classList.add("chat-wrong");
      $(".chat-presence span").textContent = "In the room";
      showEvilCookie();
    }
    if (n >= 4) setTitle("Hearth — We're home");
  }

  const phaseIO = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && setPhase(+e.target.dataset.phase)),
    { rootMargin: "-50% 0px -50% 0px" }
  );
  $$("[data-phase]").forEach((el) => el !== body && phaseIO.observe(el));

  function setTitle(t) {
    currentTitle = t;
    if (!document.hidden) document.title = t;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (state.p > 0.75 || body.classList.contains("after")) document.title = "we can see you";
      else if (state.p > 0.4) document.title = "come back";
    } else {
      document.title = currentTitle;
    }
  });

  const glitchEls = $$("[data-alt]");
  const visibleGlitch = new Set();
  const glitchIO = new IntersectionObserver((entries) =>
    entries.forEach((e) => (e.isIntersecting ? visibleGlitch.add(e.target) : visibleGlitch.delete(e.target)))
  );
  glitchEls.forEach((el) => {
    el.dataset.orig = el.textContent;
    glitchIO.observe(el);
    el.addEventListener("mouseenter", () => {
      if (state.p > 0.25 && Math.random() < 0.5) flashAlt(el);
    });
  });

  function flashAlt(el) {
    if (el.dataset.busy) return;
    el.dataset.busy = "1";
    el.textContent = el.dataset.alt;
    if (!reduced) el.classList.add("glitching");
    setTimeout(() => {
      el.textContent = el.dataset.orig;
      el.classList.remove("glitching");
      delete el.dataset.busy;
    }, 70 + state.p * 420);
  }

  setInterval(() => {
    if (state.p < 0.06) return;
    const chance = 0.0015 + 0.03 * state.p * state.p;
    visibleGlitch.forEach((el) => Math.random() < chance && flashAlt(el));
  }, 100);

  const countIO = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        countIO.unobserve(e.target);
        runCount(e.target);
      }),
    { threshold: 0.6 }
  );
  $$(".count").forEach((el) => countIO.observe(el));

  function runCount(el) {
    const to = +el.dataset.to;
    const suffix = el.dataset.suffix;
    if (to === 0) {
      setTimeout(() => (el.textContent = "1"), 1400);
      setTimeout(() => (el.textContent = "0"), 1650);
      return;
    }
    const t0 = performance.now();
    const dur = 1600;
    const step = (now) => {
      const k = clamp((now - t0) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(to * eased).toLocaleString("en-US") + suffix;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  const deviceName = (() => {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    if (/Android/.test(ua)) return "Android phone";
    if (/Mac/.test(ua)) return navigator.maxTouchPoints > 1 ? "iPad" : "Mac";
    if (/Win/.test(ua)) return "Windows PC";
    if (/Linux/.test(ua)) return "Linux computer";
    return "unknown";
  })();
  let battery = "unknown";
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      const upd = () => (battery = `${Math.round(b.level * 100)}%, ${b.charging ? "charging" : "not charging"}`);
      upd();
      b.addEventListener("levelchange", upd);
      b.addEventListener("chargingchange", upd);
    }).catch(() => {});
  }

  $("#lv-tz").textContent = tz;
  $("#lv-device").textContent = deviceName;
  $("#lv-screen").textContent = `${screen.width} × ${screen.height}`;

  const pad2 = (n) => String(n).padStart(2, "0");
  const clock = (d = new Date()) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const elapsed = () => {
    const s = Math.floor((Date.now() - state.start) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
  };
  const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

  const terminal = $(".terminal");
  let terminalSeenAt = 0;
  let secondPerson = false;
  new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting && !terminalSeenAt) terminalSeenAt = Date.now();
    },
    { threshold: 0.5 }
  ).observe(terminal);

  setInterval(() => {
    const d = new Date();
    $("#lv-time").textContent = `${clock(d)}:${pad2(d.getSeconds())}`;
    $("#lv-dur").textContent = elapsed();
    $("#lv-up").textContent = state.ups ? times(state.ups) : "0 times";
    $("#lv-batt").textContent = battery;
    const still = Math.floor((Date.now() - state.mouse.lastMove) / 1000);
    $("#lv-cursor").textContent = !finePointer ? "touch" : still < 1 ? "moving" : `still for ${still}s`;

    if (terminalSeenAt && !secondPerson) {
      const since = Date.now() - terminalSeenAt;
      const people = $("#lv-people");
      if (since > 3500 && since < 4100) {
        people.textContent = "2";
        people.classList.add("alarm");
      } else if (since >= 4100 && since < 6000) {
        people.textContent = "1";
        people.classList.remove("alarm");
      } else if (since >= 6000) {
        secondPerson = true;
        people.textContent = "2";
        people.classList.add("alarm");
        $("#lv-note").textContent = "› second person detected behind visitor. they are standing very still.";
      }
    }
  }, 500);

  const cookie = $(".cookie");
  let cookieAccepted = false;
  $$(".cookie button").forEach((b) =>
    b.addEventListener("click", () => {
      cookieAccepted = true;
      cookie.classList.add("hide");
    })
  );

  function showEvilCookie() {
    setTimeout(() => {
      cookie.classList.add("hide");
      setTimeout(() => {
        cookie.classList.add("evil");
        $(".cookie-text").textContent =
          "We have updated our privacy policy. Hearth may now remain in your home after you cancel. Hearth may now remain in your home.";
        $(".cookie-accept").textContent = "Accept";
        $(".cookie-second").textContent = "Accept";
        cookie.classList.remove("hide");
      }, cookieAccepted ? 0 : 600);
    }, 1200);
  }

  const chat = $(".chat");
  const chatLog = $(".chat-log");
  const peek = $(".chat-peek");
  const badge = $(".chat-badge");
  let unread = 0;
  let peekTimer;
  let chatQueue = Promise.resolve();

  function timeLine() {
    const h = new Date().getHours();
    const tail =
      h >= 22 || h < 5
        ? "Shouldn't you be asleep?"
        : h < 12
          ? "Is anyone else home with you this morning?"
          : "Is anyone else home with you?";
    return `It's ${clock()} where you are. ${tail}`;
  }

  const chatScript = [
    { at: 0, text: () => "Hi there 👋 I'm Hearth. Got any questions? I'm always here." },
    { at: 0.2, text: () => "Lots of families start with the Home plan. Just saying 🙂" },
    { at: 0.36, text: () => "You read very carefully. I like that about you." },
    { at: 0.5, text: timeLine },
    {
      at: 0.62,
      text: () =>
        state.ups
          ? `You scrolled back up ${times(state.ups)}. What were you looking for?`
          : "You can stop scrolling now. I don't mind waiting.",
    },
    { at: 0.74, text: () => "who is that standing behind you" },
    { at: 0.86, text: () => "dont turn around" },
  ];

  function addMsg(text, who) {
    const m = document.createElement("div");
    m.className = `msg msg-${who}`;
    m.textContent = text;
    chatLog.append(m);
    chatLog.scrollTop = chatLog.scrollHeight;
    return m;
  }

  function botSay(textFn) {
    chatQueue = chatQueue.then(async () => {
      const typing = document.createElement("div");
      typing.className = "msg msg-bot";
      typing.innerHTML = '<span class="msg-typing"><i></i><i></i><i></i></span>';
      chatLog.append(typing);
      chatLog.scrollTop = chatLog.scrollHeight;
      await wait(1100);
      const text = textFn();
      await wait(Math.min(text.length * 18, 1400));
      typing.remove();
      addMsg(text, "bot");
      if (!chat.classList.contains("open")) {
        unread++;
        badge.textContent = unread;
        badge.hidden = false;
        peek.textContent = text;
        peek.classList.add("show");
        clearTimeout(peekTimer);
        peekTimer = setTimeout(() => peek.classList.remove("show"), 9000);
      }
    });
  }

  function openChat() {
    chat.classList.add("open");
    unread = 0;
    badge.hidden = true;
    peek.classList.remove("show");
    $(".chat-form input").focus({ preventScroll: true });
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  $(".chat-launch").addEventListener("click", () => (chat.classList.contains("open") ? chat.classList.remove("open") : openChat()));
  peek.addEventListener("click", openChat);
  $(".chat-close").addEventListener("click", () => chat.classList.remove("open"));

  const replies = [
    ["Thanks for reaching out! A specialist will be with you shortly.", "Great question. Our team usually replies within a few minutes."],
    ["I heard you the first time.", "You don't need to type. I can hear you.", "Why are you whispering?"],
    ["we know", "shhh", "it can hear you typing", "nobody is coming"],
  ];

  $(".chat-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = $(".chat-form input");
    const text = input.value.trim();
    if (!text) return;
    addMsg(text, "me");
    input.value = "";
    const pool = replies[state.p < 0.4 ? 0 : state.p < 0.7 ? 1 : 2];
    botSay(() => pool[Math.floor(Math.random() * pool.length)]);
  });

  setTimeout(() => {
    chatScript[0].done = true;
    botSay(chatScript[0].text);
  }, 3500);

  function checkChat() {
    chatScript.forEach((line, i) => {
      if (i === 0 || line.done || state.p < line.at) return;
      line.done = true;
      botSay(line.text);
    });
  }

  const stayBtn = $(".stay-btn");
  stayBtn.addEventListener("click", () => {
    stayBtn.disabled = true;
    stayBtn.textContent = "Thank you.";
    setTimeout(() => (stayBtn.textContent = "You will stay."), 1400);
  });

  const lastFaq = $(".faq-last");
  const typed = $("[data-type]", lastFaq);
  let typedDone = false;
  function typeOut() {
    if (typedDone) return;
    typedDone = true;
    const text = typed.dataset.type;
    let i = 0;
    const next = () => {
      typed.textContent = text.slice(0, ++i);
      if (i < text.length) setTimeout(next, 120 + Math.random() * 120);
    };
    setTimeout(next, 500);
  }
  lastFaq.addEventListener("toggle", () => lastFaq.open && typeOut());
  let faqTimer;
  new IntersectionObserver(
    ([e]) => {
      clearTimeout(faqTimer);
      if (e.isIntersecting && !lastFaq.open) faqTimer = setTimeout(() => (lastFaq.open = true), 3500);
    },
    { threshold: 1 }
  ).observe(lastFaq);

  const listening = $(".listening");
  const listenLines = $$(".listen-line");
  const end = $(".end");
  const eye = $(".eye");
  const eyeLines = $$(".end-line");
  const minutesLine = $('[data-dyn="minutes"]');

  function onScroll() {
    const y = scrollY;
    const max = root.scrollHeight - innerHeight;
    state.p = clamp(y / max, 0, 1);
    root.style.setProperty("--p", state.p.toFixed(4));

    if (y > state.lastY) {
      state.peakY = y;
      state.upCounted = false;
    } else if (!state.upCounted && y < state.peakY - 150 && state.p > 0.04) {
      state.ups++;
      state.upCounted = true;
    }
    state.lastY = y;

    const lr = listening.getBoundingClientRect();
    if (lr.bottom > 0 && lr.top < innerHeight && !reduced) {
      const local = (innerHeight - lr.top) / (lr.height + innerHeight);
      listenLines.forEach((line) => {
        const x = +line.dataset.dir * (local - 0.5) * +line.dataset.speed * 700;
        line.style.transform = `translateX(calc(-18% + ${x.toFixed(1)}px))`;
      });
    }

    const er = end.getBoundingClientRect();
    if (er.top < innerHeight && er.bottom > 0) {
      const local = clamp(-er.top / (er.height - innerHeight), 0, 1);
      const enter = clamp(1 - er.top / innerHeight, 0, 1);
      eye.style.opacity = (enter * Math.min(1, 0.25 + local * 3)).toFixed(3);
      eye.style.transform = `scale(${(0.7 + local * 0.55).toFixed(3)})`;
      eyeTarget.dilate = 0.75 + local * 0.95;
      const idx = Math.floor(local * 5.6 - 0.2);
      eyeLines.forEach((l, i) => l.classList.toggle("on", i === idx));
      if (idx === 0) {
        const mins = Math.max(1, Math.round((Date.now() - state.start) / 60000));
        minutesLine.textContent = `You have been here for ${mins} minute${mins === 1 ? "" : "s"}.`;
      }
    }

    if (!state.endingStarted && y >= max - 4 && state.maxPhase >= 4) startEnding();

    checkChat();
    Sound.update(state.p);
  }

  let scrollQueued = false;
  addEventListener(
    "scroll",
    () => {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        scrollQueued = false;
        onScroll();
      });
    },
    { passive: true }
  );
  addEventListener("resize", onScroll);

  const trail = [];
  addEventListener(
    "pointermove",
    (e) => {
      state.mouse.x = e.clientX;
      state.mouse.y = e.clientY;
      state.mouse.lastMove = Date.now();
      trail.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (trail.length > 200) trail.shift();
    },
    { passive: true }
  );

  const ghost = $(".ghost-cursor");
  const heroPupil = $(".device-pupil");
  const lens = $(".device-lens");
  const iris = $(".iris-group");
  const pupil = $(".eye-pupil");
  pupil.style.transformBox = "fill-box";
  pupil.style.transformOrigin = "center";
  const eyeTarget = { x: 0, y: 0, dilate: 1 };
  const eyeNow = { x: 0, y: 0, dilate: 1 };

  function lookPoint(now) {
    if (finePointer) return state.mouse;
    return {
      x: innerWidth / 2 + Math.sin(now / 1900) * innerWidth * 0.4,
      y: innerHeight / 2 + Math.sin(now / 1300) * innerHeight * 0.3,
    };
  }

  function frame(now) {
    const look = lookPoint(now);

    if (state.p < 0.2 || body.classList.contains("after")) {
      const r = lens.getBoundingClientRect();
      const dx = look.x - (r.left + r.width / 2);
      const dy = look.y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 400) * 13;
      heroPupil.style.transform = `translate(${((dx / d) * k).toFixed(1)}px, ${((dy / d) * k).toFixed(1)}px)`;
    }

    if (state.p > 0.6) {
      const r = eye.getBoundingClientRect();
      eyeTarget.x = clamp((look.x - (r.left + r.width / 2)) / (r.width / 2), -1, 1) * 78;
      eyeTarget.y = clamp((look.y - (r.top + r.height / 2)) / (r.height / 2), -1, 1) * 34;
      eyeNow.x = lerp(eyeNow.x, eyeTarget.x, 0.12);
      eyeNow.y = lerp(eyeNow.y, eyeTarget.y, 0.12);
      eyeNow.dilate = lerp(eyeNow.dilate, eyeTarget.dilate, 0.05);
      iris.setAttribute("transform", `translate(${eyeNow.x.toFixed(1)} ${eyeNow.y.toFixed(1)})`);
      pupil.style.transform = `scale(${eyeNow.dilate.toFixed(3)})`;
    }

    if (finePointer) {
      const op = clamp((state.p - 0.55) * 3, 0, 0.75);
      ghost.style.opacity = op;
      if (op > 0 && trail.length) {
        const target = now - 550;
        let pt = trail[0];
        for (let i = trail.length - 1; i >= 0; i--) {
          if (trail[i].t <= target) {
            pt = trail[i];
            break;
          }
        }
        ghost.style.transform = `translate(${pt.x - 3}px, ${pt.y - 2}px)`;
      }
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const lid = $(".eye-lid");
  (function blinkLoop() {
    setTimeout(() => {
      if (state.p > 0.65 && !reduced) {
        lid.classList.add("blink");
        setTimeout(() => lid.classList.remove("blink"), 140);
      }
      blinkLoop();
    }, 1800 + Math.random() * 4200);
  })();

  const scare = $(".scare");

  function startEnding() {
    state.endingStarted = true;
    body.classList.add("lights-out");
    Sound.silence();
    setTimeout(runScare, 1800);
  }

  function runScare() {
    scare.classList.add("on");
    Sound.scream();
    setTimeout(() => scare.classList.add("text"), reduced ? 1200 : 900);
    setTimeout(() => {
      foundYou();
      scare.classList.add("fade");
    }, 3600);
    setTimeout(() => {
      scare.classList.remove("on", "text", "fade");
      body.classList.remove("lights-out");
      Sound.unsilence();
    }, 6100);
  }

  function foundYou() {
    localStorage.setItem(FOUND_KEY, "1");
    body.classList.add("after");
    $(".pill").textContent = "Home";
    $(".hero-eyebrow-text").textContent = "Welcome back. We kept your seat warm.";
    $(".hero-title").innerHTML = "Your home, finally <em>paying attention to you.</em>";
    $(".hero .lede").textContent =
      "Hearth has learned the rhythm of your household. When you wake, when you leave, when you come home. There is no need to leave again.";
    $(".rating").innerHTML = '<span class="stars" aria-hidden="true">★★★★★</span> 4.9 from 12,000+ reviews · Free shipping · No returns';
    $(".app-greet").textContent = "Welcome home";
    $(".app-status").innerHTML = "<i></i> Watching";
    $$(".app-rows b[data-after]").forEach((b) => (b.textContent = b.dataset.after));
    $("#favicon").href = FAVICON_EVIL;
    setTitle("Hearth — We're home");
  }

  if (localStorage.getItem(FOUND_KEY)) foundYou();

  onScroll();
})();
