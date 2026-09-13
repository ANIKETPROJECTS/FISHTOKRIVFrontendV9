import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startInventorySyncScheduler } from "./inventorySync";
import { SubHubModel } from "./adminDb";
import { getHubModels } from "./hubConnections";

const app = express();
const httpServer = createServer(app);

// ── sitemap.xml — registered FIRST so Vite cannot intercept it ───────────────
app.get("/sitemap.xml", async (_req, res) => {
  try {
    const DOMAIN = "https://fishtokri.com";
    const today = new Date().toISOString().split("T")[0];

    const staticUrls = [
      { loc: `${DOMAIN}/`, priority: "1.0", changefreq: "daily" },
      { loc: `${DOMAIN}/combos`, priority: "0.7", changefreq: "weekly" },
    ];

    const hubs = await SubHubModel.find({ status: "Active" }).lean() as any[];
    const categoryNames = new Set<string>();
    const productIds = new Set<string>();

    for (const hub of hubs) {
      try {
        const { Product, Category } = await getHubModels(hub.dbName);
        const [cats, prods] = await Promise.all([
          (Category as any).find({}).select("name").lean(),
          (Product as any).find({ isArchived: { $ne: true } }).select("_id").lean(),
        ]);
        (cats as any[]).forEach((c: any) => { if (c.name) categoryNames.add(c.name); });
        (prods as any[]).forEach((p: any) => productIds.add(p._id.toString()));
      } catch { /* skip unreachable hub */ }
    }

    const categoryUrls = [...categoryNames].map(name => ({
      loc: `${DOMAIN}/category/${encodeURIComponent(name)}`,
      priority: "0.8", changefreq: "weekly",
    }));
    const productUrls = [...productIds].map(id => ({
      loc: `${DOMAIN}/product/${id}`,
      priority: "0.6", changefreq: "weekly",
    }));

    const all = [...staticUrls, ...categoryUrls, ...productUrls];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${all.map(u =>
      `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    ).join("\n")}\n</urlset>`;

    res.set("Content-Type", "application/xml").send(xml);
  } catch (err) {
    console.error("[sitemap] Error:", err);
    res.status(500).send("Failed to generate sitemap");
  }
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Gzip compress all responses for faster page loads
app.use(compression());

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);
  startInventorySyncScheduler();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
