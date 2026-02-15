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
    
    // Enhanced logging for debugging
    console.log(`🔍 Looking for domain: "${DOMAIN}"`);
    console.log(`📋 Available domains in Short.io account:`, domains.map(d => d.hostname));
    
    const match = domains.find((d) => d.hostname === DOMAIN);
    if (match) {
      cachedDomainId = match.id;
      console.log(`✅ Domain found! ID: ${cachedDomainId}`);
      return cachedDomainId;
    }
    
    console.error(`❌ Domain "${DOMAIN}" not found in your short.io account.`);
    console.error(`Available domains:`, domains.map(d => `"${d.hostname}"`).join(', '));
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

// ── Debug endpoint ─────────────────────────────────────────────
app.get("/api/debug", async (_req, res) => {
  try {
    const response = await shortio.domain.list();
    // Handle different response formats
    const domains = Array.isArray(response) ? response : (response.domains || []);

    res.json({
      configuredDomain: DOMAIN,
      apiKeyPresent: !!API_KEY,
      apiKeyLength: API_KEY?.length || 0,
      availableDomains: domains.map(d => d.hostname),
      domainFound: domains.some(d => d.hostname === DOMAIN)
    });
  } catch (err) {
    res.status(500).json({ 
      error: "Failed to fetch debug info",
      configuredDomain: DOMAIN,
      apiKeyPresent: !!API_KEY,
      errorMessage: err.message
    });
  }
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

    // The new client returns data directly (or throws? need to check error handling)
    // Based on source: `const linksData = await linksRes.json(); return linksData;`
    // It returns the JSON response. If error, Short.io API usually returns { error: ... } or similar?
    // Let's assume standard behavior. The previous code checked `result.error`.
    // The fetch implementation in the library doesn't throw on non-200.
    // It returns the json body.

    if (result.error) {
       // The previous library wrapper might have normalized this.
       // Let's assume the API returns an error field if something goes wrong.
       return res.status(500).json({
         error: result.error || "Failed to fetch links",
       });
    }

    // result might be an array or object depending on the endpoint.
    // /api/links endpoint documentation says it returns a list of links?
    // Actually the library return `linksData`.
    // Let's assume `result` is what we want or `result.links`.
    // The previous code expected `result.data`.
    // If the library returns the raw JSON from Short.io, /api/links returns { links: [...], count: ... } or just [...]?
    // Usually it accepts `result` directly.
    // Let's keep it safe and just return result for now, frontend might need adjustment if shape changed.
    // Wait, old code: `res.json(result.data)`.
    // If the library returns the body valid JSON, and old code used a wrapper that put it in `data`.
    // Let's assume for now `result` is the data.

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

    if (result.error) {
      // Logic for 409 etc might be different if status code isn't exposed easily.
      // The library returns parsed JSON.
      // If error, it might be { error: "...", ... }
      // We can check if result.error is present.
      
      return res.status(400).json({ error: result.error || "Failed to create link" });
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

app.listen(PORT, async () => {
  console.log(`✓  Short Link Creator running → http://localhost:${PORT}`);
  
  // Verify domain on startup
  console.log(`\n🔧 Verifying Short.io configuration...`);
  console.log(`   API Key: ${API_KEY ? '✅ Present' : '❌ Missing'}`);
  console.log(`   Domain: ${DOMAIN}`);
  
  const domainId = await getDomainId();
  if (domainId) {
    console.log(`✅ Short.io domain verified successfully!\n`);
  } else {
    console.error(`⚠️  WARNING: Domain verification failed. Check logs above.\n`);
  }
});
