export function initAttachTabs(root, statementId) {
    const tabs = root.querySelectorAll('.attach-tab');
    const panels = root.querySelectorAll('.attach-tab-panel');

    function selectTab(name) {
        tabs.forEach(t => {
            const active = t.dataset.tab === name;
            t.classList.toggle('active', active);
            t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        panels.forEach(p => {
            const active = p.id === `panel-${name}-${statementId}`;
            p.classList.toggle('active', active);
            if (active) p.removeAttribute('hidden');
            else p.setAttribute('hidden', '');
        });
    }

    tabs.forEach(t => {
        t.addEventListener('click', () => selectTab(t.dataset.tab));
    });

    return { selectTab };
}