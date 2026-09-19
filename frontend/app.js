const API_BASE = "https://marketra-ai.onrender.com";

const statusText = document.getElementById("statusText");
const businessForm = document.getElementById("businessForm");
const profileStatus = document.getElementById("profileStatus");
const feed = document.getElementById("messages");
const planEl = document.getElementById("plan");
const composer = document.getElementById("composer");
const promptInput = document.getElementById("prompt");
const clearBtn = document.getElementById("clearBtn");

let businessId = localStorage.getItem("marketra_business_id") || null;
let businessProfile = null;

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
    profileStatus.textContent = `Saved: ${saved.business_name}. MARKETRA will remember this business.`;
  } catch (err) {
    businessProfile = profile;
    profileStatus.textContent = "Saved for this session only (no database connected yet).";
  }
});

function addEntry(role, text) {
  const el = document.createElement("article");
  el.className = `entry ${role === "ai" ? "from-marketra" : "from-you"}`;
  el.innerHTML = `<p class="byline">${role === "ai" ? "Marketra" : "You"}</p><p></p>`;
  el.querySelector("p:last-child").textContent = text;
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
    html += `<div class="block"><h4>Decision rule</h4><p style="font-size:0.86rem;margin:0;">${plan.decision_rule}</p></div>`;
  }
  planEl.innerHTML = html;
}

composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = promptInput.value.trim();
  if (!message) return;
  addEntry("user", message);
  promptInput.value = "";
  const thinkingEntry = addEntry("ai", "Thinking…");
  const thinkingP = thinkingEntry.querySelector("p:last-child");

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
    if (!res.ok) throw new Error(await res.text());
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
