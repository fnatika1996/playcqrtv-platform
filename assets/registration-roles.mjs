export function bindRegistrationRoles(form) {
  const primaryInputs = [...form.querySelectorAll('input[name="primaryRole"]')];
  const secondaryInputs = [...form.querySelectorAll('input[name="secondaryRoles"]')];
  const status = form.querySelector("#secondary-role-status");
  if (!primaryInputs.length || !secondaryInputs.length || !status) return;

  function update(message = "") {
    const primaryRole = primaryInputs.find(input => input.checked)?.value || "";
    for (const input of secondaryInputs) {
      if (input.value === primaryRole) input.checked = false;
      input.disabled = Boolean(primaryRole) && input.value === primaryRole;
    }
    const selectedCount = secondaryInputs.filter(input => input.checked).length;
    status.textContent = message || (selectedCount
      ? `Выбрано ${selectedCount} из 2 дополнительных ролей.`
      : "Можно выбрать до двух дополнительных ролей.");
  }

  for (const input of primaryInputs) {
    input.addEventListener("change", () => update());
  }

  for (const input of secondaryInputs) {
    input.addEventListener("change", () => {
      if (input.checked && secondaryInputs.filter(option => option.checked).length > 2) {
        input.checked = false;
        update("Можно выбрать не более двух дополнительных ролей.");
        return;
      }
      update();
    });
  }

  form.addEventListener("reset", () => setTimeout(() => update(), 0));
  update();
}
