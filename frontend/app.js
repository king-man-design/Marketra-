window.addEventListener("error", (e) => {
  const banner = document.getElementById("debugBanner");
  if (banner) {
    banner.style.display = "block";
    banner.textContent = "JS ERROR: " + e.message + " (line " + e.lineno + ")";
  }
});

const API_BASE = "https://marketra-ai.onrender.com";
const FETCH_TIMEOUT_MS = 90000; // AI requests can take 20-60 seconds; avoid aborting just before the result arrives.

// ⚠️ FILL THESE IN from Supabase Dashboard → Settings → API
const SUPABASE_URL = "https://qemilayhmeacjfsyeowp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlbWlsYXlobWVhY2pmc3llb3dwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5NjAzMjQsImV4cCI6MjEwNTUzNjMyNH0.9EMIF5Ybnax3VjtPGTriDnw0zbWE22CnYKwZXS7Yk6k";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Elements ----------
const authView = document.getElementById("authView");
const onboardingView = document.getElementById("onboardingView");
const appShell = document.getElementById("appShell");
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authSubtitle = document.getElementById("authSubtitle");
const authToggleBtn = document.getElementById("authToggleBtn");
const authToggleText = document.getElementById("authToggleText");
const authError = document.getElementById("authError");
const onboardingForm = document.getElementById("onboardingForm");
const onboardingError = document.getElementById("onboardingError");
const topBusinessName = document.getElementById("topBusinessName");
const statusDot = document.getElementById("statusDot");

const dashBusinessName = document.getElementById("dashBusinessName");
const dashBudget = document.getElementById("dashBudget");
const dashGoal = document.getElementById("dashGoal");
const dashRecentList = document.getElementById("dashRecentList");
const historyList = document.getElementById("historyList");
const todayActionBanner = document.getElementById("todayActionBanner");
const todayActionTitle = document.getElementById("todayActionTitle");
const todayActionText = document.getElementById("todayActionText");
const todayActionBtn = document.getElementById("todayActionBtn");
const outcomesList = document.getElementById("outcomesList");

const feed = document.getElementById("messages");
const planEl = document.getElementById("plan");
const composer = document.getElementById("composer");
const promptInput = document.getElementById("prompt");

const settingsForm = document.getElementById("settingsForm");
const settingsStatus = document.getElementById("settingsStatus");
const signOutBtn = document.getElementById("signOutBtn");

let isSignUpMode = false;
let currentUser = null;
let currentBusiness = null;
let currentSessionId = null;

// ---------- Auth ----------
authToggleBtn.addEventListener("click", () => {
  isSignUpMode = !isSignUpMode;
  authSubtitle.textContent = isSignUpMode ? "Create your account" : "Log in to your account";
  authSubmitBtn.textContent = isSignUpMode ? "Sign Up" : "Log In";
  authToggleText.textContent = isSignUpMode ? "Already have an account?" : "Don't have an account?";
  authToggleBtn.textContent = isSignUpMode ? "Log in" : "Sign up";
  authError.textContent = "";
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";
  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = "Please wait…";
  const email = authEmail.value.trim();
  const password = authPassword.value;

  try {
    const { data, error } = isSignUpMode
      ? await sb.auth.signUp({ email, password })
      : await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;

    if (isSignUpMode && !data.session) {
      authError.textContent = "Check your email to confirm your account, then log in.";
      isSignUpMode = false;
      authToggleBtn.click();
      authToggleBtn.click(); // reset labels to login mode
      return;
    }
    currentUser = data.user;
    await afterLogin();
  } catch (err) {
    console.error("[auth]", err);
    authError.textContent = err.message || "Something went wrong.";
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = isSignUpMode ? "Sign Up" : "Log In";
  }
});

signOutBtn.addEventListener("click", async () => {
  await sb.auth.signOut();
  currentUser = null;
  currentBusiness = null;
  currentSessionId = null;
  appShell.hidden = true;
  onboardingView.hidden = true;
  authView.hidden = false;
});

