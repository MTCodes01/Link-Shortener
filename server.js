import "dotenv/config";
import crypto from "crypto";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Shortio } from "@short.io/client-node";

// ── Config ─────────────────────────────────────────────────────
const API_KEY = process.env.API_KEY;
const DOMAIN = process.env.DOMAIN;
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD;
const PORT = process.env.PORT || 3000;

const shortio = new Shortio(API_KEY);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Cache the domain ID so we only look it up once
let cachedDomainId = null;

async function getDomainId() {
  if (cachedDomainId) return cachedDomainId;
  try {
    const response = await shortio.domain.list();
    // Handle different response formats - sometimes it's an array, sometimes an object with domains property
    const domains = Array.isArray(response) ? response : (response.domains || []);
    
    const match = domains.find((d) => d.hostname === DOMAIN);
    if (match) {
      cachedDomainId = match.id;
      return cachedDomainId;
    }
    console.warn(`Domain "${DOMAIN}" not found in your short.io account.`);
    return null;
  } catch (err) {
    console.error("Failed to list domains:", err);
    return null;
  }
}

// ── Auth Helper ────────────────────────────────────────────────
const generateToken = () => {
  return crypto.createHmac("sha256", LOGIN_PASSWORD).update("shortlink-session").digest("hex");
};

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  
  if (token === generateToken()) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};

// ── Login ──────────────────────────────────────────────────────
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === LOGIN_PASSWORD) {
    return res.json({ success: true, token: generateToken() });
  }
  return res.status(401).json({ success: false, error: "Invalid password" });
});

// ── Get domain info ────────────────────────────────────────────
app.get("/api/domain", requireAuth, (_req, res) => {
  res.json({ domain: DOMAIN });
});

// ── List existing links ────────────────────────────────────────
app.get("/api/links", requireAuth, async (_req, res) => {
  try {
    const domainId = await getDomainId();
    if (!domainId) {
      return res.status(400).json({ error: `Domain "${DOMAIN}" not found in your short.io account. Check your .env DOMAIN value.` });
    }

    // New API: shortio.link.list(domainId, options)
    const result = await shortio.link.list(domainId, { limit: 150 });

    if (result.error) {
       return res.status(500).json({
         error: result.error || "Failed to fetch links",
       });
    }

    res.json(result.links || result); 
  } catch (err) {
    console.error("List links error:", err);
    res.status(500).json({ error: "Failed to fetch links" });
  }
});

// ── Create a new short link ────────────────────────────────────
app.post("/api/links", requireAuth, async (req, res) => {
  const { originalURL, path: slug, title } = req.body;

  if (!originalURL) {
    return res.status(400).json({ error: "Original URL is required" });
  }

  const options = {
    allowDuplicates: false,
  };
  if (slug) options.path = slug;
  if (title) options.title = title;

  try {
    // New API: shortio.link.create(hostname, originalURL, options)
    const result = await shortio.link.create(DOMAIN, originalURL, options);

    // If the API returns a 409 or success:false with a 409 code, forward that status
    if (result.error || result.success === false) {
      const status = result.statusCode || 400;
      return res.status(status).json({ 
        error: result.message || result.error || "Failed to create link",
        statusCode: status,
        success: false
      });
    }

    res.json(result);
  } catch (err) {
    console.error("Create link error:", err);
    res.status(500).json({ error: "Server error while creating link" });
  }
});

// ── SPA fallback ───────────────────────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✓  Short Link Creator running → http://localhost:${PORT}`);
});
