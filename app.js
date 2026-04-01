const STORAGE_KEY = "mishitza-state";
const DRAG_HOLD_DURATION_MS = 100;
const EDIT_HOLD_DURATION_MS = 1000;
const DRAG_START_DISTANCE_PX = 10;

const app = document.getElementById("app");
const dialogRoot = document.getElementById("dialog-root");
const homeTemplate = document.getElementById("home-screen-template");
const workoutTemplate = document.getElementById("workout-screen-template");
const stopwatchStore = {};
let activeStopwatchIntervalId = null;
let completeMessageTimeoutId = null;

const state = loadState();

registerServiceWorker();
initializeHistory();
render();

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return createEmptyState();
  }

  try {
    return normalizeState(JSON.parse(saved));
  } catch {
    return createEmptyState();
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // PWA installability is optional; the app should still work without registration.
    });
  });
}

function initializeHistory() {
  window.addEventListener("popstate", (event) => {
    const leavingWorkoutId = state.currentWorkoutId;
    const nextWorkoutId = event.state?.workoutId ?? null;

    if (leavingWorkoutId && !nextWorkoutId) {
      const workout = state.workouts.find((entry) => entry.id === leavingWorkoutId);

      if (workout && isWorkoutComplete(workout)) {
        resetAllWorkoutProgress();
      }
    }

    state.currentWorkoutId = event.state?.workoutId ?? null;
    saveState();
    render();
  });

  history.replaceState({ workoutId: null }, "", buildUrl(null));

  if (state.currentWorkoutId) {
    history.pushState(
      { workoutId: state.currentWorkoutId },
      "",
      buildUrl(state.currentWorkoutId)
    );
  }
}

function buildUrl(workoutId) {
  const base = `${window.location.pathname}${window.location.search}`;
  return workoutId ? `${base}#workout=${encodeURIComponent(workoutId)}` : base;
}

function openWorkout(workoutId) {
  state.currentWorkoutId = workoutId;
  saveState();
  history.pushState({ workoutId }, "", buildUrl(workoutId));
  render();
}

