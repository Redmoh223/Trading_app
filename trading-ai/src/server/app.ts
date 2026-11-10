import express, { Application, Request, Response } from "express";
import cors from "cors";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";

export interface OrderRequest {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
}

export interface AppDeps {
  getPortfolio: () => any;
  getPositions: () => any;
  getOrders: () => any;
  placeOrder: (req: OrderRequest) => Promise<{ ok: boolean; orderId?: string; error?: string }>;
}

export interface AppWithWS extends Application {
  broadcast?: (data: unknown) => void;
  wss?: WebSocketServer;
}

export function createApp(deps: AppDeps): AppWithWS {
  const app = express() as AppWithWS;

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  app.get("/api/v1/status", (_req: Request, res: Response) => {
    res.json({
      status: "running",
      mode: process.env.TRADING_MODE || "paper",
      timestamp: Date.now(),
    });
  });

  app.get("/api/v1/portfolio", (_req: Request, res: Response) => {
    res.json(deps.getPortfolio());
  });

  app.get("/api/v1/positions", (_req: Request, res: Response) => {
    res.json(deps.getPositions());
  });

  app.get("/api/v1/orders", (_req: Request, res: Response) => {
    res.json(deps.getOrders());
  });

  app.post("/api/v1/orders", async (req: Request, res: Response) => {
    try {
      const { symbol, side, quantity } = req.body as OrderRequest;
      if (!symbol || !side || !quantity) {
        return res.status(400).json({ error: "Missing symbol, side, or quantity" });
      }
      const result = await deps.placeOrder({ symbol, side, quantity });
      if (result.ok) {
        res.json({ ok: true, orderId: result.orderId });
      } else {
        res.status(400).json({ ok: false, error: result.error });
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  const publicDir = path.join(__dirname, "public");
  app.use(express.static(publicDir));
  app.get("/", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: Function) => {
    res.status(500).json({ error: err.message });
  });

  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  app.broadcast = (data: unknown) => {
    const payload = JSON.stringify(data);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  };

  app.wss = wss;

  return app;
}
