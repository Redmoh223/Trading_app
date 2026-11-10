const BASE = "";
const STATE = { pnlHistory: [], labels: [], ws: null };

const els = {
  modeVal: document.getElementById("modeVal"),
  headerTotal: document.getElementById("headerTotal"),
  headerPnl: document.getElementById("headerPnl"),
  totalValue: document.getElementById("totalValue"),
  cash: document.getElementById("cash"),
  unrealizedPnl: document.getElementById("unrealizedPnl"),
  realizedPnl: document.getElementById("realizedPnl"),
  dailyPnl: document.getElementById("dailyPnl"),
  qsCash: document.getElementById("qsCash"),
  qsPositions: document.getElementById("qsPositions"),
  positionsBody: document.querySelector("#positionsTable tbody"),
  ordersBody: document.querySelector("#ordersTable tbody"),
  positionsEmpty: document.getElementById("positionsEmpty"),
  ordersEmpty: document.getElementById("ordersEmpty"),
  wsStatus: document.createElement("span"),
  orderMsg: document.getElementById("orderMsg"),
};

let chart = null;

function fmtUSD(n) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD" }).format(n ?? 0);
}

function clsPnl(n) {
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  return "neutral";
}

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}`;
  STATE.ws = new WebSocket(wsUrl);

  STATE.ws.onopen = () => {
    els.wsStatus.textContent = "● Connecté";
    els.wsStatus.style.color = "#22c55e";
    if (els.modeVal && els.modeVal.parentNode) {
      els.modeVal.parentNode.appendChild(document.createTextNode(" "));
      els.modeVal.parentNode.appendChild(els.wsStatus);
    }
  };

  STATE.ws.onclose = () => {
    els.wsStatus.textContent = "● Déconnecté (reconnexion…)";
    els.wsStatus.style.color = "#ef4444";
    setTimeout(connectWebSocket, 3000);
  };

  STATE.ws.onerror = () => {
    els.wsStatus.textContent = "● Erreur";
    els.wsStatus.style.color = "#ef4444";
  };

  STATE.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "state") {
        renderState(msg);
      }
    } catch (e) {
      console.warn("WS message parse error", e);
    }
  };
}

function renderState(data) {
  const { portfolio, positions, orders } = data;

  els.headerTotal.textContent = fmtUSD(portfolio.totalValue);
  els.totalValue.textContent = fmtUSD(portfolio.totalValue);
  els.cash.textContent = fmtUSD(portfolio.cash);
  els.qsCash.textContent = fmtUSD(portfolio.cash);
  els.unrealizedPnl.textContent = fmtUSD(portfolio.unrealizedPnl);
  els.unrealizedPnl.className = `val neutral ${clsPnl(portfolio.unrealizedPnl)}`;
  els.realizedPnl.textContent = fmtUSD(portfolio.realizedPnl);
  els.realizedPnl.className = `val neutral ${clsPnl(portfolio.realizedPnl)}`;
  els.dailyPnl.textContent = fmtUSD(portfolio.dailyPnl);
  els.dailyPnl.className = `val neutral ${clsPnl(portfolio.dailyPnl)}`;
  els.headerPnl.textContent = fmtUSD(portfolio.dailyPnl);
  els.headerPnl.className = clsPnl(portfolio.dailyPnl);
  els.qsPositions.textContent = positions ? positions.length : 0;

  STATE.pnlHistory.push(portfolio.dailyPnl);
  STATE.labels.push(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
  if (STATE.pnlHistory.length > 60) {
    STATE.pnlHistory.shift();
    STATE.labels.shift();
  }
  renderChart();

  renderPositions(positions);
  renderOrders(orders);
}

function renderPositions(positions) {
  const body = els.positionsBody;
  body.innerHTML = "";
  if (!positions || positions.length === 0) {
    els.positionsEmpty.style.display = "";
    return;
  }
  els.positionsEmpty.style.display = "none";
  for (const p of positions) {
    const tr = document.createElement("tr");
    const pnlCls = clsPnl(p.unrealizedPnl);
    tr.innerHTML = `
      <td>${p.symbol}</td>
      <td><span class="badge ${p.side}">${p.side}</span></td>
      <td>${p.quantity}</td>
      <td>${fmtUSD(p.averageEntryPrice)}</td>
      <td>${fmtUSD(p.currentPrice)}</td>
      <td class="${pnlCls}">${fmtUSD(p.unrealizedPnl)}</td>
    `;
    body.appendChild(tr);
  }
}

function renderOrders(orders) {
  const body = els.ordersBody;
  body.innerHTML = "";
  const list = orders || [];
  if (list.length === 0) {
    els.ordersEmpty.style.display = "";
    return;
  }
  els.ordersEmpty.style.display = "none";
  for (const o of list.slice(0, 20).reverse()) {
    const tr = document.createElement("tr");
    const time = new Date(o.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    tr.innerHTML = `
      <td>${time}</td>
      <td>${o.symbol}</td>
      <td><span class="badge ${o.side}">${o.side}</span></td>
      <td>${o.filledQuantity}</td>
      <td>${fmtUSD(o.averageFillPrice)}</td>
      <td class="${o.status === "filled" ? "positive" : "neutral"}">${o.status}</td>
    `;
    body.appendChild(tr);
  }
}

function renderChart() {
  const ctx = document.getElementById("pnlChart").getContext("2d");
  if (chart) {
    chart.data.labels = STATE.labels;
    chart.data.datasets[0].data = STATE.pnlHistory;
    chart.update();
    return;
  }
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: STATE.labels,
      datasets: [{
        label: "PnL Journalier (USD)",
        data: STATE.pnlHistory,
        borderColor: "#38bdf8",
        backgroundColor: "rgba(56, 189, 248, 0.1)",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.4,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { grid: { color: "#111827" }, ticks: { color: "#64748b" } },
      },
    },
  });
}

async function init() {
  try {
    const [status, portfolio, positions, orders] = await Promise.all([
      fetchJSON("/api/v1/status"),
      fetchJSON("/api/v1/portfolio"),
      fetchJSON("/api/v1/positions"),
      fetchJSON("/api/v1/orders"),
    ]);

    els.modeVal.textContent = status.mode === "live" ? " Live Trading" : " Paper Trading";
    els.modeVal.className = status.mode === "live" ? "negative" : "positive";

    renderState({ portfolio, positions, orders });
  } catch (e) {
    console.error("Init error", e);
  }

  // Formulaire d'ordre
  const form = document.getElementById("orderForm");
  const msg = document.getElementById("orderMsg");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const symbol = document.getElementById("orderSymbol").value.trim();
      const side = document.getElementById("orderSide").value;
      const qty = parseInt(document.getElementById("orderQty").value, 10);
      if (!symbol || !qty || qty <= 0) {
        msg.textContent = "Symbole et quantité requis";
        msg.style.color = "#ef4444";
        return;
      }
      msg.textContent = "Envoi…";
      msg.style.color = "#94a3b8";
      try {
        const res = await fetch("/api/v1/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, side, quantity: qty }),
        });
        const data = await res.json();
        if (data.ok) {
          msg.textContent = `Ordre placé: ${data.orderId} (qty ${data.filledQuantity}, ${fmtUSD(data.price)})`;
          msg.style.color = "#22c55e";
          form.reset();
          document.getElementById("orderSymbol").value = symbol;
        } else {
          msg.textContent = `Erreur: ${data.error}`;
          msg.style.color = "#ef4444";
        }
      } catch (err) {
        msg.textContent = "Erreur réseau";
        msg.style.color = "#ef4444";
      }
      setTimeout(() => { msg.textContent = ""; }, 6000);
    });
  }

  connectWebSocket();
}

init();
