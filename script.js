// StudyPlanner: simple task manager (no frameworks)

// ----- Get the elements we need from the page -----
var form = document.getElementById("task-form");
var titleInput = document.getElementById("task-title");
var subjectInput = document.getElementById("task-subject");
var dateInput = document.getElementById("task-date");
var errorText = document.getElementById("form-error");

var taskList = document.getElementById("task-list");
var emptyMessage = document.getElementById("empty-message");
var progressText = document.getElementById("progress-text");
var barFill = document.getElementById("bar-fill");
var filterButtons = document.querySelectorAll(".filter-btn");

// ----- App state -----
var tasks = loadTasks();     // the list of all tasks
var currentFilter = "all";   // all, pending or done

// ----- Save and load (browser localStorage) -----
function loadTasks() {
  try {
    var saved = JSON.parse(localStorage.getItem("studyplanner-tasks"));
    if (Array.isArray(saved)) {
      return saved;
    }
  } catch (e) {
    // if saving is blocked, just start with an empty list
  }
  return [];
}

function saveTasks() {
  try {
    localStorage.setItem("studyplanner-tasks", JSON.stringify(tasks));
  } catch (e) {
    // ignore, the app still works without saving
  }
}

// ----- Add a new task -----
form.addEventListener("submit", function (event) {
  event.preventDefault();

  var title = titleInput.value.trim();

  if (title.length < 3) {
    errorText.textContent = "Please write at least 3 characters.";
    titleInput.focus();
    return;
  }

  errorText.textContent = "";

  tasks.unshift({
    id: Date.now(),
    title: title,
    subject: subjectInput.value.trim(),
    date: dateInput.value,
    done: false
  });

  saveTasks();
  showTasks();
  form.reset();
  titleInput.focus();
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
function toggleDone(id) {
  tasks.forEach(function (task) {
    if (task.id === id) {
      task.done = !task.done;
    }
  });
  saveTasks();
  showTasks();
}

function deleteTask(id) {
  tasks = tasks.filter(function (task) {
    return task.id !== id;
  });
  saveTasks();
  showTasks();
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
    toggleDone(task.id);
  });

  var deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "small-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.setAttribute("aria-label", "Delete task: " + task.title);
  deleteBtn.addEventListener("click", function () {
    deleteTask(task.id);
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
  if (task.date) {
    var d = new Date(task.date + "T00:00:00");
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
showTasks();
