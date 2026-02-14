/* ── Short Link Creator — Frontend Logic ──────────────────────── */
(function () {
  "use strict";

  // ── DOM refs ─────────────────────────────────────────────────
  const loginScreen  = document.getElementById("login-screen");
  const dashScreen   = document.getElementById("dashboard-screen");
  const loginForm    = document.getElementById("login-form");
  const loginPw      = document.getElementById("login-password");
  const loginBtn     = document.getElementById("login-btn");
  const loginError   = document.getElementById("login-error");


  const logoutBtn    = document.getElementById("logout-btn");

  const createForm   = document.getElementById("create-form");
  const createBtn    = document.getElementById("create-btn");
  const originalUrl  = document.getElementById("original-url");
  const customSlug   = document.getElementById("custom-slug");
  const linkTitle    = document.getElementById("link-title");
  const resultArea   = document.getElementById("result-area");
  const resultUrl    = document.getElementById("result-url");
  const copyBtn      = document.getElementById("copy-btn");
  const createError  = document.getElementById("create-error");

  const linksList    = document.getElementById("links-list");
  const linksLoader  = document.getElementById("links-loader");
  const linksError   = document.getElementById("links-error");
  const refreshBtn   = document.getElementById("refresh-btn");

  let isLoggedIn = false;
  const storedToken = localStorage.getItem("authToken");

  if (storedToken) {
    isLoggedIn = true;
    loginScreen.classList.remove("active");
    dashScreen.classList.add("active");
    loadDomain();
    loadLinks();
  }

  // ── Helpers ──────────────────────────────────────────────────
  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.querySelector("span").textContent = loading
      ? "Please wait…"
      : btn === loginBtn ? "Log In" : "Create Short Link";
  }

  // ── Login ────────────────────────────────────────────────────
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(loginError);
    setLoading(loginBtn, true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPw.value }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        show(loginError);
        loginError.textContent = data.error || "Wrong password";
        return;
      }

      isLoggedIn = true;
      localStorage.setItem("authToken", data.token);
      loginScreen.classList.remove("active");
      dashScreen.classList.add("active");
      loadDomain();
      loadLinks();
    } catch {
      show(loginError);
      loginError.textContent = "Unable to reach server";
    } finally {
      setLoading(loginBtn, false);
    }
  });

  function performLogout() {
    isLoggedIn = false;
    localStorage.removeItem("authToken");
    dashScreen.classList.remove("active");
    loginScreen.classList.add("active");
    loginPw.value = "";
    hide(loginError);
  }

  // ── Logout ───────────────────────────────────────────────────
  logoutBtn.addEventListener("click", performLogout);

  // ── Load domain badge ────────────────────────────────────────
  async function loadDomain() {
    const titleEl = document.getElementById("app-title");
    try {
      const token = localStorage.getItem("authToken");
      const res = await fetch("/api/domain", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.status === 401) return performLogout();
      const { domain } = await res.json();
      if (titleEl) titleEl.textContent = domain;
    } catch {
      if (titleEl) titleEl.textContent = "Short Link Creator";
    }
  }

  // ── Create link ──────────────────────────────────────────────
  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(resultArea);
    hide(createError);
    setLoading(createBtn, true);

    const payload = { originalURL: originalUrl.value.trim() };
    if (customSlug.value.trim()) payload.path = customSlug.value.trim();
    if (linkTitle.value.trim()) payload.title = linkTitle.value.trim();

    try {
      const token = localStorage.getItem("authToken");
      const res = await fetch("/api/links", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.status === 401) return performLogout();
      if (!res.ok) {
        show(createError);
        createError.textContent = data.error || "Failed to create link";
        return;
      }

      // Success
      const shortUrl = data.shortURL || data.secureShortURL || `https://${data.hostname}/${data.path}`;
      resultUrl.href = shortUrl;
      resultUrl.textContent = shortUrl;
      show(resultArea);

      // Clear inputs
      originalUrl.value = "";
      customSlug.value = "";
      linkTitle.value = "";

      // Refresh links list
      loadLinks();
    } catch {
      show(createError);
      createError.textContent = "Network error — please try again";
    } finally {
      setLoading(createBtn, false);
    }
  });

  // ── Copy to clipboard ────────────────────────────────────────
  copyBtn.addEventListener("click", () => {
    const url = resultUrl.textContent;
    navigator.clipboard.writeText(url).then(() => {
      copyBtn.textContent = "✓ Copied!";
      setTimeout(() => (copyBtn.textContent = "📋 Copy"), 2000);
    });
  });

  // ── Load existing links ──────────────────────────────────────
  async function loadLinks() {
    hide(linksError);
    show(linksLoader);
    linksList.innerHTML = "";

    try {
      const token = localStorage.getItem("authToken");
      const res = await fetch("/api/links", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await res.json();

      if (res.status === 401) return performLogout();
      if (!res.ok) {
        show(linksError);
        linksError.textContent = data.error || "Failed to load links";
        return;
      }

      const links = data.links || data || [];
      if (!Array.isArray(links) || links.length === 0) {
        linksList.innerHTML = '<div class="no-links">No links found for this domain.</div>';
        return;
      }

      renderLinksTable(links);
    } catch {
      show(linksError);
      linksError.textContent = "Could not load existing links";
    } finally {
      hide(linksLoader);
    }
  }

  function renderLinksTable(links) {
    const table = document.createElement("table");
    table.innerHTML = `
      <thead>
        <tr>
          <th>Short Link</th>
          <th>Original URL</th>
          <th>Title</th>
          <th>Created</th>
        </tr>
      </thead>`;

    const tbody = document.createElement("tbody");

    links.forEach((link) => {
      const short = link.shortURL || link.secureShortURL || `${link.hostname}/${link.path}`;
      const original = link.originalURL || "—";
      const title = link.title || "—";
      const date = link.createdAt
        ? new Date(link.createdAt).toLocaleDateString("en-US", {
            month: "short", day: "numeric", year: "numeric",
          })
        : "—";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td data-label="Short Link"><a href="${short}" target="_blank">${short}</a></td>
        <td data-label="Original URL"><span class="original-url" title="${escapeHtml(original)}">${escapeHtml(original)}</span></td>
        <td data-label="Title">${escapeHtml(title)}</td>
        <td data-label="Created">${date}</td>`;
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    linksList.appendChild(table);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Refresh ──────────────────────────────────────────────────
  refreshBtn.addEventListener("click", loadLinks);
})();
