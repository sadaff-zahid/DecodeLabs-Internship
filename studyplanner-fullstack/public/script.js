// StudyPlanner frontend - Project 4: Frontend and Backend Integration
// The page sends requests to the backend with fetch() and async/await,
// shows the answers on the screen, and handles errors without crashing.

// If the page and the API are on the SAME website, leave this empty.
// If the API lives somewhere else, put its address here, e.g. "https://my-api.onrender.com"
// (the server already allows this with CORS).
const API_BASE = "";

const TASKS_URL = API_BASE + "/api/tasks";
const SUBJECTS_URL = API_BASE + "/api/subjects";
const STATS_URL = API_BASE + "/api/stats";
const REQUEST_TIMEOUT = 30000;   // give up after 30 seconds

// ----- Elements on the page -----
const form = document.getElementById("task-form");
const titleInput = document.getElementById("task-title");
const subjectInput = document.getElementById("task-subject");
const dateInput = document.getElementById("task-date");
const formError = document.getElementById("form-error");
const addButton = document.getElementById("add-button");
const subjectList = document.getElementById("subject-list");

const tasksCard = document.getElementById("tasks-card");
const taskList = document.getElementById("task-list");
const emptyMessage = document.getElementById("empty-message");
const spinner = document.getElementById("spinner");
const statusText = document.getElementById("status-text");
const errorPanel = document.getElementById("error-panel");
const errorMessage = document.getElementById("error-message");
const retryButton = document.getElementById("retry-button");
const toast = document.getElementById("toast");
const filterButtons = document.querySelectorAll(".filter-btn");

const progressText = document.getElementById("progress-text");
const barFill = document.getElementById("bar-fill");
const statTotal = document.getElementById("stat-total");
const statPending = document.getElementById("stat-pending");
const statDone = document.getElementById("stat-done");

// ----- App state -----
let currentFilter = "all";   // all, pending or done
let hasError = false;        // true while the fallback screen is showing
let toastTimer = null;

// ===================================================================
// Talking to the server
// ===================================================================

// An error that carries the HTTP status code and a message a person can understand
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;   // 0 means we never got an answer from the server
  }
}

// Turns a status code into a friendly message. We look at the code, not at the error text.
function describeError(status, payload) {
  const error = payload && payload.error;

  if (status === 400 && error && error.details && error.details.length > 0) {
    return error.details.map(function (detail) { return detail.message; }).join(" ");
  }

  switch (status) {
    case 400: return error ? error.message : "The server could not understand that request.";
    case 404: return "That item was not found. It may have been deleted.";
    case 409: return "That value already exists.";
    case 413: return "That request is too large.";
    case 429: return "Too many requests. Please wait a minute and try again.";
    case 503: return "The database is not reachable right now. Please try again soon.";
    default:
      return status >= 500
        ? "The server had a problem. Please try again."
        : "Something went wrong. Please try again.";
  }
}

// Sends one request and gives back the JSON answer (or null for 204 No Content).
// If anything goes wrong it throws an ApiError with a clear message.
async function request(method, url, body) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT);

  const options = {
    method: method,
    headers: { "Accept": "application/json" },
    signal: controller.signal
  };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);   // objects must become text before they travel
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    // fetch only fails like this when there is no answer at all (offline, server down, timeout)
    if (error.name === "AbortError") {
      throw new ApiError("The server took too long to answer. Please try again.", 0);
    }
    throw new ApiError("Could not reach the server. Check your internet connection.", 0);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) {
    return null;
  }

  let payload = null;
  try {
    payload = await response.json();   // text from the network becomes a JavaScript object
  } catch (error) {
    // the reply was not JSON, so payload stays null
  }

  // fetch does NOT throw on 404 or 500, so we must check response.ok ourselves
  if (!response.ok) {
    throw new ApiError(describeError(response.status, payload), response.status);
  }
  return payload;
}

// ===================================================================
// Loading the data (the three requests run at the same time)
// ===================================================================

async function refresh() {
  const query = currentFilter === "all" ? "" : "?status=" + currentFilter;

  // Promise.allSettled runs all three requests in parallel and waits for every answer.
  // The tasks are required. The subjects and the totals are nice to have.
  const results = await Promise.allSettled([
    request("GET", TASKS_URL + query),
    request("GET", SUBJECTS_URL),
    request("GET", STATS_URL)
  ]);

  if (results[0].status === "rejected") {
    throw results[0].reason;
  }

  showTasks(results[0].value.data);
  if (results[1].status === "fulfilled") showSubjects(results[1].value.data);
  if (results[2].status === "fulfilled") showStats(results[2].value.data);
}

// Loads the page data and shows loading and error screens along the way
async function loadPage() {
  setLoading(true);
  // Free hosting can sleep, so the first answer may be slow. Tell the user why.
  const slowTimer = setTimeout(function () {
    statusText.textContent = "Still loading... the free server may be waking up. This can take up to a minute.";
  }, 4000);

  try {
    await refresh();
    hideError();
  } catch (error) {
    showError(error.message);   // fallback screen with a "Try again" button
  } finally {
    clearTimeout(slowTimer);
    setLoading(false);          // runs whether it worked or failed
  }
}

