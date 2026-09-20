const API_BASE = "https://marketra-ai.onrender.com";

const pageSetup = document.getElementById("page-setup");
const pageChat = document.getElementById("page-chat");
const businessForm = document.getElementById("businessForm");
const backBtn = document.getElementById("backBtn");
const feed = document.getElementById("messages");
const planEl = document.getElementById("plan");
const composer = document.getElementById("composer");
const promptInput = document.getElementById("prompt");
const clearBtn = document.getElementById("clearBtn");

let businessId = localStorage.getItem("marketra_business_id") || null;
let businessProfile = null;

function showPage(pageName) {
  if (pageName === "chat") {
    pageSetup.classList.remove("active");
    pageChat.classList.add("active");
  } else {
    pageChat.classList.remove("active");
    pageSetup.classList.add("active");
  }
}

if (businessId) {
  showPage("chat");
}

backBtn.addEventListener("click", () => showPage("setup"));

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
  } catch (err) {
    businessProfile = profile;
  }

  showPage("chat");
});

function addEntry(role, text) {
  const el = document.createElement("div");
  el.className = `entry ${role === "ai" ? "from-marketra" : "from-you"}`;
  el.innerHTML = `<p class="byline">${role === "ai" ? "MARKETRA" : "YOU"}</p><p></p>`;
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

  planEl.innerHTML = `
    <h3>${plan.priority?.title || "Strategy Directive"}</h3>
    <p style="color:#B1A8C3;">${plan.priority?.reason || ""}</p>
    <div class="block"><h4>Do Today</h4>${list(plan.today, true)}</div>
    <div class="block"><h4>Next Steps</h4>${list(plan.next, true)}</div>
  `;
}

composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = promptInput.value.trim();
  if (!message) return;
  
  addEntry("user", message);
  promptInput.value = "";
  
  const thinkingEntry = addEntry("ai", "Analyzing market vectors...");
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
    
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) {
        thinkingP.textContent = body.message || "Daily usage limit reached. Try again shortly.";
        return;
      }
      throw new Error(body.error || "request failed");
    }
    
    const plan = await res.json();
    thinkingP.textContent = plan.diagnosis || "Here is your plan below.";
    renderPlan(plan);
  } catch (err) {
    thinkingP.textContent = "Unable to connect to backend.";
  }
});

clearBtn.addEventListener("click", () => {
  feed.innerHTML = `
    <div class="entry from-marketra">
      <p class="byline">MARKETRA</p>
      <p>Conversation reset. How can I assist with your marketing?</p>
    </div>
  `;
  planEl.hidden = true;
  planEl.innerHTML = "";
});
