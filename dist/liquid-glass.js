/**
 * 💎 Nora Studio — Mainstream Crystal Liquid Glass Interactive Engine
 * Provides real-time cursor-reactive specular light refraction & ambient liquid orbs
 * across all pages while respecting low-resource mode and background tab throttling.
 */
(function initNoraLiquidGlass() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    function mountAmbientLiquidStage() {
        if (document.querySelector('.nora-liquid-ambient-stage')) return;
        const stage = document.createElement('div');
        stage.className = 'nora-liquid-ambient-stage';
        stage.setAttribute('aria-hidden', 'true');
        stage.innerHTML = [
            '<div class="nora-liquid-orb orb-violet"></div>',
            '<div class="nora-liquid-orb orb-cyan"></div>',
            '<div class="nora-liquid-orb orb-rose"></div>'
        ].join('');
        if (document.body) {
            document.body.prepend(stage);
        }
    }

    const SURFACE_SELECTOR = [
        '.glass-panel',
        '.card',
        '.stat-card',
        '.feature-card',
        '.bento-card',
        '.server-card',
        '.guild-card',
        '.verify-card',
        '.status-card',
        '.team-card',
        '.crystal-glass'
    ].join(',');

    let rafPending = false;
    let lastEvent = null;

    function handlePointerMove(e) {
        if (document.body && (document.body.classList.contains('low-resource-mode') || document.body.classList.contains('tab-minimized'))) {
            return;
        }
        lastEvent = e;
        if (rafPending) return;
        rafPending = true;
        window.requestAnimationFrame(() => {
            rafPending = false;
            if (!lastEvent || !lastEvent.target || typeof lastEvent.target.closest !== 'function') return;
            const card = lastEvent.target.closest(SURFACE_SELECTOR);
            if (!card) return;
            const rect = card.getBoundingClientRect();
            const x = lastEvent.clientX - rect.left;
            const y = lastEvent.clientY - rect.top;
            card.style.setProperty('--liquid-x', `${x}px`);
            card.style.setProperty('--liquid-y', `${y}px`);
            card.style.setProperty('--liquid-hover-opacity', '1');
        });
    }

    function handlePointerLeave(e) {
        if (!e.target || typeof e.target.closest !== 'function') return;
        const card = e.target.closest(SURFACE_SELECTOR);
        if (card) {
            card.style.setProperty('--liquid-hover-opacity', '0');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountAmbientLiquidStage, { once: true });
    } else {
        mountAmbientLiquidStage();
    }

    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerout', handlePointerLeave, { passive: true });
})();
