const STATE = { pnlHistory: [], labels: [], ws: null, tickerData: {} };

const els = {
  modeChip: document.getElementById("modeChip"),
  wsChip: document.getElementById("wsChip"),
  clockChip: document.getElementById("clockChip"),
  totalValue: document.getElementById("totalValue"),
  cash: document.getElementById("cash"),
  unrealizedPnl: document.getElementById("unrealizedPnl"),
  realizedPnl: document.getElementById("realizedPnl"),
  dailyPnl: document.getElementById("dailyPnl"),
  qsPositions: document.getElementById("qsPositions"),
  positionsBody: document.querySelector("#positionsTable tbody"),
  ordersBody: document.querySelector("#ordersTable tbody"),
  positionsEmpty: document.getElementById("positionsEmpty"),
  ordersEmpty: document.getElementById("ordersEmpty"),
  orderMsg: document.getElementById("orderMsg"),
  ticker: document.getElementById("ticker"),
};

let chart = null;

function fmtUSD(n) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD" }).format(n ?? 0);
}

function clsPnl(n) {
  if (n > 0) return "pos";
  if (n < 0) return "neg";
  return "neu";
}

function clsBadge(side) {
  return side === "buy" ? "buy" : "sell";
}

function clsStatus(s) {
  if (s === "filled") return "status-filled";
  if (s === "pending") return "status-pending";
  if (s === "rejected") return "status-rejected";
  return "status-pending";
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
    els.wsChip.textContent = "● WS LIVE";
    els.wsChip.className = "stat-chip ok";
  };

  STATE.ws.onclose = () => {
    els.wsChip.textContent = "● WS DEAD";
    els.wsChip.className = "stat-chip alert";
    setTimeout(connectWebSocket, 3000);
  };

  STATE.ws.onerror = () => {
    els.wsChip.textContent = "● WS ERROR";
    els.wsChip.className = "stat-chip alert";
  };

  STATE.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "state") {
        renderState(msg);
        updateTicker(msg);
      }
    } catch (e) {
      console.warn("WS parse error", e);
    }
  };
}

function updateTicker(data) {
  const { positions, orders } = data;
  const syms = new Set();

  positions.forEach((p) => syms.add(p.symbol));
  orders.forEach((o) => syms.add(o.symbol));

  const items = [];
  syms.forEach((sym) => {
    const pos = positions.find((p) => p.symbol === sym);
    const price = pos ? pos.currentPrice : 0;
    const change = pos ? ((pos.unrealizedPnl / (pos.averageEntryPrice * pos.quantity)) * 100) : 0;
    const cls = change >= 0 ? "ticker-up" : "ticker-down";
    const sign = change >= 0 ? "+" : "";
    items.push(
      `<span class="ticker-sym">${sym}</span>` +
      `<span class="${cls}">${fmtUSD(price)} ${sign}${change.toFixed(2)}%</span>`
    );
  });

  if (items.length) {
    els.ticker.innerHTML = items.join("") + "   " + items.join("");
  }
}