function goHome() {
  if (history.state?.workoutId) {
    history.back();
    return;
  }

  state.currentWorkoutId = null;
  saveState();
  history.replaceState({ workoutId: null }, "", buildUrl(null));
  render();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createEmptyState() {
  return {
    workouts: [],
    currentWorkoutId: null,
    lastCompletedWorkoutId: null,
  };
}

function normalizeState(parsed) {
  return {
    workouts: Array.isArray(parsed.workouts)
      ? parsed.workouts.map((workout) => ({
          id: workout.id || crypto.randomUUID(),
          title: workout.title ?? "",
          exercises: Array.isArray(workout.exercises)
            ? workout.exercises.map((exercise) => ({
                id: exercise.id || crypto.randomUUID(),
                name: exercise.name ?? "",
                max: exercise.max ?? exercise.reps ?? "",
                checked: Boolean(exercise.checked),
              }))
            : [],
          lastCompletedAt: workout.lastCompletedAt ?? null,
        }))
      : [],
    currentWorkoutId: parsed.currentWorkoutId ?? null,
    lastCompletedWorkoutId: parsed.lastCompletedWorkoutId ?? null,
  };
}

function replaceState(nextState) {
  state.workouts = nextState.workouts;
  state.currentWorkoutId = nextState.currentWorkoutId;
  state.lastCompletedWorkoutId = nextState.lastCompletedWorkoutId;
}

function exportStateToJson() {
  const backup = {
    workouts: state.workouts,
    lastCompletedWorkoutId: state.lastCompletedWorkoutId,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date();
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  link.href = url;
  link.download = `mishitza-backup-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function render() {
  app.innerHTML = "";

  if (state.currentWorkoutId) {
    renderWorkoutScreen(state.currentWorkoutId);
    return;
  }

  renderHomeScreen();
}

function renderHomeScreen() {
  const fragment = homeTemplate.content.cloneNode(true);
  const formCard = fragment.getElementById("workout-form-card");
  const showFormButton = fragment.getElementById("show-workout-form");
  const saveWorkoutButton = fragment.getElementById("save-workout");
  const workoutTitleInput = fragment.getElementById("workout-title-input");
  const workoutList = fragment.getElementById("workout-list");
  const exportButton = fragment.getElementById("export-data");
  const importButton = fragment.getElementById("import-data");
  const importFileInput = fragment.getElementById("import-file-input");

  showFormButton.addEventListener("click", () => {
    document.addEventListener("click", handleOutsideWorkoutForm);
    formCard.classList.remove("hidden");
    workoutTitleInput.focus();
    scrollIntoViewAfterKeyboard(formCard);
  });

  const submitWorkout = () => {
    const title = workoutTitleInput.value.trim();

    if (!title) {
      workoutTitleInput.focus();
      return;
    }

    state.workouts.push({
      id: crypto.randomUUID(),
      title,
      exercises: [],
    });

    document.removeEventListener("click", handleOutsideWorkoutForm);
    saveState();
    render();
  };

  saveWorkoutButton.addEventListener("click", submitWorkout);
  workoutTitleInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submitWorkout();
  });
  workoutTitleInput.addEventListener("focus", () => {
    scrollIntoViewAfterKeyboard(formCard);
  });
  workoutTitleInput.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  saveWorkoutButton.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  exportButton.addEventListener("click", exportStateToJson);
  importButton.addEventListener("click", () => {
    importFileInput.click();
  });
  importFileInput.addEventListener("change", async () => {
    const [file] = importFileInput.files || [];

    if (!file) {
      return;
    }

    try {
      const imported = normalizeState(JSON.parse(await file.text()));
      replaceState(imported);
      saveState();
      render();
    } catch {
      showConfirmDialog({
        title: "Import failed",
        message: "Please choose a valid Mishitza JSON backup.",
        confirmLabel: "OK",
        onConfirm: () => {},
      });
    } finally {
      importFileInput.value = "";
    }
  });

  if (state.workouts.length === 0) {
    workoutList.innerHTML = '<div class="empty-state">No workouts yet. Add one to get started.</div>';
  } else {
    state.workouts.forEach((workout) => {
      const item = document.createElement("div");
      item.className = "workout-item";
      item.dataset.workoutId = workout.id;
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");

      const meta = document.createElement("div");
      meta.className = "workout-meta";

      const name = document.createElement("span");
      name.className = "workout-name";
      name.textContent = workout.title;

      const count = document.createElement("span");
      count.className = "workout-count";
      count.textContent = `${workout.exercises.length} exercise${workout.exercises.length === 1 ? "" : "s"}`;

      meta.append(name, count);

      item.appendChild(meta);

      const grip = document.createElement("span");
      grip.className = "drag-grip";
      grip.setAttribute("aria-label", "Reorder workout");
      grip.innerHTML = `
        <span class="drag-grip-dots" aria-hidden="true">
          <span></span><span></span>
          <span></span><span></span>
          <span></span><span></span>
        </span>
      `;
      item.appendChild(grip);

      if (state.lastCompletedWorkoutId === workout.id) {
        const badgeWrap = document.createElement("div");
        badgeWrap.className = "badge-stack";

        const badge = document.createElement("span");
        badge.className = "badge badge-complete";
        badge.textContent = "Latest";

        const date = document.createElement("span");
        date.className = "completion-date";
        date.textContent = formatCompletionDate(workout.lastCompletedAt);

        badgeWrap.append(badge, date);
        item.insertBefore(badgeWrap, grip);
      }

      item.addEventListener("click", () => {
        if (item.querySelector(".inline-item-editor")) {
          return;
        }

        openWorkout(workout.id);
      });

      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        if (item.querySelector(".inline-item-editor")) {
          return;
        }

        event.preventDefault();
        openWorkout(workout.id);
      });

      attachHoldGesture(grip, {
        dragElement: item,
        container: workoutList,
        itemSelector: ".workout-item",
        onHold: () => {
          renderWorkoutRowEditor({
            item,
            workout,
          });
        },
        onReorder: (orderedIds) => {
          state.workouts = reorderCollectionByIds(state.workouts, orderedIds);
          saveState();
          render();
        },
      });

      workoutList.appendChild(item);
    });
  }

  app.appendChild(fragment);

  function handleOutsideWorkoutForm(event) {
    if (formCard.classList.contains("hidden")) {
      document.removeEventListener("click", handleOutsideWorkoutForm);
      return;
    }

    if (formCard.contains(event.target) || showFormButton.contains(event.target)) {
      return;
    }

    formCard.classList.add("hidden");
    workoutTitleInput.value = "";
    document.removeEventListener("click", handleOutsideWorkoutForm);
  }
}

function renderWorkoutScreen(workoutId) {
  const workout = state.workouts.find((entry) => entry.id === workoutId);

  if (!workout) {
    state.currentWorkoutId = null;
    saveState();
    render();
    return;
  }

  const fragment = workoutTemplate.content.cloneNode(true);
  const title = fragment.getElementById("workout-screen-title");
  const editTitleButton = fragment.getElementById("edit-workout-title");
  const titleEditInput = fragment.getElementById("workout-title-edit-input");
  const backButton = fragment.getElementById("back-home");
  const exerciseList = fragment.getElementById("exercise-list");
  const showExerciseFormButton = fragment.getElementById("show-exercise-form");
  const exerciseForm = fragment.getElementById("exercise-form");
  const exerciseNameInput = fragment.getElementById("exercise-name-input");
  const exerciseMaxInput = fragment.getElementById("exercise-max-input");
  const confirmAddExerciseButton = fragment.getElementById("confirm-add-exercise");
  const completeMessage = fragment.getElementById("workout-complete-message");
  const progressBar = fragment.getElementById("workout-progress-bar");
  const stopwatchTime = fragment.getElementById("workout-stopwatch");
  const toggleStopwatchButton = fragment.getElementById("toggle-stopwatch");
  const resetStopwatchButton = fragment.getElementById("reset-stopwatch");

  title.textContent = workout.title;
  titleEditInput.value = workout.title;
  progressBar.style.width = `${getWorkoutProgress(workout)}%`;
  bindStopwatch(workout.id, stopwatchTime, toggleStopwatchButton, resetStopwatchButton);

  let isEditingTitle = false;

  const saveWorkoutTitle = () => {
    if (!isEditingTitle) {
      return;
    }

    const nextTitle = titleEditInput.value.trim();

    if (nextTitle.length >= 3) {
      workout.title = nextTitle;
      title.textContent = nextTitle;
      saveState();
    } else {
      titleEditInput.value = workout.title;
    }

    isEditingTitle = false;
    title.classList.remove("hidden");
    editTitleButton.classList.remove("hidden");
    titleEditInput.classList.add("hidden");
  };

  editTitleButton.addEventListener("click", (event) => {
    event.stopPropagation();
    isEditingTitle = true;
    title.classList.add("hidden");
    editTitleButton.classList.add("hidden");
    titleEditInput.classList.remove("hidden");
    titleEditInput.value = workout.title;
    titleEditInput.focus();
    titleEditInput.select();

    window.setTimeout(() => {
      document.addEventListener("click", handleOutsideTitleSave);
    }, 0);
  });

  titleEditInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveWorkoutTitle();
      document.removeEventListener("click", handleOutsideTitleSave);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      titleEditInput.value = workout.title;
      saveWorkoutTitle();
      document.removeEventListener("click", handleOutsideTitleSave);
    }
  });

  titleEditInput.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  backButton.addEventListener("click", () => {
    document.removeEventListener("click", handleOutsideTitleSave);

    if (isWorkoutComplete(workout)) {
      resetAllWorkoutProgress();
    }

    goHome();
  });

  showExerciseFormButton.addEventListener("click", () => {
    document.addEventListener("click", handleOutsideExerciseForm);
    exerciseForm.classList.remove("hidden");
    exerciseNameInput.focus();
    scrollIntoViewAfterKeyboard(exerciseForm);
  });

  const submitExercise = () => {
    const name = exerciseNameInput.value.trim();
    const max = exerciseMaxInput.value.trim();

    if (!name) {
      exerciseNameInput.focus();
      return;
    }

    if (!max) {
      exerciseMaxInput.focus();
      return;
    }

    workout.exercises.push({
      id: crypto.randomUUID(),
      name,
      max,
      checked: false,
    });

    exerciseNameInput.value = "";
    exerciseMaxInput.value = "";
    exerciseForm.classList.add("hidden");
    document.removeEventListener("click", handleOutsideExerciseForm);
    saveState();
    render();
  };

  confirmAddExerciseButton.addEventListener("click", submitExercise);
  exerciseNameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    exerciseMaxInput.focus();
  });
  exerciseMaxInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submitExercise();
  });
  exerciseNameInput.addEventListener("focus", () => {
    scrollIntoViewAfterKeyboard(exerciseForm);
  });
  exerciseMaxInput.addEventListener("focus", () => {
    scrollIntoViewAfterKeyboard(exerciseForm);
  });
  exerciseNameInput.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  exerciseMaxInput.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  confirmAddExerciseButton.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  if (workout.exercises.length > 0) {
    workout.exercises.forEach((exercise) => {
      const item = document.createElement("div");
      item.className = `exercise-item${exercise.checked ? " checked" : ""}`;
      item.dataset.exerciseId = exercise.id;
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");

      const label = document.createElement("div");
      label.className = "exercise-label";

      const name = document.createElement("span");
      name.className = "exercise-name";
      name.textContent = exercise.name;

      const max = document.createElement("span");
      max.className = "exercise-max";
      max.textContent = exercise.max || "";

      label.append(name, max);

      const checkmark = document.createElement("span");
      checkmark.className = "checkmark";
      checkmark.textContent = exercise.checked ? "✓" : "";

      const grip = document.createElement("span");
      grip.className = "drag-grip";
      grip.setAttribute("aria-label", "Reorder exercise");
      grip.innerHTML = `
        <span class="drag-grip-dots" aria-hidden="true">
          <span></span><span></span>
          <span></span><span></span>
          <span></span><span></span>
        </span>
      `;

      const externalLinkButton = document.createElement("button");
      externalLinkButton.type = "button";
      externalLinkButton.className = "exercise-link-button";
      externalLinkButton.setAttribute("aria-label", `Search ${exercise.name} on YouTube`);
      externalLinkButton.innerHTML = `
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3Zm5 16H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7Z"/>
        </svg>
      `;

      item.append(checkmark, label, externalLinkButton, grip);

      externalLinkButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const query = encodeURIComponent(exercise.name.trim());
        const url = `https://www.youtube.com/results?search_query=${query}`;
        window.open(url, "_blank", "noopener,noreferrer");
      });

      item.addEventListener("click", () => {
        if (item.querySelector(".inline-item-editor")) {
          return;
        }

        exercise.checked = !exercise.checked;
        updateCompletionState(workout);
        saveState();
        syncExerciseItem(item, exercise, checkmark, name);
        syncWorkoutProgress(progressBar, completeMessage, workout);
      });

      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        if (item.querySelector(".inline-item-editor")) {
          return;
        }

        event.preventDefault();
        exercise.checked = !exercise.checked;
        updateCompletionState(workout);
        saveState();
        syncExerciseItem(item, exercise, checkmark, name);
        syncWorkoutProgress(progressBar, completeMessage, workout);
      });

      attachHoldGesture(grip, {
        dragElement: item,
        container: exerciseList,
        itemSelector: ".exercise-item",
        onHold: () => {
          renderExerciseEditor({
            item,
            exercise,
            workout,
            progressBar,
            completeMessage,
          });
        },
        onReorder: (orderedIds) => {
          workout.exercises = reorderCollectionByIds(workout.exercises, orderedIds);
          saveState();
          render();
        },
      });

      exerciseList.appendChild(item);
    });
  }

  if (isWorkoutComplete(workout)) {
    completeMessage.classList.remove("hidden");
  }

  app.appendChild(fragment);

  function handleOutsideTitleSave(event) {
    if (!isEditingTitle) {
      document.removeEventListener("click", handleOutsideTitleSave);
      return;
    }

    if (titleEditInput.contains(event.target) || editTitleButton.contains(event.target)) {
      return;
    }

    saveWorkoutTitle();
    document.removeEventListener("click", handleOutsideTitleSave);
  }

  function handleOutsideExerciseForm(event) {
    if (exerciseForm.classList.contains("hidden")) {
      document.removeEventListener("click", handleOutsideExerciseForm);
      return;
    }

    if (exerciseForm.contains(event.target) || showExerciseFormButton.contains(event.target)) {
      return;
    }

    exerciseForm.classList.add("hidden");
    exerciseNameInput.value = "";
    exerciseMaxInput.value = "";
    document.removeEventListener("click", handleOutsideExerciseForm);
  }
}

