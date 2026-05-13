(function () {
  const M = window.ISP_MESSAGES || {};

  const state = {
    customers: [],
    areas: [],
    packages: [],
    discounts: [],
    paymentMethods: [],
    payments: [],
    dueCharges: [],
    paymentAllocations: [],
    currentUser: null,
    invoiceContext: null,
    payContext: null,
    dueDetailCustomerId: null,
    viewCustomerId: null,
    paymentSubmitting: false
  };

  let custExtraDueRowSeq = 0;

  function $(id) {
    return document.getElementById(id);
  }

  /** Attach listener only if element exists (avoids breaking the whole dashboard if one id is missing). */
  function onIf(id, event, handler, options) {
    const node = $(id);
    if (!node) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("ISP Billing: missing #" + id + ", skipping " + event + " listener");
      }
      return;
    }
    node.addEventListener(event, handler, options);
  }

  function toast(msg, type) {
    const root = $("toastRoot");
    if (!root) return;
    const el = document.createElement("div");
    el.className = "toast-item " + (type === "err" ? "err" : "ok");
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 4200);
  }

  function openBackdrop(el) {
    if (!el) return;
    el.removeAttribute("hidden");
    el.classList.add("open");
  }

  function closeBackdrop(el) {
    if (!el) return;
    el.classList.remove("open");
    el.setAttribute("hidden", "hidden");
  }

  function closeByDataAttr(ev) {
    const t =
      ev.target && ev.target.closest
        ? ev.target.closest("[data-close]")
        : null;
    if (!t) return;
    const id = t.getAttribute("data-close");
    if (!id) return;
    if (id === "modalDueDetail") {
      state.dueDetailCustomerId = null;
    }
    if (id === "modalCustomerView") {
      state.viewCustomerId = null;
    }
    closeBackdrop($(id));
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toISODate(d) {
    return (
      d.getFullYear() +
      "-" +
      pad2(d.getMonth() + 1) +
      "-" +
      pad2(d.getDate())
    );
  }

  function parseISODateLocal(iso) {
    if (iso == null || iso === "") return null;
    const head = String(iso).trim().slice(0, 10);
    const p = head.split("-");
    if (p.length !== 3) return null;
    const y = Number(p[0]);
    const mo = Number(p[1]);
    const day = Number(p[2]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day)) return null;
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    const d = new Date(y, mo - 1, day, 12, 0, 0, 0);
    if (isNaN(d.getTime())) return null;
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
    return d;
  }

  /**
   * Adds one calendar month to the given date (local), preserving day-of-month when possible.
   * Business rule: same calendar date next month; time normalized to 12:00 locally (DATE column stores date only).
   */
  function addOneCalendarMonthDate(isoDateStr) {
    const d = parseISODateLocal(isoDateStr);
    if (!d) return null;
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();
    let nm = m + 1;
    let ny = y;
    if (nm > 11) {
      nm = 0;
      ny += 1;
    }
    const lastNext = new Date(ny, nm + 1, 0).getDate();
    const nd = Math.min(day, lastNext);
    return new Date(ny, nm, nd, 12, 0, 0, 0);
  }

  function monthTokenFromDate(d) {
    const months = [
      "JANUARY",
      "FEBRUARY",
      "MARCH",
      "APRIL",
      "MAY",
      "JUNE",
      "JULY",
      "AUGUST",
      "SEPTEMBER",
      "OCTOBER",
      "NOVEMBER",
      "DECEMBER"
    ];
    return months[d.getMonth()] + " " + d.getFullYear();
  }

  /** Invoice recharge line: calendar month of the given date (e.g. 15 May → RECHARGE MAY 2026). */
  function rechargeMonthLabelFromDate(iso) {
    const d = parseISODateLocal(iso);
    if (!d) return "RECHARGE " + monthTokenFromDate(new Date());
    return "RECHARGE " + monthTokenFromDate(d);
  }

  /** Strip leading "RECHARGE " for invoice display (e.g. RECHARGE MAY 2026 → MAY 2026). */
  function rechargeMonthDisplayForInvoice(rm) {
    if (rm == null || rm === "") return "—";
    const s = String(rm).trim();
    const t = s.replace(/^RECHARGE\s+/i, "").trim();
    return t || s;
  }

  /** Accrual receipt: month line from payment/recharge date (same source as "Recharge date"). */
  function invoiceAccrualRechargeMonthDisplay(ctx) {
    if (ctx.kind !== "receipt" || ctx.paymentMode !== "accrual" || !ctx.paymentDate) {
      return "";
    }
    const iso = String(ctx.paymentDate).trim().slice(0, 10);
    if (!parseISODateLocal(iso)) return "";
    return rechargeMonthDisplayForInvoice(rechargeMonthLabelFromDate(iso));
  }

  /** Period / recharge month cell on invoices. */
  function invoiceRechargeMonthPeriod(ctx) {
    const acc = invoiceAccrualRechargeMonthDisplay(ctx);
    if (acc) return acc;
    if (ctx.kind === "receipt" && ctx.rechargeMonth) {
      return rechargeMonthDisplayForInvoice(ctx.rechargeMonth);
    }
    return "—";
  }

  /** New package expiry = same calendar day, next month (e.g. 12 May → 12 Jun). */
  function packageExpiryFromRechargeIso(iso) {
    const next = addOneCalendarMonthDate(iso);
    return next ? toISODate(next) : "";
  }

  function syncPayNewExpiryFromRecharge() {
    const prd = $("payRechargeDate");
    const pned = $("payNewExpiryDate");
    if (!prd || !pned) return;
    const raw = String(prd.value || "").trim();
    if (!raw) {
      pned.value = "";
      return;
    }
    pned.value = packageExpiryFromRechargeIso(raw);
  }

  function wireAccrualRechargeDateSync() {
    const prd = $("payRechargeDate");
    if (!prd) return;
    prd.addEventListener("input", syncPayNewExpiryFromRecharge);
    prd.addEventListener("change", syncPayNewExpiryFromRecharge);
  }

  function todayISODate() {
    const n = new Date();
    return toISODate(new Date(n.getFullYear(), n.getMonth(), n.getDate()));
  }

  function daysBetweenISO(fromIso, toIso) {
    const a = parseISODateLocal(fromIso);
    const b = parseISODateLocal(toIso);
    if (!a || !b) return null;
    const ms = b.getTime() - a.getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }

  function formatPKR(n) {
    const x = Number(n || 0);
    return (
      "PKR " +
      x.toLocaleString("en-PK", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      })
    );
  }

  function roundMoney(n) {
    return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
  }

  function formatDisplayDate(iso) {
    if (!iso) return "—";
    const s = String(iso).trim();
    const p = s.split("-");
    if (p.length === 3 && p[0].length === 4) {
      const y = parseInt(p[0], 10);
      const m = parseInt(p[1], 10) - 1;
      const d = parseInt(p[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        const dt = new Date(y, m, d);
        if (
          dt.getFullYear() === y &&
          dt.getMonth() === m &&
          dt.getDate() === d
        ) {
          const months = [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec"
          ];
          return (
            pad2(dt.getDate()) + " " + months[dt.getMonth()] + " " + dt.getFullYear()
          );
        }
      }
    }
    const ms = Date.parse(s);
    if (!isNaN(ms)) {
      const dt = new Date(ms);
      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec"
      ];
      return (
        pad2(dt.getDate()) + " " + months[dt.getMonth()] + " " + dt.getFullYear()
      );
    }
    return s;
  }

  function parseFlexibleDateForImport(s) {
    if (!s || !String(s).trim()) return null;
    const t = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const ms = Date.parse(t);
    if (!isNaN(ms)) {
      const x = new Date(ms);
      return toISODate(new Date(x.getFullYear(), x.getMonth(), x.getDate()));
    }
    const m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (m) {
      const mon = m[2].toLowerCase().slice(0, 3);
      const map = {
        jan: 0,
        feb: 1,
        mar: 2,
        apr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        aug: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dec: 11
      };
      const mo = map[mon];
      if (mo === undefined) return null;
      const d = parseInt(m[1], 10);
      const y = parseInt(m[3], 10);
      return toISODate(new Date(y, mo, d));
    }
    const slash = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (slash) {
      const d = parseInt(slash[1], 10);
      const mo = parseInt(slash[2], 10) - 1;
      const y = parseInt(slash[3], 10);
      if (mo >= 0 && mo <= 11 && d >= 1 && d <= 31) {
        return toISODate(new Date(y, mo, d));
      }
    }
    return null;
  }

  function parseCsvLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQ = false;
          }
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ",") {
          out.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
    }
    out.push(cur.trim());
    return out;
  }

  function normalizeImportKey(h) {
    return String(h || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
  }

  function findAreaIdForImport(name) {
    if (!name || !String(name).trim()) return null;
    const n = String(name).trim();
    for (let i = 0; i < state.areas.length; i++) {
      const a = state.areas[i];
      if (a.area_name === n) return a.id;
      if (areaLabelTree(a) === n) return a.id;
    }
    return null;
  }

  function findPackageIdForImport(name) {
    if (!name || !String(name).trim()) return null;
    const n = String(name).trim();
    const p = state.packages.find(function (x) {
      return x.package_name === n;
    });
    return p ? p.id : null;
  }

  async function importCustomersFromCsvText(text) {
    const lines = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .filter(function (ln) {
        return ln.trim().length > 0;
      });
    if (lines.length < 2) {
      toast("CSV needs a header row and at least one data row.", "err");
      return;
    }
    const headers = parseCsvLine(lines[0]).map(normalizeImportKey);
    const idx = {};
    headers.forEach(function (h, j) {
      idx[h] = j;
    });
    const uidCol =
      idx.user_id !== undefined
        ? idx.user_id
        : idx.pppoe_id !== undefined
        ? idx.pppoe_id
        : idx.pppoe !== undefined
        ? idx.pppoe
        : undefined;
    if (uidCol === undefined) {
      toast(
        "CSV must include a user_id column (or pppoe_id for older export files).",
        "err"
      );
      return;
    }
    const sb = getClient();
    let ok = 0;
    let fail = 0;
    const errs = [];
    for (let r = 1; r < lines.length; r++) {
      const cols = parseCsvLine(lines[r]);
      if (!cols.length || !cols[uidCol]) continue;
      const get = function (key, def) {
        const i = idx[key];
        if (i === undefined || i >= cols.length) return def;
        const v = cols[i];
        return v === "" || v == null ? def : v;
      };
      const pppoe_id = String(cols[uidCol] || "").trim();
      const full_name = String(get("full_name", "")).trim();
      const packageName = String(
        get("package", get("package_name", ""))
      ).trim();
      const pkgId = findPackageIdForImport(packageName);
      if (!pppoe_id || !full_name || !pkgId) {
        fail++;
        errs.push(
          "Row " +
            (r + 1) +
            ": missing user_id / name, or unknown package name."
        );
        continue;
      }
      const areaName = String(get("area", get("area_name", ""))).trim();
      const areaId = areaName ? findAreaIdForImport(areaName) : null;
      if (areaName && !areaId) {
        fail++;
        errs.push("Row " + (r + 1) + ": unknown area '" + areaName + "'.");
        continue;
      }
      const row = {
        pppoe_id: pppoe_id,
        full_name: full_name,
        phone: get("phone", null) || null,
        email: get("email", null) || null,
        area_id: areaId,
        address: get("address", null) || null,
        package_id: pkgId,
        installation_date:
          parseFlexibleDateForImport(get("installation_date", "")) || null,
        package_expiry_date:
          parseFlexibleDateForImport(get("package_expiry_date", "")) || null,
        due_amount: Number(get("due_amount", 0) || 0),
        individual_discount_type: String(
          get("individual_discount_type", "none") || "none"
        ).toLowerCase(),
        individual_discount_value: Number(
          get("individual_discount_value", 0) || 0
        ),
        status: String(get("status", "active") || "active").toLowerCase()
      };
      if (
        ["none", "percentage", "fixed"].indexOf(row.individual_discount_type) ===
        -1
      ) {
        row.individual_discount_type = "none";
      }
      if (["active", "expired", "inactive"].indexOf(row.status) === -1) {
        row.status = "active";
      }
      if (!row.package_expiry_date) {
        if (row.installation_date) {
          const nd = addOneCalendarMonthDate(row.installation_date);
          row.package_expiry_date = nd ? toISODate(nd) : row.installation_date;
        } else {
          const nd = addOneCalendarMonthDate(todayISODate());
          row.package_expiry_date = nd ? toISODate(nd) : todayISODate();
        }
      }
      const res = await sb.from("customers").insert(row);
      if (res.error) {
        fail++;
        errs.push("Row " + (r + 1) + " (" + pppoe_id + "): " + res.error.message);
      } else {
        ok++;
      }
    }
    const summary =
      "Imported " + ok + " customer(s)." + (fail ? " " + fail + " row(s) failed." : "");
    toast(summary + (errs.length ? " Check the browser console for row errors." : ""), fail ? "err" : "ok");
    if (errs.length) {
      console.warn(errs.join("\n"));
    }
    await refresh();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function csvEscape(v) {
    const t = String(v == null ? "" : v);
    if (/[",\n]/.test(t)) return '"' + t.replace(/"/g, '""') + '"';
    return t;
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function getClient() {
    if (!window.ISPAuth) throw new Error("Auth not loaded");
    return window.ISPAuth.getClient();
  }

  function areaById(id) {
    return state.areas.find(function (a) {
      return a.id === id;
    });
  }

  function packageById(id) {
    return state.packages.find(function (p) {
      return p.id === id;
    });
  }

  /**
   * Area+package discount for a customer's location: match their area first,
   * then walk up parent areas so sub-areas inherit discounts on the main area.
   */
  function resolveAreaPackageDiscount(areaId, packageId) {
    if (!areaId || !packageId) return null;
    let aid = areaId;
    const seen = {};
    while (aid && !seen[aid]) {
      seen[aid] = true;
      const row = state.discounts.find(function (d) {
        return d.area_id === aid && d.package_id === packageId;
      });
      if (row) return row;
      const a = areaById(aid);
      aid = a && a.parent_area_id ? a.parent_area_id : null;
    }
    return null;
  }

  function discountAmountOnBase(base, rule) {
    if (!rule) return 0;
    const v = Number(rule.discount_value || 0);
    if (rule.discount_type === "percentage") {
      return Math.round(((base * v) / 100) * 100) / 100;
    }
    return Math.min(base, v);
  }

  function computeMonthlyPricing(customer) {
    const pkg = customer.packages;
    const base = pkg ? Number(pkg.price) : 0;
    const areaRule = customer.area_id
      ? resolveAreaPackageDiscount(customer.area_id, customer.package_id)
      : null;
    const indType = customer.individual_discount_type || "none";
    const indVal = Number(customer.individual_discount_value || 0);

    const areaAmount = discountAmountOnBase(base, areaRule);

    let indAmount = 0;
    if (indType === "percentage") {
      indAmount = Math.round(((base * indVal) / 100) * 100) / 100;
    } else if (indType === "fixed") {
      indAmount = Math.min(base, indVal);
    }

    const rawTotal = areaAmount + indAmount;
    const totalDiscount = Math.min(base, rawTotal);
    const finalMonthly = Math.max(0, base - totalDiscount);

    let appliedSource = "none";
    if (areaAmount > 0 && indType !== "none" && indAmount > 0) {
      appliedSource = "area + individual";
    } else if (areaAmount > 0) {
      appliedSource = "area";
    } else if (indType !== "none" && indAmount > 0) {
      appliedSource = "individual";
    }

    return {
      base: base,
      areaRule: areaRule,
      areaAmount: areaAmount,
      indType: indType,
      indVal: indVal,
      indAmount: indAmount,
      appliedSource: appliedSource,
      appliedAmount: totalDiscount,
      totalDiscount: totalDiscount,
      finalMonthly: finalMonthly
    };
  }

  function allocatePayment(paid, due0, monthly) {
    const P = Number(paid || 0);
    const due = Number(due0 || 0);
    const mon = Number(monthly || 0);
    let remaining = P;
    const towardDue = Math.min(remaining, Math.max(0, due));
    remaining -= towardDue;
    const towardMon = Math.min(remaining, mon);
    const newDue = due + mon - P;
    const fullMonthPaid = mon > 0 && towardMon >= mon - 0.0001;
    return {
      newDue: roundMoney(newDue),
      fullMonthPaid: fullMonthPaid,
      towardDue: towardDue,
      towardMon: towardMon,
      grand: due + mon
    };
  }

  function nextInvoiceNumber() {
    const d = new Date();
    const stamp =
      d.getFullYear() +
      pad2(d.getMonth() + 1) +
      pad2(d.getDate()) +
      pad2(d.getHours()) +
      pad2(d.getMinutes());
    const rnd = String(Math.floor(Math.random() * 9000) + 1000);
    return "INV-" + stamp + "-" + rnd;
  }

  function areaLabelTree(a) {
    if (!a) return "";
    if (!a.parent_area_id) return a.area_name;
    const p = areaById(a.parent_area_id);
    return (p ? p.area_name + " › " : "") + a.area_name;
  }

  /** Labels for invoice: main area + sub-area when customer is under a sub-area. */
  function areaMainSubForInvoice(c) {
    const a = c && c.areas;
    if (!a) return { main: "—", sub: "—" };
    if (!a.parent_area_id) {
      return { main: a.area_name || "—", sub: "—" };
    }
    const p = areaById(a.parent_area_id);
    return {
      main: (p && p.area_name) || "—",
      sub: a.area_name || "—"
    };
  }

  function buildAreaOptions(selectEl, includeBlank) {
    if (!selectEl) return;
    const mains = state.areas.filter(function (x) {
      return !x.parent_area_id;
    });
    const subs = state.areas.filter(function (x) {
      return x.parent_area_id;
    });
    const opts = [];
    if (includeBlank) {
      opts.push('<option value="">— Select —</option>');
    }
    mains.forEach(function (m) {
      opts.push(
        '<option value="' +
          escapeHtml(m.id) +
          '">' +
          escapeHtml(m.area_name) +
          "</option>"
      );
      subs
        .filter(function (s) {
          return s.parent_area_id === m.id;
        })
        .forEach(function (s) {
          opts.push(
            '<option value="' +
              escapeHtml(s.id) +
              '">' +
              escapeHtml(m.area_name + " › " + s.area_name) +
              "</option>"
          );
        });
    });
    selectEl.innerHTML = opts.join("");
  }

  function buildSubAreaOptions(selectEl, includeBlank) {
    if (!selectEl) return;
    const subs = state.areas
      .filter(function (x) {
        return x.parent_area_id;
      })
      .sort(function (a, b) {
        return areaLabelTree(a).localeCompare(areaLabelTree(b));
      });
    const opts = [];
    if (includeBlank) {
      opts.push('<option value="">— Select sub-area —</option>');
    }
    if (!subs.length) {
      opts.push('<option value="" disabled>Create a sub-area first</option>');
    }
    subs.forEach(function (s) {
      opts.push(
        '<option value="' +
          escapeHtml(s.id) +
          '">' +
          escapeHtml(areaLabelTree(s)) +
          "</option>"
      );
    });
    selectEl.innerHTML = opts.join("");
  }

  function buildParentAreaOptions(selectEl) {
    if (!selectEl) return;
    const mains = state.areas.filter(function (x) {
      return !x.parent_area_id;
    });
    const opts = ['<option value="">— None (main area) —</option>'];
    mains.forEach(function (m) {
      opts.push(
        '<option value="' +
          escapeHtml(m.id) +
          '">' +
          escapeHtml(m.area_name) +
          "</option>"
      );
    });
    selectEl.innerHTML = opts.join("");
  }

  function buildPackageOptions(selectEl, includeBlank) {
    if (!selectEl) return;
    const rows = state.packages.filter(function (p) {
      return p.is_active !== false;
    });
    const opts = [];
    if (includeBlank) opts.push('<option value="">— Select —</option>');
    rows.forEach(function (p) {
      opts.push(
        '<option value="' +
          escapeHtml(p.id) +
          '">' +
          escapeHtml(p.package_name + " — " + p.speed_mbps + " Mbps") +
          "</option>"
      );
    });
    selectEl.innerHTML = opts.join("");
  }

  function buildPaymentMethodOptions(selectEl) {
    if (!selectEl) return;
    const rows = state.paymentMethods.filter(function (m) {
      return m.is_active !== false;
    });
    selectEl.innerHTML = rows
      .map(function (m) {
        return (
          '<option value="' +
          escapeHtml(m.id) +
          '">' +
          escapeHtml(m.method_name) +
          "</option>"
        );
      })
      .join("");
  }

  const DUE_CATEGORY_LABELS = {
    monthly_recharge: "Monthly recharge (accrual)",
    installation: "Installation cost",
    misc: "Miscellaneous",
    monthly_manual: "Monthly / service (manual)",
    legacy_carry: "Balance (unsplit)",
    other: "Other"
  };

  function dueCategoryLabel(key) {
    return DUE_CATEGORY_LABELS[key] || key || "Other";
  }

  function collectCustExtraDueRows() {
    const tb = $("custExtraDueRows");
    if (!tb) return [];
    const out = [];
    tb.querySelectorAll("tr").forEach(function (tr) {
      const sel = tr.querySelector(".cust-extra-due-cat");
      const amtEl = tr.querySelector(".cust-extra-due-amt");
      const monEl = tr.querySelector(".cust-extra-due-month");
      const noteEl = tr.querySelector(".cust-extra-due-notes");
      const amt = Number(amtEl && amtEl.value);
      if (!(amt > 0)) return;
      out.push({
        category: (sel && sel.value) || "other",
        amount: amt,
        recharge_month: monEl && monEl.value.trim() ? monEl.value.trim() : null,
        notes: noteEl && noteEl.value.trim() ? noteEl.value.trim() : null
      });
    });
    return out;
  }

  function updateCustExtraDueRemoveButtons() {
    const tb = $("custExtraDueRows");
    if (!tb) return;
    const rows = tb.querySelectorAll("tr");
    const n = rows.length;
    rows.forEach(function (tr) {
      const btn = tr.querySelector(".cust-extra-due-del");
      if (btn) {
        btn.style.visibility = "visible";
        btn.title = n <= 1 ? "Clear row" : "Remove row";
        btn.setAttribute("aria-label", n <= 1 ? "Clear row" : "Remove row");
      }
    });
  }

  function addCustExtraDueRow(prefill) {
    const tb = $("custExtraDueRows");
    if (!tb) return;
    custExtraDueRowSeq += 1;
    const cats = ["installation", "misc", "monthly_manual", "other"];
    const opts = cats
      .map(function (k) {
        const sel =
          prefill && prefill.category === k ? ' selected="selected"' : "";
        return (
          '<option value="' +
          escapeHtml(k) +
          '"' +
          sel +
          ">" +
          escapeHtml(dueCategoryLabel(k)) +
          "</option>"
        );
      })
      .join("");
    const amt =
      prefill && prefill.amount != null && prefill.amount !== ""
        ? escapeHtml(String(prefill.amount))
        : "";
    const mo =
      prefill && prefill.recharge_month
        ? escapeHtml(prefill.recharge_month)
        : "";
    const no = prefill && prefill.notes ? escapeHtml(prefill.notes) : "";
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td><select class="cust-extra-due-cat">' +
      opts +
      '</select></td><td><input class="cust-extra-due-amt" type="number" step="0.01" min="0" placeholder="0" value="' +
      amt +
      '" /></td><td><input type="text" class="cust-extra-due-month" placeholder="Period label" value="' +
      mo +
      '" /></td><td><input type="text" class="cust-extra-due-notes" placeholder="Notes" value="' +
      no +
      '" /></td><td class="no-print"><button type="button" class="btn danger cust-extra-due-del" title="Remove row" aria-label="Remove row"><i class="fa-solid fa-minus" aria-hidden="true"></i></button></td>';
    tb.appendChild(tr);
    updateCustExtraDueRemoveButtons();
  }

  function initCustExtraDueRows() {
    const tb = $("custExtraDueRows");
    if (!tb) return;
    tb.innerHTML = "";
    addCustExtraDueRow();
  }

  async function insertExtraDueLines(sb, customerId, lines) {
    if (!lines.length) return null;
    for (var i = 0; i < lines.length; i++) {
      const L = lines[i];
      const ins = await sb
        .from("customer_due_charges")
        .insert({
          customer_id: customerId,
          amount: L.amount,
          amount_remaining: L.amount,
          category: L.category || "other",
          recharge_month: L.recharge_month || null,
          notes: L.notes || null
        })
        .select();
      if (ins.error) return ins.error.message;
      if (ins.data && ins.data[0]) state.dueCharges.push(ins.data[0]);
    }
    try {
      await recalcCustomerDueFromLedger(sb, customerId);
    } catch (e) {
      return e.message || "Could not update customer balance.";
    }
    return null;
  }

  function dueChargesForCustomer(customerId) {
    return state.dueCharges.filter(function (x) {
      return x.customer_id === customerId;
    });
  }

  function compareDueChargeCreatedAsc(a, b) {
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  }

  function compareDueChargeCreatedDesc(a, b) {
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  }

  /** All ledger lines for statements: monthly recharges first (oldest first), then other charges. */
  function sortedStatementChargeLists(customerId) {
    const all = dueChargesForCustomer(customerId);
    const monthly = all
      .filter(function (x) {
        return x.category === "monthly_recharge";
      })
      .sort(compareDueChargeCreatedAsc);
    const other = all
      .filter(function (x) {
        return x.category !== "monthly_recharge";
      })
      .sort(compareDueChargeCreatedAsc);
    return { monthly: monthly, other: other };
  }

  function dueLineAmounts(ch) {
    const orig = Number(ch.amount || 0);
    const rem = Number(
      ch.amount_remaining != null && ch.amount_remaining !== ""
        ? ch.amount_remaining
        : ch.amount || 0
    );
    const paid = Math.max(0, orig - rem);
    return { orig: orig, paid: paid, rem: rem };
  }

  /** Allocations toward this customer's ledger lines (requires payment + charge in state). */
  function paymentApplicationsForCustomer(customerId) {
    const byChargeId = {};
    dueChargesForCustomer(customerId).forEach(function (ch) {
      byChargeId[ch.id] = ch;
    });
    const list = [];
    (state.paymentAllocations || []).forEach(function (a) {
      const ch = byChargeId[a.due_charge_id];
      if (!ch) return;
      const pay = state.payments.find(function (p) {
        return p.id === a.payment_id;
      });
      if (!pay) return;
      list.push({ allocation: a, payment: pay, charge: ch });
    });
    list.sort(function (x, y) {
      const da = paymentDateISO(x.payment) || "";
      const db = paymentDateISO(y.payment) || "";
      if (da !== db) return da.localeCompare(db);
      return String(x.payment.id).localeCompare(String(y.payment.id));
    });
    return list;
  }

  function groupAllocationsByPayment(sortedAppRows) {
    const out = [];
    let g = null;
    sortedAppRows.forEach(function (r) {
      if (!g || g.payment.id !== r.payment.id) {
        g = { payment: r.payment, lines: [] };
        out.push(g);
      }
      g.lines.push(r);
    });
    return out;
  }

  function dueChargeLineLabel(ch) {
    if (ch.category === "monthly_recharge" && ch.recharge_month) {
      return rechargeMonthDisplayForInvoice(ch.recharge_month);
    }
    return dueCategoryLabel(ch.category);
  }

  function dueChargeNotesForDisplay(notes) {
    if (!notes) return "";
    return String(notes)
      .replace(/\bnew\s+expiry\b/gi, "expiry")
      .slice(0, 220);
  }

  /** First column on due statement (amounts shown in their own columns). */
  function dueChargeStatementLabelHtml(ch) {
    let desc = "<strong>" + escapeHtml(dueChargeLineLabel(ch)) + "</strong>";
    if (ch.notes) {
      desc +=
        "<br/><span class=\"muted\">" +
        escapeHtml(dueChargeNotesForDisplay(ch.notes)) +
        "</span>";
    }
    return desc;
  }

  function appendDueStatementDetailRows(lines, customerId) {
    const c = state.customers.find(function (x) {
      return x.id === customerId;
    });
    const totalDue = c ? Number(c.due_amount || 0) : 0;
    const lists = sortedStatementChargeLists(customerId);
    const hasLines = lists.monthly.length + lists.other.length > 0;
    let sumOrig = 0;
    let sumPaidLine = 0;
    let sumRem = 0;

    function emitChargeRow(ch) {
      const am = dueLineAmounts(ch);
      sumOrig += am.orig;
      sumPaidLine += am.paid;
      sumRem += am.rem;
      lines.push(
        "<tr><td>" +
          dueChargeStatementLabelHtml(ch) +
          "</td><td class=\"td-num\">" +
          formatPKR(am.orig) +
          "</td><td class=\"td-num\">" +
          formatPKR(am.paid) +
          "</td><td class=\"td-num\">" +
          formatPKR(am.rem) +
          "</td></tr>"
      );
    }

    function sectionHeader(title) {
      lines.push(
        "<tr><td colspan=\"4\"><strong>" + escapeHtml(title) + "</strong></td></tr>"
      );
    }

    if (hasLines) {
      sectionHeader("Monthly recharges (all periods)");
      if (lists.monthly.length) {
        lists.monthly.forEach(emitChargeRow);
      } else {
        lines.push(
          "<tr><td colspan=\"4\"><span class=\"muted\">No monthly recharge lines.</span></td></tr>"
        );
      }
      sectionHeader("Other charges (installation, misc, etc.)");
      if (lists.other.length) {
        lists.other.forEach(emitChargeRow);
      } else {
        lines.push(
          "<tr><td colspan=\"4\"><span class=\"muted\">No other charge lines.</span></td></tr>"
        );
      }
      lines.push(
        "<tr><td><strong>Subtotal by charge lines</strong></td><td class=\"td-num\"><strong>" +
          formatPKR(sumOrig) +
          "</strong></td><td class=\"td-num\"><strong>" +
          formatPKR(sumPaidLine) +
          "</strong></td><td class=\"td-num\"><strong>" +
          formatPKR(sumRem) +
          "</strong></td></tr>"
      );
    } else if (totalDue > 0.000001) {
      lines.push(
        "<tr><td colspan=\"4\"><span class=\"muted\">No split due lines in the ledger; the total below is the recorded customer balance.</span></td></tr>"
      );
    }

    const groups = groupAllocationsByPayment(paymentApplicationsForCustomer(customerId));
    let totalReceipts = 0;
    if (groups.length) {
      sectionHeader("Payment receipts (payments received, by date)");
      groups.forEach(function (g) {
        const pay = g.payment;
        const pd = paymentDateISO(pay) || "";
        const displayDate = formatDisplayDate(pd);
        const inv = (pay.invoice_number && String(pay.invoice_number).trim()) || "";
        const pm =
          pay.payment_methods && pay.payment_methods.method_name
            ? String(pay.payment_methods.method_name)
            : "";
        const bits = [
          "Payment <strong>" + escapeHtml(displayDate) + "</strong>"
        ];
        if (inv) bits.push("Inv. " + escapeHtml(inv));
        if (pm) bits.push(escapeHtml(pm));
        if (pay.is_partial) bits.push("partial");
        const sum = g.lines.reduce(function (acc, x) {
          return acc + Number(x.allocation.amount || 0);
        }, 0);
        totalReceipts += sum;
        const breakdown = g.lines
          .map(function (x) {
            return (
              escapeHtml(dueChargeLineLabel(x.charge)) +
              ": " +
              formatPKR(Number(x.allocation.amount || 0))
            );
          })
          .join("; ");
        lines.push(
          "<tr><td>" +
            bits.join(" · ") +
            "<br/><span class=\"muted\">Applied: " +
            breakdown +
            "</span></td><td class=\"td-num\">—</td><td class=\"td-num\"><strong>" +
            formatPKR(sum) +
            "</strong></td><td class=\"td-num\">—</td></tr>"
        );
      });
      lines.push(
        "<tr><td><strong>Total payments received</strong></td><td class=\"td-num\">—</td><td class=\"td-num\"><strong>" +
          formatPKR(totalReceipts) +
          "</strong></td><td class=\"td-num\">—</td></tr>"
      );
    }

    lines.push(
      "<tr><td colspan=\"3\"><strong>Outstanding balance</strong></td><td class=\"td-num\"><strong>" +
        formatPKR(totalDue) +
        "</strong></td></tr>"
    );
  }

  function appendDueStatementPlainLines(lines, customerId) {
    const c = state.customers.find(function (x) {
      return x.id === customerId;
    });
    const totalDue = c ? Number(c.due_amount || 0) : 0;
    const lists = sortedStatementChargeLists(customerId);
    const hasLines = lists.monthly.length + lists.other.length > 0;
    let sumOrig = 0;
    let sumPaidLine = 0;
    let sumRem = 0;

    function pushChargeLine(ch) {
      const am = dueLineAmounts(ch);
      sumOrig += am.orig;
      sumPaidLine += am.paid;
      sumRem += am.rem;
      lines.push(
        "  - " +
          dueChargeLineLabel(ch) +
          ": charged " +
          formatPKR(am.orig) +
          ", paid on line " +
          formatPKR(am.paid) +
          ", remaining " +
          formatPKR(am.rem)
      );
    }

    if (hasLines) {
      lines.push("Monthly recharges (all periods):");
      if (lists.monthly.length) {
        lists.monthly.forEach(pushChargeLine);
      } else {
        lines.push("  (none)");
      }
      lines.push("Other charges:");
      if (lists.other.length) {
        lists.other.forEach(pushChargeLine);
      } else {
        lines.push("  (none)");
      }
      lines.push(
        "Subtotal by charge lines: charges " +
          formatPKR(sumOrig) +
          ", payments received " +
          formatPKR(sumPaidLine) +
          ", outstanding balance " +
          formatPKR(sumRem)
      );
    } else if (totalDue > 0.000001) {
      lines.push(
        "Note: No split due lines in the ledger; total below is the recorded customer balance."
      );
    }

    const groups = groupAllocationsByPayment(paymentApplicationsForCustomer(customerId));
    let totalReceipts = 0;
    if (groups.length) {
      lines.push("Payment receipts (payments received):");
      groups.forEach(function (g) {
        const pay = g.payment;
        const pd = formatDisplayDate(paymentDateISO(pay) || "");
        const inv = (pay.invoice_number && String(pay.invoice_number).trim()) || "";
        const pm =
          pay.payment_methods && pay.payment_methods.method_name
            ? String(pay.payment_methods.method_name)
            : "";
        const sum = g.lines.reduce(function (acc, x) {
          return acc + Number(x.allocation.amount || 0);
        }, 0);
        totalReceipts += sum;
        const breakdown = g.lines
          .map(function (x) {
            return (
              dueChargeLineLabel(x.charge) + " " + formatPKR(Number(x.allocation.amount || 0))
            );
          })
          .join("; ");
        lines.push(
          "  - " +
            pd +
            (inv ? " (Inv. " + inv + ")" : "") +
            (pm ? " · " + pm : "") +
            (pay.is_partial ? " · partial" : "") +
            " — paid " +
            formatPKR(sum) +
            " — " +
            breakdown
        );
      });
      lines.push("Total payments received: " + formatPKR(totalReceipts));
    }
    lines.push("Outstanding balance: " + formatPKR(totalDue));
  }

  function customerHasDueLedger(customerId) {
    return state.dueCharges.some(function (x) {
      return x.customer_id === customerId;
    });
  }

  async function recalcCustomerDueFromLedger(sb, customerId) {
    const rows = dueChargesForCustomer(customerId);
    let sum = 0;
    rows.forEach(function (x) {
      sum += Number(x.amount_remaining || 0);
    });
    const res = await sb.from("customers").update({ due_amount: sum }).eq("id", customerId);
    if (res.error) throw res.error;
    const c = state.customers.find(function (x) {
      return x.id === customerId;
    });
    if (c) c.due_amount = sum;
  }

  async function backfillLegacyDueCharges(sb) {
    for (let i = 0; i < state.customers.length; i += 1) {
      const c = state.customers[i];
      const n = Number(c.due_amount || 0);
      if (n <= 0) continue;
      if (customerHasDueLedger(c.id)) continue;
      const ins = await sb
        .from("customer_due_charges")
        .insert({
          customer_id: c.id,
          amount: n,
          amount_remaining: n,
          category: "legacy_carry",
          notes: "Unsplit balance (auto)"
        })
        .select();
      if (ins.error) {
        console.warn(ins.error);
        continue;
      }
      if (ins.data && ins.data[0]) state.dueCharges.push(ins.data[0]);
    }
  }

  async function fifoAllocatePaymentToCharges(sb, customerId, paymentId, towardDue) {
    let left = Number(towardDue || 0);
    if (left <= 0) return;
    const charges = dueChargesForCustomer(customerId)
      .filter(function (x) {
        return Number(x.amount_remaining) > 0.000001;
      })
      .sort(function (a, b) {
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });
    for (let i = 0; i < charges.length && left > 0; i += 1) {
      const ch = charges[i];
      const rem = Number(ch.amount_remaining);
      const take = roundMoney(Math.min(rem, left));
      if (take <= 0) continue;
      const nextRemaining = roundMoney(rem - take);
      const up = await sb
        .from("customer_due_charges")
        .update({ amount_remaining: nextRemaining })
        .eq("id", ch.id);
      if (up.error) throw up.error;
      const al = await sb.from("payment_due_allocations").insert({
        payment_id: paymentId,
        due_charge_id: ch.id,
        amount: take
      });
      if (al.error) throw al.error;
      const row = state.dueCharges.find(function (x) {
        return x.id === ch.id;
      });
      if (row) row.amount_remaining = nextRemaining;
      left = roundMoney(left - take);
    }
    if (left > 0.01) {
      throw new Error("Due lines do not cover the balance; sync dues and try again.");
    }
  }

  async function deletePaymentRecord(paymentId) {
    const sb = getClient();
    const p = state.payments.find(function (x) {
      return x.id === paymentId;
    });
    if (!p) return;
    if (
      !confirm(
        "Delete this payment record? Customer dues will be adjusted. This cannot be undone."
      )
    ) {
      return;
    }
    const custId = p.customer_id;
    const allRes = await sb
      .from("payment_due_allocations")
      .select("*")
      .eq("payment_id", paymentId);
    if (allRes.error) {
      toast(allRes.error.message, "err");
      return;
    }
    const allocs = allRes.data || [];
    if (allocs.length) {
      for (let i = 0; i < allocs.length; i += 1) {
        const a = allocs[i];
        const ch = state.dueCharges.find(function (x) {
          return x.id === a.due_charge_id;
        });
        const cur = ch ? Number(ch.amount_remaining) : 0;
        const add = Number(a.amount || 0);
        const maxAmount = ch ? Number(ch.amount || 0) : cur + add;
        const restored = roundMoney(Math.min(maxAmount, cur + add));
        const up = await sb
          .from("customer_due_charges")
          .update({ amount_remaining: restored })
          .eq("id", a.due_charge_id);
        if (up.error) {
          toast(up.error.message, "err");
          return;
        }
        if (ch) ch.amount_remaining = restored;
      }
      const delA = await sb.from("payment_due_allocations").delete().eq("payment_id", paymentId);
      if (delA.error) {
        toast(delA.error.message, "err");
        return;
      }
    } else {
      const paid = Number(p.paid_amount || 0);
      const tot = Number(p.total_amount || 0);
      const bump = Math.max(0, Math.min(paid, tot));
      const c = state.customers.find(function (x) {
        return x.id === custId;
      });
      const newDue = Number(c && c.due_amount ? c.due_amount : 0) + bump;
      const upc = await sb.from("customers").update({ due_amount: newDue }).eq("id", custId);
      if (upc.error) {
        toast(upc.error.message, "err");
        return;
      }
      if (c) c.due_amount = newDue;
    }
    const delP = await sb.from("payments").delete().eq("id", paymentId);
    if (delP.error) {
      toast(delP.error.message, "err");
      return;
    }
    if (allocs.length) await recalcCustomerDueFromLedger(sb, custId);
    toast("Payment deleted.", "ok");
    await refresh();
    if (state.viewCustomerId) renderCustomerViewModal();
  }

  async function deleteDueChargeRow(chargeId) {
    const sb = getClient();
    const ch = state.dueCharges.find(function (x) {
      return x.id === chargeId;
    });
    if (!ch) return;
    if (!confirm("Remove this due line and reduce the customer balance?")) return;
    const del = await sb.from("customer_due_charges").delete().eq("id", chargeId);
    if (del.error) {
      toast(del.error.message, "err");
      return;
    }
    state.dueCharges = state.dueCharges.filter(function (x) {
      return x.id !== chargeId;
    });
    await recalcCustomerDueFromLedger(sb, ch.customer_id);
    toast("Due line removed.", "ok");
    await refresh();
    renderDueChargesModal();
  }

  async function saveManualDueCharge() {
    const sb = getClient();
    const cid = state.dueDetailCustomerId;
    if (!cid) return;
    const cat = $("dueAddCategory").value;
    const amt = Number($("dueAddAmount").value || 0);
    const rm = $("dueAddMonth").value.trim();
    const notes = $("dueAddNotes").value.trim();
    if (!(amt > 0)) {
      toast("Enter a positive amount.", "err");
      return;
    }
    const ins = await sb
      .from("customer_due_charges")
      .insert({
        customer_id: cid,
        amount: amt,
        amount_remaining: amt,
        category: cat || "other",
        recharge_month: rm || null,
        notes: notes || null
      })
      .select();
    if (ins.error) {
      toast(ins.error.message, "err");
      return;
    }
    if (ins.data && ins.data[0]) state.dueCharges.push(ins.data[0]);
    await recalcCustomerDueFromLedger(sb, cid);
    $("dueAddAmount").value = "";
    $("dueAddMonth").value = "";
    $("dueAddNotes").value = "";
    toast("Due line added.", "ok");
    await refresh();
    renderDueChargesModal();
  }

  function renderDueChargesModal() {
    const cid = state.dueDetailCustomerId;
    const title = $("dueDetailTitle");
    const tb = $("tbodyDueCharges");
    if (!title || !tb) return;
    if (!cid) {
      title.textContent = "Dues detail";
      tb.innerHTML = "";
      return;
    }
    const c = state.customers.find(function (x) {
      return x.id === cid;
    });
    title.textContent = c ? "Dues — " + c.full_name : "Dues detail";
    const rows = dueChargesForCustomer(cid).sort(function (a, b) {
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
    if (!rows.length) {
      tb.innerHTML =
        "<tr><td colspan='8' class='muted'>No due lines yet. Add installation, misc, or other charges below.</td></tr>";
      return;
    }
    tb.innerHTML = rows
      .map(function (r) {
        const am = dueLineAmounts(r);
        return (
          "<tr><td>" +
          escapeHtml(formatDisplayDate(String(r.created_at || "").slice(0, 10))) +
          "</td><td>" +
          escapeHtml(dueCategoryLabel(r.category)) +
          "</td><td class='td-num'>" +
          escapeHtml(formatPKR(r.amount)) +
          "</td><td class='td-num'>" +
          escapeHtml(formatPKR(am.paid)) +
          "</td><td class='td-num'>" +
          escapeHtml(formatPKR(r.amount_remaining)) +
          "</td><td>" +
          escapeHtml(r.recharge_month || "—") +
          "</td><td>" +
          escapeHtml(r.notes || "—") +
          '</td><td class="no-print">' +
          '<button type="button" class="btn danger" data-due-ch-del="' +
          escapeHtml(r.id) +
          '">Delete</button></td></tr>'
        );
      })
      .join("");
  }

  function openDueDetailModal(customerId) {
    state.dueDetailCustomerId = customerId;
    const c = state.customers.find(function (x) {
      return x.id === customerId;
    });
    if ($("dueAddMonth") && c) {
      $("dueAddMonth").placeholder = monthTokenFromDate(new Date());
    }
    renderDueChargesModal();
    openBackdrop($("modalDueDetail"));
  }

  function closeDueDetailModal() {
    state.dueDetailCustomerId = null;
    closeBackdrop($("modalDueDetail"));
  }

  async function loadAll() {
    const sb = getClient();
    const [
      custRes,
      areaRes,
      pkgRes,
      discRes,
      pmRes,
      payRes,
      dcRes,
      pdaRes
    ] = await Promise.all([
      sb.from("customers").select(
        "*, areas ( id, area_name, parent_area_id ), packages ( id, package_name, price, speed_mbps )"
      ),
      sb.from("areas").select("*").order("area_name"),
      sb.from("packages").select("*").order("package_name"),
      sb.from("area_package_discounts").select("*"),
      sb.from("payment_methods").select("*").order("method_name"),
      sb
        .from("payments")
        .select(
          "*, customers ( full_name, pppoe_id ), payment_methods ( method_name )"
        )
        .order("payment_date", { ascending: false }),
      sb.from("customer_due_charges").select("*").order("created_at", { ascending: true }),
      sb.from("payment_due_allocations").select("*")
    ]);

    if (custRes.error) throw custRes.error;
    if (areaRes.error) throw areaRes.error;
    if (pkgRes.error) throw pkgRes.error;
    if (discRes.error) throw discRes.error;
    if (pmRes.error) throw pmRes.error;
    if (payRes.error) throw payRes.error;

    state.customers = custRes.data || [];
    state.areas = areaRes.data || [];
    state.packages = pkgRes.data || [];
    state.discounts = discRes.data || [];
    state.paymentMethods = pmRes.data || [];
    state.payments = payRes.data || [];
    if (dcRes.error) {
      state.dueCharges = [];
      console.warn(dcRes.error);
    } else {
      state.dueCharges = dcRes.data || [];
    }
    if (pdaRes.error) {
      state.paymentAllocations = [];
      console.warn(pdaRes.error);
    } else {
      state.paymentAllocations = pdaRes.data || [];
    }

    syncAllCustomerStatus();
    await backfillLegacyDueCharges(sb);
  }

  function syncAllCustomerStatus() {
    const t = todayISODate();
    state.customers.forEach(function (c) {
      if (c.status === "inactive") return;
      if (c.package_expiry_date && c.package_expiry_date < t) {
        c.status = "expired";
      } else if (c.package_expiry_date && c.package_expiry_date >= t) {
        c.status = "active";
      }
    });
  }

  function badgeForStatus(st) {
    const cls =
      st === "active" ? "active" : st === "expired" ? "expired" : "inactive";
    return (
      '<span class="badge ' +
      cls +
      '"><i class="fa-solid fa-circle badge-dot" aria-hidden="true"></i> ' +
      escapeHtml(st) +
      "</span>"
    );
  }

  function renderDashboard() {
    const t = todayISODate();
    let total = state.customers.length;
    let active = 0;
    let expired = 0;
    let dueSum = 0;
    state.customers.forEach(function (c) {
      dueSum += Number(c.due_amount || 0);
      if (c.status === "active") active++;
      else if (c.status === "expired") expired++;
    });

    let todayCol = 0;
    state.payments.forEach(function (p) {
      if (paymentDateISO(p) === t) {
        todayCol += Number(p.paid_amount || 0);
      }
    });

    const stTot = $("statTotalCustomers");
    const stAct = $("statActive");
    const stExp = $("statExpired");
    const stDue = $("statDue");
    const stToday = $("statToday");
    if (stTot) stTot.textContent = String(total);
    if (stAct) stAct.textContent = String(active);
    if (stExp) stExp.textContent = String(expired);
    if (stDue) stDue.textContent = formatPKR(dueSum).replace("PKR ", "");
    if (stToday) stToday.textContent = formatPKR(todayCol).replace("PKR ", "");

    const expRows = [];
    state.customers.forEach(function (c) {
      if (!c.package_expiry_date) return;
      const left = daysBetweenISO(t, c.package_expiry_date);
      if (left == null) return;
      if (left >= 0 && left <= 10) {
        expRows.push({ c: c, left: left });
      }
    });
    expRows.sort(function (a, b) {
      return a.left - b.left;
    });

    const tbEx = $("tbodyExpiring");
    if (tbEx) {
      tbEx.innerHTML = expRows
      .map(function (r) {
        const c = r.c;
        return (
          "<tr><td>" +
          escapeHtml(c.full_name) +
          "</td><td>" +
          escapeHtml(c.pppoe_id) +
          "</td><td>" +
          escapeHtml(c.phone || "") +
          "</td><td>" +
          escapeHtml(formatDisplayDate(c.package_expiry_date)) +
          "</td><td>" +
          r.left +
          "</td><td>" +
          badgeForStatus(c.status) +
          "</td></tr>"
        );
      })
      .join("");
    }

    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceIso = toISODate(since);
    const recent = state.payments.filter(function (p) {
      return paymentDateISO(p) >= sinceIso;
    });

    const tbRecent = $("tbodyRecentPayments");
    if (tbRecent) {
      tbRecent.innerHTML = recent
      .map(function (p) {
        return (
          "<tr><td>" +
          escapeHtml(formatDisplayDate(p.payment_date)) +
          "</td><td>" +
          escapeHtml((p.customers && p.customers.full_name) || "") +
          "</td><td>" +
          escapeHtml(p.invoice_number) +
          "</td><td>" +
          formatPKR(p.paid_amount) +
          "</td><td>" +
          escapeHtml(
            (p.payment_methods && p.payment_methods.method_name) || ""
          ) +
          "</td><td>" +
          (p.is_partial ? "Yes" : "No") +
          "</td></tr>"
        );
      })
      .join("");
    }
  }

  function filteredCustomers() {
    const q = ($("custSearch") && $("custSearch").value.trim().toLowerCase()) || "";
    const area = ($("custFilterArea") && $("custFilterArea").value) || "";
    const pkg = ($("custFilterPackage") && $("custFilterPackage").value) || "";
    const st = ($("custFilterStatus") && $("custFilterStatus").value) || "";
    return state.customers.filter(function (c) {
      if (area && c.area_id !== area) return false;
      if (pkg && c.package_id !== pkg) return false;
      if (st && c.status !== st) return false;
      if (!q) return true;
      const blob =
        (c.full_name || "") +
        " " +
        (c.pppoe_id || "") +
        " " +
        (c.phone || "");
      return blob.toLowerCase().indexOf(q) !== -1;
    });
  }

  function sortedCustomersTableRows() {
    const rows = filteredCustomers().slice();
    const sortBy = ($("custSortBy") && $("custSortBy").value) || "name";
    if (sortBy === "package") {
      rows.sort(function (a, b) {
        const pa = (a.packages && a.packages.package_name) || "";
        const pb = (b.packages && b.packages.package_name) || "";
        const c0 = String(pa).localeCompare(String(pb));
        if (c0 !== 0) return c0;
        return String(a.full_name || "").localeCompare(String(b.full_name || ""));
      });
    } else if (sortBy === "expiry") {
      rows.sort(function (a, b) {
        const da = String(a.package_expiry_date || "");
        const db = String(b.package_expiry_date || "");
        if (da !== db) return da.localeCompare(db);
        return String(a.full_name || "").localeCompare(String(b.full_name || ""));
      });
    } else {
      rows.sort(function (a, b) {
        return String(a.full_name || "").localeCompare(String(b.full_name || ""));
      });
    }
    return rows;
  }

  function renderCustomerFilters() {
    const sel = $("custFilterArea");
    if (!sel) return;
    const opts = ['<option value="">All areas</option>'];
    state.areas.forEach(function (a) {
      opts.push(
        '<option value="' +
          escapeHtml(a.id) +
          '">' +
          escapeHtml(areaLabelTree(a)) +
          "</option>"
      );
    });
    sel.innerHTML = opts.join("");
  }

  function renderCustomerPackageFilter() {
    const sel = $("custFilterPackage");
    if (!sel) return;
    const prev = sel.value;
    const opts = ['<option value="">All packages</option>'];
    const pkgs = state.packages.slice().sort(function (a, b) {
      return String(a.package_name || "").localeCompare(String(b.package_name || ""));
    });
    pkgs.forEach(function (p) {
      opts.push(
        '<option value="' +
          escapeHtml(p.id) +
          '">' +
          escapeHtml(String(p.package_name || "") + " — " + String(p.speed_mbps || "") + " Mbps") +
          "</option>"
      );
    });
    sel.innerHTML = opts.join("");
    if (prev && pkgs.some(function (p) { return p.id === prev; })) {
      sel.value = prev;
    }
  }

  function renderDuesAreaFilter() {
    const sel = $("duesFilterArea");
    if (!sel) return;
    const prev = sel.value;
    const opts = ['<option value="">All areas</option>'];
    const subs = state.areas
      .filter(function (a) {
        return a.parent_area_id;
      })
      .sort(function (a, b) {
        return areaLabelTree(a).localeCompare(areaLabelTree(b));
      });
    subs.forEach(function (a) {
      opts.push(
        '<option value="' +
          escapeHtml(a.id) +
          '">' +
          escapeHtml(areaLabelTree(a)) +
          "</option>"
      );
    });
    sel.innerHTML = opts.join("");
    if (prev && subs.some(function (a) { return a.id === prev; })) {
      sel.value = prev;
    }
  }

  function duesCustomersWithBalance() {
    const area = ($("duesFilterArea") && $("duesFilterArea").value) || "";
    return state.customers.filter(function (c) {
      if (!(Number(c.due_amount || 0) > 0)) return false;
      if (area && c.area_id !== area) return false;
      return true;
    });
  }

  function renderCustomersTable() {
    const rows = sortedCustomersTableRows();
    const tb = $("tbodyCustomers");
    if (!tb) return;
    tb.innerHTML = rows
      .map(function (c) {
        const ar = c.areas ? areaLabelTree(c.areas) : "";
        const pk = c.packages ? c.packages.package_name : "";
        return (
          "<tr><td>" +
          escapeHtml(c.pppoe_id) +
          "</td><td>" +
          escapeHtml(c.full_name) +
          "</td><td>" +
          escapeHtml(c.phone || "") +
          "</td><td>" +
          escapeHtml(ar) +
          "</td><td>" +
          escapeHtml(pk) +
          "</td><td>" +
          escapeHtml(formatDisplayDate(c.package_expiry_date)) +
          "</td><td>" +
          formatPKR(c.due_amount) +
          "</td><td>" +
          badgeForStatus(c.status) +
          '</td><td class="no-print">' +
          '<button class="btn ghost" type="button" data-act="view" data-id="' +
          escapeHtml(c.id) +
          '"><i class="fa-solid fa-eye"></i> View</button> ' +
          '<button class="btn ghost" type="button" data-act="edit" data-id="' +
          escapeHtml(c.id) +
          '"><i class="fa-solid fa-pen"></i></button> ' +
          (Number(c.due_amount || 0) > 0
            ? '<button class="btn success" type="button" data-act="recv" data-id="' +
              escapeHtml(c.id) +
              '"><i class="fa-solid fa-coins"></i> Receive</button> '
            : "") +
          '<button class="btn ghost" type="button" data-act="pay" data-id="' +
          escapeHtml(c.id) +
          '"><i class="fa-solid fa-bolt"></i> Recharge</button> ' +
          '<button class="btn ghost" type="button" data-act="inv" data-id="' +
          escapeHtml(c.id) +
          '" title="Invoice / due statement"><i class="fa-solid fa-file-invoice"></i></button> ' +
          '<button class="btn danger" type="button" data-act="del" data-id="' +
          escapeHtml(c.id) +
          '"><i class="fa-solid fa-trash"></i></button>' +
          "</td></tr>"
        );
      })
      .join("");
  }

  function renderDueLedgerCustomerSelect() {
    const sel = $("dueAnyCustomer");
    if (!sel) return;
    const opts = ['<option value="">— Select customer —</option>'];
    state.customers.forEach(function (c) {
      opts.push(
        '<option value="' +
          escapeHtml(c.id) +
          '">' +
          escapeHtml(c.full_name + " (" + (c.pppoe_id || "") + ")") +
          "</option>"
      );
    });
    sel.innerHTML = opts.join("");
  }

  function renderDues() {
    const rows = duesCustomersWithBalance();
    const tb = $("tbodyDues");
    if (!tb) return;
    tb.innerHTML = rows
      .map(function (c) {
        const ar = c.areas ? areaLabelTree(c.areas) : "—";
        return (
          "<tr><td>" +
          escapeHtml(c.full_name) +
          "</td><td>" +
          escapeHtml(c.pppoe_id) +
          "</td><td>" +
          escapeHtml(ar) +
          "</td><td>" +
          escapeHtml(c.phone || "") +
          "</td><td>" +
          formatPKR(c.due_amount) +
          '</td><td class="no-print">' +
          '<button class="btn ghost" type="button" data-due-detail="' +
          escapeHtml(c.id) +
          '">Details</button> ' +
          '<button class="btn success" type="button" data-due-pay="' +
          escapeHtml(c.id) +
          '">Receive payment</button> ' +
          '<button class="btn ghost" type="button" data-due-inv="' +
          escapeHtml(c.id) +
          '">Due invoice</button> ' +
          '<button class="btn ghost" type="button" data-due-wa="' +
          escapeHtml(c.id) +
          '"><i class="fa-brands fa-whatsapp"></i> Reminder</button>' +
          "</td></tr>"
        );
      })
      .join("");
  }

  function renderPackages() {
    const tb = $("tbodyPackages");
    if (!tb) return;
    tb.innerHTML = state.packages
      .map(function (p) {
        return (
          "<tr><td>" +
          escapeHtml(p.package_name) +
          "</td><td>" +
          escapeHtml(String(p.speed_mbps)) +
          " Mbps</td><td>" +
          formatPKR(p.price) +
          "</td><td>" +
          (p.is_active ? "Yes" : "No") +
          '</td><td class="no-print">' +
          '<button class="btn ghost" type="button" data-pkg-edit="' +
          escapeHtml(p.id) +
          '"><i class="fa-solid fa-pen"></i></button> ' +
          '<button class="btn danger" type="button" data-pkg-del="' +
          escapeHtml(p.id) +
          '"><i class="fa-solid fa-trash"></i></button>' +
          "</td></tr>"
        );
      })
      .join("");
  }

  function renderPm() {
    const tb = $("tbodyPm");
    if (!tb) return;
    tb.innerHTML = state.paymentMethods
      .map(function (m) {
        return (
          "<tr><td>" +
          escapeHtml(m.method_name) +
          "</td><td>" +
          escapeHtml(m.method_type) +
          "</td><td>" +
          (m.is_active ? "Yes" : "No") +
          '</td><td class="no-print">' +
          '<button class="btn danger" type="button" data-pm-del="' +
          escapeHtml(m.id) +
          '">Delete</button>' +
          "</td></tr>"
        );
      })
      .join("");
  }

  function renderAreas() {
    const tb = $("tbodyAreas");
    if (!tb) return;
    tb.innerHTML = state.areas
      .map(function (a) {
        const parent = a.parent_area_id
          ? areaById(a.parent_area_id)
          : null;
        return (
          "<tr><td>" +
          escapeHtml(areaLabelTree(a)) +
          "</td><td>" +
          escapeHtml(parent ? parent.area_name : "—") +
          "</td><td>" +
          (a.is_active ? "Yes" : "No") +
          '</td><td class="no-print">' +
          '<button class="btn danger" type="button" data-area-del="' +
          escapeHtml(a.id) +
          '">Delete</button>' +
          "</td></tr>"
        );
      })
      .join("");
  }

  function renderDiscounts() {
    const tb = $("tbodyDiscounts");
    if (!tb) return;
    tb.innerHTML = state.discounts
      .map(function (d) {
        const an = d.area_id ? (areaById(d.area_id) || {}).area_name || "" : "";
        const pn = d.package_id
          ? (packageById(d.package_id) || {}).package_name || ""
          : "";
        return (
          "<tr><td>" +
          escapeHtml(an) +
          "</td><td>" +
          escapeHtml(pn) +
          "</td><td>" +
          escapeHtml(d.discount_type) +
          "</td><td>" +
          escapeHtml(String(d.discount_value)) +
          '</td><td class="no-print">' +
          '<button class="btn ghost" type="button" data-disc-edit="' +
          escapeHtml(d.id) +
          '">Edit</button> ' +
          '<button class="btn danger" type="button" data-disc-del="' +
          escapeHtml(d.id) +
          '">Delete</button>' +
          "</td></tr>"
        );
      })
      .join("");
  }

  function setView(name) {
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.remove("active");
    });
    const el = $("view-" + name);
    if (el) el.classList.add("active");
    document.querySelectorAll(".nav button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === name);
    });
    const titles = {
      dashboard: "Dashboard",
      customers: "Customers",
      dues: "Dues",
      collection: "Collection",
      packages: "Packages",
      reports: "Reports",
      settings: "Settings"
    };
    const pt = $("pageTitle");
    if (pt) pt.textContent = titles[name] || "Dashboard";
    if (name === "collection") renderCollection();
    if (name === "reports") renderReportsInline();
  }

  function exportCustomersCsv() {
    const rows = sortedCustomersTableRows();
    const header = [
      "user_id",
      "full_name",
      "phone",
      "email",
      "area",
      "address",
      "package",
      "speed_mbps",
      "installation_date",
      "package_expiry_date",
      "due_amount",
      "individual_discount_type",
      "individual_discount_value",
      "status"
    ];
    const lines = [header.join(",")];
    rows.forEach(function (c) {
      const ar = c.areas ? areaLabelTree(c.areas) : "";
      const pk = c.packages ? c.packages.package_name : "";
      const sp = c.packages ? c.packages.speed_mbps : "";
      lines.push(
        [
          csvEscape(c.pppoe_id),
          csvEscape(c.full_name),
          csvEscape(c.phone),
          csvEscape(c.email),
          csvEscape(ar),
          csvEscape(c.address),
          csvEscape(pk),
          csvEscape(sp),
          csvEscape(formatDisplayDate(c.installation_date)),
          csvEscape(formatDisplayDate(c.package_expiry_date)),
          csvEscape(c.due_amount),
          csvEscape(c.individual_discount_type),
          csvEscape(c.individual_discount_value),
          csvEscape(c.status)
        ].join(",")
      );
    });
    downloadText("customers-export.csv", lines.join("\n"), "text/csv;charset=utf-8");
    toast(M.reports && M.reports.exported ? M.reports.exported : "Exported", "ok");
  }

  function syncNewCustomerExpiryFromInstall() {
    if ($("custId").value) return;
    const inst = $("custInstall").value;
    if (!inst) return;
    const nd = addOneCalendarMonthDate(inst);
    if (nd) $("custExpiry").value = toISODate(nd);
  }

  function openCustomerModal(c) {
    buildSubAreaOptions($("custArea"), true);
    buildPackageOptions($("custPkg"), true);
    $("modalCustomerTitle").textContent = c ? "Edit customer" : "Add customer";
    $("custId").value = c ? c.id : "";
    $("custPppoe").value = c ? c.pppoe_id : "";
    $("custName").value = c ? c.full_name : "";
    $("custPhone").value = c ? c.phone || "" : "";
    $("custEmail").value = c ? c.email || "" : "";
    $("custArea").value = c && c.area_id ? c.area_id : "";
    $("custPkg").value = c && c.package_id ? c.package_id : "";
    $("custAddress").value = c ? c.address || "" : "";
    if (c) {
      $("custInstall").value = c.installation_date || "";
      $("custExpiry").value = c.package_expiry_date || "";
    } else {
      const inst = todayISODate();
      $("custInstall").value = inst;
      const nd = addOneCalendarMonthDate(inst);
      $("custExpiry").value = nd ? toISODate(nd) : inst;
    }
    $("custIndType").value = c ? c.individual_discount_type || "none" : "none";
    $("custIndVal").value = c ? String(c.individual_discount_value || 0) : "0";
    $("custStatus").value = c ? c.status : "active";
    const hint = $("custExpiryHint");
    if (hint) hint.hidden = !!c;
    const titleEl = $("custExtraDueTitle");
    const hintDue = $("custExtraDueHint");
    if (titleEl) {
      titleEl.textContent = c ? "Add charges (optional)" : "Opening charges (optional)";
    }
    if (hintDue) {
      hintDue.textContent = c
        ? "Add installation, misc, or other lines here; each row with an amount is saved on top of their current balance. Use + for more rows."
        : "Enter one or more installation, misc, or other charges. Each row with an amount is saved to the dues ledger when you click Save. Use + to add rows.";
    }
    initCustExtraDueRows();
    openBackdrop($("modalCustomer"));
  }

  async function saveCustomer() {
    const sb = getClient();
    const extraLines = collectCustExtraDueRows();
    const row = {
      pppoe_id: $("custPppoe").value.trim(),
      full_name: $("custName").value.trim(),
      phone: $("custPhone").value.trim() || null,
      email: $("custEmail").value.trim() || null,
      area_id: $("custArea").value || null,
      address: $("custAddress").value.trim() || null,
      package_id: $("custPkg").value || null,
      installation_date: $("custInstall").value || null,
      package_expiry_date: $("custExpiry").value || null,
      individual_discount_type: $("custIndType").value,
      individual_discount_value: Number($("custIndVal").value || 0),
      status: $("custStatus").value
    };
    if (!row.pppoe_id || !row.full_name || !row.package_id || !row.package_expiry_date) {
      toast(M.customers && M.customers.validation ? M.customers.validation : "Validation", "err");
      return;
    }
    const id = $("custId").value;
    let err;
    let chargeErr = null;
    let customerIdForCharges = id || null;
    if (id) {
      const res = await sb.from("customers").update(row).eq("id", id);
      err = res.error;
    } else {
      row.due_amount = 0;
      const res = await sb.from("customers").insert(row).select("id");
      err = res.error;
      let nid = res.data && res.data[0] && res.data[0].id;
      if (!err && !nid && row.pppoe_id) {
        const lk = await sb
          .from("customers")
          .select("id")
          .eq("pppoe_id", row.pppoe_id)
          .maybeSingle();
        if (lk.error) {
          console.warn(lk.error);
        } else if (lk.data && lk.data.id) {
          nid = lk.data.id;
        }
      }
      customerIdForCharges = nid || null;
    }
    if (err) {
      toast(err.message || M.generic.unexpected, "err");
      return;
    }
    if (extraLines.length && customerIdForCharges) {
      chargeErr = await insertExtraDueLines(sb, customerIdForCharges, extraLines);
    } else if (extraLines.length && !customerIdForCharges) {
      chargeErr = "Could not determine customer id to save charges.";
    }
    if (chargeErr) {
      toast(
        (M.customers && M.customers.saved ? M.customers.saved + " " : "Saved. ") +
          "Some charges were not saved: " +
          chargeErr,
        "err"
      );
    } else {
      toast(M.customers.saved, "ok");
    }
    closeBackdrop($("modalCustomer"));
    await refresh();
  }

  async function deleteCustomer(id) {
    if (!confirm(M.customers.deleteConfirm)) return;
    const sb = getClient();
    const res = await sb.from("customers").delete().eq("id", id);
    if (res.error) {
      toast(res.error.message, "err");
      return;
    }
    toast(M.customers.deleted, "ok");
    await refresh();
  }

  function paymentsForCustomer(customerId) {
    return state.payments
      .filter(function (p) {
        return p.customer_id === customerId;
      })
      .sort(function (a, b) {
        const da = paymentDateISO(a) || "";
        const db = paymentDateISO(b) || "";
        if (da !== db) return db.localeCompare(da);
        return String(b.invoice_number || "").localeCompare(String(a.invoice_number || ""));
      });
  }

  function customerProfileDetailRows(c) {
    const ar = c.areas ? areaLabelTree(c.areas) : "—";
    const pk = c.packages
      ? c.packages.package_name + " (" + String(c.packages.speed_mbps || "") + " Mbps)"
      : "—";
    return [
      ["User ID", c.pppoe_id || "—"],
      ["Name", c.full_name || "—"],
      ["Phone", c.phone || "—"],
      ["Email", c.email || "—"],
      ["Area", ar],
      ["Package", pk],
      ["Address", c.address || "—"],
      ["Installation date", formatDisplayDate(c.installation_date)],
      ["Package expiry", formatDisplayDate(c.package_expiry_date)],
      ["Due balance", formatPKR(c.due_amount)],
      ["Status", c.status || "—"]
    ];
  }

  function renderCustomerViewModal() {
    const root = $("customerViewRoot");
    const title = $("customerViewTitle");
    if (!root) return;
    const c = state.customers.find(function (x) {
      return x.id === state.viewCustomerId;
    });
    if (!c) {
      root.innerHTML = '<p class="muted">Customer not found.</p>';
      if (title) title.textContent = "Customer profile";
      return;
    }
    if (title) title.textContent = "Customer profile — " + c.full_name;
    const details = customerProfileDetailRows(c)
      .map(function (r) {
        return (
          "<tr><td><strong>" +
          escapeHtml(r[0]) +
          "</strong></td><td>" +
          escapeHtml(String(r[1])) +
          "</td></tr>"
        );
      })
      .join("");
    const dueRows = dueChargesForCustomer(c.id)
      .slice()
      .sort(function (a, b) {
        return String(b.created_at || "").localeCompare(String(a.created_at || ""));
      })
      .map(function (r) {
        const am = dueLineAmounts(r);
        return (
          "<tr><td>" +
          escapeHtml(formatDisplayDate(String(r.created_at || "").slice(0, 10))) +
          "</td><td>" +
          escapeHtml(dueCategoryLabel(r.category)) +
          "</td><td>" +
          escapeHtml(r.recharge_month || "—") +
          "</td><td class='td-num'>" +
          formatPKR(am.orig) +
          "</td><td class='td-num'>" +
          formatPKR(am.paid) +
          "</td><td class='td-num'>" +
          formatPKR(am.rem) +
          "</td></tr>"
        );
      })
      .join("");
    const paymentRows = paymentsForCustomer(c.id)
      .map(function (p) {
        const pm =
          p.payment_methods && p.payment_methods.method_name
            ? p.payment_methods.method_name
            : "—";
        const partial =
          p.is_partial === true || p.is_partial === "true" || p.is_partial === 1
            ? "Yes"
            : "No";
        return (
          "<tr><td>" +
          escapeHtml(formatDisplayDate(paymentDateISO(p))) +
          "</td><td>" +
          escapeHtml(p.invoice_number || "—") +
          "</td><td class='td-num'>" +
          formatPKR(p.paid_amount) +
          "</td><td>" +
          escapeHtml(pm) +
          "</td><td>" +
          escapeHtml(p.transaction_id || "—") +
          "</td><td>" +
          escapeHtml(partial) +
          '</td><td class="no-print">' +
          '<button type="button" class="btn danger" data-customer-view-pay-del="' +
          escapeHtml(p.id) +
          '">Delete</button></td></tr>'
        );
      })
      .join("");
    root.innerHTML =
      '<div class="actions-row end">' +
      '<button type="button" class="btn ghost" id="btnCustomerViewResetExpiry">' +
      '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Reset expiry from install date' +
      "</button></div>" +
      '<div class="card"><div class="label">Customer data</div>' +
      '<div class="table-wrap push"><table class="table-compact"><tbody>' +
      details +
      "</tbody></table></div></div>" +
      '<div class="card push"><div class="label">Due lines</div>' +
      '<div class="table-wrap push"><table><thead><tr><th>Date</th><th>Type</th><th>Period</th><th>Charges</th><th>Payments</th><th>Outstanding</th></tr></thead><tbody>' +
      (dueRows || "<tr><td colspan='6' class='muted'>No due lines.</td></tr>") +
      "</tbody></table></div></div>" +
      '<div class="card push"><div class="label">Payment transactions</div>' +
      '<div class="table-wrap push"><table><thead><tr><th>Date</th><th>Invoice</th><th>Paid</th><th>Method</th><th>Transaction ID</th><th>Partial</th><th class="no-print">Actions</th></tr></thead><tbody>' +
      (paymentRows || "<tr><td colspan='7' class='muted'>No payment transactions.</td></tr>") +
      "</tbody></table></div></div>";
  }

  function openCustomerViewModal(customerId) {
    state.viewCustomerId = customerId;
    renderCustomerViewModal();
    openBackdrop($("modalCustomerView"));
  }

  async function resetCustomerExpiryFromInstall(customerId) {
    const c = state.customers.find(function (x) {
      return x.id === customerId;
    });
    if (!c) return;
    if (!c.installation_date) {
      toast("Customer has no installation date to reset from.", "err");
      return;
    }
    const nd = addOneCalendarMonthDate(c.installation_date);
    if (!nd) {
      toast("Installation date is invalid.", "err");
      return;
    }
    const newExpiry = toISODate(nd);
    if (
      !confirm(
        "Reset package expiry to one month after installation date (" +
          formatDisplayDate(newExpiry) +
          ")?"
      )
    ) {
      return;
    }
    const status = c.status === "inactive" ? "inactive" : newExpiry >= todayISODate() ? "active" : "expired";
    const res = await getClient()
      .from("customers")
      .update({ package_expiry_date: newExpiry, status: status })
      .eq("id", c.id);
    if (res.error) {
      toast(res.error.message, "err");
      return;
    }
    toast("Expiry date reset.", "ok");
    await refresh();
    renderCustomerViewModal();
  }

  function findDuplicateReceivePayment(candidate) {
    const txn = String(candidate.transaction_id || "").trim().toLowerCase();
    if (txn) {
      const byTxn = state.payments.find(function (p) {
        return String(p.transaction_id || "").trim().toLowerCase() === txn;
      });
      if (byTxn) return { payment: byTxn, reason: "transaction ID" };
    }
    const amount = roundMoney(candidate.paid_amount);
    const bySamePayment = state.payments.find(function (p) {
      return (
        p.customer_id === candidate.customer_id &&
        String(paymentDateISO(p) || "") === String(candidate.payment_date || "") &&
        String(p.payment_method_id || "") === String(candidate.payment_method_id || "") &&
        roundMoney(p.paid_amount) === amount
      );
    });
    return bySamePayment
      ? { payment: bySamePayment, reason: "same customer, date, amount, and payment method" }
      : null;
  }

  function confirmDuplicateReceivePaymentAllowed(candidate) {
    const dupInfo = findDuplicateReceivePayment(candidate);
    if (!dupInfo) return true;
    const dup = dupInfo.payment;
    const cust = state.customers.find(function (c) {
      return c.id === dup.customer_id;
    });
    const name = cust ? cust.full_name + " (" + (cust.pppoe_id || "") + ")" : "another customer";
    const method =
      dup.payment_methods && dup.payment_methods.method_name
        ? dup.payment_methods.method_name
        : "same payment method";
    return confirm(
      "Possible duplicate payment found (" +
        dupInfo.reason +
        ").\n\nAlready recorded for " +
        name +
        " on " +
        formatDisplayDate(paymentDateISO(dup)) +
        " amount " +
        formatPKR(dup.paid_amount) +
        " via " +
        method +
        (dup.transaction_id ? "\nTransaction ID: " + dup.transaction_id : "") +
        ".\n\nPress OK to allow this duplicate payment, or Cancel to deny it."
    );
  }

  function setPaymentSubmitting(isSubmitting) {
    state.paymentSubmitting = !!isSubmitting;
    const btn = $("btnConfirmPayment");
    if (!btn) return;
    const label = $("btnConfirmPaymentLabel");
    if (isSubmitting) {
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      if (label) {
        label.setAttribute("data-prev-label", label.textContent || "");
        label.textContent = "Saving...";
      }
    } else {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      if (label) {
        const prev = label.getAttribute("data-prev-label");
        if (prev) label.textContent = prev;
        label.removeAttribute("data-prev-label");
      }
    }
  }

  function openPaymentModal(customerId, mode) {
    const c = state.customers.find(function (x) {
      return x.id === customerId;
    });
    if (!c) return;
    const m = mode === "receive" ? "receive" : "accrual";
    setPaymentSubmitting(false);
    if (m === "receive" && Number(c.due_amount || 0) <= 0) {
      toast(
        (M.payments && M.payments.noOutstandingDue) || "No outstanding due.",
        "err"
      );
      return;
    }

    state.payContext = { customer: c, mode: m };
    $("payCustomerId").value = c.id;
    $("payMode").value = m;

    const body = $("payModalBody");
    if (body) {
      body.classList.remove("pay-mode-accrual", "pay-mode-receive");
      body.classList.add(m === "accrual" ? "pay-mode-accrual" : "pay-mode-receive");
    }

    const pricing = computeMonthlyPricing(c);
    const due0 = Number(c.due_amount || 0);
    const monthly = pricing.finalMonthly;

    $("payBasePrice").textContent = formatPKR(pricing.base);
    if (pricing.areaRule) {
      const inherited =
        c.area_id && pricing.areaRule.area_id !== c.area_id;
      const parentName = inherited
        ? (areaById(pricing.areaRule.area_id) || {}).area_name || "parent"
        : "";
      $("payAreaDiscLabel").textContent =
        (pricing.areaRule.discount_type === "percentage"
          ? pricing.areaRule.discount_value + "% — "
          : "") +
        "− " +
        formatPKR(pricing.areaAmount) +
        (inherited ? " (rule on: " + parentName + ")" : "");
    } else {
      $("payAreaDiscLabel").textContent = "—";
    }
    if (pricing.indType && pricing.indType !== "none") {
      $("payIndDiscLabel").textContent =
        (pricing.indType === "percentage" ? pricing.indVal + "% — " : "") +
        "− " +
        formatPKR(pricing.indAmount) +
        (pricing.areaAmount > 0 ? " (stacks with area)" : "");
    } else {
      $("payIndDiscLabel").textContent = "—";
    }
    $("payMonthlyFinal").textContent = formatPKR(monthly);
    $("payExistingDue").textContent = formatPKR(due0);

    const recvFields = $("payReceiveFields");
    const confirmBtn = $("btnConfirmPayment");
    const lbl = $("btnConfirmPaymentLabel");
    const dueLab = $("payExistingDueLabel");
    const cardTitle = $("paySummaryCardTitle");

    if (m === "accrual") {
      if (recvFields) recvFields.hidden = true;
      if (dueLab) dueLab.textContent = "Current dues balance";
      $("paySummaryLastLabel").textContent = "New total dues";
      $("payGrandTotal").textContent = formatPKR(due0 + monthly);
      $("modalPaymentTitle").textContent = "Recharge (add to dues)";
      if (cardTitle) cardTitle.textContent = "Pricing breakdown";
      $("payExpiryHint").textContent =
        "Adds the discounted monthly fee to dues. Pick the recharge date (its calendar month appears on the invoice). Package Expiry is the same calendar date in the next month (e.g. 12 May → 12 June). The previous expiry is not used.";
      if (confirmBtn) {
        const ic = confirmBtn.querySelector("i");
        if (ic) ic.className = "fa-solid fa-calendar-plus";
      }
      if (lbl) lbl.textContent = "Record recharge (dues)";
      const prd = $("payRechargeDate");
      const td = todayISODate();
      if (prd) prd.value = td;
      syncPayNewExpiryFromRecharge();
    } else {
      if (recvFields) recvFields.hidden = false;
      buildPaymentMethodOptions($("payMethod"));
      if (dueLab) dueLab.textContent = "Outstanding dues";
      $("modalPaymentTitle").textContent = "Receive payment";
      if (cardTitle) cardTitle.textContent = "Collect payment";
      $("payExpiryHint").textContent =
        "Creates a payment record and reduces outstanding dues. Package expiry is unchanged. Pick the receive date (defaults to today).";
      $("payPaid").value = String(due0);
      $("payTxn").value = "";
      $("payNotes").value = "";
      const prcv = $("payReceiveDate");
      const tdRecv = todayISODate();
      if (prcv) prcv.value = tdRecv;
      if (confirmBtn) {
        const ic = confirmBtn.querySelector("i");
        if (ic) ic.className = "fa-solid fa-check";
      }
      if (lbl) lbl.textContent = "Record payment";
    }

    openBackdrop($("modalPayment"));
  }

  async function confirmAccrualRecharge() {
    const sb = getClient();
    const c = state.payContext && state.payContext.customer;
    if (!c) return;
    const pricing = computeMonthlyPricing(c);
    const monthly = pricing.finalMonthly;
    const due0 = Number(c.due_amount || 0);
    const newDue = due0 + monthly;
    const priorExpiry = c.package_expiry_date;
    const t = todayISODate();
    const rechargeDateRaw =
      ($("payRechargeDate") && $("payRechargeDate").value.trim()) || "";
    if (!rechargeDateRaw) {
      toast("Select a recharge date.", "err");
      return;
    }
    const rechargeDate = rechargeDateRaw.slice(0, 10);
    if (!parseISODateLocal(rechargeDate)) {
      toast("Select a valid recharge date.", "err");
      return;
    }
    const newExp = packageExpiryFromRechargeIso(rechargeDate);
    if (!newExp) {
      toast("Select a valid recharge date.", "err");
      return;
    }
    const statusUpdate = newExp >= t ? "active" : c.status;

    const rm = rechargeMonthLabelFromDate(rechargeDate);
    const invoiceDate = rechargeDate;

    const upd = await sb
      .from("customers")
      .update({
        due_amount: newDue,
        package_expiry_date: newExp,
        status: statusUpdate
      })
      .eq("id", c.id);

    if (upd.error) {
      toast(upd.error.message, "err");
      return;
    }

    const insCh = await sb
      .from("customer_due_charges")
      .insert({
        customer_id: c.id,
        amount: monthly,
        amount_remaining: due0 < 0 ? Math.max(0, roundMoney(monthly + due0)) : monthly,
        category: "monthly_recharge",
        recharge_month: rm,
        notes:
          "Recharge date " +
          formatDisplayDate(rechargeDate) +
          "; expiry " +
          formatDisplayDate(newExp) +
          "."
      })
      .select();
    if (insCh.error) {
      toast(insCh.error.message, "err");
      return;
    }
    if (insCh.data && insCh.data[0]) state.dueCharges.push(insCh.data[0]);

    toast((M.payments && M.payments.accrualSaved) || "Recharge saved.", "ok");
    closeBackdrop($("modalPayment"));
    await refresh();

    const fresh = state.customers.find(function (x) {
      return x.id === c.id;
    });
    openInvoiceModal({
      title: "Recharge invoice",
      invoiceNo: nextInvoiceNumber(),
      customer: fresh || c,
      kind: "receipt",
      paymentMode: "accrual",
      existingDueBefore: due0,
      paidAmount: monthly,
      newDueAfter: newDue,
      oldExpiry: priorExpiry || "",
      newExpiry: newExp,
      rechargeMonth: rm,
      paymentDate: invoiceDate,
      totalBill: newDue
    });
  }

  async function confirmReceivePayment() {
    const sb = getClient();
    const c = state.payContext && state.payContext.customer;
    if (!c) return;
    const paid = Number($("payPaid").value || 0);
    if (!(paid > 0)) {
      toast(M.payments.invalidAmount, "err");
      return;
    }
    if (!$("payMethod").value) {
      toast("Select a payment method.", "err");
      return;
    }
    const methodId = $("payMethod").value;
    const receiveRaw =
      ($("payReceiveDate") && $("payReceiveDate").value.trim()) || "";
    const t = todayISODate();
    let paymentDateIso = t;
    if (receiveRaw) {
      const head = receiveRaw.slice(0, 10);
      if (!parseISODateLocal(head)) {
        toast("Select a valid receive date.", "err");
        return;
      }
      paymentDateIso = head;
    }
    const paymentDateToken = parseISODateLocal(paymentDateIso);
    const duePaymentMonthLabel =
      "DUE PAYMENT " +
      monthTokenFromDate(paymentDateToken || parseISODateLocal(t) || new Date());

    if (customerHasDueLedger(c.id)) {
      await recalcCustomerDueFromLedger(sb, c.id);
    }
    const custRow = state.customers.find(function (x) {
      return x.id === c.id;
    });
    const due0 = Number((custRow || c).due_amount || 0);
    const alloc = allocatePayment(paid, due0, 0);
    const priorExpiry = c.package_expiry_date;
    const inv = nextInvoiceNumber();
    const isPartial = paid + 1e-9 < due0;
    const txn = $("payTxn").value.trim();
    if (
      !confirmDuplicateReceivePaymentAllowed({
        customer_id: c.id,
        payment_method_id: methodId,
        paid_amount: paid,
        payment_date: paymentDateIso,
        transaction_id: txn
      })
    ) {
      toast("Payment cancelled because it looks like a duplicate.", "err");
      return;
    }

    const payRow = {
      customer_id: c.id,
      payment_method_id: methodId,
      total_amount: due0,
      paid_amount: paid,
      payment_date: paymentDateIso,
      old_expiry_date: priorExpiry || null,
      new_expiry_date: priorExpiry || null,
      recharge_month: duePaymentMonthLabel,
      transaction_id: txn || null,
      notes: $("payNotes").value.trim() || null,
      invoice_number: inv,
      is_partial: isPartial,
      payment_status: isPartial ? "partial" : "completed"
    };

    const ins = await sb.from("payments").insert(payRow).select("id");
    if (ins.error) {
      toast(ins.error.message, "err");
      return;
    }
    const payId = ins.data && ins.data[0] && ins.data[0].id;
    const towardDue = alloc.towardDue;

    if (customerHasDueLedger(c.id) && payId) {
      try {
        await fifoAllocatePaymentToCharges(sb, c.id, payId, towardDue);
        await recalcCustomerDueFromLedger(sb, c.id);
        if (alloc.newDue < 0) {
          const creditRes = await sb
            .from("customers")
            .update({ due_amount: alloc.newDue })
            .eq("id", c.id);
          if (creditRes.error) throw creditRes.error;
          const cust = state.customers.find(function (x) {
            return x.id === c.id;
          });
          if (cust) cust.due_amount = alloc.newDue;
        }
      } catch (e) {
        toast(e.message || "Allocation failed.", "err");
        await sb.from("payments").delete().eq("id", payId);
        return;
      }
    } else {
      const upd = await sb
        .from("customers")
        .update({
          due_amount: alloc.newDue
        })
        .eq("id", c.id);

      if (upd.error) {
        toast(upd.error.message, "err");
        await sb.from("payments").delete().eq("id", payId);
        return;
      }
      const cust = state.customers.find(function (x) {
        return x.id === c.id;
      });
      if (cust) cust.due_amount = alloc.newDue;
    }

    toast(M.payments.saved, "ok");
    closeBackdrop($("modalPayment"));

    const receiptCtx = {
      title: "Payment receipt",
      invoiceNo: inv,
      customer: c,
      kind: "receipt",
      paymentMode: "receive",
      existingDueBefore: due0,
      paidAmount: paid,
      newDueAfter: alloc.newDue,
      oldExpiry: priorExpiry || "",
      newExpiry: priorExpiry || "",
      rechargeMonth: payRow.recharge_month,
      paymentDate: payRow.payment_date,
      totalBill: due0
    };

    await refresh();

    const fresh = state.customers.find(function (x) {
      return x.id === c.id;
    });
    receiptCtx.customer = fresh || c;
    receiptCtx.newDueAfter = fresh ? Number(fresh.due_amount || 0) : alloc.newDue;
    openInvoiceModal(receiptCtx);
  }

  async function confirmPayment() {
    if (state.paymentSubmitting) return;
    setPaymentSubmitting(true);
    try {
      const mode = $("payMode").value;
      if (mode === "accrual") {
        await confirmAccrualRecharge();
      } else {
        await confirmReceivePayment();
      }
    } finally {
      setPaymentSubmitting(false);
    }
  }

  function appendPricingRowsToInvoice(lines, pricing, customer) {
    let areaLabel = "Area discount";
    const hasAreaDiscount = Number(pricing.areaAmount || 0) > 0.000001;
    const hasIndividualDiscount = Number(pricing.indAmount || 0) > 0.000001;
    const hasAnyDiscount = Number(pricing.totalDiscount || 0) > 0.000001;
    if (
      pricing.areaRule &&
      customer &&
      customer.area_id &&
      pricing.areaRule.area_id !== customer.area_id
    ) {
      const pn =
        (areaById(pricing.areaRule.area_id) || {}).area_name || "parent area";
      areaLabel += " (inherited from " + escapeHtml(pn) + ")";
    }
    lines.push(
      "<tr><td>Package base price (monthly)</td><td class='td-num'>" +
        formatPKR(pricing.base) +
        "</td></tr>"
    );
    if (hasAreaDiscount) {
      lines.push(
        "<tr><td>" +
          areaLabel +
          (pricing.areaRule
            ? " (" + escapeHtml(pricing.areaRule.discount_type) + ")"
            : "") +
          "</td><td class='td-num'>− " +
          formatPKR(pricing.areaAmount) +
          "</td></tr>"
      );
    }
    if (hasIndividualDiscount) {
      lines.push(
        "<tr><td>Individual discount" +
          (pricing.indType && pricing.indType !== "none"
            ? " (" + escapeHtml(pricing.indType) + ")"
            : "") +
          "</td><td class='td-num'>− " +
          formatPKR(pricing.indAmount) +
          "</td></tr>"
      );
    }
    if (hasAnyDiscount) {
      lines.push(
        "<tr><td><strong>Total discount (stacked on base)</strong></td><td class='td-num'><strong>" +
          escapeHtml(pricing.appliedSource) +
          " — − " +
          formatPKR(pricing.totalDiscount) +
          "</strong></td></tr>"
      );
    }
    lines.push(
      "<tr><td><strong>Final monthly price</strong></td><td class='td-num'><strong>" +
        formatPKR(pricing.finalMonthly) +
        "</strong></td></tr>"
    );
  }

  function buildInvoiceHtml(ctx) {
    const c = ctx.customer;
    const pricing = computeMonthlyPricing(c);
    const lines = [];
    lines.push("<h3>" + escapeHtml(ctx.title) + "</h3>");
    lines.push(
      '<p class="muted">Invoice: <strong>' +
        escapeHtml(ctx.invoiceNo) +
        "</strong></p>"
    );
    lines.push("<hr/>");
    lines.push("<p><strong>Customer:</strong> " + escapeHtml(c.full_name) + "</p>");
    lines.push("<p><strong>User ID:</strong> " + escapeHtml(c.pppoe_id) + "</p>");
    lines.push("<p><strong>Phone:</strong> " + escapeHtml(c.phone || "") + "</p>");
    lines.push("<p><strong>Address:</strong> " + escapeHtml(c.address || "") + "</p>");
    const ar = areaMainSubForInvoice(c);
    lines.push("<p><strong>Main area:</strong> " + escapeHtml(ar.main) + "</p>");
    lines.push("<p><strong>Sub-area:</strong> " + escapeHtml(ar.sub) + "</p>");
    let pkgText = "—";
    if (c.packages) {
      pkgText = c.packages.package_name || "—";
      if (c.packages.speed_mbps != null && c.packages.speed_mbps !== "") {
        pkgText += " (" + String(c.packages.speed_mbps) + " Mbps)";
      }
    }
    lines.push("<p><strong>Package:</strong> " + escapeHtml(pkgText) + "</p>");
    let dateLabel = "Date";
    let dateVal = formatDisplayDate(todayISODate());
    if (ctx.kind === "receipt" && ctx.paymentDate) {
      dateLabel =
        ctx.paymentMode === "accrual" ? "Recharge date" : "Payment date";
      dateVal = formatDisplayDate(ctx.paymentDate);
    } else if (ctx.kind === "due") {
      dateLabel = "Statement date";
      dateVal = formatDisplayDate(todayISODate());
    } else if (ctx.kind === "summary") {
      dateLabel = "Quote date";
      dateVal = formatDisplayDate(todayISODate());
    } else if (ctx.kind === "receipt") {
      dateLabel = "Payment date";
      dateVal = formatDisplayDate(todayISODate());
    }
    lines.push(
      "<p><strong>" + escapeHtml(dateLabel) + ":</strong> " + escapeHtml(dateVal) + "</p>"
    );
    let period = "—";
    if (ctx.kind === "summary") {
      period = monthTokenFromDate(new Date());
    } else {
      period = invoiceRechargeMonthPeriod(ctx);
    }
    lines.push("<p><strong>Period / recharge month:</strong> " + escapeHtml(period) + "</p>");
    if (ctx.kind === "due") {
      lines.push(
        "<p><strong>Expiry date:</strong> " +
          escapeHtml(formatDisplayDate(c.package_expiry_date)) +
          "</p>"
      );
    } else {
      lines.push(
        "<p><strong>Package expiry:</strong> " +
          escapeHtml(formatDisplayDate(c.package_expiry_date)) +
          "</p>"
      );
    }
    lines.push("<hr/>");
    if (ctx.kind === "due") {
      lines.push(
        "<table><thead><tr><th>Description</th><th class='td-num'>Charges</th><th class='td-num'>Payments Received</th><th class='td-num'>Outstanding Balance</th></tr></thead><tbody>"
      );
      appendDueStatementDetailRows(lines, c.id);
    } else {
      lines.push(
        "<table><thead><tr><th>Description</th><th class='td-num'>Amount</th></tr></thead><tbody>"
      );
    if (ctx.kind === "summary") {
      appendPricingRowsToInvoice(lines, pricing, c);
      lines.push(
        "<tr><td>Existing due</td><td class='td-num'>" +
          formatPKR(ctx.existingDue) +
          "</td></tr>"
      );
      lines.push(
        "<tr><td><strong>Total if renewing now (due + monthly)</strong></td><td class='td-num'><strong>" +
          formatPKR(ctx.grandTotal) +
          "</strong></td></tr>"
      );
    } else if (ctx.kind === "receipt") {
      if (ctx.paymentMode === "accrual") {
        appendPricingRowsToInvoice(lines, pricing, c);
        lines.push(
          "<tr><td>Previous dues balance</td><td class='td-num'>" +
            formatPKR(ctx.existingDueBefore) +
            "</td></tr>"
        );
        lines.push(
          "<tr><td><strong>Monthly fee added to dues (recharge)</strong></td><td class='td-num'><strong>" +
            formatPKR(ctx.paidAmount) +
            "</strong></td></tr>"
        );
        lines.push(
          "<tr><td>New total dues</td><td class='td-num'>" +
            formatPKR(ctx.newDueAfter) +
            "</td></tr>"
        );
        lines.push(
          "<tr><td>Old package expiry</td><td class='td-num'>" +
            escapeHtml(formatDisplayDate(ctx.oldExpiry)) +
            "</td></tr>"
        );
        lines.push(
          "<tr><td>Package Expiry</td><td class='td-num'>" +
            escapeHtml(formatDisplayDate(ctx.newExpiry)) +
            "</td></tr>"
        );
        lines.push(
          "<tr><td>Recharge month</td><td class='td-num'>" +
            escapeHtml(invoiceRechargeMonthPeriod(ctx)) +
            "</td></tr>"
        );
      } else if (ctx.paymentMode === "receive" || ctx.paymentMode === "due") {
        lines.push(
          "<tr><td>Outstanding before</td><td class='td-num'>" +
            formatPKR(ctx.existingDueBefore) +
            "</td></tr>"
        );
        lines.push(
          "<tr><td><strong>Amount received</strong></td><td class='td-num'><strong>" +
            formatPKR(ctx.paidAmount) +
            "</strong></td></tr>"
        );
        lines.push(
          "<tr><td>Outstanding after payment</td><td class='td-num'>" +
            formatPKR(ctx.newDueAfter) +
            "</td></tr>"
        );
        lines.push(
          "<tr><td colspan='2'><span class='muted'>Package expiry unchanged for due-only collection.</span></td></tr>"
        );
      } else {
        appendPricingRowsToInvoice(lines, pricing, c);
        lines.push(
          "<tr><td>Bill total (due + monthly)</td><td class='td-num'>" +
            formatPKR(ctx.totalBill) +
            "</td></tr>"
        );
        lines.push(
          "<tr><td>Existing due (before payment)</td><td class='td-num'>" +
            formatPKR(ctx.existingDueBefore) +
            "</td></tr>"
        );
        lines.push(
          "<tr><td><strong>Amount paid</strong></td><td class='td-num'><strong>" +
            formatPKR(ctx.paidAmount) +
            "</strong></td></tr>"
        );
        lines.push(
          "<tr><td>Outstanding after payment</td><td class='td-num'>" +
            formatPKR(ctx.newDueAfter) +
            "</td></tr>"
        );
        lines.push(
          "<tr><td>Old expiry</td><td class='td-num'>" +
            escapeHtml(formatDisplayDate(ctx.oldExpiry)) +
            "</td></tr>"
        );
        lines.push(
          "<tr><td>Package Expiry</td><td class='td-num'>" +
            escapeHtml(formatDisplayDate(ctx.newExpiry)) +
            "</td></tr>"
        );
        lines.push(
          "<tr><td>Recharge month</td><td class='td-num'>" +
            escapeHtml(invoiceRechargeMonthPeriod(ctx)) +
            "</td></tr>"
        );
      }
    }
    }

    lines.push("</tbody></table>");
    lines.push(
      "<p class='muted invoice-generated'>Generated on " +
        escapeHtml(formatDisplayDate(todayISODate())) +
        "</p>"
    );
    return lines.join("");
  }

  function openInvoiceModal(ctx) {
    state.invoiceContext = ctx;
    $("invoiceModalTitle").textContent = ctx.title;
    $("invoiceRoot").innerHTML = buildInvoiceHtml(ctx);
    openBackdrop($("modalInvoice"));
  }

  function waUrlForText(text) {
    return "https://web.whatsapp.com/send?text=" + encodeURIComponent(text);
  }

  function invoicePlainText(ctx) {
    const c = ctx.customer;
    const lines = [];
    lines.push(ctx.title);
    lines.push("Invoice: " + ctx.invoiceNo);
    lines.push("Customer: " + c.full_name);
    lines.push("User ID: " + c.pppoe_id);
    lines.push("Phone: " + (c.phone || ""));
    const arT = areaMainSubForInvoice(c);
    lines.push("Main area: " + arT.main);
    lines.push("Sub-area: " + arT.sub);
    let pkgT = "—";
    if (c.packages) {
      pkgT = c.packages.package_name || "—";
      if (c.packages.speed_mbps != null && c.packages.speed_mbps !== "") {
        pkgT += " (" + String(c.packages.speed_mbps) + " Mbps)";
      }
    }
    lines.push("Package: " + pkgT);
    let dLab = "Date";
    let dVal = formatDisplayDate(todayISODate());
    if (ctx.kind === "receipt" && ctx.paymentDate) {
      dLab = ctx.paymentMode === "accrual" ? "Recharge date" : "Payment date";
      dVal = formatDisplayDate(ctx.paymentDate);
    } else if (ctx.kind === "due") {
      dLab = "Statement date";
      dVal = formatDisplayDate(todayISODate());
    } else if (ctx.kind === "summary") {
      dLab = "Quote date";
      dVal = formatDisplayDate(todayISODate());
    } else if (ctx.kind === "receipt") {
      dLab = "Payment date";
      dVal = formatDisplayDate(todayISODate());
    }
    lines.push(dLab + ": " + dVal);
    let perT = "—";
    if (ctx.kind === "summary") {
      perT = monthTokenFromDate(new Date());
    } else {
      perT = invoiceRechargeMonthPeriod(ctx);
    }
    lines.push("Period / recharge month: " + perT);
    if (ctx.kind === "due") {
      lines.push("Expiry date: " + formatDisplayDate(c.package_expiry_date));
    } else {
      lines.push("Package expiry: " + formatDisplayDate(c.package_expiry_date));
    }
    if (ctx.kind === "due") {
      appendDueStatementPlainLines(lines, c.id);
    } else if (ctx.kind === "summary") {
      lines.push("Monthly after discounts: PKR " + String(ctx.monthlyFinal));
      lines.push("Existing due: PKR " + String(ctx.existingDue));
      lines.push("Total if renewing now: PKR " + String(ctx.grandTotal));
    } else if (ctx.kind === "receipt") {
      if (ctx.paymentMode === "accrual") {
        lines.push("Previous dues: PKR " + String(ctx.existingDueBefore));
        lines.push("Monthly added to dues: PKR " + String(ctx.paidAmount));
        lines.push("New dues: PKR " + String(ctx.newDueAfter));
        lines.push("Old expiry: " + formatDisplayDate(ctx.oldExpiry));
        lines.push("Package Expiry: " + formatDisplayDate(ctx.newExpiry));
        lines.push("Recharge month: " + invoiceRechargeMonthPeriod(ctx));
      } else if (ctx.paymentMode === "receive" || ctx.paymentMode === "due") {
        lines.push("Due before: PKR " + String(ctx.existingDueBefore));
        lines.push("Paid: PKR " + String(ctx.paidAmount));
        lines.push("Due after: PKR " + String(ctx.newDueAfter));
      } else {
        lines.push("Bill total: PKR " + String(ctx.totalBill));
        lines.push("Paid: PKR " + String(ctx.paidAmount));
        lines.push("New due: PKR " + String(ctx.newDueAfter));
        lines.push("Old expiry: " + formatDisplayDate(ctx.oldExpiry));
        lines.push("Package Expiry: " + formatDisplayDate(ctx.newExpiry));
        lines.push("Recharge month: " + invoiceRechargeMonthPeriod(ctx));
      }
    }
    lines.push("— ISP Billing");
    return lines.join("\n");
  }

  function downloadInvoicePdf() {
    const el = $("invoiceRoot");
    if (!el || !window.html2pdf) {
      toast(M.generic.pdfError, "err");
      return;
    }
    invoicePdfWorker(el)
      .save()
      .catch(function () {
        toast(M.generic.pdfError, "err");
      });
  }

  async function shareInvoiceWhatsApp() {
    const ctx = state.invoiceContext;
    const el = $("invoiceRoot");
    if (!ctx || !el) return;
    if (!window.html2pdf) {
      toast(M.generic.pdfError, "err");
      return;
    }
    const filename = (ctx.invoiceNo || "invoice") + ".pdf";
    try {
      const blob = await invoicePdfWorker(el).outputPdf("blob");
      if (!blob) throw new Error("no pdf");

      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename,
          text: "Invoice"
        });
        toast((M.generic && M.generic.invoicePdfShared) || "Invoice ready to share.", "ok");
        return;
      }

      if (navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "application/pdf": blob })
          ]);
          window.open(
            waUrlForText(
              "Invoice PDF is copied. In WhatsApp Web, open the chat and press Ctrl+V to paste the file, or use Attach → Document."
            ),
            "_blank",
            "noopener,noreferrer"
          );
          toast(
            (M.generic && M.generic.invoicePdfClipboard) ||
              "Invoice PDF copied. Paste in WhatsApp (Ctrl+V) or attach.",
            "ok"
          );
          return;
        } catch (clipErr) {
          /* fall through to download */
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      window.open(
        waUrlForText(
          "Invoice PDF saved to your Downloads folder. In WhatsApp Web, use Attach → Document to send the file."
        ),
        "_blank",
        "noopener,noreferrer"
      );
      toast(
        (M.generic && M.generic.invoicePdfDownload) ||
          "Invoice PDF saved — attach it in WhatsApp.",
        "ok"
      );
    } catch (e) {
      toast(
        (M.generic && M.generic.invoicePdfError) ||
          e.message ||
          "Could not create invoice PDF.",
        "err"
      );
    }
  }

  function invoicePdfWorker(el) {
    const ctx = state.invoiceContext;
    const opt = {
      margin: 10,
      filename: ((ctx && ctx.invoiceNo) || "invoice") + ".pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    };
    return window.html2pdf().set(opt).from(el);
  }

  function reportHtmlToPdf(htmlInner, filename) {
    if (!window.html2pdf) {
      toast(M.generic.pdfError, "err");
      return Promise.reject(new Error("no html2pdf"));
    }
    const holder = document.createElement("div");
    holder.className = "invoice";
    holder.style.padding = "16px";
    holder.innerHTML = htmlInner;
    document.body.appendChild(holder);
    const opt = {
      margin: 10,
      filename: filename || "report.pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    };
    return window
      .html2pdf()
      .set(opt)
      .from(holder)
      .save()
      .catch(function () {
        toast(M.generic.pdfError, "err");
      })
      .finally(function () {
        holder.remove();
      });
  }

  function populateRepCustomerSelect() {
    const sel = $("repCustomerSelect");
    if (!sel) return;
    const prev = sel.value;
    const rows = state.customers
      .slice()
      .sort(function (a, b) {
        return String(a.full_name || "").localeCompare(String(b.full_name || ""));
      });
    const opts = ['<option value="">— Select customer —</option>'];
    rows.forEach(function (c) {
      opts.push(
        '<option value="' +
          escapeHtml(c.id) +
          '">' +
          escapeHtml((c.full_name || "") + " (" + (c.pppoe_id || "") + ")") +
          "</option>"
      );
    });
    sel.innerHTML = opts.join("");
    if (prev && rows.some(function (x) { return x.id === prev; })) {
      sel.value = prev;
    }
  }

  function reportRangeSubtitle(r) {
    return (
      "Range: " +
      escapeHtml(formatDisplayDate(r.from)) +
      " – " +
      escapeHtml(formatDisplayDate(r.to))
    );
  }

  function buildIndividualCustomerReportHtml(customerId) {
    const c = state.customers.find(function (x) {
      return x.id === customerId;
    });
    if (!c) return "";
    const chRows = dueChargesForCustomer(customerId).sort(function (a, b) {
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
    const payRows = state.payments
      .filter(function (p) {
        return p.customer_id === customerId;
      })
      .sort(function (a, b) {
        const da = paymentDateISO(a);
        const db = paymentDateISO(b);
        if (da !== db) return da < db ? 1 : -1;
        return String(b.invoice_number || "").localeCompare(String(a.invoice_number || ""));
      });
    const lines = [];
    lines.push("<h2>Individual customer report</h2>");
    lines.push(
      "<p class=\"muted\">Generated " +
        escapeHtml(formatDisplayDate(todayISODate())) +
        "</p>"
    );
    lines.push("<h3>Customer</h3>");
    lines.push("<table><tbody>");
    lines.push(
      "<tr><td><strong>Name</strong></td><td>" +
        escapeHtml(c.full_name || "") +
        "</td></tr>"
    );
    lines.push(
      "<tr><td><strong>User ID</strong></td><td>" +
        escapeHtml(String(c.pppoe_id || "")) +
        "</td></tr>"
    );
    lines.push(
      "<tr><td>Phone</td><td>" + escapeHtml(c.phone || "—") + "</td></tr>"
    );
    lines.push(
      "<tr><td>Email</td><td>" + escapeHtml(c.email || "—") + "</td></tr>"
    );
    lines.push(
      "<tr><td>Address</td><td>" + escapeHtml(c.address || "—") + "</td></tr>"
    );
    lines.push(
      "<tr><td>Area</td><td>" +
        escapeHtml(c.areas ? areaLabelTree(c.areas) : "—") +
        "</td></tr>"
    );
    lines.push(
      "<tr><td>Status</td><td>" + escapeHtml(c.status || "") + "</td></tr>"
    );
    lines.push(
      "<tr><td>Account created</td><td>" +
        escapeHtml(formatDisplayDate(String(c.created_at || "").slice(0, 10))) +
        "</td></tr>"
    );
    lines.push("</tbody></table>");

    lines.push("<h3>Installation &amp; package</h3>");
    lines.push("<table><tbody>");
    lines.push(
      "<tr><td>Installation date</td><td>" +
        escapeHtml(formatDisplayDate(c.installation_date)) +
        "</td></tr>"
    );
    lines.push(
      "<tr><td>Package expiry</td><td>" +
        escapeHtml(formatDisplayDate(c.package_expiry_date)) +
        "</td></tr>"
    );
    lines.push(
      "<tr><td>Current package</td><td>" +
        escapeHtml(c.packages ? c.packages.package_name || "—" : "—") +
        "</td></tr>"
    );
    lines.push(
      "<tr><td>Speed</td><td>" +
        escapeHtml(
          c.packages && c.packages.speed_mbps != null && c.packages.speed_mbps !== ""
            ? String(c.packages.speed_mbps) + " Mbps"
            : "—"
        ) +
        "</td></tr>"
    );
    lines.push(
      "<tr><td>List price</td><td>" +
        escapeHtml(c.packages ? formatPKR(c.packages.price) : "—") +
        "</td></tr>"
    );
    lines.push(
      "<tr><td>Individual discount</td><td>" +
        escapeHtml(c.individual_discount_type || "none") +
        " " +
        escapeHtml(String(c.individual_discount_value != null ? c.individual_discount_value : "")) +
        "</td></tr>"
    );
    lines.push("</tbody></table>");
    lines.push(
      "<p class=\"muted\"><strong>Note:</strong> Only the <em>current</em> package is stored on the customer. Previous package assignments are not kept in this app.</p>"
    );

    lines.push("<h3>Due ledger</h3>");
    lines.push(
      "<p>Total outstanding: <strong>" +
        escapeHtml(formatPKR(Number(c.due_amount || 0))) +
        "</strong></p>"
    );
    lines.push(
      "<table><thead><tr><th>Date</th><th>Type</th><th>Original</th><th>Outstanding</th><th>Period</th><th>Notes</th></tr></thead><tbody>"
    );
    if (!chRows.length) {
      lines.push("<tr><td colspan='6' class='muted'>No due lines.</td></tr>");
    } else {
      chRows.forEach(function (r) {
        lines.push(
          "<tr><td>" +
            escapeHtml(formatDisplayDate(String(r.created_at || "").slice(0, 10))) +
            "</td><td>" +
            escapeHtml(dueCategoryLabel(r.category)) +
            "</td><td class=\"td-num\">" +
            escapeHtml(formatPKR(r.amount)) +
            "</td><td class=\"td-num\">" +
            escapeHtml(formatPKR(r.amount_remaining)) +
            "</td><td>" +
            escapeHtml(r.recharge_month || "—") +
            "</td><td>" +
            escapeHtml(r.notes || "—") +
            "</td></tr>"
        );
      });
    }
    lines.push("</tbody></table>");

    lines.push("<h3>Payments (all time)</h3>");
    lines.push(
      "<table><thead><tr><th>Date</th><th>Invoice</th><th>Paid</th><th>Total</th><th>Method</th><th>Partial</th><th>Recharge line</th><th>Notes</th></tr></thead><tbody>"
    );
    if (!payRows.length) {
      lines.push("<tr><td colspan='8' class='muted'>No payments.</td></tr>");
    } else {
      payRows.forEach(function (p) {
        const partial =
          p.is_partial === true ||
          p.is_partial === "true" ||
          p.is_partial === 1 ||
          p.is_partial === "1"
            ? "Yes"
            : "No";
        lines.push(
          "<tr><td>" +
            escapeHtml(formatDisplayDate(paymentDateISO(p))) +
            "</td><td>" +
            escapeHtml(String(p.invoice_number || "")) +
            "</td><td class=\"td-num\">" +
            escapeHtml(formatPKR(Number(p.paid_amount || 0))) +
            "</td><td class=\"td-num\">" +
            escapeHtml(formatPKR(Number(p.total_amount || 0))) +
            "</td><td>" +
            escapeHtml(
              String((p.payment_methods && p.payment_methods.method_name) || "")
            ) +
            "</td><td>" +
            escapeHtml(partial) +
            "</td><td>" +
            escapeHtml(p.recharge_month || "—") +
            "</td><td>" +
            escapeHtml(p.notes || "—") +
            "</td></tr>"
        );
      });
    }
    lines.push("</tbody></table>");
    return lines.join("");
  }

  function exportIndividualCustomerCsv() {
    const cid = $("repCustomerSelect") && $("repCustomerSelect").value;
    if (!cid) {
      toast("Select a customer.", "err");
      return;
    }
    const c = state.customers.find(function (x) {
      return x.id === cid;
    });
    if (!c) {
      toast("Customer not found.", "err");
      return;
    }
    const lines = [];
    lines.push("section,field,value");
    lines.push(["profile", "full_name", csvEscape(c.full_name)].join(","));
    lines.push(["profile", "user_id", csvEscape(c.pppoe_id)].join(","));
    lines.push(["profile", "phone", csvEscape(c.phone)].join(","));
    lines.push(["profile", "installation_date", csvEscape(c.installation_date)].join(","));
    lines.push(["profile", "package_expiry", csvEscape(c.package_expiry_date)].join(","));
    lines.push(
      ["profile", "package", csvEscape(c.packages ? c.packages.package_name : "")].join(",")
    );
    lines.push(["profile", "due_total", csvEscape(c.due_amount)].join(","));
    lines.push("");
    lines.push("due_lines,date,type,original,remaining,period,notes");
    dueChargesForCustomer(cid)
      .sort(function (a, b) {
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      })
      .forEach(function (r) {
        lines.push(
          [
            "due",
            csvEscape(formatDisplayDate(String(r.created_at || "").slice(0, 10))),
            csvEscape(dueCategoryLabel(r.category)),
            csvEscape(r.amount),
            csvEscape(r.amount_remaining),
            csvEscape(r.recharge_month),
            csvEscape(r.notes)
          ].join(",")
        );
      });
    lines.push("");
    lines.push("payments,date,invoice,paid,total,method,partial,recharge_line,notes");
    state.payments
      .filter(function (p) {
        return p.customer_id === cid;
      })
      .sort(function (a, b) {
        return String(paymentDateISO(a)).localeCompare(String(paymentDateISO(b)));
      })
      .forEach(function (p) {
        const partial =
          p.is_partial === true ||
          p.is_partial === "true" ||
          p.is_partial === 1 ||
          p.is_partial === "1"
            ? "yes"
            : "no";
        lines.push(
          [
            "payment",
            csvEscape(paymentDateISO(p)),
            csvEscape(p.invoice_number),
            csvEscape(p.paid_amount),
            csvEscape(p.total_amount),
            csvEscape((p.payment_methods && p.payment_methods.method_name) || ""),
            csvEscape(partial),
            csvEscape(p.recharge_month),
            csvEscape(p.notes)
          ].join(",")
        );
      });
    const safe = String(c.pppoe_id || "customer").replace(/[^a-zA-Z0-9-_]+/g, "_");
    downloadText("customer-report-" + safe + ".csv", lines.join("\n"), "text/csv;charset=utf-8");
    toast(M.reports.exported, "ok");
  }

  function exportIndividualCustomerPdf() {
    const cid = $("repCustomerSelect") && $("repCustomerSelect").value;
    if (!cid) {
      toast("Select a customer.", "err");
      return;
    }
    const c = state.customers.find(function (x) {
      return x.id === cid;
    });
    if (!c) {
      toast("Customer not found.", "err");
      return;
    }
    const html = buildIndividualCustomerReportHtml(cid);
    const safe = String(c.pppoe_id || "customer").replace(/[^a-zA-Z0-9-_]+/g, "_");
    reportHtmlToPdf(html, "customer-report-" + safe + ".pdf").then(function () {
      toast(M.reports.exported, "ok");
    });
  }

  function openBillingSummaryInvoice(customerId) {
    const c = state.customers.find(function (x) {
      return x.id === customerId;
    });
    if (!c) return;
    const pricing = computeMonthlyPricing(c);
    const due0 = Number(c.due_amount || 0);
    const grand = due0 + pricing.finalMonthly;
    openInvoiceModal({
      title: "Billing summary",
      invoiceNo: nextInvoiceNumber(),
      customer: c,
      kind: "summary",
      grandTotal: grand,
      existingDue: due0,
      monthlyFinal: pricing.finalMonthly
    });
  }

  function openCustomerInvoice(customerId) {
    const c = state.customers.find(function (x) {
      return x.id === customerId;
    });
    if (!c) return;
    if (Number(c.due_amount || 0) > 0) {
      openDueInvoice(customerId);
      return;
    }
    openBillingSummaryInvoice(customerId);
  }

  function openDueInvoice(customerId) {
    const c = state.customers.find(function (x) {
      return x.id === customerId;
    });
    if (!c) return;
    openInvoiceModal({
      title: "Due statement",
      invoiceNo: nextInvoiceNumber(),
      customer: c,
      kind: "due",
      amountDue: Number(c.due_amount || 0)
    });
  }

  function duesWhatsApp(customerId) {
    const c = state.customers.find(function (x) {
      return x.id === customerId;
    });
    if (!c) return;
    const msg =
      "Dear " +
      c.full_name +
      ", your ISP account (User ID " +
      c.pppoe_id +
      ") has an outstanding balance of PKR " +
      String(c.due_amount) +
      ". Please clear dues at your earliest. Thank you.";
    window.open(waUrlForText(msg), "_blank", "noopener,noreferrer");
  }

  async function refresh() {
    try {
      await loadAll();
      renderDashboard();
      renderCustomerFilters();
      renderCustomerPackageFilter();
      renderDuesAreaFilter();
      renderCustomersTable();
      renderDues();
      renderPackages();
      renderPm();
      renderAreas();
      renderDiscounts();
      renderCollection();
      renderReportsInline();
      renderDueLedgerCustomerSelect();
    } catch (e) {
      toast(e.message || M.generic.unexpected, "err");
    }
  }

  function paymentDateISO(p) {
    const s = String(p.payment_date || "");
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  function renderCollection() {
    const root = $("collectionWeekRoot");
    if (!root) return;
    if (!state.payments.length) {
      root.innerHTML = '<p class="muted">No payment records yet.</p>';
      return;
    }
    const byDay = {};
    state.payments.forEach(function (p) {
      const d = paymentDateISO(p);
      if (!d) return;
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(p);
    });
    const days = Object.keys(byDay).sort(function (a, b) {
      if (a < b) return 1;
      if (a > b) return -1;
      return 0;
    });
    if (!days.length) {
      root.innerHTML = '<p class="muted">No payment records yet.</p>';
      return;
    }
    const t = todayISODate();
    const parts = [];
    for (let di = 0; di < days.length; di += 1) {
      const iso = days[di];
      const dayPayments = byDay[iso];
      dayPayments.sort(function (a, b) {
        return String(a.invoice_number || "").localeCompare(
          String(b.invoice_number || ""),
          undefined,
          { numeric: true }
        );
      });
      let dayTotal = 0;
      dayPayments.forEach(function (p) {
        dayTotal += Number(p.paid_amount || 0);
      });
      const title =
        iso === t ? formatDisplayDate(iso) + " — Today" : formatDisplayDate(iso);
      const tableBody = dayPayments
        .map(function (p) {
          const cust = p.customers || {};
          const partial =
            p.is_partial === true ||
            p.is_partial === "true" ||
            p.is_partial === 1 ||
            p.is_partial === "1"
              ? "Yes"
              : "No";
          return (
            "<tr><td>" +
            escapeHtml(String(p.invoice_number || "")) +
            "</td><td>" +
            escapeHtml(String(cust.full_name || "")) +
            "</td><td>" +
            escapeHtml(String(cust.pppoe_id || "")) +
            '</td><td class="td-num">' +
            escapeHtml(formatPKR(Number(p.paid_amount || 0))) +
            "</td><td>" +
            escapeHtml(
              String((p.payment_methods && p.payment_methods.method_name) || "")
            ) +
            "</td><td>" +
            escapeHtml(partial) +
            '</td><td class="no-print">' +
            '<button type="button" class="btn danger" data-col-pay-del="' +
            escapeHtml(String(p.id)) +
            '">Delete</button></td></tr>'
          );
        })
        .join("");
      parts.push(
        '<div class="collection-day">' +
          '<div class="collection-day-head">' +
          '<h3 class="collection-day-title">' +
          escapeHtml(title) +
          "</h3>" +
          '<div class="collection-day-total">Day total: ' +
          escapeHtml(formatPKR(dayTotal)) +
          "</div></div>" +
          '<div class="table-wrap">' +
          "<table><thead><tr>" +
          "<th>Invoice</th><th>Customer</th><th>User ID</th><th>Paid</th><th>Method</th><th>Partial</th><th class='no-print'>Actions</th>" +
          "</tr></thead><tbody>" +
          tableBody +
          "</tbody></table></div></div>"
      );
    }
    root.innerHTML = parts.join("");
  }

  function reportRangeSilent() {
    const repFrom = $("repFrom");
    const repTo = $("repTo");
    if (!repFrom || !repTo) return null;
    const from = repFrom.value;
    const to = repTo.value;
    if (!from || !to || from > to) return null;
    return { from: from, to: to };
  }

  function renderReportsInline() {
    populateRepCustomerSelect();
    const tbC = $("tbodyRepCollection");
    const tbU = $("tbodyRepCustomers");
    const tbE = $("tbodyRepExpiry");
    const tbD = $("tbodyRepDue");
    const sumEl = $("repSummaryCollection");
    if (!tbC || !tbU || !tbE || !tbD) return;
    const r = reportRangeSilent();
    if (!r) {
      tbC.innerHTML = "";
      tbU.innerHTML = "";
      tbE.innerHTML = "";
      tbD.innerHTML = "";
      if (sumEl) {
        sumEl.textContent =
          "Select a valid date range (from on or before to) to load previews.";
      }
      return;
    }
    const payRows = state.payments
      .filter(function (p) {
        const pd = paymentDateISO(p);
        return pd >= r.from && pd <= r.to;
      })
      .sort(function (a, b) {
        const da = paymentDateISO(a);
        const db = paymentDateISO(b);
        if (da !== db) return da < db ? -1 : 1;
        return String(a.invoice_number || "").localeCompare(
          String(b.invoice_number || ""),
          undefined,
          { numeric: true }
        );
      });
    let colSum = 0;
    tbC.innerHTML = payRows
      .map(function (p) {
        colSum += Number(p.paid_amount || 0);
        const cust = p.customers || {};
        const partial =
          p.is_partial === true ||
          p.is_partial === "true" ||
          p.is_partial === 1 ||
          p.is_partial === "1"
            ? "Yes"
            : "No";
        return (
          "<tr><td>" +
          escapeHtml(formatDisplayDate(paymentDateISO(p))) +
          "</td><td>" +
          escapeHtml(String(p.invoice_number || "")) +
          "</td><td>" +
          escapeHtml(String(cust.full_name || "")) +
          "</td><td>" +
          escapeHtml(String(cust.pppoe_id || "")) +
          '</td><td class="td-num">' +
          escapeHtml(formatPKR(Number(p.paid_amount || 0))) +
          "</td><td>" +
          escapeHtml(
            String((p.payment_methods && p.payment_methods.method_name) || "")
          ) +
          "</td><td>" +
          escapeHtml(partial) +
          "</td></tr>"
        );
      })
      .join("");
    if (!payRows.length) {
      tbC.innerHTML =
        "<tr><td colspan='7' class='muted'>No payments in this range.</td></tr>";
    }
    if (sumEl) {
      sumEl.textContent =
        "Total collected in range: " +
        formatPKR(colSum) +
        " (" +
        String(payRows.length) +
        " payment" +
        (payRows.length === 1 ? "" : "s") +
        ").";
    }

    const custRows = state.customers
      .filter(function (c) {
        if (!c.created_at) return false;
        const cd = String(c.created_at).slice(0, 10);
        return cd >= r.from && cd <= r.to;
      })
      .sort(function (a, b) {
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });
    tbU.innerHTML = custRows
      .map(function (c) {
        return (
          "<tr><td>" +
          escapeHtml(String(c.pppoe_id || "")) +
          "</td><td>" +
          escapeHtml(String(c.full_name || "")) +
          "</td><td>" +
          escapeHtml(String(c.phone || "")) +
          "</td><td>" +
          escapeHtml(c.areas ? areaLabelTree(c.areas) : "") +
          "</td><td>" +
          escapeHtml(c.packages ? c.packages.package_name : "") +
          "</td><td>" +
          escapeHtml(formatDisplayDate(c.package_expiry_date)) +
          '</td><td class="td-num">' +
          escapeHtml(String(c.due_amount != null ? c.due_amount : "")) +
          "</td><td>" +
          badgeForStatus(c.status) +
          "</td></tr>"
        );
      })
      .join("");
    if (!custRows.length) {
      tbU.innerHTML =
        "<tr><td colspan='8' class='muted'>No customers created in this range.</td></tr>";
    }

    const expRows = state.customers
      .filter(function (c) {
        if (!c.package_expiry_date) return false;
        return c.package_expiry_date >= r.from && c.package_expiry_date <= r.to;
      })
      .sort(function (a, b) {
        return String(a.package_expiry_date || "").localeCompare(
          String(b.package_expiry_date || "")
        );
      });
    tbE.innerHTML = expRows
      .map(function (c) {
        return (
          "<tr><td>" +
          escapeHtml(String(c.pppoe_id || "")) +
          "</td><td>" +
          escapeHtml(String(c.full_name || "")) +
          "</td><td>" +
          escapeHtml(String(c.phone || "")) +
          "</td><td>" +
          escapeHtml(formatDisplayDate(c.package_expiry_date)) +
          "</td><td>" +
          badgeForStatus(c.status) +
          "</td></tr>"
        );
      })
      .join("");
    if (!expRows.length) {
      tbE.innerHTML =
        "<tr><td colspan='5' class='muted'>No expiries in this range.</td></tr>";
    }

    const dueRows = state.customers
      .filter(function (c) {
        return Number(c.due_amount || 0) > 0;
      })
      .sort(function (a, b) {
        return Number(b.due_amount || 0) - Number(a.due_amount || 0);
      });
    tbD.innerHTML = dueRows
      .map(function (c) {
        return (
          "<tr><td>" +
          escapeHtml(String(c.pppoe_id || "")) +
          "</td><td>" +
          escapeHtml(String(c.full_name || "")) +
          "</td><td>" +
          escapeHtml(String(c.phone || "")) +
          '</td><td class="td-num">' +
          escapeHtml(String(c.due_amount != null ? c.due_amount : "")) +
          "</td><td>" +
          escapeHtml(formatDisplayDate(c.package_expiry_date)) +
          "</td><td>" +
          badgeForStatus(c.status) +
          "</td></tr>"
        );
      })
      .join("");
    if (!dueRows.length) {
      tbD.innerHTML =
        "<tr><td colspan='6' class='muted'>No customers with a due balance.</td></tr>";
    }
  }

  function reportRange() {
    const from = $("repFrom").value;
    const to = $("repTo").value;
    if (!from || !to || from > to) {
      toast(M.reports.rangeInvalid, "err");
      return null;
    }
    return { from: from, to: to };
  }

  function exportCollectionReport() {
    const r = reportRange();
    if (!r) return;
    const rows = state.payments.filter(function (p) {
      const pd = paymentDateISO(p);
      return pd >= r.from && pd <= r.to;
    });
    const head = [
      "payment_date",
      "invoice_number",
      "customer",
      "user_id",
      "paid_amount",
      "total_amount",
      "is_partial",
      "method",
      "recharge_month",
      "transaction_id",
      "notes"
    ];
    const lines = [head.join(",")];
    rows.forEach(function (p) {
      lines.push(
        [
          csvEscape(formatDisplayDate(p.payment_date)),
          csvEscape(p.invoice_number),
          csvEscape((p.customers && p.customers.full_name) || ""),
          csvEscape((p.customers && p.customers.pppoe_id) || ""),
          csvEscape(p.paid_amount),
          csvEscape(p.total_amount),
          csvEscape(p.is_partial),
          csvEscape((p.payment_methods && p.payment_methods.method_name) || ""),
          csvEscape(p.recharge_month),
          csvEscape(p.transaction_id),
          csvEscape(p.notes)
        ].join(",")
      );
    });
    downloadText("collection-report.csv", lines.join("\n"), "text/csv;charset=utf-8");
    toast(M.reports.exported, "ok");
  }

  function exportCustomerReport() {
    const r = reportRange();
    if (!r) return;
    const rows = state.customers.filter(function (c) {
      if (!c.created_at) return false;
      const cd = String(c.created_at).slice(0, 10);
      return cd >= r.from && cd <= r.to;
    });
    if (!rows.length) {
      toast(M.reports.noData, "err");
      return;
    }
    exportRowsAsCustomers(rows, "customer-report.csv");
    toast(M.reports.exported, "ok");
  }

  function exportRowsAsCustomers(rows, filename) {
    const head = [
      "user_id",
      "full_name",
      "phone",
      "area",
      "package",
      "expiry",
      "due",
      "status"
    ];
    const lines = [head.join(",")];
    rows.forEach(function (c) {
      lines.push(
        [
          csvEscape(c.pppoe_id),
          csvEscape(c.full_name),
          csvEscape(c.phone),
          csvEscape(c.areas ? areaLabelTree(c.areas) : ""),
          csvEscape(c.packages ? c.packages.package_name : ""),
          csvEscape(formatDisplayDate(c.package_expiry_date)),
          csvEscape(c.due_amount),
          csvEscape(c.status)
        ].join(",")
      );
    });
    downloadText(filename, lines.join("\n"), "text/csv;charset=utf-8");
  }

  function exportExpiryReport() {
    const r = reportRange();
    if (!r) return;
    const rows = state.customers.filter(function (c) {
      if (!c.package_expiry_date) return false;
      return c.package_expiry_date >= r.from && c.package_expiry_date <= r.to;
    });
    const head = ["user_id", "full_name", "phone", "package_expiry_date", "status"];
    const lines = [head.join(",")];
    rows.forEach(function (c) {
      lines.push(
        [
          csvEscape(c.pppoe_id),
          csvEscape(c.full_name),
          csvEscape(c.phone),
          csvEscape(formatDisplayDate(c.package_expiry_date)),
          csvEscape(c.status)
        ].join(",")
      );
    });
    downloadText("expiry-report.csv", lines.join("\n"), "text/csv;charset=utf-8");
    toast(rows.length ? M.reports.exported : M.reports.noData, rows.length ? "ok" : "err");
  }

  function exportDueReport() {
    const rows = state.customers.filter(function (c) {
      return Number(c.due_amount || 0) > 0;
    });
    const head = ["user_id", "full_name", "phone", "due_amount", "expiry", "status"];
    const lines = [head.join(",")];
    rows.forEach(function (c) {
      lines.push(
        [
          csvEscape(c.pppoe_id),
          csvEscape(c.full_name),
          csvEscape(c.phone),
          csvEscape(c.due_amount),
          csvEscape(formatDisplayDate(c.package_expiry_date)),
          csvEscape(c.status)
        ].join(",")
      );
    });
    downloadText("due-report.csv", lines.join("\n"), "text/csv;charset=utf-8");
    toast(M.reports.exported, "ok");
  }

  function exportCollectionReportPdf() {
    const r = reportRange();
    if (!r) return;
    const rows = state.payments
      .filter(function (p) {
        const pd = paymentDateISO(p);
        return pd >= r.from && pd <= r.to;
      })
      .sort(function (a, b) {
        const da = paymentDateISO(a);
        const db = paymentDateISO(b);
        if (da !== db) return da < db ? -1 : 1;
        return String(a.invoice_number || "").localeCompare(
          String(b.invoice_number || ""),
          undefined,
          { numeric: true }
        );
      });
    const parts = [
      "<h2>Collection report</h2>",
      "<p class=\"muted\">" + reportRangeSubtitle(r) + "</p>",
      "<table><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>User ID</th><th>Paid</th><th>Method</th><th>Partial</th><th>Recharge line</th><th>Notes</th></tr></thead><tbody>"
    ];
    if (!rows.length) {
      parts.push("<tr><td colspan='9' class='muted'>No payments in range.</td></tr>");
    } else {
      rows.forEach(function (p) {
        const cust = p.customers || {};
        const partial =
          p.is_partial === true ||
          p.is_partial === "true" ||
          p.is_partial === 1 ||
          p.is_partial === "1"
            ? "Yes"
            : "No";
        parts.push(
          "<tr><td>" +
            escapeHtml(formatDisplayDate(paymentDateISO(p))) +
            "</td><td>" +
            escapeHtml(String(p.invoice_number || "")) +
            "</td><td>" +
            escapeHtml(String(cust.full_name || "")) +
            "</td><td>" +
            escapeHtml(String(cust.pppoe_id || "")) +
            "</td><td class=\"td-num\">" +
            escapeHtml(formatPKR(Number(p.paid_amount || 0))) +
            "</td><td>" +
            escapeHtml(
              String((p.payment_methods && p.payment_methods.method_name) || "")
            ) +
            "</td><td>" +
            escapeHtml(partial) +
            "</td><td>" +
            escapeHtml(p.recharge_month || "—") +
            "</td><td>" +
            escapeHtml(p.notes || "—") +
            "</td></tr>"
        );
      });
    }
    parts.push("</tbody></table>");
    reportHtmlToPdf(parts.join(""), "collection-report-" + r.from + "-" + r.to + ".pdf").then(
      function () {
        toast(M.reports.exported, "ok");
      }
    );
  }

  function exportCustomerReportPdf() {
    const r = reportRange();
    if (!r) return;
    const rows = state.customers
      .filter(function (c) {
        if (!c.created_at) return false;
        const cd = String(c.created_at).slice(0, 10);
        return cd >= r.from && cd <= r.to;
      })
      .sort(function (a, b) {
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });
    if (!rows.length) {
      toast(M.reports.noData, "err");
      return;
    }
    const parts = [
      "<h2>Customers created in range</h2>",
      "<p class=\"muted\">" + reportRangeSubtitle(r) + "</p>",
      "<table><thead><tr><th>User ID</th><th>Name</th><th>Phone</th><th>Area</th><th>Package</th><th>Expiry</th><th>Due</th><th>Status</th></tr></thead><tbody>"
    ];
    rows.forEach(function (c) {
      parts.push(
        "<tr><td>" +
          escapeHtml(String(c.pppoe_id || "")) +
          "</td><td>" +
          escapeHtml(String(c.full_name || "")) +
          "</td><td>" +
          escapeHtml(String(c.phone || "")) +
          "</td><td>" +
          escapeHtml(c.areas ? areaLabelTree(c.areas) : "") +
          "</td><td>" +
          escapeHtml(c.packages ? c.packages.package_name : "") +
          "</td><td>" +
          escapeHtml(formatDisplayDate(c.package_expiry_date)) +
          "</td><td class=\"td-num\">" +
          escapeHtml(String(c.due_amount != null ? c.due_amount : "")) +
          "</td><td>" +
          escapeHtml(c.status) +
          "</td></tr>"
      );
    });
    parts.push("</tbody></table>");
    reportHtmlToPdf(parts.join(""), "customers-created-" + r.from + "-" + r.to + ".pdf").then(
      function () {
        toast(M.reports.exported, "ok");
      }
    );
  }

  function exportExpiryReportPdf() {
    const r = reportRange();
    if (!r) return;
    const rows = state.customers
      .filter(function (c) {
        if (!c.package_expiry_date) return false;
        return c.package_expiry_date >= r.from && c.package_expiry_date <= r.to;
      })
      .sort(function (a, b) {
        return String(a.package_expiry_date || "").localeCompare(
          String(b.package_expiry_date || "")
        );
      });
    if (!rows.length) {
      toast(M.reports.noData, "err");
      return;
    }
    const parts = [
      "<h2>Package expiry report</h2>",
      "<p class=\"muted\">" + reportRangeSubtitle(r) + "</p>",
      "<table><thead><tr><th>User ID</th><th>Name</th><th>Phone</th><th>Expiry</th><th>Status</th></tr></thead><tbody>"
    ];
    rows.forEach(function (c) {
      parts.push(
        "<tr><td>" +
          escapeHtml(String(c.pppoe_id || "")) +
          "</td><td>" +
          escapeHtml(String(c.full_name || "")) +
          "</td><td>" +
          escapeHtml(String(c.phone || "")) +
          "</td><td>" +
          escapeHtml(formatDisplayDate(c.package_expiry_date)) +
          "</td><td>" +
          escapeHtml(c.status) +
          "</td></tr>"
      );
    });
    parts.push("</tbody></table>");
    reportHtmlToPdf(parts.join(""), "expiry-report-" + r.from + "-" + r.to + ".pdf").then(
      function () {
        toast(M.reports.exported, "ok");
      }
    );
  }

  function exportDueReportPdf() {
    const rows = state.customers
      .filter(function (c) {
        return Number(c.due_amount || 0) > 0;
      })
      .sort(function (a, b) {
        return Number(b.due_amount || 0) - Number(a.due_amount || 0);
      });
    const parts = [
      "<h2>Due balances (current)</h2>",
      "<p class=\"muted\">All customers with outstanding dues at report time.</p>",
      "<table><thead><tr><th>User ID</th><th>Name</th><th>Phone</th><th>Due (PKR)</th><th>Expiry</th><th>Status</th></tr></thead><tbody>"
    ];
    if (!rows.length) {
      parts.push("<tr><td colspan='6' class='muted'>No customers with a due balance.</td></tr>");
    } else {
      rows.forEach(function (c) {
        parts.push(
          "<tr><td>" +
            escapeHtml(String(c.pppoe_id || "")) +
            "</td><td>" +
            escapeHtml(String(c.full_name || "")) +
            "</td><td>" +
            escapeHtml(String(c.phone || "")) +
            "</td><td class=\"td-num\">" +
            escapeHtml(String(c.due_amount != null ? c.due_amount : "")) +
            "</td><td>" +
            escapeHtml(formatDisplayDate(c.package_expiry_date)) +
            "</td><td>" +
            escapeHtml(c.status) +
            "</td></tr>"
        );
      });
    }
    parts.push("</tbody></table>");
    reportHtmlToPdf(parts.join(""), "due-balances-" + todayISODate() + ".pdf").then(function () {
      toast(M.reports.exported, "ok");
    });
  }

  function initReportsDefaultRange() {
    const repTo = $("repTo");
    const repFrom = $("repFrom");
    if (!repTo || !repFrom) return;
    const t = new Date();
    const past = new Date();
    past.setDate(past.getDate() - 30);
    repTo.value = toISODate(t);
    repFrom.value = toISODate(past);
  }

  function wireNav() {
    document.querySelectorAll(".nav button").forEach(function (b) {
      b.addEventListener("click", function () {
        setView(b.getAttribute("data-view"));
      });
    });
    onIf("btnLogout", "click", function () {
      window.ISPAuth.logout();
    });
    document.body.addEventListener("click", function (ev) {
      const pick = ev.target.closest("[data-show-picker]");
      if (!pick) return;
      const id = pick.getAttribute("data-show-picker");
      if (!id) return;
      const inp = $(id);
      if (!inp) return;
      if (typeof inp.showPicker === "function") {
        try {
          inp.showPicker();
        } catch (e) {
          inp.focus();
        }
      } else {
        inp.focus();
      }
    });
    document.body.addEventListener("click", closeByDataAttr);

    onIf("qaAddCustomer", "click", function () {
      setView("customers");
      openCustomerModal(null);
    });
    onIf("qaExportCustomers", "click", exportCustomersCsv);
    onIf("qaImportCustomers", "click", function () {
      setView("customers");
      const inp = $("custImportInput");
      if (inp) inp.click();
    });

    onIf("btnAddCustomer", "click", function () {
      openCustomerModal(null);
    });
    onIf("btnExportCustomers", "click", exportCustomersCsv);
    onIf("btnImportCustomers", "click", function () {
      const inp = $("custImportInput");
      if (inp) inp.click();
    });
    onIf("custImportInput", "change", async function (ev) {
      const input = ev.target;
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        await importCustomersFromCsvText(text);
      } catch (e) {
        toast(e.message || "Could not read CSV file.", "err");
      }
      input.value = "";
    });
    onIf("custSearch", "input", renderCustomersTable);
    onIf("custFilterArea", "change", renderCustomersTable);
    const custPkgF = $("custFilterPackage");
    if (custPkgF) custPkgF.addEventListener("change", renderCustomersTable);
    const custSort = $("custSortBy");
    if (custSort) custSort.addEventListener("change", renderCustomersTable);
    onIf("custFilterStatus", "change", renderCustomersTable);

    onIf("tbodyCustomers", "click", function (ev) {
      const t = ev.target.closest("button");
      if (!t) return;
      const id = t.getAttribute("data-id");
      const act = t.getAttribute("data-act");
      if (act === "view") {
        openCustomerViewModal(id);
      } else if (act === "edit") {
        const c = state.customers.find(function (x) {
          return x.id === id;
        });
        openCustomerModal(c);
      } else if (act === "recv") {
        openPaymentModal(id, "receive");
      } else if (act === "pay") {
        openPaymentModal(id, "accrual");
      } else if (act === "inv") {
        openCustomerInvoice(id);
      } else if (act === "del") {
        deleteCustomer(id);
      }
    });

    onIf("tbodyDues", "click", function (ev) {
      const t = ev.target.closest("button");
      if (!t) return;
      const idDetail = t.getAttribute("data-due-detail");
      const idPay = t.getAttribute("data-due-pay");
      const idInv = t.getAttribute("data-due-inv");
      const idWa = t.getAttribute("data-due-wa");
      if (idDetail) openDueDetailModal(idDetail);
      if (idPay) openPaymentModal(idPay, "receive");
      if (idInv) openDueInvoice(idInv);
      if (idWa) duesWhatsApp(idWa);
    });

    onIf("custInstall", "change", syncNewCustomerExpiryFromInstall);
    onIf("btnSaveCustomer", "click", saveCustomer);
    const duesAreaSel = $("duesFilterArea");
    if (duesAreaSel) {
      duesAreaSel.addEventListener("change", renderDues);
    }
    const modalCust = $("modalCustomer");
    if (modalCust) {
      modalCust.addEventListener("click", function (ev) {
        if (ev.target.closest("#custExtraDueAddRow")) {
          addCustExtraDueRow();
          return;
        }
        const del = ev.target.closest(".cust-extra-due-del");
        if (!del) return;
        const tr = del.closest("tr");
        const tb = $("custExtraDueRows");
        if (!tb || !tr) return;
        const rows = tb.querySelectorAll("tr");
        if (rows.length > 1) {
          tr.remove();
        } else {
          tr.querySelectorAll("select, input").forEach(function (el) {
            if (el.tagName === "SELECT") {
              el.selectedIndex = 0;
            } else {
              el.value = "";
            }
          });
        }
        updateCustExtraDueRemoveButtons();
      });
    }
    onIf("btnConfirmPayment", "click", confirmPayment);

    onIf("btnAddPackage", "click", function () {
      $("pkgId").value = "";
      $("pkgName").value = "";
      $("pkgSpeed").value = "";
      $("pkgPrice").value = "";
      $("modalPackageTitle").textContent = "Add package";
      openBackdrop($("modalPackage"));
    });
    onIf("tbodyPackages", "click", async function (ev) {
      const t = ev.target.closest("button");
      if (!t) return;
      const idE = t.getAttribute("data-pkg-edit");
      const idD = t.getAttribute("data-pkg-del");
      if (idE) {
        const p = packageById(idE);
        $("pkgId").value = p.id;
        $("pkgName").value = p.package_name;
        $("pkgSpeed").value = String(p.speed_mbps);
        $("pkgPrice").value = String(p.price);
        $("modalPackageTitle").textContent = "Edit package";
        openBackdrop($("modalPackage"));
      }
      if (idD) {
        if (!confirm(M.packages.deleteConfirm)) return;
        const res = await getClient().from("packages").delete().eq("id", idD);
        if (res.error) toast(res.error.message, "err");
        else {
          toast(M.packages.deleted, "ok");
          await refresh();
        }
      }
    });
    onIf("btnSavePackage", "click", async function () {
      const sb = getClient();
      const id = $("pkgId").value;
      const existing = id ? packageById(id) : null;
      const row = {
        package_name: $("pkgName").value.trim(),
        speed_mbps: Number($("pkgSpeed").value),
        price: Number($("pkgPrice").value),
        is_active: existing && existing.is_active === false ? false : true
      };
      const res = id
        ? await sb.from("packages").update(row).eq("id", id)
        : await sb.from("packages").insert(row);
      if (res.error) toast(res.error.message, "err");
      else {
        toast(M.packages.saved, "ok");
        closeBackdrop($("modalPackage"));
        await refresh();
      }
    });

    onIf("btnAddPm", "click", function () {
      $("pmName").value = "";
      $("pmType").value = "cash";
      openBackdrop($("modalPm"));
    });
    onIf("btnSavePm", "click", async function () {
      const sb = getClient();
      const res = await sb.from("payment_methods").insert({
        method_name: $("pmName").value.trim(),
        method_type: $("pmType").value.trim() || "other",
        is_active: true
      });
      if (res.error) toast(res.error.message, "err");
      else {
        toast(M.paymentMethods.saved, "ok");
        closeBackdrop($("modalPm"));
        await refresh();
      }
    });
    onIf("tbodyPm", "click", async function (ev) {
      const t = ev.target.closest("button");
      if (!t) return;
      const id = t.getAttribute("data-pm-del");
      if (!id) return;
      if (!confirm(M.paymentMethods.deleteConfirm)) return;
      const res = await getClient().from("payment_methods").delete().eq("id", id);
      if (res.error) toast(res.error.message, "err");
      else {
        toast(M.paymentMethods.deleted, "ok");
        await refresh();
      }
    });

    onIf("btnAddMainArea", "click", function () {
      $("areaId").value = "";
      $("areaName").value = "";
      $("areaParent").value = "";
      $("modalAreaTitle").textContent = "Add main area";
      buildParentAreaOptions($("areaParent"));
      openBackdrop($("modalArea"));
    });
    onIf("btnAddSubArea", "click", function () {
      $("areaId").value = "";
      $("areaName").value = "";
      $("modalAreaTitle").textContent = "Add sub area";
      buildParentAreaOptions($("areaParent"));
      $("areaParent").value = "";
      const mains = state.areas.filter(function (x) {
        return !x.parent_area_id;
      });
      if (!mains.length) {
        toast("Create a main area first.", "err");
        return;
      }
      openBackdrop($("modalArea"));
    });
    onIf("btnSaveArea", "click", async function () {
      const sb = getClient();
      const name = $("areaName").value.trim();
      const parent = $("areaParent").value || null;
      if (!name) return;
      const id = $("areaId").value;
      const row = { area_name: name, parent_area_id: parent, is_active: true };
      const res = id
        ? await sb.from("areas").update(row).eq("id", id)
        : await sb.from("areas").insert(row);
      if (res.error) toast(res.error.message, "err");
      else {
        toast(M.areas.saved, "ok");
        closeBackdrop($("modalArea"));
        await refresh();
      }
    });
    onIf("tbodyAreas", "click", async function (ev) {
      const t = ev.target.closest("button");
      if (!t) return;
      const id = t.getAttribute("data-area-del");
      if (!id) return;
      if (!confirm(M.areas.deleteConfirm)) return;
      const res = await getClient().from("areas").delete().eq("id", id);
      if (res.error) toast(res.error.message, "err");
      else {
        toast(M.areas.deleted, "ok");
        await refresh();
      }
    });

    onIf("btnAddDiscount", "click", function () {
      $("discId").value = "";
      $("discVal").value = "";
      buildAreaOptions($("discArea"), true);
      buildPackageOptions($("discPkg"), true);
      openBackdrop($("modalDiscount"));
    });
    onIf("btnSaveDiscount", "click", async function () {
      const sb = getClient();
      const row = {
        area_id: $("discArea").value,
        package_id: $("discPkg").value,
        discount_type: $("discType").value,
        discount_value: Number($("discVal").value || 0)
      };
      if (!row.area_id || !row.package_id) {
        toast("Select area and package.", "err");
        return;
      }
      const id = $("discId").value;
      const res = id
        ? await sb.from("area_package_discounts").update(row).eq("id", id)
        : await sb.from("area_package_discounts").insert(row);
      if (res.error) toast(res.error.message, "err");
      else {
        toast(M.discounts.saved, "ok");
        closeBackdrop($("modalDiscount"));
        await refresh();
      }
    });
    onIf("tbodyDiscounts", "click", async function (ev) {
      const t = ev.target.closest("button");
      if (!t) return;
      const idE = t.getAttribute("data-disc-edit");
      const idD = t.getAttribute("data-disc-del");
      if (idE) {
        const d = state.discounts.find(function (x) {
          return x.id === idE;
        });
        $("discId").value = d.id;
        buildAreaOptions($("discArea"), true);
        buildPackageOptions($("discPkg"), true);
        $("discArea").value = d.area_id;
        $("discPkg").value = d.package_id;
        $("discType").value = d.discount_type;
        $("discVal").value = String(d.discount_value);
        openBackdrop($("modalDiscount"));
      }
      if (idD) {
        const res = await getClient()
          .from("area_package_discounts")
          .delete()
          .eq("id", idD);
        if (res.error) toast(res.error.message, "err");
        else {
          toast(M.discounts.deleted, "ok");
          await refresh();
        }
      }
    });

    const colRoot = $("collectionWeekRoot");
    if (colRoot) {
      colRoot.addEventListener("click", async function (ev) {
        const b = ev.target.closest("button[data-col-pay-del]");
        if (!b) return;
        const id = b.getAttribute("data-col-pay-del");
        if (id) await deletePaymentRecord(id);
      });
    }
    const dueDetailEl = $("modalDueDetail");
    if (dueDetailEl) {
      dueDetailEl.addEventListener("click", async function (ev) {
        const b = ev.target.closest("button[data-due-ch-del]");
        if (!b) return;
        const ch = b.getAttribute("data-due-ch-del");
        if (ch) await deleteDueChargeRow(ch);
      });
    }
    const customerViewEl = $("modalCustomerView");
    if (customerViewEl) {
      customerViewEl.addEventListener("click", async function (ev) {
        const del = ev.target.closest("button[data-customer-view-pay-del]");
        if (del) {
          const id = del.getAttribute("data-customer-view-pay-del");
          if (id) await deletePaymentRecord(id);
          return;
        }
        if (ev.target.closest("#btnCustomerViewResetExpiry")) {
          if (state.viewCustomerId) await resetCustomerExpiryFromInstall(state.viewCustomerId);
        }
      });
    }
    const btnDueLine = $("btnSaveDueLine");
    if (btnDueLine) {
      btnDueLine.addEventListener("click", async function () {
        await saveManualDueCharge();
      });
    }
    const btnDueOpenAny = $("btnDueOpenAny");
    if (btnDueOpenAny) {
      btnDueOpenAny.addEventListener("click", function () {
        const sel = $("dueAnyCustomer");
        const v = sel && sel.value;
        if (!v) {
          toast("Select a customer.", "err");
          return;
        }
        openDueDetailModal(v);
      });
    }

    onIf("repCollection", "click", exportCollectionReport);
    const repColPdf = $("repCollectionPdf");
    if (repColPdf) repColPdf.addEventListener("click", exportCollectionReportPdf);
    onIf("repCustomers", "click", exportCustomerReport);
    const repCustPdf = $("repCustomersPdf");
    if (repCustPdf) repCustPdf.addEventListener("click", exportCustomerReportPdf);
    onIf("repExpiry", "click", exportExpiryReport);
    const repExpPdf = $("repExpiryPdf");
    if (repExpPdf) repExpPdf.addEventListener("click", exportExpiryReportPdf);
    onIf("repDue", "click", exportDueReport);
    const repDuePdf = $("repDuePdf");
    if (repDuePdf) repDuePdf.addEventListener("click", exportDueReportPdf);
    const repCustCsv = $("repCustomerCsv");
    if (repCustCsv) repCustCsv.addEventListener("click", exportIndividualCustomerCsv);
    const repCustDossierPdf = $("repCustomerPdf");
    if (repCustDossierPdf) repCustDossierPdf.addEventListener("click", exportIndividualCustomerPdf);
    const repPrev = $("repRefreshPreview");
    if (repPrev) {
      repPrev.addEventListener("click", function () {
        renderReportsInline();
      });
    }
    ["repFrom", "repTo"].forEach(function (id) {
      const el = $(id);
      if (el) {
        el.addEventListener("change", function () {
          renderReportsInline();
        });
        el.addEventListener("input", function () {
          renderReportsInline();
        });
      }
    });

    onIf("btnInvoicePdf", "click", downloadInvoicePdf);
    onIf("btnInvoiceWa", "click", shareInvoiceWhatsApp);

    document.querySelectorAll("[data-settings]").forEach(function (b) {
      b.addEventListener("click", function () {
        const key = b.getAttribute("data-settings");
        document.querySelectorAll("[data-settings]").forEach(function (x) {
          x.classList.toggle("primary", x === b);
          x.classList.toggle("ghost", x !== b);
        });
        const settingsPm = $("settingsPm");
        const settingsAreas = $("settingsAreas");
        const settingsDiscounts = $("settingsDiscounts");
        if (settingsPm) settingsPm.style.display = key === "pm" ? "block" : "none";
        if (settingsAreas) settingsAreas.style.display = key === "areas" ? "block" : "none";
        if (settingsDiscounts) {
          settingsDiscounts.style.display = key === "discounts" ? "block" : "none";
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", async function () {
    try {
      const u = window.ISPAuth.requireAuth();
      if (!u) return;
      state.currentUser = u;
      const sn = $("sidebarUserName");
      const sr = $("sidebarUserRole");
      if (sn) sn.textContent = u.full_name || u.username;
      if (sr) sr.textContent = u.role || "";

      wireNav();
      wireAccrualRechargeDateSync();
      initReportsDefaultRange();

      const settingsPm0 = $("settingsPm");
      const settingsAreas0 = $("settingsAreas");
      const settingsDiscounts0 = $("settingsDiscounts");
      if (settingsPm0) settingsPm0.style.display = "block";
      if (settingsAreas0) settingsAreas0.style.display = "none";
      if (settingsDiscounts0) settingsDiscounts0.style.display = "none";

      await refresh();
    } catch (err) {
      if (typeof console !== "undefined" && console.error) {
        console.error("ISP Billing startup:", err);
      }
      toast((err && err.message) || "Dashboard failed to start.", "err");
    }
  });
})();
