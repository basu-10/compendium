export function getCkeditorForHost(host) {
    if (!host || typeof ClassicEditor === 'undefined' || !ClassicEditor.instances) return null;
    return ClassicEditor.instances.find(inst => {
        try { return host.contains(inst.ui.view.editable.element); } catch (e) { return false; }
    }) || null;
}