function syncExerciseItem(item, exercise, checkmark, name) {
  item.classList.toggle("checked", exercise.checked);
  checkmark.textContent = exercise.checked ? "✓" : "";
  name.setAttribute("aria-checked", exercise.checked ? "true" : "false");
}

function syncWorkoutProgress(progressBar, completeMessage, workout) {
  const completed = isWorkoutComplete(workout);

  // Delay the width update by a frame so the browser animates the fill
  // instead of jumping straight to the next value after a DOM rewrite.
  requestAnimationFrame(() => {
    progressBar.style.width = `${getWorkoutProgress(workout)}%`;
  });

  if (completed) {
    showWorkoutCompleteMessage(completeMessage);
    return;
  }

  hideWorkoutCompleteMessage(completeMessage);
}

function showWorkoutCompleteMessage(completeMessage) {
  if (completeMessageTimeoutId) {
    window.clearTimeout(completeMessageTimeoutId);
  }

  completeMessage.classList.remove("hidden");
  completeMessage.classList.remove("complete-message-visible");
  void completeMessage.offsetWidth;
  completeMessage.classList.add("complete-message-visible");

  completeMessageTimeoutId = window.setTimeout(() => {
    hideWorkoutCompleteMessage(completeMessage);
  }, 2000);
}

function hideWorkoutCompleteMessage(completeMessage) {
  if (completeMessageTimeoutId) {
    window.clearTimeout(completeMessageTimeoutId);
    completeMessageTimeoutId = null;
  }

  completeMessage.classList.remove("complete-message-visible");
  completeMessage.classList.add("hidden");
}