async function afterLogin() {
  const { data: businesses, error } = await sb
    .from("businesses")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("[afterLogin]", error);
    authError.textContent = "Could not load your account. Try again.";
    return;
  }

  if (!businesses || businesses.length === 0) {
    authView.hidden = true;
    onboardingView.hidden = false;
    return;
  }

  currentBusiness = businesses[0];
  authView.hidden = true;
  onboardingView.hidden = true;
  appShell.hidden = false;
  topBusinessName.textContent = currentBusiness.business_name;
  populateSettingsForm();
  loadDashboard();
}

// ---------- Onboarding ----------
onboardingForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  onboardingError.textContent = "";
  const formData = new FormData(onboardingForm);
  const profile = Object.fromEntries(formData.entries());
  if (profile.monthly_marketing_budget) {
    profile.monthly_marketing_budget = Number(profile.monthly_marketing_budget);
  }
  profile.user_id = currentUser.id;
  profile.sales_channels = profile.sales_channels
    ? profile.sales_channels.split(",").map((v) => v.trim()).filter(Boolean)
    : [];

  try {
    const { data, error } = await sb.from("businesses").insert(profile).select().single();
    if (error) throw error;
    currentBusiness = data;
    onboardingView.hidden = true;
    appShell.hidden = false;
    topBusinessName.textContent = currentBusiness.business_name;
    populateSettingsForm();
    loadDashboard();
  } catch (err) {
    console.error("[onboarding]", err);
    onboardingError.textContent = err.message || "Could not save your profile.";
  }
});

// ---------- Tab navigation ----------
document.querySelectorAll(".tab-btn, .side-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

document.querySelectorAll("[data-view-jump]").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.viewJump));
});

const sidebar = document.getElementById("sidebar");
const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const mobileCloseBtn = document.getElementById("mobileCloseBtn");
mobileMenuBtn?.addEventListener("click", () => sidebar?.classList.add("open"));
mobileCloseBtn?.addEventListener("click", () => sidebar?.classList.remove("open"));

