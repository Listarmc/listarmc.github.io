/** Minimal no-ads runtime for admin Quick Preview (not the public site). */
(() => {
    'use strict';
    const modal = document.getElementById('myModal');
    if (!modal) return;
    const slides = [...modal.querySelectorAll('.mySlides')];
    let index = 0;
    const show = n => {
        if (!slides.length) return;
        index = (n % slides.length + slides.length) % slides.length;
        slides.forEach((s, i) => { s.style.display = i === index ? 'flex' : 'none'; });
    };
    const open = n => { if (!slides.length) return; show(n); modal.style.display = 'block'; document.body.style.overflow = 'hidden'; };
    const close = () => { modal.style.display = 'none'; document.body.style.overflow = ''; };
    show(0);
    document.querySelectorAll('.thumbnails-grid .thumbnail-item').forEach((thumb, i) => {
        thumb.addEventListener('click', e => {
            e.preventDefault(); e.stopImmediatePropagation();
            const src = thumb.querySelector('img')?.src;
            const matching = slides.findIndex(s => s.querySelector('img')?.src === src);
            open(matching === -1 ? i : matching);
        }, true);
    });
    document.querySelectorAll('.view-all-btn').forEach(b => b.addEventListener('click', e => { e.preventDefault();e.stopImmediatePropagation();open(0); }, true));
    modal.querySelectorAll('.close').forEach(b => b.addEventListener('click', e => {e.preventDefault();close();}, true));
    modal.querySelectorAll('.prev').forEach(b => b.addEventListener('click', e => {e.preventDefault();show(index-1);}, true));
    modal.querySelectorAll('.next').forEach(b => b.addEventListener('click', e => {e.preventDefault();show(index+1);}, true));
    modal.addEventListener('click', e => { if(e.target === modal) close(); });
    document.addEventListener('keydown', e => {
        if (modal.style.display !== 'block') return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') show(index-1);
        if (e.key === 'ArrowRight') show(index+1);
    });
    document.getElementById('mobile-menu-toggle')?.addEventListener('click', () => {
        document.getElementById('nav-list')?.classList.toggle('active');
    });
})();