function getStopwatchEntry(workoutId) {
  if (!stopwatchStore[workoutId]) {
    stopwatchStore[workoutId] = {
      elapsedMs: 0,
      running: false,
      startedAt: null,
    };
  }

  return stopwatchStore[workoutId];
}

function bindStopwatch(workoutId, timeEl, toggleButton, resetButton) {
  const stopwatch = getStopwatchEntry(workoutId);

  if (activeStopwatchIntervalId) {
    window.clearInterval(activeStopwatchIntervalId);
    activeStopwatchIntervalId = null;
  }

  const renderStopwatch = () => {
    const elapsedMs = stopwatch.running && stopwatch.startedAt
      ? Date.now() - stopwatch.startedAt
      : stopwatch.elapsedMs;

    timeEl.textContent = formatStopwatchTime(elapsedMs);
    toggleButton.textContent = stopwatch.running ? "Stop" : "Start";
  };

  toggleButton.addEventListener("click", () => {
    if (stopwatch.running) {
      stopwatch.elapsedMs = Date.now() - stopwatch.startedAt;
      stopwatch.running = false;
      stopwatch.startedAt = null;

      if (activeStopwatchIntervalId) {
        window.clearInterval(activeStopwatchIntervalId);
        activeStopwatchIntervalId = null;
      }

      renderStopwatch();
      return;
    }

    stopwatch.running = true;
    stopwatch.startedAt = Date.now() - stopwatch.elapsedMs;
    renderStopwatch();
    activeStopwatchIntervalId = window.setInterval(renderStopwatch, 250);
  });

  resetButton.addEventListener("click", () => {
    stopwatch.elapsedMs = 0;

    if (stopwatch.running) {
      stopwatch.startedAt = Date.now();
    }

    renderStopwatch();
  });

  renderStopwatch();

  if (stopwatch.running) {
    activeStopwatchIntervalId = window.setInterval(renderStopwatch, 250);
  }
}