function showView(name) {
  document.querySelectorAll(".app-view").forEach((v) => (v.hidden = true));
  document.querySelectorAll(".tab-btn, .side-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const target = document.getElementById(`${name}View`);
  if (target) target.hidden = false;
  sidebar?.classList.remove("open");
  if (name === "dashboard") loadDashboard();
  if (name === "history") loadHistory();
}

// ---------- Dashboard ----------
async function loadDashboard() {
  dashBusinessName.textContent = currentBusiness.business_name;
  dashBudget.textContent = currentBusiness.monthly_marketing_budget
    ? `₹${currentBusiness.monthly_marketing_budget}`
    : "₹—";
  dashGoal.textContent = currentBusiness.current_goal || "—";

  const { data: sessions } = await sb
    .from("chat_sessions")
    .select("*")
    .eq("business_id", currentBusiness.id)
    .order("created_at", { ascending: false })
    .limit(3);

  renderSessionList(dashRecentList, sessions || []);
  loadConnectedAccounts();
  loadPriorities();
  loadRecentOutcomes();
}

// ---------- Priority Actions (Marketing Action Dashboard) ----------
const priorityActionsEl = document.getElementById("priorityActions");
const dashGreetingEl = document.getElementById("dashGreeting");
const recoStatus = document.getElementById("recoStatus");
const refreshPrioritiesBtn = document.getElementById("refreshPrioritiesBtn");
const askMarketraBtn = document.getElementById("askMarketraBtn");
const priorityCountEl = document.getElementById("priorityCount");
const connectedCountEl = document.getElementById("connectedCount");
const connectedSummaryEl = document.getElementById("connectedSummary");

// Maps the AI's execution_options values to a button label and a tailored
// prompt template. Falls back to a generic "Act on this" button when a
// recommendation has no execution_options (e.g. rows saved before this
// feature existed) — nothing breaks for old data.
const EXECUTION_OPTION_META = {
  generate_content: {
    label: "Generate Content",
    buildPrompt: (r) => `Generate content (hook, caption, CTA, and a suggested format) for: ${r.recommended_action}`,
  },
  create_campaign: {
    label: "Create Campaign",
    buildPrompt: (r) =>
      `Create a full campaign plan (objective, target audience, offer/message, content concept, channels, duration, CTA, and measurement goal) for: ${r.recommended_action}`,
  },
  generate_post: {
    label: "Generate Post",
    buildPrompt: (r) => `Write a ready-to-use post draft for: ${r.recommended_action}`,
  },
  view_strategy: {
    label: "View Strategy",
    buildPrompt: (r) => `Explain the full reasoning and strategy behind this: ${r.problem} — ${r.recommended_action}`,
  },
};

// The AI is instructed to prefix evidence with one of these exact labels
// (see marketing-system.txt) — this splits that prefix out so it can be
// shown as a distinct, visually clear badge rather than buried in prose.
function splitEvidenceSource(evidence) {
  if (!evidence) return { sourceLabel: null, sourceClass: "", text: "" };
  const match = evidence.match(/^(REAL DATA|PROFILE-BASED|GENERAL):\s*(.*)$/s);
  if (!match) return { sourceLabel: null, sourceClass: "", text: evidence };
  const [, label, rest] = match;
  const sourceClass = label === "REAL DATA" ? "source-real" : label === "PROFILE-BASED" ? "source-profile" : "source-general";
  return { sourceLabel: label, sourceClass, text: rest };
}

function priorityCardHtml(r) {
  const cls = r.priority === "HIGH" ? "p-high" : r.priority === "MEDIUM" ? "p-medium" : "p-opportunity";
  const { sourceLabel, sourceClass, text } = splitEvidenceSource(r.evidence);

  const options = Array.isArray(r.execution_options) ? r.execution_options.filter((o) => EXECUTION_OPTION_META[o]) : [];
  const actionButtons = options.length
    ? options
        .map(
          (opt) =>
            `<button type="button" class="priority-action-btn" data-exec-option="${opt}">${EXECUTION_OPTION_META[opt].label}</button>`
        )
        .join("")
    : `<button type="button" class="priority-action-btn" data-exec-option="_generic">Act on this</button>`;

  return `
    <div class="priority-card ${cls}" data-id="${r.id || ""}"
         data-problem="${encodeURIComponent(String(r.problem || ""))}" data-recommended-action="${encodeURIComponent(String(r.recommended_action || ""))}">
      <span class="priority-tag">${escapeHtml(r.priority)}</span>
      <p class="priority-problem">${escapeHtml(r.problem)}</p>
      ${sourceLabel ? `<span class="source-badge ${sourceClass}">${escapeHtml(sourceLabel)}</span>` : ""}
      ${text ? `<p class="priority-evidence">${escapeHtml(text)}</p>` : ""}
      <div class="priority-action-row">
        ${actionButtons}
        ${r.id ? `<button type="button" class="priority-dismiss-btn" data-dismiss-id="${r.id}">Dismiss</button><button type="button" class="priority-measure-btn" data-measure-id="${r.id}">Record Result</button>` : ""}
      </div>
    </div>`;
}

function renderPriorities(list) {
  if (!list.length) {
    dashGreetingEl.textContent = "Your marketing, at a glance.";
    if (priorityCountEl) priorityCountEl.textContent = "0";
    priorityActionsEl.innerHTML = `<p class="empty-note">No priorities yet. Generate today's plan when you're ready for Marketra to analyze your business.</p>`;
    if (todayActionBanner) todayActionBanner.hidden = true;
    return;
  }
  dashGreetingEl.textContent = `You have ${list.length} ${list.length === 1 ? "priority" : "priorities"} to review`;
  if (priorityCountEl) priorityCountEl.textContent = String(list.length);
  const top = list[0];
  if (todayActionBanner && top) {
    todayActionBanner.hidden = false;
    todayActionTitle.textContent = top.problem || "Your highest-priority action";
    todayActionText.textContent = top.recommended_action || "Turn this priority into an action today.";
    todayActionBtn.onclick = () => actOnRecommendation(top.recommended_action, top.id || null);
  }
  priorityActionsEl.innerHTML = list.map(priorityCardHtml).join("");

  priorityActionsEl.querySelectorAll("[data-exec-option]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".priority-card");
      const r = {
        id: card.dataset.id || null,
        problem: decodeURIComponent(card.dataset.problem || ""),
        recommended_action: decodeURIComponent(card.dataset.recommendedAction || ""),
      };
      const opt = btn.dataset.execOption;
      const prompt = opt !== "_generic" && EXECUTION_OPTION_META[opt] ? EXECUTION_OPTION_META[opt].buildPrompt(r) : r.recommended_action;
      actOnRecommendation(prompt, r.id);
    });
  });
  priorityActionsEl.querySelectorAll("[data-dismiss-id]").forEach((btn) => {
    btn.addEventListener("click", () => dismissRecommendation(btn.dataset.dismissId, btn.closest(".priority-card")));
  });
  priorityActionsEl.querySelectorAll("[data-measure-id]").forEach((btn) => {
    btn.addEventListener("click", () => recordOutcomeForRecommendation(btn.dataset.measureId));
  });
}

