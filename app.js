const STORAGE_KEY = "mishitza-state";
const DRAG_HOLD_DURATION_MS = 500;
const DELETE_HOLD_DURATION_MS = 1500;
const DRAG_START_DISTANCE_PX = 10;

const app = document.getElementById("app");
const dialogRoot = document.getElementById("dialog-root");
const homeTemplate = document.getElementById("home-screen-template");
const workoutTemplate = document.getElementById("workout-screen-template");

const state = loadState();
let activeWorkoutViewId = null;

registerServiceWorker();
render();

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return {
      workouts: [],
      currentWorkoutId: null,
      lastCompletedWorkoutId: null,
    };
  }

  try {
    const parsed = JSON.parse(saved);
    return {
      workouts: Array.isArray(parsed.workouts)
        ? parsed.workouts.map((workout) => ({
            ...workout,
            lastCompletedAt: workout.lastCompletedAt ?? null,
          }))
        : [],
      currentWorkoutId: parsed.currentWorkoutId ?? null,
      lastCompletedWorkoutId: parsed.lastCompletedWorkoutId ?? null,
    };
  } catch {
    return {
      workouts: [],
      currentWorkoutId: null,
      lastCompletedWorkoutId: null,
    };
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

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  app.innerHTML = "";

  if (state.currentWorkoutId) {
    if (activeWorkoutViewId !== state.currentWorkoutId) {
      resetWorkoutProgress(state.currentWorkoutId);
      activeWorkoutViewId = state.currentWorkoutId;
    }

    renderWorkoutScreen(state.currentWorkoutId);
    return;
  }

  activeWorkoutViewId = null;
  renderHomeScreen();
}