function formatStopwatchTime(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderExerciseEditor({ item, exercise, workout, progressBar, completeMessage }) {
  item.innerHTML = "";
  item.classList.remove("checked");
  item.removeAttribute("role");
  item.removeAttribute("tabindex");

  const editor = document.createElement("div");
  editor.className = "card workout-form exercise-form inline-item-editor";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 80;
  nameInput.placeholder = "Exercise name";
  nameInput.value = exercise.name;

  const maxInput = document.createElement("input");
  maxInput.type = "text";
  maxInput.maxLength = 30;
  maxInput.placeholder = "Max (kg, time)";
  maxInput.value = exercise.max || "";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary-button";
  saveButton.textContent = "Save";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger-button";
  deleteButton.textContent = "Delete";

  const save = () => {
    const nextName = nameInput.value.trim();
    const nextMax = maxInput.value.trim();

    if (!nextName) {
      nameInput.focus();
      return;
    }

    if (!nextMax) {
      maxInput.focus();
      return;
    }

    exercise.name = nextName;
    exercise.max = nextMax;
    saveState();
    render();
    syncWorkoutProgress(progressBar, completeMessage, workout);
  };

  nameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    maxInput.focus();
  });

  maxInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    save();
  });

  saveButton.addEventListener("click", (event) => {
    event.stopPropagation();
    save();
  });

  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    showConfirmDialog({
      title: "Delete the exercise?",
      message: `This will remove "${exercise.name}".`,
      confirmLabel: "Yes",
      onConfirm: () => {
        workout.exercises = workout.exercises.filter((entry) => entry.id !== exercise.id);
        updateCompletionState(workout);
        saveState();
        render();
      },
    });
  });

  editor.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  editor.append(nameInput, maxInput, saveButton, deleteButton);
  item.appendChild(editor);
  nameInput.focus();
  nameInput.select();

  window.setTimeout(() => {
    document.addEventListener("click", handleOutsideExerciseEditor);
  }, 0);

  function handleOutsideExerciseEditor(event) {
    if (editor.contains(event.target)) {
      return;
    }

    document.removeEventListener("click", handleOutsideExerciseEditor);
    render();
    syncWorkoutProgress(progressBar, completeMessage, workout);
  }
}