async function loadPriorities() {
  const { data, error } = await sb
    .from("marketing_recommendations")
    .select("*")
    .eq("business_id", currentBusiness.id)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[loadPriorities]", error);
    return;
  }
  renderPriorities(data || []);
}

async function dismissRecommendation(id, cardEl) {
  await sb.from("marketing_recommendations").update({ status: "dismissed" }).eq("id", id);
  if (cardEl) cardEl.remove();
  if (!priorityActionsEl.querySelector(".priority-card")) renderPriorities([]);
}

// Reuses the SAME /api/marketing endpoint and auth/ownership checks as
// ordinary chat — no separate AI endpoint. Does not create a chat session,
// so this doesn't clutter conversation history; the AI call only happens
// here (explicit refresh) or if the dashboard had nothing cached, never on
// every render.
async function generatePriorities() {
  recoStatus.textContent = "Analyzing your business…";
  refreshPrioritiesBtn.disabled = true;
  try {
    const options = await getAuthedFetchOptions({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Generate today's prioritized marketing recommendations for this business.",
        businessId: currentBusiness.id,
      }),
    });
    const res = await fetchWithTimeout(`${API_BASE}/api/marketing`, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      recoStatus.textContent = body.message || body.error || "Could not generate priorities right now.";
      return;
    }
    const result = await res.json();
    recoStatus.textContent = "";
    if (Array.isArray(result.recommendations) && result.recommendations.length) {
      renderPriorities(result.recommendations);
      loadPriorities(); // pick up the server-persisted rows (with real ids) once saved
    } else {
      renderPriorities([]);
    }
  } catch (err) {
    console.error("[generatePriorities]", err);
    recoStatus.textContent = "Couldn't reach MARKETRA. Please try again.";
  } finally {
    refreshPrioritiesBtn.disabled = false;
  }
}

refreshPrioritiesBtn.addEventListener("click", generatePriorities);

// Every execution option ("Generate Content", "Create Campaign",
// "Generate Post", "View Strategy") and the generic fallback all funnel
// into this SAME existing chat/composer path — no duplicate AI call, no
// new endpoint. Only the prompt text sent differs per option.
let activeRecommendationId = null;

