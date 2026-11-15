export function bindRegistrationRoles(form) {
  const primaryInputs = [...form.querySelectorAll('input[name="primaryRole"]')];
  const secondaryInputs = [...form.querySelectorAll('input[name="secondaryRoles"]')];
  const counter = form.querySelector("#secondary-role-counter");
  const resetButton = form.querySelector("#secondary-role-reset");
  if (!primaryInputs.length || !secondaryInputs.length || !counter || !resetButton) return;

  function update() {
    const primaryRole = primaryInputs.find(input => input.checked)?.value || "";
    for (const input of secondaryInputs) {
      if (input.value === primaryRole) input.checked = false;
    }
    const selectedCount = secondaryInputs.filter(input => input.checked).length;
    for (const input of secondaryInputs) {
      input.disabled = (Boolean(primaryRole) && input.value === primaryRole)
        || (selectedCount >= 2 && !input.checked);
    }
    counter.textContent = `${selectedCount}/2`;
    resetButton.disabled = selectedCount === 0;
  }

  for (const input of primaryInputs) {
    input.addEventListener("change", () => update());
  }

  for (const input of secondaryInputs) {
    input.addEventListener("change", () => {
      update();
    });
  }

  resetButton.addEventListener("click", () => {
    for (const input of secondaryInputs) input.checked = false;
    update();
  });

  form.addEventListener("reset", () => setTimeout(() => update(), 0));
  update();
}