function renderWorkoutRowEditor({ item, workout }) {
  item.innerHTML = "";
  item.removeAttribute("role");
  item.removeAttribute("tabindex");

  const editor = document.createElement("div");
  editor.className = "card workout-form exercise-form inline-item-editor";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.maxLength = 60;
  titleInput.placeholder = "Push day";
  titleInput.value = workout.title;

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary-button";
  saveButton.textContent = "Save";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger-button";
  deleteButton.textContent = "Delete";

  const save = () => {
    const nextTitle = titleInput.value.trim();

    if (nextTitle.length < 3) {
      titleInput.focus();
      return;
    }

    workout.title = nextTitle;
    saveState();
    render();
  };

  titleInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    save();
  });

  saveButton.addEventListener("click", (event) => {
    event.stopPropagation();
    save();
  });

  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    showConfirmDialog({
      title: "Delete a workout?",
      message: `This will remove "${workout.title}".`,
      confirmLabel: "Yes",
      onConfirm: () => {
        state.workouts = state.workouts.filter((entry) => entry.id !== workout.id);

        if (state.lastCompletedWorkoutId === workout.id) {
          state.lastCompletedWorkoutId = null;
        }

        saveState();
        render();
      },
    });
  });

  editor.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  editor.append(titleInput, saveButton, deleteButton);
  item.appendChild(editor);
  titleInput.focus();
  titleInput.select();

  window.setTimeout(() => {
    document.addEventListener("click", handleOutsideWorkoutEditor);
  }, 0);

  function handleOutsideWorkoutEditor(event) {
    if (editor.contains(event.target)) {
      return;
    }

    document.removeEventListener("click", handleOutsideWorkoutEditor);
    render();
  }
}
function isWorkoutComplete(workout) {
  return workout.exercises.length > 0 && workout.exercises.every((exercise) => exercise.checked);
}

