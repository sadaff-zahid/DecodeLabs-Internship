// StudyPlanner frontend. It talks to the backend API (server.js) with fetch().

// If you host this page somewhere else (like GitHub Pages),
// put the full address of your API here, e.g. "https://my-api.onrender.com/api/tasks"
var API_URL = "/api/tasks";

// ----- Get the elements we need from the page -----
var form = document.getElementById("task-form");
var titleInput = document.getElementById("task-title");
var subjectInput = document.getElementById("task-subject");
var dateInput = document.getElementById("task-date");
var errorText = document.getElementById("form-error");
var addButton = document.getElementById("add-button");

var taskList = document.getElementById("task-list");
var emptyMessage = document.getElementById("empty-message");
var statusText = document.getElementById("status");
var progressText = document.getElementById("progress-text");
var barFill = document.getElementById("bar-fill");
var filterButtons = document.querySelectorAll(".filter-btn");

// ----- App state -----
var tasks = [];             // tasks we got from the server
var currentFilter = "all";  // all, pending or done

// ----- Talk to the server -----
// Sends a request and gives back { ok, status, data }
function callApi(method, url, body) {
  var options = { method: method, headers: {} };
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  return fetch(url, options).then(function (response) {
    if (response.status === 204) {
      return { ok: true, status: 204, data: null };   // 204 means success with no content
    }
    return response.json().then(function (data) {
      return { ok: response.ok, status: response.status, data: data };
    });
  });
}

// Turns a server error into a short message for the user
function errorMessage(result) {
  var error = result.data && result.data.error;
  if (!error) return "Something went wrong. Please try again.";
  if (error.details && error.details.length) {
    return error.details.map(function (d) { return d.message; }).join(" ");
  }
  return error.message;
}

function showStatus(message, isProblem) {
  statusText.textContent = message;
  statusText.className = isProblem ? "status problem" : "status";
}

// ----- Load all tasks when the page opens -----
function loadTasks() {
  showStatus("Loading tasks...", false);
  callApi("GET", API_URL)
    .then(function (result) {
      if (result.ok) {
        tasks = result.data.data;
        showStatus("", false);
      } else {
        showStatus(errorMessage(result), true);
      }
      showTasks();
    })
    .catch(function () {
      showStatus("Could not reach the server. Please try again later.", true);
      showTasks();
    });
}

// ----- Add a new task -----
form.addEventListener("submit", function (event) {
  event.preventDefault();
  errorText.textContent = "";
  addButton.disabled = true;

  var newTask = {
    title: titleInput.value,
    subject: subjectInput.value,
    dueDate: dateInput.value
  };

  callApi("POST", API_URL, newTask)
    .then(function (result) {
      if (result.ok) {
        tasks.unshift(result.data.data);
        showTasks();
        form.reset();
        titleInput.focus();
      } else {
        errorText.textContent = errorMessage(result);   // the server checked the data
        titleInput.focus();
      }
    })
    .catch(function () {
      errorText.textContent = "Could not reach the server. Please try again.";
    })
    .then(function () {
      addButton.disabled = false;
    });
});

// ----- Filter buttons -----
filterButtons.forEach(function (button) {
  button.addEventListener("click", function () {
    currentFilter = button.dataset.filter;

    filterButtons.forEach(function (b) {
      var isActive = (b === button);
      b.classList.toggle("active", isActive);
      b.setAttribute("aria-pressed", String(isActive));
    });

    showTasks();
  });
});

// ----- Change a task -----
function toggleDone(task) {
  var updated = {
    title: task.title,
    subject: task.subject,
    dueDate: task.dueDate,
    done: !task.done
  };
  callApi("PUT", API_URL + "/" + task.id, updated)
    .then(function (result) {
      if (result.ok) {
        tasks = tasks.map(function (t) { return t.id === task.id ? result.data.data : t; });
        showStatus("", false);
      } else if (result.status === 404) {
        loadTasks();   // the task was removed somewhere else, so refresh the list
        return;
      } else {
        showStatus(errorMessage(result), true);
      }
      showTasks();
    })
    .catch(function () {
      showStatus("Could not reach the server. Please try again.", true);
    });
}

function deleteTask(task) {
  callApi("DELETE", API_URL + "/" + task.id)
    .then(function (result) {
      if (result.ok || result.status === 404) {
        tasks = tasks.filter(function (t) { return t.id !== task.id; });
        showStatus("", false);
      } else {
        showStatus(errorMessage(result), true);
      }
      showTasks();
    })
    .catch(function () {
      showStatus("Could not reach the server. Please try again.", true);
    });
}

// ----- Draw everything on the page -----
function showTasks() {
  taskList.innerHTML = "";

  // choose which tasks to show
  var visible = tasks.filter(function (task) {
    if (currentFilter === "pending") return !task.done;
    if (currentFilter === "done") return task.done;
    return true;
  });

  visible.forEach(function (task) {
    taskList.appendChild(makeTaskItem(task));
  });

  emptyMessage.hidden = visible.length > 0;
  updateProgress();
}

function makeTaskItem(task) {
  var item = document.createElement("li");
  item.className = "task-wrap";

  var box = document.createElement("div");
  box.className = task.done ? "task done" : "task";

  // text part
  var text = document.createElement("div");

  var title = document.createElement("p");
  title.className = "task-title";
  title.textContent = task.title;

  var info = document.createElement("p");
  info.className = "task-info";
  info.textContent = makeInfoText(task);

  text.appendChild(title);
  text.appendChild(info);

  // buttons part
  var buttons = document.createElement("div");
  buttons.className = "task-buttons";

  var doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "small-btn";
  doneBtn.textContent = task.done ? "Undo" : "Done";
  doneBtn.setAttribute("aria-label", (task.done ? "Mark as pending: " : "Mark as done: ") + task.title);
  doneBtn.addEventListener("click", function () {
    toggleDone(task);
  });

  var deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "small-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.setAttribute("aria-label", "Delete task: " + task.title);
  deleteBtn.addEventListener("click", function () {
    deleteTask(task);
  });

  buttons.appendChild(doneBtn);
  buttons.appendChild(deleteBtn);

  box.appendChild(text);
  box.appendChild(buttons);
  item.appendChild(box);
  return item;
}

// builds a line like "Maths · Due 20 Oct 2026"
function makeInfoText(task) {
  var parts = [];
  if (task.subject) {
    parts.push(task.subject);
  }
  if (task.dueDate) {
    var d = new Date(task.dueDate + "T00:00:00");
    parts.push("Due " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));
  }
  return parts.length ? parts.join(" · ") : "No details";
}

function updateProgress() {
  var total = tasks.length;
  var done = tasks.filter(function (task) { return task.done; }).length;

  if (total === 0) {
    progressText.textContent = "No tasks yet.";
    barFill.style.width = "0%";
    return;
  }

  progressText.textContent = done + " of " + total + " tasks done";
  barFill.style.width = Math.round((done / total) * 100) + "%";
}

// ----- Start the app -----
loadTasks();
