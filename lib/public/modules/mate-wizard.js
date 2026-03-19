// Mate Wizard Module
// Handles the 4-step wizard for creating a new Mate

var mateWizardStep = 1;
var mateWizardData = {
  relationship: null,
  activity: [],
  communicationStyle: [],
  autonomy: "minor_stuff_ok",
};

var _sendWs = null;
var _onMateCreated = null;

export function initMateWizard(sendWs, onMateCreated) {
  _sendWs = sendWs;
  _onMateCreated = onMateCreated;

  // Button listeners
  var closeBtn = document.getElementById("mate-wizard-close");
  var backdrop = document.querySelector(".mate-wizard-backdrop");
  var backBtn = document.getElementById("mate-wizard-back");
  var nextBtn = document.getElementById("mate-wizard-next");

  if (closeBtn) closeBtn.addEventListener("click", closeMateWizard);
  if (backdrop) backdrop.addEventListener("click", closeMateWizard);
  if (backBtn) backBtn.addEventListener("click", mateWizardBack);
  if (nextBtn) nextBtn.addEventListener("click", mateWizardNext);

  // Step 1: Relationship card clicks
  var cards = document.querySelectorAll("#mate-wizard .mate-card");
  for (var i = 0; i < cards.length; i++) {
    (function (card) {
      card.addEventListener("click", function () {
        // Deselect all
        var allCards = document.querySelectorAll("#mate-wizard .mate-card");
        for (var j = 0; j < allCards.length; j++) {
          allCards[j].classList.remove("selected");
        }
        card.classList.add("selected");
        mateWizardData.relationship = card.dataset.value;

        // Show/hide custom input
        var customInput = document.getElementById("mate-relationship-custom");
        if (customInput) {
          if (card.dataset.value === "custom") {
            customInput.classList.remove("hidden");
            customInput.focus();
          } else {
            customInput.classList.add("hidden");
          }
        }
      });
    })(cards[i]);
  }

  // Step 2: Activity tag clicks
  var tags = document.querySelectorAll("#mate-wizard .mate-tag");
  for (var i = 0; i < tags.length; i++) {
    (function (tag) {
      tag.addEventListener("click", function () {
        tag.classList.toggle("selected");
      });
    })(tags[i]);
  }

  // Step 2: Custom activity input (just a free-text field, collected on submit)
  var activityCustom = document.getElementById("mate-activity-custom");
  if (activityCustom) {
    activityCustom.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") e.preventDefault();
    });
    activityCustom.addEventListener("keyup", function (e) { e.stopPropagation(); });
    activityCustom.addEventListener("keypress", function (e) { e.stopPropagation(); });
  }

  // Step 3: Communication style card clicks (multi-select)
  var styleCards = document.querySelectorAll("#mate-wizard .mate-style-card");
  for (var i = 0; i < styleCards.length; i++) {
    (function (card) {
      card.addEventListener("click", function () {
        card.classList.toggle("selected");
      });
    })(styleCards[i]);
  }

  // Step 4: Autonomy button clicks
  var autonomyBtns = document.querySelectorAll("#mate-wizard .mate-autonomy-btn");
  for (var i = 0; i < autonomyBtns.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        var allBtns = document.querySelectorAll("#mate-wizard .mate-autonomy-btn");
        for (var j = 0; j < allBtns.length; j++) {
          allBtns[j].classList.remove("active");
        }
        btn.classList.add("active");
        mateWizardData.autonomy = btn.dataset.value;
      });
    })(autonomyBtns[i]);
  }
}

export function openMateWizard() {
  mateWizardStep = 1;
  mateWizardData = {
    relationship: null,
    activity: [],
    communicationStyle: [],
    autonomy: "minor_stuff_ok",
  };

  // Reset UI
  var el = document.getElementById("mate-wizard");
  if (!el) return;

  // Reset cards
  var cards = el.querySelectorAll(".mate-card");
  for (var i = 0; i < cards.length; i++) {
    cards[i].classList.remove("selected");
  }
  var customInput = document.getElementById("mate-relationship-custom");
  if (customInput) { customInput.classList.add("hidden"); customInput.value = ""; }

  // Reset tags
  var tags = el.querySelectorAll(".mate-tag");
  for (var i = 0; i < tags.length; i++) {
    tags[i].classList.remove("selected");
  }
  var activityCustom = document.getElementById("mate-activity-custom");
  if (activityCustom) activityCustom.value = "";

  // Reset style cards
  var styleCards = el.querySelectorAll(".mate-style-card");
  for (var i = 0; i < styleCards.length; i++) {
    styleCards[i].classList.remove("selected");
  }

  // Reset autonomy
  var autonomyBtns = el.querySelectorAll(".mate-autonomy-btn");
  for (var i = 0; i < autonomyBtns.length; i++) {
    autonomyBtns[i].classList.remove("active");
    if (autonomyBtns[i].dataset.value === "minor_stuff_ok") {
      autonomyBtns[i].classList.add("active");
    }
  }

  el.classList.remove("hidden");
  updateMateWizardStep();
}