function getWorkoutProgress(workout) {
  if (workout.exercises.length === 0) {
    return 0;
  }

  const checkedCount = workout.exercises.filter((exercise) => exercise.checked).length;
  return (checkedCount / workout.exercises.length) * 100;
}

function updateCompletionState(workout) {
  if (isWorkoutComplete(workout)) {
    state.lastCompletedWorkoutId = workout.id;
    workout.lastCompletedAt = new Date().toISOString();
  }
}

function formatCompletionDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const day = String(date.getDate());
  const month = String(date.getMonth() + 1);
  const year = String(date.getFullYear());
  return `${day}.${month}.${year}`;
}

function resetAllWorkoutProgress() {
  state.workouts.forEach((workout) => {
    workout.exercises.forEach((exercise) => {
      exercise.checked = false;
    });
  });
}

function attachHoldGesture(handle, { dragElement, container, itemSelector, onHold, onReorder }) {
  let dragTimeoutId = null;
  let editTimeoutId = null;
  let suppressClick = false;
  let holdReady = false;
  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let pointerOffsetY = 0;
  let pointerOffsetX = 0;
  let placeholder = null;
  let dragRect = null;

  const clearTimers = () => {
    if (dragTimeoutId) {
      window.clearTimeout(dragTimeoutId);
      dragTimeoutId = null;
    }

    if (editTimeoutId) {
      window.clearTimeout(editTimeoutId);
      editTimeoutId = null;
    }
  };

  const cleanupPointerListeners = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
  };

  const resetVisualState = () => {
    dragElement.classList.remove("hold-ready");

    if (!dragging) {
      return;
    }

    dragging = false;
    dragElement.classList.remove("dragging");
    dragElement.style.width = "";
    dragElement.style.left = "";
    dragElement.style.top = "";
    dragElement.style.position = "";
    dragElement.style.zIndex = "";
    dragElement.style.pointerEvents = "";
  };

  const startDrag = (event) => {
    dragging = true;
    suppressClick = true;
    dragRect = dragElement.getBoundingClientRect();
    pointerOffsetY = event.clientY - dragRect.top;
    pointerOffsetX = event.clientX - dragRect.left;

    placeholder = document.createElement("div");
    placeholder.className = "drag-placeholder";
    placeholder.style.height = `${dragRect.height}px`;

    container.insertBefore(placeholder, dragElement);

    dragElement.classList.add("dragging");
    dragElement.style.width = `${dragRect.width}px`;
    dragElement.style.left = `${dragRect.left}px`;
    dragElement.style.top = `${dragRect.top}px`;
    dragElement.style.position = "fixed";
    dragElement.style.zIndex = "50";
    dragElement.style.pointerEvents = "none";

    document.body.appendChild(dragElement);
    updateDragPosition(event);
  };

  const updateDragPosition = (event) => {
    if (!dragging) {
      return;
    }

    dragElement.style.left = `${event.clientX - pointerOffsetX}px`;
    dragElement.style.top = `${event.clientY - pointerOffsetY}px`;

    const siblings = [...container.querySelectorAll(itemSelector)].filter((item) => item !== dragElement);
    let inserted = false;

    for (const sibling of siblings) {
      const rect = sibling.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      if (event.clientY < midpoint) {
        container.insertBefore(placeholder, sibling);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      container.appendChild(placeholder);
    }
  };

  const finishDrag = () => {
    if (!dragging) {
      return;
    }

    container.insertBefore(dragElement, placeholder);
    placeholder.remove();
    placeholder = null;
    resetVisualState();

    const orderedIds = [...container.querySelectorAll(itemSelector)].map((item) => item.dataset.workoutId ?? item.dataset.exerciseId);
    onReorder(orderedIds);
  };

  const onPointerMove = (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    const movedDistance = Math.hypot(event.clientX - startX, event.clientY - startY);

    if (!holdReady) {
      if (movedDistance > DRAG_START_DISTANCE_PX) {
        clearTimers();
        cleanupPointerListeners();
      }
      return;
    }

    if (!dragging && movedDistance > DRAG_START_DISTANCE_PX) {
      startDrag(event);
      return;
    }

    updateDragPosition(event);
  };

  const onPointerUp = (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    clearTimers();
    cleanupPointerListeners();

    if (dragging) {
      finishDrag();
      dragElement.blur();
    } else if (holdReady) {
      suppressClick = true;
      onHold();
    }

    holdReady = false;
    pointerId = null;
    resetVisualState();
  };

  const onPointerCancel = (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    clearTimers();
    cleanupPointerListeners();

    if (dragging && placeholder) {
      container.insertBefore(dragElement, placeholder);
      placeholder.remove();
      placeholder = null;
    }

    holdReady = false;
    pointerId = null;
    resetVisualState();
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    holdReady = false;
    dragging = false;
    suppressClick = false;

    dragTimeoutId = window.setTimeout(() => {
      holdReady = true;
      dragElement.classList.add("hold-ready");
    }, DRAG_HOLD_DURATION_MS);

    editTimeoutId = window.setTimeout(() => {
      if (dragging || pointerId !== event.pointerId) {
        return;
      }

      suppressClick = true;
      holdReady = false;
      pointerId = null;
      cleanupPointerListeners();
      resetVisualState();
      onHold();
    }, EDIT_HOLD_DURATION_MS);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  });

  handle.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = false;
    },
    true
  );
}

function reorderCollectionByIds(collection, orderedIds) {
  const byId = new Map(collection.map((entry) => [entry.id, entry]));
  return orderedIds.map((id) => byId.get(id)).filter(Boolean);
}

function scrollIntoViewAfterKeyboard(element) {
  window.setTimeout(() => {
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, 250);
}

function showConfirmDialog({ title, message, confirmLabel, onConfirm }) {
  dialogRoot.innerHTML = "";

  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "dialog";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const body = document.createElement("p");
  body.textContent = message;

  const actions = document.createElement("div");
  actions.className = "dialog-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "ghost-button";
  cancelButton.textContent = "Cancel";

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "primary-button";
  confirmButton.textContent = confirmLabel;

  cancelButton.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      close();
    }
  });

  confirmButton.addEventListener("click", () => {
    onConfirm();
    close();
  });

  actions.append(cancelButton, confirmButton);
  dialog.append(heading, body, actions);
  backdrop.appendChild(dialog);
  dialogRoot.appendChild(backdrop);

  function close() {
    dialogRoot.innerHTML = "";
  }
}
