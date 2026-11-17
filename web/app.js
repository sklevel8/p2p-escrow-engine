/* Escrow state-machine simulator ------------------------------------------ */
(() => {
  'use strict';

  const TRANSITIONS = {
    INITIATED: ['FUNDED'],
    FUNDED: ['IN_TRANSIT', 'REFUNDED'],
    IN_TRANSIT: ['DELIVERED', 'DISPUTED'],
    DELIVERED: ['RELEASED', 'DISPUTED'],
    DISPUTED: ['RELEASED', 'REFUNDED'],
    RELEASED: [],
    REFUNDED: [],
  };

  const META = {
    INITIATED: { note: 'awaiting payment' },
    FUNDED: { note: 'money held' },
    IN_TRANSIT: { note: 'seller dispatched' },
    DELIVERED: { note: 'buyer received' },
    DISPUTED: { note: 'under review' },
    RELEASED: { note: 'paid to seller' },
    REFUNDED: { note: 'returned to buyer' },
  };

  const TRIGGERS = {
    INITIATED: 'Buyer opens checkout',
    FUNDED: 'Signed PayFast ITN clears exact amount',
    IN_TRANSIT: 'Seller marks order dispatched',
    DELIVERED: 'Courier or buyer confirms delivery',
    DISPUTED: 'Either party raises a dispute',
    RELEASED: 'Arbiter or buyer releases funds',
    REFUNDED: 'Arbiter refunds the buyer',
  };

  const $ = (s) => document.querySelector(s);
  const el = {
    machine: $('#machine'),
    nextStates: $('#nextStates'),
    invalid: $('#invalidSelect'),
    trail: $('#trail'),
    trailEmpty: $('#trailEmpty'),
    trailCount: $('#trailCount'),
    held: $('#heldAmount'),
    terminal: $('#terminalBadge'),
    escrowId: $('#escrowId'),
    form: $('#escrowForm'),
    amount: $('#amountInput'),
    buyer: $('#buyerInput'),
    seller: $('#sellerInput'),
    gwStatus: $('#gwStatus'),
    gwAmount: $('#gwAmount'),
    gwExpected: $('#gwExpected'),
    decision: $('#decision'),
    rulesBody: $('#rulesBody'),
    toast: $('#toast'),
  };

  const state = {
    current: 'INITIATED',
    amountCents: 149900,
    buyer: 'Thandi M.',
    seller: 'Kagiso T.',
    id: 'ESC-1042',
    visited: ['INITIATED'],
    trail: [],
  };

  /* --------------------------------------------------------------- helpers */
  function money(cents) {
    const value = (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `R ${value}`;
  }
  function clock() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  function terminal(value) { return TRANSITIONS[value].length === 0; }
  function heldCents() {
    return ['FUNDED', 'IN_TRANSIT', 'DELIVERED', 'DISPUTED'].includes(state.current) ? state.amountCents : 0;
  }
  function log(kind, html) {
    state.trail.unshift({ kind, html, time: clock() });
    renderTrail();
  }
  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('is-visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.toast.classList.remove('is-visible'), 2200);
  }

  /* ---------------------------------------------------------------- render */
  function renderMachine() {
    const allowed = TRANSITIONS[state.current] || [];
    el.machine.innerHTML = Object.keys(META).map((name) => {
      const classes = ['state'];
      if (name === state.current) classes.push('state--current');
      else if (allowed.includes(name)) classes.push('state--reachable');
      else if (state.visited.includes(name)) classes.push('state--done');
      if (terminal(name)) classes.push('state--terminal');
      return `<div class="${classes.join(' ')}" role="listitem" aria-current="${name === state.current}">
        <span class="state__name">${name}</span>
        <span class="state__meta">${META[name].note}</span>
      </div>`;
    }).join('');

    el.nextStates.innerHTML = allowed.length
      ? allowed.map((next) => `<button class="btn btn--sm btn--soft" type="button" data-next="${next}">→ ${next}</button>`).join('')
      : '<span class="badge badge--bad">terminal — no transitions</span>';

    el.terminal.textContent = terminal(state.current) ? 'terminal state' : 'non-terminal';
    el.terminal.className = `badge ${terminal(state.current) ? 'badge--bad' : ''}`;
    el.held.textContent = `${money(heldCents())} held`;
    el.escrowId.textContent = state.id;

    const options = Object.keys(META).filter((name) => name !== state.current && !allowed.includes(name));
    el.invalid.innerHTML = options.map((name) => `<option value="${name}">${state.current} → ${name}</option>`).join('');
  }

  function renderTrail() {
    el.trail.innerHTML = state.trail.map((item) =>
      `<li class="trail__item trail__item--${item.kind}">
        <span class="trail__time">${item.time}</span>
        <span class="trail__msg">${item.html}</span>
      </li>`
    ).join('');
    el.trailCount.textContent = String(state.trail.length);
    el.trailEmpty.classList.toggle('hidden', state.trail.length > 0);
  }

  function renderRules() {
    el.rulesBody.innerHTML = Object.keys(TRANSITIONS).map((from) => {
      const next = TRANSITIONS[from];
      return `<tr>
        <td><span class="mono">${from}</span></td>
        <td>${next.length ? next.map((n) => `<span class="mono dim">${n}</span>`).join(' · ') : '<span class="dim">—</span>'}</td>
        <td>${next.length ? '<span class="badge">no</span>' : '<span class="badge badge--bad">yes</span>'}</td>
        <td class="dim small">${TRIGGERS[from]}</td>
      </tr>`;
    }).join('');
  }

  /* -------------------------------------------------------------- actions */
  function transition(next) {
    if (!TRANSITIONS[state.current].includes(next)) {
      log('bad', `<b>InvalidTransitionError</b> cannot move ${state.current} → ${next}`);
      toast('Blocked: transition not allowed');
      return;
    }
    const from = state.current;
    state.current = next;
    if (!state.visited.includes(next)) state.visited.push(next);
    log('ok', `<b>${from} → ${next}</b> ${META[next].note}`);
    renderMachine();
    toast(`Moved to ${next}`);
  }

  function openEscrow(event) {
    event.preventDefault();
    const cents = Math.round(Number(el.amount.value) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      el.amount.focus();
      return;
    }
    state.current = 'INITIATED';
    state.amountCents = cents;
    state.buyer = el.buyer.value.trim() || 'Buyer';
    state.seller = el.seller.value.trim() || 'Seller';
    state.visited = ['INITIATED'];
    state.trail = [];
    state.id = `ESC-${1000 + Math.floor(Math.random() * 9000)}`;
    log('accent', `<b>Escrow ${state.id} opened</b> ${money(cents)} · ${state.buyer} → ${state.seller}`);
    renderMachine();
    toast('Escrow opened');
  }

  el.machine.addEventListener('click', () => { /* states are informational */ });

  el.nextStates.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-next]');
    if (btn) transition(btn.dataset.next);
  });

  document.querySelector('#attemptBtn').addEventListener('click', () => transition(el.invalid.value));
  el.form.addEventListener('submit', openEscrow);

  /* ------------------------------------------------------- gateway policy */
  const SUCCESS = new Set(['COMPLETE', 'PAID', 'SUCCESS']);

  function decide() {
    const status = el.gwStatus.value.trim();
    const amount = Number(el.gwAmount.value);
    const expected = Number(el.gwExpected.value);

    if (!SUCCESS.has(status.toUpperCase())) {
      return {
        action: 'ignore',
        cls: 'decision--warn',
        badge: 'badge',
        text: `Non-successful gateway status: ${status || '(empty)'}. Acknowledged with no state change.`,
      };
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return { action: 'reject', cls: 'decision--bad', badge: 'badge badge--bad', text: 'Unparseable or non-positive settled amount. Alert raised, no state change.' };
    }
    if (amount !== expected) {
      return {
        action: 'reject',
        cls: 'decision--bad',
        badge: 'badge badge--bad',
        text: `Amount mismatch: settled ${amount} vs expected ${expected} cents. Alert raised, no state change.`,
      };
    }
    return { action: 'fund', cls: 'decision--ok', badge: 'badge badge--ok', text: 'Status is successful and the settled amount matches the escrow exactly.' };
  }

  function renderDecision() {
    const result = decide();
    el.decision.className = `decision ${result.cls}`;
    el.decision.innerHTML = `<span class="${result.badge}"><span class="dot"></span> ${result.action}</span><p>${result.text}</p>`;
  }

  [el.gwStatus, el.gwAmount, el.gwExpected].forEach((input) => {
    input.addEventListener('input', renderDecision);
    input.addEventListener('change', renderDecision);
  });

  /* ----------------------------------------------------------------- boot */
  renderRules();
  renderMachine();
  renderDecision();
  log('accent', `<b>Escrow ${state.id} opened</b> ${money(state.amountCents)} · ${state.buyer} → ${state.seller}`);
})();
