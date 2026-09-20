const API_BASE = "https://marketra-ai.onrender.com";

const profileScreen = document.getElementById("profileScreen");
const chatScreen = document.getElementById("chatScreen");
const statusText = document.getElementById("statusText");
const businessForm = document.getElementById("businessForm");
const profileStatus = document.getElementById("profileStatus");
const editProfileBtn = document.getElementById("editProfileBtn");
const feed = document.getElementById("messages");
const planEl = document.getElementById("plan");
const composer = document.getElementById("composer");
const promptInput = document.getElementById("prompt");
const clearBtn = document.getElementById("clearBtn");

let businessId = null;
let businessProfile = null;
try {
  businessId = localStorage.getItem("marketra_business_id") || null;
  businessProfile = JSON.parse(localStorage.getItem("marketra_business_profile") || "null");
} catch (err) {
  console.warn("localStorage unavailable:", err);
}

function showChatScreen() {
  profileScreen.hidden = true;
  chatScreen.hidden = false;
}
function showProfileScreen() {
  chatScreen.hidden = true;
  profileScreen.hidden = false;
  if (businessProfile) {
    for (const [key, value] of Object.entries(businessProfile)) {
      const field = businessForm.elements[key];
      if (field) field.value = value;
    }
  }
}

// If we already have a saved profile from a previous visit, skip straight to chat.
if (businessProfile) showChatScreen();

async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (!res.ok) throw new Error();
    statusText.textContent = "backend connected";
  } catch {
    statusText.textContent = "backend offline — start the Node server";
  }
}
checkHealth();

businessForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = businessForm.querySelector("button[type=submit]");
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Connecting…";
  profileStatus.textContent = "Waking up the server — this can take up to a minute on first use.";

  const formData = new FormData(businessForm);
  const profile = Object.fromEntries(formData.entries());
  if (businessId) profile.id = businessId;
  if (profile.monthly_marketing_budget) {
    profile.monthly_marketing_budget = Number(profile.monthly_marketing_budget);
  }

  try {
    const res = await fetch(`${API_BASE}/api/business`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    if (!res.ok) throw new Error(await res.text());
    const saved = await res.json();
    businessId = saved.id;
    businessProfile = saved;
    localStorage.setItem("marketra_business_id", businessId);
  } catch (err) {
    businessProfile = profile;
  }
  try {
    localStorage.setItem("marketra_business_profile", JSON.stringify(businessProfile));
  } catch (storageErr) {
    console.warn("Could not save to localStorage:", storageErr);
  }
  showChatScreen();
});

editProfileBtn.addEventListener("click", showProfileScreen);

function addEntry(role, text) {
  const el = document.createElement("article");
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
    <button class="plan-close" type="button" aria-label="Close briefing">✕</button>
    <span class="stamp">Priority</span>
    <h3>${plan.priority?.title || "—"}</h3>
    <p class="reason">${plan.priority?.reason || ""}</p>
    <div class="block"><h4>Do today</h4>${list(plan.today, true)}</div>
    <div class="block"><h4>Next</h4>${list(plan.next, true)}</div>
  `;

  if (plan.assets && Object.keys(plan.assets).length) {
    html += `<div class="block"><h4>Assets</h4>` +
      Object.entries(plan.assets).map(([k, v]) => `<div class="asset-line"><b>${k}:</b> ${v}</div>`).join("") +
      `</div>`;
  }

  html += `<div class="block"><h4>Watch</h4>${list(plan.metrics, false)}</div>`;
  if (plan.decision_rule) {
    html += `<div class="block"><h4>Decision rule</h4><p style="font-size:0.86rem;margin:0;background:none;border:none;padding:0;">${plan.decision_rule}</p></div>`;
  }
  planEl.innerHTML = html;
  planEl.querySelector(".plan-close").addEventListener("click", () => {
    planEl.hidden = true;
    planEl.innerHTML = "";
  });
}

composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = promptInput.value.trim();
  if (!message) return;
  addEntry("user", message);
  promptInput.value = "";
  const thinkingEntry = addEntry("ai", "Thinking…");
  const thinkingP = thinkingEntry.querySelector("p");

  try {
    const res = await fetch(`${API_BASE}/api/marketing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        businessId,
        business: businessId ? undefined : businessProfile,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) {
        thinkingP.textContent = body.message || "MARKETRA has hit its daily AI usage limit. Please try again later.";
        return;
      }
      throw new Error(body.error || "request failed");
    }
    const plan = await res.json();
    thinkingP.textContent = plan.diagnosis || "Here's the briefing below.";
    renderPlan(plan);
  } catch (err) {
    thinkingP.textContent =
      "Couldn't reach the MARKETRA backend. Make sure the Node server is running and GEMINI_API_KEY is set.";
  }
});

clearBtn.addEventListener("click", () => {
  feed.innerHTML = "";
  planEl.hidden = true;
  planEl.innerHTML = "";
});