// Reloads the data after a change. A problem here becomes a message, not a crash.
async function refreshAndReport() {
  try {
    await refresh();
    hideError();
  } catch (error) {
    showToast(error.message, "error");
  }
}

// ===================================================================
// Changing data
// ===================================================================

form.addEventListener("submit", async function (event) {
  event.preventDefault();
  formError.textContent = "";
  addButton.disabled = true;
  addButton.textContent = "Adding...";

  try {
    await request("POST", TASKS_URL, {
      title: titleInput.value,
      subject: subjectInput.value,
      dueDate: dateInput.value
    });
    form.reset();
    titleInput.focus();
    await refreshAndReport();
    showToast("Task added.", "success");
  } catch (error) {
    formError.textContent = error.message;   // the server checked the data and said why not
    titleInput.focus();
  } finally {
    addButton.disabled = false;
    addButton.textContent = "Add task";
  }
});

// Runs one change (mark done, delete) for a task, then reloads the list
async function changeTask(button, action, successMessage) {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    showToast(error.message, "error");
    if (error.status === 404) {
      await refreshAndReport();   // the task is gone, so refresh the list
    } else {
      button.disabled = false;
    }
    return;
  }
  await refreshAndReport();
  showToast(successMessage, "success");
}

filterButtons.forEach(function (button) {
  button.addEventListener("click", async function () {
    currentFilter = button.dataset.filter;
    filterButtons.forEach(function (b) {
      const isActive = (b === button);
      b.classList.toggle("active", isActive);
      b.setAttribute("aria-pressed", String(isActive));
    });
    await loadPage();   // the server does the filtering
  });
});

retryButton.addEventListener("click", loadPage);

// ===================================================================
// Showing things on the page
// ===================================================================

function setLoading(isLoading) {
  spinner.hidden = !isLoading;
  tasksCard.setAttribute("aria-busy", String(isLoading));
  statusText.textContent = isLoading ? "Loading tasks..." : "";
}

function showError(message) {
  hasError = true;
  errorMessage.textContent = message;
  errorPanel.hidden = false;
  emptyMessage.hidden = true;
}

function hideError() {
  hasError = false;
  errorPanel.hidden = true;
}

function showToast(message, kind) {
  toast.textContent = message;
  toast.className = "toast show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.className = "toast"; }, 4000);
}

// Turns the list of tasks from the server into cards on the page
function showTasks(tasks) {
  taskList.replaceChildren(...tasks.map(makeTaskItem));
  emptyMessage.hidden = tasks.length > 0 || hasError;
}

function makeTaskItem(task) {
  const item = document.createElement("li");
  item.className = "task-wrap";

  const box = document.createElement("div");
  box.className = task.done ? "task done" : "task";

  // text part. textContent is used so that user text can never run as HTML (XSS safety)
  const text = document.createElement("div");

  const title = document.createElement("p");
  title.className = "task-title";
  title.textContent = task.title;

  const info = document.createElement("p");
  info.className = "task-info";
  info.textContent = makeInfoText(task);

  text.append(title, info);

  // buttons part
  const buttons = document.createElement("div");
  buttons.className = "task-buttons";

  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "small-btn";
  doneBtn.textContent = task.done ? "Undo" : "Done";
  doneBtn.setAttribute("aria-label", (task.done ? "Mark as pending: " : "Mark as done: ") + task.title);
  doneBtn.addEventListener("click", function () {
    // PATCH changes only the field we send
    changeTask(
      doneBtn,
      function () { return request("PATCH", TASKS_URL + "/" + task.id, { done: !task.done }); },
      task.done ? "Task moved back to pending." : "Task marked as done."
    );
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "small-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.setAttribute("aria-label", "Delete task: " + task.title);
  deleteBtn.addEventListener("click", function () {
    changeTask(
      deleteBtn,
      function () { return request("DELETE", TASKS_URL + "/" + task.id); },
      "Task deleted."
    );
  });

  buttons.append(doneBtn, deleteBtn);
  box.append(text, buttons);
  item.append(box);
  return item;
}

// builds a line like "Maths · Due 20 Oct 2026"
function makeInfoText(task) {
  const parts = [];
  if (task.subject) {
    parts.push(task.subject);
  }
  if (task.dueDate) {
    const date = new Date(task.dueDate + "T00:00:00");
    parts.push("Due " + date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));
  }
  return parts.length > 0 ? parts.join(" · ") : "No details";
}

// Subject names are suggested while you type in the subject box
function showSubjects(subjects) {
  subjectList.replaceChildren(...subjects.map(function (subject) {
    const option = document.createElement("option");
    option.value = subject.name;
    return option;
  }));
}

// The totals come from the server, so they are always true for the whole list
function showStats(stats) {
  statTotal.textContent = stats.total;
  statPending.textContent = stats.pending;
  statDone.textContent = stats.done;

  if (stats.total === 0) {
    progressText.textContent = "No tasks yet.";
    barFill.style.width = "0%";
  } else {
    progressText.textContent = stats.done + " of " + stats.total + " tasks done";
    barFill.style.width = Math.round((stats.done / stats.total) * 100) + "%";
  }
}

// ----- Start the app -----
loadPage();
