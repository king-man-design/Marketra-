window.addEventListener("error", (e) => {
  const banner = document.getElementById("debugBanner");
  if (banner) {
    banner.style.display = "block";
    banner.textContent = "JS ERROR: " + e.message + " (line " + e.lineno + ")";
  }
});

const API_BASE = "https://marketra-ai.onrender.com";
const FETCH_TIMEOUT_MS = 20000;

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
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

function showView(name) {
  document.querySelectorAll(".app-view").forEach((v) => (v.hidden = true));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.getElementById(`${name}View`).hidden = false;
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
}

document.getElementById("newChatFromDash").addEventListener("click", () => startNewChat());
document.getElementById("newChatFromHistory").addEventListener("click", () => startNewChat());

function renderSessionList(container, sessions) {
  if (!sessions.length) {
    container.innerHTML = `<p class="empty-note">No conversations yet.</p>`;
    return;
  }
  container.innerHTML = sessions
    .map(
      (s) => `
      <div class="session-item" data-session-id="${s.id}" data-title="${s.title}">
        <span class="s-title">${s.title}</span>
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

function renderPlan(plan) {
  if (!plan || plan._parse_error) {
    planEl.hidden = true;
    return;
  }
  planEl.hidden = false;
  const list = (arr, ordered) => {
    const tag = ordered ? "ol" : "ul";
    return `<${tag}>${(arr || []).map((i) => `<li>${i}</li>`).join("")}</${tag}>`;
  };

  let html = `
    <h3>${plan.priority?.title || "Strategy Directive"}</h3>
    <p style="color:var(--ink-secondary);">${plan.priority?.reason || ""}</p>
    <div class="block"><h4>Do Today</h4>${list(plan.today, true)}</div>
    <div class="block"><h4>Next Steps</h4>${list(plan.next, true)}</div>
  `;
  if (plan.assets && Object.keys(plan.assets).length) {
    html += `<div class="block"><h4>Assets</h4>` +
      Object.entries(plan.assets).map(([k, v]) => `<p><b>${k}:</b> ${v}</p>`).join("") + `</div>`;
  }
  if (plan.creative_ideas && plan.creative_ideas.length) {
    html += `<div class="block"><h4>Creative Ideas</h4>` +
      plan.creative_ideas.map((i) => `<p><b>${i.concept}</b><br><span style="color:var(--ink-secondary);">${i.why_it_works}</span></p>`).join("") +
      `</div>`;
  }
  if (plan.metrics && plan.metrics.length) {
    html += `<div class="block"><h4>Watch</h4>${list(plan.metrics, false)}</div>`;
  }
  planEl.innerHTML = html;
}

composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = promptInput.value.trim();
  if (!message) return;
  if (!currentSessionId) await startNewChat();

  addEntry("user", message);
  promptInput.value = "";
  const thinkingEntry = addEntry("ai", "Thinking…");
  const thinkingP = thinkingEntry.querySelector("p");

  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/marketing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, businessId: currentBusiness.id, sessionId: currentSessionId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) {
        thinkingP.textContent = body.message || "MARKETRA has hit its daily AI usage limit.";
        return;
      }
      throw new Error(body.error || `status ${res.status}`);
    }
    const plan = await res.json();
    thinkingP.textContent = plan.diagnosis || "Here's the briefing below.";
    renderPlan(plan);
  } catch (err) {
    console.error("[composer]", err);
    thinkingP.textContent =
      err.name === "AbortError"
        ? "The backend took too long to respond. Please try again."
        : "Couldn't reach the MARKETRA backend.";
  }
});

// ---------- Settings ----------
function populateSettingsForm() {
  for (const [key, value] of Object.entries(currentBusiness)) {
    const field = settingsForm.elements[key];
    if (field) field.value = value ?? "";
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