async function updateRecommendationStatus(id, status) {
  if (!id) return;
  const { error } = await sb
    .from("marketing_recommendations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.warn("[recommendation status]", error.message);
}

async function actOnRecommendation(actionText, recommendationId) {
  activeRecommendationId = recommendationId || null;
  if (recommendationId) await updateRecommendationStatus(recommendationId, "in_progress");
  if (!currentSessionId) await startNewChat();
  showView("chat");
  promptInput.value = actionText;
  composer.requestSubmit();
}
askMarketraBtn.addEventListener("click", async () => {
  if (!currentSessionId) await startNewChat();
  showView("chat");
  promptInput.focus();
});

document.getElementById("newChatFromDash")?.addEventListener("click", () => startNewChat());
document.getElementById("newChatFromHistory")?.addEventListener("click", () => startNewChat());
document.getElementById("newChatFromHistoryAlt")?.addEventListener("click", () => startNewChat());
document.getElementById("connectSocialShortcut")?.addEventListener("click", () => document.getElementById("connectSocialBtn")?.click());

// ---------- Phyllo social account connect ----------
const connectSocialBtn = document.getElementById("connectSocialBtn");
const connectStatus = document.getElementById("connectStatus");
const connectedAccountsList = document.getElementById("connectedAccountsList");

async function getAuthedFetchOptions(extra = {}) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  return {
    ...extra,
    headers: { ...(extra.headers || {}), Authorization: `Bearer ${token}` },
  };
}

connectSocialBtn.addEventListener("click", async () => {
  connectStatus.textContent = "Starting connection…";
  connectSocialBtn.disabled = true;
  try {
    const options = await getAuthedFetchOptions({ method: "POST" });
    const res = await fetchWithTimeout(`${API_BASE}/api/phyllo/token`, options);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `status ${res.status}`);
    const data = await res.json();
    const { sdk_token } = data;

    // ⚠️ CONFIRM against Phyllo's current Connect SDK docs — this init
    // call (constructor name, config shape, event names) is a best-effort
    // placeholder based on common SDK patterns, not verified current API.
    if (!window.PhylloConnect) {
      throw new Error("Phyllo Connect SDK did not load. Confirm the script URL in index.html.");
    }
    const phylloConnect = window.PhylloConnect.initialize({
      clientDisplayName: "MARKETRA",
      environment: "staging",
      userId: data.user_id,
      token: sdk_token,
    });
    phylloConnect.on("accountConnected", () => {
      connectStatus.textContent = "Connected! Syncing…";
      setTimeout(loadConnectedAccounts, 2000);
    });
    phylloConnect.on("accountError", (err) => {
      console.error("[phyllo connect]", err);
      connectStatus.textContent = "Connection failed. Please try again.";
    });
    phylloConnect.on("exit", () => {
      connectSocialBtn.disabled = false;
    });
    phylloConnect.open();
  } catch (err) {
    console.error("[connectSocial]", err);
    connectStatus.textContent = err.message || "Could not start connection.";
    connectSocialBtn.disabled = false;
  }
});

async function loadConnectedAccounts() {
  try {
    const options = await getAuthedFetchOptions();
    const res = await fetchWithTimeout(`${API_BASE}/api/phyllo/accounts`, options);
    if (!res.ok) return;
    const accounts = await res.json();
    if (connectedCountEl) connectedCountEl.textContent = String(accounts.length);
    if (connectedSummaryEl) connectedSummaryEl.textContent = accounts.length ? accounts.map((a) => a.platform || "Social").filter(Boolean).slice(0, 2).join(" · ") : "No social accounts connected";
    if (!accounts.length) {
      connectedAccountsList.innerHTML = `<p class="empty-note">No accounts connected yet.</p>`;
      return;
    }
    connectedAccountsList.innerHTML = accounts
      .map(
        (a) => `
        <div class="session-item">
          <span class="s-title">${escapeHtml(a.platform) || "Account"} ${a.handle ? "· @" + escapeHtml(a.handle) : ""}</span>
          <span class="s-date">${escapeHtml(a.connection_status)}</span>
        </div>`
      )
      .join("");
  } catch (err) {
    console.error("[loadConnectedAccounts]", err);
  }
}

