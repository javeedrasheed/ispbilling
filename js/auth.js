(function () {
  const SESSION_KEY = "isp_billing_user";

  function getClient() {
    if (!window.supabase) {
      throw new Error("Supabase client library not loaded.");
    }
    const createClient =
      typeof window.supabase.createClient === "function"
        ? window.supabase.createClient
        : window.supabase.default &&
          typeof window.supabase.default.createClient === "function"
        ? window.supabase.default.createClient
        : null;
    if (!createClient) {
      throw new Error("Supabase createClient not found on global.");
    }
    if (!window.ispSupabase) {
      window.ispSupabase = createClient(
        ISP_SUPABASE_URL,
        ISP_SUPABASE_ANON_KEY
      );
    }
    return window.ispSupabase;
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function getSessionUser() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function setSessionUser(userRow) {
    const safe = {
      id: userRow.id,
      username: userRow.username,
      email: userRow.email,
      full_name: userRow.full_name,
      role: userRow.role,
      is_active: userRow.is_active
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(safe));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  async function login(username, password) {
    const client = getClient();
    const { data, error } = await client
      .from("users")
      .select("*")
      .eq("username", username)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      const msg =
        (window.ISP_MESSAGES && window.ISP_MESSAGES.auth.networkError) ||
        error.message;
      throw new Error(msg);
    }
    if (!data) {
      throw new Error(
        (window.ISP_MESSAGES && window.ISP_MESSAGES.auth.loginFailed) ||
          "Login failed"
      );
    }
    if (!data.is_active) {
      throw new Error(
        (window.ISP_MESSAGES && window.ISP_MESSAGES.auth.inactiveUser) ||
          "Inactive"
      );
    }

    const hash = await sha256Hex(password);
    if (hash !== data.password_hash) {
      throw new Error(
        (window.ISP_MESSAGES && window.ISP_MESSAGES.auth.loginFailed) ||
          "Login failed"
      );
    }

    setSessionUser(data);
    return getSessionUser();
  }

  function logout() {
    clearSession();
    window.location.href = "login.html";
  }

  function requireAuth() {
    const u = getSessionUser();
    if (!u) {
      window.location.href = "login.html";
      return null;
    }
    return u;
  }

  window.ISPAuth = {
    getClient,
    sha256Hex,
    getSessionUser,
    setSessionUser,
    clearSession,
    login,
    logout,
    requireAuth
  };

  document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("loginForm");
    if (!form) return;

    const errEl = document.getElementById("loginError");
    const btn = document.getElementById("loginSubmit");

    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      if (errEl) {
        errEl.textContent = "";
        errEl.hidden = true;
      }
      if (btn) {
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
      }

      const username = (
        document.getElementById("username") || {}
      ).value.trim();
      const password = (document.getElementById("password") || {}).value;

      try {
        await login(username, password);
        window.location.href = "index.html";
      } catch (e) {
        if (errEl) {
          errEl.textContent = e.message || "Login failed";
          errEl.hidden = false;
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.removeAttribute("aria-busy");
        }
      }
    });
  });
})();
