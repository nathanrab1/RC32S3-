// Preenche um <select> só quando as opções mudam de verdade. As placas são
// procuradas a cada 5 s; refazer o menu toda vez fechava o menu aberto no
// Chrome (parecia travado).
export function fillSelect(select, options, value) {
  const signature = JSON.stringify(options);
  if (select.dataset.options !== signature) {
    select.dataset.options = signature;
    select.replaceChildren(
      ...options.map(({ value: v, label, title }) => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = label;
        if (title) opt.title = title;
        return opt;
      }),
    );
  }
  if (select.value !== value) select.value = value;
}