function renderSessionList(container, sessions) {
  if (!sessions.length) {
    container.innerHTML = `<p class="empty-note">No conversations yet.</p>`;
    return;
  }
  container.innerHTML = sessions
    .map(
      (s) => `
      <div class="session-item" data-session-id="${s.id}" data-title="${escapeHtml(s.title)}">
        <span class="s-title">${escapeHtml(s.title)}</span>
        <span class="s-date">${new Date(s.created_at).toLocaleDateString()}</span>
      </div>`
    )
    .join("");
  container.querySelectorAll(".session-item").forEach((el) => {
    el.addEventListener("click", () => openSession(el.dataset.sessionId, el.dataset.title));
  });
}

// ---------- History ----------
async function loadHistory() {
  const { data: sessions } = await sb
    .from("chat_sessions")
    .select("*")
    .eq("business_id", currentBusiness.id)
    .order("created_at", { ascending: false });
  renderSessionList(historyList, sessions || []);
}

async function startNewChat() {
  const { data, error } = await sb
    .from("chat_sessions")
    .insert({ business_id: currentBusiness.id, title: "New chat" })
    .select()
    .single();
  if (error) {
    console.error("[startNewChat]", error);
    return;
  }
  await openSession(data.id, data.title);
}

async function openSession(sessionId, title) {
  currentSessionId = sessionId;
  feed.innerHTML = "";
  planEl.hidden = true;
  planEl.innerHTML = "";

  const { data: msgs } = await sb
    .from("conversations")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (msgs && msgs.length) {
    msgs.forEach((row) => {
      addEntry("user", row.user_message);
      addEntry("ai", row.ai_response?.diagnosis || "");
    });
  } else {
    addEntry("ai", "New conversation. Ask what to do — try \"what should I do today?\"");
  }
  showView("chat");
}

// ---------- Chat ----------
function addEntry(role, text) {
  const el = document.createElement("div");
  el.className = `entry ${role === "ai" ? "from-marketra" : "from-you"}`;
  el.innerHTML = `${role === "ai" ? '<span class="avatar"></span>' : ""}<p></p>`;
  el.querySelector("p").textContent = text;
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
  return el;
}