function renderHomeScreen() {
  const fragment = homeTemplate.content.cloneNode(true);
  const formCard = fragment.getElementById("workout-form-card");
  const showFormButton = fragment.getElementById("show-workout-form");
  const cancelFormButton = fragment.getElementById("cancel-workout-form");
  const saveWorkoutButton = fragment.getElementById("save-workout");
  const workoutTitleInput = fragment.getElementById("workout-title-input");
  const workoutList = fragment.getElementById("workout-list");

  showFormButton.addEventListener("click", () => {
    formCard.classList.remove("hidden");
    workoutTitleInput.focus();
  });

  cancelFormButton.addEventListener("click", () => {
    formCard.classList.add("hidden");
    workoutTitleInput.value = "";
  });

  saveWorkoutButton.addEventListener("click", () => {
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

    saveState();
    render();
  });

  if (state.workouts.length === 0) {
    workoutList.innerHTML = '<div class="empty-state">No workouts yet. Add one to get started.</div>';
  } else {
    state.workouts.forEach((workout) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "workout-item";
      item.dataset.workoutId = workout.id;

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

      if (state.lastCompletedWorkoutId === workout.id) {
        const badgeWrap = document.createElement("div");
        badgeWrap.className = "badge-stack";

        const badge = document.createElement("span");
        badge.className = "badge badge-complete";
        badge.textContent = "Last completed";

        const date = document.createElement("span");
        date.className = "completion-date";
        date.textContent = formatCompletionDate(workout.lastCompletedAt);

        badgeWrap.append(badge, date);
        item.appendChild(badgeWrap);
      }

      item.addEventListener("click", () => {
        state.currentWorkoutId = workout.id;
        saveState();
        render();
      });

      attachHoldGesture(item, {
        container: workoutList,
        itemSelector: ".workout-item",
        onHold: () => {
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
  const backButton = fragment.getElementById("back-home");
  const exerciseList = fragment.getElementById("exercise-list");
  const showExerciseFormButton = fragment.getElementById("show-exercise-form");
  const exerciseForm = fragment.getElementById("exercise-form");
  const exerciseInput = fragment.getElementById("exercise-input");
  const confirmAddExerciseButton = fragment.getElementById("confirm-add-exercise");
  const completeMessage = fragment.getElementById("workout-complete-message");
  const progressBar = fragment.getElementById("workout-progress-bar");

  title.textContent = workout.title;
  progressBar.style.width = `${getWorkoutProgress(workout)}%`;

  backButton.addEventListener("click", () => {
    state.currentWorkoutId = null;
    saveState();
    render();
  });

  showExerciseFormButton.addEventListener("click", () => {
    exerciseForm.classList.remove("hidden");
    exerciseInput.focus();
  });

  confirmAddExerciseButton.addEventListener("click", () => {
    const name = exerciseInput.value.trim();

    if (!name) {
      exerciseInput.focus();
      return;
    }

    workout.exercises.push({
      id: crypto.randomUUID(),
      name,
      checked: false,
    });

    exerciseInput.value = "";
    exerciseForm.classList.add("hidden");
    saveState();
    render();
  });

  if (workout.exercises.length > 0) {
    workout.exercises.forEach((exercise) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `exercise-item${exercise.checked ? " checked" : ""}`;
      item.dataset.exerciseId = exercise.id;

      const label = document.createElement("div");
      label.className = "exercise-label";

      const name = document.createElement("span");
      name.className = "exercise-name";
      name.textContent = exercise.name;

      label.appendChild(name);

      const checkmark = document.createElement("span");
      checkmark.className = "checkmark";
      checkmark.textContent = exercise.checked ? "✓" : "";

      item.append(label, checkmark);

      item.addEventListener("click", () => {
        exercise.checked = !exercise.checked;
        updateCompletionState(workout);
        saveState();
        syncExerciseItem(item, exercise, checkmark, name);
        syncWorkoutProgress(progressBar, completeMessage, workout);
      });

      attachHoldGesture(item, {
        container: exerciseList,
        itemSelector: ".exercise-item",
        onHold: () => {
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
}

function syncExerciseItem(item, exercise, checkmark, name) {
  item.classList.toggle("checked", exercise.checked);
  checkmark.textContent = exercise.checked ? "✓" : "";
  name.setAttribute("aria-checked", exercise.checked ? "true" : "false");
}

function syncWorkoutProgress(progressBar, completeMessage, workout) {
  // Delay the width update by a frame so the browser animates the fill
  // instead of jumping straight to the next value after a DOM rewrite.
  requestAnimationFrame(() => {
    progressBar.style.width = `${getWorkoutProgress(workout)}%`;
  });

  completeMessage.classList.toggle("hidden", !isWorkoutComplete(workout));
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

function resetWorkoutProgress(workoutId) {
  const workout = state.workouts.find((entry) => entry.id === workoutId);

  if (!workout) {
    return;
  }

  workout.exercises.forEach((exercise) => {
    exercise.checked = false;
  });

  saveState();
}

function attachHoldGesture(element, { container, itemSelector, onHold, onReorder }) {
  let dragTimeoutId = null;
  let deleteTimeoutId = null;
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

    if (deleteTimeoutId) {
      window.clearTimeout(deleteTimeoutId);
      deleteTimeoutId = null;
    }
  };

  const cleanupPointerListeners = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
  };

  const resetVisualState = () => {
    element.classList.remove("hold-ready");

    if (!dragging) {
      return;
    }

    dragging = false;
    element.classList.remove("dragging");
    element.style.width = "";
    element.style.left = "";
    element.style.top = "";
    element.style.position = "";
    element.style.zIndex = "";
    element.style.pointerEvents = "";
  };

  const startDrag = (event) => {
    dragging = true;
    suppressClick = true;
    dragRect = element.getBoundingClientRect();
    pointerOffsetY = event.clientY - dragRect.top;
    pointerOffsetX = event.clientX - dragRect.left;

    placeholder = document.createElement("div");
    placeholder.className = "drag-placeholder";
    placeholder.style.height = `${dragRect.height}px`;

    container.insertBefore(placeholder, element);

    element.classList.add("dragging");
    element.style.width = `${dragRect.width}px`;
    element.style.left = `${dragRect.left}px`;
    element.style.top = `${dragRect.top}px`;
    element.style.position = "fixed";
    element.style.zIndex = "50";
    element.style.pointerEvents = "none";

    document.body.appendChild(element);
    updateDragPosition(event);
  };

  const updateDragPosition = (event) => {
    if (!dragging) {
      return;
    }

    element.style.left = `${event.clientX - pointerOffsetX}px`;
    element.style.top = `${event.clientY - pointerOffsetY}px`;

    const siblings = [...container.querySelectorAll(itemSelector)].filter((item) => item !== element);
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

    container.insertBefore(element, placeholder);
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
      element.blur();
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
      container.insertBefore(element, placeholder);
      placeholder.remove();
      placeholder = null;
    }

    holdReady = false;
    pointerId = null;
    resetVisualState();
  };

  element.addEventListener("pointerdown", (event) => {
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
      element.classList.add("hold-ready");
    }, DRAG_HOLD_DURATION_MS);

    deleteTimeoutId = window.setTimeout(() => {
      if (dragging || pointerId !== event.pointerId) {
        return;
      }

      suppressClick = true;
      holdReady = false;
      pointerId = null;
      cleanupPointerListeners();
      resetVisualState();
      onHold();
    }, DELETE_HOLD_DURATION_MS);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  });

  element.addEventListener(
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