export function closeMateWizard() {
  var el = document.getElementById("mate-wizard");
  if (el) el.classList.add("hidden");
}

function updateMateWizardStep() {
  var steps = document.querySelectorAll("#mate-wizard .mate-step");
  for (var i = 0; i < steps.length; i++) {
    var stepNum = parseInt(steps[i].getAttribute("data-step"), 10);
    if (stepNum === mateWizardStep) {
      steps[i].classList.add("active");
    } else {
      steps[i].classList.remove("active");
    }
  }

  var dots = document.querySelectorAll("#mate-wizard .mate-dot");
  for (var j = 0; j < dots.length; j++) {
    var dotStep = parseInt(dots[j].getAttribute("data-step"), 10);
    dots[j].classList.remove("active", "done");
    if (dotStep === mateWizardStep) dots[j].classList.add("active");
    else if (dotStep < mateWizardStep) dots[j].classList.add("done");
  }

  var backBtn = document.getElementById("mate-wizard-back");
  var nextBtn = document.getElementById("mate-wizard-next");
  if (backBtn) backBtn.style.visibility = mateWizardStep === 1 ? "hidden" : "visible";
  if (nextBtn) nextBtn.textContent = mateWizardStep === 4 ? "Create Mate" : "Next";
}

function collectMateWizardData() {
  // Relationship
  var selectedCard = document.querySelector("#mate-wizard .mate-card.selected");
  if (selectedCard) {
    mateWizardData.relationship = selectedCard.dataset.value;
    if (selectedCard.dataset.value === "custom") {
      var customInput = document.getElementById("mate-relationship-custom");
      if (customInput && customInput.value.trim()) {
        mateWizardData.relationship = customInput.value.trim();
      }
    }
  }

  // Activities
  var selectedTags = document.querySelectorAll("#mate-wizard .mate-tag.selected");
  mateWizardData.activity = [];
  for (var i = 0; i < selectedTags.length; i++) {
    mateWizardData.activity.push(selectedTags[i].dataset.value || selectedTags[i].textContent.toLowerCase());
  }
  var activityCustom = document.getElementById("mate-activity-custom");
  if (activityCustom && activityCustom.value.trim()) {
    mateWizardData.activity.push(activityCustom.value.trim());
  }

  // Communication style (multi-select cards)
  var selectedStyles = document.querySelectorAll("#mate-wizard .mate-style-card.selected");
  mateWizardData.communicationStyle = [];
  for (var i = 0; i < selectedStyles.length; i++) {
    mateWizardData.communicationStyle.push(selectedStyles[i].dataset.value);
  }

  // Autonomy (already set via button clicks)
}

function mateWizardNext() {
  collectMateWizardData();

  // Validate current step
  if (mateWizardStep === 1) {
    if (!mateWizardData.relationship) {
      // Flash the cards to indicate selection needed
      var grid = document.querySelector("#mate-wizard .mate-card-grid");
      if (grid) {
        grid.style.outline = "2px solid var(--error, #ff5555)";
        grid.style.outlineOffset = "4px";
        grid.style.borderRadius = "10px";
        setTimeout(function () { grid.style.outline = ""; grid.style.outlineOffset = ""; }, 1500);
      }
      return;
    }
  }

  if (mateWizardStep < 4) {
    mateWizardStep++;
    updateMateWizardStep();
    return;
  }

  // Step 4: Submit
  mateWizardSubmit();
}

function mateWizardBack() {
  if (mateWizardStep > 1) {
    collectMateWizardData();
    mateWizardStep--;
    updateMateWizardStep();
  }
}

function mateWizardSubmit() {
  collectMateWizardData();
  closeMateWizard();

  if (_sendWs) {
    _sendWs({ type: "mate_create", seedData: mateWizardData });
  }
}

export function handleMateCreated(mate) {
  if (_onMateCreated) {
    _onMateCreated(mate);
  }
}