// Every value here can ultimately trace back to something a user typed
// (business profile fields feed the AI prompt, and the AI can echo them
// back) — always escape before inserting via innerHTML.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item);
      if (item && typeof item === "object") {
        return firstText(item.title, item.text, item.action, item.description, item.name, JSON.stringify(item));
      }
      return "";
    }).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function renderPlan(plan) {
  if (!plan || typeof plan !== "object") {
    planEl.hidden = true;
    return false;
  }

  // Accept the common API response envelopes without assuming one exact shape.
  const data = plan.plan && typeof plan.plan === "object" ? plan.plan
    : plan.result && typeof plan.result === "object" ? plan.result
    : plan.data && typeof plan.data === "object" ? plan.data
    : plan;
  const title = firstText(data.priority?.title, data.title, data.headline, data.strategy_title);
  const reason = firstText(data.priority?.reason, data.reason, data.summary, data.overview, data.explanation);
  const diagnosis = firstText(data.diagnosis, data.answer, data.response, data.message, data.text, data.content);
  const today = normalizeList(data.today || data.do_today || data.actions_today || data.immediate_actions);
  const next = normalizeList(data.next || data.next_steps || data.action_plan || data.recommendations);
  const metrics = normalizeList(data.metrics || data.kpis || data.measurement);
  const assets = data.assets && typeof data.assets === "object" && !Array.isArray(data.assets) ? data.assets : {};
  const ideas = Array.isArray(data.creative_ideas) ? data.creative_ideas : [];

  const hasStructuredContent = Boolean(title || reason || today.length || next.length || metrics.length ||
    Object.keys(assets).length || ideas.length);

  // If the backend returns plain text or a different JSON shape, show it rather than hiding the answer.
  if (!hasStructuredContent) {
    const fallback = diagnosis || (typeof data === "string" ? data : "");
    if (!fallback) {
      planEl.hidden = true;
      return false;
    }
    planEl.hidden = false;
    planEl.innerHTML = `<div class="block"><h4>MARKETRA's Answer</h4><p class="plan-answer">${escapeHtml(fallback).replace(/\n/g, "<br>")}</p></div>`;
    return true;
  }

  const list = (arr, ordered = true) => {
    if (!arr.length) return "";
    const tag = ordered ? "ol" : "ul";
    return `<${tag}>${arr.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
  };

  let html = "";
  if (title || data.priority?.title) {
    html += `<h3>${escapeHtml(title || "Strategy Directive")}</h3>`;
  } else {
    html += `<h3>MARKETRA Strategy</h3>`;
  }
  if (reason) html += `<p class="plan-reason" style="color:var(--ink-secondary);">${escapeHtml(reason)}</p>`;
  if (diagnosis && diagnosis !== reason) {
    html += `<div class="block"><h4>Analysis</h4><p class="plan-answer">${escapeHtml(diagnosis).replace(/\n/g, "<br>")}</p></div>`;
  }
  if (today.length) html += `<div class="block"><h4>Do Today</h4>${list(today)}</div>`;
  if (next.length) html += `<div class="block"><h4>Next Steps</h4>${list(next)}</div>`;
  if (Object.keys(assets).length) {
    html += `<div class="block"><h4>Assets</h4>` +
      Object.entries(assets).map(([k, v]) => `<p><b>${escapeHtml(k)}:</b> ${escapeHtml(typeof v === "string" ? v : JSON.stringify(v))}</p>`).join("") + `</div>`;
  }
  if (ideas.length) {
    html += `<div class="block"><h4>Creative Ideas</h4>` +
      ideas.map((i) => `<p><b>${escapeHtml(firstText(i?.concept, i?.title, "Idea"))}</b><br><span style="color:var(--ink-secondary);">${escapeHtml(firstText(i?.why_it_works, i?.description, i?.details))}</span></p>`).join("") +
      `</div>`;
  }
  if (metrics.length) html += `<div class="block"><h4>Watch</h4>${list(metrics, false)}</div>`;
  planEl.hidden = false;
  planEl.innerHTML = html;
  return true;
}

let marketraRequestInFlight = false;
composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (marketraRequestInFlight) return;
  const message = promptInput.value.trim();
  if (!message) return;
  marketraRequestInFlight = true;
  const submitButton = composer.querySelector('button[type="submit"], button:not([type])');
  if (submitButton) submitButton.disabled = true;
  let thinkingP = null;
  try {
    if (!currentSessionId) await startNewChat();

    addEntry("user", message);
    promptInput.value = "";
    const thinkingEntry = addEntry("ai", "Thinking…");
    thinkingP = thinkingEntry.querySelector("p");

    const options = await getAuthedFetchOptions({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, businessId: currentBusiness.id, sessionId: currentSessionId }),
    });
    const res = await fetchWithTimeout(`${API_BASE}/api/marketing`, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) {
        thinkingP.textContent = body.message || "MARKETRA has hit its daily AI usage limit.";
        if (activeRecommendationId) {
          await updateRecommendationStatus(activeRecommendationId, "open");
          activeRecommendationId = null;
          await loadPriorities();
        }
        return;
      }
      throw new Error(body.message || body.error || `status ${res.status}`);
    }
    const responseText = await res.text();
    let plan;
    try {
      plan = JSON.parse(responseText);
    } catch {
      plan = { answer: responseText };
    }

    const responseData = plan?.plan || plan?.result || plan?.data || plan;
    const diagnosis = firstText(
      responseData?.diagnosis,
      responseData?.answer,
      responseData?.response,
      responseData?.message,
      responseData?.text,
      responseData?.content,
      typeof responseData === "string" ? responseData : ""
    );
    thinkingP.textContent = diagnosis || "Your marketing analysis is ready. Read the detailed result below.";
    const rendered = renderPlan(plan);
    if (!rendered && !diagnosis) {
      thinkingP.textContent = "MARKETRA received a response, but it was empty or in an unsupported format. Please try again.";
    }
    if (activeRecommendationId) {
      await updateRecommendationStatus(activeRecommendationId, "completed");
      activeRecommendationId = null;
      await loadPriorities();
    }
  } catch (err) {
    console.error("[composer]", err);
    if (thinkingP) {
      thinkingP.textContent =
        err.name === "AbortError"
          ? "The backend took too long to respond. Please try again."
          : err.message || "Couldn't reach the MARKETRA backend.";
    }
  } finally {
    marketraRequestInFlight = false;
    if (submitButton) submitButton.disabled = false;
  }
});

// ---------- Measurement loop ----------
async function loadRecentOutcomes() {
  if (!outcomesList || !currentBusiness) return;
  const { data, error } = await sb
    .from("recommendation_outcomes")
    .select("id, metric_name, metric_value, result_summary, notes, recorded_at, recommendation_id")
    .eq("business_id", currentBusiness.id)
    .order("recorded_at", { ascending: false })
    .limit(5);
  if (error) {
    console.warn("[outcomes]", error.message);
    return;
  }
  if (!data?.length) {
    outcomesList.innerHTML = `<p class="empty-note">No outcomes recorded yet. Complete an action, then record its result.</p>`;
    return;
  }
  outcomesList.innerHTML = data.map((o) => `
    <article class="outcome-item">
      <div><span class="outcome-metric">${escapeHtml(o.metric_name)}</span><strong>${escapeHtml(o.metric_value || "Not quantified")}</strong></div>
      <p>${escapeHtml(o.result_summary || o.notes || "Outcome recorded")}</p>
      <small>${new Date(o.recorded_at).toLocaleDateString()}</small>
    </article>`).join("");
}

// A lightweight manual measurement capture keeps the product honest until
// publishing + platform analytics are connected. It records the outcome but
// never pretends the number came from InsightIQ.
async function recordOutcomeForRecommendation(recommendationId) {
  if (!recommendationId || !currentBusiness) return;
  const metric = window.prompt("What metric did you measure? Example: profile visits");
  if (!metric) return;
  const value = window.prompt("What was the result? Example: 184");
  const summary = window.prompt("What happened? Keep it short.") || "Outcome recorded after acting on this recommendation.";
  const { error } = await sb.from("recommendation_outcomes").insert({
    recommendation_id: recommendationId,
    business_id: currentBusiness.id,
    metric_name: metric.trim().slice(0, 120),
    metric_value: value ? value.trim().slice(0, 120) : null,
    result_summary: summary.trim().slice(0, 1000),
  });
  if (error) {
    console.warn("[recordOutcome]", error.message);
    recoStatus.textContent = "Could not save the outcome.";
    return;
  }
  await loadRecentOutcomes();
  recoStatus.textContent = "Outcome recorded. Marketra can use it as business context.";
}

// ---------- Settings ----------
function populateSettingsForm() {
  for (const [key, value] of Object.entries(currentBusiness)) {
    const field = settingsForm.elements[key];
    if (field) field.value = Array.isArray(value) ? value.join(", ") : (value ?? "");
  }
}

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  settingsStatus.textContent = "Saving…";
  const formData = new FormData(settingsForm);
  const updates = Object.fromEntries(formData.entries());
  if (updates.monthly_marketing_budget) {
    updates.monthly_marketing_budget = Number(updates.monthly_marketing_budget);
  }
  try {
    const { data, error } = await sb
      .from("businesses")
      .update(updates)
      .eq("id", currentBusiness.id)
      .select()
      .single();
    if (error) throw error;
    currentBusiness = data;
    topBusinessName.textContent = currentBusiness.business_name;
    settingsStatus.textContent = "Saved.";
  } catch (err) {
    console.error("[settings]", err);
    settingsStatus.textContent = err.message || "Could not save changes.";
  }
});

// ---------- Startup ----------
(async function init() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    currentUser = data.session.user;
    await afterLogin();
  }
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/health`);
    statusDot.style.background = res.ok ? "#10B981" : "#F87171";
  } catch {
    statusDot.style.background = "#F87171";
  }
})();