function renderState(data) {
  const { portfolio, positions, orders } = data;

  // Header stats
  els.totalValue.textContent = fmtUSD(portfolio.totalValue);
  els.cash.textContent = fmtUSD(portfolio.cash);
  els.unrealizedPnl.textContent = fmtUSD(portfolio.unrealizedPnl);
  els.unrealizedPnl.className = `val ${clsPnl(portfolio.unrealizedPnl)}`;
  els.realizedPnl.textContent = fmtUSD(portfolio.realizedPnl);
  els.realizedPnl.className = `val ${clsPnl(portfolio.realizedPnl)}`;
  els.dailyPnl.textContent = fmtUSD(portfolio.dailyPnl);
  els.dailyPnl.className = `val ${clsPnl(portfolio.dailyPnl)}`;
  els.qsPositions.textContent = positions ? positions.length : 0;

  // Clock
  const now = new Date();
  els.clockChip.textContent = now.toLocaleTimeString("fr-FR", { hour12: false });

  // Chart history
  STATE.pnlHistory.push(portfolio.dailyPnl);
  STATE.labels.push(now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  if (STATE.pnlHistory.length > 60) {
    STATE.pnlHistory.shift();
    STATE.labels.shift();
  }
  renderChart();

  // Positions table
  const pBody = els.positionsBody;
  pBody.innerHTML = "";
  if (!positions || positions.length === 0) {
    els.positionsEmpty.classList.remove("hidden");
  } else {
    els.positionsEmpty.classList.add("hidden");
    for (const p of positions) {
      const tr = document.createElement("tr");
      const pnlCls = clsPnl(p.unrealizedPnl);
      tr.innerHTML = `
        <td>${p.symbol}</td>
        <td><span class="badge ${clsBadge(p.side)}">${p.side}</span></td>
        <td>${p.quantity}</td>
        <td>${fmtUSD(p.averageEntryPrice)}</td>
        <td>${fmtUSD(p.currentPrice)}</td>
        <td class="${pnlCls}">${fmtUSD(p.unrealizedPnl)}</td>
      `;
      pBody.appendChild(tr);
    }
  }

  // Orders table
  const oBody = els.ordersBody;
  oBody.innerHTML = "";
  const list = orders || [];
  if (list.length === 0) {
    els.ordersEmpty.classList.remove("hidden");
  } else {
    els.ordersEmpty.classList.add("hidden");
    for (const o of list.slice(0, 15).reverse()) {
      const tr = document.createElement("tr");
      const time = new Date(o.timestamp).toLocaleTimeString("fr-FR", { hour12: false });
      tr.innerHTML = `
        <td>${time}</td>
        <td>${o.symbol}</td>
        <td><span class="badge ${clsBadge(o.side)}">${o.side}</span></td>
        <td>${o.filledQuantity}</td>
        <td>${fmtUSD(o.averageFillPrice)}</td>
        <td><span class="badge ${clsStatus(o.status)}">${o.status}</span></td>
      `;
      oBody.appendChild(tr);
    }
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
        label: "Daily P&L (USD)",
        data: STATE.pnlHistory,
        borderColor: "#00ff41",
        backgroundColor: "rgba(0, 255, 65, 0.1)",
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
        y: {
          grid: { color: "#1a1a1a" },
          ticks: { color: "#666", callback: (v) => `$${v}` },
        },
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

    const isPaper = status.mode === "paper";
    els.modeChip.textContent = isPaper ? "● PAPER TRADING" : "● LIVE TRADING";
    els.modeChip.className = `stat-chip ${isPaper ? "ok" : "alert"}`;

    renderState({ portfolio, positions, orders });
  } catch (e) {
    console.error("Init error", e);
  }

  // Order form
  const form = document.getElementById("orderForm");
  const msg = document.getElementById("orderMsg");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const symbol = document.getElementById("orderSymbol").value.trim().toUpperCase();
      const side = document.getElementById("orderSide").value;
      const qty = parseInt(document.getElementById("orderQty").value, 10);
      if (!symbol || !qty || qty <= 0) {
        msg.textContent = "SYMBOL ET QTY REQUISES";
        msg.style.color = "#ff3131";
        return;
      }
      msg.textContent = "EXECUTION...";
      msg.style.color = "#ffbf00";
      try {
        const res = await fetch("/api/v1/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, side, quantity: qty }),
        });
        const data = await res.json();
        if (data.ok) {
          msg.textContent = `EXECUTE ${data.orderId} QTY ${data.filledQuantity} @ ${fmtUSD(data.price)}`;
          msg.style.color = "#00ff41";
          form.reset();
          document.getElementById("orderSymbol").value = symbol;
        } else {
          msg.textContent = `REFUSÉ: ${data.error}`;
          msg.style.color = "#ff3131";
        }
      } catch (err) {
        msg.textContent = "ERREUR RÉSEAU";
        msg.style.color = "#ff3131";
      }
      setTimeout(() => { msg.textContent = ""; }, 6000);
    });
  }

  connectWebSocket();
  setInterval(() => {
    const now = new Date();
    els.clockChip.textContent = now.toLocaleTimeString("fr-FR", { hour12: false });
  }, 1000);
}

init();
