const STORAGE_KEY = "mishitza-state";
const DRAG_HOLD_DURATION_MS = 100;
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
    scrollIntoViewAfterKeyboard(formCard);
  });

  cancelFormButton.addEventListener("click", () => {
    formCard.classList.add("hidden");
    workoutTitleInput.value = "";
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
        state.currentWorkoutId = workout.id;
        saveState();
        render();
      });

      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        state.currentWorkoutId = workout.id;
        saveState();
        render();
      });

      attachHoldGesture(grip, {
        dragElement: item,
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
  const editTitleButton = fragment.getElementById("edit-workout-title");
  const titleEditInput = fragment.getElementById("workout-title-edit-input");
  const backButton = fragment.getElementById("back-home");
  const exerciseList = fragment.getElementById("exercise-list");
  const showExerciseFormButton = fragment.getElementById("show-exercise-form");
  const exerciseForm = fragment.getElementById("exercise-form");
  const exerciseInput = fragment.getElementById("exercise-input");
  const confirmAddExerciseButton = fragment.getElementById("confirm-add-exercise");
  const completeMessage = fragment.getElementById("workout-complete-message");
  const progressBar = fragment.getElementById("workout-progress-bar");

  title.textContent = workout.title;
  titleEditInput.value = workout.title;
  progressBar.style.width = `${getWorkoutProgress(workout)}%`;

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
    state.currentWorkoutId = null;
    saveState();
    render();
  });

  showExerciseFormButton.addEventListener("click", () => {
    exerciseForm.classList.remove("hidden");
    exerciseInput.focus();
    scrollIntoViewAfterKeyboard(exerciseForm);
  });

  const submitExercise = () => {
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
  };

  confirmAddExerciseButton.addEventListener("click", submitExercise);
  exerciseInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submitExercise();
  });
  exerciseInput.addEventListener("focus", () => {
    scrollIntoViewAfterKeyboard(exerciseForm);
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

      label.appendChild(name);

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

      item.append(checkmark, label, grip);

      item.addEventListener("click", () => {
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

function attachHoldGesture(handle, { dragElement, container, itemSelector, onHold, onReorder }) {
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
